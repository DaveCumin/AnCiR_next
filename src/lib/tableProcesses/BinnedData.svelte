<script module>
	import { core } from '$lib/core/core.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	export const binneddata_displayName = 'Bin Data';
	export const binneddata_defaults = new Map([
		['xIN', { val: -1 }],
		['yIN', { val: -1 }],
		['binSize', { val: 0.25 }],
		['binStart', { val: 0 }],
		['stepSize', { val: 0.25 }], //null = use binSize as step
		['aggFunction', { val: 'mean' }], // mean | median | min | max | stddev
		['out', { binnedx: { val: -1 }, binnedy: { val: -1 } }],
		['valid', { val: false }]
	]);

	export function binneddata(argsIN, differentstepsize) {
		const xIN = argsIN.xIN;
		const yIN = argsIN.yIN;
		const binSize = argsIN.binSize;
		const binStart = argsIN.binStart;
		const stepSize = differentstepsize ? argsIN.stepSize : binSize;
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

		// console.log('in: ', { xData: xData.slice(0, 5), yData: yData.slice(0, 5) });
		// console.log('binning parameters: ', { binSize, binStart, stepSize, aggFunction });
		// console.log('out: ', {
		// 	bins: theBinnedData.bins.slice(0, 5),
		// 	y_out: theBinnedData.y_out.slice(0, 5)
		// });

		if (xOUT !== -1 && yOUT !== -1) {
			core.rawData.set(xOUT, theBinnedData.bins);
			getColumnById(xOUT).data = xOUT;
			getColumnById(xOUT).type = 'bin';
			getColumnById(xOUT).binWidth = binSize;
			getColumnById(xOUT).binStep = stepSize;
			getColumnById(xOUT).aggFunction = aggFunction;

			core.rawData.set(yOUT, theBinnedData.y_out);
			getColumnById(yOUT).data = yOUT;
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
	import { binData } from '$lib/components/plotbits/helpers/wrangleData.js';
	import ColumnComponent from '$lib/core/Column.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';
	import { onMount, untrack } from 'svelte';

	let { p = $bindable() } = $props();

	let binnedData = $state();
	let previewStart = $state(1);

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
	let mounted = $state(false);

	$effect(() => {
		const dataHash = getHash;
		if (!mounted) return;
		if (dataHash !== lastHash) {
			untrack(() => {
				previewStart = 1;
				[binnedData, p.args.valid] = binneddata(p.args, differentstepsize);
			});
			lastHash = dataHash;
		}
	});

	function getBinnedData() {
		previewStart = 1;
		[binnedData, p.args.valid] = binneddata(p.args, differentstepsize);
	}

	let differentstepsize = $state(false);

	onMount(() => {
		//If data already exists (e.g. imported from JSON), use it instead of regenerating
		const xKey = p.args.out.binnedx;
		const yKey = p.args.out.binnedy;
		if (xKey >= 0 && yKey >= 0 && core.rawData.has(xKey) && core.rawData.get(xKey).length > 0) {
			binnedData = { bins: core.rawData.get(xKey), y_out: core.rawData.get(yKey) };
			p.args.valid = true;
			lastHash = getHash; // prevent $effect from recalculating
		}
		mounted = true;
	});
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
			<p>Bin size (hrs)</p>
			<NumberWithUnits bind:value={p.args.binSize} onInput={getBinnedData} min="0.01" step="0.01" />
		</div>
		<div class="control-input">
			<p>Bin start (hr)</p>
			<NumberWithUnits bind:value={p.args.binStart} onInput={getBinnedData} />
		</div>
	</div>

	<p>Different step size</p>
	<input
		type="checkbox"
		bind:checked={differentstepsize}
		onchange={(e) => {
			p.args.stepSize = differentstepsize ? p.args.binSize : null;
		}}
	/>

	<div class="control-input-horizontal">
		{#if differentstepsize}
			<div class="control-input">
				<p>Step size (hrs)</p>

				<NumberWithUnits
					bind:value={p.args.stepSize}
					onInput={getBinnedData}
					min="0.01"
					step="0.01"
				/>
			</div>
		{/if}
		<div class="control-input">
			<p>Function</p>
			<select bind:value={p.args.aggFunction} onchange={getBinnedData}>
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
				{@const totalRows = binnedData.bins.length}
				<p>Preview ({p.args.aggFunction}{p.args.stepSize ? `, step=${p.args.stepSize}` : ''}):</p>
				<Table
					headers={['binned x (center)', 'binned y']}
					data={[
						binnedData.bins
							.slice(previewStart - 1, previewStart + 5)
							.map((x) => (x + p.args.stepSize / 2).toFixed(4)),
						binnedData.y_out.slice(previewStart - 1, previewStart + 5).map((y) => y.toFixed(4))
					]}
				/>
				<p>
					Row <NumberWithUnits
						min={1}
						max={Math.max(1, totalRows - 5)}
						step={1}
						bind:value={previewStart}
					/> to {Math.min(previewStart + 5, totalRows)} of {totalRows}
				</p>
			{:else}
				<p>Select valid input columns and parameters to see preview.</p>
			{/if}
		{/key}
	</div>
</div>
