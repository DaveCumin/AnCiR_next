<script>
	// not a draggable reusable, change to plot component some time
	// TODO: lock to grid
	// @ts-nocheck
	import { appState, core } from '$lib/core/core.svelte';

	let {
		x = $bindable(100),
		y = $bindable(100),
		width = $bindable(200),
		height = $bindable(150),
		title = '',
		id,
		canvasWidth = 50000,
		canvasHeight = 50000
	} = $props();

	const minWidth = 100;
	const minHeight = 100;

	let moving = false;
	let resizing = false;
	let initialMouseX, initialMouseY, initialWidth, initialHeight;
	let newX, newY;

	function onMouseDown(e) {
		if (appState.selectedPlotIds.includes(id)) {
			moving = true;
		} else if (!e.altKey) {
			appState.selectedPlotIds = [id];
			moving = true;
		}
	}

	function onMouseMove(e) {
		if (moving) {
			appState.selectedPlotIds.forEach((id) => {
				const plot = core.plots.find((p) => p.id === id);
				plot.x += e.movementX;
				plot.y += e.movementY;

				plot.x = Math.max(0, Math.min(plot.x, canvasWidth - width - 20));
				plot.y = Math.max(0, Math.min(plot.y, canvasHeight - height - 50));
			});
		} else if (resizing) {
			const deltaX = e.clientX - initialMouseX;
			const deltaY = e.clientY - initialMouseY;

			const maxWidth = canvasWidth - x - 20;
			const maxHeight = canvasHeight - y - 50;

			width = Math.max(minWidth, Math.min(initialWidth + deltaX, maxWidth));
			height = Math.max(minHeight, Math.min(initialHeight + deltaY, maxHeight));
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

	function handleDblClick(e) {
		e.stopPropagation();
		if (id >= 0) {
			//handle colour-picker
			appState.selectedPlotIds = [id];
			appState.showControlPanel = true;
		}
	}
	function handleClick(e) {
		e.stopPropagation();
		if (id >= 0) {
			//handle colour-picker
			//look for alt held at the same time
			if (e.altKey) {
				//Add if it's not already there
				if (!appState.selectedPlotIds.includes(id)) {
					appState.selectedPlotIds.push(id);
				} else {
					//or remove it
					appState.selectedPlotIds = appState.selectedPlotIds.filter((id) => id !== tempId);
				}
			} else if (!appState.selectedPlotIds.includes(id)) {
				appState.selectedPlotIds = [id];
			}
		}
	}
</script>

<svelte:window onmousemove={onMouseMove} onmouseup={onMouseUp} />

<!-- added header therefore TODO: other way than hardcode -->
<section
	ondblclick={handleDblClick}
	onclick={handleClick}
	class:selected={appState.selectedPlotIds?.includes(id)}
	class="draggable"
	style="left: {x}px;
		top: {y}px;
		width: {width + 20}px;
		height: {height + 50}px;"
>
	<div class="plot-header" onmousedown={(e) => onMouseDown(e)}>
		{title}
	</div>
	<div class="plot-content">
		<slot></slot>
	</div>
	<div class="resize-handle" onmousedown={startResize}></div>
</section>

<style>
	.draggable {
		user-select: none;
		position: absolute;
		border: solid 1px var(--color-lightness-85);
		background-color: white;
		box-sizing: border-box;
		/* box-shadow: 0 2px 5px rgba(0,0,0,0.15); */
		border-radius: 4px;
		overflow: hidden;
		display: flex;
		flex-direction: column;

		z-index: 1;
	}

	.selected {
		border: 1px solid #007bff;
		box-shadow: 0 2px 5px rgba(0, 123, 255, 0.5);
	}

	.plot-header {
		background-color: #f8f8f8;
		padding: 0.5rem 1rem;
		font-weight: bold;
		border-bottom: 1px solid var(--color-lightness-85);
		flex-shrink: 0;
	}

	.selected .plot-header {
		cursor: move;
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
		/* background-color: #888; */
		border-radius: 2px;
	}
</style>
