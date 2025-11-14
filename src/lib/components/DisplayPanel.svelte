<script module>
	export function closeDisplayPanel() {
		appState.currentTab = null;
		appState.showDisplayPanel = false;
	}
</script>

<script>
	// @ts-nocheck

	import { appState } from '$lib/core/core.svelte.js';
	import DataDisplay from '$lib/components/views/DataDisplay.svelte';
	import WorksheetDisplay from '$lib/components/views/WorksheetDisplay.svelte';
	import { fly } from 'svelte/transition';

	let container;
	const minWidth = 200;
	const maxWidth = 500;

	let resizeSide = 'right';
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
		if (newWidth > maxWidth - 1 || newWidth < minWidth + 1) {
			return;
		}

		appState.widthDisplayPanel = newWidth;
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

{#if appState.showDisplayPanel}
	<div
		bind:this={container}
		class="view-container {resizeSide}"
		style="left: {appState.widthNavBar}px; width: {appState.widthDisplayPanel}px; min-width: {minWidth}px;	max-width: {maxWidth}px;"
		in:fly={{ x: -appState.widthDisplayPanel, duration: 600 }}
		out:fly={{ x: -appState.widthDisplayPanel, duration: 600 }}
	>
		{#if appState.currentTab === 'data'}
			<DataDisplay />
		{:else if appState.currentTab === 'worksheet'}
			<WorksheetDisplay />
		{/if}
	</div>
	<div
		class="resizer-overlay {resizeSide}"
		style="left: {appState.widthNavBar +
			appState.widthDisplayPanel -
			(resizeSide === 'right' ? 6 : 0)}px;"
		onmousedown={startResize}
	></div>
{/if}

<style>
	.openDisplayPanel {
		position: fixed;
		top: 10px;
		left: 56px;
		z-index: 999;
	}
	.view-container {
		overflow-y: auto;
		overflow-x: hidden;
		height: 100%;
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

		z-index: 999;
		/* box-shadow: 5px 0 10px rgba(0, 0, 0, 0.3); */
	}

	.view-container::-webkit-scrollbar {
		display: none;
	}

	.view-container.right .resizer {
		right: 0;
		top: 0;
	}

	.view-container.left .resizer {
		left: 0;
		top: 0;
	}

	.resizer {
		width: 6px;
		cursor: ew-resize;
		height: 100vh; /* Set the height to a very large value to account for scrolling */
		position: absolute;
		background-color: transparent;
		z-index: 1000; /* Higher than the container's z-index */
	}
	.resizer-overlay {
		width: 6px;
		height: 100vh;
		position: fixed;
		top: 0;
		cursor: ew-resize;
		background-color: transparent;
		z-index: 1001;
	}
</style>
