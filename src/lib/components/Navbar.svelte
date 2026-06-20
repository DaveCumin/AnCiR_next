<!-- Navbar.svelte -->
<script>
	// @ts-nocheck
	import { appState, core } from '$lib/core/core.svelte.js';
	import Icon from '$lib/icons/Icon.svelte';
	import Settings from '$lib/components/views/modals/Settings.svelte';
	import About from './views/modals/About.svelte';
	import { tooltip } from '$lib/utils/tooltip.js';
	import { openPicker } from '$lib/core/tourRunner.svelte.js';
	import { history } from '$lib/core/history.svelte.js';
	import { exportJson } from '$lib/components/iconActions/Setting.svelte';
	import LoadSessionModal from './workflow/LoadSessionModal.svelte';

	let showSettings = $state(false);
	let showAbout = $state(false);
	let showHelpMenu = $state(false);
	let showLoadModal = $state(false);
	let helpAnchor;

	// The Data panel is independent of the canvas mode — it overlays either the
	// workflow or the workspace canvas. So it's a plain toggle.
	function toggleDataPanel() {
		if (appState.showDisplayPanel && appState.currentTab === 'data') {
			appState.showDisplayPanel = false;
			appState.currentTab = null;
		} else {
			appState.showDisplayPanel = true;
			appState.currentTab = 'data';
		}
	}

	// Canvas mode is a mutually-exclusive choice: workflow canvas vs workspace
	// (plots) canvas. These set appState.view only and never touch the panel.
	function showWorkflowView() {
		appState.view = 'canvas';
	}
	function showWorkspaceView() {
		// Carry any plot nodes that were canvas-multi-selected over to plots-view
		// selection so the shared-properties panel activates; drop non-plot ones.
		syncCanvasSelectionToPlotsView();
		appState.view = 'plots';
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
</script>

<nav class="container" style="width: {appState.widthNavBar}px;">
	<div class="icon-container top">
		<!-- View switching: a Data-panel toggle + a Workflow/Workspace mode pair. -->
		<button
			class="rail-btn"
			onclick={toggleDataPanel}
			{@attach tooltip('Data — view and edit your columns, nodes and plots')}
		>
			<Icon name="table" className={appState.showDisplayPanel ? 'icon active' : 'icon'} />
		</button>

		<div class="view-pair" role="group" aria-label="Canvas view">
			<button
				class="rail-btn"
				onclick={showWorkflowView}
				{@attach tooltip('Workflow — wire and inspect the analysis pipeline')}
			>
				<Icon name="process" className={appState.view === 'canvas' ? 'icon active' : 'icon'} />
			</button>
			<button
				class="rail-btn"
				onclick={showWorkspaceView}
				{@attach tooltip('Workspace — arrange and style your plots')}
			>
				<Icon name="layer" className={appState.view === 'plots' ? 'icon active' : 'icon'} />
			</button>
		</div>

		<div class="rail-sep"></div>

		<!-- Session / history actions (moved off the canvas). -->
		<button
			class="rail-btn"
			onclick={() => (showLoadModal = true)}
			{@attach tooltip('Load a session')}
		>
			<Icon name="sessionload" width={22} height={22} />
		</button>
		<button class="rail-btn" onclick={exportJson} {@attach tooltip('Save this session')}>
			<Icon name="sessionsave" width={22} height={22} />
		</button>
		<button
			class="rail-btn"
			onclick={() => history.undo()}
			disabled={!history.canUndo}
			{@attach tooltip(
				`Undo (Cmd/Ctrl+Z)${history.canUndo ? ` — ${history.undoCount} step${history.undoCount > 1 ? 's' : ''}` : ''}`
			)}
		>
			<Icon name="undo" width={20} height={20} />
		</button>
		<button
			class="rail-btn"
			onclick={() => history.redo()}
			disabled={!history.canRedo}
			{@attach tooltip(
				`Redo (Cmd/Ctrl+Shift+Z)${history.canRedo ? ` — ${history.redoCount} step${history.redoCount > 1 ? 's' : ''}` : ''}`
			)}
		>
			<Icon name="redo" width={20} height={20} />
		</button>
	</div>

	<div class="icon-container bottom">
		<button class="rail-btn" onclick={() => (showSettings = true)} {@attach tooltip('Settings')}>
			<Icon name="gear" />
		</button>
		<div class="help-anchor" bind:this={helpAnchor}>
			<button
				class="rail-btn"
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
<LoadSessionModal bind:showModal={showLoadModal} />

<style>
	.container {
		height: 100vh;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		align-items: center;

		background-color: var(--surface-card);

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
		gap: 0.15rem;
	}
	.icon-container.top {
		margin-top: 18px;
	}
	.icon-container.bottom {
		margin-bottom: 18px;
	}

	.rail-btn {
		background-color: transparent;
		border: none;
		margin: 0;
		padding: 0.35rem;
		text-align: inherit;
		font: inherit;
		border-radius: var(--radius-md);
		appearance: none;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		transition: background-color 0.15s ease;
	}
	.rail-btn:hover:not(:disabled) {
		background-color: var(--color-lightness-95, #f2f2f2);
	}
	.rail-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	/* Workflow/Workspace form one mutually-exclusive group, visually boxed so the
	   pair reads as "the canvas mode" — distinct from the Data panel toggle. */
	.view-pair {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.1rem;
		padding: 0.15rem;
		border-radius: var(--radius-lg);
		background-color: var(--color-lightness-97, #f7f7f7);
	}

	.rail-sep {
		width: 22px;
		height: 1px;
		background-color: var(--color-lightness-85, #ddd);
		margin: 0.3rem 0;
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
		background: var(--surface-card);
		border: 1px solid var(--color-lightness-85, #ddd);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-3);
		padding: 0.25rem;
		display: flex;
		flex-direction: column;
		z-index: 1001;
	}

	.help-menu button {
		margin: 0;
		padding: 0.5rem 0.7rem;
		border-radius: var(--radius-md);
		text-align: left;
		font-size: var(--font-lg);
		cursor: pointer;
		white-space: nowrap;
		background: transparent;
		border: none;
	}

	.help-menu button:hover {
		background: var(--color-lightness-95, #f4f4f4);
	}
</style>
