<script module>
	// @ts-nocheck
	// Normality test — is each wired column drawn from a normal distribution?
	//
	// Many-column yIN → one row per variable: statistic, p-value, n, and a `normal` verdict at
	// the chosen alpha. Three tests (utils/normality.js, scipy-parity-checked):
	//   • Shapiro-Wilk (Royston) — the default and most powerful; valid for 3 ≤ n ≤ 5000.
	//   • D'Agostino-Pearson K² (scipy normaltest) — omnibus skew + kurtosis, needs n ≥ 8.
	//   • Jarque-Bera — the same moment idea, valid down to n ≥ 3 but weaker in small samples.
	// Output is fixed long-form columns so it composes (filter non-normal, feed a table, etc.).
	import { getColumnById } from '$lib/core/Column.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import { writeOutputColumn } from '$lib/tableProcesses/outputColumns.js';
	import { fillDefaults, normalizeYInputs } from '$lib/tableProcesses/tpArgHelpers.js';
	import { normalityTest } from '$lib/utils/normality.js';

	const displayName = 'Normality Test';
	const OUT_KEYS = ['variable', 'statistic', 'pvalue', 'n', 'normal'];

	const defaults = new Map([
		['yIN', { val: [] }],
		['method', { val: 'shapiro' }], // shapiro | dagostino | jarquebera
		['alpha', { val: 0.05 }],
		['out', { ...Object.fromEntries(OUT_KEYS.map((k) => [k, { val: -1 }])) }],
		['valid', { val: false }]
	]);

	export function normalitytest(argsIN) {
		fillDefaults(argsIN, defaults);
		const yIds = normalizeYInputs(argsIN.yIN).filter((id) => id != null && id !== -1 && getColumnById(id));
		if (yIds.length === 0) return [null, false];

		const method = argsIN.method === 'jarquebera' ? 'jarquebera' : argsIN.method === 'dagostino' ? 'dagostino' : 'shapiro';
		const alpha = Number(argsIN.alpha) || 0.05;

		const warnings = [];
		const rows = yIds.map((id) => {
			const col = getColumnById(id);
			const { statistic, pvalue, n } = normalityTest(col.getData() ?? [], method);
			// `normal`: 1 = fail to reject normality, 0 = reject (non-normal), NaN = not evaluable.
			const normal = Number.isNaN(pvalue) ? NaN : pvalue >= alpha ? 1 : 0;
			return { variable: col.name ?? String(id), statistic, pvalue, n, normal };
		});

		const minN = Math.min(...rows.map((r) => r.n).filter(Number.isFinite));
		const maxN = Math.max(...rows.map((r) => r.n).filter(Number.isFinite));
		if (method === 'dagostino' && Number.isFinite(minN) && minN < 20) {
			warnings.push(`Small sample: D'Agostino's kurtosis term is unreliable below n ≈ 20 (smallest here is ${minN}). Consider Shapiro-Wilk or treat the p-value cautiously.`);
		}
		if (method === 'shapiro' && Number.isFinite(maxN) && maxN > 5000) {
			warnings.push(`Large sample: Shapiro-Wilk is only defined up to n = 5000 (largest here is ${maxN}) and becomes over-sensitive to trivial departures. Use D'Agostino for large n.`);
		}
		if (rows.some((r) => Number.isNaN(r.pvalue))) {
			warnings.push('Some columns could not be tested (too few points, or no variance) and are reported as NaN.');
		}
		const nonNormal = rows.filter((r) => r.normal === 0).map((r) => r.variable);
		if (nonNormal.length) {
			warnings.push(`Non-normal at α=${alpha}: ${nonNormal.join(', ')}. Prefer rank / non-parametric methods for ${nonNormal.length === 1 ? 'this variable' : 'these variables'}.`);
		}

		return [{ rows, methodUsed: method, warnings }, true];
	}

	function writeNormalityOutputs(argsIN, result) {
		if (!result?.rows) return;
		const processHash = crypto.randomUUID();
		const col = (key) => result.rows.map((r) => r[key]);
		writeOutputColumn(argsIN.out?.variable, col('variable'), { processHash, type: 'category' });
		writeOutputColumn(argsIN.out?.statistic, col('statistic'), { processHash });
		writeOutputColumn(argsIN.out?.pvalue, col('pvalue'), { processHash });
		writeOutputColumn(argsIN.out?.n, col('n'), { processHash });
		writeOutputColumn(argsIN.out?.normal, col('normal'), { processHash });
	}

	export const definition = {
		displayName,
		defaults,
		func: normalitytest,
		columnIdFields: { scalar: [], array: ['yIN'] },
		nodeSpec: {
			id: 'tableprocess.normalitytest',
			inputs: [{ name: 'yIN', kind: 'column', cardinality: 'many' }],
			outputs: OUT_KEYS.map((name) => ({ name, kind: 'column', cardinality: 'one' }))
		}
	};

	const METHOD_LABEL = { shapiro: 'Shapiro-Wilk', dagostino: "D'Agostino-Pearson", jarquebera: 'Jarque-Bera' };
	const fmt = (v) => (v == null || Number.isNaN(v) ? '—' : Math.abs(v) >= 1000 || (Math.abs(v) < 0.001 && v !== 0) ? Number(v).toExponential(2) : Number(v).toPrecision(4).replace(/\.?0+$/, ''));
</script>

<script>
	// @ts-nocheck
	import { onMount, untrack } from 'svelte';
	import { saveStaticDataAsCSV } from '$lib/components/plotbits/helpers/save.svelte.js';
	import { mutationService } from '$lib/core/mutationService.js';
	import { core } from '$lib/core/core.svelte.js';
	let { p = $bindable() } = $props();
	let mounted = $state(false);
	let result = $state({ rows: [], methodUsed: 'dagostino', warnings: [] });

	const getTableData = () => ({
		headers: OUT_KEYS,
		rows: (result.rows ?? []).map((r) => OUT_KEYS.map((k) => r[k]))
	});

	function recompute() {
		const [res, valid] = normalitytest(p.args);
		p.args.valid = valid;
		result = res ?? { rows: [], methodUsed: p.args.method, warnings: [] };
		p.warnings = result.warnings ?? [];
		if (valid) writeNormalityOutputs(p.args, result);
	}

	// Recompute when input DATA changes (getDataHash), not just when the ref list changes.
	let getHash = $derived.by(() => {
		let h = String(p.args.method) + ':' + String(p.args.alpha);
		for (const id of p.args.yIN ?? []) h += ':' + (id >= 0 ? getColumnById(id)?.getDataHash ?? '' : '');
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
			name: 'Normality results',
			type: 'tableplot',
			x: (pos.x ?? 0) + 360,
			y: pos.y ?? 0,
			width: 520,
			height: Math.min(460, 120 + (result.rows?.length ?? 0) * 26),
			plot: { columnRefs: [...outIds], showCol: outIds.map(() => true) }
		});
	}
</script>

<div class="control-input-vertical">
	<ControlInput label="Test">
		<AttributeSelect
			bind:value={p.args.method}
			options={['shapiro', 'dagostino', 'jarquebera']}
			optionsDisplay={['Shapiro-Wilk (3 ≤ n ≤ 5000)', "D'Agostino-Pearson (n ≥ 8)", 'Jarque-Bera (n ≥ 3)']}
		/>
	</ControlInput>
	<ControlInput label="Significance (α)">
		<NumberWithUnits bind:value={p.args.alpha} min="0.0001" max="0.9999" step="0.01" />
	</ControlInput>
	{#if result.rows.length}
		<p class="hint">{result.rows.length} variable{result.rows.length === 1 ? '' : 's'}, test: <strong>{METHOD_LABEL[result.methodUsed]}</strong>.</p>
		<details class="tp-output-panel" open>
			<summary class="tp-output-summary">Results</summary>
			<table class="d-table">
				<thead>
					<tr><th>var</th><th>stat</th><th>p</th><th>n</th><th>normal?</th></tr>
				</thead>
				<tbody>
					{#each result.rows as row (row.variable)}
						<tr title={`${row.variable}: statistic=${fmt(row.statistic)}, p=${fmt(row.pvalue)}, n=${row.n}`}>
							<td class="var">{row.variable}</td>
							<td class="num">{fmt(row.statistic)}</td>
							<td class="num">{fmt(row.pvalue)}</td>
							<td class="num">{row.n}</td>
							<td class="verdict" class:no={row.normal === 0} class:yes={row.normal === 1}>
								{row.normal === 1 ? 'yes' : row.normal === 0 ? 'no' : '—'}
							</td>
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
						saveStaticDataAsCSV('normality_test', headers, rows);
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
	.d-table th:first-child {
		text-align: left;
	}
	.d-table td {
		padding: 0.1rem 0.3rem;
	}
	.d-table .var {
		text-align: left;
		white-space: nowrap;
	}
	.d-table .num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.d-table .verdict {
		text-align: right;
		font-weight: 600;
	}
	.d-table .verdict.no {
		color: var(--color-warning-text);
	}
	.d-table .verdict.yes {
		color: var(--color-lightness-45);
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
