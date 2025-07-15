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
		class="view-container {resizeSide}}"
		style="width: {appState.widthDisplayPanel}px; min-width: {minWidth}px;	max-width: {maxWidth}px;"
		in:fly={{ x: -appState.widthDisplayPanel, duration: 600 }}
		out:fly={{ x: -appState.widthDisplayPanel, duration: 600 }}
	>
		{#if appState.currentTab === 'data'}
			<DataDisplay />
		{:else if appState.currentTab === 'worksheet'}
			<WorksheetDisplay />
		{/if}

		<div class="resizer" onmousedown={startResize}></div>
	</div>
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
		background-color: transparent;
	}

	.view-container.right .resizer {
		right: 0;
	}

	.view-container.left .resizer {
		left: 0;
	}
</style>
