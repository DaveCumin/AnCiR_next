<script module>
	import { core } from '$lib/core/core.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import { fitRectangularWave, evaluateRectWaveAtPoints } from '$lib/utils/rectwave.js';

	export const rectangularwave_displayName = 'Rectangular Wave';

	export const rectangularwave_defaults = new Map([
		['xIN', { val: -1 }],
		['yIN', { val: -1 }],
		['outputX', { val: -1 }],
		['fixKappa', { val: false }],
		['fixedKappa', { val: 5 }],
		['fixOmega', { val: false }],
		['fixedPeriod', { val: 24 }],
		['fixDutyCycle', { val: false }],
		['fixedDutyCycle', { val: 0.5 }],
		['out', { rectwavex: { val: -1 }, rectwavey: { val: -1 } }],
		['valid', { val: false }]
	]);

	export function rectangularwave(argsIN) {
		const xIN = argsIN.xIN;
		const yIN = argsIN.yIN;
		const outputXId = argsIN.outputX;
		const xOUT = argsIN.out.rectwavex;
		const yOUT = argsIN.out.rectwavey;
		const fixKappa = argsIN.fixKappa ?? false;
		const fixedKappa = argsIN.fixedKappa ?? 5;
		const fixOmega = argsIN.fixOmega ?? false;
		const fixedPeriod = argsIN.fixedPeriod ?? 24;
		const fixDutyCycle = argsIN.fixDutyCycle ?? false;
		const fixedDutyCycle = argsIN.fixedDutyCycle ?? 0.5;

		let result = null;
		let valid = false;

		const canRun =
			xIN != -1 &&
			yIN != -1 &&
			getColumnById(xIN) &&
			getColumnById(yIN);

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

			// Get outputX data if specified
			let outputXData = null;
			if (outputXId != -1 && getColumnById(outputXId)) {
				const outputXCol = getColumnById(outputXId);
				outputXData =
					outputXCol.type === 'time' ? outputXCol.hoursSinceStart : outputXCol.getData();
				outputXData = outputXData.filter((v) => !isNaN(v));
			}

			// Determine origin time for time columns
			let originTime_ms = null;
			if (outputXId != -1) {
				const outputXColForOrigin = getColumnById(outputXId);
				if (outputXColForOrigin && outputXColForOrigin.type === 'time') {
					originTime_ms = outputXColForOrigin.getData()[0];
				}
			}
			if (originTime_ms == null && tCol.type === 'time') {
				originTime_ms = tCol.getData()[0];
			}

			const fixedOmega = fixOmega ? (2 * Math.PI) / fixedPeriod : null;

			const fitResult = fitRectangularWave(tt, yy, {
				fixKappa,
				fixOmega,
				fixDutyCycle,
				fixedKappa,
				fixedOmega,
				fixedDutyCycle
			});

			if (fitResult) {
				valid = true;
				const xOutData = outputXData ?? tt;
				const yOutData = outputXData
					? evaluateRectWaveAtPoints(fitResult.parameters, outputXData)
					: fitResult.fitted;

				if (xOUT != -1 && yOUT != -1) {
					const xColOut = getColumnById(xOUT);
					const yColOut = getColumnById(yOUT);
					if (xColOut && yColOut) {
						const xOutMs =
							originTime_ms != null
								? xOutData.map((h) => originTime_ms + h * 3600000)
								: xOutData;
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

				result = {
					t: tt,
					outputXData,
					fitResult,
					fitted: yOutData,
					originTime_ms
				};
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

	// Backwards compatibility — initialise any fields absent in older saved sessions
	if (p.args.fixKappa === undefined) p.args.fixKappa = false;
	if (p.args.fixedKappa === undefined) p.args.fixedKappa = 5;
	if (p.args.fixOmega === undefined) p.args.fixOmega = false;
	if (p.args.fixedPeriod === undefined) p.args.fixedPeriod = 24;
	if (p.args.fixDutyCycle === undefined) p.args.fixDutyCycle = false;
	if (p.args.fixedDutyCycle === undefined) p.args.fixedDutyCycle = 0.5;

	let rwave = $state(null);
	let showOutputX = $state(p.args.outputX !== -1);
	let mounted = $state(false);
	let previewStart = $state(1);
	let calculating = $state(false);
	let _calcToken = 0;

	// Reactivity: re-run when input data or fixed-parameter settings change
	let xIN_col = $derived.by(() => (p.args.xIN >= 0 ? getColumnById(p.args.xIN) : null));
	let yIN_col = $derived.by(() => (p.args.yIN >= 0 ? getColumnById(p.args.yIN) : null));
	let outputX_col = $derived.by(() => (p.args.outputX >= 0 ? getColumnById(p.args.outputX) : null));
	let xIsTime = $derived(xIN_col?.type === 'time' || outputX_col?.type === 'time');

	let getHash = $derived.by(() => {
		let out = '';
		out += xIN_col?.getDataHash;
		out += yIN_col?.getDataHash;
		out += outputX_col?.getDataHash;
		out += p.args.fixKappa;
		out += p.args.fixOmega;
		out += p.args.fixDutyCycle;
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
					[rwave, p.args.valid] = rectangularwave(p.args);
					calculating = false;
				});
			}, 0);
		}
	});

	function getRwave() {
		previewStart = 1;
		calculating = true;
		const token = ++_calcToken;
		setTimeout(() => {
			if (token !== _calcToken) return;
			[rwave, p.args.valid] = rectangularwave(p.args);
			calculating = false;
		}, 0);
	}

	onMount(() => {
		const xKey = p.args.out.rectwavex;
		const yKey = p.args.out.rectwavey;
		if (
			xKey >= 0 &&
			yKey >= 0 &&
			core.rawData.has(xKey) &&
			core.rawData.get(xKey).length > 0
		) {
			// Show the saved curve immediately while the re-fit runs in the background.
			rwave = {
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
		if (!checked) {
			p.args.outputX = -1;
		} else {
			p.args.outputX = p.args.xIN;
		}
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
		<span>Wave parameters</span>
	</div>

	<!-- Sharpness (κ) -->
	<div class="control-input-horizontal">
		<div class="control-input-checkbox">
			<input type="checkbox" bind:checked={p.args.fixKappa} onchange={getRwave} />
			<p>Fix sharpness (κ)</p>
		</div>
	</div>
	{#if p.args.fixKappa}
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>κ value</p>
				<NumberWithUnits
					bind:value={p.args.fixedKappa}
					min="0.1"
					step="0.5"
					onInput={getRwave}
				/>
			</div>
		</div>
	{/if}

	<!-- Period (ω) -->
	<div class="control-input-horizontal">
		<div class="control-input-checkbox">
			<input type="checkbox" bind:checked={p.args.fixOmega} onchange={getRwave} />
			<p>Fix period</p>
		</div>
	</div>
	{#if p.args.fixOmega}
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>Period</p>
				<NumberWithUnits
					bind:value={p.args.fixedPeriod}
					min="0.1"
					step="0.5"
					units={{
						default: 'hrs',
						days: 24,
						hrs: 1,
						mins: 1 / 60,
						secs: 1 / (60 * 60)
					}}
					onInput={getRwave}
				/>
			</div>
		</div>
	{/if}

	<!-- Duty cycle (d) -->
	<div class="control-input-horizontal">
		<div class="control-input-checkbox">
			<input type="checkbox" bind:checked={p.args.fixDutyCycle} onchange={getRwave} />
			<p>Fix duty cycle</p>
		</div>
	</div>
	{#if p.args.fixDutyCycle}
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>Duty cycle (0–1)</p>
				<NumberWithUnits
					bind:value={p.args.fixedDutyCycle}
					min="0.01"
					max="0.99"
					step="0.05"
					onInput={getRwave}
				/>
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
					excludeColIds={[p.args.out.rectwavex, p.args.out.rectwavey]}
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
			<LoadingSpinner message="Fitting rectangular wave…" />
		{:else if p.args.valid && p.args.out.rectwavex != -1 && p.args.out.rectwavey != -1}
			{@const xout = getColumnById(p.args.out.rectwavex)}
			<ColumnComponent col={xout} />
			{@const yout = getColumnById(p.args.out.rectwavey)}
			<ColumnComponent col={yout} />
			{#if rwave?.fitResult}
				{@const fr = rwave.fitResult}
				<div class="control-input-horizontal">
					<div class="control-input">
						<p>
							Period: {fr.period.toFixed(3)} hrs
							<StoreValueButton
								label="Period"
								getter={() => rwave?.fitResult?.period}
								defaultName="rectwave_period"
								source="Rectangular Wave"
							/>
						</p>
						<p>
							Acrophase: {fr.acrophase.toFixed(3)} hrs
							<StoreValueButton
								label="Acrophase"
								getter={() => rwave?.fitResult?.acrophase}
								defaultName="rectwave_acrophase"
								source="Rectangular Wave"
							/>
						</p>
						<p>
							Duty cycle: {(fr.parameters.dutyCycle * 100).toFixed(1)}%
							<StoreValueButton
								label="Duty cycle"
								getter={() => rwave?.fitResult?.parameters?.dutyCycle}
								defaultName="rectwave_dutycycle"
								source="Rectangular Wave"
							/>
						</p>
						<p>
							Sharpness (κ): {fr.parameters.kappa.toFixed(3)}
							<StoreValueButton
								label="Kappa"
								getter={() => rwave?.fitResult?.parameters?.kappa}
								defaultName="rectwave_kappa"
								source="Rectangular Wave"
							/>
						</p>
						<p>
							Half-amplitude (A): {fr.parameters.A.toFixed(3)}
							<StoreValueButton
								label="Half-amplitude"
								getter={() => rwave?.fitResult?.parameters?.A}
								defaultName="rectwave_amplitude"
								source="Rectangular Wave"
							/>
						</p>
						<p>
							Mesor (M): {fr.parameters.M.toFixed(3)}
							<StoreValueButton
								label="Mesor"
								getter={() => rwave?.fitResult?.parameters?.M}
								defaultName="rectwave_mesor"
								source="Rectangular Wave"
							/>
						</p>
						<p>
							RMSE: {fr.rmse.toFixed(3)}
							<StoreValueButton
								label="RMSE"
								getter={() => rwave?.fitResult?.rmse}
								defaultName="rectwave_rmse"
								source="Rectangular Wave"
							/>
						</p>
						<p>
							R²: {fr.rSquared.toFixed(3)}
							<StoreValueButton
								label="R²"
								getter={() => rwave?.fitResult?.rSquared}
								defaultName="rectwave_r2"
								source="Rectangular Wave"
							/>
						</p>
					</div>
				</div>
			{/if}
		{:else if p.args.valid && rwave?.fitResult}
			{@const fr = rwave.fitResult}
			<p>Preview:</p>
			<div class="control-input-horizontal">
				<div class="control-input">
					<p>
						Period: {fr.period.toFixed(3)} hrs
						<StoreValueButton
							label="Period"
							getter={() => rwave?.fitResult?.period}
							defaultName="rectwave_period"
							source="Rectangular Wave"
						/>
					</p>
					<p>
						Acrophase: {fr.acrophase.toFixed(3)} hrs
						<StoreValueButton
							label="Acrophase"
							getter={() => rwave?.fitResult?.acrophase}
							defaultName="rectwave_acrophase"
							source="Rectangular Wave"
						/>
					</p>
					<p>
						Duty cycle: {(fr.parameters.dutyCycle * 100).toFixed(1)}%
						<StoreValueButton
							label="Duty cycle"
							getter={() => rwave?.fitResult?.parameters?.dutyCycle}
							defaultName="rectwave_dutycycle"
							source="Rectangular Wave"
						/>
					</p>
					<p>
						Sharpness (κ): {fr.parameters.kappa.toFixed(3)}
						<StoreValueButton
							label="Kappa"
							getter={() => rwave?.fitResult?.parameters?.kappa}
							defaultName="rectwave_kappa"
							source="Rectangular Wave"
						/>
					</p>
					<p>
						Half-amplitude (A): {fr.parameters.A.toFixed(3)}
						<StoreValueButton
							label="Half-amplitude"
							getter={() => rwave?.fitResult?.parameters?.A}
							defaultName="rectwave_amplitude"
							source="Rectangular Wave"
						/>
					</p>
					<p>
						Mesor (M): {fr.parameters.M.toFixed(3)}
						<StoreValueButton
							label="Mesor"
							getter={() => rwave?.fitResult?.parameters?.M}
							defaultName="rectwave_mesor"
							source="Rectangular Wave"
						/>
					</p>
					<p>
						RMSE: {fr.rmse.toFixed(3)}
						<StoreValueButton
							label="RMSE"
							getter={() => rwave?.fitResult?.rmse}
							defaultName="rectwave_rmse"
							source="Rectangular Wave"
						/>
					</p>
					<p>
						R²: {fr.rSquared.toFixed(3)}
						<StoreValueButton
							label="R²"
							getter={() => rwave?.fitResult?.rSquared}
							defaultName="rectwave_r2"
							source="Rectangular Wave"
						/>
					</p>
				</div>
			</div>
			{@const xData = rwave.outputXData ?? rwave.t}
			{@const yData = rwave.fitted}
			{@const totalRows = xData.length}
			<Table
				headers={['x', rwave.outputXData ? 'predicted y' : 'fitted y']}
				data={[
					xData.slice(previewStart - 1, previewStart + 5).map((x) =>
						xIsTime && rwave.originTime_ms != null
							? {
									isTime: true,
									raw: formatTimeFromUNIX(rwave.originTime_ms + x * 3600000),
									computed: x.toFixed(2)
								}
							: x.toFixed(2)
					),
					yData.slice(previewStart - 1, previewStart + 5).map((y) => y.toFixed(2))
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
			<p>Need valid inputs to fit a rectangular wave.</p>
		{/if}
	</div>
</div>
