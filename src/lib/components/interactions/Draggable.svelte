<script>
    // @ts-nocheck
	let width = 200; // starting width if parent reference unspecified
	const minWidth = 100;
	let resizing = false;

	function handleMouseMove(event) {
		if (resizing) {
			const newWidth = event.clientX - box.getBoundingClientRect().left;
			width = Math.max(newWidth, minWidth);
		}
	}

	function handleMouseUp() {
		resizing = false;
		window.removeEventListener('mousemove', handleMouseMove);
		window.removeEventListener('mouseup', handleMouseUp);
	}

	function startResize() {
		resizing = true;
		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseup', handleMouseUp);
	}

	let box;
</script>

<div bind:this={box} class="resizable" style="width: {width}px;">
	<p class="content" title="This is some long text that might be truncated.">
		This is some long text that might be truncated.
	</p>
	<div class="resizer" on:mousedown={startResize}></div>
</div>

<style>
	.resizable {
		position: relative;
		display: flex;
		align-items: center;
		border: 1px solid #ccc;
		padding: 0.5rem;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		user-select: none;
		background: #f9f9f9;
	}

	.content {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex-grow: 1;
	}

	.resizer {
		width: 6px;
		cursor: ew-resize;
		height: 100%;
		position: absolute;
		right: 0;
		top: 0;
		background-color: transparent;
	}
</style>
