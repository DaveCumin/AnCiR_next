<script module>
	export function getCanvasWidthPx() {
		return canvasWidthPx;
	}
	let canvasWidthPx = $derived.by(() => {
		const whole = appState.windowWidth - appState.widthNavBar;
		const displayWidth = appState.showDisplayPanel ? appState.widthDisplayPanel : 0;
		const controlWidth = appState.showControlPanel ? appState.widthControlPanel : 0;
		return whole - displayWidth - controlWidth;
	});
</script>

<script>
	// @ts-nocheck
	import Draggable from '$lib/components/reusables/Draggable.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import NoteCard from '$lib/components/views/NoteCard.svelte';
	import WorksheetAddPalette from '$lib/components/views/WorksheetAddPalette.svelte';
	import { tooltip } from '$lib/utils/tooltip.js';

	import { core, appConsts, appState } from '$lib/core/core.svelte.js';
	import { createLazyPointerCapture } from '$lib/core/lazyPointerCapture.js';
	import { onMount, tick, untrack } from 'svelte';
	import { fly, fade } from 'svelte/transition';

	import { deselectAllPlots } from '$lib/core/Plot.svelte';
	import { removePlots } from '$lib/core/Plot.svelte';
	import { canvasFileDrop } from '$lib/core/canvasFileDrop.js';
	import { handleCanvasFileDrop } from '$lib/core/dataSourceActions.js';
	import SelectionLayoutToolbar from '$lib/components/reusables/SelectionLayoutToolbar.svelte';
	import PlotSelectionToolbar from '$lib/components/reusables/PlotSelectionToolbar.svelte';
	import { isZoomMode, setZoomMode } from '$lib/plots/plotZoomMode.svelte.js';
	import { alignBoxes, distributeBoxes, arrangeGrid } from '$lib/core/layoutHelpers.js';
	import { snapToGrid } from '$lib/core/core.svelte.js';

	let fileDragOver = $state(false);

	// --- Multi-plot align / distribute / grid (worksheet) ---
	let selectedPlots = $derived(core.plots.filter((p) => p.selected));

	// Zoom mode is a per-plot tool that only makes sense while the plot is selected
	// (the toolbar that toggles it shows on selection). Clear it whenever a plot is
	// deselected, so re-selecting always starts from zoom-off. Tracks each plot's
	// `selected`; the clearing is untracked (setZoomMode is a no-op when unchanged).
	$effect(() => {
		core.plots.forEach((p) => p.selected); // establish selection dependency
		untrack(() => {
			for (const p of core.plots) if (!p.selected) setZoomMode(p.id, false);
		});
	});

	// Box footprint mirrors Draggable's rendered size (width + 20, height + 50)
	// so alignment uses what the user actually sees.
	function plotBoxes() {
		return selectedPlots.map((p) => ({
			id: p.id,
			x: p.x,
			y: p.y,
			w: (p.width ?? 200) + 20,
			h: (p.height ?? 150) + 50
		}));
	}
	function applyPlotPositions(map) {
		for (const p of core.plots) {
			const np = map.get(p.id);
			if (np) {
				p.x = snapToGrid(np.x);
				p.y = snapToGrid(np.y);
			}
		}
	}
	function alignSelectedPlots(mode) {
		applyPlotPositions(alignBoxes(plotBoxes(), mode));
	}
	function distributeSelectedPlots(axis) {
		applyPlotPositions(distributeBoxes(plotBoxes(), axis));
	}
	function gridSelectedPlots() {
		applyPlotPositions(arrangeGrid(plotBoxes(), { snap: snapToGrid }));
	}

	const MIN_ZOOM = 0.15;
	const MAX_ZOOM = 4;
	const ZOOM_STEP = 0.1;

	let selectedPlotIds = $derived.by(() => core.plots.filter((p) => p.selected).map((p) => p.id));

	// The workspace viewport is appState.canvasOffset + appState.canvasScale, which
	// persist across view switches (module state), reset on a fresh page load (see
	// +page.svelte), and are restored from a loaded session by loadAppState — so no
	// separate per-view persistence is needed here.

	let showNewPlotModal = $state(false);
	let canvasViewportEl = $state(null);
	let isPanning = $state(false);
	let panStartX = $state(0);
	let panStartY = $state(0);

	// --- Pointer input (mouse + touch + pen), mirroring WorkflowEditor ----------
	// The workspace pans via pointer events so a finger drives it like a mouse;
	// plots themselves are moved by Draggable (which keeps its own touch handling).
	/** The .canvas element — owns move/up and takes pointer capture. */
	let canvasEl = $state(null);
	let activePointerId = $state(null);
	// Capture is taken LAZILY (see lazyPointerCapture.js): capturing at press time would retarget the
	// pointerup to the canvas root, so buttons inside the canvas would never get a click.
	const lazyCapture = createLazyPointerCapture(() => canvasEl);
	function capturePointer(e) {
		activePointerId = e.pointerId;
		lazyCapture.arm(e);
	}
	const takeCaptureIfMoved = (e) => lazyCapture.maybeTake(e);
	function releasePointer() {
		lazyCapture.release();
		activePointerId = null;
	}

	// Two-finger pinch-zoom + pan (Tier 2). Only background pointers land here —
	// Draggable and the interactive chrome stop pointerdown before it bubbles.
	const activePointers = new Map();
	let pinchPrev = null;
	const pinchActive = () => activePointers.size >= 2;
	function pinchMetrics() {
		const pts = [...activePointers.values()];
		if (pts.length < 2) return null;
		const [a, b] = pts;
		return {
			cx: (a.x + b.x) / 2,
			cy: (a.y + b.y) / 2,
			dist: Math.hypot(b.x - a.x, b.y - a.y) || 1
		};
	}
	/** Zoom to `target` (clamped) keeping the canvas point under (clientX,clientY) fixed. */
	function zoomAtClientPoint(target, clientX, clientY) {
		const oldZoom = appState.canvasScale ?? 1;
		const newZoom = Math.min(Math.max(target, MIN_ZOOM), MAX_ZOOM);
		const rect = canvasViewportEl?.getBoundingClientRect() ?? { left: 0, top: 0 };
		const relX = clientX - rect.left;
		const relY = clientY - rect.top;
		const offX = appState.canvasOffset?.x ?? 0;
		const offY = appState.canvasOffset?.y ?? 0;
		const canvasX = (relX - offX) / oldZoom;
		const canvasY = (relY - offY) / oldZoom;
		appState.canvasOffset = { x: relX - canvasX * newZoom, y: relY - canvasY * newZoom };
		appState.canvasScale = newZoom;
	}
	function updatePinch() {
		const cur = pinchMetrics();
		if (!cur) return;
		if (pinchPrev) {
			zoomAtClientPoint(((appState.canvasScale ?? 1) * cur.dist) / pinchPrev.dist, cur.cx, cur.cy);
			appState.canvasOffset = {
				x: (appState.canvasOffset?.x ?? 0) + (cur.cx - pinchPrev.cx),
				y: (appState.canvasOffset?.y ?? 0) + (cur.cy - pinchPrev.cy)
			};
		}
		pinchPrev = cur;
	}

	function handleClick(e) {
		// Suppress the deselect-all if we just panned: mouseup synthesises a click
		// at the same coords, and we don't want a pan-end to also clear selection.
		if (panMoved) {
			panMoved = false;
			return;
		}
		e.stopPropagation();
		deselectAllPlots();
	}

	let leftPx = $derived.by(() => {
		if (appState.showDisplayPanel) {
			return appState.widthDisplayPanel + appState.widthNavBar;
		}
		return appState.widthNavBar;
	});

	let rightPx = $derived.by(() => (appState.showControlPanel ? appState.widthControlPanel : 0));

	function resetCanvasView() {
		appState.canvasOffset = { x: 0, y: 0 };
		appState.canvasScale = 1;
	}

	function setZoom(newZoom) {
		appState.canvasScale = Math.min(Math.max(newZoom, MIN_ZOOM), MAX_ZOOM);
	}

	function handleWheel(e) {
		// Don't hijack wheel events that originate inside floating overlays —
		// modal bodies, dropdowns, plot internals. Without this, scrolling inside
		// any of those moves the canvas instead. Ctrl/meta + wheel always zooms,
		// so let it through.
		if (
			!e.ctrlKey &&
			!e.metaKey &&
			e.target?.closest?.(
				'dialog, .backdrop, .np-menu, .palette-menu, .modal, .modal-content, ' +
					'.modal-overlay, .dropdown, .dropdown-menu, .submenu, textarea, ' +
					'.control-panel'
			)
		) {
			return;
		}
		e.preventDefault();
		if (e.ctrlKey || e.metaKey) {
			// Trackpad pinch — same anchored zoom as a touch pinch.
			const factor = e.deltaY > 0 ? 0.9 : 1.1;
			zoomAtClientPoint((appState.canvasScale ?? 1) * factor, e.clientX, e.clientY);
		} else {
			appState.canvasOffset = {
				x: (appState.canvasOffset?.x ?? 0) - e.deltaX,
				y: (appState.canvasOffset?.y ?? 0) - e.deltaY
			};
		}
	}

	let panMoved = false;

	function handleCanvasPointerDown(e) {
		if (e.button !== 0) return;
		// Track background fingers; a SECOND one switches into a pinch (see handlePointerMove).
		// Only pan when the press lands on the canvas surface itself — Draggable and the chrome
		// stop pointerdown before we see it, so any event reaching here started on empty canvas.
		activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
		if (activePointers.size >= 2) {
			isPanning = false;
			pinchPrev = null;
			try {
				canvasEl?.setPointerCapture?.(e.pointerId);
			} catch {
				/* ignore */
			}
			return;
		}
		isPanning = true;
		panMoved = false;
		panStartX = e.clientX - (appState.canvasOffset?.x ?? 0);
		panStartY = e.clientY - (appState.canvasOffset?.y ?? 0);
		capturePointer(e);
	}

	function handlePointerMove(e) {
		// Pinch takes priority while two fingers are down.
		if (activePointers.has(e.pointerId)) {
			activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
			if (pinchActive()) {
				updatePinch();
				return;
			}
		}
		if (!isPanning) return;
		if (activePointerId != null && e.pointerId !== activePointerId) return;
		takeCaptureIfMoved(e);
		const nx = e.clientX - panStartX;
		const ny = e.clientY - panStartY;
		if (
			!panMoved &&
			(Math.abs(nx - (appState.canvasOffset?.x ?? 0)) > 2 ||
				Math.abs(ny - (appState.canvasOffset?.y ?? 0)) > 2)
		) {
			panMoved = true;
		}
		appState.canvasOffset = { x: nx, y: ny };
	}

	function handlePointerUp(e) {
		const wasBackground = activePointers.delete(e.pointerId);
		if (wasBackground) {
			try {
				canvasEl?.releasePointerCapture?.(e.pointerId);
			} catch {
				/* ignore */
			}
			if (activePointers.size === 1) {
				// Pinch → one finger: hand the survivor to a fresh pan so the gesture continues.
				pinchPrev = null;
				const [remaining] = activePointers.values();
				isPanning = true;
				panStartX = remaining.x - (appState.canvasOffset?.x ?? 0);
				panStartY = remaining.y - (appState.canvasOffset?.y ?? 0);
				return;
			}
			if (activePointers.size >= 2) return;
		}
		releasePointer();
		isPanning = false;
		pinchPrev = null;
		activePointers.clear();
	}

	// Viewport sanity check: on first content render, if nothing is visible in the
	// current viewport (stale persisted pan/zoom), snap back to origin so the user
	// has a recovery affordance. Mirrors the same guard in WorkflowEditor.
	let _viewportSanityChecked = false;
	$effect(() => {
		if (_viewportSanityChecked) return;
		if (!canvasViewportEl) return;
		const items = [
			...core.plots.map((p) => ({ x: p.x, y: p.y, w: p.width + 20, h: p.height + 50 })),
			...core.notes.map((n) => ({ x: n.x, y: n.y, w: n.width, h: n.height }))
		];
		if (items.length === 0) return;
		const rect = canvasViewportEl.getBoundingClientRect();
		if (!(rect.width > 0 && rect.height > 0)) return;
		const z = appState.canvasScale ?? 1;
		const offX = appState.canvasOffset?.x ?? 0;
		const offY = appState.canvasOffset?.y ?? 0;
		const margin = 100;
		const anyVisible = items.some((it) => {
			const sx = offX + it.x * z;
			const sy = offY + it.y * z;
			return (
				sx + it.w * z > -margin &&
				sx < rect.width + margin &&
				sy + it.h * z > -margin &&
				sy < rect.height + margin
			);
		});
		if (!anyVisible) resetCanvasView();
		_viewportSanityChecked = true;
	});

	// The Data panel is independent of the canvas view — switching to the
	// workspace must not force it open. It's toggled from the nav rail only.

	// Background grid: rendered on the static viewport so it covers the whole
	// visible area regardless of pan. Cell size scales with zoom and the pattern
	// is offset by (canvasOffset modulo cellSize) so it slides smoothly under
	// the content as the user pans, keeping the visual grid aligned with the
	// snap-to-grid positions of plots.
	let gridCellPx = $derived((appState.gridSize ?? 15) * (appState.canvasScale ?? 1));
	let gridOffsetX = $derived(
		gridCellPx > 0 ? (((appState.canvasOffset?.x ?? 0) % gridCellPx) + gridCellPx) % gridCellPx : 0
	);
	let gridOffsetY = $derived(
		gridCellPx > 0 ? (((appState.canvasOffset?.y ?? 0) % gridCellPx) + gridCellPx) % gridCellPx : 0
	);

	onMount(() => {
		const onKeyDown = (e) => {
			const active = document.activeElement;

			const isTextInput =
				active &&
				(active.tagName === 'INPUT' ||
					active.tagName === 'TEXTAREA' ||
					active.getAttribute('contenteditable') === 'true');

			if (isTextInput) return;

			// if ((e.key === 'Backspace' || e.key === 'Delete') && selectedPlotIds.length > 0) {
			// 	removePlots(selectedPlotIds);
			// }
		};

		window.addEventListener('keydown', onKeyDown);
		return () => {
			window.removeEventListener('keydown', onKeyDown);
		};
	});
</script>

<div
	onclick={handleClick}
	ondblclick={() => (appState.showControlPanel = false)}
	class="canvas"
	style="top: 0;
			left: {leftPx}px;
			width: {canvasWidthPx}px;
			height: 100vh;
			"
	bind:this={canvasEl}
	onwheel={handleWheel}
	onpointerdown={handleCanvasPointerDown}
	onpointermove={handlePointerMove}
	onpointerup={handlePointerUp}
	onpointercancel={handlePointerUp}
	use:canvasFileDrop={{ onActive: (v) => (fileDragOver = v), onDrop: handleCanvasFileDrop }}
	role="presentation"
>
	{#if fileDragOver}
		<div class="canvas-file-drop-overlay"><span>Drop a data file to import</span></div>
	{/if}

	{#if selectedPlots.length >= 2}
		<div class="selection-toolbar-host">
			<SelectionLayoutToolbar
				onAlign={alignSelectedPlots}
				onDistribute={distributeSelectedPlots}
				onGrid={gridSelectedPlots}
				showGrid={true}
				canDistribute={selectedPlots.length >= 3}
			/>
		</div>
	{:else if selectedPlots.length === 1}
		<div class="selection-toolbar-host">
			<PlotSelectionToolbar plot={selectedPlots[0]} />
		</div>
	{/if}
	<div
		class="canvas-viewport"
		class:panning={isPanning}
		bind:this={canvasViewportEl}
		style="--grid-cell: {gridCellPx}px; --grid-x: {gridOffsetX}px; --grid-y: {gridOffsetY}px;"
	>
		<div
			class="canvas-inner"
			style="
			transform: translate({appState.canvasOffset?.x ?? 0}px, {appState.canvasOffset?.y ?? 0}px) scale({appState.canvasScale});
			transform-origin: 0 0;
		"
		>
			{#each core.notes as note (note.id)}
				<NoteCard {note} viewportEl={canvasViewportEl} />
			{/each}

			{#if core.plots.length > 0}
				{#each core.plots as plot, i (plot.id)}
					{#if !appState.invisiblePlotIds.includes(plot.id) && !plot.facet}
						<!-- Facet generators don't render as a card here; their children do. -->
						<Draggable
							bind:x={plot.x}
							bind:y={plot.y}
							bind:width={plot.width}
							bind:height={plot.height}
							bind:title={plot.name}
							id={plot.id}
							bind:selected={plot.selected}
							viewportEl={canvasViewportEl}
						>
							{@const Plot = appConsts.plotMap.get(plot.type).plot ?? null}
							<Plot theData={plot} which="plot" brushable={true} zoomMode={isZoomMode(plot.id)} />
						</Draggable>
					{/if}
				{/each}
			{/if}
		</div>

		<!-- The empty-session case is covered by the start screen; this prompt only ever offered
		     the same three routes again (and import also lives in the node palette and the data
		     panel), so the worksheet's own empty state is now just "add a plot". -->
		{#if core.plots.length === 0 && core.notes.length === 0 && core.data.length > 0}
			<div class="no-plot-prompt" out:fade={{ duration: 600 }}>
				<button class="icon" onclick={() => (showNewPlotModal = true)}>
					<Icon name="add" width={24} height={24} />
				</button>
				<p style="margin-left: 10px">Click here to add a plot</p>
			</div>

			<WorksheetAddPalette
				bind:open={showNewPlotModal}
				top={window.innerHeight / 2 - 25}
				left={window.innerWidth / 2 - 40}
			/>
		{/if}
	</div>
</div>

<div class="zoom-controls" style="right: calc({rightPx}px + 5px);">
	<button
		type="button"
		class="icon viewport-btn"
		onclick={(e) => {
			e.stopPropagation();
			resetCanvasView();
		}}
		aria-label="Reset viewport"
		{@attach tooltip('Reset viewport (snap pan + zoom to origin)')}
	>
		<Icon name="center" width={22} height={22} />
	</button>
	<div class="zc-sep"></div>
	<button
		class="icon zoomout viewport-btn"
		onclick={(e) => {
			e.stopPropagation();
			setZoom((appState.canvasScale ?? 1) - ZOOM_STEP);
		}}
		aria-label="Zoom out"
		{@attach tooltip('Zoom out')}
	>
		<Icon name="zoom-out" width={24} height={24} />
	</button>
	<button
		class="icon zoomin viewport-btn"
		onclick={(e) => {
			e.stopPropagation();
			setZoom((appState.canvasScale ?? 1) + ZOOM_STEP);
		}}
		aria-label="Zoom in"
		{@attach tooltip('Zoom in')}
	>
		<Icon name="zoom-in" width={24} height={24} />
	</button>
</div>

<style>
	.canvas {
		position: fixed;
		overflow: hidden;
		transition:
			width 0.6s ease,
			left 0.6s ease;
		/* Own every touch gesture ourselves (see WorkflowEditor) — otherwise the
		   browser claims one-finger drags for scroll and two-finger for zoom. */
		touch-action: none;
	}

	.canvas-viewport {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
		cursor: grab;
		/* Snap grid: plots snap to it, so (unlike the workflow canvas) the workspace
		   keeps a visible grid. Same base tint; pattern is cell-sized and shifted by
		   the pan offset so it stays aligned with snap-to-grid plot positions. */
		background-color: var(--surface-canvas);
		background-image:
			linear-gradient(to right, var(--grid-line) 0, var(--grid-line) 1px, transparent 1px),
			linear-gradient(to bottom, var(--grid-line) 0, var(--grid-line) 1px, transparent 1px);
		background-size: var(--grid-cell, 15px) var(--grid-cell, 15px);
		background-position: var(--grid-x, 0) var(--grid-y, 0);
	}

	.canvas-viewport.panning {
		cursor: grabbing;
	}

	.canvas-inner {
		position: absolute;
		top: 0;
		left: 0;
		width: 0;
		height: 0;
	}

	.selection-toolbar-host {
		position: absolute;
		top: 12px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 40;
		pointer-events: none;
	}

	.no-plot-prompt {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: center;

		font-weight: 600;
		pointer-events: none;
	}

	.no-plot-prompt button,
	.no-plot-prompt p {
		pointer-events: auto;
	}

	.no-plot-prompt p {
		/* 16px/600 is NOT WCAG "large text" (that needs >=18.66px bold), so this
		   empty-state CTA is held to 4.5:1. The old grey was 1.97:1 on the canvas. */
		color: var(--color-text-muted);
	}

	/* Grouped viewport toolbar — a card matching the workflow canvas + selection
	   layout toolbar. */
	.zoom-controls {
		position: fixed;
		bottom: 10px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		z-index: 999;
		transition: right 0.6s ease;
		background: var(--surface-card);
		border: 1px solid var(--color-lightness-85);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-card);
		padding: 4px;
	}
	.zoom-controls button {
		width: 28px;
		height: 26px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: none;
		border-radius: 5px;
		background: transparent;
		cursor: pointer;
	}
	.zoom-controls button:hover {
		background: var(--color-lightness-95);
	}
	.zc-sep {
		width: 22px;
		height: 1px;
		background: var(--color-lightness-90);
		margin: 2px 0;
	}

	.viewport-btn {
		color: var(--color-text-muted);
		transition:
			color 0.18s ease,
			transform 0.32s ease;
	}

	.viewport-btn:hover {
		/* Icon paint, so 3:1 applies — and --color-accent is 2.84:1, which misses
		   even that. --color-accent-text is the same hue, 5.28:1. */
		color: var(--color-accent-text);
	}

	.viewport-btn:active {
		transform: scale(0.95);
	}
</style>
