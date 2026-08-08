<!--
	Per-category colour controls for a category-coloured boxplot.

	A boxplot with ONE series and a categorical x column draws one box per unique x
	VALUE, each in its own colour from core.categoryColours (see plots/seriesColour.js
	and useCategoryColour in plots/Boxplot/Boxplot.svelte). Until this component, no UI
	anywhere wrote that map: the panel showed only the single series' stroke/fill
	pickers, which category colouring overrides — so the user saw N differently-coloured
	boxes and exactly one (inert) colour control.

	Rendered from ControlDisplay on the plot's Data tab, OUTSIDE the plot component
	itself, because the category map is session-wide (a label keeps its colour across
	every figure that draws it), not a property of one figure.

	Reads are pure (colourForCategoryLabel); writes happen only in the picker's event
	handlers via setCategoryColour, never during render — see the state_unsafe_mutation
	note in plots/appearanceIdentity.js.
-->
<script>
	import ColourPicker, { getPaletteColor } from '$lib/components/inputs/ColourPicker.svelte';
	import {
		categoryColourLabels,
		colourForCategoryLabel,
		setCategoryColour
	} from '$lib/plots/seriesColour.js';

	let { plot } = $props();

	const labels = $derived(categoryColourLabels(plot));
</script>

{#if labels.length > 0}
	<div class="control-component">
		<div class="control-component-title">
			<p>Box colours</p>
		</div>
		<div class="category-colour-grid">
			{#each labels as label, i (label)}
				<div class="category-colour-row">
					<ColourPicker
						bind:value={
							() => colourForCategoryLabel(label) ?? getPaletteColor(i),
							(v) => setCategoryColour(label, v)
						}
					/>
					<p class="category-colour-label" title={label}>{label}</p>
				</div>
			{/each}
		</div>
	</div>
	<div class="div-line"></div>
{/if}

<style>
	.category-colour-grid {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-4);
	}

	.category-colour-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}

	.category-colour-label {
		margin: 0;
		font-size: var(--font-xs);
		max-width: 8rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
