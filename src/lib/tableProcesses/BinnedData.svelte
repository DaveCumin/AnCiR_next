<script module>
	export const binneddata_defaults = new Map([
		['xIN', { val: -1 }, 'yIN', { val: -1 }, 'binSize', { val: 0.25 }, 'binStart', { val: 0 }]
	]);
</script>

<script>
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import { binData } from '$lib/components/plotbits/helpers/wrangleData.js';
	import ColumnComponent from '$lib/core/Column.svelte';
	import { Column, getColumnByID } from '$lib/core/Column.svelte';
	import { core } from '$lib/core/core.svelte.js';

	import { onMount } from 'svelte';

	let { p = $bindable(), tableID = 0 } = $props();

	let outX = new Column({ tableProcessed: true, name: 'binned X', type: 'number', data: [] });
	let outY = new Column({ tableProcessed: true, name: 'binned Y', type: 'number', data: [] });

	let binneddata = $derived.by(() => {
		const xIN = p.args.xIN;
		const yIN = p.args.yIN;
		const binSize = p.args.binSize;
		const binStart = p.args.binStart;
		if (
			xIN == undefined ||
			yIN == undefined ||
			binSize == undefined ||
			binStart == undefined ||
			xIN === -1 ||
			yIN === -1 ||
			binSize === 0
		) {
			return { bins: [], y_out: [] };
		}

		const theBinnedData = binData(
			core.data[xIN].hoursSinceStart,
			core.data[yIN].getData(),
			binSize,
			binStart
		);

		getColumnByID(outX.id).data = theBinnedData.bins;
		getColumnByID(outY.id).data = theBinnedData.y_out;

		return theBinnedData;
	});

	onMount(() => {
		//put the columns into the core data
		core.data.push(outX);
		core.data.push(outY);
		//and put them into a table
		core.tables[tableID].addColumn(outX);
		core.tables[tableID].addColumn(outY);

		return () => {
			console.log('Destroying: Removing outX and outY from core.data');
			core.data = core.data.filter((col) => col.id !== outX.id && col.id !== outY.id);
		};
	});
</script>

<p>
	Bin: <br />
	x = <ColumnSelector bind:value={p.args.xIN} /> <br />
	y = <ColumnSelector bind:value={p.args.yIN} excludeColIds={[p.xIN]} /><br />
	Bin size: <input type="number" bind:value={p.args.binSize} /> <br />
	Bin start: <input type="number" bind:value={p.args.binStart} />
</p>
<p>Output:</p>
{#key binneddata}
	{#if binneddata.bins.length > 0}
		{@const xout = getColumnByID(outX.id)}
		<ColumnComponent col={xout} />
		{@const yout = getColumnByID(outY.id)}
		<ColumnComponent col={yout} />
	{:else}
		<p>Need to have valid inputs to create columns.</p>
	{/if}
{/key}
