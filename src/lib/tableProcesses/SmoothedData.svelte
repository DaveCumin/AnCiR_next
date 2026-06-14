<script module>
	import { core, appConsts } from '$lib/core/core.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import { runComputeTask } from '$lib/workers/workerPool.js';
	import { shouldUseWorkers } from '$lib/workers/workerGate.js';
	// Side-effect: registers 'smoothing.apply' on the main thread so sync fallback works.
	import { smoothingApply } from '$lib/utils/smoothing.worker-task.js';

	const displayName = 'Smooth Data';
	const defaults = new Map([
		['xIN', { val: -1 }],
		['yIN', { val: [] }],
		['smootherType', { val: 'moving' }],
		['whittakerLambda', { val: 100 }],
		['whittakerOrder', { val: 2 }],
		['savitzkyWindowSize', { val: 5 }],
		['savitzkyPolyOrder', { val: 2 }],
		['loessBandwidth', { val: 0.3 }],
		['movingAvgWindowSize', { val: 5 }],
		['movingAvgType', { val: 'simple' }],
		['out', { smoothedx: { val: -1 } }],
		['valid', { val: false }],
		['forcollected', { val: true }],
		['collectedType', { val: 'smooth' }],
		['preProcesses', { val: [] }],
		['tableProcesses', { val: [] }]
	]);

	export const definition = {
		displayName,
		defaults,
		func: smootheddata,
		columnIdFields: { scalar: ['xIN'], array: ['yIN'] },
		xOutKey: 'smoothedx',
		yOutKeyPrefix: 'smoothedy_',
		nodeSpec: {
			id: 'tableprocess.smootheddata',
			inputs: [
				{ name: 'xIN', kind: 'column', cardinality: 'one' },
				{ name: 'yIN', kind: 'column', cardinality: 'many' }
			],
			outputs: [
				{ name: 'smoothedx', kind: 'column', cardinality: 'one' },
				{ name: 'smoothedy_*', kind: 'column', cardinality: 'many', dynamicPrefix: 'smoothedy_' }
			]
		}
	};
	export async function smootheddata(argsIN) {
		const xIN = argsIN.xIN;
		// Backward compat: accept single number or array
		let yINs = argsIN.yIN;
		if (!Array.isArray(yINs)) yINs = yINs != null && yINs !== -1 ? [yINs] : [];
		const smootherType = argsIN.smootherType;
		const xOUT = argsIN.out.smoothedx;

		if (xIN == undefined || xIN == -1 || yINs.length === 0) {
			return [{ x_out: [], y_results: {} }, false];
		}

		const xInCol = getColumnById(xIN);
		if (!xInCol) return [{ x_out: [], y_results: {} }, false];

		const xData = xInCol.type === 'time' ? xInCol.hoursSinceStart : xInCol.getData();
		const isTimeInput = xInCol.type === 'time';
		const originTime_ms = isTimeInput ? xInCol.getData()[0] : null;

		const result = { x_out: [], y_results: {}, originTime_ms };
		let anyValid = false;

		for (const yId of yINs) {
			if (yId == null || yId === -1) continue;
			const yCol = getColumnById(yId);
			if (!yCol) continue;
			const yData = yCol.getData();

			const filteredData = xData
				.map((x, i) => ({ x, y: yData[i] }))
				.filter((d) => d.x != null && d.y != null && !isNaN(d.x) && !isNaN(d.y));

			if (filteredData.length < 3) continue;

			filteredData.sort((a, b) => a.x - b.x);
			const xVals = filteredData.map((d) => d.x);
			const yVals = filteredData.map((d) => d.y);

			const options = {
				whittakerLambda: argsIN.whittakerLambda,
				whittakerOrder: argsIN.whittakerOrder,
				savitzkyWindowSize: argsIN.savitzkyWindowSize,
				savitzkyPolyOrder: argsIN.savitzkyPolyOrder,
				loessBandwidth: argsIN.loessBandwidth,
				movingAvgWindowSize: argsIN.movingAvgWindowSize,
				movingAvgType: argsIN.movingAvgType
			};

			let smoothedY;
			try {
				const payload = {
					xs: [xVals],
					ys: [yVals],
					smootherType,
					options
				};
				const { results } = shouldUseWorkers({ inputLen: yVals.length })
					? await runComputeTask('smoothing.apply', payload)
					: smoothingApply(payload);
				smoothedY = results[0];
				if (!smoothedY) continue;
			} catch (error) {
				console.warn('Smoothing failed for column', yId, ':', error);
				continue;
			}

			// Use first valid Y's x values as the shared x output
			if (result.x_out.length === 0) result.x_out = xVals;
			result.y_results[yId] = smoothedY;
			anyValid = true;
		}

		// Apply pre-processes to y results before writing
		for (const pp of argsIN.preProcesses ?? []) {
			if (!pp.processName) continue;
			const proc = appConsts.processMap.get(pp.processName);
			if (proc?.func) {
				for (const yId of yINs) {
					if (result.y_results[yId]) {
						result.y_results[yId] = proc.func(result.y_results[yId], pp.processArgs ?? {});
					}
				}
			}
		}

		if (anyValid && xOUT != -1) {
			const processHash = crypto.randomUUID();
			const xOutValues = isTimeInput
				? result.x_out.map((h) => originTime_ms + h * 3600000)
				: result.x_out;

			core.rawData.set(xOUT, xOutValues);
			getColumnById(xOUT).data = xOUT;
			getColumnById(xOUT).type = isTimeInput ? 'time' : 'number';
			if (isTimeInput) getColumnById(xOUT).timeFormat = null;
			getColumnById(xOUT).tableProcessGUId = processHash;

			for (const yId of yINs) {
				const outKey = 'smoothedy_' + yId;
				const yOUT = argsIN.out[outKey];
				if (yOUT != null && yOUT !== -1 && result.y_results[yId]) {
					core.rawData.set(yOUT, result.y_results[yId]);
					getColumnById(yOUT).data = yOUT;
					getColumnById(yOUT).type = 'number';
					getColumnById(yOUT).tableProcessGUId = processHash;
				}
			}
		}

		return [result, anyValid];
	}
</script>

<script>
	// @ts-nocheck
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';
	import { Column, getColumnById } from '$lib/core/Column.svelte';
	import { pushObj } from '$lib/core/core.svelte.js';
	import { useMultiYTP } from '$lib/tableProcesses/useMultiYTP.svelte.js';
	import { onMount, untrack } from 'svelte';
	import { formatTimeFromUNIX } from '$lib/utils/time/TimeUtils.js';

	let { p = $bindable(), hideInputs = false } = $props();

	// Backward compat: convert legacy single yIN to array
	if (typeof p.args.yIN === 'number') {
		p.args.yIN = p.args.yIN !== -1 ? [p.args.yIN] : [];
	}

	let smoothedResult = $state();
	let mounted = $state(false);
	let previewStart = $state(1);

	const { syncYColumns, initYColumns } = useMultiYTP(p, 'smoothedy_', 'smooth_');

	// Reactivity
	let xIN_col = $derived.by(() => (p.args.xIN >= 0 ? getColumnById(p.args.xIN) : null));
	let xIsTime = $derived(xIN_col?.type === 'time');

	// Build a hash that tracks input data + all selected Y columns + smoother params
	let getHash = $derived.by(() => {
		let out = '';
		out += xIN_col?.getDataHash;
		for (const yId of p.args.yIN ?? []) {
			const col = yId >= 0 ? getColumnById(yId) : null;
			out += col?.getDataHash ?? '';
		}
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
	let _calcToken = 0;

	$effect(() => {
		const dataHash = getHash;
		if (!mounted) return;
		if (dataHash !== lastHash) {
			lastHash = dataHash; // read before untrack so it's tracked
			const token = ++_calcToken;
			setTimeout(async () => {
				if (token !== _calcToken) return; // superseded by a newer request
				previewStart = 1;
				const promise = untrack(() => smootheddata(p.args));
				const [data, valid] = await promise;
				if (token !== _calcToken) return; // re-check after await
				smoothedResult = data;
				p.args.valid = valid;
			}, 0);
		}
	});

	function onYSelectionChange() {
		if (syncYColumns()) getSmoothedData();
	}

	function getSmoothedData() {
		previewStart = 1;
		const token = ++_calcToken;
		setTimeout(async () => {
			if (token !== _calcToken) return;
			const promise = untrack(() => smootheddata(p.args));
			const [data, valid] = await promise;
			if (token !== _calcToken) return; // re-check after await
			smoothedResult = data;
			p.args.valid = valid;
			lastHash = getHash;
		}, 0);
	}

	// Exclude own output column IDs from the Y selector
	let yExcludeIds = $derived.by(() => {
		if (hideInputs) return [];
		const ids = [p.args.xIN];
		if (p.args.out.smoothedx >= 0) ids.push(p.args.out.smoothedx);
		for (const key of Object.keys(p.args.out)) {
			if (key.startsWith('smoothedy_') && p.args.out[key] >= 0) {
				ids.push(p.args.out[key]);
			}
		}
		return ids;
	});

	// Reconcile output columns when yIN changes externally (e.g. from parent in collected mode)
	$effect(() => {
		const _yIN = p.args.yIN;
		if (!mounted) return;
		untrack(() => onYSelectionChange());
	});

	onMount(() => {
		if (!p.args.out) p.args.out = {};
		// Ensure X output column exists
		if ((p.args.out.smoothedx == null || p.args.out.smoothedx < 0) && p.parent) {
			const xCol = new Column({});
			xCol.name = 'smoothedx_' + p.id;
			pushObj(xCol);
			p.parent.columnRefs = [xCol.id, ...p.parent.columnRefs];
			p.args.out.smoothedx = xCol.id;
		}
		const needsCompute = initYColumns();

		if (needsCompute) {
			getSmoothedData();
		} else {
			const xKey = p.args.out.smoothedx;
			if (xKey >= 0 && core.rawData.has(xKey) && core.rawData.get(xKey).length > 0) {
				const y_results = {};
				for (const yId of p.args.yIN ?? []) {
					const outKey = 'smoothedy_' + yId;
					const yOutId = p.args.out[outKey];
					if (yOutId >= 0 && core.rawData.has(yOutId)) {
						y_results[yId] = core.rawData.get(yOutId);
					}
				}
				smoothedResult = { x_out: core.rawData.get(xKey), y_results };
				p.args.valid = true;
				lastHash = getHash;
			}
		}
		mounted = true;
	});
</script>

<!-- Input Section -->
{#if !hideInputs}
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
					<p>Y columns</p>
					<ColumnSelector
						bind:value={p.args.yIN}
						excludeColIds={yExcludeIds}
						multiple={true}
						onChange={onYSelectionChange}
					/>
				</div>
			</div>
		</div>
	</div>
{/if}

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
	{#if p.args.valid && p.args.out.smoothedx != -1}
		{@const xout = getColumnById(p.args.out.smoothedx)}
		<details open>
			<summary class="section-details-summary">Output</summary>
			<div class="section-row">
				<div class="tp-outputs">
					<div class="tp-output-row">
						<span class="tp-output-label">{getColumnById(p.args.xIN)?.name ?? 'x'} (shared)</span>
						<ColumnComponent col={xout} />
					</div>
					{#each p.args.yIN ?? [] as yId}
						{@const outKey = 'smoothedy_' + yId}
						{@const yOutId = p.args.out[outKey]}
						{#if yOutId >= 0}
							{@const yout = getColumnById(yOutId)}
							{#if yout}
								<div class="tp-output-row">
									<span class="tp-output-label">{getColumnById(Number(yId))?.name ?? yId}</span>
									<ColumnComponent col={yout} />
								</div>
							{/if}
						{/if}
					{/each}
				</div>
			</div>
		</details>
	{:else if p.args.valid}
		{@const totalRows = smoothedResult.x_out.length}
		{@const xSlice = smoothedResult.x_out.slice(previewStart - 1, previewStart + 5)}
		{@const yIds = Object.keys(smoothedResult.y_results)}
		<p>Preview:</p>
		<Table
			headers={[
				'smoothed x',
				...yIds.map((id) => 'smoothed y (' + (getColumnById(Number(id))?.name ?? id) + ')')
			]}
			data={[
				xIsTime
					? xSlice.map((v) => ({
							isTime: true,
							raw: formatTimeFromUNIX(smoothedResult.originTime_ms + v * 3600000),
							computed: v.toFixed(2)
						}))
					: xSlice.map((x) => x.toFixed(2)),
				...yIds.map((id) =>
					smoothedResult.y_results[id]
						.slice(previewStart - 1, previewStart + 5)
						.map((x) => x.toFixed(2))
				)
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
		<p>Need to have valid inputs to create columns.</p>
	{/if}
{/key}
