<script module>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';

	export const random_defaults = new Map([
		['offset', { val: 0 }],
		['multiply', { val: 10 }],
		['N', { val: 10 }],
		['out', { result: { val: -1 } }], //needed to set upu the output columns
		['valid', { val: false }] //needed for the progress step logic
	]);

	export function random(argsIN) {
		let result = [];
		for (let i = 0; i < argsIN.N; i++) {
			result.push(Number((argsIN.offset + Math.random() * argsIN.multiply).toFixed(2)));
		}
		if (argsIN.out.result == -1 || !argsIN.out.result) {
		} else {
			getColumnById(argsIN.out.result).data = result;
			const processHash = crypto.randomUUID();
			getColumnById(argsIN.out.result).tableProcessGUId = processHash;
		}

		return [result, result.length > 0];
	}
</script>

<script>
	import ColumnComponent from '$lib/core/Column.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';
	import { onMount } from 'svelte';

	let { p = $bindable() } = $props();

	let result = $state();
	function doRandom() {
		[result, p.args.valid] = random(p.args);
	}
	onMount(() => {
		doRandom();
	});
</script>

<p>Offset: <NumberWithUnits bind:value={p.args.offset} onInput={doRandom} /></p>
<p>Multiply: <NumberWithUnits bind:value={p.args.multiply} onInput={doRandom} /></p>
{#if p.args.valid && p.args.out.result == -1}
	<p>Preview:</p>
	<p>X: {result}</p>
{:else if p.args.out.result > 0}
	<ColumnComponent col={getColumnById(p.args.out.result)} />
{:else}
	<p>Need to have valid inputs to create columns.</p>
{/if}
