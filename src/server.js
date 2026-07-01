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
import { resolve } from 'node:path';
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
const { AncirSession, ensureRegistry, describeCapabilities } = await import('./engine/session.js');

// Load the node registry up-front. This must happen during the initial top-level
// run so vite-node's transform server is still alive to compile the Svelte modules
// (a lazy load inside a later tool handler hits ERR_CLOSED_SERVER once vite-node has
// finished the initial execution). Mirrors the GUI's startup in routes/+page.svelte.
await ensureRegistry();

// One process = one active session (AnCiR's core is a singleton). Created lazily and
// shared across transports/requests.
let session = null;
function requireSession() {
	if (!session) throw new Error('No active session. Call create_session first.');
	return session;
}
const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });

/** Register every AnCiR tool on a fresh McpServer (one per stdio process / HTTP request). */
function registerTools(server) {
	server.tool(
		'list_capabilities',
		'List every AnCiR analysis (table process), column transform, and plot type — derived live from the engine registry, with input fields, parameters (and defaults), output keys, and status.',
		{},
		async () => {
			await ensureRegistry();
			return ok(describeCapabilities());
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
		'Import one or more numeric columns into the active session.',
		{
			columns: z
				.array(
					z.object({
						name: z.string(),
						type: z.enum(['number', 'time', 'bin', 'category']).optional(),
						values: z.array(z.number())
					})
				)
				.describe('Columns to add')
		},
		async ({ columns }) => ok({ added: requireSession().importColumns(columns) })
	);

	server.tool(
		'list_columns',
		'List the columns in the active session (id, name, type, length).',
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

	server.tool(
		'add_plot',
		'Create a plot wired to existing columns and add it to the session (opens rendered in the GUI). Use list_capabilities → plots[].inputs for field names (scatterplot/boxplot → {x,y}; actogram/periodogram/correlogram/fft → {time,values}; histogram → {column}; tableplot → array of column ids).',
		{
			type: z.string().describe("Plot type id, e.g. 'scatterplot', 'actogram', 'periodogram'"),
			inputs: z
				.union([
					z.record(z.union([z.number().int(), z.string()])),
					z.array(z.union([z.number().int(), z.string()]))
				])
				.describe('Map of input field → column id or NAME, or (tableplot) an array of ids/names')
		},
		async ({ type, inputs }) => ok(requireSession().addPlot(type, inputs))
	);

	server.tool(
		'render_plot',
		'Rasterise a plot of session columns to PNG (and SVG) using a real headless browser — the actual AnCiR plot component, with axes/gridlines/legend. Returns the written file paths. Inputs work like add_plot; columns may be raw or analysis outputs. (Standalone: does not modify the session.)',
		{
			type: z.string().describe("Plot type id, e.g. 'scatterplot', 'actogram', 'periodogram'"),
			inputs: z
				.union([
					z.record(z.union([z.number().int(), z.string()])),
					z.array(z.union([z.number().int(), z.string()]))
				])
				.describe('Map of input field → column id or NAME, or (tableplot) an array of ids/names'),
			path: z
				.string()
				.describe('Output path prefix or .png path; .png and .svg are written alongside'),
			width: z.number().int().optional().describe('Plot width px (default 700)'),
			height: z.number().int().optional().describe('Plot height px (default 420)')
		},
		async ({ type, inputs, path, width, height }) => {
			await ensureRegistry();
			const outBase = resolve(process.cwd(), path).replace(/\.png$/i, '');
			return ok(await requireSession().renderPlotToFiles(type, inputs, { outBase, width, height }));
		}
	);

	server.tool(
		'run_cosinor',
		'Fit a cosinor (circadian rhythm) model to one or more columns using AnCiR’s engine. (Convenience wrapper; also reachable via run_table_process Cosinor.)',
		{
			x: z.number().describe('Column id for the time/x axis'),
			y: z.union([z.number(), z.array(z.number())]).describe('Column id(s) to fit'),
			useFixedPeriod: z.boolean().optional(),
			fixedPeriod: z.number().optional(),
			nHarmonics: z.number().int().optional(),
			Ncurves: z.number().int().optional(),
			alpha: z.number().optional()
		},
		async (args) => ok(await requireSession().runCosinor(args))
	);

	server.tool(
		'export_session',
		'Export the active session as an AnCiR-compatible JSON string (and optionally write it to a file). The file opens directly in the AnCiR GUI.',
		{ path: z.string().optional().describe('Optional file path to write the session JSON to') },
		async ({ path }) => {
			const json = requireSession().exportSession();
			if (path) {
				const abs = resolve(process.cwd(), path);
				await writeFile(abs, json, 'utf8');
				return ok({ written: abs, bytes: json.length });
			}
			return { content: [{ type: 'text', text: json }] };
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
