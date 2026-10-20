// The Boxplot's significance-bar methods: ONE list, read by the Boxplot's own dropdown, the
// multi-select panel and the AI/MCP editor (both through Boxplotclass.descriptors.sigMethod).
//
// Two lists used to exist. The Boxplot's dropdown offered `auto / kruskal`; the multi-select
// descriptor offered `auto / tukey / ttest / mannwhitney`, values the dropdown could not show.
// Only two behaviours were ever behind them (Boxplot.svelte resolveSigMethod): parametric
// (Welch's t-test for two groups, one-way ANOVA then Tukey-Kramer for more) and non-parametric
// (Mann-Whitney for two groups, pairwise Mann-Whitney with Holm's adjustment for more). 'tukey'
// and 'ttest' already ran the parametric tests and 'mannwhitney' the non-parametric ones.
//
// The saved values stay `auto` and `kruskal` (every demo saves `auto`), so nothing saved
// changes meaning; the multi-select's old values are read as the method they always ran.

/** @type {ReadonlyArray<{ value: string, label: string }>} */
export const SIG_METHODS = Object.freeze([
	Object.freeze({ value: 'auto', label: 'Parametric (t-test, or ANOVA with Tukey-Kramer)' }),
	Object.freeze({ value: 'kruskal', label: 'Non-parametric (Mann-Whitney)' })
]);

export const SIG_METHOD_VALUES = Object.freeze(SIG_METHODS.map((m) => m.value));
export const SIG_METHOD_LABELS = Object.freeze(SIG_METHODS.map((m) => m.label));
export const SIG_METHOD_DEFAULT = 'auto';

// Values earlier builds could save (the multi-select panel's list, and the class comment's
// 'anova'), each mapped to the method it actually ran.
const LEGACY_SIG_METHODS = Object.freeze({
	tukey: 'auto',
	ttest: 'auto',
	anova: 'auto',
	mannwhitney: 'kruskal'
});

/**
 * A saved significance method as one of SIG_METHOD_VALUES: a current value as is, an old one
 * as the method it ran, anything else (missing, corrupt) as the default.
 * @param {unknown} method
 * @returns {string}
 */
export function normaliseSigMethod(method) {
	if (typeof method !== 'string') return SIG_METHOD_DEFAULT;
	if (SIG_METHOD_VALUES.includes(method)) return method;
	return LEGACY_SIG_METHODS[method] ?? SIG_METHOD_DEFAULT;
}

/** Whether a (normalised or legacy) method runs the non-parametric tests. */
export function isNonParametricSigMethod(method) {
	return normaliseSigMethod(method) === 'kruskal';
}
