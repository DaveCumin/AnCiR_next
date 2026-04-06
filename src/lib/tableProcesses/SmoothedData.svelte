<script module>
	import { core } from '$lib/core/core.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import { whittakerEilers, savitzkyGolay, loess, movingAverage } from '$lib/utils/smoothing.js';
	export const smootheddata_displayName = 'Smooth Data';
	export const smootheddata_defaults = new Map([
		['xIN', { val: -1 }],
		['yIN', { val: -1 }],
		['smootherType', { val: 'moving' }],
		['whittakerLambda', { val: 100 }],
		['whittakerOrder', { val: 2 }],
		['savitzkyWindowSize', { val: 5 }],
		['savitzkyPolyOrder', { val: 2 }],
		['loessBandwidth', { val: 0.3 }],
		['movingAvgWindowSize', { val: 5 }],
		['movingAvgType', { val: 'simple' }],
		['out', { smoothedx: { val: -1 }, smoothedy: { val: -1 } }],
		['valid', { val: false }]
	]);


	export function smootheddata(argsIN) {
		const xIN = argsIN.xIN;
		const yIN = argsIN.yIN;
		const smootherType = argsIN.smootherType;
		const xOUT = argsIN.out.smoothedx;
		const yOUT = argsIN.out.smoothedy;

		if (xIN == undefined || yIN == undefined || xIN == -1 || yIN == -1) {
			return [{ x_out: [], y_out: [] }, false];
		}

		const xData =
			getColumnById(xIN).type == 'time'
				? getColumnById(xIN).hoursSinceStart
				: getColumnById(xIN).getData();
		const yData = getColumnById(yIN).getData();

		// Filter out invalid data
		const filteredData = xData
			.map((x, i) => ({ x, y: yData[i] }))
			.filter((d) => d.x != null && d.y != null && !isNaN(d.x) && !isNaN(d.y));

		if (filteredData.length < 3) {
			return [{ x_out: [], y_out: [] }, false];
		}

		// Sort by x values
		filteredData.sort((a, b) => a.x - b.x);
		const xVals = filteredData.map((d) => d.x);
		const yVals = filteredData.map((d) => d.y);

		let smoothedY;
		try {
			switch (smootherType) {
				case 'whittaker':
					smoothedY = whittakerEilers(yVals, argsIN.whittakerLambda, argsIN.whittakerOrder);
					break;
				case 'savitzky':
					smoothedY = savitzkyGolay(yVals, argsIN.savitzkyWindowSize, argsIN.savitzkyPolyOrder);
					break;
				case 'loess':
					smoothedY = loess(xVals, yVals, argsIN.loessBandwidth);
					break;
				case 'moving':
					smoothedY = movingAverage(yVals, argsIN.movingAvgWindowSize, argsIN.movingAvgType);
					break;
				default:
					return [{ x_out: [], y_out: [] }, false];
			}
		} catch (error) {
			console.warn('Smoothing failed:', error);
			return [{ x_out: [], y_out: [] }, false];
		}

		const result = { x_out: xVals, y_out: smoothedY };

		if (xOUT != -1 && yOUT != -1) {
			core.rawData.set(xOUT, result.x_out);
			getColumnById(xOUT).data = xOUT;
			getColumnById(xOUT).type = 'number';

			core.rawData.set(yOUT, result.y_out);
			getColumnById(yOUT).data = yOUT;
			getColumnById(yOUT).type = 'number';

			const processHash = crypto.randomUUID();
			getColumnById(xOUT).tableProcessGUId = processHash;
			getColumnById(yOUT).tableProcessGUId = processHash;
		}

		console.log('smootheddata result: ', result);
		return [result, result.x_out.length > 0];
	}
</script>

<script>
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';
	import { onMount, untrack } from 'svelte';

	let { p = $bindable() } = $props();

	let smoothedResult = $state();
	let mounted = $state(false);
	let previewStart = $state(1);

	// Reactivity
	let xIN_col = $derived.by(() => (p.args.xIN >= 0 ? getColumnById(p.args.xIN) : null));
	let yIN_col = $derived.by(() => (p.args.yIN >= 0 ? getColumnById(p.args.yIN) : null));
	let getHash = $derived.by(() => {
		let out = '';
		out += xIN_col?.getDataHash;
		out += yIN_col?.getDataHash;
		out += p.args.smootherType;
		out += p.args.whittakerLambda;
		out += p.args.whittakerOrder;
		out += p.args.savitzkyWindowSize;
		out += p.args.savitzkyPolyOrder;
		out += p.args.loessBandwidth;
		out += p.args.movingAvgWindowSize;
		out += p.args.movingAvgType;
		return out;
	});
	let lastHash = '';
	$effect(() => {
		const dataHash = getHash;
		if (!mounted) return;
		if (lastHash !== dataHash) {
			untrack(() => {
				previewStart = 1;
				[smoothedResult, p.args.valid] = smootheddata(p.args);
			});
			lastHash = dataHash;
		}
	});

	function getSmoothedData() {
		previewStart = 1;
		[smoothedResult, p.args.valid] = smootheddata(p.args);
	}

	onMount(() => {
		//If data already exists (e.g. imported from JSON), use it instead of regenerating
		const xKey = p.args.out.smoothedx;
		const yKey = p.args.out.smoothedy;
		if (xKey >= 0 && yKey >= 0 && core.rawData.has(xKey) && core.rawData.get(xKey).length > 0) {
			smoothedResult = { x_out: core.rawData.get(xKey), y_out: core.rawData.get(yKey) };
			p.args.valid = true;
			lastHash = getHash; // prevent $effect from recalculating
		}
		mounted = true;
	});
</script>

<!-- Input Section -->
<div class="section-row">
	<div class="tableProcess-label">
		<span>Input</span>
	</div>

	<div class="control-input-vertical">
		<div class="control-input">
			<p>X column</p>
			<ColumnSelector bind:value={p.args.xIN} onChange={(e) => getSmoothedData()} /> <br />
		</div>
		<div class="control-input-vertical">
			<div class="control-input">
				<p>Y column</p>
				<ColumnSelector
					bind:value={p.args.yIN}
					excludeColIds={[p.args.xIN]}
					onChange={(e) => getSmoothedData()}
				/>
			</div>
		</div>
	</div>
</div>

<div class="section-row">
	<div class="tableProcess-label">
		<span>Smooth parameters</span>
	</div>

	<div class="control-input-horizontal">
		<div class="control-input">
			<p>Type</p>
			<AttributeSelect
				bind:value={p.args.smootherType}
				options={['moving', 'savitzky', 'loess']}
				optionsDisplay={['Moving Average', 'Savitzky-Golay', 'LOESS']}
				onChange={() => getSmoothedData()}
			/>
		</div>
	</div>

	<!-- Type-specific parameters -->
	{#if p.args.smootherType === 'whittaker'}
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>Lambda (Smoothing)</p>
				<NumberWithUnits
					step="10"
					min={1}
					max={10000}
					bind:value={p.args.whittakerLambda}
					onInput={() => getSmoothedData()}
				/>
			</div>
			<div class="control-input">
				<p>Order</p>
				<NumberWithUnits
					step="1"
					min={1}
					max={4}
					bind:value={p.args.whittakerOrder}
					onInput={() => getSmoothedData()}
				/>
			</div>
		</div>
	{:else if p.args.smootherType === 'savitzky'}
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>Window Size</p>
				<NumberWithUnits
					step="2"
					min={3}
					max={21}
					bind:value={p.args.savitzkyWindowSize}
					onInput={() => getSmoothedData()}
				/>
			</div>
			<div class="control-input">
				<p>Poly Order</p>
				<NumberWithUnits
					step="1"
					min={1}
					max={6}
					bind:value={p.args.savitzkyPolyOrder}
					onInput={() => getSmoothedData()}
				/>
			</div>
		</div>
	{:else if p.args.smootherType === 'loess'}
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>Bandwidth</p>
				<NumberWithUnits
					step="0.01"
					min={0.01}
					max={1.0}
					bind:value={p.args.loessBandwidth}
					onInput={() => getSmoothedData()}
				/>
			</div>
		</div>
	{:else if p.args.smootherType === 'moving'}
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>Window Size</p>
				<NumberWithUnits
					step="1"
					min={3}
					max={51}
					bind:value={p.args.movingAvgWindowSize}
					onInput={() => getSmoothedData()}
				/>
			</div>
			<div class="control-input">
				<p>Type</p>
				<AttributeSelect
					bind:value={p.args.movingAvgType}
					options={['simple', 'weighted', 'exponential']}
					optionsDisplay={['Simple', 'Weighted', 'Exponential']}
					onChange={() => getSmoothedData()}
				/>
			</div>
		</div>
	{/if}
</div>

{#key smoothedResult}
	{#if p.args.valid && p.args.out.smoothedx != -1 && p.args.out.smoothedy != -1}
		{@const xout = getColumnById(p.args.out.smoothedx)}

		{@const yout = getColumnById(p.args.out.smoothedy)}
		<div class="section-row">
			<div class="tableProcess-label">
				<span>Output</span>
			</div>
			<ColumnComponent col={xout} />
			<ColumnComponent col={yout} />
		</div>
	{:else if p.args.valid}
		{@const totalRows = smoothedResult.x_out.length}
		<p>Preview:</p>
		<Table
			headers={['smoothed x', 'smoothed y']}
			data={[
				smoothedResult.x_out.slice(previewStart - 1, previewStart + 5).map((x) => x.toFixed(2)),
				smoothedResult.y_out.slice(previewStart - 1, previewStart + 5).map((x) => x.toFixed(2))
			]}
		/>
		<p>Row <NumberWithUnits min={1} max={Math.max(1, totalRows - 5)} step={1} bind:value={previewStart} /> to {Math.min(previewStart + 5, totalRows)} of {totalRows}</p>
	{:else}
		<p>Need to have valid inputs to create columns.</p>
	{/if}
{/key}
