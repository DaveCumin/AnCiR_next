// Builds the LLM system prompt for the STATIC (non-MCP) path.
//
// Difference from app/promptBuilder.js: that prompt drives MCP *tool calls* over a live
// engine. Here the model emits ONE JSON "draft" in a single shot, which the pure normalizer
// turns into a session — no engine, so this runs in a Worker. The tool-argument rules are the
// same in spirit as app/prompts/tool-rules.md (flat args, reference-by-name, generate-don't-
// type, fixed-period); they're restated here against the draft contract rather than the tools.
//
// The catalogue is REGISTRY-DERIVED (session-schema.generated.json), so the node list, params
// and output names can't drift from AnCiR — the same guarantee that fixed the cosinorx class
// of bug. Regenerate with: vite-node src/emit/gen-schema.js

import generated from '../src/emit/session-schema.generated.json' with { type: 'json' };

/** One flat `args` object per node: input-column fields + params together. */
function argsTemplate(node) {
	const t = {};
	for (const f of node.inputs.scalar ?? []) t[f] = '<col>';
	for (const f of node.inputs.array ?? []) t[f] = ['<col>'];
	Object.assign(t, node.params ?? {});
	// Free-period fitting is unreliable on a time axis — surface the working default.
	if ('useFixedPeriod' in t) t.useFixedPeriod = true;
	return t;
}

/**
 * The node + plot catalogue. Each node lists its flat args template and the NAMES of the
 * columns it produces — the model needs those to wire later analyses and plots.
 */
export function buildCatalogue(schema = generated) {
	const nodes = Object.entries(schema.nodes)
		.map(([name, n]) => {
			const outs = n.fixedOut.length ? ` -> produces: ${n.fixedOut.join(', ')}` : '';
			return `  ${name}: args=${JSON.stringify(argsTemplate(n))}${outs}`;
		})
		.join('\n');
	const plots = Object.entries(schema.plots)
		.map(([type, p]) => `${type}[${(p.inputs ?? []).join(',')}]`)
		.join(', ');
	return `ANALYSES (exact args):\n${nodes}\n\nPLOTS (type + inputs): ${plots}`;
}

const FRAME = `You turn a chronobiology request into ONE JSON object describing an AnCiR session.

Reply with ONLY the JSON object — no prose, no markdown fence.

SHAPE:
{
  "columns":  [ { "name": "hour", "values": [0,1,2] } ],          // optional: literal input data
  "analyses": [ { "name": "Cosinor", "args": { "xIN": "hour", "yIN": ["signal"] } } ],
  "plots":    [ { "type": "scatterplot", "name": "Signal", "inputs": { "x": "hour", "y": "signal" } } ]
}

RULES:
- Literal JSON only — never code, functions, ranges or expressions.
- \`args\` is FLAT: input-column fields (xIN, yIN, ...) AND parameters together at the top level.
  Do NOT nest under "inputs"/"params". Copy the \`args=\` template for the analysis and replace
  "<col>" with a column NAME. Do NOT invent parameter names.
- Reference every column by NAME (never a number). Names come from your own "columns", or from
  an earlier analysis's outputs — each node lists what it "produces" (e.g. SimulatedData
  produces "time" and "values"; SequenceColumn produces "result").
- Do NOT pass "out" — output columns are allocated automatically.
- Do NOT hand-type long numeric arrays. To make synthetic data use the SimulatedData analysis
  (rhythm + noise) or SequenceColumn. Use "columns" only for small data the user gives you.
- \`analyses\` run in order: put a generator before the analysis that reads it.
- For period fits (Cosinor/FitFunction) keep useFixedPeriod:true and set fixedPeriod to the
  rhythm period in hours (e.g. 24); free-period mode is unreliable on time-axis data.
- Include at least one plot so the user can see the result, unless asked otherwise.`;

/** Full system prompt: contract + registry-derived catalogue. */
export function buildDraftPrompt(schema = generated) {
	return `${FRAME}\n\n${buildCatalogue(schema)}`;
}
