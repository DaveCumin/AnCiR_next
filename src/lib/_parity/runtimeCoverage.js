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
 * Analyses with no Python port, as of 2026-07-28.
 *
 * This list may SHRINK, never grow: the guard fails if a JS analysis is missing from Python
 * and is not listed here, which is what stops a ninth from being added by accident. Each
 * entry is a real gap someone should close, not a decision that Python need not have it.
 */
export const PYTHON_GAPS = [
	'chisquared',
	'columnset',
	'correlation',
	'crosscorrelation',
	'describedata',
	'interpolate',
	'logisticregression',
	'normalitytest'
];

/**
 * Table processes the R port implements.
 *
 * EMPTY, deliberately, and the guard checks it in both directions so it cannot lie. R is
 * being ported deliberately rather than all at once, and the pure numeric kernels come
 * first: they are the shared foundation every table process sits on, and they are what the
 * fixtures actually exercise (43 of 68). Session plumbing follows.
 *
 * The list GROWS as analyses are ported. Every entry must be a real JS analysis (so a typo
 * fails loudly rather than silently exempting something) and must actually be present in
 * ancir_runtime.R (so claiming one you have not written fails).
 */
export const R_IMPLEMENTED = [];

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
