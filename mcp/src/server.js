// AnCiR MCP server.
//
// Exposes AnCiR's headless engine as MCP tools so an agent can create a session,
// import data, run analyses, transform columns, build plots, and export an
// AnCiR-compatible session.json.
//
// Transports:
//   npm start                 → stdio (default; for Claude Desktop/Code, Cursor, …)
//   npm start -- --http[=PORT] → Streamable HTTP/JSON on 127.0.0.1:PORT (default 3017)
//                                for any MCP-over-HTTP client (OpenAI/Gemini SDKs, web).
//   env: MCP_HTTP=1, MCP_HTTP_PORT, MCP_HTTP_HOST
//
// One process = one AnCiR session (core is a module singleton). Over HTTP the
// engine state is shared across requests (stateless transport, persistent engine),
// so drive it sequentially — concurrent clients would share one session.
//
// The DOM must be bootstrapped *before* the engine is imported, so the engine is
// loaded dynamically after ensureDom().
//
// Startup order (warm-up gate, src/warmup.js): the transport connects FIRST, so `initialize`
// and `tools/list` answer in about a second, with the tool text taken from the generated
// catalogue (src/toolFacts.js). The engine (DOM, session module, node registry) then loads in
// the background; tool calls made meanwhile wait for it, with progress notifications, and
// past a limit return "Just warming up the bots ...". The load must still run inside this
// module's top-level evaluation (it is awaited at the bottom of the file): vite-node closes
// its transform server once the entry module finishes, and a registry load after that fails
// with ERR_CLOSED_SERVER.

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { z } from 'zod';
import { ensureDom } from './engine/bootstrapDom.js';
import { createWarmup, isColdStart, WARMING_MESSAGE } from './warmup.js';
import { staticToolFacts } from './toolFacts.js';

// AnCiR's TableProcess constructor also runs the process fire-and-forget, so a
// bad-args failure can surface as an unhandled rejection. Keep the server alive
// (the tool handler returns a clean error via its own try/catch) instead of letting
// Node terminate the process on a single malformed LLM tool call.
process.on('unhandledRejection', (reason) => {
	console.error('unhandledRejection:', reason?.message || reason);
});

const here = dirname(fileURLToPath(import.meta.url));
const readText = (path) => {
	try {
		return readFileSync(path, 'utf8');
	} catch {
		return null;
	}
};

// The registry facts the tool text quotes, from the generated catalogue until the engine is
// warm (then from the live registry if they differ; see switchToLiveFacts).
let facts = staticToolFacts(JSON.parse(readText(join(here, 'emit/session-schema.generated.json'))));

// Version key for the cold-start stamp: the app version plus this package's.
const VERSION_KEY = [join(here, '../../package.json'), join(here, '../package.json')]
	.map((p) => JSON.parse(readText(p) ?? '{}').version ?? '?')
	.join('+');
// Kept in the vite cache dir, so clearing that cache also reads as a cold start.
const STAMP_PATH = join(here, '../node_modules/.vite/ancir-mcp-warm.json');
const COLD = isColdStart(readText(STAMP_PATH), VERSION_KEY);
// A warm start that is still loading after this long is announced too.
const ANNOUNCE_AFTER_MS = Number(process.env.ANCIR_MCP_WARMUP_ANNOUNCE_MS) || 8000;

const warmup = createWarmup({
	waitMs: Number(process.env.ANCIR_MCP_WARMUP_WAIT_MS) || undefined
});
// Filled by loadEngine(): the session module's exports.
let engine = null;

// One process = one active session (AnCiR's core is a singleton). Created lazily and
// shared across transports/requests.
let session = null;
function requireSession() {
	if (!session) throw new Error('No active session. Call create_session first.');
	return session;
}
// Tool results are JSON text, returned on EVERY call, so pretty-printing them taxes the client's
// context on every turn — the indentation alone is ~25-35% of a large payload (list_capabilities,
// export_session). Default to COMPACT; set ANCIR_MCP_VERBOSE=1 to pretty-print for human-readable
// debugging. A human reading raw tool output opts in; an agent never pays for whitespace it ignores.
const VERBOSE = process.env.ANCIR_MCP_VERBOSE === '1';
const ok = (data) => ({
	content: [{ type: 'text', text: VERBOSE ? JSON.stringify(data, null, 2) : JSON.stringify(data) }]
});

/**
 * add_plot / render_plot: their description and params quote registry facts (overlay hosts and
 * forms, Colour by / Size by hosts, modes and maps), so they are built from `facts`, the
 * catalogue's until warm, the live registry's after (see switchToLiveFacts).
 */
function plotToolDefs({ overlayHosts: OVERLAY_HOSTS, overlayForms: OVERLAY_FORMS, enc: ENC }) {
	// Plot overlays: reference lines and shaded bands, mirroring the GUI's Overlays tab, on
	// every plot whose class declares `overlayCapabilities` and only in the forms it allows
	// (validated per plot in the engine). Channel values: a NUMBER is a typed value, a STRING
	// is a column (by name or "id"), { column } is a column; a list of numbers is several
	// typed positions, and a list of columns on a line's `at` makes ONE LINE PER COLUMN (a
	// channel holds one column; see engine/overlays.js).
	const overlayColumnRef = z.object({ column: z.union([z.number().int(), z.string()]) });
	const overlayChannelValue = z.union([
		z.number(),
		z.string(),
		overlayColumnRef,
		z.array(z.union([z.number(), z.string(), overlayColumnRef]))
	]);
	// Colour by / Size by: a column name or id, or the settings object. Passed through as given;
	// the shared rules (plotbits/encodingSpec.js) check keys and values and say what is wrong.
	// Plot inputs: field → column (id or name). The many input (a one-input plot's only field,
	// else the second: y / values) also takes a LIST, one series per column (engine/plotInputs.js).
	const colRef = z.union([z.number().int(), z.string()]);
	const plotInputsSchema = z
		.union([z.record(z.union([colRef, z.array(colRef)])), z.array(colRef)])
		.describe(
			'Field → column id or NAME. The last field (y, values; column on one-input plots) also takes a LIST: one series per column; correlationheatmap/pairsplot need 2+, e.g. {column:["a","b","c"]}. tableplot: an array of columns.'
		);
	const encodingSchema = z.union([z.string(), z.number().int(), z.record(z.any())]).optional();
	const overlaysSchema = z
		.array(
			z.object({
				kind: z.enum(['line', 'band']),
				form: z
					.string()
					.optional()
					.describe(
						`line: vertical | horizontal. band: ribbon | horizontal | vertical | repeating. Each plot allows only some (${OVERLAY_FORMS}); the default is the plot's first listed form.`
					),
				name: z.string().optional(),
				label: z.string().optional().describe('Legend entry when non-empty'),
				enabled: z.boolean().optional(),
				channels: z
					.record(overlayChannelValue)
					.optional()
					.describe(
						'Per form: line → { at }; band ribbon → { x, lower, upper }; band horizontal → { lower, upper }; band vertical → { start, end }; band repeating → none (use repeatEveryHours/nightDurationHours/startTimeHours/useDataMin). A number is a TYPED value; a string / { column } is a column WIRE (name or id). Every channel holds ONE column. A list of numbers on `at` is several typed positions on one line; a list of columns on `at` creates one line PER column (same style and label, named Line N).'
					),
				colour: z.string().optional().describe('Line colour (#RRGGBB)'),
				strokeWidth: z.number().optional(),
				stroke: z.string().optional().describe("Line dash, e.g. '5, 5' (default) or 'none'"),
				fill: z.string().optional().describe('Band fill with alpha (#RRGGBBAA)'),
				edge: z.boolean().optional(),
				edgeColour: z.string().optional(),
				edgeWidth: z.number().optional(),
				repeatEveryHours: z.number().optional(),
				nightDurationHours: z.number().optional(),
				startTimeHours: z.number().optional(),
				useDataMin: z.boolean().optional()
			})
		)
		.optional()
		.describe(
			`Reference lines and shaded bands, on ${OVERLAY_HOSTS} (list_capabilities → plots[].overlays lists each plot's kinds and forms; detail:"full" adds the channels). E.g. scatterplot [{ kind:"line", form:"vertical", channels:{ at:"crossing" }, label:"alert" }, { kind:"band", form:"horizontal", channels:{ lower: 1.5, upper: 3 } }]; periodogram [{ kind:"line", form:"vertical", channels:{ at: 24 } }, { kind:"band", form:"vertical", channels:{ start: 20, end: 28 } }]. Overlays widen only the axes in plots[].overlayAxes (a periodogram never widens its period range, so a mark outside it is not drawn). plots[].overlayNote says how a plot reads a position: an fft takes vertical positions as PERIODS in hours even when its x axis shows frequency (drawn at 1/period there); a cwt takes horizontal periods (hours) only.`
		);

	return {
		add_plot: {
			description: `Create a plot wired to existing columns and add it to the session (opens rendered in the GUI). Use list_capabilities → plots[].inputs for field names (scatterplot/boxplot → {x,y}; actogram/periodogram/correlogram/fft → {time,values}; histogram → {column}; correlationheatmap/pairsplot → {column:[a,b,…]}; tableplot → array of column ids). ${OVERLAY_HOSTS} may also carry \`overlays\` (reference lines / bands, see that field); ${ENC.colourHosts.join(', ')} also \`colourBy\` / \`sizeBy\` (colour or size the marks by a column).`,
			params: {
				type: z.string().describe("Plot type id, e.g. 'scatterplot', 'actogram', 'periodogram'"),
				inputs: plotInputsSchema,
				overlays: overlaysSchema,
				colourBy: encodingSchema.describe(
					`Colour by (${ENC.colourHosts.join(', ')}): colour the series' marks by a column. A column name, or { column, mode, colormap, range: [min, max], colourLine }. mode: auto (default), ${ENC.modes.join(', ')}. colormap: ${ENC.sequentialMaps}; for ${ENC.cyclicModes.join(', ')}: ${ENC.cyclicMaps}. colourLine: colour the line too.`
				),
				sizeBy: encodingSchema.describe(
					`Size by (${ENC.sizeHosts.join(', ')}): size the points by a column. A column name, or { column, mode, minRadius, maxRadius, range: [min, max] } (radii in px). mode: auto, ${ENC.sizeModes.join(', ')}.`
				)
			}
		},
		render_plot: {
			description:
				'Rasterise a plot of session columns to PNG (and SVG) using a real headless browser — the actual AnCiR plot component, with axes/gridlines/legend. Returns the written file paths. Inputs work like add_plot; columns may be raw or analysis outputs. A tableplot draws HTML, so it gives a PNG only (svg null). (Standalone: does not modify the session.)',
			params: {
				type: z.string().describe("Plot type id, e.g. 'scatterplot', 'actogram', 'periodogram'"),
				inputs: plotInputsSchema,
				overlays: overlaysSchema,
				path: z
					.string()
					.describe('Output path prefix or .png path; .png and .svg are written alongside'),
				width: z.number().int().optional().describe('Plot width px (default 700)'),
				height: z.number().int().optional().describe('Plot height px (default 420)')
			}
		}
	};
}

/** Register every AnCiR tool on a fresh McpServer (one per stdio process / HTTP request). */
function registerTools(server) {
	const gate = warmup.gate;
	server.tool(
		'list_capabilities',
		'Discover AnCiR analyses (table processes), column transforms, and plot types, live from the engine registry. Returns a COMPACT summary by default (ids, families, one-line summaries, input fields, param names). For the exact params/defaults/output keys needed to hand-write a run_table_process call, and what each input and output port expects or produces (`ports`), pass detail:"full" or name:"Cosinor"; narrow with family.',
		{
			detail: z
				.enum(['names', 'summary', 'full'])
				.optional()
				.describe('names | summary (default) | full'),
			family: z
				.string()
				.optional()
				.describe('Filter analyses/transforms to one family, e.g. "Fitting", "Analysis"'),
			name: z
				.string()
				.optional()
				.describe('Return just the ONE named capability, at full detail, e.g. "Cosinor"')
		},
		gate(async ({ detail, family, name }) => {
			await engine.ensureRegistry();
			return ok(engine.filterCapabilities(engine.describeCapabilities(), { detail, family, name }));
		})
	);

	server.tool(
		'create_session',
		'Create (or reset) the active AnCiR session. Returns the session id.',
		{ id: z.string().optional().describe('Optional session id/name') },
		gate(async ({ id }) => {
			session = new engine.AncirSession(id ?? 'default');
			return ok({ created: true, id: session.id });
		})
	);

	server.tool(
		'import_data',
		'Import one or more columns into the active session.',
		{
			columns: z
				.array(
					z.object({
						name: z.string(),
						type: z.enum(['number', 'time', 'bin', 'category']).optional(),
						values: z
							.array(z.union([z.number(), z.string(), z.null()]))
							.describe('time: ISO 8601 text or epoch ms; null = missing'),
						time_zone: z
							.string()
							.optional()
							.describe(
								'time only: where the clock was. IANA ("Pacific/Auckland"), fixed offset ("+12:00") or "utc" (default)'
							)
					})
				)
				.describe('Columns to add')
		},
		gate(async ({ columns }) => ok({ added: requireSession().importColumns(columns) }))
	);

	server.tool(
		'list_columns',
		'List the columns in the active session (id, name, type, length; a time column also time_zone and times: as written | wall clock | instants).',
		{},
		gate(async () => ok({ columns: requireSession().listColumns() }))
	);

	server.tool(
		'run_table_process',
		'Run any AnCiR analysis/table-process by name against columns already imported into the session. Returns the created output columns (and a preview); the analysis node is added to the session so export_session opens in the GUI with it present. Use list_capabilities to discover names, input fields, and parameters.',
		{
			name: z
				.string()
				.describe("Table-process id, e.g. 'Cosinor', 'TrendFit', 'RhythmicityAnalysis'"),
			args: z
				.record(z.any())
				.describe(
					'Full args object: input column ids (e.g. {xIN, yIN:[...]}) plus parameters. `out` is optional for fixed-output processes (auto-seeded) and required for dynamic-output ones (see capabilities.dynamicOutputs).'
				)
		},
		gate(async ({ name, args }) => {
			await engine.ensureRegistry();
			return ok(await requireSession().runTableProcess(name, args ?? {}));
		})
	);

	server.tool(
		'add_column_process',
		'Apply a column transform (Add, Multiply, normalize, Sort, OutlierRemoval, RemoveTrend, …) to an existing column and run its chain. The transform is embedded in the session. See list_capabilities → transforms.',
		{
			columnId: z
				.union([z.number().int(), z.string()])
				.describe('Column to transform — its id or its name'),
			name: z.string().describe("Transform id, e.g. 'Add', 'normalize', 'OutlierRemoval'"),
			args: z
				.record(z.any())
				.optional()
				.describe('Parameter overrides merged onto defaults, e.g. {value: 5} for Add')
		},
		gate(async ({ columnId, name, args }) =>
			ok(requireSession().addColumnProcess(columnId, name, args ?? {}))
		)
	);

	const plotDefs = plotToolDefs(facts);
	const addPlot = server.tool(
		'add_plot',
		plotDefs.add_plot.description,
		plotDefs.add_plot.params,
		gate(async ({ type, inputs, overlays, colourBy, sizeBy }) =>
			ok(requireSession().addPlot(type, inputs, overlays, { colourBy, sizeBy }))
		)
	);

	const renderPlot = server.tool(
		'render_plot',
		plotDefs.render_plot.description,
		plotDefs.render_plot.params,
		gate(async ({ type, inputs, overlays, path, width, height }) => {
			await engine.ensureRegistry();
			const outBase = resolve(process.cwd(), path).replace(/\.png$/i, '');
			return ok(
				await requireSession().renderPlotToFiles(type, inputs, { outBase, width, height, overlays })
			);
		})
	);

	// NOTE: no `run_cosinor` tool. It computed a fit but did NOT add a node to the
	// session, so a caller got the numbers with no Cosinor node in the export. Use
	// `run_table_process` with name "Cosinor" instead — it persists the node AND
	// returns the recovered parameters in `fit`.

	server.tool(
		'export_session',
		'Export the active session as AnCiR JSON. By DEFAULT writes it to a file (opens directly in the AnCiR GUI) and returns {written, bytes, summary} — the full session JSON is large and rarely needed in-context. Pass a `path` to choose the location, or inline:true to get the JSON back as text instead.',
		{
			path: z
				.string()
				.optional()
				.describe('Where to write the JSON (default: a temp file). Ignored when inline:true.'),
			inline: z
				.boolean()
				.optional()
				.describe('Return the full session JSON as text instead of writing a file (large).')
		},
		gate(async ({ path, inline }) => {
			const s = requireSession();
			const json = s.exportSession();
			if (inline) return { content: [{ type: 'text', text: json }] };
			const abs = resolve(process.cwd(), path ?? join(tmpdir(), `ancir-session-${s.id}.json`));
			await writeFile(abs, json, 'utf8');
			// Counts, not the blob — enough for the caller to confirm what it exported.
			let summary = {};
			try {
				const o = JSON.parse(json);
				summary = {
					columns: o.data?.length ?? 0,
					plots: o.plots?.length ?? 0,
					analyses: o.tableProcesses?.length ?? 0
				};
			} catch {
				/* summary is best-effort */
			}
			return ok({ written: abs, bytes: json.length, summary });
		})
	);

	return { server, tools: { add_plot: addPlot, render_plot: renderPlot } };
}

const MCP_VERSION = JSON.parse(readText(join(here, '../package.json')) ?? '{}').version ?? '0.0.0';

/** A fresh McpServer with every tool. `logging` lets it tell the client about the warm-up. */
function buildServer() {
	return registerTools(
		new McpServer({ name: 'ancir', version: MCP_VERSION }, { capabilities: { logging: {} } })
	);
}

// --- warm-up -----------------------------------------------------------------

// The stdio server, once connected (HTTP is stateless, one server per request, so it has no
// standing connection to send notifications on; its callers see the gate's message instead).
let stdio = null;

/** Tell the terminal (stderr) and, over stdio once initialized, the client. */
function announce(level, text) {
	console.error(text);
	if (!stdio) return;
	const send = () =>
		stdio.server.sendLoggingMessage({ level, logger: 'ancir', data: text }).catch(() => {});
	if (stdio.initialized) send();
	else stdio.pending.push(send);
}

let announced = false;
function announceWarming() {
	if (announced || warmup.state !== 'loading') return;
	announced = true;
	announce('info', WARMING_MESSAGE);
}

/** The registry facts the plot tools quote, read live (engine loaded). */
async function liveToolFacts() {
	const { overlayHostTypes, overlayFormsSummary } = await import('./engine/overlays.js');
	const { encodingHostsSummary } = await import('./engine/encodings.js');
	return {
		overlayHosts: overlayHostTypes().join(', '),
		overlayForms: overlayFormsSummary(),
		enc: encodingHostsSummary()
	};
}

/**
 * Once warm: if the catalogue's facts differ from the registry's (a catalogue not regenerated
 * since a registry change, during development), use the live ones from now on and re-describe
 * the stdio server's plot tools, which sends tools/list_changed.
 */
async function switchToLiveFacts() {
	const live = await liveToolFacts();
	if (JSON.stringify(live) === JSON.stringify(facts)) return;
	console.error(
		'AnCiR MCP: src/emit/session-schema.generated.json is behind the registry (overlay or Colour by facts differ); the tool text now uses the live registry. Regenerate it with `npm run mcp:schema` (repo root).'
	);
	facts = live;
	if (!stdio) return;
	const defs = plotToolDefs(facts);
	for (const [name, tool] of Object.entries(stdio.tools)) {
		tool.update({ description: defs[name].description, paramsSchema: defs[name].params });
	}
}

/** DOM, then the session module, then the node registry (the slow part on a cold cache). */
async function loadEngine() {
	// Testing only: stretch the load to exercise the warm-up path on a warm machine.
	const delay = Number(process.env.ANCIR_MCP_WARMUP_DELAY_MS) || 0;
	if (delay) await new Promise((ok) => setTimeout(ok, delay));
	await ensureDom();
	const mod = await import('./engine/session.js');
	await mod.ensureRegistry();
	engine = mod;
	await switchToLiveFacts();
}

// --- transport selection -----------------------------------------------------

function parseHttpOption() {
	const arg = process.argv.find((a) => a === '--http' || a.startsWith('--http='));
	const envOn = process.env.MCP_HTTP === '1' || process.env.MCP_HTTP === 'true';
	if (!arg && !envOn) return null;
	const fromArg = arg && arg.includes('=') ? Number(arg.split('=')[1]) : undefined;
	const port = fromArg || Number(process.env.MCP_HTTP_PORT) || 3017;
	const host = process.env.MCP_HTTP_HOST || '127.0.0.1';
	return { port, host };
}

async function startStdio() {
	const { server, tools } = buildServer();
	stdio = { server, tools, initialized: false, pending: [] };
	// Logging notifications may only follow the client's `initialized`; queue until then.
	server.server.oninitialized = () => {
		stdio.initialized = true;
		for (const send of stdio.pending.splice(0)) send();
	};
	await server.connect(new StdioServerTransport());
	// stdio transport keeps the process alive; log to stderr so stdout stays clean.
	console.error('AnCiR MCP server running on stdio.');
}

async function startHttp({ port, host }) {
	const app = createMcpExpressApp({ host });
	// Stateless Streamable HTTP: a fresh server+transport per request, sharing the
	// module-level engine session. JSON responses (no SSE) keep simple clients happy.
	app.post('/mcp', async (req, res) => {
		try {
			const { server } = buildServer();
			const transport = new StreamableHTTPServerTransport({
				sessionIdGenerator: undefined,
				enableJsonResponse: true
			});
			res.on('close', () => {
				transport.close();
				server.close();
			});
			await server.connect(transport);
			await transport.handleRequest(req, res, req.body);
		} catch (err) {
			console.error('MCP HTTP request error:', err);
			if (!res.headersSent) {
				res.status(500).json({
					jsonrpc: '2.0',
					error: { code: -32603, message: 'Internal server error' },
					id: null
				});
			}
		}
	});
	const methodNotAllowed = (_req, res) =>
		res
			.status(405)
			.json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
	app.get('/mcp', methodNotAllowed);
	app.delete('/mcp', methodNotAllowed);

	await new Promise((resolveListen) => app.listen(port, host, resolveListen));
	console.error(`AnCiR MCP server running on http://${host}:${port}/mcp (Streamable HTTP, JSON).`);
}

const http = parseHttpOption();
if (http) await startHttp(http);
else await startStdio();

// Answering already; now load the engine. Awaited HERE, at top level, so vite-node keeps its
// transform server open for the Svelte modules (see the note at the top of the file).
const announceTimer = setTimeout(announceWarming, COLD ? 0 : ANNOUNCE_AFTER_MS);
try {
	await warmup.start(loadEngine);
	console.error(`AnCiR engine ready (${(warmup.readyMs / 1000).toFixed(1)} s).`);
	if (announced) announce('info', 'AnCiR is warmed up; the tools are ready.');
	try {
		mkdirSync(dirname(STAMP_PATH), { recursive: true });
		writeFileSync(STAMP_PATH, JSON.stringify({ version: VERSION_KEY, readyMs: warmup.readyMs }));
	} catch {
		/* the stamp only decides whether to announce up front */
	}
} catch (err) {
	// Keep serving: every tool call now returns this failure instead of the process dying.
	announce('error', `AnCiR engine failed to load: ${err?.stack || err}`);
} finally {
	clearTimeout(announceTimer);
}

void randomUUID; // reserved for a future stateful (per-session-id) HTTP mode
