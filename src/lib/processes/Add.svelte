<script module>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';

	export function add(x, args) {
		const value = Number(args.value);
		return x.map((i) => i + value);
	}
	const add_defaults = new Map([['value', { val: Number(0) }]]);

	export const definition = { displayName: 'Add', func: add, defaults: add_defaults };
</script>

<script>
	import ProcessShell from '$lib/core/ProcessShell.svelte';

	let { p = $bindable() } = $props();
</script>

<ProcessShell {p}>
	<NumberWithUnits bind:value={p.args.value} step="0.01" />
</ProcessShell>

<style>
</style>
