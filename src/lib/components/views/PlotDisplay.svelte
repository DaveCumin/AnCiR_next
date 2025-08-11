<script>
	// @ts-nocheck
	import Draggable from '$lib/components/reusables/Draggable.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import AddPlot from '$lib/components/iconActions/AddPlot.svelte';
	import AddTable from '$lib/components/iconActions/AddTable.svelte';

	import { core, appConsts, appState } from '$lib/core/core.svelte.js';
	import { onMount, tick } from 'svelte';
	import { fly, fade } from 'svelte/transition';

	import { deselectAllPlots } from '$lib/core/Plot.svelte';
	import { removePlot } from '$lib/core/Plot.svelte';

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
		showAddTable = true;

		window.addEventListener('resize', recalculateDropdownPosition);
	}

	let showNewPlotModal = $state(false);

	function handleClick(e) {
		e.stopPropagation();
		deselectAllPlots();
		appState.showControlPanel = false;
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

	//more efficient way to open the dataDisplay on import (fewer reactive checks)
	let hasData = $derived.by(() => {
		return core.data.length > 0;
	});
	$effect(() => {
		if (hasData) {
			appState.currentTab = 'data';
			appState.showDisplayPanel = true;
		}
	});

	onMount(() => {
		const onKeyDown = (e) => {
			const active = document.activeElement;

			const isTextInput =
				active &&
				(active.tagName === 'INPUT' ||
					active.tagName === 'TEXTAREA' ||
					active.getAttribute('contenteditable') === 'true');

			if (isTextInput) return;

			const selectedPlotIds = core.plots.filter((p) => p.selected).map((p) => p.id);
			if ((e.key === 'Backspace' || e.key === 'Delete') && selectedPlotIds.length > 0) {
				const confirmed = window.confirm(
					`Are you sure you want to delete ${selectedPlotIds.length} plot(s)?`
				);

				if (confirmed) {
					for (const id of selectedPlotIds) {
						removePlot(id);
					}
				}
			}
		};

		window.addEventListener('keydown', onKeyDown);
		return () => {
			window.removeEventListener('keydown', onKeyDown);
		};
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
		position: relative;
		transform-origin: top left;
		width: {Math.max(canvasWidthPx, canvasWidthPx / appState.canvasScale)}px;
		height: 100vh;
		transform: scale({appState.canvasScale});
	"
	>
		<div
			class="canvas-background"
			style="
			width: {Math.max(gridBackgroundWidthPx, gridBackgroundWidthPx / appState.canvasScale)}px;
			height: {Math.max(gridBackgroundHeightPx, gridBackgroundHeightPx / appState.canvasScale)}px;
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
					{#if !appState.invisiblePlotIds.includes(plot.id)}
						<Draggable
							bind:x={plot.x}
							bind:y={plot.y}
							bind:width={plot.width}
							bind:height={plot.height}
							title={plot.name}
							id={plot.id}
							selected={plot.selected}
						>
							{@const Plot = appConsts.plotMap.get(plot.type).plot ?? null}
							<Plot theData={plot} which="plot" />
						</Draggable>
					{/if}
				{/each}
			{:else if core.data.length > 0}
				<div class="no-plot-prompt" out:fade={{ duration: 600 }}>
					<button class="icon" onclick={() => (showNewPlotModal = true)}>
						<Icon name="add" width={24} height={24} />
					</button>
					<p style="margin-left: 10px">Click to add a new plot</p>
				</div>

				<AddPlot
					bind:showDropdown={showNewPlotModal}
					dropdownTop={window.innerHeight / 2 - 25}
					dropdownLeft={window.innerWidth / 2 - 40}
				/>
			{:else}
				<div class="no-plot-prompt" in:fade={{ duration: 600 }}>
					<button
						class="icon"
						bind:this={addBtnRef}
						onclick={openDropdown}
						out:fly={{
							x: 100,
							y: -100,
							duration: 600
						}}
					>
						<Icon name="add" width={24} height={24} />
					</button>
					<p style="margin-left: 10px" out:fade={{ duration: 600 }}>Click to add new data</p>
				</div>

				<AddTable bind:showDropdown={showAddTable} {dropdownTop} {dropdownLeft} />
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
		position: fixed;
		right: 15px;
		transition: right 0.5s ease;
	}
</style>
