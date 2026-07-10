// NL → AnCiR session, the agent half of the MVP backend.
//
// Each call spins up an isolated AnCiR MCP server (one process = one session),
// drives it to build a session from the prompt, and returns the exported
// AnCiR-compatible session JSON (which the GUI loads via ?loadFromURL=).
//
// Planner:
//   - LLM mode  (OPENAI_API_KEY set): translates the MCP tools into OpenAI
//     function-calling `tools` and runs a tool-calling loop against any
//     OpenAI-compatible endpoint (OpenAI / Gemini compat / Ollama / LM Studio).
//   - Scripted mode (no key): a small deterministic planner so the full round-trip
//     is demonstrable and testable without an LLM key.
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { buildSystemPrompt, promptVersion } from './promptBuilder.js';
import { chatCompletion } from './llmClient.js';

const MCP_DIR = fileURLToPath(new URL('..', import.meta.url));
const VITE_NODE = fileURLToPath(new URL('../node_modules/.bin/vite-node', import.meta.url));
const SERVER = fileURLToPath(new URL('../src/server.js', import.meta.url));

// Server-side defaults (optional). If a deployer sets these, they act as a fallback
// when a request brings no model config of its own.
const ENV = {
	baseUrl: process.env.OPENAI_BASE_URL || '',
	apiKey: process.env.OPENAI_API_KEY || '',
	model: process.env.MODEL || ''
};

// Merge a per-request BYO model config over the server defaults, so users can bring
// their OWN endpoint/key/model and the deployer never pays for inference. The key is
// used only for this request and is never logged or stored.
export function resolveLlm(llm = {}) {
	const explicitBase = llm.baseUrl || ENV.baseUrl;
	return {
		baseUrl: llm.baseUrl || ENV.baseUrl || 'https://api.openai.com/v1',
		model: llm.model || ENV.model || 'gpt-4o-mini',
		// Local servers (Ollama/LM Studio) don't need a key; a base URL alone is enough.
		apiKey: llm.apiKey || ENV.apiKey || (explicitBase ? 'local' : '')
	};
}

// Runtime knobs (maxTurns/timeout/temperature/…), clamped to safe ranges. The HTTP layer
// also validates+clamps these; this keeps direct callers (tests) safe too.
export function resolveOptions(o = {}) {
	const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : d);
	const int = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : d);
	return {
		maxTurns: int(o.maxTurns, 1, 24, 16),
		timeoutMs: int(o.timeoutMs, 5000, 120000, 90000),
		retries: int(o.retries, 0, 5, 3),
		temperature: o.temperature == null ? undefined : num(o.temperature, 0, 2, undefined),
		topP: o.topP == null ? undefined : num(o.topP, 0, 1, undefined),
		maxTokens: o.maxTokens == null ? undefined : int(o.maxTokens, 1, 8192, undefined),
		toolChoice: o.toolChoice || 'auto',
		// Default: omit. Our loop executes tool calls SERIALLY (in array order), so
		// ordering is already guaranteed; only send the flag if a caller sets it.
		parallelToolCalls: typeof o.parallelToolCalls === 'boolean' ? o.parallelToolCalls : undefined
	};
}

/** Spawn an isolated MCP server, run `fn({call, tools})`, then tear it down. */
async function withMcp(fn) {
	const transport = new StdioClientTransport({
		command: VITE_NODE,
		args: [SERVER],
		cwd: MCP_DIR,
		stderr: 'ignore'
	});
	const client = new Client({ name: 'ancir-app', version: '0.0.1' });
	await client.connect(transport);
	const tools = (await client.listTools()).tools;
	const call = async (name, args = {}) =>
		(await client.callTool({ name, arguments: args })).content?.[0]?.text ?? '';
	try {
		return await fn({ call, tools });
	} finally {
		await client.close();
	}
}

/** LLM tool-calling loop against an OpenAI-compatible endpoint (`cfg`, `options`). */
export async function runLlm({ prompt, call, tools, trace, cfg, options = {} }) {
	const oaiTools = tools
		// The model builds the session; we export it ourselves afterwards.
		.filter((t) => t.name !== 'export_session' && t.name !== 'render_plot')
		.map((t) => ({
			type: 'function',
			function: {
				name: t.name,
				description: t.description,
				parameters: t.inputSchema || { type: 'object', properties: {} }
			}
		}));

	// Live capability catalogue → embedded in the system prompt so the model uses exact
	// arg shapes instead of guessing. Prompt rules live in prompts/system.md.
	let caps = null;
	try {
		caps = JSON.parse(await call('list_capabilities', {}));
	} catch {
		/* buildSystemPrompt falls back to "call list_capabilities yourself" */
	}
	const messages = [
		{ role: 'system', content: buildSystemPrompt(caps) },
		{ role: 'user', content: prompt }
	];

	// Static request params (messages are added per turn).
	const params = { tools: oaiTools, tool_choice: options.toolChoice ?? 'auto' };
	if (options.temperature != null) params.temperature = options.temperature;
	if (options.topP != null) params.top_p = options.topP;
	if (options.maxTokens != null) params.max_tokens = options.maxTokens;
	if (options.parallelToolCalls != null) params.parallel_tool_calls = options.parallelToolCalls;

	const maxTurns = options.maxTurns ?? 16;
	for (let turn = 0; turn < maxTurns; turn++) {
		const r = await chatCompletion(
			cfg,
			{ ...params, messages },
			{
				retries: options.retries ?? 3,
				timeoutMs: options.timeoutMs ?? 90000,
				onRetry: ({ attempt, reason }) => trace.push(`retry ${attempt} (${reason})`)
			}
		);
		if (!r.ok) {
			// Groq validates tool args server-side and 400s with `tool_use_failed` on a
			// malformed call — recover with a nudge instead of failing the build.
			if (r.status === 400 && r.json?.error?.code === 'tool_use_failed') {
				trace.push('tool_use_failed → retry');
				messages.push({
					role: 'user',
					content:
						`Your last tool call was rejected: ${r.json.error.message || 'invalid tool call'}. ` +
						'Tool arguments must be literal JSON (no functions, lambdas, ranges, or code). Do not ' +
						'hand-type numeric arrays — use run_table_process with "SimulatedData" to generate data.'
				});
				continue;
			}
			throw new Error(`LLM HTTP ${r.status}: ${r.body}`);
		}
		const msg = r.message;
		messages.push(msg);
		if (!msg.tool_calls?.length) break;
		// Execute SERIALLY, in the order the model returned them — the AnCiR engine is
		// stateful (create → import → analyse → plot), so parallelism would race `core`.
		for (const tc of msg.tool_calls) {
			const args = JSON.parse(tc.function.arguments || '{}');
			trace.push(`${tc.function.name}(${JSON.stringify(args).slice(0, 100)})`);
			let content;
			try {
				content = await call(tc.function.name, args);
			} catch (e) {
				content = `ERROR: ${e.message}`;
			}
			messages.push({ role: 'tool', tool_call_id: tc.id, content: String(content).slice(0, 4000) });
		}
	}
}

/** Deterministic fallback planner (no LLM key) — enough to prove the round-trip. */
export async function runScripted({ prompt, call, trace }) {
	const p = String(prompt || '').toLowerCase();
	const periodMatch =
		p.match(/period\s*(?:of\s*)?(\d+(?:\.\d+)?)/) || p.match(/(\d+(?:\.\d+)?)\s*[- ]?h(?:our|r)?s?\b/);
	const T = periodMatch ? Number(periodMatch[1]) : 24;
	const N = 96;
	const t = [];
	const y = [];
	for (let i = 0; i < N; i++) {
		t.push(i);
		y.push(10 + 5 * Math.cos((2 * Math.PI * i) / T));
	}
	await call('import_data', { columns: [{ name: 'time_h', values: t }, { name: 'signal', values: y }] });
	trace.push('import_data(time_h, signal)');

	if (p.includes('periodogram') || p.includes('rhythm')) {
		await call('run_table_process', {
			name: 'RhythmicityAnalysis',
			args: { xIN: 0, yIN: [1], analysis: 'periodogram' }
		});
		trace.push('run_table_process(RhythmicityAnalysis)');
	} else {
		await call('run_table_process', {
			name: 'Cosinor',
			args: { xIN: 0, yIN: [1], useFixedPeriod: true, fixedPeriod: T }
		});
		trace.push(`run_table_process(Cosinor, period=${T})`);
	}
	await call('add_plot', { type: 'scatterplot', inputs: { x: 0, y: 1 } });
	trace.push('add_plot(scatterplot)');
}

/**
 * Build an AnCiR session from a natural-language prompt.
 * @param {{prompt:string, sessionId?:string,
 *   llm?:{baseUrl?:string, apiKey?:string, model?:string},
 *   options?:{maxTurns?:number, timeoutMs?:number, retries?:number, temperature?:number,
 *     topP?:number, maxTokens?:number, toolChoice?:string, parallelToolCalls?:boolean}}} opts
 *   `llm` is the caller's own model config (BYO); falls back to server env, then the
 *   no-key scripted planner. `options` are clamped runtime knobs.
 * @returns {Promise<{json:string, trace:string[], planner:'llm'|'scripted', model?:string, promptVersion?:string}>}
 */
export async function buildSession({ prompt, sessionId, llm, options }) {
	const cfg = resolveLlm(llm);
	const opts = resolveOptions(options);
	return withMcp(async ({ call, tools }) => {
		const trace = [];
		const planner = cfg.apiKey ? 'llm' : 'scripted';
		await call('create_session', { id: sessionId ?? 'app' });
		trace.push('create_session');
		if (planner === 'llm') await runLlm({ prompt, call, tools, trace, cfg, options: opts });
		else await runScripted({ prompt, call, trace });
		const json = await call('export_session', {}); // canonical AnCiR session JSON
		return {
			json,
			trace,
			planner,
			model: planner === 'llm' ? cfg.model : undefined,
			promptVersion: planner === 'llm' ? promptVersion() : undefined
		};
	});
}
