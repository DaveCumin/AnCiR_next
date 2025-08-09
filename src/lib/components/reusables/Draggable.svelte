<script>
	// @ts-nocheck
	import { onMount, tick } from 'svelte';
	import { appState, core, snapToGrid } from '$lib/core/core.svelte';
	import Icon from '$lib/icons/Icon.svelte';

	import { removePlot, selectPlot } from '$lib/core/Plot.svelte';
	import SinglePlotAction from '../iconActions/SinglePlotAction.svelte';

	let plotElement;

	let {
		x = $bindable(100),
		y = $bindable(100),
		width = $bindable(200),
		height = $bindable(150),
		title = '',
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

	let dragStartPositions = {};

	function onMouseDown(e) {
		if (e.target.closest('button.icon')) return;
		mouseStartX = e.clientX;
		mouseStartY = e.clientY;

		dragStartPositions = {};
		// find all selected plots
		core.plots.forEach((p) => {
			if (p.selected) {
				dragStartPositions[p.id] = { x: p.x, y: p.y };
			}
		});
		moving = true;
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

	function onMouseMove(e) {
		if (moving) {
			const deltaX = (e.clientX - mouseStartX) / appState.canvasScale;
			const deltaY = (e.clientY - mouseStartY) / appState.canvasScale;

			core.plots.forEach((p) => {
				if (p.selected) {
					if (anySelectedPlotEdge(e.movementX, e.movementY)) return; //do nothing

					const start = dragStartPositions[p.id];

					const newX = snapToGrid(start.x + deltaX);
					const newY = snapToGrid(start.y + deltaY);

					p.x = Math.max(0, Math.min(newX, canvasWidth - width - 20));
					p.y = Math.max(0, Math.min(newY, canvasHeight - height - 50));
				}
			});
		} else if (resizing) {
			let deltaX = (e.clientX - initialMouseX) / appState.canvasScale;
			let deltaY = (e.clientY - initialMouseY) / appState.canvasScale;

			const maxWidth = canvasWidth - x - 20;
			const maxHeight = canvasHeight - y - 50;

			//do the resize
			width = snapToGrid(Math.max(minWidth, Math.min(initialWidth + deltaX, maxWidth)));
			height = snapToGrid(Math.max(minHeight, Math.min(initialHeight + deltaY, maxHeight)));
		}

		// scroll with the move/resive
		if (resizing || moving) {
			let deltaX = (e.clientX - initialMouseX) / appState.canvasScale;
			let deltaY = (e.clientY - initialMouseY) / appState.canvasScale;

			//Do over the left
			const rightLim =
				window.innerWidth -
				(appState.showControlPanel ? appState.widthControlPanel / appState.canvasScale : 0);

			const currentTop = document.getElementsByClassName('canvas')[0].scrollTop;
			const currentLeft = document.getElementsByClassName('canvas')[0].scrollLeft;

			if (e.pageX > rightLim) {
				document.getElementsByClassName('canvas')[0].scrollTo({
					top: currentTop,
					left: currentLeft + appState.gridSize,
					behavior: 'smooth'
				});
				deltaX += appState.gridSize;
			}
			//do  down
			if (e.pageY > window.innerHeight) {
				document.getElementsByClassName('canvas')[0].scrollTo({
					top: currentTop + appState.gridSize,
					left: currentLeft,
					behavior: 'smooth'
				});
				deltaY += appState.gridSize;
			}
		}
	}

	function onMouseUp() {
		moving = false;
		resizing = false;
	}

	function startResize(e) {
		e.stopPropagation();
		resizing = true;
		initialMouseX = e.clientX;
		initialMouseY = e.clientY;
		initialWidth = width;
		initialHeight = height;
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
		appState.showControlPanel = true;
		await tick();
		RePosition();
	}

	function handleClick(e) {
		e.stopPropagation();
		n += 1;
		clearTimeout(timeout);
		timeout = setTimeout(() => {
			selectPlot(e, id);

			if (n > 1) {
				handleDblClick(e);
			} else {
				RePosition();
			}
			n = 0;
		}, delay);
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
	let timeout,
		n = 0,
		delay = 180;
</script>

<svelte:window onmousemove={onMouseMove} onmouseup={onMouseUp} />

<!-- added header therefore TODO: other way than hardcode -->
<section
	bind:this={plotElement}
	onclick={(e) => handleClick(e)}
	class:selected
	class="draggable"
	style="left: {x}px;
		top: {y}px;
		width: {snapToGrid(width + 20)}px;
		height: {snapToGrid(height + 50)}px;"
>
	<div class="plot-header" onmousedown={(e) => onMouseDown(e)}>
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
			<Icon name="close" width={16} height={16} className="icon" />
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
		overflow: auto;
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
</style>
