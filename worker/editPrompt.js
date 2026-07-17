// System prompt for editing the session the user already has open.
//
// Difference from draftPrompt.js: that one builds a session from nothing. Here a session
// EXISTS, in the user's browser, and the model may only propose additions to it. The catalogue
// is identical (same registry, same flat args, same series templates) — deliberately, because
// the model is already good at that vocabulary and inventing a second one for edits would throw
// that away. What changes is the contract around it: what exists, what it may touch, and how it
// names a column that doesn't exist yet.
//
// The client compiles this into ops and validates every reference before anything is applied
// (src/lib/utils/aiEdit.js). Nothing here is trusted.

import { buildCatalogue } from './draftPrompt.js';

/** Render the open session so the model can refer to it: names, ids, nothing else. */
export function renderSummary(summary) {
	const cols = (summary?.columns ?? [])
		.map((c) => `  ${c.name}  (${c.type})`)
		.join('\n');
	const analyses = (summary?.analyses ?? [])
		.map((a) => `  #${a.id} ${a.name}  args=${JSON.stringify(a.args ?? {})}`)
		.join('\n');
	const plots = (summary?.plots ?? [])
		.map((p) => `  #${p.id} ${p.type}${p.name ? ` "${p.name}"` : ''}`)
		.join('\n');
	return `CURRENT SESSION

COLUMNS (refer to these by NAME, exactly as written):
${cols || '  (none)'}

ANALYSES (refer to these by #id when changing a parameter):
${analyses || '  (none)'}

PLOTS:
${plots || '  (none)'}`;
}

const FRAME = `You modify an AnCiR session that the user already has open in front of them.

Reply with ONLY a JSON object — no prose, no markdown fence.

SHAPE:
{
  "analyses": [ { "name": "Cosinor", "args": { "xIN": "time", "yIN": ["values"] } } ],
  "plots":    [ { "type": "scatterplot", "name": "Cosinor: data + fit", "series": [
                  { "x": "time",     "y": "values",          "label": "signal",     "kind": "points" },
                  { "x": "cosinorx", "y": "cosinory_values", "label": "signal fit", "kind": "line"   }
              ] } ],
  "changes":  [ { "analysis": 3, "set": { "fixedPeriod": 12 } } ]
}

Every key is optional — emit only what the request needs. To add nothing, reply {}.

WHAT YOU MAY DO:
- "analyses": ADD a new analysis, reading columns that ALREADY EXIST (listed below).
- "plots":    ADD a new plot.
- "changes":  change PARAMETERS of an existing analysis, by its #id.

WHAT YOU MAY NOT DO:
- You cannot delete or replace anything. There is no vocabulary for it. If the user asks you to
  remove something, add nothing and say so is impossible here — just return {}.
- You cannot rename columns, or set "out" (output wiring is handled for you).
- You cannot feed a NEW analysis from another NEW analysis in the same reply. Its output does
  not exist yet. Use a column that already exists, and let the user run it again to chain.

NAMING A COLUMN THAT DOESN'T EXIST YET:
An analysis you add in this reply produces new columns. Refer to them exactly as the catalogue
below describes them:
- a FIXED output by its own name — e.g. "cosinorx";
- a per-Y output as <prefix><the Y column's NAME> — e.g. "cosinory_values" for yIN ["values"]
  (NOT cosinory_1, and NOT the analysis's name).
Anything else will fail to wire and be dropped.

RULES:
- Literal JSON only — never code, functions, ranges or expressions.
- \`args\` is FLAT: input-column fields (xIN, yIN, ...) AND parameters together at the top level.
  Copy the \`args=\` template for the analysis and replace "<col>" with a column NAME. Do NOT
  invent parameter names.
- A series' KEYS are exactly the fields listed for that plot type under PLOTS — scatterplot,
  boxplot and meansem use x/y; actogram, periodogram, fft, correlogram and circularphase use
  time/values; histogram uses column. Copy the \`series=\` template for the type you chose.
- For period fits (Cosinor/FitFunction) keep useFixedPeriod:true and set fixedPeriod to the
  rhythm period in hours (e.g. 24).
- When an analysis lists a "fitted curve", PLOT BOTH: the raw data (x = its own xIN, y = its
  yIN) as points, AND the fit (x = its fitted-curve x, y = its fitted-curve y for that same Y
  column) as a line. The fit's x pairs ONLY with the fit's y.`;

/**
 * @param {object} summary the open session (see summariseSession in src/lib/utils/aiEdit.js)
 * @param {object} [schema] registry-derived catalogue; defaults to the generated one
 */
export function buildEditPrompt(summary, schema) {
	return `${FRAME}\n\n${buildCatalogue(schema)}\n\n${renderSummary(summary)}`;
}
