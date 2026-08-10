<script>
	// @ts-nocheck
	import { appConsts, core } from '$lib/core/core.svelte.js';
	import { reportError } from '$lib/core/errorReporter.js';
	import { facetGridCells } from '$lib/core/facetGrid.js';

	let { plot, size, onResizeMouseDown } = $props();

	const PlotComp = $derived(appConsts.plotMap.get(plot?.type)?.plot);

	// A plot whose class exposes `renderBox` can LAY OUT at the node's size instead of being
	// drawn at its own size and scaled down. Feature-detected rather than listed by type, so
	// migrating another plot is a change in that plot and nowhere else.
	// `plot` is the Plot WRAPPER; the geometry lives on its inner class (`plot.plot`), which
	// is where `renderBox` is declared. Detecting on the wrapper silently found nothing and
	// left every plot on the old scaled path.
	const laysOutToBox = $derived(plot?.plot != null && 'renderBox' in plot.plot);

	// Hand the plot this view's size while the canvas owns the render, and TAKE IT BACK on
	// teardown. The two views never render at once (+page.svelte mounts WorkflowEditor or
	// PlotDisplay, never both), so a single field is enough — but only if it is cleared, or
	// the workspace would inherit the node's shape the moment the user switches back.
	$effect(() => {
		if (!laysOutToBox) return;
		const target = plot.plot;
		target.renderBox = { w: size.w, h: size.h };
		return () => {
			target.renderBox = null;
		};
	});
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
	// Same grid the worksheet lays the real children out on (automatic near-square, or the
	// generator's chosen facetRows), so the node thumbnail is a faithful miniature of it.
	//
	// The cells are placed EXPLICITLY rather than left to CSS auto-flow: a chosen row count
	// spreads the facets evenly and the rows can differ in length (4 on 3 rows is [2, 1, 1]),
	// which auto-flow would repack into a full 2-column grid and show a shape the worksheet
	// never draws. The track count still comes from the widest row, so rows stay left-aligned
	// and short rows simply leave their trailing cells empty.
	const facetGrid = $derived(facetGridCells(facetChildren.length, { rows: plot?.facetRows ?? 0 }));
	const gridCols = $derived(facetGrid.cols);
	const gridRows = $derived(facetGrid.rows);
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
				{#each facetChildren as child, i (child.id)}
					{@const CComp = appConsts.plotMap.get(child.type)?.plot}
					{@const cell = facetGrid.cells[i]}
					<div
						class="facet-cell"
						style="grid-column:{(cell?.col ?? 0) + 1}; grid-row:{(cell?.row ?? 0) + 1};"
					>
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
			<!-- A plot renders whatever columns it was wired to, and a wrong pairing is a normal
			     mistake to make (the AI, a shared session, a hand-rewire). Without a boundary one
			     such plot throws during render and takes the ENTIRE canvas with it — every other
			     node vanishes and the app looks like it lost the session. Contain it here: the
			     broken plot shows why, everything else keeps working, and undo still exists. -->
			<svelte:boundary onerror={(e) => reportError(e, { source: 'render', context: `rendering the ${plot.type} plot` })}>
				<!-- Two ways to fill the box. A plot that lays out to `renderBox` is drawn at
				     the node's real size, so its axes and legend arrange for that shape and its
				     text stays at full size. Everything else is still drawn at the figure's own
				     size and scaled to fit, which shrinks the text along with the plot. -->
				<div
					class="plot-preview-inner"
					style={laysOutToBox
						? `width:${size.w}px; height:${size.h}px;`
						: `transform:scale(${previewScale}); transform-origin:top left; width:${plot.width}px; height:${plot.height}px;`}
				>
					<PlotComp theData={plot} which="plot" />
				</div>

				{#snippet failed(error, reset)}
					<div class="plot-failed" role="alert">
						<strong>This plot couldn't be drawn.</strong>
						<p>{error?.message ?? 'Unknown error'}</p>
						<p class="plot-failed-hint">
							Check the columns it's wired to — undo reverses the change that added it.
						</p>
						<button onclick={reset}>Try again</button>
					</div>
				{/snippet}
			</svelte:boundary>
		{/if}
		{#if onResizeMouseDown}
			<div
				class="plot-resize-handle"
				onpointerdown={(e) => onResizeMouseDown(e)}
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

	.plot-failed {
		height: 100%;
		box-sizing: border-box;
		overflow: auto;
		padding: var(--space-2);
		font-size: var(--font-xs);
		color: var(--color-error);
		background: var(--color-error-bg);
	}
	.plot-failed p {
		margin: var(--space-1) 0 0;
		overflow-wrap: anywhere;
	}
	.plot-failed-hint {
		color: var(--color-text-muted);
	}
	.plot-failed button {
		margin-top: var(--space-2);
		font: inherit;
		font-size: var(--font-xs);
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--color-lightness-85);
		border-radius: var(--radius-sm);
		background: var(--color-lightness-99);
		cursor: pointer;
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
		color: var(--color-lightness-45);
		background: rgba(255, 255, 255, 0.8);
		border-radius: 2px;
		user-select: none;
	}

	.plot-resize-handle:hover {
		color: var(--color-lightness-25);
		background: rgba(255, 255, 255, 1);
	}
</style>
