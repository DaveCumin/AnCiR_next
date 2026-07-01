// Model-agnostic MCP client for the AnCiR server.
//
// Demonstrates driving AnCiR's tools from *any* LLM that speaks the OpenAI
// chat-completions + function-calling format — which today covers OpenAI, Google
// Gemini (via its OpenAI-compatible endpoint), and local servers like Ollama and
// LM Studio. It connects to the AnCiR MCP over stdio, translates the MCP tool
// schemas into OpenAI `tools`, and runs a tool-calling loop.
//
// Usage (from mcp/):
//   # No key — "dry-run": prints the translated tool schemas and runs a scripted
//   # tool sequence so you can verify the bridge + server without an LLM.
//   node test/agnostic-client.mjs
//
//   # With any OpenAI-compatible endpoint:
//   OPENAI_API_KEY=sk-...                       node test/agnostic-client.mjs   # OpenAI
//   OPENAI_BASE_URL=http://localhost:11434/v1 MODEL=llama3.1 \
//     OPENAI_API_KEY=ollama                     node test/agnostic-client.mjs   # Ollama
//   OPENAI_BASE_URL=http://localhost:1234/v1 OPENAI_API_KEY=lm-studio \
//     MODEL=your-model                          node test/agnostic-client.mjs   # LM Studio
//   OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai \
//     OPENAI_API_KEY=$GEMINI_API_KEY MODEL=gemini-2.0-flash \
//     node test/agnostic-client.mjs                                             # Gemini
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
// Local servers (Ollama/LM Studio) don't need a key; setting OPENAI_BASE_URL is
// enough to enter live mode (a dummy key satisfies the Authorization header).
const API_KEY = process.env.OPENAI_API_KEY || (process.env.OPENAI_BASE_URL ? 'local' : '');
const MODEL = process.env.MODEL || 'gpt-4o-mini';

const TASK =
	process.env.TASK ||
	'Create a session, then GENERATE a synthetic 24-hour rhythm over 2 days using the SimulatedData ' +
		'analysis (do not type numeric arrays). Fit a Cosinor to the generated time/values, add a ' +
		'scatterplot, and export the session to /tmp/agnostic-llm-session.json. Report the recovered ' +
		'period and amplitude.';

// --- connect to the AnCiR MCP over stdio ------------------------------------
const transport = new StdioClientTransport({
	command: 'npx',
	args: ['vite-node', 'src/server.js'],
	cwd: process.cwd(),
	stderr: 'inherit'
});
const mcp = new Client({ name: 'agnostic-client', version: '0.0.1' });
await mcp.connect(transport);

const { tools: mcpTools } = await mcp.listTools();

// Translate MCP tools → OpenAI function-calling format (the de-facto standard).
const oaiTools = mcpTools.map((t) => ({
	type: 'function',
	function: {
		name: t.name,
		description: t.description,
		parameters: t.inputSchema || { type: 'object', properties: {} }
	}
}));

const callMcp = async (name, args) => {
	const res = await mcp.callTool({ name, arguments: args || {} });
	return res.content?.map((c) => c.text ?? '').join('\n') ?? '';
};

// --- dry-run mode (no API key): prove the bridge + server, no LLM needed ------
if (!API_KEY) {
	console.log(`No OPENAI_API_KEY set — DRY RUN (bridge + server only).\n`);
	console.log(`Translated ${oaiTools.length} MCP tools into OpenAI function schemas:`);
	for (const t of oaiTools) console.log(`  • ${t.function.name}: ${t.function.description.slice(0, 70)}…`);

	console.log('\nRunning a scripted tool sequence (what an LLM would call):');
	await callMcp('create_session', { id: 'agnostic-dry' });
	const t = [];
	const y = [];
	for (let i = 0; i < 48; i++) {
		t.push(i);
		y.push(10 + 5 * Math.cos((2 * Math.PI * i) / 24));
	}
	await callMcp('import_data', { columns: [{ name: 'time_h', values: t }, { name: 'signal', values: y }] });
	const fit = JSON.parse(await callMcp('run_table_process', { name: 'Cosinor', args: { xIN: 0, yIN: [1], useFixedPeriod: true, fixedPeriod: 24 } }));
	await callMcp('add_plot', { type: 'scatterplot', inputs: { x: 0, y: 1 } });
	const exp = JSON.parse(await callMcp('export_session', { path: '/tmp/agnostic-llm-session.json' }));
	const o = fit.outputs.find((o) => o.length === 48) || fit.outputs[0];
	console.log(`  cosinor valid=${fit.valid}, fitted-curve column "${o?.name}" len=${o?.length}`);
	console.log(`  exported ${exp.bytes} bytes → ${exp.written}`);
	console.log('\nDRY RUN OK ✅  (set OPENAI_API_KEY / OPENAI_BASE_URL to drive a real model)');
	await mcp.close();
	process.exit(0);
}

// --- live mode: tool-calling loop against the configured model ---------------
console.log(`Driving ${MODEL} at ${BASE_URL} with ${oaiTools.length} AnCiR tools.\n`);

// Fetch the real analysis/plot parameter shapes and embed them, so the model uses
// exact arg names instead of guessing (run_table_process's `args` is a free-form
// object with no per-analysis schema the model could otherwise see).
const caps = JSON.parse(await callMcp('list_capabilities', {}));
// Show ONE flat `args` object per analysis (input-column fields + params together),
// so the model doesn't nest them under "inputs"/"params".
const argsTemplate = (a) => {
	const t = {};
	for (const f of a.inputs?.scalar ?? []) t[f] = '<col>';
	for (const f of a.inputs?.array ?? []) t[f] = ['<col>'];
	Object.assign(t, a.params);
	// Free-period fitting is unreliable on a time axis; a known-period rhythm should
	// use a fixed period, so surface that as the working default in the template.
	if ('useFixedPeriod' in t) t.useFixedPeriod = true;
	return t;
};
const analysisRef = caps.analyses
	.map((a) => `  ${a.id}: args=${JSON.stringify(argsTemplate(a))}`)
	.join('\n');
const plotRef = caps.plots.map((p) => `${p.id}[${(p.inputs || []).join(',')}]`).join(', ');

const messages = [
	{
		role: 'system',
		content:
			'You are a chronobiology analyst. Use the provided AnCiR tools to complete the task, then stop.\n' +
			'RULES for tool arguments (critical):\n' +
			'- Arguments must be LITERAL JSON only. Never put code, functions, lambdas, ranges, or expressions ' +
			'in an argument. `values` must be a real array of numbers like [0,1,2], not {"function":...}.\n' +
			'- run_table_process takes {name, args}. `args` is a FLAT object: the input-column fields ' +
			'(xIN, yIN, …) AND the parameters together at the TOP LEVEL. Do NOT nest them under "inputs" or ' +
			'"params". Copy the `args=` template for the analysis below verbatim, replacing "<col>" with a ' +
			'column name; keep nested values like SimulatedData.sections. Do NOT invent parameter names.\n' +
			'- Do NOT hand-type long numeric arrays. To create synthetic data, use run_table_process with ' +
			'"SimulatedData" (a rhythm+noise generator) or "SequenceColumn"/"Random". Use import_data only ' +
			'for small data the user gives explicitly, as literal number arrays.\n' +
			'- For period fits (Cosinor/FitFunction) set useFixedPeriod:true and fixedPeriod to the rhythm ' +
			'period in hours (e.g. 24); free-period mode is unreliable on time-axis data.\n' +
			'- For column references (xIN, yIN, plot inputs, columnId) pass the column NAME (e.g. "time_0", ' +
			'"values_0") instead of a numeric id — STRONGLY PREFERRED, it avoids id mistakes. Read exact names ' +
			'from the tool result that created them (each output lists {columnId, name}) or from list_columns.\n' +
			'\nANALYSES (run_table_process name + args) — exact shapes:\n' +
			analysisRef +
			'\nPLOTS (add_plot type + inputs): ' +
			plotRef
	},
	{ role: 'user', content: TASK }
];

async function chat() {
	const res = await fetch(`${BASE_URL}/chat/completions`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
		body: JSON.stringify({ model: MODEL, messages, tools: oaiTools, tool_choice: 'auto' })
	});
	if (res.ok) return { message: (await res.json()).choices[0].message };
	// Some providers (e.g. Groq) validate tool args server-side and return 400
	// `tool_use_failed` when the model emits malformed arguments. Recover instead of
	// crashing: nudge the model and let it retry on the next turn.
	const body = await res.text();
	let parsed;
	try {
		parsed = JSON.parse(body);
	} catch {
		/* not JSON */
	}
	if (res.status === 400 && parsed?.error?.code === 'tool_use_failed') return { toolUseFailed: parsed.error.message || 'invalid tool call' };
	throw new Error(`LLM HTTP ${res.status}: ${body}`);
}

for (let turn = 0; turn < 15; turn++) {
	const { message: msg, toolUseFailed } = await chat();
	if (toolUseFailed) {
		console.log('⚠ model produced an invalid tool call — nudging it and retrying');
		messages.push({
			role: 'user',
			content:
				`Your last tool call was rejected: ${toolUseFailed}. Tool arguments must be literal JSON ` +
				'(no functions, lambdas, ranges, or code). Do not hand-type numeric arrays — use ' +
				'run_table_process with "SimulatedData" to generate time-series data instead.'
		});
		continue;
	}
	messages.push(msg);
	if (msg.tool_calls?.length) {
		for (const tc of msg.tool_calls) {
			const args = JSON.parse(tc.function.arguments || '{}');
			console.log(`→ ${tc.function.name}(${JSON.stringify(args).slice(0, 120)})`);
			let content;
			try {
				content = await callMcp(tc.function.name, args);
			} catch (e) {
				content = `ERROR: ${e.message}`;
			}
			messages.push({ role: 'tool', tool_call_id: tc.id, content: content.slice(0, 4000) });
		}
		continue;
	}
	console.log('\n=== MODEL FINAL ANSWER ===\n' + (msg.content ?? '(no content)'));
	break;
}

await mcp.close();
process.exit(0);
