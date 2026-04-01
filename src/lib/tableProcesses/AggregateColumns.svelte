<script module>
	import { core } from '$lib/core/core.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';

	export const aggregatecolumns_displayName = 'Aggregate W2L Columns';

	export const aggregatecolumns_defaults = new Map([
		['wideToLongProcessId', { val: -1 }],
		['aggregation', { val: 'mean' }],
		['excludedColIds', { val: [] }],
		['out', { result: { val: -1 } }],
		['valid', { val: false }]
	]);

	export function aggregatecolumns(argsIN) {
		if (argsIN.wideToLongProcessId < 0) return [[], false];

		// Find the referenced WideToLong process across all tables
		const w2l = core.tables
			.flatMap((t) => t.processes)
			.find((p) => p.id === argsIN.wideToLongProcessId);
		if (!w2l || !w2l.args.valueColIds || w2l.args.valueColIds.length === 0) return [[], false];

		const excluded = argsIN.excludedColIds ?? [];
		const activeIds = w2l.args.valueColIds.filter((id) => !excluded.includes(id));
		if (activeIds.length === 0) return [[], false];

		for (const id of activeIds) {
			if (!getColumnById(id)) return [[], false];
		}

		const arrays = activeIds.map((id) => getColumnById(id).getData());
		if (arrays.some((a) => !a || a.length === 0)) return [[], false];

		const n = arrays[0].length;
		const result = new Array(n);

		for (let i = 0; i < n; i++) {
			const vals = arrays.map((a) => a[i]).filter((v) => v != null && !isNaN(v));
			if (vals.length === 0) {
				result[i] = NaN;
				continue;
			}
			if (argsIN.aggregation === 'min') {
				result[i] = Math.min(...vals);
			} else if (argsIN.aggregation === 'max') {
				result[i] = Math.max(...vals);
			} else if (argsIN.aggregation === 'mean') {
				result[i] = vals.reduce((a, b) => a + b, 0) / vals.length;
			} else if (argsIN.aggregation === 'std') {
				const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
				result[i] = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
			}
		}

		if (argsIN.out.result !== -1) {
			core.rawData.set(argsIN.out.result, result);
			getColumnById(argsIN.out.result).data = argsIN.out.result;
			getColumnById(argsIN.out.result).type = 'number';
			const processHash = crypto.randomUUID();
			getColumnById(argsIN.out.result).tableProcessGUId = processHash;
		}

		return [result, result.length > 0];
	}
</script>

<script>
	import ColumnComponent from '$lib/core/Column.svelte';
	import { onMount, untrack } from 'svelte';

	let { p = $bindable() } = $props();

	// All valid WideToLong processes across all tables
	let allW2LProcesses = $derived.by(() =>
		core.tables.flatMap((t) =>
			t.processes
				.filter((proc) => proc.name === 'WideToLong' && proc.args.valid)
				.map((proc) => ({ id: proc.id, label: `${t.name} — process ${proc.id}` }))
		)
	);

	// The currently selected WideToLong process object
	let selectedW2L = $derived.by(() => {
		if (p.args.wideToLongProcessId < 0) return null;
		return (
			core.tables
				.flatMap((t) => t.processes)
				.find((proc) => proc.id === p.args.wideToLongProcessId) ?? null
		);
	});

	// Value column IDs from the selected WideToLong (explicit list, no name-matching)
	let availableColIds = $derived.by(() => selectedW2L?.args?.valueColIds ?? []);

	// Reactivity hash: changes when source process, its columns, exclusion list, or aggregation change
	let getHash = $derived.by(() => {
		let h = `${p.args.wideToLongProcessId}|${p.args.aggregation}|${JSON.stringify(availableColIds)}|${JSON.stringify(p.args.excludedColIds)}`;
		const excluded = p.args.excludedColIds ?? [];
		const activeIds = availableColIds.filter((id) => !excluded.includes(id));
		h += activeIds.map((id) => getColumnById(id)?.getDataHash ?? '').join('|');
		return h;
	});

	let lastHash = '';
	let mounted = $state(false);
	let result = $state([]);

	$effect(() => {
		const h = getHash;
		if (!mounted) return;
		if (lastHash !== h) {
			untrack(() => {
				doAggregate();
			});
			lastHash = h;
		}
	});

	function doAggregate() {
		[result, p.args.valid] = aggregatecolumns(p.args);
		if (!p.args.valid) {
			const outId = p.args.out?.result;
			if (outId !== undefined && outId !== -1) {
				core.rawData.set(outId, []);
			}
		}
	}

	function onW2LChange(e) {
		p.args.wideToLongProcessId = Number(e.target.value);
		p.args.excludedColIds = [];
		doAggregate();
	}

	function onAggregationChange() {
		doAggregate();
	}

	function toggleExclude(colId) {
		const excluded = p.args.excludedColIds ?? [];
		if (excluded.includes(colId)) {
			p.args.excludedColIds = excluded.filter((id) => id !== colId);
		} else {
			p.args.excludedColIds = [...excluded, colId];
		}
		doAggregate();
	}

	onMount(() => {
		const outId = p.args.out.result;
		if (outId >= 0 && core.rawData.has(outId) && core.rawData.get(outId).length > 0) {
			result = core.rawData.get(outId);
			p.args.valid = true;
			lastHash = getHash;
		}
		mounted = true;
	});
</script>

<div class="section-row">
	<div class="tableProcess-label"><span>Input</span></div>
	<div class="control-input-vertical">
		<div class="control-input">
			<p>Wide-to-Long source</p>
			<select value={p.args.wideToLongProcessId} onchange={onW2LChange}>
				<option value={-1}>— select —</option>
				{#each allW2LProcesses as w2l}
					<option value={w2l.id}>{w2l.label}</option>
				{/each}
			</select>
		</div>

		<div class="control-input">
			<p>Aggregation</p>
			<select bind:value={p.args.aggregation} onchange={onAggregationChange}>
				<option value="mean">Mean</option>
				<option value="min">Min</option>
				<option value="max">Max</option>
				<option value="std">Std dev</option>
			</select>
		</div>

		{#if availableColIds.length > 0}
			{@const excluded = p.args.excludedColIds ?? []}
			{@const nActive = availableColIds.length - excluded.length}
			<div class="control-input-vertical">
				<p>Columns ({nActive} of {availableColIds.length} included)</p>
				<div class="col-checklist">
					{#each availableColIds as colId}
						{@const col = getColumnById(colId)}
						{@const included = !excluded.includes(colId)}
						<label class="col-check-item">
							<input type="checkbox" checked={included} onchange={() => toggleExclude(colId)} />
							{col?.name ?? `col ${colId}`}
						</label>
					{/each}
				</div>
			</div>
		{/if}
	</div>
</div>

{#if p.args.valid && p.args.out.result >= 0}
	<div class="section-row">
		<div class="tableProcess-label"><span>Output</span></div>
		<ColumnComponent col={getColumnById(p.args.out.result)} />
	</div>
{:else if p.args.wideToLongProcessId >= 0}
	<p class="info-msg">Waiting for valid Wide-to-Long output…</p>
{:else}
	<p class="info-msg">Select a Wide-to-Long source to continue.</p>
{/if}

<style>
	.col-checklist {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		max-height: 150px;
		overflow-y: auto;
		border: 1px solid var(--color-lightness-85);
		border-radius: 4px;
		padding: 0.25rem 0.4rem;
	}

	.col-check-item {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 12px;
		cursor: pointer;
		padding: 0.1rem 0;
	}

	.info-msg {
		font-size: 12px;
		color: var(--color-lightness-55, #888);
		margin: 0.25rem 0;
	}
</style>
