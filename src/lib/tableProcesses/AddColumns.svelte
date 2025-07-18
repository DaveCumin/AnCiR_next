<script module>
	export const addcolumns_defaults = new Map([
		['xsIN', { val: [] }],
		['out', { out: { val: -1 } }],
		['valid', { val: false }]
	]);
</script>

<script>
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';

	let { p = $bindable() } = $props();

	function addcolumns() {
		p.args.out.out = getColumnById(p.args.xsIN[0]).getData();
		for (let i = 1; i < p.args.xsIN.length; i++) {
			console.log('ADDCOLS... ', i, p.args.xsIN[i]);
			const temp = getColumnById(p.args.xsIN[i]).getData();
			p.args.out.out = p.args.out.out.map((x, i) => x + temp[i]);
		}
		if (p.args.out.out.length > 0) {
			p.args.valid = true;
		} else {
			p.args.valid = false;
		}
	}

	let choice = $state(-1);
</script>

<p>Add:</p>
{#each p.args.xsIN as colIN, i}
	<ColumnSelector
		bind:value={p.args.xsIN[i]}
		onChange={() => {
			addcolumns();
		}}
	/>
{/each}
Add new: <ColumnSelector
	bind:value={choice}
	onChange={(value) => {
		p.args.xsIN.push(Number(value));
		addcolumns();
		choice = -1;
	}}
/>
<p>Preview:</p>
<p>X: {p.args.out.out}</p>
