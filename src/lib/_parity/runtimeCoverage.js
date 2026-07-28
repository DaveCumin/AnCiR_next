/**
 * Which analyses each language runtime implements, and which it is allowed not to.
 *
 * AnCiR's engine exists three times over: the JS one the app runs, the Python port in
 * `tools/ancir_runtime.py`, and the R port in `tools/ancir_runtime.R`. Three sources of
 * truth drift, and the drift is silent in the one direction the parity fixtures cannot
 * catch: an analysis with NO port has no fixture, so nothing fails.
 *
 * That is not hypothetical. `tools/check_tp_coverage.py` has always exited non-zero on a
 * missing Python implementation, but it was wired into nothing — no npm script, no test, no
 * CI step — so nobody ran it, and the Python port silently fell eight analyses behind.
 * PYTHON_GAPS below is that debt, written down.
 *
 * This module is the data; runtimeCoverage.test.js is the guard. It runs in the normal
 * vitest suite (no Python or R toolchain required) so it cannot be skipped by not having an
 * environment set up.
 */

/**
 * Analyses that no language runtime implements because there is nothing to implement.
 *
 * ColumnSet curates a live subset of columns and emits NO output columns of its own
 * (nodeSpec.outputs is empty). Its selection is materialised into each consumer's real
 * inputs by syncTPSets while the session is being edited, so by the time a session is saved
 * or exported the consumers already hold concrete column ids. A runtime never sees a
 * Column Set that still needs resolving.
 *
 * Kept separate from PYTHON_GAPS on purpose: "nothing to do" and "somebody still has to do
 * this" are different states, and merging them is how real debt gets forgotten.
 */
export const NOT_APPLICABLE = ['columnset'];

/**
 * Analyses with no Python port.
 *
 * EMPTY as of 2026-07-28. It was eight — ChiSquared, Correlation, CrossCorrelation,
 * DescribeData, Interpolate, LogisticRegression, NormalityTest and ColumnSet — because
 * `tools/check_tp_coverage.py` exited non-zero on exactly this condition but was wired into
 * nothing, so nobody ran it. Seven have since been ported and the eighth (ColumnSet) turned
 * out to be NOT_APPLICABLE rather than missing.
 *
 * This list may grow only with a deliberate decision, never by accident: the guard fails on
 * any JS analysis that is absent from both this list and the runtime.
 */
export const PYTHON_GAPS = [];

/**
 * Dispatch entries the Python port has for analyses the app does NOT have.
 *
 * The coverage check only ever ran one way — "does every JS analysis have a port?" — so an
 * entry left behind by a REMOVED node was invisible. `duplicate` is one: there is no
 * Duplicate.svelte, and hunting for it is how this was found. Dead rather than dangerous, but
 * it costs bundle-free maintenance effort and misleads anyone reading the map as the list of
 * what AnCiR can do.
 *
 * Recorded rather than deleted, because removing runtime code is the owner's call. The guard
 * stops the list growing.
 */
export const PYTHON_ORPHANS = ['duplicate'];

/**
 * Table processes the R port implements.
 *
 * Checked in both directions so it cannot lie. R is being ported deliberately rather than
 * all at once: the pure numeric kernels came first (they are the shared foundation every
 * analysis sits on), then the session plumbing, and analyses are added in verified batches.
 *
 * The R runtime is STRICT — an analysis absent from this list aborts the exported script
 * rather than being skipped — so this list is also the contract the export button checks
 * before it will produce a script at all.
 *
 * The list GROWS as analyses are ported. Every entry must be a real JS analysis (so a typo
 * fails loudly rather than silently exempting something) and must actually be present in
 * ancir_runtime.R (so claiming one you have not written fails).
 */
export const R_IMPLEMENTED = [
	'averageprofile',
	'chisquared',
	'collectcolumns',
	'columnfunctions',
	'correlation',
	'binneddata',
	'cosinor',
	'crosscorrelation',
	'describedata',
	'interpolate',
	'logisticregression',
	'longtowide',
	'nonparametricra',
	'normalitytest',
	'smootheddata',
	'sort',
	'split',
	'threshold',
	'trendfit',
	'widetolong'
];

/**
 * Column processes the R port implements, keyed as the runtime registers them.
 *
 * Ported early on purpose: a column carrying ANY transform hits the strict dispatcher, so
 * without these the runtime refuses most real sessions however many analyses it has.
 */
export const R_COLUMN_PROCESSES = [
	'add',
	'multiply',
	'normalize',
	'removetrend',
	'sub',
	'substitute'
];

/**
 * Analyses that are IMPLEMENTED but cannot be checked by the parity harness.
 *
 * These nodes decide their output-column KEYS at runtime — from a category value, a source
 * column id, or a segment index — and create the columns in the Svelte component's reconcile
 * rather than in `func`. Running `func` headlessly therefore produces nothing to compare: the
 * harness sees an empty result and cannot tell a correct port from a broken one.
 *
 * MovingAnalysis was already known to have this shape (its fixture targets the pure windowing
 * function instead). Split, LongToWide and CollectColumns turned out to be the same when
 * fixtures were attempted for them.
 *
 * Listed so that "implemented" is never silently read as "verified". Closing this properly
 * means moving output-column creation out of the components, which is a bigger change than
 * the port.
 */
export const HARNESS_BLIND = ['collectcolumns', 'longtowide', 'movinganalysis', 'split'];

/**
 * Pure numeric kernels the R port implements, keyed as the parity fixtures name them.
 *
 * These are the ones where a hand port is most likely to be subtly wrong — the bias
 * conventions on skewness and kurtosis, the biased-vs-corrected moments inside the
 * normality tests, and the tie handling in Spearman — so they are the ones worth checking
 * against a third implementation rather than assuming.
 */
export const R_PURE_UTILS = [
	'correlate',
	'correlation_ci',
	'cross_correlation',
	'd_agostino',
	'describe_stats',
	'jarque_bera',
	'p_adjust',
	'shapiro_wilk'
];

export function tpKey(filename) {
	return filename.replace(/\.svelte$/, '').toLowerCase();
}

/**
 * Parse a flat dispatch table out of a runtime source file, in either language's syntax:
 * Python's `NAME = { 'key': fn, ... }` or R's `NAME <- list(key = fn, ...)`.
 *
 * Deliberately textual: vitest cannot import a Python or R module, and the table is a flat
 * literal in both, so a delimiter-matched scan is exact enough to trust and cheap enough to
 * run on every suite. R keys are usually bare identifiers rather than quoted, so both forms
 * are accepted.
 *
 * Returns null when the table is absent — NOT an empty array, which would read as
 * "implements nothing" and could silently satisfy a subset check.
 */
export function parseDispatchKeys(source, tableName) {
	const m = new RegExp(`${tableName}\\s*(?:=|<-)\\s*(list\\(|\\{)`).exec(source);
	if (!m) return null;
	const open = m[1] === 'list(' ? '(' : '{';
	const close = open === '(' ? ')' : '}';
	let i = m.index + m[0].length - 1;
	const from = i;
	let depth = 0;
	for (; i < source.length; i++) {
		if (source[i] === open) depth++;
		else if (source[i] === close) {
			depth--;
			if (depth === 0) break;
		}
	}
	const body = source.slice(from, i);
	// Quoted ('key': fn / 'key' = fn) or bare R identifiers (key = fn).
	return [...body.matchAll(/['"]?\b([a-z][a-z0-9_]*)['"]?\s*[:=](?!=)/g)].map((x) => x[1]);
}
