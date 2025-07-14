<script module>
	export const binneddata_defaults = new Map([
		[
			'xIN',
			{ val: -1 },
			'yIN',
			{ val: -1 },
			'binSize',
			{ val: 0.25 },
			'binStart',
			{ val: 0 },
			'xOUT',
			{ val: -1 },
			'yOUT',
			{ val: -1 }
		]
	]);
</script>

<script>
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import { binData } from '$lib/components/plotbits/helpers/wrangleData.js';
	import ColumnComponent from '$lib/core/Column.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';

	let { p = $bindable() } = $props();

	function getBinnedData() {
		const xIN = p.args.xIN;
		const yIN = p.args.yIN;
		const binSize = p.args.binSize;
		const binStart = p.args.binStart;
		const xOUT = p.args.xOUT;
		const yOUT = p.args.yOUT;
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
			getColumnById(xIN).hoursSinceStart,
			getColumnById(yIN).getData(),
			binSize,
			binStart
		);

		getColumnById(xOUT).data = theBinnedData.bins;
		getColumnById(yOUT).data = theBinnedData.y_out;
		const processHash = crypto.randomUUID();
		getColumnById(xOUT).tableProcessGUId = processHash;
		getColumnById(yOUT).tableProcessGUId = processHash;
		//TODO: I don't know why the above isn't working, but the 'hack' is below (to make columns that reference xOUT/yOUT update from the changed column)
		let temp = getColumnById(xOUT).addProcess('Add');
		getColumnById(xOUT).removeProcess(temp);
		temp = getColumnById(yOUT).addProcess('Add');
		getColumnById(yOUT).removeProcess(temp);
		//-----

		binnedData = theBinnedData;
	}

	let binnedData = $state();
	getBinnedData();
</script>

<p>
	Bin: <br />
	x = <ColumnSelector bind:value={p.args.xIN} oninput={getBinnedData} /> <br />
	y = <ColumnSelector bind:value={p.args.yIN} excludeColIds={[p.xIN]} oninput={getBinnedData} /><br
	/>
	Bin size:
	<input type="number" bind:value={p.args.binSize} oninput={getBinnedData} min="0.1" step="0.1" />
	<br />
	Bin start: <input type="number" bind:value={p.args.binStart} oninput={getBinnedData} />
</p>
<p>Output:</p>
{#key binnedData}
	{#if binnedData.bins.length > 0}
		{@const xout = getColumnById(p.args.xOUT)}
		<ColumnComponent col={xout} />
		{@const yout = getColumnById(p.args.yOUT)}
		<ColumnComponent col={yout} />
	{:else}
		<p>Need to have valid inputs to create columns.</p>
	{/if}
{/key}
