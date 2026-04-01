<script module>
	import { core } from '$lib/core/core.svelte';

	export const widetolong_displayName = 'Wide To Long';
	export const widetolong_defaults = new Map([
		['categoryIN', { val: -1 }],
		['timeIN', { val: -1 }],
		['valueIN', { val: -1 }],
		['categories', { val: [] }],
		['out', { time: { val: -1 } }],
		['valid', { val: false }]
	]);

	export function widetolong(argsIN) {
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
		}

		return [result, unionTimes.length > 0];
	}
</script>

<script>
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import { Column, getColumnById, removeColumn } from '$lib/core/Column.svelte';
	import { pushObj } from '$lib/core/core.svelte.js';
	import { onMount, untrack } from 'svelte';

	let { p = $bindable() } = $props();

	let wideToLongResult = $state();
	let mounted = $state(false);
	let previewStart = $state(1);
	let errorMessage = $state('');

	// Local state bound to selectors — p.args.* is only updated when validation passes,
	// so p.args.* is never transiently set to an invalid value (which could trigger $effect).
	let categoryIN_local = $state(p.args.categoryIN);
	let timeIN_local = $state(p.args.timeIN);
	let valueIN_local = $state(p.args.valueIN);

	// Reactivity — tracks the committed (valid) input columns
	let categoryIN_col = $derived.by(() =>
		p.args.categoryIN >= 0 ? getColumnById(p.args.categoryIN) : null
	);
	let timeIN_col = $derived.by(() => (p.args.timeIN >= 0 ? getColumnById(p.args.timeIN) : null));
	let valueIN_col = $derived.by(() => (p.args.valueIN >= 0 ? getColumnById(p.args.valueIN) : null));
	let getHash = $derived.by(() => {
		let h = '';
		h += categoryIN_col?.getDataHash ?? '';
		h += timeIN_col?.getDataHash ?? '';
		h += valueIN_col?.getDataHash ?? '';
		return h;
	});
	let lastHash = '';

	$effect(() => {
		const dataHash = getHash;
		if (!mounted) return;
		if (dataHash !== lastHash) {
			untrack(() => {
				doWideToLong();
			});
			lastHash = dataHash;
		}
	});

	// Validate a candidate value against outputs and other already-committed inputs.
	// p.args.* always holds the last valid committed values.
	function validateInput(newVal, excludeField) {
		const id = Number(newVal);
		if (id < 0) return null;

		const outputIds = new Set(Object.values(p.args.out).map(Number).filter((v) => v >= 0));
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
		doWideToLong();
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
		doWideToLong();
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
		doWideToLong();
	}

	function doWideToLong() {
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
			// If the process is already committed (out.time has a real ID and has a parent table),
			// create actual Column objects immediately — matching what TableProcess constructor does.
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
		}
		[wideToLongResult, p.args.valid] = widetolong(p.args);
	}

	onMount(() => {
		// If data already exists (e.g. imported from JSON), use it instead of regenerating
		const timeKey = p.args.out.time;
		if (timeKey >= 0 && core.rawData.has(timeKey) && core.rawData.get(timeKey).length > 0) {
			const time = core.rawData.get(timeKey);
			wideToLongResult = { time };
			for (const cat of p.args.categories) {
				const outColId = p.args.out['value_' + cat];
				if (outColId >= 0 && core.rawData.has(outColId)) {
					wideToLongResult['value_' + cat] = core.rawData.get(outColId);
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
		{#key wideToLongResult}
			{#if p.args.valid && p.args.out.time >= 0}
				<div class="tableProcess-label"><span>Output</span></div>
				<ColumnComponent col={getColumnById(p.args.out.time)} />
				{#each p.args.categories as cat}
					{#if p.args.out['value_' + cat] >= 0}
						<ColumnComponent col={getColumnById(p.args.out['value_' + cat])} />
					{/if}
				{/each}
			{:else if p.args.valid && wideToLongResult?.time?.length}
				{@const totalRows = wideToLongResult.time.length}
				<Table
					headers={['time', ...p.args.categories]}
					data={[
						wideToLongResult.time.slice(previewStart - 1, previewStart + 5),
						...p.args.categories.map((cat) =>
							wideToLongResult['value_' + cat].slice(previewStart - 1, previewStart + 5)
						)
					]}
				/>
				<p>Row <NumberWithUnits min={1} max={Math.max(1, totalRows - 5)} step={1} bind:value={previewStart} /> to {Math.min(previewStart + 5, totalRows)} of {totalRows}</p>
			{:else}
				<p>Select valid input columns to see preview.</p>
			{/if}
		{/key}
	</div>
</div>

<style>
	.error-message {
		color: #c0392b;
		font-size: 12px;
		margin: 0.25rem 0;
	}
</style>
