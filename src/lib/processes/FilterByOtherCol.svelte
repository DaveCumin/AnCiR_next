<script module>
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import { getColumnById } from '$lib/core/column.svelte';

	export function filterbyothercol(x, args) {
		const byColId = args.byColId;
		if (byColId == -1) return x;

		console.log('here ... ', byColId);
		const byColValue = args.byColValue;
		const byColData = getColumnById(byColId).getData();
		return x.filter((x, i) => byColData[i] == byColValue);
	}

	export const filterbyothercol_defaults = new Map([
		['byColId', { val: -1 }],
		['byColValue', { val: 0 }]
	]);
</script>

<script>
	let { p = $bindable() } = $props();
</script>

<p>
	If <ColumnSelector bind:value={p.args.byColId} excludeColIds={[p.parentCol.columnID]} /> is
	<input type="text" bind:value={p.args.byColValue} />
</p>
