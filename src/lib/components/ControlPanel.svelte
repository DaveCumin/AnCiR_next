<script>
	// @ts-nocheck
	import { appState, core } from '$lib/core/core.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import ControlDisplay from './views/ControlDisplay.svelte';
	import { fly } from 'svelte/transition';
	import AddPlot from '$lib/components/iconActions/AddPlot.svelte';

	let container;
	const minWidth = 200;
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
		if (newWidth > maxWidth - 1 || newWidth < minWidth + 1) {
			return;
		}

		appState.widthControlPanel = newWidth;
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

	let showNewPlotModalconst = $state(false);
</script>

{#if appState.showControlPanel}
	<div
		bind:this={container}
		class="view-container {resizeSide}"
		style="width: {appState.widthControlPanel}px; min-width: {minWidth}px;	max-width: {maxWidth}px;"
		in:fly={{ x: appState.widthControlPanel, duration: 600 }}
		out:fly={{ x: appState.widthControlPanel, duration: 600 }}
	>
		<ControlDisplay />
		<div class="resizer" onmousedown={startResize}></div>
	</div>
{:else}
	<!-- TODO: reconsider this ux wise -->
	<div class="open-control-panel-icon-container">
		<button class="icon" onclick={() => (appState.showControlPanel = true)}>
			<Icon name="circle-chevron-left" width={32} height={32} />
		</button>
	</div>
{/if}

{#if core.data.length > 0 && core.plots.length > 0}
	<button
		class="icon newplotconstant"
		style="z-index: 999; position: fixed; right: {appState.showControlPanel
			? appState.widthControlPanel
			: 0}px; top: 15px;"
		onclick={(e) => {
			e.stopPropagation();
			showNewPlotModalconst = true;
		}}
	>
		<Icon name="add" width={24} height={24} />
	</button>

	{#if showNewPlotModalconst}
		<AddPlot
			bind:showDropdown={showNewPlotModalconst}
			dropdownTop={15}
			dropdownLeft={window.innerWidth}
		/>
	{/if}
{/if}

<style>
	.openControlPanel {
		position: fixed;
		top: 0;
		right: 0;
		z-index: 999;
	}

	.open-control-panel-icon-container {
		position: fixed;
		top: calc(100vh * 4 / 9);
		right: 16px;
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

	.view-container.right .resizer {
		right: 0;
	}

	.view-container.left .resizer {
		left: 0;
	}
</style>
