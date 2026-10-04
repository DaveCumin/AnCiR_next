<script>
	// @ts-nocheck
	/**
	 * The "Padding" block for plots whose padding can follow an automatic value
	 * (Periodogram, Correlogram, FFT). Each side is a labelled number field; a side
	 * that differs from its automatic value gets a named reset button, and the title
	 * row gets one that resets every side.
	 *
	 * This block used to be pasted into each plot as `<div class="control-input"><p>Top</p>`
	 * rows, which left the four fields and the five icon-only reset buttons without an
	 * accessible name (review UI-5). One copy here keeps them named.
	 *
	 * Props:
	 *  - padding: {top, bottom, left, right} (bindable; edited in place)
	 *  - auto: the automatic values, same shape, or null/undefined when there are none
	 *  - onReset(side): reset one side ('top' | 'bottom' | 'left' | 'right') or 'all'
	 */
	import Icon from '$lib/icons/Icon.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';

	let { padding = $bindable(), auto = null, onReset = () => {} } = $props();

	const SIDES = [
		{ key: 'top', label: 'Top' },
		{ key: 'bottom', label: 'Bottom' },
		{ key: 'left', label: 'Left' },
		{ key: 'right', label: 'Right' }
	];

	/** A side can be reset when it has an automatic value and is not at it. */
	const differs = (key) => auto?.[key] != null && auto[key] != padding?.[key];
	let anyDiffers = $derived(SIDES.some((s) => differs(s.key)));
</script>

<div class="control-component">
	<div class="control-component-title">
		<p>Padding</p>
		{#if anyDiffers}
			<button
				class="icon"
				type="button"
				aria-label="Reset all padding to automatic"
				title="Reset all padding to automatic"
				onclick={() => onReset('all')}
			>
				<Icon name="reset" width={14} height={14} className="control-component-input-icon" />
			</button>
		{/if}
	</div>

	<div class="control-input-square">
		{#each SIDES as side (side.key)}
			<ControlInput label={side.label}>
				<div class="padding-row">
					<NumberWithUnits
						bind:value={padding[side.key]}
						style="width: calc(100% - {differs(side.key) ? 24 : 0}px)"
					/>
					{#if differs(side.key)}
						<button
							class="icon"
							type="button"
							aria-label={`Reset ${side.key} padding to automatic`}
							title={`Reset ${side.key} padding to automatic`}
							onclick={() => onReset(side.key)}
						>
							<Icon name="reset" width={14} height={14} className="control-component-input-icon" />
						</button>
					{/if}
				</div>
			</ControlInput>
		{/each}
	</div>
</div>

<style>
	.padding-row {
		display: flex;
		justify-content: flex-start;
		align-items: center;
		gap: 8px;
	}
</style>
