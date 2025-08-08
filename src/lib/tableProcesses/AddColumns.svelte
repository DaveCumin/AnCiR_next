<script module>
	export const addcolumns_defaults = new Map([
		['xsIN', { val: [] }],
		['out', { result: { val: -1 } }], //needed to set upu the output columns
		['valid', { val: false }] //needed for the progress step logic
	]);
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
			addcolumns(); // DO THE BUSINESS
			lastHash = getHash;
		}
	});
	//------------

	let result = $state();

	function addcolumns() {
		if (!p.args.xsIN) return; //if there is no input yet
		if (p.args.xsIN?.length == 0) {
			result = [];
			p.args.valid = false;
			return;
		}
		result = getColumnById(p.args.xsIN[0]).getData();
		const firstType = getColumnById(p.args.xsIN[0]).type;
		for (let i = 1; i < p.args.xsIN.length; i++) {
			const temp = getColumnById(p.args.xsIN[i]).getData();
			if (firstType == 'category' || getColumnById(p.args.xsIN[i]).type == 'category') {
				result = result.map((x, i) => x + ' ' + temp[i]);
			} else {
				result = result.map((x, i) => x + temp[i]);
			}
		}

		if (p.args.out.result == -1) {
		} else {
			getColumnById(p.args.out.result).data = result;
			const processHash = crypto.randomUUID();
			getColumnById(p.args.out.result).tableProcessGUId = processHash;
		}

		if (result.length > 0) {
			p.args.valid = true;
		} else {
			p.args.valid = false;
		}
	}

	onMount(() => {
		//needed to get the values when it first mounts
		addcolumns();
	});
</script>

<p>Add:</p>
<ColumnSelector
	bind:value={p.args.xsIN}
	onChange={() => {
		addcolumns();
	}}
	multiple={true}
/>
{#each p.args.xsIN as _, i}
	<a>{getColumnById(p.args.xsIN[i]).name}</a>
	<button
		onclick={() => {
			p.args.xsIN.splice(i, 1);
			addcolumns();
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
	<ColumnComponent col={getColumnById(p.args.out.result)} />
{:else}
	<p>Need to have valid inputs to create columns.</p>
{/if}
