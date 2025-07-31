<script module>
	export const duplicate_defaults = new Map([
		['xIN', { val: -1 }],
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
	function duplicate() {
		if (p.args.xIN == -1) return; //if there is no input yet
		result = getColumnById(p.args.xIN).getData();

		if (p.args.out.result == -1) {
			//do nothing
			return;
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
		duplicate();
	});
</script>

<p>
	Duplicate:
	<ColumnSelector
		bind:value={p.args.xIN}
		onChange={() => {
			duplicate();
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
