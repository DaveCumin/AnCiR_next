<script module>
	import { core } from '$lib/core/core.svelte';

	export const addcolumns_displayName = 'Add Columns';

	export const addcolumns_defaults = new Map([
		['xsIN', { val: [] }],
		['out', { result: { val: -1 } }],
		['data', { val: [] }],
		['valid', { val: false }]
	]);

	export function addcolumns(argsIN) {
		if (!argsIN.xsIN || argsIN.xsIN.length === 0) return [[], false];

		const columns = argsIN.xsIN.map((id) => getColumnById(id)?.getData());
		if (!columns[0] || columns[0].length === 0) return [[], false];

		let result = columns[0].map(String);
		for (let i = 1; i < columns.length; i++) {
			result = result.map((x, j) => x + ' ' + String(columns[i][j]));
		}

		if (argsIN.out.result !== -1) {
			core.rawData.set(argsIN.out.result, result);
			getColumnById(argsIN.out.result).data = argsIN.out.result;
			getColumnById(argsIN.out.result).tableProcessGUId = crypto.randomUUID();
		}

		return [result, result.length > 0];
	}
</script>

<script>
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';
	import { onMount, untrack } from 'svelte';

	let { p = $bindable() } = $props();

	let xIN_cols = $derived.by(() => {
		if (!p.args.xsIN) return [];
		return p.args.xsIN.map((id) => getColumnById(id));
	});
	let getHash = $derived.by(() => xIN_cols.map((c) => c?.getDataHash).join('|'));
	let lastHash = '';
	let mounted = $state(false);

	$effect(() => {
		const dataHash = getHash;
		if (!mounted) return;
		if (lastHash !== dataHash) {
			untrack(() => doAddColumns());
			lastHash = dataHash;
		}
	});

	let result = $state();
	let previewStart = $state(1);

	function doAddColumns() {
		previewStart = 1;
		[result, p.args.valid] = addcolumns(p.args);
	}

	onMount(() => {
		const outKey = p.args.out.result;
		if (outKey >= 0 && core.rawData.has(outKey) && core.rawData.get(outKey).length > 0) {
			result = core.rawData.get(outKey);
			p.args.valid = true;
			lastHash = getHash;
		} else {
			doAddColumns();
		}
		mounted = true;
	});
</script>

<div style="display: block;">
	<div class="section-row">
		<div class="tableProcess-label">
			<span>Add Columns</span>
		</div>
	</div>
	<div class="control-input">
		<p>Columns to concatenate</p>
	</div>
	<ColumnSelector bind:value={p.args.xsIN} onChange={() => doAddColumns()} multiple={true} />

	{#each p.args.xsIN as _, i}
		<a>{getColumnById(p.args.xsIN[i])?.name}</a>
		<button
			onclick={() => {
				p.args.xsIN.splice(i, 1);
				doAddColumns();
			}}>-</button
		>
		{#if p.args.xsIN.length > 1 && i < p.args.xsIN.length - 1}
			<a>+</a>
		{/if}
	{/each}

	{#if p.args.out.result > 0}
		<div class="section-row">
			<div class="tableProcess-label"><span>Output</span></div>
		</div>
		<ColumnComponent col={getColumnById(p.args.out.result)} />
	{:else if p.args.valid && result?.length}
		{@const totalRows = result.length}
		<p>Preview:</p>
		<Table headers={['Result']} data={[result.slice(previewStart - 1, previewStart + 5)]} />
		<p>
			Row <NumberWithUnits
				min={1}
				max={Math.max(1, totalRows - 5)}
				step={1}
				bind:value={previewStart}
			/>
			to {Math.min(previewStart + 5, totalRows)} of {totalRows}
		</p>
	{:else}
		<p>Select columns to concatenate.</p>
	{/if}
</div>
