<!-- Navbar.svelte -->
<script>
	// @ts-nocheck
	import { appState, core } from '$lib/core/core.svelte.js';
	import Icon from '$lib/icons/Icon.svelte';
	import Settings from '$lib/components/views/modals/Settings.svelte';
	import About from './views/modals/About.svelte';
	import { tooltip } from '$lib/utils/tooltip.js';
	import { openPicker } from '$lib/core/tourRunner.svelte.js';

	let showSettings = $state(false);
	let showAbout = $state(false);
	let showHelpMenu = $state(false);
	let helpAnchor;

	function toggleDataView() {
		// Data panel is independent of the canvas view — it can be open or
		// closed alongside either the plot canvas or the workflow canvas.
		if (appState.currentTab === 'data' && appState.showDisplayPanel) {
			appState.showDisplayPanel = false;
			appState.currentTab = null;
		} else {
			appState.showDisplayPanel = true;
			appState.currentTab = 'data';
		}
	}

	function selectWorksheetView() {
		// Worksheet view = plot canvas + worksheet layer panel. Clicking the
		// button when the worksheet panel is already open toggles the panel
		// off but leaves the plot canvas active.
		// Before unmounting the workflow canvas, transfer any plot nodes that
		// were canvas-multi-selected over to plots-view selection (so the
		// shared-properties panel activates). Non-plot canvas selections are
		// dropped — they're irrelevant in plots view.
		syncCanvasSelectionToPlotsView();
		appState.view = 'plots';
		if (appState.currentTab === 'worksheet' && appState.showDisplayPanel) {
			appState.showDisplayPanel = false;
			appState.currentTab = null;
		} else {
			appState.currentTab = 'worksheet';
			appState.showDisplayPanel = true;
		}
	}

	function syncCanvasSelectionToPlotsView() {
		const ids = appState.canvasMultiSelectedNodeIds ?? [];
		if (ids.length === 0) return;
		const kept = [];
		for (const id of ids) {
			if (typeof id === 'string' && id.startsWith('plot_')) {
				const plotId = Number(id.slice(5));
				const plot = core.plots.find((p) => p.id === plotId);
				if (plot) {
					plot.selected = true;
					kept.push(id);
				}
			}
		}
		if (kept.length === ids.length) return;
		appState.canvasMultiSelectedNodeIds = kept;
		appState.canvasMultiSelectedCount = kept.length;
		if (
			appState.canvasSelectedNodeId != null &&
			!kept.includes(appState.canvasSelectedNodeId)
		) {
			appState.canvasSelectedNodeId = null;
		}
	}

	function selectWorkflowView() {
		// Workflow view = workflow canvas. Close the worksheet panel if it
		// was open; leave a data panel alone since data is orthogonal.
		appState.view = 'canvas';
		if (appState.currentTab === 'worksheet') {
			appState.currentTab = null;
			appState.showDisplayPanel = false;
		}
	}
</script>

<nav class="container" style="width: {appState.widthNavBar}px;">
	<div class="icon-container">
		<button
			onclick={toggleDataView}
			{@attach tooltip('Data — view and edit your imported columns')}
		>
			<Icon name="table" className={appState.currentTab === 'data' ? 'icon active' : 'icon'} />
		</button>

		<button
			onclick={selectWorksheetView}
			{@attach tooltip('Worksheet — arrange and style your plots')}
		>
			<Icon name="layer" className={appState.view === 'plots' ? 'icon active' : 'icon'} />
		</button>

		<button
			onclick={selectWorkflowView}
			{@attach tooltip('Workflow — wire and inspect the analysis pipeline')}
		>
			<Icon
				name="process"
				className={appState.view === 'canvas' ? 'icon active' : 'icon'}
			/>
		</button>
	</div>

	<div class="icon-container">
		<button onclick={() => (showSettings = true)} {@attach tooltip('Settings')}>
			<Icon name="gear" />
		</button>
		<div class="help-anchor" bind:this={helpAnchor}>
			<button
				onclick={() => (showHelpMenu = !showHelpMenu)}
				aria-haspopup="menu"
				aria-expanded={showHelpMenu}
				{@attach tooltip('Help — take a tour or about AnCiR')}
			>
				<Icon name="query" />
			</button>
			{#if showHelpMenu}
				<div class="help-menu" role="menu">
					<button
						type="button"
						role="menuitem"
						onclick={() => {
							showHelpMenu = false;
							openPicker();
						}}>Take a tour…</button
					>
					<button
						type="button"
						role="menuitem"
						onclick={() => {
							showHelpMenu = false;
							showAbout = true;
						}}>About AnCiR</button
					>
				</div>
			{/if}
		</div>
	</div>
</nav>

<svelte:window
	onclick={(e) => {
		if (showHelpMenu && helpAnchor && !helpAnchor.contains(e.target)) showHelpMenu = false;
	}}
/>

<Settings bind:showModal={showSettings} />

<About bind:showModal={showAbout} />

<style>
	.container {
		height: 100vh;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		align-items: center;

		background-color: white;

		position: fixed;
		top: 0;
		left: 0;

		border-right: 1px solid #d9d9d9;

		z-index: 1000;
	}

	.icon-container {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;

		margin-top: 28px;
		margin-bottom: 28px;
	}

	button {
		background-color: transparent;
		border: none;
		margin: 0.5rem;
		padding: 0;
		text-align: inherit;
		font: inherit;
		border-radius: 0;
		appearance: none;
	}

	.help-anchor {
		position: relative;
		display: flex;
		justify-content: center;
	}

	/* Pops out to the right of the narrow navbar, anchored near the ? button. */
	.help-menu {
		position: absolute;
		left: calc(100% + 6px);
		bottom: 0;
		min-width: 150px;
		background: #fff;
		border: 1px solid var(--color-lightness-85, #ddd);
		border-radius: 8px;
		box-shadow: 0 6px 18px rgba(0, 0, 0, 0.16);
		padding: 0.25rem;
		display: flex;
		flex-direction: column;
		z-index: 1001;
	}

	.help-menu button {
		margin: 0;
		padding: 0.5rem 0.7rem;
		border-radius: 6px;
		text-align: left;
		font-size: 14px;
		cursor: pointer;
		white-space: nowrap;
	}

	.help-menu button:hover {
		background: var(--color-lightness-95, #f4f4f4);
	}
</style>
