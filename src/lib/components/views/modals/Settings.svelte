<script module>
	// @ts-nocheck
	import Modal from '$lib/components/reusables/Modal.svelte';
</script>

<script>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import { appState } from '$lib/core/core.svelte';
	let { showModal = $bindable(false) } = $props();
</script>

<Modal bind:showModal>
	{#snippet header()}
		<div class="heading">
			<h2>Settings</h2>
		</div>
	{/snippet}

	{#snippet children()}
		<p>Grid size: <NumberWithUnits bind:value={appState.gridSize} units={{}} /></p>
	{/snippet}
</Modal>
