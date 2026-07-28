<script module>
	// @ts-nocheck
	// Chi-squared test — goodness-of-fit or test of independence.
	//
	// Three modes (testType):
	//   • independence: two categorical columns (xIN = rows, yIN = columns). Cross-tabulated into
	//     a contingency table, then Pearson's χ² tests whether the two variables are associated.
	//     Yates' continuity correction is applied to 2×2 tables (matching scipy's default).
	//   • goodness: one column (xIN). A categorical column is tabulated into category counts and
	//     tested against a uniform expectation ("are the categories equally frequent?"); a numeric
	//     column is read directly as observed counts.
	//   • fisher: Fisher's EXACT test on a 2x2 table (xIN = rows, yIN = columns). Same question as
	//     independence, but exact at any sample size rather than relying on a large-sample
	//     approximation — which is what the independence mode's own "expected count below 5"
	//     warning has always been pointing at. Reports a p-value and the sample odds ratio; df is
	//     NaN because an exact test has no degrees of freedom.
	//
	// Fisher's lives here rather than in its own node because it answers the SAME question as the
	// independence mode and you pick between them on sample size — the same reason Watson-Williams
	// sits inside the Rayleigh node.
	// Outputs three metric columns (statistic, pvalue, df). Maths is the pure, scipy-parity-checked
	// utils/chisquare.js. The contingency / observed-vs-expected table is shown in-node.
	import { getColumnById } from '$lib/core/Column.svelte';
	import { nodeMemo, restoreOrCompute } from '$lib/core/computeMemo.js';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import { writeOutputColumn } from '$lib/tableProcesses/outputColumns.js';
	import { fillDefaults } from '$lib/tableProcesses/tpArgHelpers.js';
	import {
		chiSquareGoodnessOfFit,
		chiSquareIndependence,
		contingencyTable,
		isMissingCategory,
		cohensW,
		effectSizeLabel,
		groupsToTable
	} from '$lib/utils/chisquare.js';
	import { fisherExact, fisherExactFromColumns } from '$lib/utils/fisherExact.js';

	// User-facing name only. The registry key is the FILENAME (ChiSquared), and
	// saved sessions store that key in `name`, so the file is deliberately NOT
	// renamed — doing so would fail to load every existing session. The node now
	// runs three tests (chi-squared independence, goodness-of-fit and Fisher's
	// exact), so "Chi-squared test" undersold it.
	const displayName = 'Categorical tests';

	const defaults = new Map([
		['testType', { val: 'independence' }], // independence | goodness | fisher
		['xIN', { val: -1 }], // rows (independence) / the tested column (goodness)
		['yIN', { val: -1 }], // columns (independence only)
		// How the two wired columns should be READ. This is orthogonal to testType
		// and it changes the answer completely, so it is an explicit choice rather
		// than something inferred:
		//   'paired' — one row per subject, two variables recorded (the classic
		//              tidy layout). Columns are the same length and pair by index.
		//   'groups' — two INDEPENDENT samples, each column holding that group's
		//              own outcomes. Usually different lengths ("7 of 10 vs 2 of 25").
		// DEFAULT IS 'groups'. In this app a column IS a data series, so two groups
		// in two columns is the natural shape, and the ports give no hint that
		// anything is paired. The paired reading also fails catastrophically and
		// SILENTLY when it is wrong (it truncates to the shorter column and
		// cross-tabulates unrelated rows), whereas a mis-set 'groups' at least uses
		// all the data and produces an interpretable table. Sessions saved before
		// this param existed therefore switch to the group reading; the demos that
		// genuinely are paired pin dataFormat: 'paired' explicitly.
		['dataFormat', { val: 'groups' }],
		['correction', { val: true }], // Yates' correction for 2×2 independence
		['alternative', { val: 'two-sided' }], // Fisher only: two-sided | less | greater
		// effectSize: Cramer's V (independence), Cohen's w (goodness-of-fit), or the
		// odds ratio (Fisher). One port, because only one is ever meaningful at a time.
		[
			'out',
			{
				statistic: { val: -1 },
				pvalue: { val: -1 },
				df: { val: -1 },
				effectSize: { val: -1 },
				// Fisher only: the exact confidence interval for the odds ratio.
				// NaN in the two chi-squared modes, which have no interval.
				ciLow: { val: -1 },
				ciHigh: { val: -1 }
			}
		],
		// oddsRatio is Fisher-only and stays NaN in the two chi-squared modes.
		['valid', { val: false }]
	]);

	const isRef = (id) => id != null && id !== -1 && getColumnById(id);
	const isNumericCol = (data) =>
		data.length > 0 && data.every((v) => v === null || v === '' || Number.isFinite(Number(v)));

	/**
	 * Turn the two wired columns into a contingency table, honouring dataFormat.
	 *
	 * Also returns any format warnings. The one that matters: in 'paired' mode the
	 * columns pair BY INDEX, so two columns of very different lengths are almost
	 * always independent groups wired into the paired reading — which silently
	 * truncates to the shorter column and cross-tabulates unrelated rows.
	 */
	function buildTable(argsIN) {
		const rowVar = getColumnById(argsIN.xIN);
		const colVar = getColumnById(argsIN.yIN);
		const a = rowVar?.getData() ?? [];
		const b = colVar?.getData() ?? [];
		const warnings = [];

		if (argsIN.dataFormat === 'groups') {
			const built = groupsToTable([a, b], [rowVar?.name ?? 'Group 1', colVar?.name ?? 'Group 2']);
			return { ...built, warnings, format: 'groups' };
		}

		const built = contingencyTable(a, b);
		// Length mismatch is the tell-tale of the wrong format being chosen.
		const nA = a.filter((v) => !isMissingCategory(v)).length;
		const nB = b.filter((v) => !isMissingCategory(v)).length;
		if (nA > 0 && nB > 0 && Math.abs(nA - nB) > 0.1 * Math.max(nA, nB)) {
			warnings.push(
				`"Paired" reads the two columns one row per subject and pairs them BY INDEX, but they have very different lengths (${nA} vs ${nB}), so that pairing cannot be right — the extra rows are discarded and the pairing is arbitrary. If these are two INDEPENDENT groups (e.g. 7 of 10 vs 2 of 25), switch Input format back to "Two independent groups".`
			);
		}
		return { ...built, warnings, format: 'paired' };
	}

	export function chisquared(argsIN) {
		fillDefaults(argsIN, defaults);
		const testType = ['goodness', 'fisher'].includes(argsIN.testType)
			? argsIN.testType
			: 'independence';
		const warnings = [];

		if (testType === 'fisher') {
			if (!isRef(argsIN.xIN) || !isRef(argsIN.yIN)) return [null, false];
			const rowVar = getColumnById(argsIN.xIN);
			const colVar = getColumnById(argsIN.yIN);
			const builtF = buildTable(argsIN);
			warnings.push(...builtF.warnings);
			const fx =
				builtF.table.length === 2 && builtF.table[0]?.length === 2
					? {
							...fisherExact(builtF.table, argsIN.alternative ?? 'two-sided'),
							table: builtF.table,
							rowLabels: builtF.rowLabels,
							colLabels: builtF.colLabels,
							n: builtF.table.flat().reduce((x, y) => x + y, 0)
						}
					: {
							valid: false,
							reason: `Fisher's exact test needs exactly 2 categories in each variable (found ${builtF.rowLabels.length} and ${builtF.colLabels.length}).`,
							table: builtF.table,
							rowLabels: builtF.rowLabels,
							colLabels: builtF.colLabels,
							n: 0,
							pvalue: NaN,
							oddsRatio: NaN,
							alternative: argsIN.alternative ?? 'two-sided'
						};
			if (!fx.valid) {
				return [
					{
						testType,
						warnings: [fx.reason],
						rowLabels: fx.rowLabels,
						colLabels: fx.colLabels,
						table: fx.table,
						statistic: NaN,
						pvalue: NaN,
						df: NaN,
						oddsRatio: NaN
					},
					true
				];
			}
			if (fx.n < 2) warnings.push('Too few complete pairs to test.');
			const result = {
				testType,
				rowLabels: fx.rowLabels,
				colLabels: fx.colLabels,
				table: fx.table,
				n: fx.n,
				// An exact test has no test statistic and no degrees of freedom; the
				// odds ratio is the effect size that goes with it.
				statistic: NaN,
				pvalue: fx.pvalue,
				df: NaN,
				oddsRatio: fx.oddsRatio,
				conditionalOddsRatio: fx.conditionalOddsRatio,
				oddsRatioCI: fx.oddsRatioCI,
				// The conditional MLE is the headline effect size: it is what R's
				// fisher.test reports and it is the estimate the CI belongs to.
				effectSize: fx.conditionalOddsRatio,
				effectSizeName: 'odds ratio (conditional MLE)',
				alternative: fx.alternative,
				warnings
			};
			writeChiOutputs(argsIN, result);
			return [result, true];
		}

		if (testType === 'independence') {
			if (!isRef(argsIN.xIN) || !isRef(argsIN.yIN)) return [null, false];
			const built = buildTable(argsIN);
			const { rowLabels, colLabels, table } = built;
			warnings.push(...built.warnings);
			if (rowLabels.length < 2 || colLabels.length < 2) {
				return [
					{
						testType,
						warnings: ['Independence needs at least two categories in each variable.'],
						rowLabels,
						colLabels,
						table: [],
						statistic: NaN,
						pvalue: NaN,
						df: NaN
					},
					true
				];
			}
			const res = chiSquareIndependence(table, !!argsIN.correction);
			// Expected-count assumption check (Cochran's rule).
			const small = res.expected.flat().filter((e) => e < 5).length;
			if (small)
				warnings.push(
					`${small} of ${res.expected.flat().length} expected counts are below 5; the χ² approximation is unreliable (consider Fisher's exact test).`
				);
			{
				const is2x2 = rowLabels.length === 2 && colLabels.length === 2;
				const result = {
					testType,
					rowLabels,
					colLabels,
					table,
					expected: res.expected,
					statistic: res.statistic,
					pvalue: res.pvalue,
					df: res.df,
					// Cramer's V on any table. phi is reported additionally on a 2x2,
					// where it carries a SIGN that V cannot (V is a square root).
					effectSize: res.cramersV,
					effectSizeName: is2x2 ? "Cramer's V (= |phi|)" : "Cramer's V",
					phi: res.phi,
					effectSizeLabel: effectSizeLabel(res.cramersV),
					n: res.n,
					warnings
				};
				writeChiOutputs(argsIN, result); // write from the func so doProcess() bakes real columns
				return [result, true];
			}
		}

		// goodness-of-fit
		if (!isRef(argsIN.xIN)) return [null, false];
		const col = getColumnById(argsIN.xIN);
		const raw = col.getData() ?? [];
		let labels;
		let observed;
		if (isNumericCol(raw)) {
			// Drop missing cells BEFORE coercion: Number(null) and Number('') are both 0, which
			// Number.isFinite keeps — so a partially-missing count vector would gain phantom
			// zero-count bins, inflating k/df and shifting the expected counts and p-value.
			observed = raw
				.filter((v) => v != null && v !== '')
				.map(Number)
				.filter(Number.isFinite);
			labels = observed.map((_, i) => `bin ${i + 1}`);
		} else {
			const counts = new Map();
			for (const v of raw) {
				if (isMissingCategory(v)) continue; // NaN is missing, not a category
				const k = String(v);
				counts.set(k, (counts.get(k) ?? 0) + 1);
			}
			labels = [...counts.keys()];
			observed = [...counts.values()];
		}
		if (observed.length < 2)
			return [
				{
					testType,
					warnings: ['Goodness-of-fit needs at least two categories / counts.'],
					labels,
					observed,
					statistic: NaN,
					pvalue: NaN,
					df: NaN
				},
				true
			];
		const res = chiSquareGoodnessOfFit(observed, null);
		const expected = observed.map(() => observed.reduce((s, v) => s + v, 0) / observed.length);
		if (expected.some((e) => e < 5))
			warnings.push(
				'Some expected counts are below 5; the χ² approximation is unreliable at these counts.'
			);
		const nTotal = observed.reduce((a, b) => a + b, 0);
		const w = cohensW(res.statistic, nTotal);
		const result = {
			testType,
			labels,
			observed,
			expected,
			statistic: res.statistic,
			pvalue: res.pvalue,
			df: res.df,
			effectSize: w,
			effectSizeName: "Cohen's w",
			effectSizeLabel: effectSizeLabel(w),
			n: nTotal,
			warnings
		};
		writeChiOutputs(argsIN, result); // write from the func so doProcess() bakes real columns
		return [result, true];
	}

	function writeChiOutputs(argsIN, result) {
		// Gate on the P-VALUE, not the statistic: Fisher's exact has no test
		// statistic (statistic is NaN by design), so gating on it would silently
		// write nothing for that whole mode.
		if (!result || Number.isNaN(result.pvalue)) return;
		const processHash = crypto.randomUUID();
		writeOutputColumn(argsIN.out?.statistic, [result.statistic], { processHash });
		writeOutputColumn(argsIN.out?.pvalue, [result.pvalue], { processHash });
		writeOutputColumn(argsIN.out?.df, [result.df], { processHash });
		writeOutputColumn(argsIN.out?.effectSize, [result.effectSize ?? NaN], { processHash });
		writeOutputColumn(argsIN.out?.ciLow, [result.oddsRatioCI?.[0] ?? NaN], { processHash });
		writeOutputColumn(argsIN.out?.ciHigh, [result.oddsRatioCI?.[1] ?? NaN], { processHash });
	}

	export const definition = {
		displayName,
		defaults,
		func: chisquared,
		columnIdFields: { scalar: ['xIN', 'yIN'], array: [] },
		nodeSpec: {
			id: 'tableprocess.chisquared',
			inputs: [
				{ name: 'xIN', kind: 'column', cardinality: 'one' },
				{ name: 'yIN', kind: 'column', cardinality: 'one' }
			],
			outputs: [
				{ name: 'statistic', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'pvalue', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'df', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'effectSize', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'ciLow', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'ciHigh', kind: 'column', cardinality: 'one', metric: true }
			]
		}
	};

	const fmt = (v) =>
		v == null || Number.isNaN(v)
			? '—'
			: Number(v)
					.toPrecision(4)
					.replace(/\.?0+$/, '');
</script>

<script>
	// @ts-nocheck
	import { onMount, untrack } from 'svelte';
	let { p = $bindable() } = $props();
	let mounted = $state(false);
	let result = $state({ statistic: NaN, pvalue: NaN, df: NaN, warnings: [] });

	function recompute() {
		const [res, valid] = chisquared(p.args);
		p.args.valid = valid;
		result = res ?? { statistic: NaN, pvalue: NaN, df: NaN, warnings: [] };
		p.warnings = result.warnings ?? [];
		// Record the result so a remount (a view switch rebuilds this component)
		// can restore it instead of running the analysis again.
		memo.hash = getHash;
		memo.payload = result;
	}

	let getHash = $derived.by(() => {
		let h =
			String(p.args.testType) +
			':' +
			String(p.args.correction) +
			':' +
			String(p.args.alternative) +
			':' +
			String(p.args.dataFormat);
		for (const id of [p.args.xIN, p.args.yIN])
			h += ':' + (id >= 0 ? (getColumnById(id)?.getDataHash ?? '') : '');
		return h;
	});
	onMount(() => {
		mounted = true;
		// Nothing changed since this node last ran? Put the previous result back
		// rather than recomputing: result lives only in this component, so it
		// was lost when the view switch destroyed the last instance.
		restoreOrCompute(
			memo,
			getHash,
			(cached) => {
				result = cached;
				p.warnings = cached?.warnings ?? [];
			},
			recompute
		);
	});
	// Backed by the session-lifetime compute memo, so a view switch (which destroys
	// and rebuilds this component) does not recompute unchanged inputs.
	const memo = nodeMemo(p, 'tableprocess');
	$effect(() => {
		const hash = getHash;
		if (!mounted || hash === memo.hash) return;
		memo.hash = hash;
		queueMicrotask(() => untrack(() => recompute()));
	});
</script>

<div class="control-input-vertical">
	<ControlInput label="Test">
		<AttributeSelect
			bind:value={p.args.testType}
			options={['independence', 'goodness', 'fisher']}
			optionsDisplay={[
				'Independence (2 categories)',
				'Goodness-of-fit (vs uniform)',
				"Fisher's exact (2x2, small samples)"
			]}
		/>
	</ControlInput>
	{#if p.args.testType !== 'goodness'}
		<ControlInput label="Input format">
			<AttributeSelect
				bind:value={p.args.dataFormat}
				options={['paired', 'groups']}
				optionsDisplay={['Paired (one row per subject)', 'Two independent groups']}
			/>
		</ControlInput>
		{#if p.args.dataFormat === 'groups'}
			<p class="hint">
				Each column is one group's own outcomes; the columns may be different lengths (e.g. 7 of 10
				vs 2 of 25).
			</p>
		{:else}
			<p class="hint">
				Each row is one subject with both variables recorded; the columns pair by row and must be
				the same length.
			</p>
		{/if}
	{/if}
	{#if p.args.testType === 'independence'}
		<ControlInput label="Yates' correction (2×2)">
			<input type="checkbox" bind:checked={p.args.correction} />
		</ControlInput>
	{:else if p.args.testType === 'fisher'}
		<ControlInput label="Alternative">
			<AttributeSelect
				bind:value={p.args.alternative}
				options={['two-sided', 'less', 'greater']}
				optionsDisplay={['Two-sided', 'One-sided (less)', 'One-sided (greater)']}
			/>
		</ControlInput>
	{/if}
	{#if Number.isFinite(result.pvalue)}
		{#if result.testType === 'fisher'}
			<p class="hint">
				p = <strong>{fmt(result.pvalue)}</strong> ({result.alternative}), n = {result.n}.
				<br />
				<span class="muted"
					>An exact test enumerates the distribution rather than referring a statistic to one, so
					there is no test statistic and no degrees of freedom — the statistic and df ports stay
					empty in this mode.</span
				>
				<br />
				Odds ratio =
				<strong
					>{result.conditionalOddsRatio === Infinity
						? '∞'
						: fmt(result.conditionalOddsRatio)}</strong
				>
				{#if result.oddsRatioCI}
					(95% CI {result.oddsRatioCI[0] === 0 ? '0' : fmt(result.oddsRatioCI[0])} to {result
						.oddsRatioCI[1] === Infinity
						? '∞'
						: fmt(result.oddsRatioCI[1])})
				{/if}
				<br />
				<span class="muted"
					>conditional MLE; the sample odds ratio ad/bc is {result.oddsRatio === Infinity
						? '∞'
						: fmt(result.oddsRatio)}</span
				>
			</p>
		{:else}
			<p class="hint">
				χ² = <strong>{fmt(result.statistic)}</strong>, df = {result.df}, p =
				<strong>{fmt(result.pvalue)}</strong>.
				{#if Number.isFinite(result.effectSize)}
					<br />
					{result.effectSizeName} = <strong>{fmt(result.effectSize)}</strong>
					{#if result.effectSizeLabel}({result.effectSizeLabel}){/if}{#if Number.isFinite(result.phi)},
						φ =
						<strong>{fmt(result.phi)}</strong>{/if}, n = {result.n}.
				{/if}
			</p>
		{/if}
		{#if (result.testType === 'independence' || result.testType === 'fisher') && result.table?.length}
			<details class="tp-output-panel" open>
				<summary class="tp-output-summary">Contingency table</summary>
				<table class="d-table">
					<thead>
						<tr
							><th></th>{#each result.colLabels as c (c)}<th>{c}</th>{/each}</tr
						>
					</thead>
					<tbody>
						{#each result.table as row, r (result.rowLabels[r])}
							<tr>
								<td class="rowlab">{result.rowLabels[r]}</td>
								<!-- Key on the COLUMN INDEX, not the cell value: two equal counts in
								     one row (very common — a table with two zeros) produced the same
								     key and crashed the render with each_key_duplicate. -->
								{#each row as cell, c (c)}<td class="num">{cell}</td>{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</details>
		{:else if result.testType === 'goodness' && result.observed?.length}
			<details class="tp-output-panel" open>
				<summary class="tp-output-summary">Observed vs expected</summary>
				<table class="d-table">
					<thead>
						<tr><th>category</th><th>obs</th><th>exp</th></tr>
					</thead>
					<tbody>
						{#each result.observed as o, i (result.labels[i])}
							<tr>
								<td class="rowlab">{result.labels[i]}</td>
								<td class="num">{o}</td>
								<td class="num">{fmt(result.expected?.[i])}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</details>
		{/if}
	{/if}
	{#each result.warnings as w (w)}
		<p class="warn">{w}</p>
	{/each}
</div>

<style>
	.hint {
		font-size: var(--font-xs);
		color: var(--color-text-muted);
		margin: var(--space-2) 0 0;
	}
	.warn {
		font-size: var(--font-xs);
		color: var(--color-warning-text);
		background: var(--color-warning-bg);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		margin: var(--space-1) 0 0;
	}
	.tp-output-panel {
		margin-top: var(--space-2);
		padding: var(--space-2);
		border: 1px solid var(--color-lightness-85);
		border-radius: var(--radius-sm);
		background: var(--color-lightness-99);
		font-size: var(--font-xs);
		line-height: 1.25;
	}
	.tp-output-panel[open] {
		max-height: 14rem;
		overflow: auto;
		scrollbar-gutter: stable;
	}
	.tp-output-summary {
		cursor: pointer;
		font-weight: 600;
		position: sticky;
		top: 0;
		background: var(--color-lightness-99);
	}
	.d-table {
		width: 100%;
		border-collapse: collapse;
		margin-top: var(--space-1);
	}
	.d-table th {
		text-align: right;
		font-weight: 600;
		color: var(--color-text-muted);
		padding: 0.1rem 0.3rem;
	}
	.d-table th:first-child {
		text-align: left;
	}
	.d-table td {
		padding: 0.1rem 0.3rem;
	}
	.d-table .rowlab {
		text-align: left;
		font-weight: 600;
		white-space: nowrap;
	}
	.d-table .num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
</style>
