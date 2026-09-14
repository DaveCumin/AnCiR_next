<!--
	The title row of one Data-tab series block, shared by every plot.

	One component instead of 13 hand-rolled headers, because the header now does three
	things and each was previously missing or duplicated per plot:

	  - TITLE: the wired column's name (live through renames — seriesDisplayLabel reads
	    the reactive column), falling back to the plot's positional text ("Data 2") while
	    unwired. Where the series carries a user label the title is editable in place and
	    the column name becomes the placeholder. Long names truncate with an ellipsis;
	    the full text rides on the title attribute.
	  - DELETE: routed through removeSeriesWithUndo, so it is one undoable history step
	    with a toast offering the undo — never a bare `theData.removeData(i)`.
	  - EXTRA ICONS: per-plot buttons (Actogram's eye toggle) render via the `icons`
	    snippet after the trash button, keeping each plot's additions local to it.
	    Plots with a colour picker in the header (Actogram) pass it via the `swatch`
	    snippet, rendered before the title.

	A PASSIVE colour swatch (an inert dot showing the series' resolved colour) was
	tried here and rejected (2026-09-14): it looked clickable but was not, and the
	column-name title already identifies the block. See the vault note
	"2026-09-14-series-swatch-rejected". Don't re-add it.

	Styling is self-contained: the old markup relied on each plot's own scoped
	.control-component-title rules, which cannot reach into this component.
-->
<script>
	import Icon from '$lib/icons/Icon.svelte';
	import Editable from '$lib/components/inputs/Editable.svelte';
	import { seriesDisplayLabel } from '$lib/components/plotbits/helpers/seriesLabel.js';
	import { removeSeriesWithUndo } from '$lib/plots/seriesDelete.js';
	import { seriesComputeWarning } from '$lib/plots/seriesHealth.js';

	let {
		/** the plot's inner data object (`theData`) — carries parentBox + removeData */
		inner,
		/** the series this block describes */
		datum,
		/** its position in inner.data */
		index = 0,
		/** whether the series carries a persistent user label (datum.label) */
		editable = true,
		/** positional fallback title while nothing is wired; plots may override
		 *  (PairsPlot says "Variable 1"). Defaults to "Data N". */
		fallback = null,
		removeTooltip = 'Remove this data series',
		/** an interactive colour control rendered before the title (Actogram's ColourPicker) */
		swatch = null,
		/** extra per-plot buttons, rendered after the trash button */
		icons = null
	} = $props();

	const positional = $derived(fallback ?? `Data ${index + 1}`);
	// The one shared title-string helper: user label → wired column name → positional.
	const columnTitle = $derived(seriesDisplayLabel(datum, { fallback: positional }));
	// What the Editable shows as ghost text while the label is blank: the same
	// string minus the user-label tier (the label IS the Editable's own value).
	// Only the name-bearing fields are handed over — spreading the whole datum
	// would read every computed field on the class.
	const placeholder = $derived(
		seriesDisplayLabel({ y: datum?.y, column: datum?.column }, { fallback: positional })
	);

	// Dead-series diagnosis: a WIRED series whose inputs cannot compute renders
	// nothing on the canvas, so the block says why (seriesHealth.js). Unwired
	// blocks stay quiet — empty pickers already say "not wired yet".
	const computeWarning = $derived(seriesComputeWarning(datum, columnTitle));
</script>

<div class="series-block-header">
	<div class="series-block-identity">
		{#if swatch}
			{@render swatch()}
		{/if}
		<p class="series-title" title={columnTitle}>
			{#if editable}
				<Editable bind:value={datum.label} {placeholder} />
			{:else}
				{columnTitle}
			{/if}
		</p>
	</div>
	<div class="series-block-icons">
		<button class="icon" title={removeTooltip} onclick={() => removeSeriesWithUndo(inner, index)}>
			<Icon name="trash" width={16} height={16} className="series-block-icon" />
		</button>
		{@render icons?.()}
	</div>
</div>

{#if computeWarning}
	<!-- Same house style as the plots' own .data-warning blocks (Periodogram /
	     Boxplot data-quality cautions), self-contained because their scoped
	     rules cannot reach into this component. -->
	<div class="data-warning">
		<p>⚠ {computeWarning}</p>
	</div>
{/if}

<style>
	.series-block-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		font-weight: 600;
		margin-bottom: var(--space-2);
	}

	.series-block-identity {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-width: 0; /* let the title shrink so the ellipsis can engage */
		flex: 1;
	}

	.series-title {
		margin: 0;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* The Editable inside renders its own span/input; keep it on one line so the
	   title's ellipsis rule applies to it too. */
	.series-title :global(span),
	.series-title :global(input) {
		white-space: nowrap;
	}

	.series-block-icons {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-shrink: 0;
	}

	.data-warning {
		margin: 0 0 var(--space-2);
		padding: 0.45rem 0.6rem;
		border-radius: 0.375rem;
		background: color-mix(in srgb, #f5c76a 18%, white);
		border: 1px solid color-mix(in srgb, #d89c1b 35%, white);
		font-weight: 400;
	}

	.data-warning p {
		margin: 0.15rem 0;
		font-size: 0.92em;
	}

	button.icon {
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
	}
</style>
