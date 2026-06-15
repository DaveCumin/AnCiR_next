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
	import Draggable from '$lib/components/reusables/Draggable.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import FloatingActions from '$lib/components/workflow/FloatingActions.svelte';
	import NoteCard from '$lib/components/views/NoteCard.svelte';
	import WorksheetAddPalette from '$lib/components/views/WorksheetAddPalette.svelte';

	import { core, appConsts, appState } from '$lib/core/core.svelte.js';
	import { onMount, tick } from 'svelte';
	import { fly, fade } from 'svelte/transition';

	import { deselectAllPlots } from '$lib/core/Plot.svelte';
	import { removePlots } from '$lib/core/Plot.svelte';

	let selectedPlotIds = $derived.by(() => core.plots.filter((p) => p.selected).map((p) => p.id));

	// --- Plot-view viewport persistence ---
	// Separate from the workflow-canvas viewport (which lives under
	// `ancir.canvas.viewport`) so each view remembers its own zoom + pan.
	const PLOT_VIEWPORT_STORAGE_KEY = 'ancir.plotview.viewport';

	onMount(() => {
		try {
			const raw = localStorage.getItem(PLOT_VIEWPORT_STORAGE_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw);
			const x = Number(parsed?.x);
			const y = Number(parsed?.y);
			const z = Number(parsed?.z);
			if (Number.isFinite(x) && Number.isFinite(y)) appState.canvasOffset = { x, y };
			if (Number.isFinite(z) && z > 0) appState.canvasScale = z;
		} catch {
			/* parse / quota errors — keep defaults */
		}
	});

	$effect(() => {
		const payload = JSON.stringify({
			x: appState.canvasOffset?.x ?? 0,
			y: appState.canvasOffset?.y ?? 0,
			z: appState.canvasScale ?? 1
		});
		try {
			localStorage.setItem(PLOT_VIEWPORT_STORAGE_KEY, payload);
		} catch {
			/* quota / private-mode — ignore */
		}
	});

	let showNewPlotModal = $state(false);

	function handleClick(e) {
		e.stopPropagation();
		deselectAllPlots();
	}

	let leftPx = $derived.by(() => {
		if (appState.showDisplayPanel) {
			return appState.widthDisplayPanel + appState.widthNavBar;
		}
		return appState.widthNavBar;
	});

	let gridBackgroundWidthPx = $derived.by(() => {
		const rights = [
			...core.plots.map((p) => p.x + p.width),
			...core.notes.map((n) => n.x + n.width)
		];
		const rightMost = rights.length ? Math.max(...rights) : 0;
		return Math.max(canvasWidthPx, rightMost + 200);
	});

	let gridBackgroundHeightPx = $derived.by(() => {
		const bottoms = [
			...core.plots.map((p) => p.y + p.height),
			...core.notes.map((n) => n.y + n.height)
		];
		const bottomMost = bottoms.length ? Math.max(...bottoms) : 0;
		return Math.max(appState.windowHeight, bottomMost + 200);
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

			// if ((e.key === 'Backspace' || e.key === 'Delete') && selectedPlotIds.length > 0) {
			// 	removePlots(selectedPlotIds);
			// }
		};

		window.addEventListener('keydown', onKeyDown);
		return () => {
			window.removeEventListener('keydown', onKeyDown);
		};
	});
</script>

<!-- FloatingActions sits in its own fixed-bounds host so the load/save and
     undo/redo buttons stay pinned to the worksheet corners and don't scroll
     with the panning canvas. -->
<div
	class="fa-host"
	style="top: 0; left: {leftPx}px; width: {canvasWidthPx}px; height: 100vh;"
>
	<FloatingActions />
</div>

<div
	onclick={handleClick}
	ondblclick={() => (appState.showControlPanel = false)}
	class="canvas"
	style="top: 0;
			left: {leftPx}px;
			width: {canvasWidthPx}px;
			height: 100vh;
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
			{#each core.notes as note (note.id)}
				<NoteCard {note} />
			{/each}

			{#if core.plots.length > 0}
				{#each core.plots as plot, i (plot.id)}
					{#if !appState.invisiblePlotIds.includes(plot.id)}
						<Draggable
							bind:x={plot.x}
							bind:y={plot.y}
							bind:width={plot.width}
							bind:height={plot.height}
							bind:title={plot.name}
							id={plot.id}
							bind:selected={plot.selected}
						>
							{@const Plot = appConsts.plotMap.get(plot.type).plot ?? null}
							<Plot theData={plot} which="plot" />
						</Draggable>
					{/if}
				{/each}
			{:else if core.notes.length > 0}
				<!-- Notes are rendered above; suppress the empty-state prompt. -->
			{:else if core.data.length > 0}
				<div class="no-plot-prompt" out:fade={{ duration: 600 }}>
					<button class="icon" onclick={() => (showNewPlotModal = true)}>
						<Icon name="add" width={24} height={24} />
					</button>
					<p style="margin-left: 10px">Click to add a plot or note</p>
				</div>

				<WorksheetAddPalette
					bind:open={showNewPlotModal}
					top={window.innerHeight / 2 - 25}
					left={window.innerWidth / 2 - 40}
				/>
			{:else}
				<div class="no-plot-prompt" in:fade={{ duration: 600 }}>
					<p style="margin-left: 10px" out:fade={{ duration: 600 }}>
						No data yet — switch to the workflow canvas to import or simulate columns.
					</p>
				</div>
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

	.fa-host {
		position: fixed;
		pointer-events: none;
		z-index: 30;
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
