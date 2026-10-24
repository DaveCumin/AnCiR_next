<script>
	// @ts-nocheck
	// The actions of the ONE selected plot or facet panel in the workspace, docked in the
	// card's header (Draggable.svelte), so they never cover the plot. `plot` is a Plot or a
	// FacetPanel (same surface: id, type, plot).
	// - Zoom: toggles zoom mode for this plot (drag-to-box-zoom + scroll-to-zoom).
	//         Shift+scroll always zooms regardless (handled in the plot).
	// - Reset: clears the zoom back to auto limits (on a panel: the shared x on the
	//         generator and this panel's y override).
	// - Save: the same PNG/SVG/data export menu the control panel offers.
	// Presentational shell around shared helpers: flat, its buttons the size of the header's
	// other actions (NodeActions .na-btn).
	import Icon from '$lib/icons/Icon.svelte';
	import { tooltip } from '$lib/utils/tooltip.js';
	import { isZoomMode, toggleZoomMode } from '$lib/plots/plotZoomMode.svelte.js';
	import { getZoomAdapter, isZoomCapable } from '$lib/plots/zoomAdapters.js';
	import SavePlot from '$lib/components/iconActions/SavePlot.svelte';

	let { plot } = $props();

	// Scatterplot + the point plots (periodogram / correlogram / fft) support zoom.
	const canZoom = $derived(isZoomCapable(plot?.type));
	const zoomOn = $derived(!!plot && isZoomMode(plot.id));

	// The adapter knows each plot type's limit fields; recompute it reactively so
	// isZoomed tracks the live limits.
	const adapter = $derived(getZoomAdapter(plot));
	const isZoomed = $derived(!!adapter && adapter.isZoomed());

	function resetZoom() {
		adapter?.reset();
	}

	// Save dialog (the same SavePlot the control panel opens).
	let showSave = $state(false);
	function toggleSave() {
		showSave = !showSave;
	}
</script>

<div class="plot-toolbar" role="toolbar" aria-label="Plot actions">
	{#if canZoom}
		<button
			type="button"
			class="pt-btn"
			class:active={zoomOn}
			aria-pressed={zoomOn}
			onclick={(e) => {
				e.stopPropagation();
				toggleZoomMode(plot.id);
			}}
			aria-label="Zoom mode"
			{@attach tooltip('Zoom: drag a box or scroll to zoom (Shift+scroll always zooms)')}
		>
			<Icon name="search" width={15} height={15} />
		</button>
		<button
			type="button"
			class="pt-btn"
			disabled={!isZoomed}
			onclick={(e) => {
				e.stopPropagation();
				resetZoom();
			}}
			aria-label="Reset zoom"
			{@attach tooltip('Reset zoom to fit the data')}
		>
			<Icon name="reset" width={15} height={15} />
		</button>
		<span class="pt-sep" aria-hidden="true"></span>
	{/if}

	<button
		type="button"
		class="pt-btn"
		class:active={showSave}
		onclick={(e) => {
			e.stopPropagation();
			toggleSave();
		}}
		aria-label="Save plot"
		{@attach tooltip('Save / export this plot')}
	>
		<Icon name="disk" width={15} height={15} />
	</button>
</div>

<SavePlot bind:open={showSave} Id={plot.id} />

<style>
	.plot-toolbar {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 1px;
		pointer-events: auto;
	}

	.pt-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		padding: 0;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-lightness-35);
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease;
	}

	.pt-btn:hover:not(:disabled) {
		background: var(--color-lightness-88);
		color: var(--color-accent);
	}

	.pt-btn.active {
		background: color-mix(in srgb, var(--color-accent) 14%, transparent);
		color: var(--color-accent);
	}

	.pt-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.pt-sep {
		width: 1px;
		height: 14px;
		margin: 0 3px;
		background: var(--color-lightness-85);
	}
</style>
