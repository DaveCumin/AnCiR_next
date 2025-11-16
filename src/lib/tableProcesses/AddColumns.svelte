<script module>
	export const addcolumns_defaults = new Map([
		['xsIN', { val: [] }],
		['out', { result: { val: -1 } }], //needed to set upu the output columns
		['data', { val: [] }], //Need a 'data' to work
		['valid', { val: false }] //needed for the progress step logic
	]);

	export function addcolumns(argsIN) {
		if (argsIN.xsIN == undefined || argsIN.xsIN.length == 0) return [[], false]; //if there is no input yet

		let result = [];
		result = getColumnById(argsIN.xsIN[0]).getData();
		const firstType = getColumnById(argsIN.xsIN[0]).type;
		for (let i = 1; i < argsIN.xsIN.length; i++) {
			const temp = getColumnById(argsIN.xsIN[i]).getData();
			if (firstType == 'category' || getColumnById(argsIN.xsIN[i]).type == 'category') {
				result = result.map((x, i) => x + ' ' + temp[i]);
			} else {
				result = result.map((x, i) => x + temp[i]);
			}
		}

		if (argsIN.out.result == -1) {
		} else {
			getColumnById(argsIN.out.result).data = result;
			getColumnById(argsIN.out.result).type = typeof result[0] != 'string' ? 'category' : 'number';
			const processHash = crypto.randomUUID();
			getColumnById(argsIN.out.result).tableProcessGUId = processHash;
		}

		return [result, result.length > 0];
	}
</script>

<script>
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';
	import { onMount } from 'svelte';

	let { p = $bindable() } = $props();

	// for reactivity -----------
	let xIN_cols = $derived.by(() => {
		if (!p.args.xsIN) return null;
		else {
			return p.args.xsIN.map((id) => getColumnById(id));
		}
	});
	let getHash = $derived.by(() => {
		let out = '';
		out += xIN_cols.map((c) => c?.getDataHash).join('|');
		return out;
	});
	let lastHash = '';
	$effect(() => {
		const dataHash = getHash;
		if (lastHash === dataHash) {
			//do nothing
		} else {
			doAddColumns(); // DO THE BUSINESS
			lastHash = getHash;
		}
	});
	//------------
	let result = $state();
	function doAddColumns() {
		[result, p.args.valid] = addcolumns(p.args);
	}
	onMount(() => {
		//needed to get the values when it first mounts
		doAddColumns();
	});
</script>

<div style="display: block;">
	<div class="section-row">
		<div class="tableProcess-label">
			<span>Add</span>
		</div>
	</div>
	<div class="control-input">
		<p>Columns</p>
	</div>
	<ColumnSelector
		bind:value={p.args.xsIN}
		onChange={() => {
			doAddColumns();
		}}
		multiple={true}
	/>

	{#each p.args.xsIN as _, i}
		<a>{getColumnById(p.args.xsIN[i]).name}</a>
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

	{#if p.args.valid && p.args.out.result == -1}
		<p>Preview:</p>

		<div style="height:250px; overflow:auto;"><Table headers={['Result']} data={[result]} /></div>
	{:else if p.args.out.result > 0}
		<div class="section-row">
			<div class="tableProcess-label">
				<span>Output</span>
			</div>
		</div>
		<ColumnComponent col={getColumnById(p.args.out.result)} />
	{:else}
		<p>Need to have valid inputs to create columns.</p>
	{/if}
</div>
