<script module>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';

	export const binneddata_defaults = new Map([
		['xIN', { val: -1 }],
		['yIN', { val: -1 }],
		['binSize', { val: 0.25 }],
		['binStart', { val: 0 }],
		['out', { binnedx: { val: -1 }, binnedy: { val: -1 } }], //needed to set upu the output columns
		['valid', { val: false }] //needed for the progress step logic
	]);
</script>

<script>
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import { binData } from '$lib/components/plotBits/helpers/wrangleData.js';
	import ColumnComponent from '$lib/core/Column.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';
	import { onMount } from 'svelte';

	let { p = $bindable() } = $props();

	let binnedData = $state();

	// for reactivity -----------
	let xIN_col = $derived.by(() => (p.args.xIN >= 0 ? getColumnById(p.args.xIN) : null));
	let yIN_col = $derived.by(() => (p.args.yIN >= 0 ? getColumnById(p.args.yIN) : null));
	let getHash = $derived.by(() => {
		let out = '';
		out += xIN_col?.getDataHash;
		out += yIN_col?.getDataHash;
		return out;
	});
	let lastHash = '';
	$effect(() => {
		const dataHash = getHash;
		if (lastHash === dataHash) {
			//do nothing
		} else {
			getBinnedData(); // DO THE BUSINESS
			lastHash = getHash;
		}
	});
	//------------

	function getBinnedData() {
		console.log('doing binned');
		const xIN = p.args.xIN;
		const yIN = p.args.yIN;
		const binSize = p.args.binSize;
		const binStart = p.args.binStart;
		const xOUT = p.args.out.binnedx;
		const yOUT = p.args.out.binnedy;

		if (
			xIN == undefined ||
			yIN == undefined ||
			binSize == undefined ||
			binStart == undefined ||
			xIN == -1 ||
			yIN == -1 ||
			binSize == 0
		) {
			binnedData = { bins: [], y_out: [] };
			p.args.valid = false;
			return;
		}

		const theBinnedData = binData(
			getColumnById(xIN).hoursSinceStart,
			getColumnById(yIN).getData(),
			binSize,
			binStart
		);

		if (xOUT == -1 || yOUT == -1) {
		} else {
			getColumnById(xOUT).data = theBinnedData.bins;
			getColumnById(yOUT).data = theBinnedData.y_out;
			const processHash = crypto.randomUUID();
			getColumnById(xOUT).tableProcessGUId = processHash;
			getColumnById(yOUT).tableProcessGUId = processHash;
		}
		binnedData = theBinnedData;
		if (binnedData.bins.length > 0) {
			p.args.valid = true;
		} else {
			p.args.valid = false;
		}
	}

	onMount(() => {
		//needed to get the values when it first mounts
		getBinnedData();
	});
</script>

<p>
	Bin: <br />
	x = <ColumnSelector bind:value={p.args.xIN} onChange={(e) => getBinnedData()} /> <br />
	y = <ColumnSelector
		bind:value={p.args.yIN}
		excludeColIds={[p.xIN]}
		onChange={(e) => getBinnedData()}
	/><br />
	Bin size:
	<NumberWithUnits
		bind:value={p.args.binSize}
		onInput={() => getBinnedData()}
		min="0.1"
		step="0.01"
	/>
	<br />
	Bin start: <NumberWithUnits bind:value={p.args.binStart} onInput={() => getBinnedData()} />
</p>
<p>Output:</p>
{#key binnedData}
	{#if p.args.valid && p.args.out.binnedx != -1 && p.args.out.binnedy != -1}
		{@const xout = getColumnById(p.args.out.binnedx)}
		<ColumnComponent col={xout} />
		{@const yout = getColumnById(p.args.out.binnedy)}
		<ColumnComponent col={yout} />
	{:else if p.args.valid}
		<p>Preview:</p>
		<p>X: {binnedData.bins.slice(0, 5).map((x) => x.toFixed(2))}</p>
		<p>Y: {binnedData.y_out.slice(0, 5).map((y) => y.toFixed(2))}</p>
	{:else}
		<p>Need to have valid inputs to create columns.</p>
	{/if}
{/key}
