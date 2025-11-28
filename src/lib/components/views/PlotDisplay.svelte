<script module>
	export function getCanvasWidthPx() {
		return canvasWidthPx;
	}
	let canvasWidthPx = $derived.by(() => {
		const whole = appState.windowWidth - appState.widthNavBar;
		const displayWidth = appState.showDisplayPanel ? appState.widthDisplayPanel : 0;
		const controlWidth = appState.showControlPanel ? appState.widthControlPanel : 0;
		return whole - displayWidth - controlWidth;
	});
</script>

<script>
	// @ts-nocheck
	import { SvelteFlow, Background, BackgroundVariant } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';

	import Icon from '$lib/icons/Icon.svelte';
	import AddPlot from '$lib/components/iconActions/AddPlot.svelte';
	import AddTable from '$lib/components/iconActions/AddTable.svelte';
	import PlotNode from './PlotNode.svelte';

	import { core, appConsts, appState } from '$lib/core/core.svelte.js';
	import { onMount, tick } from 'svelte';
	import { fly, fade } from 'svelte/transition';

	import { deselectAllPlots } from '$lib/core/Plot.svelte';
	import { removePlots } from '$lib/core/Plot.svelte';
	import Correlogram from '$lib/plots/Correlogram/Correlogram.svelte';

	// Convert plots to SvelteFlow nodes (simple, no selection logic here)
	let nodes = $derived.by(() =>
		core.plots
			.filter((p) => !appState.invisiblePlotIds.includes(p.id))
			.map((plot) => ({
				id: plot.id.toString(),
				position: { x: plot.x, y: plot.y },
				data: { plot },
				type: 'plotNode',
				width: plot.width + 20,
				height: plot.height + 50,
				draggable: true,
				selectable: true,
				selected: plot.selected,
				dragHandle: '.plot-header'
			}))
	);

	let edges = $derived.by(() => []);

	// Map custom node types
	const nodeTypes = {
		plotNode: PlotNode,
		scatterplot: PlotNode,
		correlogram: PlotNode,
		fft: PlotNode,
		tableplot: PlotNode,
		actogram: PlotNode,
		periodogram: PlotNode
	};

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

	let leftPx = $derived.by(() => {
		if (appState.showDisplayPanel) {
			return appState.widthDisplayPanel + appState.widthNavBar;
		}
		return appState.widthNavBar;
	});

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
			if ((e.key === 'Backspace' || e.key === 'Delete') && selectedPlotIds.length > 0) {
				removePlots(selectedPlotIds);
			}
		};

		window.addEventListener('keydown', onKeyDown);

		return () => {
			window.removeEventListener('keydown', onKeyDown);
		};
	});
</script>

<div class="canvas" style="top: 0; left: {leftPx}px;">
	<div>
		{#each core.plots as plot (plot.id)}
			<p>
				{plot.name} - {plot.position.x}, {plot.position.y} | {plot.x}, {plot.y}; {plot.width} x {plot.height}
			</p>
		{/each}
	</div>
	{#if core.plots.length > 0}
		<SvelteFlow
			bind:nodes={core.plots}
			{edges}
			{nodeTypes}
			panOnDrag={true}
			panOnScroll={true}
			zoomOnPinch={true}
			snapToGrid={true}
			snapGrid={[appState.gridSize, appState.gridSize]}
			onbeforedelete={() => removePlots(selectedPlotIds)}
			onpaneclick={() => deselectAllPlots()}
		>
			<Background variant={BackgroundVariant.Dots} gap={appState.gridSize} />
		</SvelteFlow>
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
				out:fly={{ x: 100, y: -100, duration: 600 }}
			>
				<Icon name="add" width={24} height={24} />
			</button>
			<p style="margin-left: 10px" out:fade={{ duration: 600 }}>Click to add new data</p>
		</div>
		<AddTable bind:showDropdown={showAddTable} {dropdownTop} {dropdownLeft} />
	{/if}
</div>

<style>
	.canvas {
		position: fixed;
		overflow: auto;
		transition:
			width 0.6s ease,
			left 0.6s ease;
		width: 100%;
		height: 100%;
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
</style>
