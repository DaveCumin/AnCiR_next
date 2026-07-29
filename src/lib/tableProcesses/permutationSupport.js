// @ts-nocheck
// Shared permutation-test support for the dedicated fit nodes (Cosinor, Rectangular wave,
// Double logistic).
//
// The p-value is only the tail probability of a distribution the node already computed in full.
// Reporting the p alone hides how the fit compares with chance: an observed R² that sits just
// past a long tail and one that sits far beyond every permutation both print as "p = 0.001" at
// 999 permutations. These helpers turn the retained null distribution into a tidy table the
// user can view on the canvas or download as CSV.

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
		'p_value'
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
				result.pValue ?? null
			]);
		}
	}
	return { headers, rows };
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
	return target;
}
