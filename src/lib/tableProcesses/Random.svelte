<script module>
	export const random_defaults = new Map([
		['offset', { val: 0 }],
		['multiply', { val: 10 }],
		['N', { val: 10 }],
		['out', { result: { val: -1 } }], //needed to set upu the output columns
		['data', { val: [] }],
		['valid', { val: false }] //needed for the progress step logic
	]);
</script>

<script>
	import ColumnComponent from '$lib/core/Column.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';
	import { onMount } from 'svelte';

	let { p = $bindable() } = $props();

	let result = $state();
	function makeRandom() {
		result = [];
		for (let i = 0; i < p.args.N; i++) {
			result.push(Number((p.args.offset + Math.random() * p.args.multiply).toFixed(2)));
		}
		if (p.args.out.result == -1 || !p.args.out.result) {
		} else {
			getColumnById(p.args.out.result).data = result;
			const processHash = crypto.randomUUID();
			getColumnById(p.args.out.result).tableProcessGUId = processHash;
		}

		if (result.length > 0) {
			p.args.data = result;
			p.args.valid = true;
		} else {
			p.args.valid = false;
		}
	}

	onMount(() => {
		//needed to get the values when it first mounts
		makeRandom();
	});
</script>

<p>Offset: <input type="number" bind:value={p.args.offset} oninput={makeRandom} /></p>
<p>Multiply: <input type="number" bind:value={p.args.multiply} oninput={makeRandom} /></p>
{#if p.args.valid && p.args.out.result == -1}
	<p>Preview:</p>
	<p>X: {result}</p>
{:else if p.args.out.result > 0}
	<ColumnComponent col={getColumnById(p.args.out.result)} />
{:else}
	<p>Need to have valid inputs to create columns.</p>
{/if}
