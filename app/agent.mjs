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

const MCP_DIR = fileURLToPath(new URL('..', import.meta.url));
const VITE_NODE = fileURLToPath(new URL('../node_modules/.bin/vite-node', import.meta.url));
const SERVER = fileURLToPath(new URL('../src/server.js', import.meta.url));

const BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
// Local servers (Ollama/LM Studio) don't need a key; setting OPENAI_BASE_URL is
// enough to enter live mode (a dummy key satisfies the Authorization header).
const API_KEY = process.env.OPENAI_API_KEY || (process.env.OPENAI_BASE_URL ? 'local' : '');
const MODEL = process.env.MODEL || 'gpt-4o-mini';

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

/** LLM tool-calling loop against an OpenAI-compatible endpoint. */
async function runLlm({ prompt, call, tools, trace }) {
	const oaiTools = tools
		// The model builds the session; we export it ourselves afterwards.
		.filter((t) => t.name !== 'export_session' && t.name !== 'render_plot')
		.map((t) => ({
			type: 'function',
			function: { name: t.name, description: t.description, parameters: t.inputSchema || { type: 'object', properties: {} } }
		}));

	// Embed the real analysis/plot parameter shapes so the model uses exact arg
	// names instead of guessing (run_table_process `args` is a free-form object).
	let analysisRef = '';
	let plotRef = '';
	try {
		const caps = JSON.parse(await call('list_capabilities', {}));
		// One flat `args` object per analysis (input fields + params together), so the
		// model doesn't nest under "inputs"/"params".
		const argsTemplate = (a) => {
			const t = {};
			for (const f of a.inputs?.scalar ?? []) t[f] = '<col>';
			for (const f of a.inputs?.array ?? []) t[f] = ['<col>'];
			Object.assign(t, a.params);
			// Free-period fitting is unreliable on a time axis; a known-period rhythm
			// should use a fixed period — surface that as the working default.
			if ('useFixedPeriod' in t) t.useFixedPeriod = true;
			return t;
		};
		analysisRef = caps.analyses.map((a) => `  ${a.id}: args=${JSON.stringify(argsTemplate(a))}`).join('\n');
		plotRef = caps.plots.map((p) => `${p.id}[${(p.inputs || []).join(',')}]`).join(', ');
	} catch {
		/* fall back to the model calling list_capabilities itself */
	}

	const messages = [
		{
			role: 'system',
			content:
				'You are a chronobiology analyst building an AnCiR session from the user request.\n' +
				'Order: create_session first, then build data, then analyses (run_table_process), transforms ' +
				'(add_column_process) and plots (add_plot). When done, stop (do not narrate).\n' +
				'RULES for tool arguments (critical):\n' +
				'- Arguments must be LITERAL JSON only — never code, functions, lambdas, ranges, or expressions. ' +
				'`values` must be a real array of numbers like [0,1,2], not {"function":...}.\n' +
				'- run_table_process takes {name, args}. `args` is a FLAT object: input-column fields (xIN, yIN, ' +
				'…) AND parameters together at the TOP LEVEL. Do NOT nest under "inputs" or "params". Copy the ' +
				'`args=` template for the analysis below verbatim, replacing "<col>" with a column name; keep ' +
				'nested values like SimulatedData.sections. Do NOT invent parameter names.\n' +
				'- Do NOT hand-type long numeric arrays. To create synthetic data, use run_table_process with ' +
				'"SimulatedData" (a rhythm+noise generator) or "SequenceColumn"/"Random". Use import_data only ' +
				'for small data the user gives explicitly, as literal number arrays.\n' +
				'- For period fits (Cosinor/FitFunction) set useFixedPeriod:true and fixedPeriod to the rhythm ' +
				'period in hours (e.g. 24); free-period mode is unreliable on time-axis data.\n' +
				'- For column references (xIN, yIN, plot inputs, columnId) pass the column NAME (e.g. "time_0", ' +
				'"values_0") instead of a numeric id — STRONGLY PREFERRED, it avoids id mistakes. Read exact names ' +
				'from the tool result that created them (each output lists {columnId, name}) or from list_columns.\n' +
				(analysisRef
					? '\nANALYSES (run_table_process name + args) — exact shapes:\n' + analysisRef + '\nPLOTS (add_plot type + inputs): ' + plotRef
					: '- Call list_capabilities if unsure of names/params.')
		},
		{ role: 'user', content: prompt }
	];

	for (let turn = 0; turn < 20; turn++) {
		const res = await fetch(`${BASE_URL}/chat/completions`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
			body: JSON.stringify({ model: MODEL, messages, tools: oaiTools, tool_choice: 'auto' })
		});
		if (!res.ok) {
			// Providers like Groq validate tool args server-side and 400 with
			// `tool_use_failed` on malformed calls — recover instead of crashing.
			const body = await res.text();
			let parsed;
			try {
				parsed = JSON.parse(body);
			} catch {
				/* not JSON */
			}
			if (res.status === 400 && parsed?.error?.code === 'tool_use_failed') {
				trace.push('tool_use_failed → retry');
				messages.push({
					role: 'user',
					content:
						`Your last tool call was rejected: ${parsed.error.message || 'invalid tool call'}. ` +
						'Tool arguments must be literal JSON (no functions, lambdas, ranges, or code). Do not ' +
						'hand-type numeric arrays — use run_table_process with "SimulatedData" to generate data.'
				});
				continue;
			}
			throw new Error(`LLM HTTP ${res.status}: ${body}`);
		}
		const msg = (await res.json()).choices[0].message;
		messages.push(msg);
		if (!msg.tool_calls?.length) break;
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
async function runScripted({ prompt, call, trace }) {
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
 * @param {{prompt:string, sessionId?:string}} opts
 * @returns {Promise<{json:string, trace:string[], planner:'llm'|'scripted'}>}
 */
export async function buildSession({ prompt, sessionId }) {
	return withMcp(async ({ call, tools }) => {
		const trace = [];
		const planner = API_KEY ? 'llm' : 'scripted';
		await call('create_session', { id: sessionId ?? 'app' });
		trace.push('create_session');
		if (planner === 'llm') await runLlm({ prompt, call, tools, trace });
		else await runScripted({ prompt, call, trace });
		const json = await call('export_session', {}); // canonical AnCiR session JSON
		return { json, trace, planner };
	});
}
