<script>
	// @ts-nocheck
	// Floating toolbar shown when exactly ONE plot is selected in the workspace.
	// - Zoom: toggles zoom mode for this plot (drag-to-box-zoom + scroll-to-zoom).
	//         Shift+scroll always zooms regardless (handled in the plot).
	// - Reset: clears the zoom back to auto limits (also resets facet siblings' x).
	// - Save: the same PNG/SVG/data export menu the control panel offers.
	// Presentational shell around shared helpers; positioned by the parent host.
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

	// Save menu (reuses the control panel's SavePlot dropdown).
	let showSave = $state(false);
	let saveTop = $state(0);
	let saveLeft = $state(0);
	let saveBtn = $state(null);
	function toggleSave() {
		const r = saveBtn?.getBoundingClientRect();
		if (r) {
			saveTop = r.bottom + 4;
			saveLeft = r.left;
		}
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
			<Icon name="search" width={18} height={18} />
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
			<Icon name="reset" width={18} height={18} />
		</button>
		<span class="pt-sep" aria-hidden="true"></span>
	{/if}

	<button
		type="button"
		class="pt-btn"
		bind:this={saveBtn}
		class:active={showSave}
		onclick={(e) => {
			e.stopPropagation();
			toggleSave();
		}}
		aria-label="Save plot"
		{@attach tooltip('Save / export this plot')}
	>
		<Icon name="disk" width={18} height={18} />
	</button>
</div>

<SavePlot bind:showDropdown={showSave} dropdownTop={saveTop} dropdownLeft={saveLeft} Id={'plot' + plot.id} />

<style>
	.plot-toolbar {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 2px;
		padding: 4px 6px;
		background: var(--surface-card);
		border: 1px solid var(--color-lightness-85);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-card);
		pointer-events: auto;
	}

	.pt-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 26px;
		padding: 0;
		border: none;
		border-radius: 5px;
		background: transparent;
		color: var(--color-lightness-35);
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease;
	}

	.pt-btn:hover:not(:disabled) {
		background: var(--color-lightness-95);
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
		align-self: stretch;
		margin: 2px 3px;
		background: var(--color-lightness-90);
	}
</style>
