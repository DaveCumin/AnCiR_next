<script>
	// @ts-nocheck
	import Dropdown from '$lib/components/reusables/Dropdown.svelte';
	import ImportData, {
		openImportModal,
		openImportModalWithUrl
	} from '$lib/components/views/modals/ImportData.svelte';
	import SimulateData from '$lib/components/views/modals/SimulateData.svelte';
	import SequenceColumnModal from '$lib/components/views/modals/SequenceColumnModal.svelte';
	import BlankColumnModal from '$lib/components/views/modals/BlankColumnModal.svelte';

	let { showDropdown = $bindable(false), dropdownTop = 0, dropdownLeft = 0 } = $props();
	let showSimulateModal = $state(false);
	let showSequenceModal = $state(false);
	let showBlankModal = $state(false);

	let exampleMenuItem = $state();

	const exampleDatasets = [
		{
			name: 'Simple period and amplitude change',
			url: 'https://raw.githubusercontent.com/DaveCumin/AnCiR_next/refs/heads/main/test/testData.csv'
		},
		{
			name: 'Simulated data used in example session',
			url: 'https://raw.githubusercontent.com/DaveCumin/AnCiR_next/refs/heads/main/test/simulated.csv'
		}
	];
</script>

<Dropdown bind:showDropdown top={dropdownTop} left={dropdownLeft}>
	{#snippet groups({ showSubmenu, hideSubmenu, keepSubmenuOpen, activeSubmenu, closeDropdown })}
		<div class="dropdown-action" onmouseenter={() => hideSubmenu('examples', 0)}>
			<button onclick={openImportModal}> Import Data </button>
		</div>

		<div
			class="dropdown-action"
			onmouseenter={() => hideSubmenu('examples', 0)}
			onclick={() => {
				showSimulateModal = true;
			}}
		>
			<button> Simulate Data </button>
		</div>

		<div
			class="dropdown-item has-submenu"
			bind:this={exampleMenuItem}
			onmouseenter={() => showSubmenu('examples')}
			onmouseleave={() => hideSubmenu('examples', 150)}
		>
			<button class="menubutton">Use example dataset</button>
		</div>

		{#if activeSubmenu === 'examples' && exampleMenuItem}
			<div
				class="submenu-bridge"
				style="top: {dropdownTop + exampleMenuItem.offsetTop + 6}px; left: {dropdownLeft +
					200}px; width: 5px; height: {exampleMenuItem.getBoundingClientRect().height}px;"
				onmouseenter={() => keepSubmenuOpen('examples')}
			></div>
			<div
				class="submenu"
				style="top: {dropdownTop + exampleMenuItem.offsetTop + 6}px; left: {dropdownLeft + 205}px;"
				onmouseenter={() => keepSubmenuOpen('examples')}
				onmouseleave={() => hideSubmenu('examples', 150)}
			>
				{#each exampleDatasets as dataset}
					<button
						class="submenu-item"
						onclick={() => {
							closeDropdown();
							openImportModalWithUrl(dataset.url);
						}}
					>
						{dataset.name}
					</button>
				{/each}
			</div>
		{/if}
	{/snippet}
</Dropdown>

<ImportData />
<SimulateData bind:showModal={showSimulateModal} />
<SequenceColumnModal bind:showModal={showSequenceModal} />
<BlankColumnModal bind:showModal={showBlankModal} />

<style>
	.submenu-bridge {
		position: fixed;
		background: transparent;
		z-index: 1002;
		pointer-events: auto;
	}

	.submenu {
		position: fixed;
		min-width: 220px;
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

	.menubutton {
		background: transparent;
		border: none;
		font: inherit;
		padding: 0;
		text-align: left;
		cursor: pointer;
		margin-left: 0.5rem;
	}
</style>
