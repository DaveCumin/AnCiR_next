<script module>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';

	export const binneddata_defaults = new Map([
		['xIN', { val: -1 }],
		['yIN', { val: -1 }],
		['binSize', { val: 0.25 }],
		['binStart', { val: 0 }],
		['stepSize', { val: 0.25 }], // ← new: null = use binSize as step
		['aggFunction', { val: 'mean' }], // ← new: mean | median | min | max | stddev
		['out', { binnedx: { val: -1 }, binnedy: { val: -1 } }],
		['valid', { val: false }]
	]);

	export function binneddata(argsIN) {
		const xIN = argsIN.xIN;
		const yIN = argsIN.yIN;
		const binSize = argsIN.binSize;
		const binStart = argsIN.binStart;
		const stepSize = argsIN.stepSize || binSize;
		const aggFunction = argsIN.aggFunction || 'mean';
		const xOUT = argsIN.out.binnedx;
		const yOUT = argsIN.out.binnedy;

		if (
			xIN == undefined ||
			yIN == undefined ||
			binSize == undefined ||
			binStart == undefined ||
			xIN == -1 ||
			yIN == -1 ||
			binSize <= 0
		) {
			return [{ bins: [], y_out: [] }, false];
		}

		const xData =
			getColumnById(xIN).type === 'time'
				? getColumnById(xIN).hoursSinceStart
				: getColumnById(xIN).getData();

		const yData = getColumnById(yIN).getData();

		const theBinnedData = binData(xData, yData, binSize, binStart, stepSize, aggFunction);

		if (xOUT !== -1 && yOUT !== -1) {
			getColumnById(xOUT).data = theBinnedData.bins;
			getColumnById(xOUT).type = 'bin';
			getColumnById(xOUT).binWidth = binSize;
			getColumnById(xOUT).binStep = stepSize;
			getColumnById(xOUT).aggFunction = aggFunction;

			getColumnById(yOUT).data = theBinnedData.y_out;
			getColumnById(yOUT).type = 'number';

			const processHash = crypto.randomUUID();
			getColumnById(xOUT).tableProcessGUId = processHash;
			getColumnById(yOUT).tableProcessGUId = processHash;
		}

		return [theBinnedData, theBinnedData.bins.length > 0];
	}
</script>

<script>
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import { binData } from '$lib/components/plotBits/helpers/wrangleData.js';
	import ColumnComponent from '$lib/core/Column.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';
	import { onMount } from 'svelte';

	let { p = $bindable() } = $props();

	let binnedData = $state();

	// Reactivity
	let xIN_col = $derived.by(() => (p.args.xIN >= 0 ? getColumnById(p.args.xIN) : null));
	let yIN_col = $derived.by(() => (p.args.yIN >= 0 ? getColumnById(p.args.yIN) : null));
	let getHash = $derived.by(() => {
		let h = '';
		h += xIN_col?.getDataHash ?? '';
		h += yIN_col?.getDataHash ?? '';
		h += p.args.binSize + p.args.binStart + (p.args.stepSize ?? '') + p.args.aggFunction;
		return h;
	});
	let lastHash = '';

	$effect(() => {
		if (getHash !== lastHash) {
			[binnedData, p.args.valid] = binneddata(p.args);
			lastHash = getHash;
		}
	});

	function getBinnedData() {
		[binnedData, p.args.valid] = binneddata(p.args);
	}

	onMount(getBinnedData);
</script>

<!-- Input Section -->
<div class="section-row">
	<div class="tableProcess-label"><span>Input</span></div>
	<div class="control-input-vertical">
		<div class="control-input">
			<p>X column</p>
			<ColumnSelector bind:value={p.args.xIN} onChange={getBinnedData} />
		</div>
		<div class="control-input">
			<p>Y column</p>
			<ColumnSelector
				bind:value={p.args.yIN}
				excludeColIds={[p.args.xIN]}
				onChange={getBinnedData}
			/>
		</div>
	</div>
</div>

<!-- Bin Parameters -->
<div class="section-row">
	<div class="tableProcess-label"><span>Bin parameters</span></div>
	<div class="control-input-horizontal">
		<div class="control-input">
			<p>Bin size</p>
			<NumberWithUnits bind:value={p.args.binSize} onInput={getBinnedData} min="0.01" step="0.01" />
		</div>
		<div class="control-input">
			<p>Bin start</p>
			<NumberWithUnits bind:value={p.args.binStart} onInput={getBinnedData} />
		</div>
	</div>

	<div class="control-input-horizontal">
		<div class="control-input">
			<p>Step size</p>

			<NumberWithUnits
				bind:value={p.args.stepSize}
				onInput={getBinnedData}
				min="0.01"
				step="0.01"
			/>
		</div>

		<div class="control-input">
			<p>Function</p>
			<select bind:value={p.args.aggFunction} on:change={getBinnedData}>
				<option value="mean">Mean</option>
				<option value="median">Median</option>
				<option value="min">Minimum</option>
				<option value="max">Maximum</option>
				<option value="stddev">Std Dev</option>
			</select>
		</div>
	</div>
</div>

<!-- Output / Preview -->
<div class="section-row">
	<div class="section-content">
		{#key binnedData}
			{#if p.args.valid && p.args.out.binnedx != -1 && p.args.out.binnedy != -1}
				{@const xout = getColumnById(p.args.out.binnedx)}
				{@const yout = getColumnById(p.args.out.binnedy)}
				<div class="tableProcess-label"><span>Output</span></div>
				<ColumnComponent col={xout} />
				<ColumnComponent col={yout} />
			{:else if p.args.valid && binnedData?.bins?.length}
				<p>Preview ({p.args.aggFunction}{p.args.stepSize ? `, step=${p.args.stepSize}` : ''}):</p>
				<div style="height:250px; overflow:auto;">
					<Table
						headers={['binned x (center)', 'binned y']}
						data={[
							binnedData.bins.map((x) => x.toFixed(4)),
							binnedData.y_out.map((y) => y.toFixed(4))
						]}
					/>
				</div>
			{:else}
				<p>Select valid input columns and parameters to see preview.</p>
			{/if}
		{/key}
	</div>
</div>
