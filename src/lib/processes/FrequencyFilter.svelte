<script module>
	// @ts-nocheck
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import { fftFilter } from '$lib/utils/filters.js';

	const frequencyfilter_defaults = new Map([
		['type', { val: 'low' }],
		['low', { val: 0.1 }],
		['high', { val: 0.4 }]
	]);

	export const frequencyFilterTypeOptions = ['low', 'high', 'band'];
	export const frequencyFilterTypeDisplay = ['Low-pass', 'High-pass', 'Band-pass'];

	// Column-process: transform one column's data → filtered array (same length).
	// Cutoffs are normalized frequency (fraction of Nyquist, 0..1). Assumes the
	// input is uniformly sampled in time.
	export function frequencyfilter(x, args) {
		const type = args.type ?? 'low';
		const low = Number(args.low ?? 0);
		const high = Number(args.high ?? 1);
		return fftFilter(x, { type, low, high });
	}

	export const definition = {
		displayName: 'Frequency Filter',
		func: frequencyfilter,
		defaults: frequencyfilter_defaults,
		nodeSpec: {
			id: 'process.frequencyfilter',
			inputs: [{ name: 'input', kind: 'column', cardinality: 'one' }],
			outputs: [{ name: 'output', kind: 'column', cardinality: 'one' }]
		}
	};
</script>

<script>
	// @ts-nocheck
	import ProcessShell from '$lib/core/ProcessShell.svelte';

	let { p = $bindable() } = $props();
</script>

<ProcessShell {p}>
	<div class="control-input">
		<p>Filter type</p>
		<AttributeSelect
			bind:value={p.args.type}
			options={frequencyFilterTypeOptions}
			optionsDisplay={frequencyFilterTypeDisplay}
		/>
	</div>

	{#if p.args.type === 'high' || p.args.type === 'band'}
		<ControlInput label="Low cutoff">
			<NumberWithUnits bind:value={p.args.low} step="0.01" min={0} max={1} />
		</ControlInput>
	{/if}

	{#if p.args.type === 'low' || p.args.type === 'band'}
		<ControlInput label="High cutoff">
			<NumberWithUnits bind:value={p.args.high} step="0.01" min={0} max={1} />
		</ControlInput>
	{/if}

	<div class="info-text">
		Cutoffs are a fraction of the Nyquist frequency (0 = DC, 1 = fastest resolvable). Assumes evenly
		sampled data.
	</div>
</ProcessShell>

<style>
	.info-text {
		font-size: var(--font-sm);
		color: var(--text-secondary, var(--color-text-muted));
		font-style: italic;
		margin-top: var(--space-2);
		word-break: break-word;
	}
</style>
