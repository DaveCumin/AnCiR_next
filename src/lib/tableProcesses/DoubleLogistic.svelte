<script module>
	import { core } from '$lib/core/core.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import { fitDoubleLogistic, evaluateDoubleLogisticAtPoints } from '$lib/utils/doublelogistic.js';

	export const doublelogistic_displayName = 'Double Logistic';

	export const doublelogistic_defaults = new Map([
		['xIN', { val: -1 }],
		['yIN', { val: -1 }],
		['outputX', { val: -1 }],
		['fixK1', { val: false }],
		['fixedK1', { val: 0.5 }],
		['fixK2', { val: false }],
		['fixedK2', { val: 0.5 }],
		['fixPeriod', { val: false }],
		['fixedPeriod', { val: 24 }],
		['out', { dlogx: { val: -1 }, dlogy: { val: -1 } }],
		['valid', { val: false }]
	]);

	export function doublelogistic(argsIN) {
		const xIN = argsIN.xIN;
		const yIN = argsIN.yIN;
		const outputXId = argsIN.outputX;
		const xOUT = argsIN.out.dlogx;
		const yOUT = argsIN.out.dlogy;
		const fixK1 = argsIN.fixK1 ?? false;
		const fixedK1 = argsIN.fixedK1 ?? 0.5;
		const fixK2 = argsIN.fixK2 ?? false;
		const fixedK2 = argsIN.fixedK2 ?? 0.5;
		const fixPeriod = argsIN.fixPeriod ?? false;
		const fixedPeriod = argsIN.fixedPeriod ?? 24;

		let result = null;
		let valid = false;

		const canRun = xIN != -1 && yIN != -1 && getColumnById(xIN) && getColumnById(yIN);

		if (canRun) {
			const tCol = getColumnById(xIN);
			const yCol = getColumnById(yIN);

			const t = tCol.type === 'time' ? tCol.hoursSinceStart : tCol.getData();
			const y = yCol.getData();

			const validIndices = t
				.map((v, i) => (isNaN(v) || isNaN(y[i]) ? -1 : i))
				.filter((i) => i !== -1);

			const tt = validIndices.map((i) => t[i]);
			const yy = validIndices.map((i) => y[i]);

			if (tt.length < 4) return [null, false];

			// Output X data
			let outputXData = null;
			if (outputXId != -1 && getColumnById(outputXId)) {
				const outputXCol = getColumnById(outputXId);
				outputXData =
					outputXCol.type === 'time' ? outputXCol.hoursSinceStart : outputXCol.getData();
				outputXData = outputXData.filter((v) => !isNaN(v));
			}

			// Origin time for datetime display
			let originTime_ms = null;
			if (outputXId != -1) {
				const col = getColumnById(outputXId);
				if (col?.type === 'time') originTime_ms = col.getData()[0];
			}
			if (originTime_ms == null && tCol.type === 'time') {
				originTime_ms = tCol.getData()[0];
			}

			const fitResult = fitDoubleLogistic(tt, yy, {
				periodic: true,
				fixK1,
				fixK2,
				fixPeriod,
				fixedK1,
				fixedK2,
				fixedPeriod
			});

			if (fitResult) {
				valid = true;
				const xOutData = outputXData ?? tt;
				const yOutData = outputXData
					? evaluateDoubleLogisticAtPoints(fitResult.parameters, true, outputXData)
					: fitResult.fitted;

				if (xOUT != -1 && yOUT != -1) {
					const xColOut = getColumnById(xOUT);
					const yColOut = getColumnById(yOUT);
					if (xColOut && yColOut) {
						const xOutMs =
							originTime_ms != null ? xOutData.map((h) => originTime_ms + h * 3600000) : xOutData;
						core.rawData.set(xOUT, xOutMs);
						xColOut.data = xOUT;
						xColOut.type = originTime_ms != null ? 'time' : 'number';
						if (originTime_ms != null) xColOut.timeFormat = null;
						core.rawData.set(yOUT, yOutData);
						yColOut.data = yOUT;
						yColOut.type = 'number';
						const processHash = crypto.randomUUID();
						xColOut.tableProcessGUId = processHash;
						yColOut.tableProcessGUId = processHash;
					}
				}

				result = { t: tt, outputXData, fitResult, fitted: yOutData, originTime_ms };
			}
		}

		return [result, valid];
	}
</script>

<script>
	// @ts-nocheck
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';
	import StoreValueButton from '$lib/components/inputs/StoreValueButton.svelte';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';

	import { getColumnById } from '$lib/core/Column.svelte';
	import { formatTimeFromUNIX } from '$lib/utils/time/TimeUtils.js';
	import { onMount, untrack } from 'svelte';

	let { p = $bindable() } = $props();

	// Backwards compatibility
	if (p.args.fixK1 === undefined) p.args.fixK1 = false;
	if (p.args.fixedK1 === undefined) p.args.fixedK1 = 0.5;
	if (p.args.fixK2 === undefined) p.args.fixK2 = false;
	if (p.args.fixedK2 === undefined) p.args.fixedK2 = 0.5;
	if (p.args.fixPeriod === undefined) p.args.fixPeriod = false;
	if (p.args.fixedPeriod === undefined) p.args.fixedPeriod = 24;

	let dlData = $state(null);
	let showOutputX = $state(p.args.outputX !== -1);
	let mounted = $state(false);
	let previewStart = $state(1);
	let calculating = $state(false);
	let _calcToken = 0;

	let xIN_col = $derived.by(() => (p.args.xIN >= 0 ? getColumnById(p.args.xIN) : null));
	let yIN_col = $derived.by(() => (p.args.yIN >= 0 ? getColumnById(p.args.yIN) : null));
	let outputX_col = $derived.by(() => (p.args.outputX >= 0 ? getColumnById(p.args.outputX) : null));
	let xIsTime = $derived(xIN_col?.type === 'time' || outputX_col?.type === 'time');

	let getHash = $derived.by(() => {
		let out = '';
		out += xIN_col?.getDataHash;
		out += yIN_col?.getDataHash;
		out += outputX_col?.getDataHash;
		out += p.args.fixK1;
		out += p.args.fixK2;
		out += p.args.fixPeriod;
		return out;
	});
	let lastHash = '';

	$effect(() => {
		const dataHash = getHash;
		if (!mounted) return;
		if (lastHash !== dataHash) {
			lastHash = getHash;
			calculating = true;
			const token = ++_calcToken;
			setTimeout(() => {
				if (token !== _calcToken) return;
				untrack(() => {
					previewStart = 1;
					[dlData, p.args.valid] = doublelogistic(p.args);
					calculating = false;
				});
			}, 0);
		}
	});

	function getFit() {
		previewStart = 1;
		calculating = true;
		const token = ++_calcToken;
		setTimeout(() => {
			if (token !== _calcToken) return;
			[dlData, p.args.valid] = doublelogistic(p.args);
			calculating = false;
		}, 0);
	}

	onMount(() => {
		const xKey = p.args.out.dlogx;
		const yKey = p.args.out.dlogy;
		if (xKey >= 0 && yKey >= 0 && core.rawData.has(xKey) && core.rawData.get(xKey).length > 0) {
			// Show the saved curve immediately while the re-fit runs in the background.
			dlData = {
				t: core.rawData.get(xKey),
				outputXData: null,
				fitResult: null,
				fitted: core.rawData.get(yKey),
				originTime_ms: null
			};
			p.args.valid = true;
		}
		mounted = true;
	});

	function toggleOutputX(checked) {
		p.args.outputX = checked ? p.args.xIN : -1;
	}

	/** Safe toFixed — returns '—' for null/undefined/NaN/Infinity */
	function fmt(val, decimals = 3) {
		if (val == null || !isFinite(val)) return '—';
		return val.toFixed(decimals);
	}
</script>

<!-- Input -->
<div class="section-row">
	<div class="tableProcess-label">
		<span>Input</span>
	</div>
	<div class="control-input-vertical">
		<div class="control-input">
			<p>X column</p>
			<ColumnSelector bind:value={p.args.xIN} />
		</div>
		<div class="control-input">
			<p>Y column</p>
			<ColumnSelector bind:value={p.args.yIN} excludeColIds={[p.args.xIN]} />
		</div>
	</div>
</div>

<!-- Options -->
<div class="section-row">
	<div class="tableProcess-label">
		<span>Model parameters</span>
	</div>

	<!-- Period -->
	<div class="control-input-horizontal">
		<div class="control-input-checkbox">
			<input type="checkbox" bind:checked={p.args.fixPeriod} onchange={getFit} />
			<p>Fix period</p>
		</div>
	</div>
	{#if p.args.fixPeriod}
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>Period</p>
				<NumberWithUnits
					bind:value={p.args.fixedPeriod}
					min="0.1"
					step="0.5"
					units={{ default: 'hrs', days: 24, hrs: 1, mins: 1 / 60, secs: 1 / (60 * 60) }}
					onInput={getFit}
				/>
			</div>
		</div>
	{/if}

	<!-- Rise rate (k1) -->
	<div class="control-input-horizontal">
		<div class="control-input-checkbox">
			<input type="checkbox" bind:checked={p.args.fixK1} onchange={getFit} />
			<p>Fix rise rate (k1)</p>
		</div>
	</div>
	{#if p.args.fixK1}
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>k1 (1/hr)</p>
				<NumberWithUnits bind:value={p.args.fixedK1} min="0.001" step="0.05" onInput={getFit} />
			</div>
		</div>
	{/if}

	<!-- Fall rate (k2) -->
	<div class="control-input-horizontal">
		<div class="control-input-checkbox">
			<input type="checkbox" bind:checked={p.args.fixK2} onchange={getFit} />
			<p>Fix fall rate (k2)</p>
		</div>
	</div>
	{#if p.args.fixK2}
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>k2 (1/hr)</p>
				<NumberWithUnits bind:value={p.args.fixedK2} min="0.001" step="0.05" onInput={getFit} />
			</div>
		</div>
	{/if}

	<!-- Output X -->
	<div class="control-input-horizontal">
		<div class="control-input-checkbox">
			<input
				type="checkbox"
				bind:checked={showOutputX}
				onchange={(e) => toggleOutputX(e.target.checked)}
			/>
			<p>Specify output x values</p>
		</div>
	</div>
	{#if showOutputX}
		<div class="control-input-vertical">
			<div class="control-input">
				<p>Output X column</p>
				<ColumnSelector
					bind:value={p.args.outputX}
					excludeColIds={[p.args.out.dlogx, p.args.out.dlogy]}
				/>
			</div>
		</div>
	{/if}
</div>

<!-- Output -->
<div class="section-row">
	<div class="tableProcess-label">
		<span>Output</span>
	</div>
	<div class="section-content">
		{#if calculating}
			<LoadingSpinner message="Fitting double logistic…" />
		{:else if p.args.valid && p.args.out.dlogx != -1 && p.args.out.dlogy != -1}
			{@const xout = getColumnById(p.args.out.dlogx)}
			<ColumnComponent col={xout} />
			{@const yout = getColumnById(p.args.out.dlogy)}
			<ColumnComponent col={yout} />
			{#if dlData?.fitResult}
				{@const fr = dlData.fitResult}
				{@const p_ = fr.parameters}
				<div class="control-input-horizontal">
					<div class="control-input">
						<p>Period: {fmt(p_.T)} hrs
							<StoreValueButton label="Period" getter={() => dlData?.fitResult?.parameters?.T} defaultName="dlog_period" source="Double Logistic" />
						</p>
						<p>Onset phase: {fmt(fr.onsetPhase)} hrs
							<StoreValueButton label="Onset phase" getter={() => dlData?.fitResult?.onsetPhase} defaultName="dlog_onset" source="Double Logistic" />
						</p>
						<p>Offset phase: {fmt(fr.offsetPhase)} hrs
							<StoreValueButton label="Offset phase" getter={() => dlData?.fitResult?.offsetPhase} defaultName="dlog_offset" source="Double Logistic" />
						</p>
						<p>Duty cycle: {fmt(fr.dutyCycle != null ? fr.dutyCycle * 100 : null, 1)}%
							<StoreValueButton label="Duty cycle" getter={() => dlData?.fitResult?.dutyCycle} defaultName="dlog_dutycycle" source="Double Logistic" />
						</p>
						<p>Rise rate (k1): {fmt(p_.k1, 4)} /hr
							<StoreValueButton label="Rise rate" getter={() => dlData?.fitResult?.parameters?.k1} defaultName="dlog_k1" source="Double Logistic" />
						</p>
						<p>Fall rate (k2): {fmt(p_.k2, 4)} /hr
							<StoreValueButton label="Fall rate" getter={() => dlData?.fitResult?.parameters?.k2} defaultName="dlog_k2" source="Double Logistic" />
						</p>
						<p>Amplitude (A): {fmt(p_.A)}
							<StoreValueButton label="Amplitude" getter={() => dlData?.fitResult?.parameters?.A} defaultName="dlog_amplitude" source="Double Logistic" />
						</p>
						<p>Mesor (M): {fmt(p_.M)}
							<StoreValueButton label="Mesor" getter={() => dlData?.fitResult?.parameters?.M} defaultName="dlog_mesor" source="Double Logistic" />
						</p>
						<p>RMSE: {fmt(fr.rmse)}
							<StoreValueButton label="RMSE" getter={() => dlData?.fitResult?.rmse} defaultName="dlog_rmse" source="Double Logistic" />
						</p>
						<p>R²: {fmt(fr.rSquared)}
							<StoreValueButton label="R²" getter={() => dlData?.fitResult?.rSquared} defaultName="dlog_r2" source="Double Logistic" />
						</p>
					</div>
				</div>
			{/if}
		{:else if p.args.valid && dlData?.fitResult}
			{@const fr = dlData.fitResult}
			{@const p_ = fr.parameters}
			<p>Preview:</p>
			<div class="control-input-horizontal">
				<div class="control-input">
					<p>Period: {fmt(p_.T)} hrs
						<StoreValueButton label="Period" getter={() => dlData?.fitResult?.parameters?.T} defaultName="dlog_period" source="Double Logistic" />
					</p>
					<p>Onset phase: {fmt(fr.onsetPhase)} hrs
						<StoreValueButton label="Onset phase" getter={() => dlData?.fitResult?.onsetPhase} defaultName="dlog_onset" source="Double Logistic" />
					</p>
					<p>Offset phase: {fmt(fr.offsetPhase)} hrs
						<StoreValueButton label="Offset phase" getter={() => dlData?.fitResult?.offsetPhase} defaultName="dlog_offset" source="Double Logistic" />
					</p>
					<p>Duty cycle: {fmt(fr.dutyCycle != null ? fr.dutyCycle * 100 : null, 1)}%
						<StoreValueButton label="Duty cycle" getter={() => dlData?.fitResult?.dutyCycle} defaultName="dlog_dutycycle" source="Double Logistic" />
					</p>
					<p>Rise rate (k1): {fmt(p_.k1, 4)} /hr
						<StoreValueButton label="Rise rate" getter={() => dlData?.fitResult?.parameters?.k1} defaultName="dlog_k1" source="Double Logistic" />
					</p>
					<p>Fall rate (k2): {fmt(p_.k2, 4)} /hr
						<StoreValueButton label="Fall rate" getter={() => dlData?.fitResult?.parameters?.k2} defaultName="dlog_k2" source="Double Logistic" />
					</p>
					<p>Amplitude (A): {fmt(p_.A)}
						<StoreValueButton label="Amplitude" getter={() => dlData?.fitResult?.parameters?.A} defaultName="dlog_amplitude" source="Double Logistic" />
					</p>
					<p>Mesor (M): {fmt(p_.M)}
						<StoreValueButton label="Mesor" getter={() => dlData?.fitResult?.parameters?.M} defaultName="dlog_mesor" source="Double Logistic" />
					</p>
					<p>RMSE: {fmt(fr.rmse)}
						<StoreValueButton label="RMSE" getter={() => dlData?.fitResult?.rmse} defaultName="dlog_rmse" source="Double Logistic" />
					</p>
					<p>R²: {fmt(fr.rSquared)}
						<StoreValueButton label="R²" getter={() => dlData?.fitResult?.rSquared} defaultName="dlog_r2" source="Double Logistic" />
					</p>
				</div>
			</div>
			{@const xData = dlData.outputXData ?? dlData.t}
			{@const yData = dlData.fitted}
			{@const totalRows = xData.length}
			<Table
				headers={['x', dlData.outputXData ? 'predicted y' : 'fitted y']}
				data={[
					xData.slice(previewStart - 1, previewStart + 5).map((x) =>
						xIsTime && dlData.originTime_ms != null
							? {
									isTime: true,
									raw: formatTimeFromUNIX(dlData.originTime_ms + x * 3600000),
									computed: fmt(x, 2)
								}
							: fmt(x, 2)
					),
					yData.slice(previewStart - 1, previewStart + 5).map((y) => fmt(y, 2))
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
			<p>Need valid inputs to fit a double logistic.</p>
		{/if}
	</div>
</div>
