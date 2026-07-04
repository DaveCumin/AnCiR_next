<script module>
	import { normalizeYInputs, migrateLegacyYIN } from '$lib/tableProcesses/tpArgHelpers.js';
	// @ts-nocheck
	import { mean, sampleVariance, sampleStd, median } from '$lib/utils/sampleStats.js';
	import { getColumnById } from '$lib/core/Column.svelte';
	import cdf_f from '@stdlib/stats-base-dists-f-cdf';
	import cdf_chisq from '@stdlib/stats-base-dists-chisquare-cdf';
	import tQuantile from '@stdlib/stats-base-dists-t-quantile';

	const displayName = 'Compare groups (stats)';
	const defaults = new Map([
		['xIN', { val: -1 }],
		['yIN', { val: [] }],
		['method', { val: 'auto' }], // auto | ttest | anova | mannwhitney | kruskal
		['alpha', { val: 0.05 }],
		['postHocEnabled', { val: true }],
		['out', {}],
		['valid', { val: false }],
		['forcollected', { val: false }],
		['collectedType', { val: 'groupcomparison' }]
	]);

	export const definition = {
		displayName,
		defaults,
		func: groupcomparison,
		columnIdFields: { scalar: ['xIN'], array: ['yIN'] },
		nodeSpec: {
			id: 'tableprocess.groupcomparison',
			inputs: [
				{ name: 'xIN', kind: 'column', cardinality: 'one' },
				{ name: 'yIN', kind: 'column', cardinality: 'many' }
			],
			outputs: []
		}
	};

	function safePUpperFromF(fValue, df1, df2) {
		if (!Number.isFinite(fValue) || !Number.isFinite(df1) || !Number.isFinite(df2)) return NaN;
		if (df1 <= 0 || df2 <= 0 || fValue < 0) return NaN;
		return 1 - cdf_f(fValue, df1, df2);
	}

	function safePUpperFromChiSq(xValue, df) {
		if (!Number.isFinite(xValue) || !Number.isFinite(df)) return NaN;
		if (xValue < 0 || df <= 0) return NaN;
		return 1 - cdf_chisq(xValue, df);
	}

	function buildGroups(groupData, yData) {
		const buckets = new Map();
		for (let i = 0; i < yData.length; i++) {
			const gRaw = groupData?.[i];
			const yRaw = yData?.[i];
			if (gRaw == null || yRaw == null || Number.isNaN(yRaw)) continue;
			const g = String(gRaw);
			if (!buckets.has(g)) buckets.set(g, []);
			buckets.get(g).push(Number(yRaw));
		}
		return Array.from(buckets.entries()).map(([name, values]) => {
			const n = values.length;
			const m = mean(values);
			const sd = sampleStd(values);
			return { name, values, n, mean: m, sd };
		});
	}

	function buildGroupsFromYColumns(yINs) {
		const groups = [];
		for (const yId of yINs) {
			if (yId == null || yId === -1) continue;
			const yCol = getColumnById(yId);
			if (!yCol) continue;
			const values = (yCol.getData() ?? [])
				.filter((v) => v != null && !Number.isNaN(v))
				.map(Number);
			if (!values.length) continue;
			groups.push({
				name: yCol.name || String(yId),
				values,
				n: values.length,
				mean: mean(values),
				sd: sampleStd(values)
			});
		}
		return groups;
	}

	function rankWithTies(values) {
		const indexed = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
		const ranks = new Array(values.length);
		const tieCounts = [];
		let pos = 1;
		let i = 0;
		while (i < indexed.length) {
			let j = i + 1;
			while (j < indexed.length && indexed[j].v === indexed[i].v) j++;
			const count = j - i;
			const avgRank = (2 * pos + count - 1) / 2;
			for (let k = i; k < j; k++) ranks[indexed[k].i] = avgRank;
			if (count > 1) tieCounts.push(count);
			pos += count;
			i = j;
		}
		return { ranks, tieCounts };
	}

	function holmAdjust(pairs) {
		const n = pairs.length;
		const sorted = pairs
			.map((p, idx) => ({ ...p, _idx: idx }))
			.sort((a, b) => (a.pValue ?? Infinity) - (b.pValue ?? Infinity));
		let running = 0;
		for (let i = 0; i < sorted.length; i++) {
			const raw = Number.isFinite(sorted[i].pValue) ? sorted[i].pValue : 1;
			const adj = Math.min(1, raw * (n - i));
			running = Math.max(running, adj);
			sorted[i].pAdjusted = running;
		}
		return sorted.sort((a, b) => a._idx - b._idx).map(({ _idx, ...rest }) => rest);
	}

	function formatPValue(pValue) {
		return Number.isFinite(pValue) ? pValue.toPrecision(3) : 'NaN';
	}

	export function jarqueBeraNormality(values) {
		const clean = (values ?? []).filter((v) => v != null && !Number.isNaN(v)).map(Number);
		const n = clean.length;
		if (n < 8) {
			return {
				evaluable: false,
				normal: null,
				reason: `Normality check skipped because n = ${n} (< 8).`
			};
		}

		const m = mean(clean);
		const variance = sampleVariance(clean);
		if (!Number.isFinite(variance) || variance === 0) {
			return {
				evaluable: true,
				normal: false,
				statistic: Number.POSITIVE_INFINITY,
				pValue: 0,
				reason: 'All values are identical or have zero variance.'
			};
		}

		const sd = Math.sqrt(variance);
		let skew = 0;
		let kurtosis = 0;
		for (const v of clean) {
			const z = (v - m) / sd;
			skew += z ** 3;
			kurtosis += z ** 4;
		}
		skew /= n;
		kurtosis /= n;
		const jb = (n / 6) * (skew ** 2 + (kurtosis - 3) ** 2 / 4);
		const pValue = safePUpperFromChiSq(jb, 2);

		return {
			evaluable: true,
			normal: Number.isFinite(pValue) ? pValue >= 0.05 : false,
			statistic: jb,
			pValue,
			skew,
			kurtosis
		};
	}

	export function getComparisonWarnings(groups, chosen, alpha = 0.05) {
		if (!chosen || !Array.isArray(groups) || groups.length < 2) return [];

		const warnings = [];
		const parametric = chosen === 'ttest' || chosen === 'anova';

		if (parametric) {
			for (const group of groups) {
				const normality = jarqueBeraNormality(group.values);
				if (!normality.evaluable) {
					warnings.push(
						`Group "${group.name}": ${normality.reason} Parametric tests are less robust with very small groups.`
					);
					continue;
				}
				if (normality.normal === false) {
					warnings.push(
						`Group "${group.name}" appears non-normal by Jarque-Bera (p = ${formatPValue(normality.pValue)}). ${chosen === 'ttest' ? 'Welch t-test' : 'ANOVA'} assumes approximately normal data within each group.`
					);
				}
			}

			const variances = groups
				.map((group) => sampleVariance(group.values))
				.filter((value) => Number.isFinite(value) && value > 0);
			if (variances.length >= 2) {
				const minVariance = Math.min(...variances);
				const maxVariance = Math.max(...variances);
				if (minVariance > 0 && maxVariance / minVariance > 4) {
					warnings.push(
						`Group variances differ by more than 4×. ${chosen === 'anova' ? 'ANOVA can be sensitive to heteroscedasticity.' : 'Welch t-test is variance-robust, but interpretation still needs caution.'}`
					);
				}
			}
		} else {
			for (const group of groups) {
				if (group.n < 5) {
					warnings.push(
						`Group "${group.name}" has only ${group.n} values. Rank-based tests will run, but p-values are coarse with very small groups.`
					);
				}
				const variance = sampleVariance(group.values);
				if (group.n > 1 && Number.isFinite(variance) && variance === 0) {
					warnings.push(
						`Group "${group.name}" has zero variance. Rank-based comparisons may be dominated by ties.`
					);
				}
			}
		}

		return Array.from(new Set(warnings));
	}

	export function welchTTest(groupA, groupB, alpha = 0.05) {
		const n1 = groupA.n;
		const n2 = groupB.n;
		if (n1 < 2 || n2 < 2) {
			return { valid: false, reason: 'Each group needs at least 2 valid values for a t-test.' };
		}

		const m1 = groupA.mean;
		const m2 = groupB.mean;
		const v1 = sampleVariance(groupA.values);
		const v2 = sampleVariance(groupB.values);
		const a = v1 / n1;
		const b = v2 / n2;
		const se = Math.sqrt(a + b);
		const diff = m1 - m2;

		if (!Number.isFinite(se) || se < 0) {
			return { valid: false, reason: 'Unable to compute standard error for t-test.' };
		}

		const t = se === 0 ? (diff === 0 ? 0 : Number.POSITIVE_INFINITY) : diff / se;
		const dfNum = (a + b) ** 2;
		const dfDen = (a * a) / (n1 - 1) + (b * b) / (n2 - 1);
		const df = dfDen === 0 ? n1 + n2 - 2 : dfNum / dfDen;
		const pValue = Number.isFinite(t) ? safePUpperFromF(t * t, 1, df) : 0;

		const tCrit = Number.isFinite(df) ? tQuantile(1 - alpha / 2, df) : NaN;
		const ciHalf = Number.isFinite(tCrit) && Number.isFinite(se) ? tCrit * se : NaN;
		const ciLow = Number.isFinite(ciHalf) ? diff - ciHalf : NaN;
		const ciHigh = Number.isFinite(ciHalf) ? diff + ciHalf : NaN;

		const pooledDen = n1 + n2 - 2;
		const pooledVar = pooledDen > 0 ? ((n1 - 1) * v1 + (n2 - 1) * v2) / pooledDen : NaN;
		const cohenD = Number.isFinite(pooledVar) && pooledVar > 0 ? diff / Math.sqrt(pooledVar) : NaN;

		return {
			valid: true,
			t,
			df,
			pValue,
			difference: diff,
			ciLow,
			ciHigh,
			cohenD
		};
	}

	export function oneWayAnova(groups) {
		const usable = groups.filter((g) => g.n > 0);
		if (usable.length < 2) {
			return { valid: false, reason: 'ANOVA needs at least 2 non-empty groups.' };
		}

		const nTotal = usable.reduce((acc, g) => acc + g.n, 0);
		const k = usable.length;
		if (nTotal <= k) {
			return { valid: false, reason: 'ANOVA needs at least one group with more than 1 value.' };
		}

		const grandMean = usable.reduce((acc, g) => acc + g.mean * g.n, 0) / nTotal;
		let ssBetween = 0;
		let ssWithin = 0;
		for (const g of usable) {
			ssBetween += g.n * (g.mean - grandMean) ** 2;
			for (const v of g.values) ssWithin += (v - g.mean) ** 2;
		}

		const dfBetween = k - 1;
		const dfWithin = nTotal - k;
		const msBetween = ssBetween / dfBetween;
		const msWithin = ssWithin / dfWithin;
		let f = NaN;
		if (msWithin === 0) {
			f = msBetween === 0 ? 0 : Number.POSITIVE_INFINITY;
		} else {
			f = msBetween / msWithin;
		}
		const pValue = Number.isFinite(f) ? safePUpperFromF(f, dfBetween, dfWithin) : 0;
		const etaSquared = ssBetween + ssWithin > 0 ? ssBetween / (ssBetween + ssWithin) : NaN;

		return {
			valid: true,
			f,
			dfBetween,
			dfWithin,
			msWithin,
			pValue,
			ssBetween,
			ssWithin,
			etaSquared
		};
	}

	export function tukeyKramerPostHoc(groups, msWithin, dfWithin, alpha = 0.05) {
		if (!Number.isFinite(msWithin) || !Number.isFinite(dfWithin) || dfWithin <= 0) return [];
		const pairs = [];
		for (let i = 0; i < groups.length; i++) {
			for (let j = i + 1; j < groups.length; j++) {
				const a = groups[i];
				const b = groups[j];
				if (a.n === 0 || b.n === 0) continue;
				const diff = a.mean - b.mean;
				const se = Math.sqrt(msWithin * (1 / a.n + 1 / b.n));
				const t = se === 0 ? (diff === 0 ? 0 : Number.POSITIVE_INFINITY) : diff / se;
				const q = Math.abs(t) * Math.sqrt(2);
				const pValue = Number.isFinite(t) ? safePUpperFromF(t * t, 1, dfWithin) : 0;
				pairs.push({
					groupA: a.name,
					groupB: b.name,
					diff,
					statistic: q,
					pValue
				});
			}
		}
		return holmAdjust(pairs).map((p) => ({ ...p, significant: p.pAdjusted < alpha }));
	}

	export function mannWhitneyTwoGroups(groupA, groupB) {
		const n1 = groupA.n;
		const n2 = groupB.n;
		if (n1 < 1 || n2 < 1)
			return { valid: false, reason: 'Mann-Whitney needs data in both groups.' };

		const tagged = [
			...groupA.values.map((v) => ({ v, g: 'A' })),
			...groupB.values.map((v) => ({ v, g: 'B' }))
		];
		const { ranks, tieCounts } = rankWithTies(tagged.map((x) => x.v));
		let rankSumA = 0;
		for (let i = 0; i < tagged.length; i++) {
			if (tagged[i].g === 'A') rankSumA += ranks[i];
		}
		const u1 = rankSumA - (n1 * (n1 + 1)) / 2;
		const u2 = n1 * n2 - u1;
		const u = Math.min(u1, u2);

		const n = n1 + n2;
		let tieTerm = 0;
		for (const t of tieCounts) tieTerm += t ** 3 - t;
		const sigmaSq = (n1 * n2 * (n + 1 - tieTerm / (n * (n - 1)))) / 12;
		const sigma = Math.sqrt(Math.max(0, sigmaSq));
		const meanU = (n1 * n2) / 2;
		const cc = u > meanU ? 0.5 : -0.5;
		const z = sigma > 0 ? (u - meanU - cc) / sigma : 0;
		const pValue = safePUpperFromChiSq(z * z, 1);
		const rEffect = Math.abs(z) / Math.sqrt(n);

		return {
			valid: true,
			u,
			z,
			pValue,
			rEffect,
			n1,
			n2
		};
	}

	export function kruskalWallis(groups) {
		const usable = groups.filter((g) => g.n > 0);
		if (usable.length < 2) {
			return { valid: false, reason: 'Kruskal-Wallis needs at least 2 non-empty groups.' };
		}

		const tagged = [];
		for (const g of usable) {
			for (const v of g.values) tagged.push({ v, group: g.name });
		}
		const n = tagged.length;
		if (n <= usable.length) {
			return {
				valid: false,
				reason: 'Kruskal-Wallis needs at least one group with more than one value.'
			};
		}

		const { ranks, tieCounts } = rankWithTies(tagged.map((x) => x.v));
		const rankSums = new Map();
		for (let i = 0; i < tagged.length; i++) {
			const key = tagged[i].group;
			rankSums.set(key, (rankSums.get(key) ?? 0) + ranks[i]);
		}

		let h = 0;
		for (const g of usable) {
			const rg = rankSums.get(g.name) ?? 0;
			h += (rg * rg) / g.n;
		}
		h = (12 / (n * (n + 1))) * h - 3 * (n + 1);

		let tieCorrection = 1;
		if (n > 1) {
			let tieTerm = 0;
			for (const t of tieCounts) tieTerm += t ** 3 - t;
			tieCorrection = 1 - tieTerm / (n ** 3 - n);
		}
		if (tieCorrection <= 0) tieCorrection = 1;
		const hCorrected = h / tieCorrection;
		const df = usable.length - 1;
		const pValue = safePUpperFromChiSq(hCorrected, df);
		const epsilonSquared = (hCorrected - df) / (n - 1);

		return {
			valid: true,
			h: hCorrected,
			df,
			pValue,
			epsilonSquared,
			nTotal: n
		};
	}

	export function pairwiseMannWhitney(groups, alpha = 0.05) {
		const pairs = [];
		for (let i = 0; i < groups.length; i++) {
			for (let j = i + 1; j < groups.length; j++) {
				const a = groups[i];
				const b = groups[j];
				const m = mannWhitneyTwoGroups(a, b);
				if (!m.valid) continue;
				pairs.push({
					groupA: a.name,
					groupB: b.name,
					statistic: m.u,
					pValue: m.pValue,
					effect: m.rEffect
				});
			}
		}
		return holmAdjust(pairs).map((p) => ({ ...p, significant: p.pAdjusted < alpha }));
	}

	function resolveMethod(requested, groupsCount) {
		if (requested === 'ttest') return groupsCount === 2 ? 'ttest' : null;
		if (requested === 'anova') return groupsCount >= 2 ? 'anova' : null;
		if (requested === 'mannwhitney') return groupsCount === 2 ? 'mannwhitney' : null;
		if (requested === 'kruskal') return groupsCount >= 2 ? 'kruskal' : null;
		return groupsCount === 2 ? 'ttest' : groupsCount > 2 ? 'anova' : null;
	}

	function runSelectedComparison(groups, chosen, alpha, postHocEnabled) {
		if (!chosen) {
			return {
				valid: false,
				groups,
				warnings: [],
				reason: 'Need at least 2 groups with data for comparison.'
			};
		}

		const warnings = getComparisonWarnings(groups, chosen, alpha);

		if (chosen === 'ttest') {
			const tRes = welchTTest(groups[0], groups[1], alpha);
			return {
				valid: tRes.valid,
				test: 'Welch t-test',
				groupCount: groups.length,
				nTotal: groups[0].n + groups[1].n,
				groups,
				warnings,
				...tRes
			};
		}

		if (chosen === 'anova') {
			const aRes = oneWayAnova(groups);
			const postHoc =
				postHocEnabled && aRes.valid && groups.length > 2
					? tukeyKramerPostHoc(groups, aRes.msWithin, aRes.dfWithin, alpha)
					: [];
			return {
				valid: aRes.valid,
				test: 'One-way ANOVA',
				groupCount: groups.length,
				nTotal: groups.reduce((acc, g) => acc + g.n, 0),
				groups,
				warnings,
				postHoc,
				postHocLabel: 'Tukey-Kramer post-hoc (Holm adjusted p-values)',
				...aRes
			};
		}

		if (chosen === 'mannwhitney') {
			const mRes = mannWhitneyTwoGroups(groups[0], groups[1]);
			return {
				valid: mRes.valid,
				test: 'Mann-Whitney U',
				groupCount: groups.length,
				nTotal: groups[0].n + groups[1].n,
				groups,
				warnings,
				...mRes
			};
		}

		const kRes = kruskalWallis(groups);
		const postHoc =
			postHocEnabled && kRes.valid && groups.length > 2 ? pairwiseMannWhitney(groups, alpha) : [];
		return {
			valid: kRes.valid,
			test: 'Kruskal-Wallis',
			groupCount: groups.length,
			nTotal: groups.reduce((acc, g) => acc + g.n, 0),
			groups,
			warnings,
			postHoc,
			postHocLabel: 'Pairwise Mann-Whitney (Holm adjusted p-values)',
			...kRes
		};
	}

	export function groupcomparison(argsIN) {
		const xIN = argsIN.xIN;
		const yINs = normalizeYInputs(argsIN.yIN);

		const result = {
			comparisons: {},
			warnings: []
		};
		let anyValid = false;

		const groupCol = xIN != null && xIN !== -1 ? getColumnById(xIN) : null;
		const mode = argsIN.method ?? 'auto';
		const alpha = Number.isFinite(argsIN.alpha) ? argsIN.alpha : 0.05;
		const postHocEnabled = argsIN.postHocEnabled !== false;

		// Boxplot-like fallback: with multiple Y columns, allow no group column and
		// treat each Y column as one group distribution.
		if ((xIN == null || xIN === -1 || !groupCol) && yINs.length > 1) {
			const groups = buildGroupsFromYColumns(yINs);
			const chosen = resolveMethod(mode, groups.length);
			const comp = runSelectedComparison(groups, chosen, alpha, postHocEnabled);
			result.warnings.push(...(comp.warnings ?? []).map((w) => `Selected Y columns: ${w}`));
			result.comparisons.multiY = {
				columnName: 'Selected Y columns',
				...comp
			};
			return [result, !!comp.valid];
		}

		if (xIN == null || xIN === -1 || !groupCol || yINs.length === 0) {
			return [result, false];
		}

		const groupData = groupCol.getData();

		for (const yId of yINs) {
			if (yId == null || yId === -1) continue;
			const yCol = getColumnById(yId);
			if (!yCol) continue;
			const yData = yCol.getData();
			const groups = buildGroups(groupData, yData).filter((g) => g.n > 0);
			const chosen = resolveMethod(mode, groups.length);
			if (!chosen) {
				result.comparisons[yId] = {
					valid: false,
					columnName: yCol.name,
					groups,
					warnings: [],
					reason:
						mode === 'ttest' || mode === 'mannwhitney'
							? 'Selected test requires exactly 2 groups with data.'
							: 'Need at least 2 groups with data for comparison.'
				};
				continue;
			}

			if (chosen === 'ttest') {
				const tRes = welchTTest(groups[0], groups[1], alpha);
				const warnings = getComparisonWarnings(groups, chosen, alpha);
				result.comparisons[yId] = {
					valid: tRes.valid,
					test: 'Welch t-test',
					columnName: yCol.name,
					groupCount: groups.length,
					nTotal: groups[0].n + groups[1].n,
					groups,
					warnings,
					...tRes
				};
				result.warnings.push(...warnings.map((w) => `${yCol.name}: ${w}`));
				if (tRes.valid) anyValid = true;
				continue;
			}

			if (chosen === 'anova') {
				const aRes = oneWayAnova(groups);
				const warnings = getComparisonWarnings(groups, chosen, alpha);
				const postHoc =
					postHocEnabled && aRes.valid && groups.length > 2
						? tukeyKramerPostHoc(groups, aRes.msWithin, aRes.dfWithin, alpha)
						: [];
				result.comparisons[yId] = {
					valid: aRes.valid,
					test: 'One-way ANOVA',
					columnName: yCol.name,
					groupCount: groups.length,
					nTotal: groups.reduce((acc, g) => acc + g.n, 0),
					groups,
					warnings,
					postHoc,
					postHocLabel: 'Tukey-Kramer post-hoc (Holm adjusted p-values)',
					...aRes
				};
				result.warnings.push(...warnings.map((w) => `${yCol.name}: ${w}`));
				if (aRes.valid) anyValid = true;
				continue;
			}

			if (chosen === 'mannwhitney') {
				const mRes = mannWhitneyTwoGroups(groups[0], groups[1]);
				const warnings = getComparisonWarnings(groups, chosen, alpha);
				result.comparisons[yId] = {
					valid: mRes.valid,
					test: 'Mann-Whitney U',
					columnName: yCol.name,
					groupCount: groups.length,
					nTotal: groups[0].n + groups[1].n,
					groups,
					warnings,
					...mRes
				};
				result.warnings.push(...warnings.map((w) => `${yCol.name}: ${w}`));
				if (mRes.valid) anyValid = true;
				continue;
			}

			const kRes = kruskalWallis(groups);
			const warnings = getComparisonWarnings(groups, chosen, alpha);
			const postHoc =
				postHocEnabled && kRes.valid && groups.length > 2 ? pairwiseMannWhitney(groups, alpha) : [];
			result.comparisons[yId] = {
				valid: kRes.valid,
				test: 'Kruskal-Wallis',
				columnName: yCol.name,
				groupCount: groups.length,
				nTotal: groups.reduce((acc, g) => acc + g.n, 0),
				groups,
				warnings,
				postHoc,
				postHocLabel: 'Pairwise Mann-Whitney (Holm adjusted p-values)',
				...kRes
			};
			result.warnings.push(...warnings.map((w) => `${yCol.name}: ${w}`));
			if (kRes.valid) anyValid = true;
		}

		return [result, anyValid];
	}
</script>

<script>
	// @ts-nocheck
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import StoreValueButton from '$lib/components/inputs/StoreValueButton.svelte';
	import { getColumnById as getColumnByIdLocal } from '$lib/core/Column.svelte';
	import { onMount, untrack } from 'svelte';
	import {
		showStaticDataAsTable,
		saveStaticDataAsCSV
	} from '$lib/components/plotbits/helpers/save.svelte.js';

	let { p = $bindable(), hideInputs = false } = $props();

	migrateLegacyYIN(p.args);
	if (typeof p.args.out !== 'object' || p.args.out === null) {
		p.args.out = {};
	}
	if (typeof p.args.postHocEnabled !== 'boolean') {
		p.args.postHocEnabled = true;
	}

	let comparisonData = $state({ comparisons: {}, warnings: [] });
	let mounted = $state(false);
	let lastHash = '';

	let groupCol = $derived.by(() => (p.args.xIN >= 0 ? getColumnByIdLocal(p.args.xIN) : null));
	let yCols = $derived.by(() =>
		(p.args.yIN ?? []).map((id) => getColumnByIdLocal(id)).filter(Boolean)
	);
	let yExcludeIds = $derived.by(() => {
		if (hideInputs) return [];
		return [p.args.xIN].filter((id) => id >= 0);
	});
	let getHash = $derived.by(() => {
		let out = '';
		out += groupCol?.getDataHash ?? '';
		for (const col of yCols) out += col?.getDataHash ?? '';
		out += p.args.method ?? 'auto';
		out += p.args.alpha ?? 0.05;
		out += p.args.postHocEnabled ? '1' : '0';
		return out;
	});
	let hasAnyPostHoc = $derived.by(() =>
		Object.values(comparisonData?.comparisons ?? {}).some((r) => (r?.postHoc?.length ?? 0) > 0)
	);
	let statsPreviewStart = $state(1);
	let summaryPreviewStart = $state(1);
	let postHocPreviewStart = $state(1);

	function doComparison() {
		[comparisonData, p.args.valid] = groupcomparison(p.args);
		// Publish warnings onto the TP object so the node (collapsed or expanded)
		// can surface them without the control panel being open. See the node
		// warning badge in TableProcessNode/CompactNode.
		p.warnings = comparisonData?.warnings ?? [];
		lastHash = getHash;
	}

	$effect(() => {
		const h = getHash;
		if (!mounted) return;
		if (h !== lastHash) {
			untrack(() => doComparison());
		}
	});

	onMount(() => {
		if (!p.args.out) p.args.out = {};
		doComparison();
		mounted = true;
	});

	function getPreviewRows(rows, start = 1, count = 6) {
		return rows.slice(Math.max(0, start - 1), Math.max(0, start - 1) + count);
	}

	function formatValueLabel(label) {
		return String(label ?? '')
			.replaceAll('_', ' ')
			.replace(/\b\w/g, (c) => c.toUpperCase());
	}

	function formatValueDisplay(value) {
		if (typeof value === 'boolean') return value ? 'Yes' : 'No';
		if (Number.isFinite(value)) return Number(value).toPrecision(4);
		if (value == null || value === '') return '-';
		return String(value);
	}

	function getStatsData() {
		const headers = [
			'column',
			'test',
			'group_count',
			'n_total',
			'statistic',
			'df1',
			'df2',
			'p_value',
			'effect_size',
			'ci_low',
			'ci_high',
			'warnings'
		];
		const rows = [];
		for (const result of Object.values(comparisonData?.comparisons ?? {})) {
			if (!result?.valid) continue;
			const warningText = (result.warnings ?? []).join(' | ');
			if (result.test === 'Welch t-test') {
				rows.push([
					result.columnName,
					result.test,
					result.groupCount,
					result.nTotal,
					result.t,
					result.df,
					null,
					result.pValue,
					result.cohenD,
					result.ciLow,
					result.ciHigh,
					warningText
				]);
			} else if (result.test === 'One-way ANOVA') {
				rows.push([
					result.columnName,
					result.test,
					result.groupCount,
					result.nTotal,
					result.f,
					result.dfBetween,
					result.dfWithin,
					result.pValue,
					result.etaSquared,
					null,
					null,
					warningText
				]);
			} else if (result.test === 'Mann-Whitney U') {
				rows.push([
					result.columnName,
					result.test,
					result.groupCount,
					result.nTotal,
					result.u,
					result.n1,
					result.n2,
					result.pValue,
					result.rEffect,
					null,
					null,
					warningText
				]);
			} else {
				rows.push([
					result.columnName,
					result.test,
					result.groupCount,
					result.nTotal,
					result.h,
					result.df,
					null,
					result.pValue,
					result.epsilonSquared,
					null,
					null,
					warningText
				]);
			}
		}
		return { headers, rows };
	}

	function getPostHocData() {
		const headers = [
			'column',
			'family',
			'group_a',
			'group_b',
			'difference_or_stat',
			'test_statistic',
			'p_raw',
			'p_adjusted',
			'significant'
		];
		const rows = [];
		for (const result of Object.values(comparisonData?.comparisons ?? {})) {
			for (const p of result?.postHoc ?? []) {
				rows.push([
					result.columnName,
					result.postHocLabel,
					p.groupA,
					p.groupB,
					p.diff ?? p.statistic,
					p.statistic,
					p.pValue,
					p.pAdjusted,
					p.significant
				]);
			}
		}
		return { headers, rows };
	}

	function getGroupSummaryData() {
		const headers = ['column', 'group', 'n', 'mean', 'sd', 'min', 'max', 'median', 'jb_p'];
		const rows = [];
		for (const result of Object.values(comparisonData?.comparisons ?? {})) {
			for (const g of result?.groups ?? []) {
				const vals = g.values ?? [];
				const gMin = vals.length ? Math.min(...vals) : NaN;
				const gMax = vals.length ? Math.max(...vals) : NaN;
				const gMed = median(vals);
				// JB requires n >= 8; use null when not evaluable so formatter renders '-'
				const jb = jarqueBeraNormality(vals);
				const jbP = jb.evaluable ? jb.pValue : null;
				rows.push([result.columnName, g.name, g.n, g.mean, g.sd, gMin, gMax, gMed, jbP]);
			}
		}
		return { headers, rows };
	}

	let statsTableData = $derived.by(() => getStatsData());
	let groupSummaryTableData = $derived.by(() => getGroupSummaryData());
	let postHocTableData = $derived.by(() => getPostHocData());
</script>

<div style="display: block;">
	<div class="section-row">
		<div class="tableProcess-label">
			<span>Group Comparison</span>
		</div>
	</div>

	{#if !hideInputs}
		<div class="control-input">
			<p>Group column (optional with 2+ Y columns)</p>
			<ColumnSelector bind:value={p.args.xIN} />
		</div>

		<div class="control-input">
			<p>Y columns</p>
			<ColumnSelector bind:value={p.args.yIN} multiple={true} excludeColIds={yExcludeIds} />
		</div>
	{/if}

	<div class="control-input-horizontal">
		<ControlInput label="Method">
			<select bind:value={p.args.method} onchange={doComparison}>
				<option value="auto">Auto (2 groups: T-test, 3+ groups: ANOVA)</option>
				<option value="ttest">Welch T-test (exactly 2 groups)</option>
				<option value="anova">One-way ANOVA (+ Tukey-Kramer post-hoc)</option>
				<option value="mannwhitney">Mann-Whitney U (exactly 2 groups)</option>
				<option value="kruskal">Kruskal-Wallis (+ pairwise Mann-Whitney)</option>
			</select>
		</ControlInput>
		<ControlInput label="Alpha">
			<NumberWithUnits min="0.001" max="0.5" step="0.001" bind:value={p.args.alpha} />
		</ControlInput>
		<div class="control-input" style="display: flex; align-items: center; gap: 0.4rem;">
			<input id={'posthoc-' + p.id} type="checkbox" bind:checked={p.args.postHocEnabled} />
			<label for={'posthoc-' + p.id}>Enable post-hoc</label>
		</div>
	</div>

	{#if p.args.valid}
		{#if comparisonData.warnings.length > 0}
			<div class="data-warning" style="margin-top: var(--space-4);">
				{#each comparisonData.warnings as warning}
					<p>⚠ {warning}</p>
				{/each}
			</div>
		{/if}

		<details class="tp-output-panel" open>
			<summary class="tp-output-summary">Stats table</summary>
			{#if statsTableData.rows.length > 0}
				{#each getPreviewRows(statsTableData.rows, statsPreviewStart) as row}
					<div class="control-input-horizontal">
						<div class="control-input">
							{#each statsTableData.headers as header, idx}
								{#if row[idx] != null && row[idx] !== ''}
									<p>
										<strong>{formatValueLabel(header)}:</strong>
										{formatValueDisplay(row[idx])}
									</p>
								{/if}
							{/each}
						</div>
					</div>
				{/each}
			{/if}
			<div class="tp-stat-actions">
				<button
					class="tp-stat-btn"
					onclick={() => {
						const { headers, rows } = getStatsData();
						showStaticDataAsTable('Group comparison stats', headers, rows, getStatsData);
					}}
				>
					Open full table
				</button>
				<button
					class="tp-stat-btn"
					onclick={() => {
						const { headers, rows } = getStatsData();
						saveStaticDataAsCSV('group_comparison_stats', headers, rows);
					}}
				>
					Download CSV
				</button>
			</div>
		</details>

		<details class="tp-output-panel">
			<summary class="tp-output-summary">Group summary</summary>
			{#if groupSummaryTableData.rows.length > 0}
				{#each getPreviewRows(groupSummaryTableData.rows, summaryPreviewStart) as row}
					<div class="control-input-horizontal">
						<div class="control-input">
							<p><strong>Column:</strong> {formatValueDisplay(row[0])}</p>
							<p><strong>Group:</strong> {formatValueDisplay(row[1])}</p>
							<p><strong>n:</strong> {formatValueDisplay(row[2])}</p>
							<p><strong>Mean:</strong> {formatValueDisplay(row[3])}</p>
							<p><strong>SD:</strong> {formatValueDisplay(row[4])}</p>
							<p><strong>Min:</strong> {formatValueDisplay(row[5])}</p>
							<p><strong>Max:</strong> {formatValueDisplay(row[6])}</p>
							<p><strong>Median:</strong> {formatValueDisplay(row[7])}</p>
							<p><strong>JB p:</strong> {formatValueDisplay(row[8])}</p>
						</div>
					</div>
				{/each}
			{/if}
			<div class="tp-stat-actions">
				<button
					class="tp-stat-btn"
					onclick={() => {
						const { headers, rows } = getGroupSummaryData();
						showStaticDataAsTable('Group summary', headers, rows, getGroupSummaryData);
					}}
				>
					Open full table
				</button>
			</div>
		</details>

		{#if hasAnyPostHoc}
			<details class="tp-output-panel">
				<summary class="tp-output-summary">Post-hoc comparisons</summary>
				{#if postHocTableData.rows.length > 0}
					{#each getPreviewRows(postHocTableData.rows, postHocPreviewStart) as row}
						<div class="control-input-horizontal">
							<div class="control-input">
								<p>
									<strong>{formatValueDisplay(row[0])}:</strong>
									{formatValueDisplay(row[2])} vs {formatValueDisplay(row[3])}
								</p>
								<p><strong>Family:</strong> {formatValueDisplay(row[1])}</p>
								<p><strong>Difference/Stat:</strong> {formatValueDisplay(row[4])}</p>
								<p><strong>Test Statistic:</strong> {formatValueDisplay(row[5])}</p>
								<p><strong>p Raw:</strong> {formatValueDisplay(row[6])}</p>
								<p><strong>p Adjusted:</strong> {formatValueDisplay(row[7])}</p>
								<p><strong>Significant:</strong> {formatValueDisplay(row[8])}</p>
							</div>
						</div>
					{/each}
				{/if}
				<div class="tp-stat-actions">
					<button
						class="tp-stat-btn"
						onclick={() => {
							const { headers, rows } = getPostHocData();
							showStaticDataAsTable('Group post-hoc', headers, rows, getPostHocData);
						}}
					>
						Open full table
					</button>
					<button
						class="tp-stat-btn"
						onclick={() => {
							const { headers, rows } = getPostHocData();
							saveStaticDataAsCSV('group_comparison_posthoc', headers, rows);
						}}
					>
						Download CSV
					</button>
				</div>
			</details>
		{/if}

		{#each Object.entries(comparisonData.comparisons) as [yId, res]}
			<div
				class="result-card"
				style="margin-top: var(--space-4); border: 1px solid var(--stroke2); padding: var(--space-4); border-radius: 0.375rem;"
			>
				<p><strong>{res.columnName || 'Column ' + yId}</strong></p>
				{#if !res.valid}
					<p>{res.reason || 'Not enough valid grouped data.'}</p>
				{:else if res.test === 'Welch t-test'}
					<p>
						{res.test}: t({res.df.toFixed(2)}) = {res.t.toFixed(4)}, p = {res.pValue.toPrecision(4)}
					</p>
					<p>
						Mean difference ({res.groups[0].name} - {res.groups[1].name}) = {res.difference.toFixed(
							4
						)}
						(95% CI {res.ciLow.toFixed(4)} to {res.ciHigh.toFixed(4)})
					</p>
					<div class="section-row" style="gap: 0.4rem;">
						<StoreValueButton
							label="p-value"
							getter={() => res.pValue}
							defaultName={`groupcmp_ttest_p_${res.columnName || yId}`}
							source="GroupComparison"
						/>
						<StoreValueButton
							label="t-stat"
							getter={() => res.t}
							defaultName={`groupcmp_ttest_t_${res.columnName || yId}`}
							source="GroupComparison"
						/>
					</div>
				{:else if res.test === 'One-way ANOVA'}
					<p>
						{res.test}: F({res.dfBetween}, {res.dfWithin}) = {res.f.toFixed(4)}, p = {res.pValue.toPrecision(
							4
						)}
					</p>
					<p>Eta squared = {Number.isFinite(res.etaSquared) ? res.etaSquared.toFixed(4) : 'NaN'}</p>
				{:else if res.test === 'Mann-Whitney U'}
					<p>
						{res.test}: U = {res.u.toFixed(3)}, z = {res.z.toFixed(3)}, p = {res.pValue.toPrecision(
							4
						)}
					</p>
					<p>Effect size r = {Number.isFinite(res.rEffect) ? res.rEffect.toFixed(4) : 'NaN'}</p>
				{:else}
					<p>
						{res.test}: H({res.df}) = {res.h.toFixed(4)}, p = {res.pValue.toPrecision(4)}
					</p>
					<p>
						Epsilon squared = {Number.isFinite(res.epsilonSquared)
							? res.epsilonSquared.toFixed(4)
							: 'NaN'}
					</p>
				{/if}

				{#if (res.warnings?.length ?? 0) > 0}
					<div class="data-warning" style="margin-top: 0.35rem;">
						{#each res.warnings as warning}
							<p>⚠ {warning}</p>
						{/each}
					</div>
				{/if}

				{#if (res.postHoc?.length ?? 0) > 0}
					<p style="margin-top: 0.35rem;"><strong>{res.postHocLabel}</strong></p>
					{#each res.postHoc as pair}
						<p>
							<strong>{pair.groupA}</strong> vs <strong>{pair.groupB}</strong>: stat = {Number.isFinite(
								pair.statistic
							)
								? pair.statistic.toFixed(4)
								: 'NaN'}, p = {Number.isFinite(pair.pValue) ? pair.pValue.toPrecision(4) : 'NaN'}, p
							adj = {Number.isFinite(pair.pAdjusted) ? pair.pAdjusted.toPrecision(4) : 'NaN'},
							significant = {pair.significant ? 'Yes' : 'No'}
						</p>
					{/each}
				{/if}

				{#if (res.groups?.length ?? 0) > 0}
					{#each res.groups as g}
						<p>
							<strong>{g.name}</strong>: n = {g.n}, mean = {Number.isFinite(g.mean)
								? g.mean.toFixed(4)
								: 'NaN'}, sd = {Number.isFinite(g.sd) ? g.sd.toFixed(4) : 'NaN'}
						</p>
					{/each}
				{/if}
			</div>
		{/each}
	{:else}
		<p>Select a grouping column and one or more numeric Y columns.</p>
	{/if}
</div>

<style>
	.tp-output-panel {
		margin-top: 0.6rem;
		padding: 0.45rem 0.55rem;
		border: 1px solid var(--stroke2, var(--color-lightness-85, #d7d7d7));
		border-radius: 0.375rem;
		background: var(--color-lightness-99, #fcfcfc);
		font-size: var(--font-xs);
		line-height: 1.25;
	}

	.tp-output-panel[open] {
		max-height: 14rem;
		overflow-y: auto;
		scrollbar-gutter: stable;
	}

	.tp-output-summary {
		cursor: pointer;
		font-weight: 600;
		position: sticky;
		top: 0;
		z-index: 1;
		background: var(--color-lightness-99, #fcfcfc);
		padding: 0.1rem 0;
	}

	.result-card {
		font-size: var(--font-xs);
		line-height: 1.2;
	}

	.result-card p {
		margin: 0.14rem 0;
	}

	.tp-stat-actions {
		display: flex;
		gap: 0.4rem;
		margin-top: 0.3rem;
		flex-wrap: wrap;
	}

	.tp-stat-btn {
		font-size: var(--font-xs);
		padding: var(--space-2) var(--space-4);
		border: 1px solid var(--color-lightness-75, #aaa);
		border-radius: 3px;
		background: none;
		cursor: pointer;
		color: var(--color-lightness-35, #555);
	}

	.tp-stat-btn:hover {
		background: var(--color-lightness-95, #f2f2f2);
		border-color: var(--color-lightness-55, #888);
	}

	.tp-stat-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.data-warning {
		margin-top: 0.4rem;
		padding: 0.45rem 0.6rem;
		border-radius: 0.375rem;
		background: color-mix(in srgb, #f5c76a 18%, white);
		border: 1px solid color-mix(in srgb, #d89c1b 35%, white);
	}

	.data-warning p {
		margin: 0.15rem 0;
		font-size: 0.92em;
	}
</style>
