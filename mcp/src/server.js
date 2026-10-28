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

import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { z } from 'zod';
import { ensureDom } from './engine/bootstrapDom.js';

// AnCiR's TableProcess constructor also runs the process fire-and-forget, so a
// bad-args failure can surface as an unhandled rejection. Keep the server alive
// (the tool handler returns a clean error via its own try/catch) instead of letting
// Node terminate the process on a single malformed LLM tool call.
process.on('unhandledRejection', (reason) => {
	console.error('unhandledRejection:', reason?.message || reason);
});

await ensureDom();
const { AncirSession, ensureRegistry, describeCapabilities, filterCapabilities } =
	await import('./engine/session.js');

// Load the node registry up-front. This must happen during the initial top-level
// run so vite-node's transform server is still alive to compile the Svelte modules
// (a lazy load inside a later tool handler hits ERR_CLOSED_SERVER once vite-node has
// finished the initial execution). Mirrors the GUI's startup in routes/+page.svelte.
await ensureRegistry();
// Which plots carry overlays, and in which forms: read from the registry for the tool text.
const { overlayHostTypes, overlayFormsSummary } = await import('./engine/overlays.js');
const OVERLAY_HOSTS = overlayHostTypes().join(', ');
const OVERLAY_FORMS = overlayFormsSummary();
// Which plots can colour / size their marks by a column, the modes and the maps (live facts,
// the same ones a draft and the app's AI edit are checked against).
const { encodingHostsSummary } = await import('./engine/encodings.js');
const ENC = encodingHostsSummary();

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

/** Register every AnCiR tool on a fresh McpServer (one per stdio process / HTTP request). */
function registerTools(server) {
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
		async ({ detail, family, name }) => {
			await ensureRegistry();
			return ok(filterCapabilities(describeCapabilities(), { detail, family, name }));
		}
	);

	server.tool(
		'create_session',
		'Create (or reset) the active AnCiR session. Returns the session id.',
		{ id: z.string().optional().describe('Optional session id/name') },
		async ({ id }) => {
			session = new AncirSession(id ?? 'default');
			return ok({ created: true, id: session.id });
		}
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
		async ({ columns }) => ok({ added: requireSession().importColumns(columns) })
	);

	server.tool(
		'list_columns',
		'List the columns in the active session (id, name, type, length; a time column also time_zone and times: as written | wall clock | instants).',
		{},
		async () => ok({ columns: requireSession().listColumns() })
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
		async ({ name, args }) => {
			await ensureRegistry();
			return ok(await requireSession().runTableProcess(name, args ?? {}));
		}
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
		async ({ columnId, name, args }) =>
			ok(requireSession().addColumnProcess(columnId, name, args ?? {}))
	);

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

	server.tool(
		'add_plot',
		`Create a plot wired to existing columns and add it to the session (opens rendered in the GUI). Use list_capabilities → plots[].inputs for field names (scatterplot/boxplot → {x,y}; actogram/periodogram/correlogram/fft → {time,values}; histogram → {column}; tableplot → array of column ids). ${OVERLAY_HOSTS} may also carry \`overlays\` (reference lines / bands, see that field); ${ENC.colourHosts.join(', ')} also \`colourBy\` / \`sizeBy\` (colour or size the marks by a column).`,
		{
			type: z.string().describe("Plot type id, e.g. 'scatterplot', 'actogram', 'periodogram'"),
			inputs: z
				.union([
					z.record(z.union([z.number().int(), z.string()])),
					z.array(z.union([z.number().int(), z.string()]))
				])
				.describe('Map of input field → column id or NAME, or (tableplot) an array of ids/names'),
			overlays: overlaysSchema,
			colourBy: encodingSchema.describe(
				`Colour by (${ENC.colourHosts.join(', ')}): colour the series' marks by a column. A column name, or { column, mode, colormap, range: [min, max], colourLine }. mode: auto (default), ${ENC.modes.join(', ')}. colormap: ${ENC.sequentialMaps}; for ${ENC.cyclicModes.join(', ')}: ${ENC.cyclicMaps}. colourLine: colour the line too.`
			),
			sizeBy: encodingSchema.describe(
				`Size by (${ENC.sizeHosts.join(', ')}): size the points by a column. A column name, or { column, mode, minRadius, maxRadius, range: [min, max] } (radii in px). mode: auto, ${ENC.sizeModes.join(', ')}.`
			)
		},
		async ({ type, inputs, overlays, colourBy, sizeBy }) =>
			ok(requireSession().addPlot(type, inputs, overlays, { colourBy, sizeBy }))
	);

	server.tool(
		'render_plot',
		'Rasterise a plot of session columns to PNG (and SVG) using a real headless browser — the actual AnCiR plot component, with axes/gridlines/legend. Returns the written file paths. Inputs work like add_plot; columns may be raw or analysis outputs. A tableplot draws HTML, so it gives a PNG only (svg null). (Standalone: does not modify the session.)',
		{
			type: z.string().describe("Plot type id, e.g. 'scatterplot', 'actogram', 'periodogram'"),
			inputs: z
				.union([
					z.record(z.union([z.number().int(), z.string()])),
					z.array(z.union([z.number().int(), z.string()]))
				])
				.describe('Map of input field → column id or NAME, or (tableplot) an array of ids/names'),
			overlays: overlaysSchema,
			path: z
				.string()
				.describe('Output path prefix or .png path; .png and .svg are written alongside'),
			width: z.number().int().optional().describe('Plot width px (default 700)'),
			height: z.number().int().optional().describe('Plot height px (default 420)')
		},
		async ({ type, inputs, overlays, path, width, height }) => {
			await ensureRegistry();
			const outBase = resolve(process.cwd(), path).replace(/\.png$/i, '');
			return ok(
				await requireSession().renderPlotToFiles(type, inputs, { outBase, width, height, overlays })
			);
		}
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
		async ({ path, inline }) => {
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
		}
	);

	return server;
}

function buildServer() {
	return registerTools(new McpServer({ name: 'ancir', version: '0.0.2' }));
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
	const server = buildServer();
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
			const server = buildServer();
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

void randomUUID; // reserved for a future stateful (per-session-id) HTTP mode
