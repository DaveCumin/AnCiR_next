<script>
	// TODO: scroll horizontally and vertically
	// TODO: if mouse reach end of screen, screen shifts with mouse

	// @ts-nocheck
	import Draggable from '$lib/components/reusables/Draggable.svelte';

	import { core, appConsts, appState } from '$lib/core/core.svelte.js';
	import { closeControlPanel } from '$lib/components/views/ControlDisplay.svelte';
	import { max } from '$lib/utils/MathsStats';

	function handleClick(e) {
		e.stopPropagation();
		closeControlPanel();
	}

	let canvasWidthPx = $derived.by(() => {
		const whole = appState.windowWidth - appState.widthNavBar;
		const displayWidth = appState.showDisplayPanel ? appState.widthDisplayPanel : 0;
		const controlWidth = appState.showControlPanel ? appState.widthControlPanel : 0;
		console.log('whole: ', whole, 'displayWidth: ', displayWidth, 'controlWidth: ', controlWidth);
		return whole - displayWidth - controlWidth;
	});

	let leftPx = $derived.by(() => {
		if (appState.showDisplayPanel) {
			return appState.widthDisplayPanel + appState.widthNavBar;
		}
		return appState.widthNavBar;
	});

	// TODO: next step to possible inf grid
	let gridBackgroundWidthPx = $derived.by(() => {
		const rightMostPlot = Math.max(...core.plots.map(p => p.x + p.width));
		console.log(canvasWidthPx, rightMostPlot);
		return Math.max(canvasWidthPx, rightMostPlot + appState.gridSize);
	});

	let gridBackgroundHeightPx = $derived.by(() => {
		const bottomMostPlot = Math.max(...core.plots.map(p => p.y + p.height));
		return Math.max(appState.windowHeight, bottomMostPlot + 3 * appState.gridSize);
	});
</script>

<div
	onclick={handleClick}
	class="canvas"
	style="top: 0;
			left: {leftPx}px;
			">
			
	<div
		class="canvas-panel"
		style="
		width: {canvasWidthPx}px;
		height: 100vh;
		background-image:
			repeating-linear-gradient(
			to right,
			var(--color-lightness-95) 0,
			var(--color-lightness-95) 1px,
			transparent 1px,
			transparent {appState.gridSize}px
			),
			repeating-linear-gradient(
			to bottom,
			var(--color-lightness-95) 0,
			var(--color-lightness-95) 1px,
			transparent 1px,
			transparent {appState.gridSize}px
			);
	">

		<div class="canvas-background"
			style="
			width: {gridBackgroundWidthPx}px;
			height: {gridBackgroundHeightPx}px;
			background-image:
				repeating-linear-gradient(
				to right,
				var(--color-lightness-95) 0,
				var(--color-lightness-95) 1px,
				transparent 1px,
				transparent {appState.gridSize}px
				),
				repeating-linear-gradient(
				to bottom,
				var(--color-lightness-95) 0,
				var(--color-lightness-95) 1px,
				transparent 1px,
				transparent {appState.gridSize}px
				);
			"
		>
			{#each core.plots as plot, i (plot.id)}
				<Draggable
					bind:x={plot.x}
					bind:y={plot.y}
					bind:width={plot.width}
					bind:height={plot.height}
					title={plot.name}
					id={plot.id}
				>
					{@const Plot = appConsts.plotMap.get(plot.type).plot ?? null}
					<Plot theData={plot} which="plot" />
				</Draggable>
			{/each}
		</div>
	</div>
</div>

<style>
	.canvas {
		position: fixed;
		overflow: auto;
		transition:
			width 0.6s ease,
			left 0.6s ease;
	}
</style>
