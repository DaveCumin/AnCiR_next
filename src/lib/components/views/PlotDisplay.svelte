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
		if (appState.showControlPanel) {
			return (
				window.innerWidth -
				appState.positionDisplayPanel -
				(window.innerWidth - appState.positionControlPanel)
			);
		} else {
			return window.innerWidth - appState.positionDisplayPanel;
		}
	});

	let canvasContentHeight = $derived.by(() => {
		if (core.plots.length === 0) {
			return `${window.innerHeight}px`;
		}

		const bottommost = Math.max(...core.plots.map(p => p.y + p.height));
		const padded = Math.max(window.innerHeight, bottommost + 100);

		return `${padded}px`;
	});
</script>

<div
	onclick={handleClick}
	class="canvas"
	style="top: 0;
			left: {appState.positionDisplayPanel}px;
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

<style>
	.canvas {
		position: fixed;
		overflow: auto;
	}
</style>
