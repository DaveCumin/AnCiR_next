<script module>
	// @ts-nocheck
	// Correlation — every pairwise correlation among the wired columns, in tidy long form.
	//
	// Inputs: yIN (many columns, no x). Output: one ROW per unique pair (upper triangle,
	// diagonal excluded) — var_i, var_j, r, pvalue, n — as five fixed output columns of equal
	// length. Long form (not a wide matrix) so it composes: sort by |r|, filter r>0.7, feed a
	// table / FDR node / the correlation-heatmap plot.
	//
	// ONE method is chosen for the whole matrix so the cells are comparable. `auto` picks
	// Spearman if ANY input fails a Jarque-Bera normality check, else Pearson — the same
	// assumption-aware auto-selection GroupComparison uses. Maths lives in utils/correlation.js
	// (pure, Python-parity-checked); this file is wiring + the warnings surface.
	import { getColumnById } from '$lib/core/Column.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import { writeOutputColumn } from '$lib/tableProcesses/outputColumns.js';
	import { fillDefaults, normalizeYInputs } from '$lib/tableProcesses/tpArgHelpers.js';
	import { correlationMatrix } from '$lib/utils/correlation.js';
	import { jarqueBeraNormality } from '$lib/tableProcesses/GroupComparison.svelte';

	const displayName = 'Correlation';

	const OUT_KEYS = ['var_i', 'var_j', 'r', 'pvalue', 'n'];

	const defaults = new Map([
		['yIN', { val: [] }],
		['method', { val: 'auto' }], // auto | pearson | spearman
		['alpha', { val: 0.05 }],
		[
			'out',
			{
				var_i: { val: -1 },
				var_j: { val: -1 },
				r: { val: -1 },
				pvalue: { val: -1 },
				n: { val: -1 }
			}
		],
		['valid', { val: false }]
	]);

	/** Auto-select one method for the whole matrix, and gather the assumption warnings. */
	function chooseMethod(requested, columns, names) {
		const warnings = [];
		let method = requested === 'spearman' ? 'spearman' : requested === 'pearson' ? 'pearson' : 'pearson';

		if (requested === 'auto') {
			const nonNormal = [];
			for (let k = 0; k < columns.length; k++) {
				const jb = jarqueBeraNormality(columns[k]);
				if (jb.evaluable && jb.normal === false) nonNormal.push(names[k]);
			}
			if (nonNormal.length) {
				method = 'spearman';
				warnings.push(
					`Auto-selected Spearman: ${nonNormal.join(', ')} ${nonNormal.length === 1 ? 'is' : 'are'} non-normal by Jarque-Bera, so a rank correlation is safer than Pearson.`
				);
			}
		}
		return { method, warnings };
	}

	export function correlation(argsIN) {
		fillDefaults(argsIN, defaults);
		const yIds = normalizeYInputs(argsIN.yIN).filter((id) => id != null && id !== -1 && getColumnById(id));
		if (yIds.length < 2) return [null, false];

		const columns = yIds.map((id) => getColumnById(id).getData() ?? []);
		const names = yIds.map((id) => getColumnById(id).name ?? String(id));

		const { method, warnings } = chooseMethod(argsIN.method ?? 'auto', columns, names);
		const rows = correlationMatrix(columns, names, method);

		// Aggregate, deduplicated result-quality warnings.
		const minN = Math.min(...rows.map((row) => row.n));
		if (Number.isFinite(minN) && minN < 10) {
			warnings.push(`Small sample: at least one pair has only n = ${minN} usable points; p-values are unreliable below ~10.`);
		}
		if (method === 'spearman' && rows.some((row) => row.tiesX || row.tiesY)) {
			warnings.push('Tied values are present; the Spearman p-value is approximate when there are many ties.');
		}
		if (rows.some((row) => Number.isNaN(row.r))) {
			warnings.push('Some pairs could not be computed (a column with no variance, or too few overlapping points) and are reported as NaN.');
		}

		// Write outputs from the func so doProcess() (MCP engine + demo generator) bakes real
		// columns; writeOutputColumn no-ops on unwired (-1) keys, so pure-result callers are safe.
		const result = { rows, methodUsed: method, warnings };
		writeCorrelationOutputs(argsIN, result);
		return [result, true];
	}

	function writeCorrelationOutputs(argsIN, result) {
		if (!result?.rows) return;
		const processHash = crypto.randomUUID();
		const col = (key) => result.rows.map((row) => row[key]);
		writeOutputColumn(argsIN.out?.var_i, col('var_i'), { processHash, type: 'category' });
		writeOutputColumn(argsIN.out?.var_j, col('var_j'), { processHash, type: 'category' });
		writeOutputColumn(argsIN.out?.r, col('r'), { processHash });
		writeOutputColumn(argsIN.out?.pvalue, col('pvalue'), { processHash });
		writeOutputColumn(argsIN.out?.n, col('n'), { processHash });
	}

	export const definition = {
		displayName,
		defaults,
		func: correlation,
		columnIdFields: { scalar: [], array: ['yIN'] },
		nodeSpec: {
			id: 'tableprocess.correlation',
			inputs: [{ name: 'yIN', kind: 'column', cardinality: 'many' }],
			outputs: OUT_KEYS.map((name) => ({ name, kind: 'column', cardinality: 'one' }))
		}
	};
</script>

<script>
	// @ts-nocheck
	import { onMount, untrack } from 'svelte';
	import { saveStaticDataAsCSV } from '$lib/components/plotbits/helpers/save.svelte.js';
	import { mutationService } from '$lib/core/mutationService.js';
	import { core } from '$lib/core/core.svelte.js';
	let { p = $bindable() } = $props();
	let mounted = $state(false);
	let result = $state({ rows: [], methodUsed: 'pearson', warnings: [] });

	// "Open full table" — create a tableplot WIRED to the node's real output columns, not a
	// static snapshot. The old showStaticDataAsTable spawned a frozen Data View at a fixed
	// (80,80) with no edge to this node; a tableplot on the output columns is live (reflects
	// re-computation) AND connected — the graph draws real edges from the output ports to it
	// (ProcessNode gathers a tableplot's columnRefs). Placed downstream of this node.
	function openFullTable() {
		const outIds = OUT_KEYS.map((k) => p.args.out?.[k]).filter((id) => id != null && id >= 0);
		if (!outIds.length) return;
		const pos = core.nodeLayout?.[`tableprocess_${p.id}`] ?? { x: 200, y: 200 };
		mutationService.addPlot({
			name: 'Correlation table',
			type: 'tableplot',
			x: (pos.x ?? 0) + 360,
			y: pos.y ?? 0,
			width: 460,
			height: Math.min(460, 120 + (result.rows?.length ?? 0) * 26),
			plot: { columnRefs: [...outIds], showCol: outIds.map(() => true) }
		});
	}

	// In-node results, mirroring the other analysis nodes (GroupComparison etc.): show the
	// matrix so the numbers are readable without wiring a plot, plus the shared Open-full-table
	// / Download-CSV actions. The output PORTS still carry the same data for downstream wiring.
	const HEADERS = ['var_i', 'var_j', 'r', 'pvalue', 'n'];
	const fmt = (v) => (v == null || Number.isNaN(v) ? '—' : Number(v).toPrecision(4).replace(/\.?0+$/, ''));
	// getStaticData() rebuilds full-precision rows for the table/CSV helpers.
	const getTableData = () => ({
		headers: HEADERS,
		rows: (result.rows ?? []).map((row) => [row.var_i, row.var_j, row.r, row.pvalue, row.n])
	});
	// Preview is sorted by |r| descending — the strongest relationships first.
	let previewRows = $derived(
		[...(result.rows ?? [])]
			.sort((a, b) => (Math.abs(b.r) || 0) - (Math.abs(a.r) || 0))
			.slice(0, 8)
	);

	function recompute() {
		const [res, valid] = correlation(p.args);
		p.args.valid = valid;
		result = res ?? { rows: [], methodUsed: p.args.method, warnings: [] };
		p.warnings = result.warnings ?? [];
	}

	// Track the DATA of every wired column, not just its id. Editing an upstream value changes
	// the column's `getDataHash` but not `yIN`, so an effect over `yIN` alone never re-fires —
	// that was the bug. Same pattern as Cosinor / GroupComparison.
	let getHash = $derived.by(() => {
		let out = String(p.args.method);
		for (const yId of p.args.yIN ?? []) {
			const col = yId >= 0 ? getColumnById(yId) : null;
			out += ':' + (col?.getDataHash ?? '');
		}
		return out;
	});

	onMount(() => {
		mounted = true;
		recompute();
	});

	let lastHash = '';
	$effect(() => {
		const hash = getHash;
		if (!mounted) return;
		if (hash === lastHash) return;
		lastHash = hash;
		queueMicrotask(() => untrack(() => recompute()));
	});
</script>

<div class="control-input-vertical">
	<ControlInput label="Method">
		<AttributeSelect
			bind:value={p.args.method}
			options={['auto', 'pearson', 'spearman']}
			optionsDisplay={['Auto (normality-based)', 'Pearson (linear)', 'Spearman (rank / monotonic)']}
		/>
	</ControlInput>
	{#if result.rows.length}
		<p class="hint">
			{result.rows.length} pair{result.rows.length === 1 ? '' : 's'}, method: <strong>{result.methodUsed}</strong>.
			Quick-plot for the heatmap.
		</p>
		<details class="tp-output-panel" open>
			<summary class="tp-output-summary">Correlations</summary>
			<table class="corr-table">
				<colgroup>
					<col />
					<col class="c-num" />
					<col class="c-num" />
				</colgroup>
				<thead>
					<tr><th>Pair</th><th>r</th><th>p</th></tr>
				</thead>
				<tbody>
					{#each previewRows as row (row.var_i + ' ' + row.var_j)}
						<tr title={`${row.var_i} ~ ${row.var_j}: r=${fmt(row.r)}, p=${fmt(row.pvalue)}, n=${row.n}`}>
							<td class="pair">{row.var_i} ~ {row.var_j}</td>
							<td class="num">{fmt(row.r)}</td>
							<td class="num">{fmt(row.pvalue)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
			{#if result.rows.length > previewRows.length}
				<p class="more">+{result.rows.length - previewRows.length} more — open the full table.</p>
			{/if}
			<div class="tp-stat-actions">
				<button class="tp-stat-btn" onclick={openFullTable}>Open full table</button>
				<button
					class="tp-stat-btn"
					onclick={() => {
						const { headers, rows } = getTableData();
						saveStaticDataAsCSV('correlation_matrix', headers, rows);
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
	/* Mirrors GroupComparison's tp-output-panel so the analysis nodes read consistently. */
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
		overflow-y: auto;
		overflow-x: hidden;
		scrollbar-gutter: stable;
	}
	.tp-output-summary {
		cursor: pointer;
		font-weight: 600;
		position: sticky;
		top: 0;
		background: var(--color-lightness-99);
		padding: 0.1rem 0;
	}
	/* table-layout:fixed + ellipsis keeps long variable names inside the narrow node instead
	   of forcing horizontal overflow; the full names are one click away in the full table. */
	.corr-table {
		width: 100%;
		table-layout: fixed;
		border-collapse: collapse;
		margin-top: var(--space-1);
	}
	.corr-table th {
		text-align: right;
		font-weight: 600;
		color: var(--color-text-muted);
		padding: 0.1rem 0.3rem;
	}
	.corr-table th:first-child {
		text-align: left;
	}
	.corr-table td {
		padding: 0.1rem 0.3rem;
	}
	/* the three numeric columns take fixed narrow widths; the pair column gets the rest. */
	.corr-table col.c-num {
		width: 3.2rem;
	}
	.corr-table .pair {
		text-align: left;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.corr-table .num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.more {
		color: var(--color-text-muted);
		margin: var(--space-1) 0 0;
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
