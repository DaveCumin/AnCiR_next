<script module>
	// @ts-nocheck
	import { core, appConsts } from '$lib/core/core.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';

	export const collectcolumns_displayName = 'Collect Columns';
	export const collectcolumns_defaults = new Map([
		['colIds', { val: [] }],
		['out', {}],
		['outColIds', { val: [] }],
		['aggregates', { val: [] }],
		['preProcesses', { val: [] }],
		['valid', { val: false }]
	]);

	export function collectcolumns(argsIN) {
		const colIds = argsIN.colIds ?? [];
		if (colIds.length === 0) return [{}, false];

		// Read data for each input column
		const result = {};
		let nRows = -1;
		for (const colId of colIds) {
			const col = getColumnById(colId);
			if (!col) return [{}, false];
			const data = col.getData();
			result[colId] = [...data];
			if (nRows === -1) nRows = data.length;
		}

		// Apply pre-processes to all columns
		for (const pp of argsIN.preProcesses ?? []) {
			if (!pp.processName) continue;
			const proc = appConsts.processMap.get(pp.processName);
			if (proc?.func) {
				for (const colId of colIds) {
					result[colId] = proc.func(result[colId], pp.processArgs ?? {});
				}
			}
		}

		// Write to output columns
		const hasOut = Object.values(argsIN.out ?? {}).some((v) => Number(v) >= 0);
		if (hasOut) {
			const processHash = crypto.randomUUID();
			for (const colId of colIds) {
				const outColId = argsIN.out['col_' + colId];
				if (outColId !== undefined && Number(outColId) >= 0) {
					core.rawData.set(outColId, result[colId]);
					getColumnById(outColId).data = outColId;
					getColumnById(outColId).type = getColumnById(colId)?.type ?? 'number';
					getColumnById(outColId).tableProcessGUId = processHash;
				}
			}

			// Compute aggregates
			for (const agg of argsIN.aggregates ?? []) {
				if (!agg.outColId || agg.outColId === -1) continue;
				const excluded = agg.excludedColIds ?? [];
				const activeColIds = colIds.filter((colId) => {
					const outColId = argsIN.out['col_' + colId];
					return outColId !== undefined && Number(outColId) >= 0 && !excluded.includes(outColId);
				});
				if (activeColIds.length === 0) {
					core.rawData.set(agg.outColId, []);
					continue;
				}
				const method = agg.method ?? 'mean';
				const n = nRows;
				// Use getData() on output columns so column-level processes are included
				const processedArrays = activeColIds.map((colId) => {
					const outColId = argsIN.out['col_' + colId];
					const col = getColumnById(outColId);
					return col ? col.getData() : result[colId];
				});
				const aggResult = new Array(n);
				for (let i = 0; i < n; i++) {
					const vals = processedArrays.map((arr) => arr[i]).filter((v) => v != null && !isNaN(v));
					if (vals.length === 0) {
						aggResult[i] = NaN;
						continue;
					}
					if (method === 'min') {
						aggResult[i] = Math.min(...vals);
					} else if (method === 'max') {
						aggResult[i] = Math.max(...vals);
					} else if (method === 'mean') {
						aggResult[i] = vals.reduce((a, b) => a + b, 0) / vals.length;
					} else if (method === 'std') {
						const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
						aggResult[i] = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
					}
				}
				core.rawData.set(agg.outColId, aggResult);
				getColumnById(agg.outColId).data = agg.outColId;
				getColumnById(agg.outColId).type = 'number';
				getColumnById(agg.outColId).tableProcessGUId = processHash;
			}
		}

		return [result, colIds.length > 0];
	}
</script>

<script>
	// @ts-nocheck
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import { Column, removeColumn } from '$lib/core/Column.svelte';
	import { pushObj } from '$lib/core/core.svelte.js';
	import { Process } from '$lib/core/Process.svelte';
	import Processcomponent from '$lib/core/Process.svelte';
	import { onMount, untrack } from 'svelte';

	let { p = $bindable() } = $props();

	let collectResult = $state();
	let mounted = $state(false);
	let preProcessProcs = $state([]);

	let sortedProcesses = $derived.by(() => {
		return Array.from(appConsts.processMap.entries()).sort((a, b) => {
			const nameA = a[1].displayName || a[0];
			const nameB = b[1].displayName || b[0];
			return nameA.localeCompare(nameB);
		});
	});

	// Local multi-select state
	let selectedColIds = $state(p.args.colIds ?? []);

	// Aggregate output columns must not be selectable as inputs
	let aggregateExcludeIds = $derived(
		(p.args.aggregates ?? []).map((agg) => agg.outColId).filter((id) => id >= 0)
	);

	let getHash = $derived.by(() => {
		let h = '';
		for (const colId of p.args.colIds ?? []) {
			h += getColumnById(colId)?.getDataHash ?? '';
			const outColId = p.args.out?.['col_' + colId];
			if (outColId >= 0) {
				const col = getColumnById(outColId);
				if (col) {
					h += col.processes
						.map((proc) => `${proc.id}:${proc.name}:${JSON.stringify(proc.args)}`)
						.join('|');
				}
			}
		}
		h += preProcessProcs
			.map((proc) => `${proc?.name ?? ''}:${JSON.stringify(proc?.args ?? {})}`)
			.join('|');
		return h;
	});

	let lastHash = '';

	// Sync preProcessProcs args back to p.args so they persist
	$effect(() => {
		const snapshots = preProcessProcs.map((proc) => JSON.stringify(proc?.args ?? {}));
		untrack(() => {
			for (let i = 0; i < snapshots.length; i++) {
				if (p.args.preProcesses[i]) {
					p.args.preProcesses[i].processArgs = JSON.parse(snapshots[i]);
				}
			}
		});
	});

	// Re-run when input data or pre-process args change
	$effect(() => {
		const dataHash = getHash;
		if (!mounted) return;
		if (dataHash !== lastHash) {
			untrack(() => {
				doCollect();
			});
			lastHash = dataHash;
		}
	});

	// React to multi-select changes
	$effect(() => {
		const newIds = selectedColIds;
		if (!mounted) return;
		untrack(() => {
			onSelectionChange(newIds);
		});
	});

	function onSelectionChange(newIds) {
		const newIdSet = new Set(newIds.map(Number));
		const oldIds = p.args.colIds ?? [];

		// No change — skip
		if (
			newIds.length === oldIds.length &&
			[...newIdSet].every((id) => oldIds.map(Number).includes(id))
		)
			return;

		// Remove output columns for deselected columns
		for (const oldId of oldIds) {
			if (!newIdSet.has(Number(oldId))) {
				const outKey = 'col_' + oldId;
				const outColId = p.args.out[outKey];
				if (outColId !== undefined && outColId >= 0) {
					core.rawData.delete(outColId);
					removeColumn(outColId);
				}
				delete p.args.out[outKey];
			}
		}

		p.args.colIds = [...newIds].map(Number);
		doCollect();
	}

	function createAggregateColumn(label) {
		const tempCol = new Column({});
		tempCol.name = label;
		pushObj(tempCol);
		p.parent.columnRefs = [tempCol.id, ...p.parent.columnRefs];
		return tempCol.id;
	}

	function addPreProcess() {
		p.args.preProcesses = [...p.args.preProcesses, { processName: '', processArgs: {} }];
		preProcessProcs = [...preProcessProcs, null];
	}

	function setPreProcess(idx, processName) {
		if (!processName) {
			p.args.preProcesses[idx] = { processName: '', processArgs: {} };
			preProcessProcs[idx] = null;
		} else {
			const proc = new Process({ name: processName }, null);
			p.args.preProcesses[idx] = { processName, processArgs: proc.args };
			preProcessProcs[idx] = proc;
		}
		p.args.preProcesses = [...p.args.preProcesses];
		preProcessProcs = [...preProcessProcs];
		doCollect();
	}

	function removePreProcess(idx) {
		p.args.preProcesses = p.args.preProcesses.filter((_, i) => i !== idx);
		preProcessProcs = preProcessProcs.filter((_, i) => i !== idx);
		doCollect();
	}

	function addAggregate() {
		const idx = p.args.aggregates.length;
		const agg = { method: 'mean', excludedColIds: [], outColId: -1 };
		if (p.parent) {
			agg.outColId = createAggregateColumn('aggregate_' + idx + '_' + p.id);
		}
		p.args.aggregates = [...p.args.aggregates, agg];
		doCollect();
	}

	function removeAggregate(idx) {
		const agg = p.args.aggregates[idx];
		if (agg.outColId >= 0) {
			core.rawData.delete(agg.outColId);
			removeColumn(agg.outColId);
		}
		p.args.aggregates = p.args.aggregates.filter((_, i) => i !== idx);
		doCollect();
	}

	function toggleExcludeForAgg(idx, colId) {
		const agg = p.args.aggregates[idx];
		const excluded = agg.excludedColIds ?? [];
		const newExcluded = excluded.includes(colId)
			? excluded.filter((id) => id !== colId)
			: [...excluded, colId];
		p.args.aggregates = p.args.aggregates.map((a, i) =>
			i === idx ? { ...a, excludedColIds: newExcluded } : a
		);
		doCollect();
	}

	function doCollect() {
		if (p.parent && (p.args.colIds?.length ?? 0) > 0) {
			// Create output columns for any newly selected input columns
			for (const colId of p.args.colIds) {
				const outKey = 'col_' + colId;
				if (p.args.out[outKey] === undefined || p.args.out[outKey] === -1) {
					const inCol = getColumnById(colId);
					const tempCol = new Column({});
					tempCol.name = (inCol?.name ?? 'col') + '_' + p.id;
					p.args.out[outKey] = tempCol.id;
					pushObj(tempCol);
					p.parent.columnRefs = [tempCol.id, ...p.parent.columnRefs];
				}
			}

			// Update ordered list of output column IDs (used by aggregation checklist)
			p.args.outColIds = p.args.colIds
				.map((colId) => p.args.out['col_' + colId])
				.filter((id) => id !== undefined && id >= 0);

			// Ensure aggregate output columns exist
			p.args.aggregates = p.args.aggregates.map((agg, i) => {
				if (agg.outColId === undefined || agg.outColId === -1) {
					return { ...agg, outColId: createAggregateColumn('aggregate_' + i + '_' + p.id) };
				}
				return agg;
			});
		}

		[collectResult, p.args.valid] = collectcolumns(p.args);
	}

	onMount(() => {
		if (!p.args.preProcesses) p.args.preProcesses = [];
		if (!p.args.aggregates) p.args.aggregates = [];
		if (!p.args.colIds) p.args.colIds = [];
		if (!p.args.out) p.args.out = {};
		if (!p.args.outColIds) p.args.outColIds = [];

		// If data already exists (loaded from JSON), restore preview without recalculating
		const firstOutId = Object.values(p.args.out ?? {})[0];
		if (
			firstOutId !== undefined &&
			firstOutId >= 0 &&
			core.rawData.has(firstOutId) &&
			core.rawData.get(firstOutId).length > 0
		) {
			collectResult = {};
			for (const colId of p.args.colIds) {
				const outColId = p.args.out['col_' + colId];
				if (outColId >= 0 && core.rawData.has(outColId)) {
					collectResult[colId] = core.rawData.get(outColId);
				}
			}
			p.args.valid = true;
			// Backfill outColIds for sessions saved before this field was added
			if (!p.args.outColIds?.length) {
				p.args.outColIds = p.args.colIds
					.map((colId) => p.args.out['col_' + colId])
					.filter((id) => id !== undefined && id >= 0);
			}
			lastHash = getHash; // prevent $effect from recalculating
		}

		// Restore Process instances for each saved pre-process
		preProcessProcs = p.args.preProcesses.map((pp) =>
			pp.processName ? new Process({ name: pp.processName, args: pp.processArgs }, null) : null
		);

		// Sync local selector state from committed args
		selectedColIds = [...(p.args.colIds ?? [])];
		mounted = true;
	});
</script>

<!-- Input Section -->
<div class="section-row">
	<div class="tableProcess-label"><span>Input columns</span></div>
	<div class="control-input-vertical">
		<p class="hint">Ctrl/Cmd-click or Shift-click to select multiple columns</p>
		<ColumnSelector multiple={true} bind:value={selectedColIds} excludeColIds={aggregateExcludeIds} />
	</div>
</div>

<!-- Output / Preview -->
<div class="section-row">
	<div class="section-content">
		{#key collectResult}
			{#if p.args.valid && (p.args.outColIds?.length ?? 0) > 0}
				<div class="tableProcess-label"><span>Output</span></div>
				{#each p.args.colIds as colId}
					{@const outColId = p.args.out['col_' + colId]}
					{#if outColId >= 0}
						<ColumnComponent col={getColumnById(outColId)} />
					{/if}
				{/each}
			{:else if p.args.valid && collectResult}
				<p>Select a table to commit outputs.</p>
			{:else}
				<p>Select columns above to begin.</p>
			{/if}
		{/key}
	</div>
</div>

<!-- Pre-process Section -->
{#if p.args.valid}
	<div class="section-row">
		<div class="tableProcess-label"><span>Pre-process</span></div>
		<div class="control-input-vertical">
			{#each p.args.preProcesses as pp, idx (idx)}
				<div class="aggregate-block">
					<div class="aggregate-header">
						<span class="aggregate-title">Step {idx + 1}</span>
						<button class="remove-btn" onclick={() => removePreProcess(idx)} title="Remove"
							>×</button
						>
					</div>
					<div class="control-input">
						<p>Process</p>
						<select value={pp.processName} onchange={(e) => setPreProcess(idx, e.target.value)}>
							<option value="">Select…</option>
							{#each sortedProcesses as [key, value] (key)}
								<option value={key}>{value.displayName || key}</option>
							{/each}
						</select>
					</div>
					{#if preProcessProcs[idx]}
						<Processcomponent p={preProcessProcs[idx]} />
					{/if}
				</div>
			{/each}
			<button class="add-aggregate-btn" onclick={addPreProcess}>+ Add pre-process step</button>
		</div>
	</div>
{/if}

<!-- Aggregate Section -->
{#if p.args.valid}
	<div class="section-row">
		<div class="tableProcess-label"><span>Aggregate</span></div>
		<div class="control-input-vertical">
			{#each p.args.aggregates as agg, idx}
				<div class="aggregate-block">
					<div class="aggregate-header">
						<span class="aggregate-title">Aggregate</span>
						<button class="remove-btn" onclick={() => removeAggregate(idx)} title="Remove">×</button
						>
					</div>

					<div class="control-input">
						<p>Method</p>
						<select bind:value={agg.method} onchange={doCollect}>
							<option value="mean">Mean</option>
							<option value="min">Min</option>
							<option value="max">Max</option>
							<option value="std">Std dev</option>
						</select>
					</div>

					{#if (p.args.outColIds ?? []).length > 0}
						{@const excluded = agg.excludedColIds ?? []}
						{@const nActive = (p.args.outColIds ?? []).length - excluded.length}
						<div class="control-input-vertical">
							<p>Columns ({nActive} of {(p.args.outColIds ?? []).length} included)</p>
							<div class="col-checklist">
								{#each p.args.outColIds ?? [] as outColId}
									{@const col = getColumnById(outColId)}
									{@const included = !excluded.includes(outColId)}
									<label class="col-check-item">
										<input
											type="checkbox"
											checked={included}
											onchange={() => toggleExcludeForAgg(idx, outColId)}
										/>
										{col?.name ?? `col ${outColId}`}
									</label>
								{/each}
							</div>
						</div>
					{/if}

					{#if agg.outColId >= 0}
						<ColumnComponent col={getColumnById(agg.outColId)} />
					{/if}
				</div>
			{/each}

			<button class="add-aggregate-btn" onclick={addAggregate}>+ Add aggregate</button>
		</div>
	</div>
{/if}

<style>
	.hint {
		font-size: 11px;
		color: var(--color-lightness-55, #888);
		margin: 0 0 0.25rem 0;
	}

	.aggregate-block {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		border: 1px solid var(--color-lightness-85);
		border-radius: 4px;
		padding: 0.5rem 0.6rem;
	}

	.aggregate-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.aggregate-title {
		font-size: 12px;
		font-weight: 600;
	}

	.remove-btn {
		background: none;
		border: none;
		cursor: pointer;
		font-size: 16px;
		line-height: 1;
		color: var(--color-lightness-55, #888);
		padding: 0 0.2rem;
	}

	.remove-btn:hover {
		color: #c0392b;
	}

	.add-aggregate-btn {
		background: none;
		border: 1px dashed var(--color-lightness-75, #aaa);
		border-radius: 4px;
		cursor: pointer;
		font-size: 12px;
		padding: 0.3rem 0.6rem;
		color: var(--color-lightness-45, #666);
		width: 100%;
		text-align: center;
	}

	.add-aggregate-btn:hover {
		border-color: var(--color-lightness-55, #888);
		color: var(--color-lightness-25, #333);
	}

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
</style>
