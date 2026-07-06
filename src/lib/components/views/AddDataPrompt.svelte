<script>
	// @ts-nocheck
	// Centered "Click here to add data" empty-state prompt, shared by the
	// workflow canvas (WorkflowEditor) and the worksheet (PlotDisplay). It
	// renders an inviting call-to-action that opens a compact chooser with the
	// three real ways to get data into AnCiR:
	//   · Import a file (CSV / Excel / AWD) — re-wires the ImportData modal
	//     via the dataSourceActions registry (single instance lives in +page).
	//   · Simulate data — spawns a SimulatedData NODE on the workflow canvas
	//     (in place when hosted there; the worksheet hops to the canvas first).
	//   · Load an example or saved session — owns a LoadSessionModal instance
	//     opened on the Examples tab.
	import Icon from '$lib/icons/Icon.svelte';
	import LoadSessionModal from '$lib/components/workflow/LoadSessionModal.svelte';
	import { openImportData } from '$lib/core/dataSourceActions.js';
	import { appState } from '$lib/core/core.svelte.js';

	// `onSimulate`, when provided (workflow canvas), spawns a Simulate Data NODE
	// directly in place. When unset (the worksheet), simulate switches to the
	// workflow view and asks WorkflowEditor to spawn the node there — there is no
	// modal anywhere anymore.
	let { message = 'Click here to add data', onSimulate = null } = $props();

	let open = $state(false);
	let showLoad = $state(false);

	// Worksheet default: hop to the workflow canvas and request a SimulatedData
	// node (WorkflowEditor consumes appState.spawnNodeRequest once, then clears it).
	function requestSimulatedNode() {
		appState.view = 'canvas';
		appState.spawnNodeRequest = {
			tpType: 'SimulatedData',
			n: (appState.spawnNodeRequest?.n ?? 0) + 1
		};
		appState.showControlPanel = true;
	}

	const choices = [
		{
			key: 'import',
			icon: 'add-file',
			title: 'Import a file',
			subtitle: 'CSV, XLS, or AWD from your computer or a URL',
			action: () => openImportData()
		},
		{
			key: 'simulate',
			icon: 'node-rectangular-wave',
			title: 'Simulate data',
			subtitle: 'Generate rhythmic test data to explore',
			action: () => (onSimulate ? onSimulate() : requestSimulatedNode())
		},
		{
			key: 'example',
			icon: 'sessionload',
			title: 'Load an example',
			subtitle: 'Start from a worked example or saved session',
			action: () => (showLoad = true)
		}
	];

	function pick(choice) {
		open = false;
		choice.action();
	}

	function closeOnClickAway(node) {
		function handler(e) {
			if (!node.contains(e.target)) open = false;
		}
		document.addEventListener('pointerdown', handler, true);
		return {
			destroy() {
				document.removeEventListener('pointerdown', handler, true);
			}
		};
	}
</script>

<div class="add-data-overlay">
	<div class="add-data-anchor" use:closeOnClickAway>
		<button
			type="button"
			class="add-data-cta icon"
			class:open
			onclick={() => (open = !open)}
			aria-haspopup="menu"
			aria-expanded={open}
		>
			<span class="add-data-cta-icon"><Icon name="add" width={24} height={24} /></span>
			<span class="add-data-cta-text">{message}</span>
		</button>

		{#if open}
			<div class="add-data-menu" role="menu">
				{#each choices as choice (choice.key)}
					<button type="button" class="add-data-choice" role="menuitem" onclick={() => pick(choice)}>
						<span class="add-data-choice-icon"><Icon name={choice.icon} width={22} height={22} /></span>
						<span class="add-data-choice-text">
							<span class="add-data-choice-title">{choice.title}</span>
							<span class="add-data-choice-subtitle">{choice.subtitle}</span>
						</span>
					</button>
				{/each}
			</div>
		{/if}
	</div>
</div>

<LoadSessionModal bind:showModal={showLoad} initialSourceMode="example" />

<style>
	/* Fills the host viewport and centres the CTA; transparent to pointer events
	   except the CTA/menu itself so canvas panning still works behind it. */
	.add-data-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		pointer-events: none;
		z-index: 25;
	}

	.add-data-anchor {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		pointer-events: auto;
	}

	/* Match the worksheet "Click here to add a plot" prompt: an icon button next
	   to bold muted text, centred. Keeps the two empty-states visually identical. */
	.add-data-cta {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 10px;
		padding: 0;
		background: transparent;
		border: none;
		cursor: pointer;
		font-weight: 600;
		color: var(--color-lightness-75);
		transition: color 0.18s ease;
	}

	.add-data-cta:hover,
	.add-data-cta.open {
		color: var(--color-accent);
	}

	.add-data-cta-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.add-data-menu {
		position: absolute;
		top: calc(100% + 10px);
		left: 50%;
		transform: translateX(-50%);
		min-width: 320px;
		max-width: 360px;
		background: var(--surface-card);
		border: 1px solid var(--color-lightness-80);
		border-radius: 10px;
		box-shadow: var(--shadow-3);
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		z-index: 1;
	}

	.add-data-choice {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: var(--space-5);
		width: 100%;
		padding: var(--space-4) var(--space-5);
		border: 1px solid transparent;
		border-radius: var(--radius-lg);
		background: var(--surface-card);
		text-align: left;
		cursor: pointer;
		transition:
			background 0.15s ease,
			border-color 0.15s ease;
	}

	.add-data-choice:hover {
		background: var(--color-lightness-95);
		border-color: var(--color-lightness-85);
	}

	.add-data-choice-icon {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		border-radius: var(--radius-lg);
		background: var(--color-lightness-97);
		color: var(--color-lightness-35);
	}

	.add-data-choice:hover .add-data-choice-icon {
		color: var(--color-accent);
	}

	.add-data-choice-text {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}

	.add-data-choice-title {
		font-size: 0.92rem;
		font-weight: 600;
		color: var(--color-lightness-20);
	}

	.add-data-choice-subtitle {
		font-size: 0.76rem;
		color: var(--color-text-muted);
	}
</style>
