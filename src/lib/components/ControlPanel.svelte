<!-- TODO: select plot to bring up control panel / switch to -->

<script>
	// @ts-nocheck
	import { appState } from '$lib/core/core.svelte';

	import ControlDisplay from './views/ControlDisplay.svelte';

	import { fly } from 'svelte/transition';

	let container;
	let width = window.innerWidth - appState.positionControlPanel; // initial width
	const minWidth = 300;
	const maxWidth = 500;

	let resizeSide = 'left';
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
		if (newWidth >= maxWidth || newWidth <= minWidth) {
			stopResize();
			return;
		}

		width = Math.max(minWidth, newWidth);

		appState.positionControlPanel = window.innerWidth - width;
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

{#if appState.showControlPanel}
	<div
		bind:this={container}
		class="view-container {resizeSide}"
		style="width: {width}px; min-width: {minWidth}px;	max-width: {maxWidth}px;"
		in:fly={{ x: width, duration: 600 }}
		out:fly={{ x: width, duration: 600 }}
	>
		<ControlDisplay />
		<div class="resizer" onmousedown={startResize}></div>
	</div>
{:else}
	<button class="openControlPanel" onclick={() => (appState.showControlPanel = true)}>open</button>
{/if}

<style>
	.openControlPanel {
		position: fixed;
		top: 0;
		right: 0;
		z-index: 999;
	}
	.view-container {
		overflow-y: auto;
		overflow-x: hidden;
		overflow-wrap: anywhere;
		height: 100%;
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
