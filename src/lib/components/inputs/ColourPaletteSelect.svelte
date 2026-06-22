<script>
	import { appConsts, appState } from '$lib/core/core.svelte';
	import Dropdown from '$lib/components/reusables/Dropdown.svelte';

	let { onSelect = () => {} } = $props();

	let showDropdown = $state(false);
	let dropdownLabel = $state();
	let listPos = $state({ left: 0, top: 0 });

	function openList() {
		const labelPos = dropdownLabel.getBoundingClientRect();
		listPos = { left: labelPos.left, top: labelPos.bottom };
		showDropdown = true;
		window.addEventListener('resize', recalculateDropdownPosition);
	}
	function recalculateDropdownPosition() {
		if (!dropdownLabel) return;
		const labelPos = dropdownLabel.getBoundingClientRect();
		listPos = { left: labelPos.left, top: labelPos.bottom };
	}

	function swatches(cols) {
		return cols
			.map((c) => `<span class="palette-swatch" style="background:${c};" title="${c}"></span>`)
			.join('');
	}
</script>

<div class="palette-control">
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- colours are app constants -->
	<div class="palette-swatches">{@html swatches(appState.appColours)}</div>
	<button type="button" class="palette-trigger" onclick={openList} bind:this={dropdownLabel}>
		Change<span class="palette-caret" aria-hidden="true">▾</span>
	</button>
</div>

<Dropdown bind:showDropdown top={listPos.top} left={listPos.left - 10}>
	{#snippet groups()}
		{#each Object.keys(appConsts.colourPalettes) as palette (palette)}
			<button type="button" class="palette-option" onclick={() => onSelect(palette)}>
				<span class="palette-option-name">{palette}</span>
				<span class="palette-swatches">{@html swatches(appConsts.colourPalettes[palette])}</span>
			</button>
		{/each}
	{/snippet}
</Dropdown>

<style>
	.palette-control {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.palette-swatches {
		display: flex;
		flex-wrap: wrap;
		gap: 3px;
	}

	/* Swatches are injected via {@html}, so target them globally within this
	   component's scoped wrappers. */
	.palette-swatches :global(.palette-swatch) {
		display: inline-block;
		width: 14px;
		height: 14px;
		border-radius: var(--radius-sm);
		box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
	}

	.palette-trigger {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font: inherit;
		font-size: var(--font-md);
		cursor: pointer;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--divider);
		border-radius: var(--radius-md);
		background: var(--surface-card);
		color: var(--color-lightness-35);
		transition:
			border-color 0.15s,
			background 0.15s;
	}
	.palette-trigger:hover {
		border-color: var(--color-lightness-75);
		background: var(--color-lightness-97);
	}
	.palette-caret {
		font-size: 0.8em;
		color: var(--color-lightness-50);
	}

	.palette-option {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		width: 100%;
		padding: var(--space-3);
		border: none;
		background: transparent;
		font: inherit;
		font-size: var(--font-sm);
		text-align: left;
		cursor: pointer;
	}
	.palette-option:hover {
		background: var(--color-lightness-95);
	}
	.palette-option-name {
		color: var(--color-lightness-35);
		text-transform: capitalize;
	}
</style>
