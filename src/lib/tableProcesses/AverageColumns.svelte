<script module>
	export const averagecolumns_defaults = new Map([
		['xsIN', { val: [] }],
		['out', { result: { val: -1 } }], //needed to set upu the output columns
		['valid', { val: false }] //needed for the progress step logic
	]);

	export function averagecolumns(argsIN) {
		if (argsIN.xsIN == undefined || argsIN.xsIN.length == 0) return [0, false]; //if there is no input yet

		let result = [];
		result = getColumnById(argsIN.xsIN[0]).getData();
		for (let i = 1; i < argsIN.xsIN.length; i++) {
			const temp = getColumnById(argsIN.xsIN[i]).getData();
			result = result.map((x, i) => x + temp[i]);
		}
		result = result.map((x, i) => x / argsIN.xsIN.length);

		if (argsIN.out.result == -1) {
		} else {
			getColumnById(argsIN.out.result).data = result;
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
			doAverageColumns(); // DO THE BUSINESS
			lastHash = getHash;
		}
	});
	//------------

	let result = $state();
	function doAverageColumns() {
		[result, p.args.valid] = averagecolumns(p.args);
	}
	onMount(() => {
		//needed to get the values when it first mounts
		doAverageColumns();
	});
</script>

<p>Average:</p>
<ColumnSelector
	bind:value={p.args.xsIN}
	onChange={() => {
		doAverageColumns();
	}}
	multiple={true}
/>
{#each p.args.xsIN as _, i}
	<a>{getColumnById(p.args.xsIN[i]).name}</a>
	<button
		onclick={() => {
			p.args.xsIN.splice(i, 1);
			doAverageColumns();
		}}>-</button
	>
	{#if p.args.xsIN.length > 1 && i < p.args.xsIN.length - 1}
		<a>,</a>
	{/if}
{/each}

{#if p.args.valid && p.args.out.result == -1}
	<p>Preview:</p>

	<div style="height:250px; overflow:auto;"><Table headers={['Result']} data={[result]} /></div>
{:else if p.args.out.result > 0}
	<ColumnComponent col={getColumnById(p.args.out.result)} />
{:else}
	<p>Need to have valid inputs to create columns.</p>
{/if}
