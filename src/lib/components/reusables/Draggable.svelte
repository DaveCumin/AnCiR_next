<script>
	// @ts-nocheck
	import { onMount, tick } from 'svelte';
	import { appState, core, snapToGrid } from '$lib/core/core.svelte';
	import { mutationService } from '$lib/core/mutationService.js';
	import Icon from '$lib/icons/Icon.svelte';
	import { deselectAllPlots } from '$lib/core/Plot.svelte';
	import { removePlots, selectPlot } from '$lib/core/Plot.svelte';
	import SinglePlotAction from '../iconActions/SinglePlotAction.svelte';
	import { getCanvasWidthPx } from '$lib/components/views/PlotDisplay.svelte';
	import Editable from '../inputs/Editable.svelte';
	import NodeActions from '$lib/components/workflow/NodeActions.svelte';
	import NodeNoteButton from '$lib/components/workflow/NodeNoteButton.svelte';
	import { tooltip } from '$lib/utils/tooltip.js';
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
	// Hover state drives the action cluster's reveal (matches the workflow nodes).
	let hovered = $state(false);
	let plotHasNote = $derived(!!core.nodeNotes[`plot_${id}`]?.trim());
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
		// Record plot geometry changes on the history stack — one undoable step per
		// gesture. The live drag/resize already mutated the plot model directly; we
		// capture the end value, revert to the pre-gesture value, then replay through
		// the op so the reverse (before) is captured correctly.
		if (isDragging) {
			const ops = [];
			for (const pid of Object.keys(dragStartPositions)) {
				const p = core.plots.find((pp) => String(pp.id) === pid);
				if (!p) continue;
				const start = dragStartPositions[pid];
				if (p.x !== start.x || p.y !== start.y) {
					ops.push({ kind: 'setPlotPosition', id: p.id, x: p.x, y: p.y });
					p.x = start.x;
					p.y = start.y;
				}
			}
			if (ops.length) mutationService.atomicBatch(ops); // group move → one undo
		} else if (resizing) {
			const p = core.plots.find((pp) => pp.id === id);
			if (p && (p.width !== initialWidth || p.height !== initialHeight)) {
				const endW = p.width;
				const endH = p.height;
				p.width = initialWidth;
				p.height = initialHeight;
				mutationService.setPlotPosition(id, { width: endW, height: endH });
			}
		}

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
	onmouseenter={() => (hovered = true)}
	onmouseleave={() => (hovered = false)}
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
		<!-- Note button on the LEFT (status side), so it doesn't shift when the
		     maximise/delete buttons reveal on the right. Shown when a note exists,
		     or on hover/selection. -->
		<div
			class="note-slot"
			class:has-note={plotHasNote}
			class:sel={hovered || selected}
			onmousedown={(e) => e.stopPropagation()}
			role="presentation"
		>
			<NodeNoteButton nodeId={`plot_${id}`} />
		</div>
		<p class="plot-title"><Editable bind:value={title} /></p>

		<!-- Shared action cluster (maximise · delete), revealed on hover/selection. -->
		<div class="plot-actions-host" onmousedown={(e) => e.stopPropagation()} role="presentation">
			<NodeActions
				revealed={hovered || selected}
				showMaximise={true}
				maximised={fullscreen}
				onToggleMaximise={() => toggleFullscreen()}
				onDelete={() => removePlots(id)}
				deleteTooltip="Delete plot"
			/>
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
		background-color: var(--surface-card);
		box-sizing: border-box;
		box-shadow: var(--shadow-1);
		border-radius: var(--radius-sm);
		overflow: hidden;
		display: flex;
		flex-direction: column;
		min-width: 200px;
		z-index: 1;
		/* The canvas behind shows a grab cursor; a plot is a fixed object, not the
		   panning surface, so reset it. The header opts back into `move`. */
		cursor: default;
	}

	.selected {
		border: 1px solid #0275ff;
		box-shadow: 0 2px 5px rgba(2, 117, 255, 0.5);
	}

	/* Matches the workflow node header (WorkflowNode .node-header) so a plot looks
	   the same in both views: compact bar, light surface, subtle divider. */
	.plot-header {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
		gap: 4px;

		flex-shrink: 0;
		cursor: move;

		padding: 0 0.4rem 0 0.6rem;
		min-height: 28px;
		background-color: var(--color-lightness-97, #f4f4f4);
		border-bottom: 1px solid var(--color-lightness-90, #e7e7e7);

		font-weight: 600;
		color: var(--color-lightness-25, #333);
	}

	.plot-header p {
		margin: 0;
	}

	.plot-header p.plot-title {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.clps-title-button {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 2px;
		flex-shrink: 0;
	}

	/* Container for the shared action cluster (maximise/delete). NodeActions
	   handles its own reveal via the `revealed` prop. */
	.plot-actions-host {
		display: flex;
		align-items: center;
	}

	/* Left-side note button, always visible so the title never shifts. It reads as
	   a faint "N" until a note exists (then NodeNoteButton turns it green). */
	.note-slot {
		flex-shrink: 0;
		display: flex;
	}

	.plot-header button {
		padding-right: 0;
	}

	.plot-content {
		flex: 1;
		padding: var(--space-4);
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
