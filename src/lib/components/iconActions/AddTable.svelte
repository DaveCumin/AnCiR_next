<script>
	// @ts-nocheck
	import Dropdown from '$lib/components/reusables/Dropdown.svelte';
	import ImportData, { openImportModal } from '$lib/components/views/modals/ImportData.svelte';
	import SimulateData from '$lib/components/views/modals/SimulateData.svelte';
	import SequenceColumnModal from '$lib/components/views/modals/SequenceColumnModal.svelte';
	import BlankColumnModal from '$lib/components/views/modals/BlankColumnModal.svelte';

	let { showDropdown = $bindable(false), dropdownTop = 0, dropdownLeft = 0 } = $props();
	let showSimulateModal = $state(false);
	let showSequenceModal = $state(false);
	let showBlankModal = $state(false);
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

		<div
			class="dropdown-action"
			onclick={() => {
				showSequenceModal = true;
			}}
		>
			<button> Sequence Column </button>
		</div>

		<div
			class="dropdown-action"
			onclick={() => {
				showBlankModal = true;
			}}
		>
			<button> Blank Column </button>
		</div>
	{/snippet}
</Dropdown>

<ImportData />
<SimulateData bind:showModal={showSimulateModal} />
<SequenceColumnModal bind:showModal={showSequenceModal} />
<BlankColumnModal bind:showModal={showBlankModal} />

<style>
</style>
