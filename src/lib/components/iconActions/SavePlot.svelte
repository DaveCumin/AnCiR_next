<script lang="ts">
	import { removePlots } from '$lib/core/Plot.svelte';
	import Dropdown from '$lib/components/reusables/Dropdown.svelte';
	import {
		convertToImage,
		saveMultipleAsImage,
		saveMultipleAsIndividuals,
		saveDataAsCSV
	} from '$lib/components/plotbits/helpers/save.svelte.js';

	let { showDropdown = $bindable(false), dropdownTop = 0, dropdownLeft = 0, Id } = $props();

	let activeSubmenu = $state(null);
	let saveSingleMenuItem = $state<HTMLElement | null>(null);
	let saveIndividualMenuItem = $state<HTMLElement | null>(null);

	// Better direction detection: consider right edge with some margin
	function shouldShowSubmenuOnLeft(mainLeft: number): boolean {
		const viewportWidth = window.innerWidth;
		const mainMenuWidth = 210; // approx width of your dropdown
		const submenuWidth = 160; // a bit more generous than 150
		const safetyMargin = 20;

		const rightEdgeOfMain = mainLeft + mainMenuWidth;
		return rightEdgeOfMain + submenuWidth + safetyMargin > viewportWidth;
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
				class:submenu-left={shouldShowSubmenuOnLeft(dropdownLeft)}
				bind:this={saveSingleMenuItem}
				onmouseenter={() => showSubmenu('save')}
				onmouseleave={() => hideSubmenu('save', 150)}
			>
				<button class="menubutton">
					<span class="label">Save as single image</span>
					<span class="arrow"></span>
				</button>
			</div>

			{#if dropdownActiveSubmenu === 'save' && saveSingleMenuItem}
				{@const rect = saveSingleMenuItem.getBoundingClientRect()}
				{@const showLeft = shouldShowSubmenuOnLeft(dropdownLeft)}
				{@const submenuLeft = showLeft
					? dropdownLeft - 330 // move to the left
					: dropdownLeft + 210}
				<div
					class="submenu-bridge"
					class:bridge-left={showLeft}
					style="top: {rect.top}px; left: {showLeft
						? rect.left - 5
						: rect.right}px; width: 5px; height: {rect.height}px;"
					onmouseenter={() => keepSubmenuOpen('save')}
				></div>
				<div
					class="submenu"
					class:submenu-left={showLeft}
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
				class:submenu-left={shouldShowSubmenuOnLeft(dropdownLeft)}
				bind:this={saveIndividualMenuItem}
				onmouseenter={() => showSubmenu('save-individual')}
				onmouseleave={() => hideSubmenu('save-individual', 150)}
			>
				<button class="menubutton">
					<span class="label">Save as individual plots</span>
					<span class="arrow"></span>
				</button>
			</div>

			{#if dropdownActiveSubmenu === 'save-individual' && saveIndividualMenuItem}
				{@const rect = saveIndividualMenuItem.getBoundingClientRect()}
				{@const showLeft = shouldShowSubmenuOnLeft(dropdownLeft)}
				{@const submenuLeft = showLeft ? dropdownLeft - 330 : dropdownLeft + 210}
				<div
					class="submenu-bridge"
					class:bridge-left={showLeft}
					style="top: {rect.top}px; left: {showLeft
						? rect.left - 5
						: rect.right}px; width: 5px; height: {rect.height}px;"
					onmouseenter={() => keepSubmenuOpen('save-individual')}
				></div>
				<div
					class="submenu"
					class:submenu-left={showLeft}
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
			<!-- Single plot save options (unchanged) -->
			{#each ['svg', 'png'] as type}
				<div
					class="dropdown-action"
					onclick={() => {
						convertToImage('plot' + Id[0], type);
						closeDropdown();
					}}
				>
					<button>Save as {type.toUpperCase()}</button>
				</div>
			{/each}
			<div
				class="dropdown-action"
				onclick={() => {
					saveDataAsCSV(Id[0]);
					closeDropdown();
				}}
			>
				<button>Download data as CSV</button>
			</div>
		{/if}
	{/snippet}
</Dropdown>

<style>
	.dropdown-item {
		padding: 0.6em;
		font-size: 14px;
		cursor: pointer;
		position: relative;
	}

	.dropdown-item:hover {
		background-color: var(--color-lightness-95);
	}

	.menubutton {
		background: transparent;
		border: none;
		font: inherit;
		width: 100%;
		padding: 0;
		text-align: left;
		cursor: pointer;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.arrow {
		width: 0;
		height: 0;
		flex-shrink: 0;
		border-top: 5px solid transparent;
		border-bottom: 5px solid transparent;
	}

	.submenu {
		position: fixed;
		min-width: 150px;
		background: white;
		border-radius: 4px;
		border: 1px solid var(--color-lightness-85);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
		z-index: 1001;
		padding: 4px 0;
	}

	.submenu-left {
		/* Optional: slightly different shadow when on left */
		box-shadow: -2px 4px 12px rgba(0, 0, 0, 0.15);
	}

	.submenu-item {
		display: block;
		width: 100%;
		padding: 0.55em 1em;
		text-align: left;
		background: none;
		border: none;
		font: inherit;
		font-size: 14px;
		cursor: pointer;
	}

	.submenu-item:hover {
		background-color: var(--color-lightness-95);
	}

	.submenu-bridge {
		position: fixed;
		background: transparent;
		z-index: 1002;
	}

	.bridge-left {
		/* optional: can tweak if needed */
	}

	.label {
		flex: 1; /* takes all available space */
		text-align: left;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
