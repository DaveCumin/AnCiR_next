<script>
	// @ts-nocheck
	import { onMount, tick } from 'svelte';
	import { appState, core, snapToGrid } from '$lib/core/core.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import { deselectAllPlots } from '$lib/core/Plot.svelte';
	import { removePlot, selectPlot } from '$lib/core/Plot.svelte';
	import SinglePlotAction from '../iconActions/SinglePlotAction.svelte';

	let plotElement;

	let {
		x = $bindable(100),
		y = $bindable(100),
		width = $bindable(200),
		height = $bindable(150),
		title = $bindable(''),
		id,
		selected = $bindable(false),
		canvasWidth = 50000,
		canvasHeight = 50000
	} = $props();

	const minWidth = 100;
	const minHeight = 100;

	// Plot movement and resize
	let moving = false;
	let resizing = false;
	let initialMouseX, initialMouseY, initialWidth, initialHeight;

	let dragStartX, dragStartY;
	let mouseStartX, mouseStartY;

	let isDragging = false;
	let hasMouseMoved = false;
	let dragThreshold = 5; // pixels before considering it a drag

	let dragStartPositions = {};

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
	}

	function onMouseDown(e, doMove = true) {
		if (e.target.closest('button.icon')) return;

		mouseStartX = e.clientX;
		mouseStartY = e.clientY;

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
	}

	function onTouchStart(e, doMove = true) {
		onPointerDown(e, doMove);
	}

	function anySelectedPlotEdge(xOffset, yOffset) {
		let result = false;

		core.plots.forEach((p) => {
			if (p.selected && (p.x + xOffset <= 0 || p.y + yOffset <= 0)) {
				result = true;
			}
		});

		return result;
	}

	function onPointerMove(e) {
		const pos = getPointerPosition(e);

		if (moving && !isDragging) {
			const deltaX = Math.abs(pos.x - mouseStartX);
			const deltaY = Math.abs(pos.y - mouseStartY);

			if (deltaX > dragThreshold || deltaY > dragThreshold) {
				isDragging = true;
				hasMouseMoved = true;
			}
		}

		if (moving && isDragging) {
			const deltaX = (pos.x - mouseStartX) / appState.canvasScale;
			const deltaY = (pos.y - mouseStartY) / appState.canvasScale;

			core.plots.forEach((p) => {
				if (p.selected || p.id == id) {
					if (anySelectedPlotEdge(e.movementX, e.movementY)) return;

					const start = dragStartPositions[p.id];

					const newX = snapToGrid(start.x + deltaX);
					const newY = snapToGrid(start.y + deltaY);

					p.x = Math.max(0, Math.min(newX, canvasWidth - width - 20));
					p.y = Math.max(0, Math.min(newY, canvasHeight - height - 50));
				}
			});
		} else if (resizing) {
			let deltaX = (pos.x - initialMouseX) / appState.canvasScale;
			let deltaY = (pos.y - initialMouseY) / appState.canvasScale;

			const maxWidth = canvasWidth - x - 20;
			const maxHeight = canvasHeight - y - 50;

			width = snapToGrid(Math.max(minWidth, Math.min(initialWidth + deltaX, maxWidth)));
			height = snapToGrid(Math.max(minHeight, Math.min(initialHeight + deltaY, maxHeight)));
		}

		// Auto-scroll functionality
		if (resizing || moving) {
			const rightLim =
				window.innerWidth -
				(appState.showControlPanel ? appState.widthControlPanel / appState.canvasScale : 0);

			const currentTop = document.getElementsByClassName('canvas')[0].scrollTop;
			const currentLeft = document.getElementsByClassName('canvas')[0].scrollLeft;

			if (pos.x > rightLim) {
				document.getElementsByClassName('canvas')[0].scrollTo({
					top: currentTop,
					left: currentLeft + appState.gridSize,
					behavior: 'smooth'
				});
			}

			if (pos.y > window.innerHeight) {
				document.getElementsByClassName('canvas')[0].scrollTo({
					top: currentTop + appState.gridSize,
					left: currentLeft,
					behavior: 'smooth'
				});
			}
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

	function openPlotDetails(e) {
		e.stopPropagation();
		// open dropdown
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
		height: {snapToGrid(height + 50)}px;"
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
		<p
			contenteditable="false"
			ondblclick={(e) => {
				e.target.setAttribute('contenteditable', 'true');
				e.target.focus();
				console.log(e.target);
			}}
			onfocusout={(e) => e.target.setAttribute('contenteditable', 'false')}
			bind:innerHTML={title}
			style="cursor: default;"
		></p>

		<button class="icon" onclick={() => removePlot(id)}>
			<!-- <Icon name="menu-horizontal-dots" width={20} height={20} className="menu-icon" /> -->
			<Icon name="close" width={16} height={16} className="icon close" />
		</button>
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

	/* Make resize handle more touch-friendly */
	@media (pointer: coarse) {
		.resize-handle {
			width: 24px;
			height: 24px;
		}
	}
</style>
