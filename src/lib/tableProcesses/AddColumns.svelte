<script module>
	export const addcolumns_defaults = new Map([
		['xsIN', { val: [] }],
		['out', { result: { val: -1 } }], //needed to set upu the output columns
		['valid', { val: false }] //needed for the progress step logic
	]);
</script>

<script>
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';
	import { onMount } from 'svelte';

	let { p = $bindable() } = $props();
	let result = $state();
	function addcolumns() {
		if (!p.args.xsIN) return; //if there is no input yet
		if (p.args.xsIN?.length == 0) {
			result = [];
			p.args.valid = false;
			return;
		}
		result = getColumnById(p.args.xsIN[0]).getData();
		for (let i = 1; i < p.args.xsIN.length; i++) {
			const temp = getColumnById(p.args.xsIN[i]).getData();
			result = result.map((x, i) => x + temp[i]);
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

	let choice = $state(-1);
	onMount(() => {
		//needed to get the values when it first mounts
		addcolumns();
	});
</script>

<p>Add:</p>
{#each p.args.xsIN as _, i}
	<ColumnSelector
		bind:value={p.args.xsIN[i]}
		onChange={() => {
			addcolumns();
		}}
	/><button
		onclick={() => {
			p.args.xsIN.splice(i, 1);
			addcolumns();
		}}>-</button
	>
	{#if p.args.xsIN.length > 1 && i < p.args.xsIN.length - 1}
		<a>+</a>
	{/if}
{/each}
<p>
	Add new: <ColumnSelector
		bind:value={choice}
		onChange={(value) => {
			p.args.xsIN.push(Number(value));
			addcolumns();
			choice = -1;
		}}
	/>
</p>
{#if p.args.valid && p.args.out.result == -1}
	<p>Preview:</p>
	<p>X: {result}</p>
{:else if p.args.out.result > 0}
	<ColumnComponent col={getColumnById(p.args.out.result)} />
{:else}
	<p>Need to have valid inputs to create columns.</p>
{/if}
