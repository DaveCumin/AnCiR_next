<script module>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';

	export function multiply(x, args) {
		const value = Number(args.value);
		return x.map((i) => i * value);
	}
	const multiply_defaults = new Map([['value', { val: Number(1) }]]);

	export const definition = { displayName: 'Multiply', func: multiply, defaults: multiply_defaults };
</script>

<script>
	import ProcessShell from '$lib/core/ProcessShell.svelte';

	let { p = $bindable() } = $props();
</script>

<ProcessShell {p}>
	<NumberWithUnits bind:value={p.args.value} step="0.001" />
</ProcessShell>

<style>
</style>
