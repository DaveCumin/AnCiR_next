<script>
	// @ts-nocheck
	import Dropdown from '$lib/components/reusables/Dropdown.svelte';
	import ImportData, { openImportModal } from '$lib/components/views/modals/ImportData.svelte';
	import SimulateData from '$lib/components/views/modals/SimulateData.svelte';

	let { showDropdown = $bindable(false), dropdownTop = 0, dropdownLeft = 0 } = $props();
	let showSimulateModal = $state(false);
</script>

<Dropdown bind:showDropdown top={dropdownTop} left={dropdownLeft}>
	{#snippet groups()}
		<div class="dropdown-action">
			<button onclick={openImportModal}> Import Data </button>
		</div>

		<div
			class="dropdown-action"
			onclick={() => {
				showSimulateModal = true;
			}}
		>
			<button> Simulate Data </button>
		</div>
	{/snippet}
</Dropdown>

<ImportData />
<SimulateData bind:showModal={showSimulateModal} />

<style>
</style>
