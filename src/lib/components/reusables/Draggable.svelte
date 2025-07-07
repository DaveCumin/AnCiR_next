<script>
	// TODO: invisible, only drag on top, change layers
	// TODO: control panel
	// TODO: change color, palette on top
	// @ts-nocheck
	export let x = 100;
	export let y = 100;
	export let width = 200;
	export let height = 150;
	export let title = '';

	const minWidth = 100;
	const minHeight = 100;

	let moving = false;
	let resizing = false;
	let initialMouseX, initialMouseY, initialWidth, initialHeight;

	function onMouseDown() {
		moving = true;
	}

	function onMouseMove(e) {
		if (moving) {
			x += e.movementX;
			y += e.movementY;
		} else if (resizing) {
			const deltaX = e.clientX - initialMouseX;
			const deltaY = e.clientY - initialMouseY;
			width = Math.max(minWidth, initialWidth + deltaX);
			height = Math.max(minHeight, initialHeight + deltaY);
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
</script>

<svelte:window on:mousemove={onMouseMove} on:mouseup={onMouseUp} />

<!-- added header therefore TODO: other way than hardcode -->
<section
	class="draggable"
	style="left: {x}px; top: {y}px; width: {width + 20}px; height: {height + 50}px;">
	
	<div class="plot-header" on:mousedown={onMouseDown}>
		{title}
	</div>
	<div class="plot-content">
		<slot></slot>
	</div>
	<div class="resize-handle" on:mousedown={startResize}></div>
</section>

<style>
	.draggable {
		user-select: none;
		position: absolute;
		border: solid 1px #ccc;
		background-color: white;
		box-sizing: border-box;
		box-shadow: 0 2px 5px rgba(0,0,0,0.15);
		border-radius: 8px;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	.plot-header {
		cursor: move;
		background-color: #f8f8f8;
		padding: 0.5rem 1rem;
		font-weight: bold;
		border-bottom: 1px solid #ddd;
		flex-shrink: 0;
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
