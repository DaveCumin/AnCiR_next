<script>
	// @ts-nocheck
	import { onMount, tick } from 'svelte';
	import { appState, core, snapToGrid } from '$lib/core/core.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import { deselectAllPlots } from '$lib/core/Plot.svelte';
	import { removePlots, selectPlot } from '$lib/core/Plot.svelte';
	import SinglePlotAction from '../iconActions/SinglePlotAction.svelte';
	import { getCanvasWidthPx } from '$lib/components/views/PlotDisplay.svelte';
	import Editable from '../inputs/Editable.svelte';
	import { startEdgePan, noteEdgePanMouse, stopEdgePan } from '$lib/core/edgePan.svelte.js';
	let plotElement;

	let {
		x = $bindable(100),
		y = $bindable(100),
		width = $bindable(200),
		height = $bindable(150),
		title = $bindable(''),
		id,
		selected = $bindable(false),
		viewportEl = null
	} = $props();

	const nodeNote = $derived(core.nodeNotes?.[`plot_${id}`] ?? '');
	const hasNodeNote = $derived(nodeNote.trim().length > 0);

	const minWidth = 100;
	const minHeight = 100;

	// Plot movement and resize
	let moving = false;
	let resizing = false;
	let initialMouseX, initialMouseY, initialWidth, initialHeight;

	let dragStartX, dragStartY;
	let mouseStartX, mouseStartY;
	// Cursor canvas-coords captured at mousedown. Used as the reference point so
	// drag math stays correct when edge-pan moves the canvas during the drag.
	let mouseStartCanvasX = 0;
	let mouseStartCanvasY = 0;

	let isDragging = false;
	let hasMouseMoved = false;
	let dragThreshold = 5; // pixels before considering it a drag

	function clientToCanvas(clientX, clientY) {
		const rect = viewportEl?.getBoundingClientRect() ?? { left: 0, top: 0 };
		const z = appState.canvasScale ?? 1;
		const offX = appState.canvasOffset?.x ?? 0;
		const offY = appState.canvasOffset?.y ?? 0;
		return {
			x: (clientX - rect.left - offX) / z,
			y: (clientY - rect.top - offY) / z
		};
	}

	function applyEdgePan(dx, dy) {
		appState.canvasOffset = {
			x: (appState.canvasOffset?.x ?? 0) + dx,
			y: (appState.canvasOffset?.y ?? 0) + dy
		};
	}

	let dragStartPositions = {};
	let fullscreen = $state(false);
	let smallvalues = $state();

	// Touch-specific variables
	let touchStartTime = 0;
	let lastTouchTime = 0;
	let touchCount = 0;
	let isTouch = false;

	function getPointerPosition(e) {
		if (e.touches && e.touches.length > 0) {
			return { x: e.touches[0].clientX, y: e.touches[0].clientY };
		}
		return { x: e.clientX, y: e.clientY };
	}

	function onPointerDown(e, doMove = true) {
		// Prevent default touch behaviors
		if (e.type.startsWith('touch')) {
			e.preventDefault();
			isTouch = true;

			// Handle double tap for touch
			const currentTime = Date.now();
			if (currentTime - lastTouchTime < 300) {
				touchCount++;
			} else {
				touchCount = 1;
			}
			lastTouchTime = currentTime;
			touchStartTime = currentTime;

			// Double tap detection
			if (touchCount === 2) {
				handleDblClick(e);
				return;
			}
		} else {
			isTouch = false;
		}

		if (e.target.closest('button.icon')) return;

		const pos = getPointerPosition(e);
		mouseStartX = pos.x;
		mouseStartY = pos.y;
		const startCanvas = clientToCanvas(pos.x, pos.y);
		mouseStartCanvasX = startCanvas.x;
		mouseStartCanvasY = startCanvas.y;

		dragStartPositions = {};
		hasMouseMoved = false;

		// For touch, we don't have Alt key, so use different selection logic
		if (isTouch) {
			// Simple touch selection - just select this plot
			if (!selected) {
				core.plots.forEach((p) => {
					if (p.id !== id) {
						p.selected = false;
					}
				});
				selected = true;
			}
		} else {
			// Original mouse logic
			if (e.altKey) {
				selected = !selected;
				return;
			}
			if (!selected) {
				core.plots.forEach((p) => {
					if (p.id !== id) {
						p.selected = false;
					}
				});
				selected = true;
			}
		}

		// Prepare for potential drag operation
		dragStartPositions = {};
		core.plots.forEach((p) => {
			if (p.selected) {
				dragStartPositions[p.id] = { x: p.x, y: p.y };
			}
		});
		moving = true && doMove;
		if (moving && viewportEl) {
			startEdgePan({
				getViewportRect: () => viewportEl.getBoundingClientRect(),
				applyPan: applyEdgePan
			});
			noteEdgePanMouse(pos.x, pos.y);
		}
	}

	function onMouseDown(e, doMove = true) {
		if (e.target.closest('button.icon')) return;

		mouseStartX = e.clientX;
		mouseStartY = e.clientY;
		const startCanvas = clientToCanvas(e.clientX, e.clientY);
		mouseStartCanvasX = startCanvas.x;
		mouseStartCanvasY = startCanvas.y;

		dragStartPositions = {};

		hasMouseMoved = false;

		// If Alt key is pressed, toggle selection of this plot
		if (e.altKey) {
			selected = !selected;
			return;
		}
		// If this plot is not selected, we need to handle selection logic
		if (!selected) {
			// Clear other selections unless Alt is held
			core.plots.forEach((p) => {
				if (p.id !== id) {
					p.selected = false;
				}
			});
			selected = true;
		}

		// Prepare for potential drag operation
		dragStartPositions = {};
		core.plots.forEach((p) => {
			if (p.selected) {
				dragStartPositions[p.id] = { x: p.x, y: p.y };
			}
		});
		moving = true && doMove;
		if (moving && viewportEl) {
			startEdgePan({
				getViewportRect: () => viewportEl.getBoundingClientRect(),
				applyPan: applyEdgePan
			});
			noteEdgePanMouse(e.clientX, e.clientY);
		}
	}

	function onTouchStart(e, doMove = true) {
		onPointerDown(e, doMove);
	}

	function onPointerMove(e) {
		const pos = getPointerPosition(e);

		// Keep edge-pan engine fed with the latest cursor position while a drag
		// or resize is in progress so it can nudge the canvas toward the cursor.
		if (moving || resizing) noteEdgePanMouse(pos.x, pos.y);

		if (moving && !isDragging) {
			const deltaX = Math.abs(pos.x - mouseStartX);
			const deltaY = Math.abs(pos.y - mouseStartY);

			if (deltaX > dragThreshold || deltaY > dragThreshold) {
				isDragging = true;
				hasMouseMoved = true;
			}
		}

		if (moving && isDragging) {
			// Drag math runs in canvas coords so edge-pan moving the canvas mid-drag
			// still leaves the plot under the cursor.
			const cur = clientToCanvas(pos.x, pos.y);
			const deltaX = cur.x - mouseStartCanvasX;
			const deltaY = cur.y - mouseStartCanvasY;

			core.plots.forEach((p) => {
				if (p.selected || p.id == id) {
					const start = dragStartPositions[p.id];
					if (!start) return;

					p.x = snapToGrid(start.x + deltaX);
					p.y = snapToGrid(start.y + deltaY);
				}
			});
		} else if (resizing) {
			// Resize uses absolute screen-delta / zoom — independent of pan because
			// the corner being dragged stays under the cursor without further math.
			let deltaX = (pos.x - initialMouseX) / appState.canvasScale;
			let deltaY = (pos.y - initialMouseY) / appState.canvasScale;

			width = snapToGrid(Math.max(minWidth, initialWidth + deltaX));
			height = snapToGrid(Math.max(minHeight, initialHeight + deltaY));
		}
	}

	function onMouseMove(e) {
		onPointerMove(e);
	}

	function onTouchMove(e) {
		// Prevent scrolling while dragging/resizing
		if (moving || resizing) {
			e.preventDefault();
		}
		onPointerMove(e);
	}

	function onPointerUp() {
		moving = false;
		resizing = false;
		isDragging = false;
		hasMouseMoved = false;
		isTouch = false;
		stopEdgePan();
	}

	function onMouseUp() {
		onPointerUp();
	}

	function onTouchEnd(e) {
		// For very short touches without movement, treat as a tap
		const currentTime = Date.now();
		const touchDuration = currentTime - touchStartTime;

		if (touchDuration < 200 && !hasMouseMoved) {
			// This was a quick tap, handle selection
			if (!selected) {
				core.plots.forEach((p) => {
					if (p.id !== id) {
						p.selected = false;
					}
				});
				selected = true;
			}
		}

		onPointerUp();
	}

	function startResize(e) {
		e.stopPropagation();

		const pos = getPointerPosition(e);
		resizing = true;
		initialMouseX = pos.x;
		initialMouseY = pos.y;
		initialWidth = width;
		initialHeight = height;

		if (e.type.startsWith('touch')) {
			isTouch = true;
		}
	}

	function bringToFront(id) {
		if (id >= 0) {
			//handle colour-picker
			const index = core.plots.findIndex((p) => p.id === id);
			if (index !== -1) {
				const [plot] = core.plots.splice(index, 1);
				core.plots.push(plot);
			}
		}
	}

	async function handleDblClick(e) {
		e.stopPropagation();
		// Double click
		appState.showControlPanel = true;
		await tick();

		RePosition();
	}

	function RePosition() {
		if (selected) {
			if (plotElement) {
				plotElement.scrollIntoView({
					behavior: 'smooth',
					block: 'nearest',
					inline: 'nearest'
				});
			}
		}
	}

	function toggleFullscreen() {
		fullscreen = !fullscreen;
		if (fullscreen) {
			smallvalues = { x, y, width, height };
			x = 0;
			y = 0;
			width = getCanvasWidthPx() / appState.canvasScale - 20;
			height = window.innerHeight / appState.canvasScale - 50;
		} else {
			x = smallvalues.x;
			y = smallvalues.y;
			width = smallvalues.width;
			height = smallvalues.height;
		}
		const updated = [...core.plots];
		const pos = core.plots.findIndex((p) => p.id === id);
		const [movedItem] = updated.splice(pos, 1);
		updated.splice(core.plots.length, 0, movedItem);

		core.plots = updated;
	}

	let addBtnRef;
	let showDropdown = $state(false);
	let dropdownTop = $state(0);
	let dropdownLeft = $state(0);

	function recalculateDropdownPosition() {
		if (!addBtnRef) return;
		const rect = addBtnRef.getBoundingClientRect();

		dropdownTop = rect.top + window.scrollY;
		dropdownLeft = rect.right + window.scrollX + 12;
	}

	function openDropdown() {
		recalculateDropdownPosition();
		showDropdown = true;

		window.addEventListener('resize', recalculateDropdownPosition);
	}
</script>

<svelte:window
	onmousemove={onMouseMove}
	onmouseup={onMouseUp}
	ontouchmove={onTouchMove}
	ontouchend={onTouchEnd}
/>
<!-- added header therefore TODO: other way than hardcode -->

<!-- the click does nothing becasue it's all handled in the mousedown/up for drag/resize etc. -->
<section
	bind:this={plotElement}
	ondblclick={(e) => handleDblClick(e)}
	onmousedown={(e) => onMouseDown(e, false)}
	ontouchstart={(e) => onTouchStart(e, false)}
	onclick={(e) => e.stopPropagation()}
	class:selected
	class="draggable"
	style="left: {x}px;
		top: {y}px;
		width: {snapToGrid(width + 20)}px;
		height: {snapToGrid(height + 50)}px;
		z-index: {fullscreen ? 9999 : ''};"
>
	<div
		class="plot-header"
		onmousedown={(e) => {
			e.stopPropagation();
			onMouseDown(e);
		}}
		ontouchstart={(e) => {
			e.stopPropagation();
			onTouchStart(e);
		}}
	>
		<p><Editable bind:value={title} /></p>

		{#if hasNodeNote}
			<p class="node-note" title={nodeNote}>{nodeNote}</p>
		{/if}

		<div class="clps-title-button">
			<button
				class="icon"
				onclick={(e) => {
					e.stopPropagation();
					toggleFullscreen();
				}}
			>
				{#if fullscreen}
					<Icon name="minimise" width={20} height={20} className="menu-icon plot-options-button" />
				{:else}
					<Icon name="maximise" width={20} height={20} className="menu-icon plot-options-button" />
				{/if}
			</button>
			<button class="icon" onclick={() => removePlots(id)}>
				<!-- <Icon name="menu-horizontal-dots" width={20} height={20} className="menu-icon" /> -->
				<Icon name="close" width={16} height={16} className="icon close" />
			</button>
		</div>
	</div>
	<div class="plot-content">
		<slot></slot>
	</div>
	<div class="resize-handle" onmousedown={(e) => startResize(e)}></div>
</section>

{#if showDropdown}
	<SinglePlotAction bind:showDropdown {dropdownTop} {dropdownLeft} />
{/if}

<style>
	.draggable {
		user-select: none;
		position: absolute;
		border: solid 1px var(--color-lightness-85);
		background-color: white;
		box-sizing: border-box;
		box-shadow: 0 2px 5px rgba(0, 0, 0, 0.15);
		border-radius: 4px;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		min-width: 200px;
		z-index: 1;
	}

	.selected {
		border: 1px solid #0275ff;
		box-shadow: 0 2px 5px rgba(2, 117, 255, 0.5);
	}

	.plot-header {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;

		flex-shrink: 0;
		cursor: move;

		padding: 0.5rem;
		padding-left: 1rem;
		padding-right: 0.4rem;
		background-color: var(--color-lightness-98);
		border-bottom: 1px solid var(--color-lightness-85);

		font-weight: bold;
	}

	.plot-header p {
		margin: 0;
	}

	.plot-header p.node-note {
		flex: 1 1 auto;
		min-width: 0;
		margin: 0 0.6rem;
		font-weight: normal;
		font-style: italic;
		font-size: 0.8rem;
		color: var(--color-lightness-45, #6b6b6b);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.plot-header button {
		padding-right: 0;
	}

	.plot-content {
		flex: 1;
		padding: 0.5rem;
		overflow: hidden;
	}

	.resize-handle {
		position: absolute;
		width: 16px;
		height: 16px;
		right: 0;
		bottom: 0;
		cursor: nwse-resize;
		border-radius: 2px;
	}

	.plot-options-button {
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.2s ease;
	}

	.plot-options-button:hover {
		opacity: 1;
		pointer-events: auto;
	}

	/* Make resize handle more touch-friendly */
	@media (pointer: coarse) {
		.resize-handle {
			width: 24px;
			height: 24px;
		}
	}
</style>
