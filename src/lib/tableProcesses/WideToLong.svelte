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
	import { getColumnById } from '$lib/core/Column.svelte';
	import { onMount } from 'svelte';

	let { p = $bindable() } = $props();

	let wideToLongResult = $state();

	// Reactivity
	let categoryIN_col = $derived.by(() => (p.args.categoryIN >= 0 ? getColumnById(p.args.categoryIN) : null));
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
		if (getHash !== lastHash) {
			doWideToLong();
			lastHash = getHash;
		}
	});

	function doWideToLong() {
		// Pre-scan: read unique categories and build out keys before running
		if (
			p.args.categoryIN >= 0 &&
			p.args.timeIN >= 0 &&
			p.args.valueIN >= 0 &&
			Object.keys(p.args.out).length <= 1
		) {
			const catData = getColumnById(p.args.categoryIN).getData();
			const seenCats = new Set();
			const categories = [];
			for (const c of catData) {
				if (!seenCats.has(c)) {
					seenCats.add(c);
					categories.push(c);
				}
			}
			p.args.categories = categories;
			for (const cat of categories) {
				p.args.out['value_' + cat] = p.args.out['value_' + cat] ?? -1;
			}
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
		} else {
			doWideToLong();
		}
	});
</script>

<!-- Input Section -->
<div class="section-row">
	<div class="tableProcess-label"><span>Input</span></div>
	<div class="control-input-vertical">
		<div class="control-input" style={p.args.out.time >= 0 ? 'opacity:0.5; pointer-events:none;' : ''}>
			<p>Category column</p>
			<ColumnSelector bind:value={p.args.categoryIN} onChange={doWideToLong} />
		</div>
		<div class="control-input">
			<p>Time column</p>
			<ColumnSelector
				bind:value={p.args.timeIN}
				excludeColIds={[p.args.categoryIN]}
				onChange={doWideToLong}
			/>
		</div>
		<div class="control-input">
			<p>Value column</p>
			<ColumnSelector
				bind:value={p.args.valueIN}
				excludeColIds={[p.args.categoryIN, p.args.timeIN]}
				onChange={doWideToLong}
			/>
		</div>
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
				<div style="height:250px; overflow:auto;">
					<Table
						headers={['time', ...p.args.categories]}
						data={[
							wideToLongResult.time,
							...p.args.categories.map((cat) => wideToLongResult['value_' + cat])
						]}
					/>
				</div>
			{:else}
				<p>Select valid input columns to see preview.</p>
			{/if}
		{/key}
	</div>
</div>
