<script>
	// @ts-nocheck
	import Dropdown from '$lib/components/reusables/Dropdown.svelte';
	import ImportData, { openImportModal } from '$lib/components/views/modals/ImportData.svelte';
	import SimulateData from '$lib/components/views/modals/SimulateData.svelte';

	let { showDropdown = $bindable(false), dropdownTop = 0, dropdownLeft = 0 } = $props();
	let showSimulateModal = $state(false);

	$inspect(showSimulateModal);
</script>

<Dropdown bind:showDropdown top={dropdownTop} left={dropdownLeft}>
	{#snippet groups()}
		<div class="dropdown-action">
			<button onclick={openImportModal}> Import Data </button>
		</div>

		<div class="dropdown-action">
			<button
				onclick={() => {
					console.log('trying');
					showSimulateModal = true;
				}}
			>
				Simulate Data
			</button>
		</div>
	{/snippet}
</Dropdown>

<ImportData />
<SimulateData bind:showModal={showSimulateModal} />

<style>
</style>
