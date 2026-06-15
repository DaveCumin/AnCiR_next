<script module>
	// @ts-nocheck
	import Modal from '$lib/components/reusables/Modal.svelte';
	import SimulatedData from '$lib/tableProcesses/SimulatedData.svelte';
	import { appConsts } from '$lib/core/core.svelte';
	import { mutationService } from '$lib/core/mutationService.js';
</script>

<script>
	let { showModal = $bindable(false) } = $props();
	function processNested(obj) {
		const result = {};
		for (const [key, value] of Object.entries(obj)) {
			result[key] = value.val !== undefined ? value.val : processNested(value);
		}
		return result;
	}
	let p = $state({});
	p.args = Object.fromEntries(
		Array.from(appConsts.tableProcessMap.get('SimulatedData').defaults.entries()).map(
			([key, value]) => {
				if (key === 'out') {
					return ['out', processNested(value)];
				}
				return [key, value.val];
			}
		)
	);
	// console.log('p.args', $state.snapshot(p.args));
	function confirmAddColumn() {
		const table = mutationService.addTable({});
		// Name is derived from the assigned id; direct mutation is acceptable cosmetic state.
		table.name = 'Simulated_' + table.id;
		mutationService.addTableProcess(table.id, 'SimulatedData', p.args);
		showModal = false;
	}
</script>

<Modal bind:showModal>
	{#snippet header()}
		<div class="heading">
			<h2>Simulate Data</h2>
		</div>
	{/snippet}

	{#snippet children()}
		<SimulatedData bind:p />
	{/snippet}

	{#snippet button()}
		<div class="dialog-button-container">
			<button class="dialog-button" onclick={confirmAddColumn}>Add these data</button>
		</div>
	{/snippet}
</Modal>
