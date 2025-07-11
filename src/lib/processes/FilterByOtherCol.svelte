<script module>
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';
	import { core } from '$lib/core/core.svelte';

	export function filterbyothercol(x, args) {
		console.log('filterbyothercol args: ', $state.snapshot(args));
		const byColId = args.byColId;
		if (byColId == -1) return x;

		const byColValue = args.byColValue;
		const byColData = getColumnById(byColId).getData();
		console.log(
			'filtering on col ',
			byColId,
			'; ',
			core.data[byColId].name,
			'; byColData = ',
			byColData.splice(0, 5),
			'...'
		);

		let out = [];
		for (let i = 0; i < byColData.length; i++) {
			if (byColData[i] == byColValue) {
				out.push(x[i]);
			} else {
				out.push(undefined);
			}
		}
		return out;
	}

	export const filterbyothercol_defaults = new Map([
		['byColId', { val: -1 }],
		['byColValue', { val: 0 }]
	]);
</script>

<script>
	let { p = $bindable() } = $props();
</script>

<p>{p.processid} - {p.name}</p>
<p>
	<!-- TODO: Do we really want to exclude the current column (and reference), per below? -->
	If <ColumnSelector
		bind:value={p.args.byColId}
		excludeColIds={[p.parentCol.columnID, p.parentCol.refDataID]}
	/> is
	{#if p.parentCol.type == 'string'}
		<input type="text" bind:value={p.args.byColValue} />
	{:else}
		<input type="number" bind:value={p.args.byColValue} />
	{/if}
</p>
