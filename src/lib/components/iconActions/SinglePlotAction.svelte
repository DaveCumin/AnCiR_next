<script>
	// @ts-nocheck
	import Dropdown from '$lib/components/reusables/Dropdown.svelte';
	import { core } from '$lib/core/core.svelte';
	import { removePlot } from '$lib/core/Plot.svelte';
	import { convertToImage, saveMultipleAsImage } from '$lib/components/plotbits/helpers/save.js';

	let {
		showDropdown = $bindable(false),
		dropdownTop = 0,
		dropdownLeft = 0,
		plotId = $bindable(null)
	} = $props();

	function handleSaveAction(type) {
		const Id = 'plot' + plotId;
		if (Id.length > 0) {
			saveMultipleAsImage(Id, type);
		} else {
			convertToImage(Id, type);
		}
		showDropdown = false;
	}

	function handleDeleteAction() {
		removePlot(plotId);
		showDropdown = false;
	}
</script>

<Dropdown bind:showDropdown top={dropdownTop} left={dropdownLeft}>
	{#snippet groups({ showSubmenu, hideSubmenu, keepSubmenuOpen, activeSubmenu, closeDropdown })}
		<!-- Save option with submenu -->
		<div
			class="dropdown-item has-submenu"
			onmouseenter={() => showSubmenu('save')}
			onmouseleave={() => hideSubmenu('save')}
		>
			<button>Save</button>

			{#if activeSubmenu === 'save'}
				<div
					style="top:{dropdownTop + 5``}px; left:{dropdownLeft + 200}px;"
					class="submenu"
					onmouseenter={() => keepSubmenuOpen('save')}
					onmouseleave={() => hideSubmenu('save', 100)}
				>
					{#each ['svg', 'png', 'jpeg'] as type}
						<div class="dropdown-item" onclick={handleSaveAction}>
							<button>
								{type.toUpperCase()}
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Delete option -->
		<div class="dropdown-item" onclick={handleDeleteAction}>
			<button>Delete</button>
		</div>
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
</style>
