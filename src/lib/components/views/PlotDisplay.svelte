<script>
	// @ts-nocheck
	import Draggable from '$lib/components/reusables/Draggable.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import AddPlot from '$lib/components/iconActions/AddPlot.svelte';
	import AddTable from '$lib/components/iconActions/AddTable.svelte';
	import { core, appConsts, appState } from '$lib/core/core.svelte.js';
	import { closeControlPanel } from '$lib/components/views/ControlDisplay.svelte';
	import { tick } from 'svelte';

	// AddTable dropdown
	let addBtnRef;
	let showAddTable = $state(false);
	let dropdownTop = $state(0);
	let dropdownLeft = $state(0);

	function recalculateDropdownPosition() {
		if (!addBtnRef) return;
		const rect = addBtnRef.getBoundingClientRect();

		dropdownTop = rect.top + window.scrollY;
		dropdownLeft = rect.right + window.scrollX + 12;
	}

	function openDropdown(e) {
		e.stopPropagation();
		recalculateDropdownPosition();
		requestAnimationFrame(() => {
			showAddTable = true;
		});
		window.addEventListener('resize', recalculateDropdownPosition);
	}

	let showNewPlotModal = $state(false);
	let showNewPlotModalconst = $state(false);

	function handleClick(e) {
		e.stopPropagation();
		closeControlPanel();
	}

	let canvasWidthPx = $derived.by(() => {
		const whole = appState.windowWidth - appState.widthNavBar;
		const displayWidth = appState.showDisplayPanel ? appState.widthDisplayPanel : 0;
		const controlWidth = appState.showControlPanel ? appState.widthControlPanel : 0;
		return whole - displayWidth - controlWidth;
	});

	let leftPx = $derived.by(() => {
		if (appState.showDisplayPanel) {
			return appState.widthDisplayPanel + appState.widthNavBar;
		}
		return appState.widthNavBar;
	});

	let gridBackgroundWidthPx = $derived.by(() => {
		const rightMostPlot = Math.max(...core.plots.map((p) => p.x + p.width));
		return Math.max(canvasWidthPx, rightMostPlot + 200);
	});

	let gridBackgroundHeightPx = $derived.by(() => {
		const bottomMostPlot = Math.max(...core.plots.map((p) => p.y + p.height));
		return Math.max(appState.windowHeight, bottomMostPlot + 200);
	});

	$effect(() => {
		if (showAddTable && core.data.length > 0) {
			appState.currentTab = 'data';
			appState.showDisplayPanel = true;
		}
	});
	$effect(() => {
		if (showNewPlotModal && core.plots.length > 0) {
			//TODO: would be nice to see the '+' [add new plot] icon move, with animation, to the top-right (and stay there)
		}
	});
</script>

<div
	onclick={handleClick}
	class="canvas"
	style="top: 0;
			left: {leftPx}px;
			"
>
	<div
		class="canvas-panel"
		style="
		width: {canvasWidthPx}px;
		height: 100vh;
	"
	>
		<div
			class="canvas-background"
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
			{#if core.plots.length > 0}
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
			{:else if core.data.length > 0}
				<div class="no-plot-prompt">
					<button class="icon" onclick={() => (showNewPlotModal = true)}>
						<Icon name="add" width={24} height={24} />
					</button>
					<p>Click to add a new plot</p>
				</div>

				{#if showNewPlotModal}
					<AddPlot
						bind:showDropdown={showNewPlotModal}
						dropdownTop={window.innerHeight / 2 - 25}
						dropdownLeft={window.innerWidth / 2 - 40}
					/>
				{/if}
			{:else}
				<div class="no-plot-prompt">
					<button class="icon" bind:this={addBtnRef} onclick={openDropdown}>
						<Icon name="add" width={24} height={24} />
					</button>
					<p>Click to add new data</p>
				</div>
				{#if showAddTable}
					<AddTable bind:showDropdown={showAddTable} {dropdownTop} {dropdownLeft} />
				{/if}
			{/if}
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

	.no-plot-prompt {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: center;

		width: 100%;
		height: 100%;

		font-weight: bold;
	}

	.no-plot-prompt p {
		color: var(--color-lightness-75);
	}

	.newplotconstant {
		transition: right 0.5s ease;
	}
</style>
