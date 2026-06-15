<script>
	// @ts-nocheck
	// Floating add-node palette in the top-right of the canvas (flowtest-inspired).
	// Reuses the existing creation modals for the user-visible flows; each entry
	// just opens the right modal.
	import Icon from '$lib/icons/Icon.svelte';
	import MakeNewPlot from '$lib/components/views/modals/MakeNewPlot.svelte';
	import SimulateData from '$lib/components/views/modals/SimulateData.svelte';
	import BlankColumnModal from '$lib/components/views/modals/BlankColumnModal.svelte';
	import SequenceColumnModal from '$lib/components/views/modals/SequenceColumnModal.svelte';

	let showMenu = $state(false);
	let showAddPlotModal = $state(false);
	let showSimulateModal = $state(false);
	let showBlankModal = $state(false);
	let showSequenceModal = $state(false);

	function pick(action) {
		showMenu = false;
		action();
	}

	function closeOnClickAway(node) {
		function handler(e) {
			if (!node.contains(e.target)) showMenu = false;
		}
		document.addEventListener('pointerdown', handler, true);
		return {
			destroy() {
				document.removeEventListener('pointerdown', handler, true);
			}
		};
	}
</script>

<div class="np-anchor" use:closeOnClickAway>
	<button
		type="button"
		class="np-btn np-trigger"
		class:open={showMenu}
		onclick={() => (showMenu = !showMenu)}
		title="Add to canvas"
		aria-label="Add node"
	>
		<Icon name="plus" width={22} height={22} />
	</button>

	{#if showMenu}
		<div class="np-menu" role="menu">
			<button
				type="button"
				class="np-item"
				role="menuitem"
				onclick={() => pick(() => (showAddPlotModal = true))}
			>
				<span class="np-item-title">Add plot</span>
				<span class="np-item-sub">Choose plot type + columns</span>
			</button>
			<button
				type="button"
				class="np-item"
				role="menuitem"
				onclick={() => pick(() => (showSimulateModal = true))}
			>
				<span class="np-item-title">Simulate data</span>
				<span class="np-item-sub">Cosine + noise model</span>
			</button>
			<button
				type="button"
				class="np-item"
				role="menuitem"
				onclick={() => pick(() => (showBlankModal = true))}
			>
				<span class="np-item-title">Add blank table</span>
				<span class="np-item-sub">Empty table for manual entry</span>
			</button>
			<button
				type="button"
				class="np-item"
				role="menuitem"
				onclick={() => pick(() => (showSequenceModal = true))}
			>
				<span class="np-item-title">Sequence column</span>
				<span class="np-item-sub">Numeric/time sequence generator</span>
			</button>
		</div>
	{/if}
</div>

<MakeNewPlot bind:showModal={showAddPlotModal} />
<SimulateData bind:showModal={showSimulateModal} />
<BlankColumnModal bind:showModal={showBlankModal} />
<SequenceColumnModal bind:showModal={showSequenceModal} />

<style>
	.np-anchor {
		position: absolute;
		top: 12px;
		right: 12px;
		z-index: 30;
		pointer-events: auto;
	}

	.np-btn {
		width: 38px;
		height: 38px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: rgba(255, 255, 255, 0.9);
		border: 1px solid var(--color-lightness-85, #e6e6e6);
		border-radius: 8px;
		cursor: pointer;
		color: var(--color-lightness-35, #555);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
		transition:
			background 0.12s ease,
			border-color 0.12s ease,
			transform 0.12s ease;
		padding: 0;
	}

	.np-btn:hover {
		background: #fff;
		border-color: var(--color-lightness-70, #c5c5c5);
		color: var(--color-lightness-20, #333);
	}

	.np-trigger.open {
		transform: rotate(45deg);
		background: var(--color-accent, #4d9fe3);
		color: #fff;
		border-color: var(--color-accent, #4d9fe3);
	}

	.np-menu {
		position: absolute;
		top: 46px;
		right: 0;
		min-width: 200px;
		background: #fff;
		border: 1px solid var(--color-lightness-80, #ccc);
		border-radius: 8px;
		box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
		padding: 4px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.np-item {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		text-align: left;
		gap: 2px;
		padding: 6px 10px;
		border: none;
		background: transparent;
		border-radius: 5px;
		cursor: pointer;
		color: var(--color-lightness-25, #333);
		font-size: 13px;
	}

	.np-item:hover {
		background: var(--color-lightness-95, #f1f1f1);
	}

	.np-item-title {
		font-weight: 600;
	}

	.np-item-sub {
		font-size: 11px;
		color: var(--color-lightness-50, #888);
	}
</style>
