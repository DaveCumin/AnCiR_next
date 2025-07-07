<script>
	// @ts-nocheck

	import { appState } from '$lib/core/core.svelte.js';
	import DataDisplay from '$lib/components/views/DataDisplay.svelte';
	import WorksheetDisplay from '$lib/components/views/WorksheetDisplay.svelte';

	let container;
	let width = 360; // initial width
	const minWidth = 300;

	export let resizeSide = 'right';
	let resizing = false;

	function onMouseMove(e) {
		if (!resizing) return;

        const rect = container.getBoundingClientRect();
        let newWidth;

        if (resizeSide === 'right') {
            newWidth = e.clientX - rect.left;
        } else {
            const delta = rect.right - e.clientX;
            newWidth = delta;
        }

        width = Math.max(minWidth, newWidth);
		
		// TODO: fix plot limitation when resize
		// appState.positionDisplayPanel = width;
	}

	function stopResize() {
		resizing = false;
		document.body.style.userSelect = ''; 
		window.removeEventListener('mousemove', onMouseMove);
		window.removeEventListener('mouseup', stopResize);
	}

	function startResize() {
		resizing = true;
		document.body.style.userSelect = 'none'; 
		window.addEventListener('mousemove', onMouseMove);
		window.addEventListener('mouseup', stopResize);
	}
</script>

<div bind:this={container} class="view-container {resizeSide}}" style="width: {width}px;">
	{#if appState.currentTab === 'data'}
		<DataDisplay />
	{:else if appState.currentTab === 'worksheet'}
		<WorksheetDisplay />
	{/if}

	<div class="resizer" onmousedown={startResize}></div>
</div>

<style>
	.view-container {
		z-index: -1;
		overflow-y: auto;
		overflow-x: hidden;
		height: 100%;
		min-width: 300px;
		max-width: 500px;
		display: flex;
		flex-direction: column;
		justify-content: start;
		align-items: start;

		position: fixed;
		top: 0;
		left: 56px;

		border-right: 1px solid #d9d9d9;
		background: #fff;
		box-sizing: border-box;
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
