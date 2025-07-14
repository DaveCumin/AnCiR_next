<!-- TODO: select plot to bring up control panel / switch to -->

<script>
	// @ts-nocheck
	import { appState } from '$lib/core/core.svelte';

	import ControlDisplay from './views/ControlDisplay.svelte';

	let container;
	let width = 360; // initial width
	const minWidth = 300;

	export let resizeSide = 'left';
	let resizing = false;

	function onMouseMove(e) {
		if (!resizing) return;

		const rect = container.getBoundingClientRect();
		let newWidth;

		if (resizeSide === 'right') {
			newWidth = e.clientX - rect.left;
		} else {
			newWidth = rect.right - e.clientX;
		}

		width = Math.max(minWidth, newWidth);

		// TODO: fix plot limitation when resize

		// appState.positionControlPanel = window.innerWidth - width;
		// console.log(appState.positionControlPanel);
	}

	function stopResize() {
		resizing = false;
		document.body.style.userSelect = '';
		window.removeEventListener('mousemove', onMouseMove);
		window.removeEventListener('mouseup', stopResize);
	}

	function startResize(e) {
		resizing = true;
		document.body.style.userSelect = 'none';
		window.addEventListener('mousemove', onMouseMove);
		window.addEventListener('mouseup', stopResize);
	}
</script>

<div bind:this={container} class="view-container {resizeSide}" style="width: {width}px;">
	<ControlDisplay />
	<div class="resizer" onmousedown={startResize}></div>
</div>

<style>
	.view-container {
		overflow-y: auto;
		overflow-x: hidden;
		overflow-wrap: anywhere;
		height: 100%;
		min-width: 300px;
		max-width: 444px;
		display: flex;
		flex-direction: column;
		justify-content: start;
		align-items: start;

		position: fixed;
		top: 0;
		/* right: 56px; */
		right: 0;

		border-left: 1px solid #d9d9d9;
		background: #ffffff;
		box-sizing: border-box;

		z-index: 999;
	}

	.view-container::-webkit-scrollbar {
		display: none;
	}

	.resizer {
		width: 6px;
		cursor: col-resize;
		height: 100%;
		position: absolute;
		top: 0;
		right: 0;
		z-index: 1;
		background-color: transparent;
	}

	.view-container.right .resizer {
		right: 0;
	}

	.view-container.left .resizer {
		left: 0;
	}
</style>
