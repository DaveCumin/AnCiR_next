<script module>
	// @ts-nocheck
	// Cross-correlation — the cross-correlogram of two series.
	//
	// Two single-column inputs (series A = xIN, series B = yIN). For each lag k in
	// [-maxLag, maxLag], r(k) is the correlation between A[t] and B[t+k] on the overlapping
	// segment. Outputs three equal-length array columns (lag, correlation, pvalue) plus the peak
	// lag/r reported in-node. A peak at k>0 means B leads A by k samples. Maths is the pure,
	// numpy-parity-checked utils/crossCorrelation.js. Quick-plot draws the correlogram (lag vs r).
	import { getColumnById } from '$lib/core/Column.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import { writeOutputColumn } from '$lib/tableProcesses/outputColumns.js';
	import { fillDefaults } from '$lib/tableProcesses/tpArgHelpers.js';
	import { crossCorrelation } from '$lib/utils/crossCorrelation.js';

	const displayName = 'Cross-correlation';
	const OUT_KEYS = ['lag', 'correlation', 'pvalue'];

	const defaults = new Map([
		['xIN', { val: -1 }], // series A
		['yIN', { val: -1 }], // series B
		['maxLag', { val: 0 }], // 0 ⇒ auto (a quarter of the shorter series)
		['method', { val: 'pearson' }], // pearson | spearman
		['out', { ...Object.fromEntries(OUT_KEYS.map((k) => [k, { val: -1 }])) }],
		['valid', { val: false }]
	]);

	const isRef = (id) => id != null && id !== -1 && getColumnById(id);

	export function crosscorrelation(argsIN) {
		fillDefaults(argsIN, defaults);
		if (!isRef(argsIN.xIN) || !isRef(argsIN.yIN)) return [null, false];

		const a = getColumnById(argsIN.xIN);
		const b = getColumnById(argsIN.yIN);
		const method = argsIN.method === 'spearman' ? 'spearman' : 'pearson';
		const maxLag = Number(argsIN.maxLag) > 0 ? Number(argsIN.maxLag) : undefined;

		const res = crossCorrelation(a.getData() ?? [], b.getData() ?? [], { maxLag, method });
		if (!res.lags.length) return [null, false];

		const warnings = [];
		const minN = Math.min(...res.n.filter(Number.isFinite));
		if (Number.isFinite(minN) && minN < 10) {
			warnings.push(`The most-shifted lags overlap in only ${minN} points; their correlations are noisy. Reduce the max lag for steadier tails.`);
		}

		const result = {
			lag: res.lags,
			correlation: res.r,
			pvalue: res.pvalue,
			n: res.n,
			peakLag: res.peakLag,
			peakR: res.peakR,
			aName: a.name ?? String(argsIN.xIN),
			bName: b.name ?? String(argsIN.yIN),
			methodUsed: method,
			warnings
		};
		// Write from the func so doProcess() (MCP engine + demo generator) bakes real columns.
		writeCrossOutputs(argsIN, result);
		return [result, true];
	}

	function writeCrossOutputs(argsIN, result) {
		if (!result?.lag) return;
		const processHash = crypto.randomUUID();
		writeOutputColumn(argsIN.out?.lag, result.lag, { processHash });
		writeOutputColumn(argsIN.out?.correlation, result.correlation, { processHash });
		writeOutputColumn(argsIN.out?.pvalue, result.pvalue, { processHash });
	}

	export const definition = {
		displayName,
		defaults,
		func: crosscorrelation,
		columnIdFields: { scalar: ['xIN', 'yIN'], array: [] },
		// The output X (lag) is a different quantity from the input series axis, so the raw data
		// must never be overlaid — the Quick-Plot handles this by plotting lag vs correlation only.
		nodeSpec: {
			id: 'tableprocess.crosscorrelation',
			inputs: [
				{ name: 'xIN', kind: 'column', cardinality: 'one' },
				{ name: 'yIN', kind: 'column', cardinality: 'one' }
			],
			outputs: OUT_KEYS.map((name) => ({ name, kind: 'column', cardinality: 'one' }))
		}
	};

	const fmt = (v) => (v == null || Number.isNaN(v) ? '—' : Number(v).toPrecision(4).replace(/\.?0+$/, ''));
</script>

<script>
	// @ts-nocheck
	import { onMount, untrack } from 'svelte';
	import { saveStaticDataAsCSV } from '$lib/components/plotbits/helpers/save.svelte.js';
	import { mutationService } from '$lib/core/mutationService.js';
	import { core } from '$lib/core/core.svelte.js';
	let { p = $bindable() } = $props();
	let mounted = $state(false);
	let result = $state({ lag: [], correlation: [], pvalue: [], warnings: [] });

	const getTableData = () => ({
		headers: ['lag', 'correlation', 'pvalue', 'n'],
		rows: (result.lag ?? []).map((_, i) => [result.lag[i], result.correlation[i], result.pvalue[i], result.n?.[i]])
	});

	function recompute() {
		const [res, valid] = crosscorrelation(p.args);
		p.args.valid = valid;
		result = res ?? { lag: [], correlation: [], pvalue: [], warnings: [] };
		p.warnings = result.warnings ?? [];
	}

	// Recompute when either input's DATA changes, not just the refs.
	let getHash = $derived.by(() => {
		let h = String(p.args.method) + ':' + String(p.args.maxLag);
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

	function openFullTable() {
		const outIds = OUT_KEYS.map((k) => p.args.out?.[k]).filter((id) => id != null && id >= 0);
		if (!outIds.length) return;
		const pos = core.nodeLayout?.[`tableprocess_${p.id}`] ?? { x: 200, y: 200 };
		mutationService.addPlot({
			name: 'Cross-correlation',
			type: 'tableplot',
			x: (pos.x ?? 0) + 360,
			y: pos.y ?? 0,
			width: 420,
			height: Math.min(460, 120 + (result.lag?.length ?? 0) * 22),
			plot: { columnRefs: [...outIds], showCol: outIds.map(() => true) }
		});
	}
</script>

<div class="control-input-vertical">
	<ControlInput label="Method">
		<AttributeSelect
			bind:value={p.args.method}
			options={['pearson', 'spearman']}
			optionsDisplay={['Pearson (linear)', 'Spearman (rank / monotonic)']}
		/>
	</ControlInput>
	<ControlInput label="Max lag (0 = auto)">
		<NumberWithUnits bind:value={p.args.maxLag} min="0" step="1" />
	</ControlInput>
	{#if result.lag.length}
		<p class="hint">
			Peak at lag <strong>{result.peakLag}</strong> (r = {fmt(result.peakR)}).
			{#if Number.isFinite(result.peakLag) && result.peakLag !== 0}
				{result.peakLag > 0 ? result.bName : result.aName} leads by {Math.abs(result.peakLag)}.
			{/if}
			Quick-plot for the correlogram.
		</p>
		<details class="tp-output-panel" open>
			<summary class="tp-output-summary">{result.aName} × {result.bName}</summary>
			<table class="d-table">
				<thead>
					<tr><th>lag</th><th>r</th><th>p</th></tr>
				</thead>
				<tbody>
					{#each result.lag as lg, i (lg)}
						<tr class:peak={lg === result.peakLag}>
							<td class="num">{lg}</td>
							<td class="num">{fmt(result.correlation[i])}</td>
							<td class="num">{fmt(result.pvalue[i])}</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<div class="tp-stat-actions">
				<button class="tp-stat-btn" onclick={openFullTable}>Open full table</button>
				<button
					class="tp-stat-btn"
					onclick={() => {
						const { headers, rows } = getTableData();
						saveStaticDataAsCSV('cross_correlation', headers, rows);
					}}>Download CSV</button
				>
			</div>
		</details>
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
	.d-table td {
		padding: 0.1rem 0.3rem;
	}
	.d-table .num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.d-table tr.peak {
		background: var(--color-hover);
		font-weight: 600;
	}
	.tp-stat-actions {
		display: flex;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}
	.tp-stat-btn {
		font: inherit;
		font-size: var(--font-2xs);
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--color-lightness-85);
		border-radius: var(--radius-sm);
		background: var(--color-lightness-99);
		color: var(--color-lightness-25);
		cursor: pointer;
	}
	.tp-stat-btn:hover {
		border-color: var(--color-accent);
		background: var(--color-hover);
	}
</style>
