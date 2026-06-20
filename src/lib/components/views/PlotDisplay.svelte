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
	import AddDataPrompt from '$lib/components/views/AddDataPrompt.svelte';
	import { tooltip } from '$lib/utils/tooltip.js';

	import { core, appConsts, appState } from '$lib/core/core.svelte.js';
	import { onMount, tick } from 'svelte';
	import { fly, fade } from 'svelte/transition';

	import { deselectAllPlots } from '$lib/core/Plot.svelte';
	import { removePlots } from '$lib/core/Plot.svelte';
	import { canvasFileDrop } from '$lib/core/canvasFileDrop.js';
	import { handleCanvasFileDrop } from '$lib/core/dataSourceActions.js';
	import SelectionLayoutToolbar from '$lib/components/reusables/SelectionLayoutToolbar.svelte';
	import { alignBoxes, distributeBoxes, arrangeGrid } from '$lib/core/layoutHelpers.js';
	import { snapToGrid } from '$lib/core/core.svelte.js';

	let fileDragOver = $state(false);

	// --- Multi-plot align / distribute / grid (worksheet) ---
	let selectedPlots = $derived(core.plots.filter((p) => p.selected));

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

	// --- Plot-view viewport persistence ---
	// Separate from the workflow-canvas viewport (which lives under
	// `ancir.canvas.viewport`) so each view remembers its own zoom + pan.
	const PLOT_VIEWPORT_STORAGE_KEY = 'ancir.plotview.viewport';

	onMount(() => {
		try {
			const raw = localStorage.getItem(PLOT_VIEWPORT_STORAGE_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw);
			const x = Number(parsed?.x);
			const y = Number(parsed?.y);
			const z = Number(parsed?.z);
			if (Number.isFinite(x) && Number.isFinite(y)) appState.canvasOffset = { x, y };
			if (Number.isFinite(z) && z > 0)
				appState.canvasScale = Math.min(Math.max(z, MIN_ZOOM), MAX_ZOOM);
		} catch {
			/* parse / quota errors — keep defaults */
		}
	});

	$effect(() => {
		const payload = JSON.stringify({
			x: appState.canvasOffset?.x ?? 0,
			y: appState.canvasOffset?.y ?? 0,
			z: appState.canvasScale ?? 1
		});
		try {
			localStorage.setItem(PLOT_VIEWPORT_STORAGE_KEY, payload);
		} catch {
			/* quota / private-mode — ignore */
		}
	});

	let showNewPlotModal = $state(false);
	let canvasViewportEl = $state(null);
	let isPanning = $state(false);
	let panStartX = $state(0);
	let panStartY = $state(0);

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
			const factor = e.deltaY > 0 ? 0.9 : 1.1;
			const oldZoom = appState.canvasScale ?? 1;
			const newZoom = Math.min(Math.max(oldZoom * factor, MIN_ZOOM), MAX_ZOOM);
			// Keep the canvas point under the cursor fixed while zooming.
			const rect = canvasViewportEl?.getBoundingClientRect() ?? { left: 0, top: 0 };
			const relX = e.clientX - rect.left;
			const relY = e.clientY - rect.top;
			const offX = appState.canvasOffset?.x ?? 0;
			const offY = appState.canvasOffset?.y ?? 0;
			const canvasX = (relX - offX) / oldZoom;
			const canvasY = (relY - offY) / oldZoom;
			appState.canvasOffset = {
				x: relX - canvasX * newZoom,
				y: relY - canvasY * newZoom
			};
			appState.canvasScale = newZoom;
		} else {
			appState.canvasOffset = {
				x: (appState.canvasOffset?.x ?? 0) - e.deltaX,
				y: (appState.canvasOffset?.y ?? 0) - e.deltaY
			};
		}
	}

	let panMoved = false;

	function handleCanvasMouseDown(e) {
		if (e.button !== 0) return;
		// Only pan when the click lands on the canvas surface itself, not on a
		// plot, note, palette, or zoom-control button. Draggable.svelte's own
		// mousedown stops propagation before we see it, so any event that reaches
		// here started on the empty canvas.
		isPanning = true;
		panMoved = false;
		panStartX = e.clientX - (appState.canvasOffset?.x ?? 0);
		panStartY = e.clientY - (appState.canvasOffset?.y ?? 0);
	}

	function handleMouseMove(e) {
		if (!isPanning) return;
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

	function stopPan() {
		isPanning = false;
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
	onwheel={handleWheel}
	onmousedown={handleCanvasMouseDown}
	onmousemove={handleMouseMove}
	onmouseup={stopPan}
	onmouseleave={stopPan}
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
				<NoteCard {note} />
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
							<Plot theData={plot} which="plot" />
						</Draggable>
					{/if}
				{/each}
			{/if}
		</div>

		{#if core.plots.length === 0 && core.notes.length === 0}
			{#if core.data.length > 0}
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
			{:else}
				<AddDataPrompt />
			{/if}
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
		background-color: var(--surface-canvas, #f7f8fa);
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

		font-weight: bold;
		pointer-events: none;
	}

	.no-plot-prompt button,
	.no-plot-prompt p {
		pointer-events: auto;
	}

	.no-plot-prompt p {
		color: var(--color-lightness-75);
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
		border: 1px solid var(--color-lightness-85, #ddd);
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
		background: var(--color-lightness-95, #f2f2f2);
	}
	.zc-sep {
		width: 22px;
		height: 1px;
		background: var(--color-lightness-90, #e7e7e7);
		margin: 2px 0;
	}

	.viewport-btn {
		color: var(--color-lightness-45, #6b7280);
		transition:
			color 0.18s ease,
			transform 0.32s ease;
	}

	.viewport-btn:hover {
		color: var(--color-accent);
	}

	.viewport-btn:active {
		transform: scale(0.95);
	}
</style>
