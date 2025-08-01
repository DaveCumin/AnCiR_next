<script>
	import { appConsts, appState } from '$lib/core/core.svelte';
	import Dropdown from '$lib/components/reusables/Dropdown.svelte';

	let { onSelect = () => {} } = $props();

	let showDropdown = $state(false);
	let dropdownLabel = $state();
	let listPos = $state({ left: 0, top: 0 });

	function openList() {
		const labelPos = dropdownLabel.getBoundingClientRect();
		listPos = { left: labelPos.left, top: labelPos.top };
		showDropdown = true;
		window.addEventListener('resize', recalculateDropdownPosition);
	}
	function recalculateDropdownPosition() {
		if (!dropdownLabel) return;
		const labelPos = dropdownLabel.getBoundingClientRect();
		listPos = { left: labelPos.left, top: labelPos.top };
	}
</script>

<div>
	Current palette: {@html appState.appColours
		.map(
			(c) =>
				`<div style=" display: inline-block; background:${c}; width:15px; height:15px; border-radius:2px;"></div>`
		)
		.join(' ')}
</div>
<div onclick={(e) => openList()} bind:this={dropdownLabel}>Select palette</div>
<Dropdown bind:showDropdown top={listPos.top} left={listPos.left - 10}>
	{#snippet groups()}
		{#each Object.keys(appConsts.colourPalettes) as palette}
			{@const cols = appConsts.colourPalettes[palette]
				.map(
					(c) =>
						`<div style=" display: inline-block; background:${c}; width:15px; height:15px; border-radius:2px;"></div>`
				)
				.join(' ')}
			<div class="action">
				<button onclick={(e) => onSelect(palette)}
					><div style="width:4em; text-align:right;">{palette}:</div>
					{@html cols}
				</button>
			</div>
		{/each}
	{/snippet}
</Dropdown>

<style>
	.action button {
		margin: 0.6em;
		font-size: 14px;
	}
	button {
		background-color: transparent;
		border: none;
		text-align: inherit;
		font: inherit;
		border-radius: 0;
		appearance: none;
		display: flex;
		align-items: center;
		gap: 4px;
		cursor: pointer;
	}
</style>
