<script module>
	// @ts-nocheck
	// Chi-squared test — goodness-of-fit or test of independence.
	//
	// Two modes (testType):
	//   • independence: two categorical columns (xIN = rows, yIN = columns). Cross-tabulated into
	//     a contingency table, then Pearson's χ² tests whether the two variables are associated.
	//     Yates' continuity correction is applied to 2×2 tables (matching scipy's default).
	//   • goodness: one column (xIN). A categorical column is tabulated into category counts and
	//     tested against a uniform expectation ("are the categories equally frequent?"); a numeric
	//     column is read directly as observed counts.
	// Outputs three metric columns (statistic, pvalue, df). Maths is the pure, scipy-parity-checked
	// utils/chisquare.js. The contingency / observed-vs-expected table is shown in-node.
	import { getColumnById } from '$lib/core/Column.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import { writeOutputColumn } from '$lib/tableProcesses/outputColumns.js';
	import { fillDefaults } from '$lib/tableProcesses/tpArgHelpers.js';
	import { chiSquareGoodnessOfFit, chiSquareIndependence, contingencyTable } from '$lib/utils/chisquare.js';

	const displayName = 'Chi-squared test';

	const defaults = new Map([
		['testType', { val: 'independence' }], // independence | goodness
		['xIN', { val: -1 }], // rows (independence) / the tested column (goodness)
		['yIN', { val: -1 }], // columns (independence only)
		['correction', { val: true }], // Yates' correction for 2×2 independence
		['out', { statistic: { val: -1 }, pvalue: { val: -1 }, df: { val: -1 } }],
		['valid', { val: false }]
	]);

	const isRef = (id) => id != null && id !== -1 && getColumnById(id);
	const isNumericCol = (data) => data.length > 0 && data.every((v) => v === null || v === '' || Number.isFinite(Number(v)));

	export function chisquared(argsIN) {
		fillDefaults(argsIN, defaults);
		const testType = argsIN.testType === 'goodness' ? 'goodness' : 'independence';
		const warnings = [];

		if (testType === 'independence') {
			if (!isRef(argsIN.xIN) || !isRef(argsIN.yIN)) return [null, false];
			const rowVar = getColumnById(argsIN.xIN);
			const colVar = getColumnById(argsIN.yIN);
			const { rowLabels, colLabels, table } = contingencyTable(rowVar.getData() ?? [], colVar.getData() ?? []);
			if (rowLabels.length < 2 || colLabels.length < 2) {
				return [{ testType, warnings: ['Independence needs at least two categories in each variable.'], rowLabels, colLabels, table: [], statistic: NaN, pvalue: NaN, df: NaN }, true];
			}
			const res = chiSquareIndependence(table, !!argsIN.correction);
			// Expected-count assumption check (Cochran's rule).
			const small = res.expected.flat().filter((e) => e < 5).length;
			if (small) warnings.push(`${small} of ${res.expected.flat().length} expected counts are below 5; the χ² approximation is unreliable (consider Fisher's exact test).`);
			return [{ testType, rowLabels, colLabels, table, expected: res.expected, statistic: res.statistic, pvalue: res.pvalue, df: res.df, warnings }, true];
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
			observed = raw.filter((v) => v != null && v !== '').map(Number).filter(Number.isFinite);
			labels = observed.map((_, i) => `bin ${i + 1}`);
		} else {
			const counts = new Map();
			for (const v of raw) {
				if (v == null || v === '') continue;
				const k = String(v);
				counts.set(k, (counts.get(k) ?? 0) + 1);
			}
			labels = [...counts.keys()];
			observed = [...counts.values()];
		}
		if (observed.length < 2) return [{ testType, warnings: ['Goodness-of-fit needs at least two categories / counts.'], labels, observed, statistic: NaN, pvalue: NaN, df: NaN }, true];
		const res = chiSquareGoodnessOfFit(observed, null);
		const expected = observed.map(() => observed.reduce((s, v) => s + v, 0) / observed.length);
		if (expected.some((e) => e < 5)) warnings.push('Some expected counts are below 5; the χ² approximation is unreliable at these counts.');
		return [{ testType, labels, observed, expected, statistic: res.statistic, pvalue: res.pvalue, df: res.df, warnings }, true];
	}

	function writeChiOutputs(argsIN, result) {
		if (!result || Number.isNaN(result.statistic)) return;
		const processHash = crypto.randomUUID();
		writeOutputColumn(argsIN.out?.statistic, [result.statistic], { processHash });
		writeOutputColumn(argsIN.out?.pvalue, [result.pvalue], { processHash });
		writeOutputColumn(argsIN.out?.df, [result.df], { processHash });
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
				{ name: 'df', kind: 'column', cardinality: 'one', metric: true }
			]
		}
	};

	const fmt = (v) => (v == null || Number.isNaN(v) ? '—' : Number(v).toPrecision(4).replace(/\.?0+$/, ''));
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
		if (valid) writeChiOutputs(p.args, result);
	}

	let getHash = $derived.by(() => {
		let h = String(p.args.testType) + ':' + String(p.args.correction);
		for (const id of [p.args.xIN, p.args.yIN]) h += ':' + (id >= 0 ? getColumnById(id)?.getDataHash ?? '' : '');
		return h;
	});
	onMount(() => {
		mounted = true;
		recompute();
	});
	let lastHash = '';
	$effect(() => {
		const hash = getHash;
		if (!mounted || hash === lastHash) return;
		lastHash = hash;
		queueMicrotask(() => untrack(() => recompute()));
	});
</script>

<div class="control-input-vertical">
	<ControlInput label="Test">
		<AttributeSelect
			bind:value={p.args.testType}
			options={['independence', 'goodness']}
			optionsDisplay={['Independence (2 categories)', 'Goodness-of-fit (vs uniform)']}
		/>
	</ControlInput>
	{#if p.args.testType === 'independence'}
		<ControlInput label="Yates' correction (2×2)">
			<input type="checkbox" bind:checked={p.args.correction} />
		</ControlInput>
	{/if}
	{#if Number.isFinite(result.statistic)}
		<p class="hint">χ² = <strong>{fmt(result.statistic)}</strong>, df = {result.df}, p = <strong>{fmt(result.pvalue)}</strong>.</p>
		{#if result.testType === 'independence' && result.table?.length}
			<details class="tp-output-panel" open>
				<summary class="tp-output-summary">Contingency table</summary>
				<table class="d-table">
					<thead>
						<tr><th></th>{#each result.colLabels as c (c)}<th>{c}</th>{/each}</tr>
					</thead>
					<tbody>
						{#each result.table as row, r (result.rowLabels[r])}
							<tr>
								<td class="rowlab">{result.rowLabels[r]}</td>
								{#each row as cell (cell + '_' + r)}<td class="num">{cell}</td>{/each}
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
