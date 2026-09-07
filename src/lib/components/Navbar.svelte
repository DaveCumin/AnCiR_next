<!-- Navbar.svelte -->
<script>
	// @ts-nocheck
	import { appState, core } from '$lib/core/core.svelte.js';
	import Icon from '$lib/icons/Icon.svelte';
	import Settings from '$lib/components/views/modals/Settings.svelte';
	import About from './views/modals/About.svelte';
	import { tooltip } from '$lib/utils/tooltip.js';
	import { openPicker } from '$lib/core/tourRunner.svelte.js';
	import { history } from '$lib/core/opHistory.svelte.js';
	import { exportJson } from '$lib/components/iconActions/Setting.svelte';
	import LoadSessionModal from './workflow/LoadSessionModal.svelte';
	import AiPrompt from './views/modals/AiPrompt.svelte';
	import { NL_CONFIGURED, checkNlHealth } from '$lib/utils/nlSession.js';
	import { helpHint, dismissHelpHint } from '$lib/core/helpHint.svelte.js';

	// Callback from +page: summon the welcome/start screen (Help → "Welcome screen").
	let { onShowWelcome = null } = $props();

	let showSettings = $state(false);
	let showAbout = $state(false);
	let showHelpMenu = $state(false);
	let showLoadModal = $state(false);
	let showAi = $state(false);
	let helpAnchor;

	let exists = $state(false);

    async function checkFile() {
      try {
        const res = await fetch('/handbook.html', { method: 'HEAD' });
        exists = res.ok;
      } catch {
        exists = false;
      }
    }

	// The AI button needs a reachable Worker, so ask it rather than trusting
	// `navigator.onLine` (which only reports a link, not that our service is up — it would
	// happily show the button while the Worker is down or blocked). Offline/unconfigured ⇒ the
	// button simply isn't there, and the rest of AnCiR works exactly as before.
	let aiAvailable = $state(false);
	$effect(() => {
		if (!NL_CONFIGURED) return;
		let cancelled = false;
		checkNlHealth().then((ok) => {
			if (!cancelled) aiAvailable = ok;
		});
		return () => (cancelled = true);
	});



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
		if (appState.canvasSelectedNodeId != null && !kept.includes(appState.canvasSelectedNodeId)) {
			appState.canvasSelectedNodeId = null;
		}
	}
</script>

<nav class="container" style="width: {appState.widthNavBar}px;">
	<div class="icon-container top">
		<!-- View switching: a Data-panel toggle + a Workflow/Workspace mode pair. -->
		<button
			class="rail-btn"
			data-testid="nav-data-panel"
			onclick={toggleDataPanel}
			{@attach tooltip('Data — view and edit your columns, nodes and plots')}
		>
			<Icon name="table" className={appState.showDisplayPanel ? 'icon active' : 'icon'} />
		</button>

		<div class="view-pair" role="group" aria-label="Canvas view">
			<button
				class="rail-btn"
				data-testid="nav-workflow-view"
				onclick={showWorkflowView}
				{@attach tooltip('Workflow — wire and inspect the analysis pipeline')}
			>
				<Icon name="process" className={appState.view === 'canvas' ? 'icon active' : 'icon'} />
			</button>
			<button
				class="rail-btn"
				data-testid="nav-workspace-view"
				onclick={showWorkspaceView}
				{@attach tooltip('Workspace — arrange and style your plots')}
			>
				<Icon name="layer" className={appState.view === 'plots' ? 'icon active' : 'icon'} />
			</button>
		</div>

		<div class="rail-sep"></div>

		<!-- Load/save session -->
		<button
			class="rail-btn"
			data-testid="nav-load-session"
			onclick={() => (showLoadModal = true)}
			{@attach tooltip('Load a session')}
		>
			<Icon name="sessionload" width={22} height={22} />
		</button>
		<button
			class="rail-btn"
			data-testid="nav-save-session"
			onclick={exportJson}
			{@attach tooltip('Save this session')}
		>
			<Icon name="sessionsave" width={22} height={22} />
		</button>

		<div class="rail-sep"></div>

		<!-- Undo redo history -->
		<button
			class="rail-btn"
			data-testid="nav-undo"
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
			data-testid="nav-redo"
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
		<button
			class="rail-btn"
			data-testid="nav-settings"
			onclick={() => (showSettings = true)}
			{@attach tooltip('Settings')}
		>
			<Icon name="gear" />
		</button>
		{#if NL_CONFIGURED}
			<!--
				Disabled-looking, but NOT the `disabled` attribute: a disabled button emits no
				pointer events, so the tooltip explaining WHY it's unavailable would never appear.
				aria-disabled keeps it hoverable and announced, and the click is ignored below.
			-->
			<button
				class="rail-btn"
				class:is-disabled={!aiAvailable}
				data-testid="nav-ai"
				aria-disabled={!aiAvailable}
				onclick={() => aiAvailable && (showAi = true)}
				{@attach tooltip(
					aiAvailable ? 'Build/edit a session using AI' : 'AI unavailable'
				)}
			>
				<Icon name="aibot" />
			</button>
		{/if}
		<div class="help-anchor" bind:this={helpAnchor}>
			<button
				class="rail-btn"
				class:hint-halo={helpHint.visible}
				data-testid="nav-help"
				onclick={() => {
                  				  dismissHelpHint();
                  				  checkFile();
                                  showHelpMenu = !showHelpMenu
                  				}
    				    }
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
						data-testid="help-take-tour"
						onclick={() => {
							showHelpMenu = false;
							openPicker();
						}}>Take a tour…</button
					>
					{#if onShowWelcome}
						<button
							type="button"
							role="menuitem"
							data-testid="help-welcome"
							onclick={() => {
								showHelpMenu = false;
								onShowWelcome();
							}}>Welcome screen</button
						>
					{/if}
					{#if exists}
    					<button
    						type="button"
    						role="menuitem"
    						data-testid="open-handbook"
    						onclick={() => {
    							window.open('/handbook.html', '_blank');
    						}}>Open handbook</button
    					>
					{/if}
					<button
						type="button"
						role="menuitem"
						data-testid="help-about"
						onclick={() => {
							showHelpMenu = false;
							showAbout = true;
						}}>About AnCiR</button
					>
				</div>
			{/if}
			{#if helpHint.visible && !showHelpMenu}
				<!-- One-time coach mark for new users, anchored to the ? button. Shown by
				     helpHint.svelte.js when the start screen closes; any engagement (the X,
				     the tour button, or opening Help itself) ends it permanently. -->
				<div class="help-callout" role="status" data-testid="help-callout">
					<button
						type="button"
						class="callout-close"
						aria-label="Dismiss"
						onclick={dismissHelpHint}
					>
						<Icon name="close" width={12} height={12} />
					</button>
					<p class="callout-title">New here?</p>
					<p class="callout-body">Take a tour, or find help and examples here any time.</p>
					<button
						type="button"
						class="callout-cta"
						data-testid="help-callout-tour"
						onclick={() => {
							dismissHelpHint();
							openPicker();
						}}>Take a tour</button
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
{#if NL_CONFIGURED}
	<AiPrompt bind:showModal={showAi} />
{/if}

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

		border-right: 1px solid var(--color-lightness-85);

		z-index: 1000;
	}

	.icon-container {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		gap: var(--space-1);
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
		padding: var(--space-3);
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
	.rail-btn:hover:not(:disabled):not(.is-disabled) {
		background-color: var(--color-lightness-95);
	}
	.rail-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}
	/* Same look as :disabled, but still hoverable so the tooltip can explain why (a real
	   `disabled` button emits no pointer events, so its tooltip never fires). */
	.rail-btn.is-disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	/* Workflow/Workspace form one mutually-exclusive group, visually boxed so the
	   pair reads as "the canvas mode" — distinct from the Data panel toggle. */
	.view-pair {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-1);
		border-radius: var(--radius-lg);
		background-color: var(--color-lightness-97);
	}

	.rail-sep {
		width: 22px;
		height: 1px;
		background-color: var(--color-lightness-85);
		margin: var(--space-2) 0;
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
		border: 1px solid var(--color-lightness-85);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-3);
		padding: var(--space-2);
		display: flex;
		flex-direction: column;
		z-index: 1001;
	}

	.help-menu button {
		margin: 0;
		padding: var(--space-4) var(--space-5);
		border-radius: var(--radius-md);
		text-align: left;
		font-size: var(--font-lg);
		cursor: pointer;
		white-space: nowrap;
		background: transparent;
		border: none;
	}

	.help-menu button:hover {
		background: var(--color-lightness-95);
	}

	/* --- first-run help hint ------------------------------------------------ */
	/* Pulsing halo on the ? button only. The animated shadow spread is ≤ 7px on a
	   ~40px element — cheap. NEVER animate a full-screen-spread shadow (see the
	   tour overlay's perf note: that repaints the whole viewport every frame). */
	.rail-btn.hint-halo {
		animation: hint-halo-pulse 2s ease-in-out infinite;
	}
	@keyframes hint-halo-pulse {
		0%,
		100% {
			box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 55%, transparent);
		}
		50% {
			box-shadow: 0 0 0 7px color-mix(in srgb, var(--color-accent) 18%, transparent);
		}
	}

	/* The coach mark: same visual language as .help-menu (surface card, hairline
	   border, --shadow-3), popped out to the right of the rail beside the ? button. */
	.help-callout {
		position: absolute;
		left: calc(100% + 10px);
		bottom: 0;
		width: 220px;
		padding: var(--space-5);
		background: var(--surface-card);
		border: 1px solid var(--color-lightness-85);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-3);
		z-index: 1001;
	}
	.callout-title {
		margin: 0 0 var(--space-2);
		font-size: var(--font-lg);
		font-weight: 600;
		color: var(--color-lightness-20);
	}
	.callout-body {
		margin: 0 0 var(--space-4);
		font-size: var(--font-sm);
		line-height: 1.4;
		color: var(--color-text-muted);
	}
	.callout-cta {
		margin: 0;
		padding: var(--space-3) var(--space-5);
		background: var(--color-accent-fill);
		color: var(--surface-card);
		border: none;
		border-radius: var(--radius-md);
		font-size: var(--font-md);
		font-weight: 600;
		cursor: pointer;
	}
	.callout-cta:hover,
	.callout-cta:focus-visible {
		background: var(--color-lightness-20);
	}
	.callout-close {
		position: absolute;
		top: var(--space-2);
		right: var(--space-2);
		margin: 0;
		padding: var(--space-2);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	.callout-close:hover {
		background: var(--color-lightness-95);
	}

	@media (prefers-reduced-motion: reduce) {
		.rail-btn.hint-halo {
			animation: none;
			box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 55%, transparent);
		}
	}
</style>
