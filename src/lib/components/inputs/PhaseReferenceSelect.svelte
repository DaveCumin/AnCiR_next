<script>
	// @ts-nocheck
	/**
	 * The shared "Phase reference" control for every node with phase outputs
	 * (acrophase, bathyphase, onsets, profile bin times). See
	 * src/lib/utils/phaseReference.js for what each option means.
	 *
	 * Clock time needs a real time axis, so it is disabled (with the reason) when
	 * x is not a time column. A saved "clock" on a numeric x stays selected so the
	 * user sees what was asked for; the node then reports since-first-sample and
	 * says so in its warnings.
	 *
	 * Props:
	 *  - value (bindable): 'start' | 'clock'; undefined reads as 'start'
	 *  - xIsTime: whether the node's x column is a time column
	 *  - onchange: called after the value changes
	 *  - numericOrigin: what hour 0 is when x is a plain number column. The fit
	 *      nodes model the x values as given, so their phases are measured from
	 *      x = 0; the folding nodes (NPCRA, Average Profile) measure from the first
	 *      sample. For a time column both mean the first sample.
	 */
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import {
		PHASE_REFERENCE_OPTIONS,
		PHASE_REFERENCE_CLOCK,
		PHASE_REFERENCE_START
	} from '$lib/utils/phaseReference.js';

	let {
		value = $bindable(),
		xIsTime = false,
		onchange = () => {},
		numericOrigin = 'x = 0'
	} = $props();
</script>

<!-- One wrapper, so the hint stacks under the select inside a horizontal control row. -->
<div class="phase-ref">
	<ControlInput label="Phase reference">
		<select
			value={value ?? PHASE_REFERENCE_START}
			onchange={(e) => {
				value = e.currentTarget.value;
				onchange();
			}}
			title="What hour 0 means for this node's phase outputs"
		>
			{#each PHASE_REFERENCE_OPTIONS as opt (opt.value)}
				<option
					value={opt.value}
					disabled={opt.value === PHASE_REFERENCE_CLOCK &&
						!xIsTime &&
						value !== PHASE_REFERENCE_CLOCK}>{opt.label}</option
				>
			{/each}
		</select>
	</ControlInput>
	{#if (value ?? PHASE_REFERENCE_START) === PHASE_REFERENCE_CLOCK}
		<p class="phase-ref-hint">
			Phases are hours after local midnight in the display timezone, wrapped to one period.
		</p>
	{:else}
		<p class="phase-ref-hint">
			{#if xIsTime}
				Phases are hours after the first sample.
			{:else}
				Phases are measured from {numericOrigin} in x's units. Clock time needs a time column as x.
			{/if}
		</p>
	{/if}
</div>

<style>
	.phase-ref {
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-width: 0;
	}
	.phase-ref-hint {
		font-size: var(--font-xs);
		color: var(--color-text-muted);
		margin: var(--space-1) 0 0;
	}
</style>
