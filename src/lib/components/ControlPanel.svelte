<script>
	// @ts-nocheck
	import { appConsts, appState, core } from '$lib/core/core.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import ControlDisplay from './views/ControlDisplay.svelte';
	import { fly, fade } from 'svelte/transition';
	import WorksheetAddPalette from '$lib/components/views/WorksheetAddPalette.svelte';
	import { tooltip } from '$lib/utils/tooltip.js';

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
		if (newWidth < 30) {
			appState.showControlPanel = false;
			return;
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
		<div
			class="close-control-panel-icon-container"
			in:fade={{ duration: 600 }}
			out:fly={{ x: -appState.widthControlPanel, duration: 600 }}
			{@attach tooltip('Close control panel')}
		>
			<button class="icon" onclick={() => (appState.showControlPanel = false)}>
				<Icon name="circle-chevron-left" width={32} height={32} />
			</button>
		</div>
		<ControlDisplay />
	</div>
	<div
		class="resizer-overlay {resizeSide}"
		style="right: {appState.widthControlPanel + (resizeSide === 'left' ? 0 : 6)}px;"
		onmousedown={startResize}
	></div>
{:else}
	<!-- TODO: reconsider this ux wise -->
	<div
		class="open-control-panel-icon-container"
		in:fade={{ duration: 600 }}
		out:fly={{ x: -appState.widthControlPanel, duration: 600 }}
		{@attach tooltip('Open control panel')}
	>
		<button class="icon" onclick={() => (appState.showControlPanel = true)}>
			<Icon name="circle-chevron-left" width={32} height={32} />
		</button>
	</div>
{/if}

{#if core.plots.length > 0 && !appState.showWorkflow && appState.view !== 'canvas'}
	<button
		class="icon newplotconstant"
		style="z-index: 999; position: fixed; right: calc({appState.showControlPanel
			? appState.widthControlPanel
			: 0}px + 5px); top: 10px;"
		onclick={(e) => {
			e.stopPropagation();
			showNewPlotModalconst = true;
		}}
		out:fly={{
			x: -100,
			y: 100,
			duration: 600
		}}
	>
		<Icon name="add" width={24} height={24} />
	</button>

	<WorksheetAddPalette
		bind:open={showNewPlotModalconst}
		top={50}
		left={Math.max(
			0,
			window.innerWidth - (appState.showControlPanel ? appState.widthControlPanel : 0) - 360
		)}
	/>
{/if}

<style>
	.icon {
		transition: right 0.6s ease;
	}
	/* Match the workflow NodePalette trigger (.np-btn) exactly so the add button
	   sits in the same spot/size when switching views. */
	.newplotconstant {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 26px;
		padding: 0;
	}
	.openControlPanel {
		position: fixed;
		top: 0;
		right: 0;
		z-index: 999;
	}

	.open-control-panel-icon-container {
		position: fixed;
		top: calc(100vh * 9 / 20);
		right: 0;
		z-index: 999;

		margin: 0;
		padding: 0;
	}
	.close-control-panel-icon-container {
		position: fixed;
		top: calc(100vh * 9 / 20);
		z-index: 999;
		rotate: 180deg;
		margin: 0px -30px;
		padding: 0;
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
		background: var(--surface-card);
		box-sizing: border-box;

		z-index: 999;
		/*box-shadow: -5px 0 10px rgba(0, 0, 0, 0.3);*/
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

	.resizer-overlay {
		/* invisible drag strip over the panel boundary; 12px (was 6) for an easier grab.
		   Not the full 24px since it would intercept clicks on panel-edge content. */
		width: 12px;
		height: 100vh;
		position: fixed;
		top: 0;
		margin-left: -3px;
		cursor: ew-resize;
		background-color: transparent;
		z-index: 1001;
	}
</style>
