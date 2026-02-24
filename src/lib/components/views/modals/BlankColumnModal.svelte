<script module>
	// @ts-nocheck
	import Modal from '$lib/components/reusables/Modal.svelte';
	import BlankColumn from '$lib/tableProcesses/BlankColumn.svelte';
	import { core, appConsts } from '$lib/core/core.svelte';
	import { Table } from '$lib/core/Table.svelte';
	import { TableProcess } from '$lib/core/TableProcess.svelte';
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
		Array.from(appConsts.tableProcessMap.get('BlankColumn').defaults.entries()).map(
			([key, value]) => {
				if (key === 'out') {
					return ['out', processNested(value)];
				}
				return [key, value.val];
			}
		)
	);
	function confirmAddColumn() {
		core.tables.push(new Table());
		core.tables[core.tables.length - 1].name = 'Blank_' + core.tables[core.tables.length - 1].id;
		const tb = new TableProcess(
			{ name: 'BlankColumn', args: p.args },
			core.tables[core.tables.length - 1]
		);

		core.tables[core.tables.length - 1].processes.push(tb);

		showModal = false;
	}
</script>

<Modal bind:showModal>
	{#snippet header()}
		<div class="heading">
			<h2>Blank Column</h2>
		</div>
	{/snippet}

	{#snippet children()}
		<BlankColumn bind:p />
	{/snippet}

	{#snippet button()}
		{#if p.args.valid}
			<div class="dialog-button-container">
				<button class="dialog-button" onclick={confirmAddColumn}>Add these data</button>
			</div>
		{/if}
	{/snippet}
</Modal>
