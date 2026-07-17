// A remote MCP server, in the Worker — so an agent can build AnCiR sessions with NO clone,
// NO install and no VM: just a URL.
//
// Why this can live here at all: the calling agent IS the model, so unlike POST /build there's
// no LLM call to make — the agent hands us a draft and we normalise + store it. That means no
// API key, no inference cost, and none of the heavy engine. The trade-off is the same one the
// ADR draws: this builds sessions but cannot report COMPUTED results (the browser does the
// computing). An agent that needs live numbers still wants the engine MCP (src/server.js).
//
// Hand-rolled JSON-RPC rather than @modelcontextprotocol/sdk: the SDK's Streamable HTTP
// transport is built on Node's req/res and doesn't run on Workers. MCP over HTTP is plain
// JSON-RPC 2.0, and a tools-only server needs just initialize + tools/list + tools/call, so
// the SDK would be all cost and no benefit here.
//
// Spec: https://modelcontextprotocol.io/specification — Streamable HTTP transport.

import { normalizeSession } from '../src/emit/normalizer.js';
import generated from '../src/emit/session-schema.generated.json' with { type: 'json' };

// Matches the SUPPORTED_PROTOCOL_VERSIONS list in @modelcontextprotocol/sdk 1.29. We echo the
// client's version when we know it (per spec) and otherwise fall back to the SDK's default.
const SUPPORTED_PROTOCOL_VERSIONS = [
	'2025-11-25',
	'2025-06-18',
	'2025-03-26',
	'2024-11-05',
	'2024-10-07'
];
const DEFAULT_PROTOCOL_VERSION = '2025-03-26';

const SERVER_INFO = { name: 'ancir', title: 'AnCiR', version: '1.0.0' };

// ---- tools -----------------------------------------------------------------------------

/** The draft shape, as JSON Schema, so the agent gets it without reading our docs. */
const DRAFT_SCHEMA = {
	type: 'object',
	properties: {
		columns: {
			type: 'array',
			description:
				'Literal input data. Use ONLY for small data the user gave you — to synthesise data, use the SimulatedData/SequenceColumn/Random analyses instead.',
			items: {
				type: 'object',
				properties: {
					name: { type: 'string' },
					type: { type: 'string', enum: ['number', 'time', 'category'] },
					values: { type: 'array', items: {} }
				},
				required: ['name', 'values']
			}
		},
		analyses: {
			type: 'array',
			description:
				'Run in order — put a generator before the analysis that reads it. `args` is FLAT: input-column fields (xIN, yIN, …) AND parameters together at the top level. Reference columns by NAME. Never pass `out`; output columns are allocated automatically. Call list_capabilities for each analysis\'s exact args and the names of the columns it produces.',
			items: {
				type: 'object',
				properties: {
					name: { type: 'string', description: 'e.g. "Cosinor"' },
					args: { type: 'object' }
				},
				required: ['name']
			}
		},
		plots: {
			type: 'array',
			description:
				'A plot holds a LIST of series, so raw data and a fitted curve go on the same plot. A series\' keys are the plot type\'s own input fields (scatterplot/boxplot/meansem → x,y; actogram/periodogram/fft/correlogram/circularphase → time,values; histogram → column) — see list_capabilities.',
			items: {
				type: 'object',
				properties: {
					type: { type: 'string', description: 'e.g. "scatterplot"' },
					name: { type: 'string' },
					series: {
						type: 'array',
						items: {
							type: 'object',
							description:
								'Column NAMES per the plot type\'s fields, plus optional label and kind ("points" for measured data, "line" for a fit).'
						}
					},
					inputs: { type: 'object', description: 'Shorthand for a single series.' }
				},
				required: ['type']
			}
		}
	}
};

function toolList() {
	return [
		{
			name: 'list_capabilities',
			title: 'List AnCiR analyses and plots',
			description:
				'The analyses and plot types available, with each analysis\'s exact flat args, the names of the columns it produces, and (for fits) which output pairs as the fitted curve. Call this FIRST — it is derived from AnCiR\'s live registry, so it is the only reliable source for names and parameters.',
			inputSchema: { type: 'object', properties: {} }
		},
		{
			name: 'build_session',
			title: 'Build an AnCiR session',
			description:
				'Turn a session draft into a real AnCiR session and return a link that opens it. The analyses are computed in the user\'s browser when the link is opened, so this does NOT return computed results — it returns a session to look at. Anything unusable is reported in `errors` rather than silently dropped.',
			inputSchema: DRAFT_SCHEMA
		}
	];
}

/** Render the catalogue as compact text — cheaper for the agent to read than raw schema JSON. */
function capabilitiesText() {
	const argsTemplate = (n) => {
		const t = {};
		for (const f of n.inputs.scalar ?? []) t[f] = '<col>';
		for (const f of n.inputs.array ?? []) t[f] = ['<col>'];
		Object.assign(t, n.params ?? {});
		if ('useFixedPeriod' in t) t.useFixedPeriod = true;
		return t;
	};
	const nodes = Object.entries(generated.nodes)
		.map(([name, n]) => {
			const outs = n.fixedOut.length ? ` -> produces: ${n.fixedOut.join(', ')}` : '';
			const fit = n.fitOut
				? ` -> fitted curve: x=${n.fitOut.x}, y=${n.fitOut.yPrefix}<your Y column>`
				: '';
			return `  ${name}: args=${JSON.stringify(argsTemplate(n))}${outs}${fit}`;
		})
		.join('\n');
	const plots = Object.entries(generated.plots)
		.map(([type, p]) => {
			const fields = p.inputs ?? [];
			if (!fields.length) return `  ${type}: inputs=["<col>", …]  (a plain column list)`;
			return `  ${type}: series=[${JSON.stringify(
				Object.fromEntries(fields.map((f) => [f, '<col>']))
			)}]`;
		})
		.join('\n');
	return `ANALYSES (exact args):\n${nodes}\n\nPLOTS (exact series fields):\n${plots}`;
}

async function callTool(name, args, env, request, ctx) {
	if (name === 'list_capabilities') {
		return { content: [{ type: 'text', text: capabilitiesText() }] };
	}

	if (name === 'build_session') {
		const { session, warnings, errors } = normalizeSession(args ?? {});
		if (!session.tableProcesses.length && !session.data.length) {
			// Report rather than store an empty session — the agent can fix and retry.
			return {
				isError: true,
				content: [
					{
						type: 'text',
						text: `That draft produced an empty session.\n${[...errors, ...warnings].join('\n') || 'Check list_capabilities for exact node names and args.'}`
					}
				]
			};
		}
		if (!env.SESSIONS) {
			return {
				isError: true,
				content: [{ type: 'text', text: 'Session storage is not configured on this server.' }]
			};
		}
		// Throttle the only step that costs anything (a KV write) — not the handshake.
		if (await ctx?.rateLimited?.()) {
			return {
				isError: true,
				content: [
					{
						type: 'text',
						text: 'Rate limited: too many sessions built recently. Wait about a minute and try again.'
					}
				]
			};
		}

		const sessionId = crypto.randomUUID();
		await env.SESSIONS.put(`s:${sessionId}`, JSON.stringify(session), {
			expirationTtl: Number(env.SESSION_TTL_S ?? 86400)
		});
		const sessionUrl = `${new URL(request.url).origin}/sessions/${sessionId}`;
		const ancir = (env.ANCIR_BASE_URL ?? 'https://ancir.pages.dev').replace(/\/+$/, '');
		const url = `${ancir}/?loadFromURL=${encodeURIComponent(sessionUrl)}`;

		ctx?.log?.({
			event: 'mcp_build',
			ts: new Date().toISOString(),
			sessionId,
			nodes: session.tableProcesses.map((t) => t.name),
			plots: session.plots.map((p) => p.type),
			errors,
			warnings
		});

		// Lead with the link: it's the thing the agent should hand back to the user. Surface
		// errors/warnings too — a dropped node or un-pre-allocated output is worth mentioning
		// rather than pretending the session is complete.
		const notes = [
			errors.length ? `Errors (these parts were skipped):\n- ${errors.join('\n- ')}` : '',
			warnings.length ? `Warnings:\n- ${warnings.join('\n- ')}` : ''
		]
			.filter(Boolean)
			.join('\n\n');
		return {
			content: [
				{
					type: 'text',
					text:
						`Session built. Open it in AnCiR:\n${url}\n\n` +
						`It contains: ${session.tableProcesses.map((t) => t.name).join(', ') || '(no analyses)'}` +
						`${session.plots.length ? `; plots: ${session.plots.map((p) => p.type).join(', ')}` : ''}.\n` +
						`The analyses compute in the browser when the link is opened, so no results are returned here.` +
						(notes ? `\n\n${notes}` : '')
				}
			],
			structuredContent: { url, sessionUrl, sessionId, errors, warnings }
		};
	}

	return { isError: true, content: [{ type: 'text', text: `Unknown tool "${name}".` }] };
}

// ---- JSON-RPC --------------------------------------------------------------------------

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

/** Handle one JSON-RPC message. Returns null for notifications (which take no response). */
async function handleMessage(msg, env, request, ctx) {
	if (msg?.jsonrpc !== '2.0' || typeof msg?.method !== 'string') {
		return rpcError(msg?.id ?? null, -32600, 'Invalid Request');
	}
	const { id, method, params } = msg;
	const isNotification = id === undefined || id === null;

	switch (method) {
		case 'initialize': {
			// Echo the client's protocol version when we support it, else offer our default.
			const asked = params?.protocolVersion;
			const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(asked)
				? asked
				: DEFAULT_PROTOCOL_VERSION;
			return rpcResult(id, {
				protocolVersion,
				capabilities: { tools: { listChanged: false } },
				serverInfo: SERVER_INFO,
				instructions:
					'Build AnCiR chronobiology sessions. Call list_capabilities first for exact analysis names, args and output column names, then build_session with a draft. The link it returns opens the session in AnCiR, which computes it in the browser — results are not returned here.'
			});
		}
		case 'notifications/initialized':
		case 'notifications/cancelled':
			return null; // notifications: acknowledged by the transport, no body
		case 'ping':
			return rpcResult(id, {});
		case 'tools/list':
			return rpcResult(id, { tools: toolList() });
		case 'tools/call': {
			const name = params?.name;
			try {
				const result = await callTool(name, params?.arguments, env, request, ctx);
				return rpcResult(id, result);
			} catch (e) {
				// A tool that throws is reported to the MODEL as an error result (so it can
				// retry), not as a protocol error.
				return rpcResult(id, {
					isError: true,
					content: [{ type: 'text', text: `Tool "${name}" failed: ${e?.message ?? e}` }]
				});
			}
		}
		default:
			if (isNotification) return null;
			return rpcError(id, -32601, `Method not found: ${method}`);
	}
}

/**
 * POST /mcp — Streamable HTTP. Accepts one message or a batch.
 * @param {Request} request
 * @param {object} env
 * @param {{log?: Function}} [ctx]
 */
export async function handleMcp(request, env, ctx = {}) {
	let body;
	try {
		body = await request.json();
	} catch {
		return { status: 400, body: rpcError(null, -32700, 'Parse error') };
	}

	if (Array.isArray(body)) {
		const out = [];
		for (const m of body) {
			const r = await handleMessage(m, env, request, ctx);
			if (r) out.push(r);
		}
		// A batch of only notifications gets no body, per JSON-RPC.
		return out.length ? { status: 200, body: out } : { status: 202, body: null };
	}

	const res = await handleMessage(body, env, request, ctx);
	return res ? { status: 200, body: res } : { status: 202, body: null };
}
