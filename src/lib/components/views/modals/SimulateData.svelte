<script module>
	// @ts-nocheck
	import Modal from '$lib/components/reusables/Modal.svelte';
	import SimulatedData from '$lib/tableProcesses/SimulatedData.svelte';
	import { core, appConsts } from '$lib/core/core.svelte';
	import { Table } from '$lib/core/Table.svelte';
	import { TableProcess } from '$lib/core/TableProcess.svelte';

	let showSimulateModal = $state(false);

	export function openSimulateModal() {
		showSimulateModal = true;
	}
</script>

<script>
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
	console.log('p.args', $state.snapshot(p.args));
	function confirmAddColumn() {
		//make new table
		core.tables.push(new Table());
		core.tables[core.tables.length - 1].name =
			'Simulated_' + core.tables[core.tables.length - 1].id;
		//make new table process
		const tb = new TableProcess(
			{ name: 'SimulatedData', args: p.args },
			core.tables[core.tables.length - 1]
		);
		core.tables[core.tables.length - 1].processes.push(tb);
		showSimulateModal = false;
	}
</script>

<Modal bind:showModal={showSimulateModal}>
	{#snippet header()}
		<div class="heading">
			<h2>Simulate Data</h2>
		</div>
	{/snippet}

	{#snippet children()}
		<SimulatedData bind:p />
		<div><button onclick={confirmAddColumn}>Add these data</button></div>
	{/snippet}
</Modal>
