// @ts-nocheck
// Shared permutation-test support for the dedicated fit nodes (Cosinor, Rectangular wave,
// Double logistic).
//
// The p-value is only the tail probability of a distribution the node already computed in full.
// Reporting the p alone hides how the fit compares with chance: an observed R² that sits just
// past a long tail and one that sits far beyond every permutation both print as "p = 0.001" at
// 999 permutations. These helpers turn the retained null distribution into a tidy table the
// user can view on the canvas or download as CSV.
import { residualAutocorrelationWarning } from '$lib/utils/permutationTest.js';

/**
 * Whether any series in `entries` carries a retained null distribution.
 * @param {Array<{name:string, result:object}>} entries
 */
export function hasPermutationDetail(entries) {
	return (entries ?? []).some((e) => (e?.result?.permStats?.length ?? 0) > 0);
}

/**
 * Tidy-long table of the full permutation results: one row per (series, permutation).
 * The observed statistic and the p-value repeat on every row so a single CSV is
 * self-describing and can be filtered or grouped without a second file.
 *
 * @param {Array<{name:string, result:object}>} entries  one per y series, in display order
 * @returns {{headers:string[], rows:Array<Array<string|number>>}}
 */
export function permutationTableData(entries) {
	const headers = [
		'series',
		'statistic',
		'permutation',
		'permuted_statistic',
		'observed_statistic',
		'p_value',
		// 'shuffle' or 'block' (review FIT-5): the same p means different things under each.
		'scheme'
	];
	const rows = [];
	for (const { name, result } of entries ?? []) {
		const stats = result?.permStats ?? [];
		if (!stats.length) continue;
		for (let i = 0; i < stats.length; i++) {
			rows.push([
				name,
				result.permStatistic ?? 'rSquared',
				i + 1,
				stats[i],
				result.observedStat ?? null,
				result.pValue ?? null,
				result.permScheme ?? 'shuffle'
			]);
		}
	}
	return { headers, rows };
}

/** The title of a node's permutations table (the Table it spawns and its result-table list). */
export function permutationTableTitle(label) {
	return `${label}: permutations`;
}

/**
 * The permutations table for a node's live result tables (core/nodeResultTables): the same
 * rows as permutationTableData, or null while no series carries a retained distribution, so a
 * Table showing it keeps its snapshot rather than going blank before the test has run.
 */
export function permutationResultTable(entries) {
	return hasPermutationDetail(entries) ? permutationTableData(entries) : null;
}

/**
 * Copy the permutation outcome off a fitPermutationPValue() result onto a y result, under the
 * names the panels and permutationTableData read. Keeps the three fit nodes in step.
 * @param {object} target  the y result object to annotate (mutated)
 * @param {object} perm    a fitPermutationPValue() return value
 */
export function attachPermutation(target, perm) {
	target.pValue = perm?.pValue ?? NaN;
	target.significant = perm?.significant ?? false;
	target.observedStat = perm?.observedStat ?? NaN;
	target.permStats = perm?.permutedStats ?? [];
	target.permStatistic = perm?.statistic ?? 'rSquared';
	// How the null was built (review FIT-5): 'shuffle' (single values; assumes exchangeable
	// observations) or 'block' (one-period circular blocks), the block length in samples,
	// the observed fit's residual lag-1 autocorrelation, and why a block test did not run.
	target.permScheme = perm?.scheme ?? 'shuffle';
	target.permBlockLength = perm?.blockLength ?? null;
	target.permResidualLag1 = perm?.residualLag1 ?? NaN;
	target.permUnavailable = perm?.unavailable ?? null;
	return target;
}

/**
 * The readout's name for how the permutation null was built.
 * @param {object} result  a y result annotated by attachPermutation
 */
export function permutationSchemeLabel(result) {
	if (result?.permScheme === 'block') {
		const L = result.permBlockLength;
		return Number.isFinite(L) ? `one-period blocks of ${L} samples` : 'one-period blocks';
	}
	return 'single values shuffled';
}

/**
 * Validity warnings for a fit's significance tests (review finding FIT-5): a block
 * permutation test that could not run, and strongly autocorrelated residuals under a test
 * that assumes independent observations (the shuffle permutation test and, with
 * `fTest`, the cosinor zero-amplitude F-test). Shared by Cosinor, Fit waveform model,
 * Fit trend, Rectangular wave and Double logistic.
 *
 * @param {object|null} perm  a fitPermutationPValue() result, or null when no test ran
 * @param {ArrayLike<number>} residuals  observed minus fitted, on the fitted pairs
 * @param {string} label  the series, e.g. '"activity"'
 * @param {{fTest?: boolean, remedy?: string}} [opts]
 * @returns {string[]}
 */
export function permutationValidityWarnings(perm, residuals, label, opts = {}) {
	const out = [];
	if (perm?.unavailable) {
		out.push(
			`The block permutation test for ${label} did not run: ${perm.unavailable}. Use a longer record, or the shuffle scheme with care.`
		);
	}
	const ranShuffle = !!perm && !perm.unavailable && (perm.scheme ?? 'shuffle') === 'shuffle';
	const fTest = !!opts.fTest;
	if (!ranShuffle && !fTest) return out;
	const test =
		ranShuffle && fTest
			? 'The F-test and permutation p-values'
			: fTest
				? 'The F-test p-value'
				: 'The permutation p-value';
	const w = residualAutocorrelationWarning(residuals, {
		label,
		test,
		plural: ranShuffle && fTest,
		...(opts.remedy ? { remedy: opts.remedy } : {})
	});
	if (w) out.push(w);
	return out;
}
