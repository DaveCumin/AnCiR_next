<script module>
	// @ts-nocheck
	import { core, appConsts } from '$lib/core/core.svelte';
	import { KahanSum, kahanMean } from '$lib/utils/numerics.js';
	import { min, max } from '$lib/utils/MathsStats.js';

	export const longtowide_displayName = 'Long To Wide';
	export const longtowide_defaults = new Map([
		['categoryIN', { val: -1 }],
		['timeIN', { val: -1 }],
		['valueIN', { val: -1 }],
		['categories', { val: [] }],
		['aggregates', { val: [] }],
		['preProcesses', { val: [] }],
		['out', { time: { val: -1 } }],
		['valid', { val: false }]
	]);

	export function longtowide(argsIN) {
		const categoryIN = argsIN.categoryIN;
		const timeIN = argsIN.timeIN;
		const valueIN = argsIN.valueIN;

		if (
			categoryIN == undefined ||
			timeIN == undefined ||
			valueIN == undefined ||
			categoryIN == -1 ||
			timeIN == -1 ||
			valueIN == -1
		) {
			return [{}, false];
		}

		const categoryData = getColumnById(categoryIN).getData();
		const timeData = getColumnById(timeIN).getData();
		const valueData = getColumnById(valueIN).getData();

		// Build union of all time values (deduplicated, preserving original order)
		const seenTimes = new Set();
		const unionTimes = [];
		for (const t of timeData) {
			if (!seenTimes.has(t)) {
				seenTimes.add(t);
				unionTimes.push(t);
			}
		}
		unionTimes.sort((a, b) => a - b);

		// Get unique categories (preserving order of first appearance)
		const seenCats = new Set();
		const categories = [];
		for (const c of categoryData) {
			if (!seenCats.has(c)) {
				seenCats.add(c);
				categories.push(c);
			}
		}

		// Build a map: category -> (time -> value)
		const catTimeMap = new Map();
		for (const cat of categories) {
			catTimeMap.set(cat, new Map());
		}
		for (let i = 0; i < categoryData.length; i++) {
			catTimeMap.get(categoryData[i])?.set(timeData[i], valueData[i]);
		}

		// Build result object
		const result = { time: unionTimes };
		for (const cat of categories) {
			const vals = unionTimes.map((t) => {
				const v = catTimeMap.get(cat).get(t);
				return v !== undefined ? v : NaN;
			});
			result['value_' + cat] = vals;
		}

		// Write to output columns if they exist
		if (argsIN.out.time !== -1) {
			// Apply pre-processes (in order) to each category's values before writing outputs
			for (const pp of argsIN.preProcesses ?? []) {
				if (!pp.processName) continue;
				const proc = appConsts.processMap.get(pp.processName);
				if (proc?.func) {
					for (const cat of categories) {
						result['value_' + cat] = proc.func(result['value_' + cat], pp.processArgs ?? {});
					}
				}
			}

			const timeColId = argsIN.out.time;
			core.rawData.set(timeColId, unionTimes);
			getColumnById(timeColId).data = timeColId;
			getColumnById(timeColId).type = getColumnById(timeIN).type;
			if (getColumnById(timeIN).timeFormat) {
				getColumnById(timeColId).timeFormat = getColumnById(timeIN).timeFormat;
			}

			const processHash = crypto.randomUUID();
			getColumnById(timeColId).tableProcessGUId = processHash;

			for (const cat of categories) {
				const outKey = 'value_' + cat;
				const outColId = argsIN.out[outKey];
				if (outColId !== undefined && outColId !== -1) {
					core.rawData.set(outColId, result[outKey]);
					getColumnById(outColId).data = outColId;
					getColumnById(outColId).type = getColumnById(valueIN).type;
					getColumnById(outColId).tableProcessGUId = processHash;
				}
			}

			// Compute and write each aggregate output
			for (const agg of argsIN.aggregates ?? []) {
				if (!agg.outColId || agg.outColId === -1) continue;
				const excluded = agg.excludedColIds ?? [];
				const activeEntries = categories
					.map((cat) => ({ cat, colId: argsIN.out['value_' + cat] }))
					.filter(({ colId }) => colId !== undefined && colId !== -1 && !excluded.includes(colId));
				if (activeEntries.length === 0) {
					core.rawData.set(agg.outColId, []);
					continue;
				}
				const n = unionTimes.length;
				const aggResult = new Array(n);
				const method = agg.method ?? 'mean';
				// Use getData() so processes applied to output columns are included in aggregation
				const processedArrays = activeEntries.map(({ cat, colId }) => {
					const col = getColumnById(colId);
					return col ? col.getData() : result['value_' + cat];
				});
				for (let i = 0; i < n; i++) {
					const vals = processedArrays
						.map((arr) => arr[i])
						.filter((v) => v != null && !isNaN(v));
					if (vals.length === 0) {
						aggResult[i] = NaN;
						continue;
					}
					if (method === 'min') {
						aggResult[i] = min(vals);
					} else if (method === 'max') {
						aggResult[i] = max(vals);
					} else if (method === 'mean') {
						aggResult[i] = kahanMean(vals);
					} else if (method === 'std') {
						const m = kahanMean(vals);
						const k = new KahanSum();
						for (const v of vals) k.add((v - m) ** 2);
						aggResult[i] = Math.sqrt(k.value / vals.length);
					}
				}
				core.rawData.set(agg.outColId, aggResult);
				getColumnById(agg.outColId).data = agg.outColId;
				getColumnById(agg.outColId).type = 'number';
				getColumnById(agg.outColId).tableProcessGUId = processHash;
			}
		}

		return [result, unionTimes.length > 0];
	}
</script>

<script>
	// @ts-nocheck
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import { Column, getColumnById, removeColumn } from '$lib/core/Column.svelte';
	import { formatTimeFromUNIX } from '$lib/utils/time/TimeUtils.js';
	import { pushObj } from '$lib/core/core.svelte.js';
	import { Process } from '$lib/core/Process.svelte';
	import Processcomponent from '$lib/core/Process.svelte';
	import { onMount, untrack } from 'svelte';

	let { p = $bindable() } = $props();

	let longToWideResult = $state();
	let mounted = $state(false);
	let previewStart = $state(1);
	let errorMessage = $state('');

	// Local state bound to selectors — p.args.* is only updated when validation passes,
	// so p.args.* is never transiently set to an invalid value (which could trigger $effect).
	let categoryIN_local = $state(p.args.categoryIN);
	let timeIN_local = $state(p.args.timeIN);
	let valueIN_local = $state(p.args.valueIN);

	// Process instances for "pre-process all outputs" UI — parallel to p.args.preProcesses
	let preProcessProcs = $state([]);

	let sortedProcesses = $derived.by(() => {
		return Array.from(appConsts.processMap.entries()).sort((a, b) => {
			const nameA = a[1].displayName || a[0];
			const nameB = b[1].displayName || b[0];
			return nameA.localeCompare(nameB);
		});
	});

	// Reactivity — tracks the committed (valid) input columns
	let categoryIN_col = $derived.by(() =>
		p.args.categoryIN >= 0 ? getColumnById(p.args.categoryIN) : null
	);
	let timeIN_col = $derived.by(() => (p.args.timeIN >= 0 ? getColumnById(p.args.timeIN) : null));
	let timeIsTime = $derived(timeIN_col?.type === 'time');
	let valueIN_col = $derived.by(() => (p.args.valueIN >= 0 ? getColumnById(p.args.valueIN) : null));
	let getHash = $derived.by(() => {
		let h = '';
		h += categoryIN_col?.getDataHash ?? '';
		h += timeIN_col?.getDataHash ?? '';
		h += valueIN_col?.getDataHash ?? '';
		// Track processes on output value columns so aggregate recomputes when they change.
		// We hash only the processes (not tableProcessGUId) to avoid an infinite update loop.
		for (const cat of p.args.categories ?? []) {
			const colId = p.args.out?.['value_' + cat];
			if (colId >= 0) {
				const col = getColumnById(colId);
				if (col) {
					h += col.processes.map((proc) => `${proc.id}:${proc.name}:${JSON.stringify(proc.args)}`).join('|');
				}
			}
		}
		// Track preProcesses name and args changes
		h += preProcessProcs.map((proc) => `${proc.name}:${JSON.stringify(proc.args)}`).join('|');
		return h;
	});
	let lastHash = '';

	// Sync preProcessProcs args back to p.args so they persist in the session JSON
	$effect(() => {
		const snapshots = preProcessProcs.map((proc) => JSON.stringify(proc.args)); // establish tracking
		untrack(() => {
			for (let i = 0; i < snapshots.length; i++) {
				if (p.args.preProcesses[i]) {
					p.args.preProcesses[i].processArgs = JSON.parse(snapshots[i]);
				}
			}
		});
	});

	$effect(() => {
		const dataHash = getHash;
		if (!mounted) return;
		if (dataHash !== lastHash) {
			untrack(() => {
				doLongToWide();
			});
			lastHash = dataHash;
		}
	});

	// Validate a candidate value against outputs and other already-committed inputs.
	// p.args.* always holds the last valid committed values.
	function validateInput(newVal, excludeField) {
		const id = Number(newVal);
		if (id < 0) return null;

		const outputIds = new Set(
			Object.values(p.args.out)
				.map(Number)
				.filter((v) => v >= 0)
		);
		if (outputIds.has(id)) {
			return 'That column is an output of this transform and cannot be used as an input.';
		}

		const inputs = { category: p.args.categoryIN, time: p.args.timeIN, value: p.args.valueIN };
		for (const [field, val] of Object.entries(inputs)) {
			if (field !== excludeField && Number(val) >= 0 && Number(val) === id) {
				return `That column is already used as the ${field} input.`;
			}
		}
		return null;
	}

	function onCategoryChange() {
		const err = validateInput(categoryIN_local, 'category');
		if (err) {
			errorMessage = err;
			categoryIN_local = p.args.categoryIN; // revert selector to last valid
			return;
		}
		errorMessage = '';
		p.args.categoryIN = categoryIN_local;
		doLongToWide();
	}

	function onTimeChange() {
		const err = validateInput(timeIN_local, 'time');
		if (err) {
			errorMessage = err;
			timeIN_local = p.args.timeIN;
			return;
		}
		errorMessage = '';
		p.args.timeIN = timeIN_local;
		doLongToWide();
	}

	function onValueChange() {
		const err = validateInput(valueIN_local, 'value');
		if (err) {
			errorMessage = err;
			valueIN_local = p.args.valueIN;
			return;
		}
		errorMessage = '';
		p.args.valueIN = valueIN_local;
		doLongToWide();
	}

	function addPreProcess() {
		const pp = { processName: '', processArgs: {} };
		p.args.preProcesses = [...p.args.preProcesses, pp];
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
		doLongToWide();
	}

	function removePreProcess(idx) {
		p.args.preProcesses = p.args.preProcesses.filter((_, i) => i !== idx);
		preProcessProcs = preProcessProcs.filter((_, i) => i !== idx);
		doLongToWide();
	}

	function createAggregateColumn(label) {
		const tempCol = new Column({});
		tempCol.name = label;
		pushObj(tempCol);
		p.parent.columnRefs = [tempCol.id, ...p.parent.columnRefs];
		return tempCol.id;
	}

	function addAggregate() {
		const idx = p.args.aggregates.length;
		const agg = { method: 'mean', excludedColIds: [], outColId: -1 };
		if (p.parent) {
			agg.outColId = createAggregateColumn('aggregate_' + idx + '_' + p.id);
		}
		p.args.aggregates = [...p.args.aggregates, agg];
		doLongToWide();
	}

	function removeAggregate(idx) {
		const agg = p.args.aggregates[idx];
		if (agg.outColId >= 0) {
			core.rawData.delete(agg.outColId);
			removeColumn(agg.outColId);
		}
		p.args.aggregates = p.args.aggregates.filter((_, i) => i !== idx);
		doLongToWide();
	}

	function onAggMethodChange() {
		doLongToWide();
	}

	function toggleExcludeForAgg(idx, colId) {
		const agg = p.args.aggregates[idx];
		const excluded = agg.excludedColIds ?? [];
		const newExcluded = excluded.includes(colId)
			? excluded.filter((id) => id !== colId)
			: [...excluded, colId];
		const newAggregates = p.args.aggregates.map((a, i) =>
			i === idx ? { ...a, excludedColIds: newExcluded } : a
		);
		p.args.aggregates = newAggregates;
		doLongToWide();
	}

	function doLongToWide() {
		previewStart = 1;
		if (p.args.categoryIN >= 0 && p.args.timeIN >= 0 && p.args.valueIN >= 0) {
			const catData = getColumnById(p.args.categoryIN).getData();
			const seenCats = new Set();
			const categories = [];
			for (const c of catData) {
				if (!seenCats.has(c)) {
					seenCats.add(c);
					categories.push(c);
				}
			}

			// Remove output columns for categories that no longer exist
			const newCatSet = new Set(categories);
			for (const oldCat of p.args.categories) {
				if (!newCatSet.has(oldCat)) {
					const outKey = 'value_' + oldCat;
					const colId = p.args.out[outKey];
					if (colId !== undefined && colId >= 0) {
						removeColumn(colId);
					}
					delete p.args.out[outKey];
				}
			}

			p.args.categories = categories;

			// Add output columns for new categories.
			const committed = p.args.out.time >= 0 && p.parent;
			for (const cat of categories) {
				const outKey = 'value_' + cat;
				if (p.args.out[outKey] === undefined || p.args.out[outKey] === -1) {
					if (committed) {
						const tempCol = new Column({});
						tempCol.name = outKey + '_' + p.id;
						p.args.out[outKey] = tempCol.id;
						pushObj(tempCol);
						p.parent.columnRefs = [tempCol.id, ...p.parent.columnRefs];
					} else {
						p.args.out[outKey] = p.args.out[outKey] ?? -1;
					}
				}
			}

			// Update valueColIds after all output columns are created/assigned
			p.args.valueColIds = categories
				.map((cat) => p.args.out['value_' + cat])
				.filter((id) => id !== undefined && id >= 0);

			// Ensure aggregate output columns exist for any aggregate without one
			if (p.parent) {
				p.args.aggregates = p.args.aggregates.map((agg, i) => {
					if (agg.outColId === undefined || agg.outColId === -1) {
						return { ...agg, outColId: createAggregateColumn('aggregate_' + i + '_' + p.id) };
					}
					return agg;
				});
			}
		}
		[longToWideResult, p.args.valid] = longtowide(p.args);
	}

	onMount(() => {
		// Backfill aggregates array for old sessions that used the single-aggregate format
		if (p.args.aggregates === undefined) {
			if (p.args.aggregate && p.args.out?.aggregate >= 0) {
				p.args.aggregates = [
					{
						method: p.args.aggregation ?? 'mean',
						excludedColIds: p.args.excludedColIds ?? [],
						outColId: p.args.out.aggregate
					}
				];
			} else {
				p.args.aggregates = [];
			}
		}

		// If data already exists (e.g. imported from JSON), use it instead of regenerating
		const timeKey = p.args.out.time;
		if (timeKey >= 0 && core.rawData.has(timeKey) && core.rawData.get(timeKey).length > 0) {
			const time = core.rawData.get(timeKey);
			longToWideResult = { time };
			for (const cat of p.args.categories) {
				const outColId = p.args.out['value_' + cat];
				if (outColId >= 0 && core.rawData.has(outColId)) {
					longToWideResult['value_' + cat] = core.rawData.get(outColId);
				}
			}
			p.args.valid = true;
			lastHash = getHash; // prevent $effect from recalculating
			// Backfill valueColIds for sessions saved before this field was added
			if (!p.args.valueColIds) {
				p.args.valueColIds = p.args.categories
					.map((cat) => p.args.out['value_' + cat])
					.filter((id) => id !== undefined && id >= 0);
			}
		}
		// Migrate old sessions: single applyToAll → preProcesses array
		if (p.args.preProcesses === undefined) {
			if (p.args.applyToAll?.processName) {
				p.args.preProcesses = [p.args.applyToAll];
			} else {
				p.args.preProcesses = [];
			}
		}
		// Restore Process instances for each saved pre-process
		preProcessProcs = p.args.preProcesses.map((pp) =>
			pp.processName
				? new Process({ name: pp.processName, args: pp.processArgs }, null)
				: null
		);
		// Sync local selector state from committed args (handles loaded sessions)
		categoryIN_local = p.args.categoryIN;
		timeIN_local = p.args.timeIN;
		valueIN_local = p.args.valueIN;
		mounted = true;
	});
</script>

<!-- Input Section -->
<div class="section-row">
	<div class="tableProcess-label"><span>Input</span></div>
	<div class="control-input-vertical">
		<div class="control-input">
			<p>Category column</p>
			<ColumnSelector bind:value={categoryIN_local} onChange={onCategoryChange} />
		</div>
		<div class="control-input">
			<p>Time column</p>
			<ColumnSelector
				bind:value={timeIN_local}
				excludeColIds={[p.args.categoryIN]}
				onChange={onTimeChange}
			/>
		</div>
		<div class="control-input">
			<p>Value column</p>
			<ColumnSelector
				bind:value={valueIN_local}
				excludeColIds={[p.args.categoryIN, p.args.timeIN]}
				onChange={onValueChange}
			/>
		</div>
		{#if errorMessage}
			<p class="error-message">{errorMessage}</p>
		{/if}
	</div>
</div>

<!-- Output / Preview -->
<div class="section-row">
	<div class="section-content">
		{#key longToWideResult}
			{#if p.args.valid && p.args.out.time >= 0}
				<div class="tableProcess-label"><span>Output</span></div>
				<ColumnComponent col={getColumnById(p.args.out.time)} />
				{#each p.args.categories as cat}
					{#if p.args.out['value_' + cat] >= 0}
						<ColumnComponent col={getColumnById(p.args.out['value_' + cat])} />
					{/if}
				{/each}
			{:else if p.args.valid && longToWideResult?.time?.length}
				{@const totalRows = longToWideResult.time.length}
				<Table
					headers={['time', ...p.args.categories]}
					data={[
						timeIsTime
							? longToWideResult.time.slice(previewStart - 1, previewStart + 5).map((t) => ({
									isTime: true,
									raw: formatTimeFromUNIX(t),
									computed: ((t - longToWideResult.time[0]) / 3600000).toFixed(2)
								}))
							: longToWideResult.time.slice(previewStart - 1, previewStart + 5),
						...p.args.categories.map((cat) =>
							longToWideResult['value_' + cat].slice(previewStart - 1, previewStart + 5)
						)
					]}
				/>
				<p>
					Row <NumberWithUnits
						min={1}
						max={Math.max(1, totalRows - 5)}
						step={1}
						bind:value={previewStart}
					/> to {Math.min(previewStart + 5, totalRows)} of {totalRows}
				</p>
			{:else}
				<p>Select valid input columns to see preview.</p>
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
						<button class="remove-btn" onclick={() => removePreProcess(idx)} title="Remove">×</button>
					</div>
					<div class="control-input">
						<p>Process</p>
						<select
							value={pp.processName}
							onchange={(e) => setPreProcess(idx, e.target.value)}
						>
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
						<select bind:value={agg.method} onchange={onAggMethodChange}>
							<option value="mean">Mean</option>
							<option value="min">Min</option>
							<option value="max">Max</option>
							<option value="std">Std dev</option>
						</select>
					</div>

					{#if (p.args.valueColIds ?? []).length > 0}
						{@const excluded = agg.excludedColIds ?? []}
						{@const nActive = (p.args.valueColIds ?? []).length - excluded.length}
						<div class="control-input-vertical">
							<p>Columns ({nActive} of {(p.args.valueColIds ?? []).length} included)</p>
							<div class="col-checklist">
								{#each p.args.valueColIds ?? [] as colId}
									{@const col = getColumnById(colId)}
									{@const included = !excluded.includes(colId)}
									<label class="col-check-item">
										<input
											type="checkbox"
											checked={included}
											onchange={() => toggleExcludeForAgg(idx, colId)}
										/>
										{col?.name ?? `col ${colId}`}
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
	.error-message {
		color: #c0392b;
		font-size: 12px;
		margin: 0.25rem 0;
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
