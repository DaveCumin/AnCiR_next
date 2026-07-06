<script>
	// @ts-nocheck
	import { appConsts, core } from '$lib/core/core.svelte.js';

	let { plot, size, onResizeMouseDown } = $props();

	const PlotComp = $derived(appConsts.plotMap.get(plot?.type)?.plot);
	// Fit the real plot into the (independently-sized) preview box, preserving the
	// plot's aspect ratio. The workflow box size is owned by the canvas
	// (plotPreviewSizes); the plot's real width/height belong to the workspace and
	// aren't touched by a workflow resize.
	const previewScale = $derived(
		plot?.width && plot?.height ? Math.min(size.w / plot.width, size.h / plot.height) : 1
	);

	// Facet generator: preview the per-series child plots as a small-multiples grid
	// (matching the workspace), rather than the single all-series plot.
	const facetChildren = $derived(
		plot?.facet ? core.plots.filter((p) => p.facetParent === plot.id) : []
	);
	const isFacet = $derived(plot?.facet && facetChildren.length > 0);
	const gridCols = $derived(Math.max(1, Math.ceil(Math.sqrt(facetChildren.length || 1))));
	const gridRows = $derived(Math.max(1, Math.ceil(facetChildren.length / gridCols)));
	// Cell size inside the preview panel, and the scale to fit each child into it.
	const cellW = $derived(size.w / gridCols);
	const cellH = $derived(size.h / gridRows);
	function childScale(child) {
		if (!child?.width || !child?.height) return 1;
		return Math.min(cellW / child.width, cellH / child.height);
	}
</script>

{#if PlotComp && plot}
	<div class="plot-preview-panel" style="width:{size.w}px; height:{size.h}px;">
		{#if isFacet}
			<div
				class="facet-grid"
				style="grid-template-columns:repeat({gridCols}, 1fr); grid-template-rows:repeat({gridRows}, 1fr);"
			>
				{#each facetChildren as child (child.id)}
					{@const CComp = appConsts.plotMap.get(child.type)?.plot}
					<div class="facet-cell">
						{#if CComp}
							<div
								class="plot-preview-inner"
								style="transform:scale({childScale(
									child
								)}); transform-origin:top left; width:{child.width}px; height:{child.height}px;"
							>
								<CComp theData={child} which="plot" />
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{:else}
			<div
				class="plot-preview-inner"
				style="transform:scale({previewScale}); transform-origin:top left; width:{plot.width}px; height:{plot.height}px;"
			>
				<PlotComp theData={plot} which="plot" />
			</div>
		{/if}
		{#if onResizeMouseDown}
			<div
				class="plot-resize-handle"
				onmousedown={(e) => onResizeMouseDown(e)}
				title="Drag to resize"
				role="button"
				tabindex="-1"
			>
				⤡
			</div>
		{/if}
	</div>
{/if}

<style>
	.plot-preview-panel {
		overflow: hidden;
		border: 1.5px solid rgba(0, 0, 0, 0.15);
		border-top: none;
		border-bottom-left-radius: 6px;
		border-bottom-right-radius: 6px;
		background: var(--surface-card);
		box-shadow: var(--shadow-1);
		box-sizing: border-box;
		position: relative;
	}

	.plot-preview-inner {
		pointer-events: none;
	}

	.facet-grid {
		display: grid;
		width: 100%;
		height: 100%;
		gap: 1px;
		background: var(--divider-soft);
	}

	.facet-cell {
		overflow: hidden;
		background: var(--surface-card);
		position: relative;
	}

	.plot-resize-handle {
		position: absolute;
		bottom: 2px;
		right: 2px;
		width: 16px;
		height: 16px;
		font-size: var(--font-xs);
		line-height: 16px;
		text-align: center;
		cursor: nwse-resize;
		color: #888;
		background: rgba(255, 255, 255, 0.8);
		border-radius: 2px;
		user-select: none;
	}

	.plot-resize-handle:hover {
		color: var(--color-lightness-25);
		background: rgba(255, 255, 255, 1);
	}
</style>
