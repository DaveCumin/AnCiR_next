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
/**
 * The per-Y columns a node makes, named the way the MODEL must write them.
 *
 * 'prefix' nodes are covered by the fitted-curve line. 'suffix' nodes (RhythmicityAnalysis) key
 * their outputs `${yid}_${suffix}` with a suffix set chosen by a couple of discrete params, and
 * used to advertise nothing at all — which is how a model asked for a periodogram had no column
 * it could legitimately name. The suffix table is baked from the node's own key helper, so this
 * says what the node will really produce for the args shown.
 */
function perYOutputs(node) {
	if (node.dynamicKind !== 'suffix' || !node.suffixesBy) return '';
	const params = node.params ?? {};
	const key = (node.discriminators ?? []).map((d) => params[d]).join('|');
	const suffixes = node.suffixesBy[key];
	if (!suffixes?.length) return '';
	const shown = suffixes.map((s) => `<your Y column>_${s}`).join(', ');
	const by = (node.discriminators ?? []).map((d) => `${d}=${params[d]}`).join(', ');
	return ` -> produces per Y column: ${shown}  (for ${by}; other values give other columns)`;
}

export function buildCatalogue(schema = generated) {
	const nodes = Object.entries(schema.nodes)
		.map(([name, n]) => {
			const outs = n.fixedOut.length ? ` -> produces: ${n.fixedOut.join(', ')}` : '';
			// A fitted-curve node's X grid and Y curve must be plotted as a PAIR.
			const fit = n.fitOut
				? ` -> fitted curve: x=${n.fitOut.x}, y=${n.fitOut.yPrefix}<your Y column>`
				: '';
			return `  ${name}: args=${JSON.stringify(argsTemplate(n))}${outs}${fit}${perYOutputs(n)}`;
		})
		.join('\n');
	// Render plots the way analyses are rendered: one per line, with a CONCRETE series template.
	// The old one-line `type[a,b]` list carried the same names, but next to a worked x/y example
	// it was too easy to skim past, and a model that emitted {x,y} for an actogram (ports
	// time/values) got its plot dropped. Only scatterplot, boxplot and meansem take x/y; most
	// take time/values, and histogram takes `column`.
	//
	// These are the PUBLIC PORT names — what the UI calls each input. They are NOT what the plot
	// classes store (two-input plots persist x/y; see normalizer.js storageField). The prompt
	// deliberately speaks the port vocabulary and lets the normalizer translate, so this stays
	// the language a person reading the session would recognise.
	const plots = Object.entries(schema.plots)
		.map(([type, p]) => {
			const fields = p.inputs ?? [];
			if (!fields.length) {
				// tableplot/dataview take a bare column list rather than series.
				return `  ${type}: inputs=["<col>", …]  (a plain list of columns, not series)`;
			}
			const t = Object.fromEntries(fields.map((f) => [f, '<col>']));
			return `  ${type}: series=[${JSON.stringify(t)}]`;
		})
		.join('\n');
	return `ANALYSES (exact args):\n${nodes}\n\nPLOTS (exact series fields):\n${plots}`;
}

const FRAME = `You turn a chronobiology request into ONE JSON object describing an AnCiR session.

Reply with ONLY the JSON object — no prose, no markdown fence.

SHAPE:
{
  "columns":  [ { "name": "hour", "values": [0,1,2] } ],          // optional: literal input data
  "analyses": [ { "name": "Cosinor", "args": { "xIN": "hour", "yIN": ["signal"] } } ],
  "plots":    [ { "type": "scatterplot", "name": "Cosinor: data + fit", "series": [
                  { "x": "hour",     "y": "signal",          "label": "signal",     "kind": "points" },
                  { "x": "cosinorx", "y": "cosinory_signal", "label": "signal fit", "kind": "line"   }
              ] } ]
}

A plot holds a LIST of series, so raw data and a fitted curve go on the SAME plot. Use
"kind":"points" for measured data and "kind":"line" for a fit. (A one-series plot may instead
use the shorthand "inputs": {...} with the same fields as one series.)

A series' KEYS ARE NOT ALWAYS x/y — they are exactly the fields listed for that plot type under
PLOTS below. The example above is a scatterplot, which happens to use x/y. An actogram does NOT:

  { "type": "actogram", "name": "Binned profile",
    "series": [ { "time": "binnedx", "values": "binnedy_activity" } ] }

Copy the \`series=\` template for the plot type you chose and replace "<col>" with a column NAME.

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
- Include at least one plot so the user can see the result, unless asked otherwise.
- When an analysis lists a "fitted curve" below, PLOT BOTH: the raw data (x = the analysis's
  own xIN, y = its yIN) as points, AND the fit (x = its fitted-curve x, y = its fitted-curve y
  for that same Y column) as a line. The fit's x pairs ONLY with the fit's y — never plot the
  fitted x against the raw y, or the curve will be meaningless.`;

/** Full system prompt: contract + registry-derived catalogue. */
export function buildDraftPrompt(schema = generated) {
	return `${FRAME}\n\n${buildCatalogue(schema)}`;
}
