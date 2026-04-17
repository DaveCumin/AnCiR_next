<script module>
	import { core } from '$lib/core/core.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';

	const displayName = 'Duplicate';
	const defaults = new Map([
		['xIN', { val: -1 }],
		['out', {}],
		['valid', { val: false }]
	]);

	export function duplicate(argsIN) {
		if (argsIN.xIN == null || argsIN.xIN === -1) return [[], false];

		const srcCol = getColumnById(argsIN.xIN);
		if (!srcCol) return [[], false];

		const result = srcCol.getData();

		const outId = argsIN.out?.result;
		if (outId != null && outId >= 0) {
			core.rawData.set(outId, result);
			const outCol = getColumnById(outId);
			if (outCol) {
				outCol.data = outId;
				outCol.type = srcCol.type;
				outCol.tableProcessGUId = crypto.randomUUID();
			}
		}

		return [result, true];
	}

	export const definition = { displayName, defaults, func: duplicate };
</script>

<script>
	// @ts-nocheck
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import TablePlot from '$lib/components/plotbits/Table.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';

	import { Column } from '$lib/core/Column.svelte';
	import { pushObj } from '$lib/core/core.svelte.js';
	import { formatTimeFromUNIX } from '$lib/utils/time/TimeUtils';
	import { onMount, untrack } from 'svelte';

	let { p = $bindable() } = $props();

	// Backwards compatibility: old sessions may have 'data' key or out.result as an object
	if (!p.args.out || typeof p.args.out !== 'object') {
		p.args.out = {};
	}
	// Old format had out.result = { val: -1 } — flatten to -1
	if (p.args.out.result != null && typeof p.args.out.result === 'object') {
		p.args.out.result = p.args.out.result.val ?? -1;
	}

	let duplicateResult = $state(null);
	let mounted = $state(false);
	let previewStart = $state(1);

	let xIN_col = $derived.by(() => (p.args.xIN >= 0 ? getColumnById(p.args.xIN) : null));
	let xIsTime = $derived(xIN_col?.type === 'time');

	let getHash = $derived.by(() => xIN_col?.getDataHash ?? '');
	let lastHash = '';

	$effect(() => {
		const dataHash = getHash;
		if (!mounted) return;
		if (lastHash !== dataHash) {
			lastHash = dataHash;
			untrack(() => recalculate());
		}
	});

	function recalculate() {
		[duplicateResult, p.args.valid] = duplicate(p.args);
	}

	function createOutputColumn() {
		if (!p.parent) return;
		const srcName = getColumnById(p.args.xIN)?.name ?? 'duplicate';
		const col = new Column({});
		col.name = `${srcName}_duplicate`;
		col.tableProcessGUId = p.parent.id;
		pushObj(col);
		p.parent.columnRefs = [col.id, ...p.parent.columnRefs];
		p.args.out.result = col.id;
	}

	function onXChange() {
		if (!mounted) return;
		untrack(() => {
			if ((p.args.out.result == null || p.args.out.result < 0) && p.parent) {
				createOutputColumn();
			}
			recalculate();
		});
	}

	onMount(() => {
		const outId = p.args.out?.result;

		if (
			outId != null &&
			outId >= 0 &&
			core.rawData.has(outId) &&
			core.rawData.get(outId).length > 0
		) {
			// Existing committed data — load without recomputing
			duplicateResult = core.rawData.get(outId);
			p.args.valid = true;
		} else if (p.args.xIN >= 0) {
			// Input exists but no output column yet — create and compute
			if ((outId == null || outId < 0) && p.parent) {
				createOutputColumn();
			}
			recalculate();
		}

		lastHash = getHash;
		mounted = true;
	});
</script>

<!-- Input -->
<div class="section-row">
	<div class="tableProcess-label">
		<span>Input</span>
	</div>
	<div class="control-input">
		<p>Column to duplicate</p>
		<ColumnSelector bind:value={p.args.xIN} onChange={onXChange} />
	</div>
</div>

<!-- Output -->
<div class="section-row">
	<div class="section-content">
		{#if p.args.out.result >= 0}
			{@const outCol = getColumnById(p.args.out.result)}
			{#if outCol}
				<div class="tableProcess-label"><span>Output</span></div>
				<ColumnComponent col={outCol} />
			{/if}
		{:else if p.args.valid && duplicateResult}
			<!-- Preview mode: shown in MakeNewColumn modal before parent table is set -->
			{@const totalRows = duplicateResult.length}
			{@const displayData = xIsTime
				? duplicateResult.map((v) => ({
						isTime: true,
						raw: formatTimeFromUNIX(v),
						computed: ((v - duplicateResult[0]) / 3600000).toFixed(2)
					}))
				: duplicateResult}
			<div class="tableProcess-label"><span>Preview</span></div>
			<TablePlot
				headers={[xIN_col?.name ?? 'Result']}
				data={[displayData.slice(previewStart - 1, previewStart + 5)]}
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
			<p>Select a column to duplicate.</p>
		{/if}
	</div>
</div>
