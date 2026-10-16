<script module>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import { isInvalidValue } from '$lib/utils/stats.js';

	// Missing in, missing (null) out: `i + value` read null and '' as 0 and concatenated a numeric string
	// (STAT-6). Missing is the house rule (isInvalidValue); a real 0 is data.
	export function add(x, args) {
		const value = Number(args.value);
		return x.map((i) => (isInvalidValue(i) ? null : Number(i) + value));
	}
	const add_defaults = new Map([['value', { val: Number(0) }]]);

	export const definition = {
		displayName: 'Add',
		func: add,
		defaults: add_defaults,
		nodeSpec: {
			id: 'process.add',
			inputs: [{ name: 'input', kind: 'column', cardinality: 'one' }],
			outputs: [{ name: 'output', kind: 'column', cardinality: 'one' }]
		}
	};
</script>

<script>
	import ProcessShell from '$lib/core/ProcessShell.svelte';

	let { p = $bindable() } = $props();

	// When the wired input is a time column, getData() is in UNIX ms, so the value
	// to add is a duration: offer mins / hrs / days and store it in ms (the factors
	// below), which `add` then adds straight onto the timestamps. Numeric inputs
	// keep the plain value. The unit choice follows the input column's type.
	const TIME_UNITS = { default: 'h', min: 60000, h: 3600000, days: 86400000 };
	let isTimeInput = $derived(p?.inputCol?.type === 'time');
</script>

<ProcessShell {p}>
	{#if isTimeInput}
		<NumberWithUnits bind:value={p.args.value} step="0.01" units={TIME_UNITS} />
	{:else}
		<NumberWithUnits bind:value={p.args.value} step="0.01" />
	{/if}
</ProcessShell>

<style>
</style>
