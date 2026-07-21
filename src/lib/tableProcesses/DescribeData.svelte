<script module>
	// @ts-nocheck
	// Describe data — per-column summary statistics.
	//
	// Many-column yIN → one row per variable: n, mean, median, sd, min, max, range, Q1, Q3,
	// IQR, skewness, excess kurtosis. Output as fixed columns (a `variable` name column plus one
	// column per statistic), tidy long form. Quick-plot draws a histogram of each input column.
	// Maths is the pure, unit-tested utils/describeStats.js (scipy-matched moments).
	import { getColumnById } from '$lib/core/Column.svelte';
	import { writeOutputColumn } from '$lib/tableProcesses/outputColumns.js';
	import { fillDefaults, normalizeYInputs } from '$lib/tableProcesses/tpArgHelpers.js';
	import { describeStats, DESCRIBE_KEYS } from '$lib/utils/describeStats.js';

	const displayName = 'Describe Data';
	const OUT_KEYS = ['variable', ...DESCRIBE_KEYS];

	const defaults = new Map([
		['yIN', { val: [] }],
		['out', { ...Object.fromEntries(OUT_KEYS.map((k) => [k, { val: -1 }])) }],
		['valid', { val: false }]
	]);

	export function describedata(argsIN) {
		fillDefaults(argsIN, defaults);
		const yIds = normalizeYInputs(argsIN.yIN).filter((id) => id != null && id !== -1 && getColumnById(id));
		if (yIds.length === 0) return [null, false];

		const rows = yIds.map((id) => {
			const col = getColumnById(id);
			return { variable: col.name ?? String(id), ...describeStats(col.getData() ?? []) };
		});
		// Write the output columns from the func itself (not just the component's recompute), so
		// doProcess() — used by the MCP engine and the demo generator — bakes real output columns
		// rather than empty ones. writeOutputColumn no-ops on unwired (-1) keys, so the pure-result
		// callers (tests) are unaffected. Function declaration is hoisted, so calling it here is fine.
		const result = { rows };
		writeDescribeOutputs(argsIN, result);
		return [result, true];
	}

	function writeDescribeOutputs(argsIN, result) {
		if (!result?.rows) return;
		const processHash = crypto.randomUUID();
		for (const key of OUT_KEYS) {
			writeOutputColumn(
				argsIN.out?.[key],
				result.rows.map((r) => r[key]),
				{ processHash, type: key === 'variable' ? 'category' : 'number' }
			);
		}
	}

	export const definition = {
		displayName,
		defaults,
		func: describedata,
		columnIdFields: { scalar: [], array: ['yIN'] },
		nodeSpec: {
			id: 'tableprocess.describedata',
			inputs: [{ name: 'yIN', kind: 'column', cardinality: 'many' }],
			outputs: OUT_KEYS.map((name) => ({ name, kind: 'column', cardinality: 'one' }))
		}
	};

	const fmt = (v) => (v == null || Number.isNaN(v) ? '—' : Math.abs(v) >= 1000 || (Math.abs(v) < 0.01 && v !== 0) ? Number(v).toExponential(2) : Number(v).toFixed(2));
</script>

<script>
	// @ts-nocheck
	import { onMount, untrack } from 'svelte';
	import { saveStaticDataAsCSV } from '$lib/components/plotbits/helpers/save.svelte.js';
	import { mutationService } from '$lib/core/mutationService.js';
	import { core } from '$lib/core/core.svelte.js';
	let { p = $bindable() } = $props();
	let mounted = $state(false);
	let result = $state({ rows: [] });

	// A compact set for the in-node preview; the full table has every column.
	const PREVIEW_STATS = ['n', 'mean', 'median', 'sd', 'min', 'max'];
	const getTableData = () => ({
		headers: OUT_KEYS,
		rows: (result.rows ?? []).map((r) => OUT_KEYS.map((k) => r[k]))
	});

	function recompute() {
		// describedata() writes its own output columns; recompute only mirrors the result to state.
		const [res, valid] = describedata(p.args);
		p.args.valid = valid;
		result = res ?? { rows: [] };
	}

	// Recompute when input DATA changes, not just when the ref list changes.
	let getHash = $derived.by(() => {
		let h = '';
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

	// Open full table → a live tableplot wired to the output columns (not a static snapshot).
	function openFullTable() {
		const outIds = OUT_KEYS.map((k) => p.args.out?.[k]).filter((id) => id != null && id >= 0);
		if (!outIds.length) return;
		const pos = core.nodeLayout?.[`tableprocess_${p.id}`] ?? { x: 200, y: 200 };
		mutationService.addPlot({
			name: 'Summary statistics',
			type: 'tableplot',
			x: (pos.x ?? 0) + 360,
			y: pos.y ?? 0,
			width: 640,
			height: Math.min(460, 120 + (result.rows?.length ?? 0) * 26),
			plot: { columnRefs: [...outIds], showCol: outIds.map(() => true) }
		});
	}
</script>

<div class="control-input-vertical">
	{#if result.rows.length}
		<p class="hint">{result.rows.length} variable{result.rows.length === 1 ? '' : 's'}. Quick-plot for histograms.</p>
		<details class="tp-output-panel" open>
			<summary class="tp-output-summary">Summary</summary>
			<table class="d-table">
				<thead>
					<tr><th>var</th>{#each PREVIEW_STATS as s (s)}<th>{s}</th>{/each}</tr>
				</thead>
				<tbody>
					{#each result.rows as row (row.variable)}
						<tr>
							<td class="var">{row.variable}</td>
							{#each PREVIEW_STATS as s (s)}<td class="num">{fmt(row[s])}</td>{/each}
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
						saveStaticDataAsCSV('summary_statistics', headers, rows);
					}}>Download CSV</button
				>
			</div>
		</details>
	{/if}
</div>

<style>
	.hint {
		font-size: var(--font-xs);
		color: var(--color-text-muted);
		margin: var(--space-2) 0 0;
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
