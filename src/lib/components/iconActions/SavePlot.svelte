<script lang="ts">
	import { removePlots } from '$lib/core/Plot.svelte';
	import Dropdown from '$lib/components/reusables/Dropdown.svelte';
	import {
		convertToImage,
		saveMultipleAsImage,
		saveMultipleAsIndividuals
	} from '$lib/components/plotbits/helpers/save.svelte.js';

	let { showDropdown = $bindable(false), dropdownTop = 0, dropdownLeft = 0, Id } = $props();

	let activeSubmenu = $state(null);
	let saveSingleMenuItem = $state(null);
	let saveIndividualMenuItem = $state(null);

	// Calculate submenu direction based on viewport
	function getSubmenuDirection(left: number): 'left' | 'right' {
		const viewportWidth = window.innerWidth;
		const submenuWidth = 150; // Matches min-width in CSS
		return left + 210 + submenuWidth > viewportWidth ? 'left' : 'right';
	}

	$effect(() => {
		if (!showDropdown) {
			activeSubmenu = null;
		}
	});
</script>

<Dropdown bind:showDropdown top={dropdownTop} left={dropdownLeft}>
	{#snippet groups({
		showSubmenu,
		hideSubmenu,
		keepSubmenuOpen,
		activeSubmenu: dropdownActiveSubmenu,
		closeDropdown
	})}
		{#if Array.isArray(Id) && Id.length > 1}
			<!-- Save as single image -->
			<div
				class="dropdown-item has-submenu"
				bind:this={saveSingleMenuItem}
				onmouseenter={() => showSubmenu('save')}
				onmouseleave={() => hideSubmenu('save', 150)}
			>
				<button class="menubutton">Save as single image</button>
			</div>
			{#if dropdownActiveSubmenu === 'save' && saveSingleMenuItem}
				{@const rect = saveSingleMenuItem.getBoundingClientRect()}
				{@const direction = getSubmenuDirection(dropdownLeft)}
				{@const submenuLeft = direction === 'right' ? dropdownLeft + 210 : dropdownLeft - 155}
				<div
					class="submenu-bridge"
					style="top: {rect.top}px; left: {direction === 'right'
						? rect.right
						: rect.left - 5}px; width: 5px; height: {rect.height}px;"
					onmouseenter={() => keepSubmenuOpen('save')}
				></div>
				<div
					class="submenu"
					style="top: {rect.top}px; left: {submenuLeft}px;"
					onmouseenter={() => keepSubmenuOpen('save')}
					onmouseleave={() => hideSubmenu('save', 150)}
				>
					{#each ['svg', 'png'] as type}
						<button
							class="submenu-item"
							onclick={() => {
								saveMultipleAsImage(Id, type);
								closeDropdown();
							}}
						>
							Save as {type.toUpperCase()}
						</button>
					{/each}
				</div>
			{/if}

			<!-- Save as individual plots -->
			<div
				class="dropdown-item has-submenu"
				bind:this={saveIndividualMenuItem}
				onmouseenter={() => showSubmenu('save-individual')}
				onmouseleave={() => hideSubmenu('save-individual', 150)}
			>
				<button class="menubutton">Save as individual plots</button>
			</div>

			{#if dropdownActiveSubmenu === 'save-individual' && saveIndividualMenuItem}
				{@const rect = saveIndividualMenuItem.getBoundingClientRect()}
				{@const direction = getSubmenuDirection(dropdownLeft)}
				{@const submenuLeft = direction === 'right' ? dropdownLeft + 210 : dropdownLeft - 155}
				<div
					class="submenu-bridge"
					style="top: {rect.top}px; left: {direction === 'right'
						? rect.right
						: rect.left - 5}px; width: 5px; height: {rect.height}px;"
					onmouseenter={() => keepSubmenuOpen('save-individual')}
				></div>
				<div
					class="submenu"
					style="top: {rect.top}px; left: {submenuLeft}px;"
					onmouseenter={() => keepSubmenuOpen('save-individual')}
					onmouseleave={() => hideSubmenu('save-individual', 150)}
				>
					{#each ['svg', 'png'] as type}
						<button
							class="submenu-item"
							onclick={() => {
								saveMultipleAsIndividuals(Id, type);
								closeDropdown();
							}}
						>
							{type.toUpperCase()}s
						</button>
					{/each}
				</div>
			{/if}
		{:else}
			<!-- Single plot save options -->
			{#each ['svg', 'png'] as type}
				<div
					class="dropdown-action"
					onclick={() => {
						convertToImage('plot' + Id[0], type);
						closeDropdown();
					}}
				>
					<button>
						Save as {type.toUpperCase()}
					</button>
				</div>
			{/each}
		{/if}
	{/snippet}
</Dropdown>

<style>
	.dropdown-item {
		padding: 0.6em;
		font-size: 14px;
		cursor: pointer;
	}

	.dropdown-item:hover {
		background-color: var(--color-lightness-95);
	}

	.submenu {
		position: fixed;
		min-width: 150px;
		background-color: white;
		border-radius: 4px;
		border: 1px solid var(--color-lightness-85);
		box-shadow:
			0 4px 8px 0 rgba(0, 0, 0, 0.2),
			0 6px 10px 0 rgba(0, 0, 0, 0.1);
		z-index: 1001;
		padding: 0;
	}

	.submenu-item {
		display: block;
		padding: 0.6em;
		cursor: pointer;
		border: none;
		background: transparent;
		text-align: left;
		font: inherit;
		width: 100%;
		font-size: 14px;
	}

	.submenu-item:hover {
		background-color: var(--color-lightness-95);
	}

	.submenu-bridge {
		position: fixed;
		background: transparent;
		z-index: 1002;
		pointer-events: auto;
	}

	.menubutton {
		background-color: transparent;
		border: none;
		text-align: inherit;
		font: inherit;
		border-radius: 0;
		appearance: none;
		cursor: pointer;
		width: 100%;
		padding: 0;
	}
</style>
