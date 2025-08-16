<script>
	// @ts-nocheck
	import Dropdown from '$lib/components/reusables/Dropdown.svelte';
	import { core } from '$lib/core/core.svelte';
	import { removePlot } from '$lib/core/Plot.svelte';
	import {
		convertToImage,
		saveMultipleAsImage
	} from '$lib/components/plotbits/helpers/save.svelte.js';

	let {
		showDropdown = $bindable(false),
		dropdownTop = 0,
		dropdownLeft = 0,
		plotId = $bindable(null)
	} = $props();

	let saveMenuItem = $state();
	let activeSubmenu = $state(null);

	function handleSaveAction(type, closeDropdown) {
		convertToImage('plot' + plotId, type);

		closeDropdown();
	}

	function handleDeleteAction(closeDropdown) {
		removePlot(plotId);
		closeDropdown();
	}

	// Clean up when dropdown closes
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
		<!-- Save option with submenu -->
		<div
			class="dropdown-item has-submenu"
			bind:this={saveMenuItem}
			onmouseenter={() => showSubmenu('save')}
			onmouseleave={() => hideSubmenu('save', 150)}
		>
			<button>Save</button>
		</div>

		<!-- Delete option -->
		<div
			class="dropdown-item"
			onclick={() => handleDeleteAction(closeDropdown)}
			onmouseenter={() => hideSubmenu('save', 0)}
		>
			<button>Delete</button>
		</div>

		<!-- Submenu for Save -->
		{#if dropdownActiveSubmenu === 'save' && saveMenuItem}
			{@const position = { top: saveMenuItem.offsetTop, left: saveMenuItem.offsetLeft }}
			<!-- Bridge element to cover gap -->
			<div
				class="submenu-bridge"
				style="top: {dropdownTop + 6}px; left: {dropdownLeft +
					210}px; width: 5px; height: {saveMenuItem.getBoundingClientRect().height}px;"
				onmouseenter={() => keepSubmenuOpen('save')}
			></div>
			<div
				class="submenu"
				style="top: {dropdownTop + 6}px; left: {dropdownLeft + 210}px;"
				onmouseenter={() => keepSubmenuOpen('save')}
				onmouseleave={() => hideSubmenu('save', 150)}
			>
				{#each ['svg', 'png'] as type}
					<button class="submenu-item" onclick={() => handleSaveAction(type, closeDropdown)}>
						{type.toUpperCase()}
					</button>
				{/each}
			</div>
		{/if}
	{/snippet}
</Dropdown>

<style>
	button {
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

	.submenu-bridge {
		position: fixed;
		background: transparent;
		z-index: 1002; /* Above dialog and submenu */
		pointer-events: auto;
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
		z-index: 1001; /* Above dialog */
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
</style>
