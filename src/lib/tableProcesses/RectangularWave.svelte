<script module>
	import { core, appConsts } from '$lib/core/core.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import { fitRectangularWave, evaluateRectWaveAtPoints } from '$lib/utils/rectwave.js';

	const displayName = 'Rectangular Wave';
	const defaults = new Map([
		['xIN', { val: -1 }],
		['yIN', { val: [] }],
		['outputX', { val: -1 }],
		['fixKappa', { val: false }],
		['fixedKappa', { val: 5 }],
		['fixOmega', { val: false }],
		['fixedPeriod', { val: 24 }],
		['fixDutyCycle', { val: false }],
		['fixedDutyCycle', { val: 0.5 }],
		['out', { rectwavex: { val: -1 } }],
		['valid', { val: false }],
		['forcollected', { val: true }],
		['collectedType', { val: 'rectwave' }],
		['preProcesses', { val: [] }],
		['tableProcesses', { val: [] }]
	]);

	export const definition = {
		displayName,
		defaults,
		func: rectangularwave,
		xOutKey: 'rectwavex',
		yOutKeyPrefix: 'rectwavey_'
	};

	export function rectangularwave(argsIN) {
		const xIN = argsIN.xIN;
		let yINs = argsIN.yIN;
		if (!Array.isArray(yINs)) yINs = yINs != null && yINs !== -1 ? [yINs] : [];
		const outputXId = argsIN.outputX;
		const xOUT = argsIN.out.rectwavex;
		const fixKappa = argsIN.fixKappa ?? false;
		const fixedKappa = argsIN.fixedKappa ?? 5;
		const fixOmega = argsIN.fixOmega ?? false;
		const fixedPeriod = argsIN.fixedPeriod ?? 24;
		const fixDutyCycle = argsIN.fixDutyCycle ?? false;
		const fixedDutyCycle = argsIN.fixedDutyCycle ?? 0.5;

		let result = {
			t: [],
			outputXData: null,
			y_results: {},
			originTime_ms: null
		};
		let anyValid = false;

		const canRunBase = xIN != -1 && getColumnById(xIN) && yINs.length > 0;
		if (!canRunBase) return [result, false];

		const tCol = getColumnById(xIN);
		const t = tCol.type === 'time' ? tCol.hoursSinceStart : tCol.getData();

		// Get outputX data if specified
		let outputXData = null;
		if (outputXId != -1 && getColumnById(outputXId)) {
			const outputXCol = getColumnById(outputXId);
			outputXData = outputXCol.type === 'time' ? outputXCol.hoursSinceStart : outputXCol.getData();
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

		result.outputXData = outputXData;
		result.originTime_ms = originTime_ms;

		const fixedOmega = fixOmega ? (2 * Math.PI) / fixedPeriod : null;

		for (const yId of yINs) {
			if (yId == null || yId === -1) continue;
			const yCol = getColumnById(yId);
			if (!yCol) continue;

			const y = yCol.getData();
			const validIndices = t
				.map((v, i) => (isNaN(v) || isNaN(y[i]) ? -1 : i))
				.filter((i) => i !== -1);
			const tt = validIndices.map((i) => t[i]);
			const yy = validIndices.map((i) => y[i]);

			if (tt.length < 4) continue;

			const fitResult = fitRectangularWave(tt, yy, {
				fixKappa,
				fixOmega,
				fixDutyCycle,
				fixedKappa,
				fixedOmega,
				fixedDutyCycle
			});

			if (fitResult) {
				const xOutData = outputXData ?? tt;
				const yOutData = outputXData
					? evaluateRectWaveAtPoints(fitResult.parameters, outputXData)
					: fitResult.fitted;

				result.y_results[yId] = {
					fitResult,
					fitted: yOutData,
					t: tt,
					xOutData,
					yOutData
				};
				if (result.t.length === 0) result.t = tt;
				anyValid = true;
			}
		}

		// Apply pre-processes to y results before writing
		for (const pp of argsIN.preProcesses ?? []) {
			if (!pp.processName) continue;
			const proc = appConsts.processMap.get(pp.processName);
			if (proc?.func) {
				for (const yId of yINs) {
					if (result.y_results[yId]) {
						result.y_results[yId].yOutData = proc.func(
							result.y_results[yId].yOutData,
							pp.processArgs ?? {}
						);
					}
				}
			}
		}

		// Write output columns
		if (anyValid && xOUT !== -1) {
			const processHash = crypto.randomUUID();

			const firstYId = Object.keys(result.y_results)[0];
			const firstYResult = result.y_results[firstYId];
			const xOutData = firstYResult.xOutData ?? outputXData ?? firstYResult.t;
			const xOutMs =
				originTime_ms != null ? xOutData.map((h) => originTime_ms + h * 3600000) : xOutData;
			const xColOut = getColumnById(xOUT);
			if (xColOut) {
				core.rawData.set(xOUT, xOutMs);
				xColOut.data = xOUT;
				xColOut.type = originTime_ms != null ? 'time' : 'number';
				if (originTime_ms != null) xColOut.timeFormat = null;
				xColOut.tableProcessGUId = processHash;
			}

			for (const yId of yINs) {
				const outKey = 'rectwavey_' + yId;
				const yOUT = argsIN.out[outKey];
				const yResult = result.y_results[yId];
				if (yOUT != null && yOUT !== -1 && yResult) {
					const yColOut = getColumnById(yOUT);
					if (yColOut) {
						core.rawData.set(yOUT, yResult.yOutData);
						yColOut.data = yOUT;
						yColOut.type = 'number';
						yColOut.tableProcessGUId = processHash;
					}
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
	import StoreValueButton from '$lib/components/inputs/StoreValueButton.svelte';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';

	import { Column, getColumnById } from '$lib/core/Column.svelte';
	import { pushObj } from '$lib/core/core.svelte.js';
	import { useMultiYTP } from '$lib/tableProcesses/useMultiYTP.svelte.js';
	import { formatTimeFromUNIX } from '$lib/utils/time/TimeUtils.js';
	import { onMount, untrack } from 'svelte';
	import {
		showStaticDataAsTable,
		saveStaticDataAsCSV
	} from '$lib/components/plotbits/helpers/save.svelte.js';

	let { p = $bindable(), hideInputs = false } = $props();

	// Backward compat: convert legacy single yIN to array
	if (typeof p.args.yIN === 'number') {
		p.args.yIN = p.args.yIN !== -1 ? [p.args.yIN] : [];
	}

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

	const { syncYColumns, initYColumns } = useMultiYTP(p, 'rectwavey_', 'rectwave_');

	// Reactivity: re-run when input data or fixed-parameter settings change
	let xIN_col = $derived.by(() => (p.args.xIN >= 0 ? getColumnById(p.args.xIN) : null));
	let outputX_col = $derived.by(() => (p.args.outputX >= 0 ? getColumnById(p.args.outputX) : null));
	let xIsTime = $derived(xIN_col?.type === 'time' || outputX_col?.type === 'time');

	let getHash = $derived.by(() => {
		let out = '';
		out += xIN_col?.getDataHash;
		for (const yId of p.args.yIN ?? []) {
			const col = yId >= 0 ? getColumnById(yId) : null;
			out += col?.getDataHash ?? '';
		}
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

	function onYSelectionChange() {
		if (syncYColumns()) getRwave();
	}

	function getRwave() {
		previewStart = 1;
		calculating = true;
		const token = ++_calcToken;
		setTimeout(() => {
			if (token !== _calcToken) return;
			[rwave, p.args.valid] = rectangularwave(p.args);
			calculating = false;
			lastHash = getHash;
		}, 0);
	}

	// Exclude own output column IDs from the Y selector
	let yExcludeIds = $derived.by(() => {
		const ids = [p.args.xIN];
		if (p.args.out.rectwavex >= 0) ids.push(p.args.out.rectwavex);
		for (const key of Object.keys(p.args.out)) {
			if (key.startsWith('rectwavey_') && p.args.out[key] >= 0) {
				ids.push(p.args.out[key]);
			}
		}
		return ids;
	});

	$effect(() => {
		const _yIN = p.args.yIN;
		if (!mounted) return;
		untrack(() => onYSelectionChange());
	});

	onMount(() => {
		// Create X output column if not present (needed in collected mode)
		let needsCompute = false;
		if (p.args.out.rectwavex == null || p.args.out.rectwavex < 0) {
			if (p.parent) {
				const xCol = new Column({});
				xCol.name = 'rectwavex_' + p.id;
				pushObj(xCol);
				p.parent.columnRefs = [xCol.id, ...p.parent.columnRefs];
				p.args.out.rectwavex = xCol.id;
				needsCompute = true;
			}
		}
		// Create output columns for any Y inputs that don't have them yet
		if (initYColumns()) needsCompute = true;

		if (needsCompute) {
			getRwave();
		} else {
			const xKey = p.args.out.rectwavex;
			if (xKey >= 0 && core.rawData.has(xKey) && core.rawData.get(xKey).length > 0) {
				// Check if any input columns have been replaced since session was saved
				const inputsAreStale =
					(p.args.xIN >= 0 && (getColumnById(p.args.xIN)?.rawDataVersion ?? 0) > 0) ||
					(p.args.yIN ?? []).some((id) => (getColumnById(id)?.rawDataVersion ?? 0) > 0);
				if (!inputsAreStale) {
					const y_results = {};
					for (const yId of p.args.yIN ?? []) {
						const outKey = 'rectwavey_' + yId;
						const yOutId = p.args.out[outKey];
						if (yOutId >= 0 && core.rawData.has(yOutId)) {
							y_results[yId] = {
								fitResult: null,
								fitted: core.rawData.get(yOutId),
								t: core.rawData.get(xKey)
							};
						}
					}
					rwave = {
						t: core.rawData.get(xKey),
						outputXData: null,
						y_results,
						originTime_ms: null
					};
					p.args.valid = true;
				}
				// Note: lastHash is NOT set here, so $effect will always fire after mount
				// and recompute from current inputs regardless of staleness
			}
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

	function getRwaveStatsData() {
		if (!rwave?.y_results) return { headers: [], rows: [] };
		const validEntries = Object.entries(rwave.y_results).filter(([, r]) => r.fitResult);
		if (!validEntries.length) return { headers: [], rows: [] };
		const headers = [
			'column',
			'rmse',
			'r2',
			'period',
			'acrophase',
			'duty_cycle',
			'kappa',
			'M',
			'A'
		];
		const rows = validEntries.map(([yId, r]) => {
			const name = getColumnById(Number(yId))?.name ?? String(yId);
			const fr = r.fitResult;
			return [
				name,
				fr.rmse,
				fr.rSquared,
				fr.period,
				fr.acrophase,
				fr.parameters?.dutyCycle,
				fr.parameters?.kappa,
				fr.parameters?.M,
				fr.parameters?.A
			];
		});
		return { headers, rows };
	}
</script>

{#if !hideInputs}
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
{/if}

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
				<NumberWithUnits bind:value={p.args.fixedKappa} min="0.1" step="0.5" onInput={getRwave} />
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

	{#if !hideInputs}
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
					<ColumnSelector bind:value={p.args.outputX} excludeColIds={yExcludeIds} />
				</div>
			</div>
		{/if}
	{/if}
</div>

{#snippet rwaveStats(yResult, yName)}
	{#if yResult?.fitResult}
		{@const fr = yResult.fitResult}
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>
					Period: {fr.period.toFixed(3)} hrs
					<StoreValueButton
						label="Period"
						getter={() => yResult?.fitResult?.period}
						defaultName={`rectwave_period_${yName}`}
						source="Rectangular Wave"
					/>
				</p>
				<p>
					Acrophase: {fr.acrophase.toFixed(3)} hrs
					<StoreValueButton
						label="Acrophase"
						getter={() => yResult?.fitResult?.acrophase}
						defaultName={`rectwave_acrophase_${yName}`}
						source="Rectangular Wave"
					/>
				</p>
				<p>
					Duty cycle: {(fr.parameters.dutyCycle * 100).toFixed(1)}%
					<StoreValueButton
						label="Duty cycle"
						getter={() => yResult?.fitResult?.parameters?.dutyCycle}
						defaultName={`rectwave_dutycycle_${yName}`}
						source="Rectangular Wave"
					/>
				</p>
				<p>
					Sharpness (κ): {fr.parameters.kappa.toFixed(3)}
					<StoreValueButton
						label="Kappa"
						getter={() => yResult?.fitResult?.parameters?.kappa}
						defaultName={`rectwave_kappa_${yName}`}
						source="Rectangular Wave"
					/>
				</p>
				<p>
					Half-amplitude (A): {fr.parameters.A.toFixed(3)}
					<StoreValueButton
						label="Half-amplitude"
						getter={() => yResult?.fitResult?.parameters?.A}
						defaultName={`rectwave_amplitude_${yName}`}
						source="Rectangular Wave"
					/>
				</p>
				<p>
					Mesor (M): {fr.parameters.M.toFixed(3)}
					<StoreValueButton
						label="Mesor"
						getter={() => yResult?.fitResult?.parameters?.M}
						defaultName={`rectwave_mesor_${yName}`}
						source="Rectangular Wave"
					/>
				</p>
				<p>
					RMSE: {fr.rmse.toFixed(3)}
					<StoreValueButton
						label="RMSE"
						getter={() => yResult?.fitResult?.rmse}
						defaultName={`rectwave_rmse_${yName}`}
						source="Rectangular Wave"
					/>
				</p>
				<p>
					R²: {fr.rSquared.toFixed(3)}
					<StoreValueButton
						label="R²"
						getter={() => yResult?.fitResult?.rSquared}
						defaultName={`rectwave_r2_${yName}`}
						source="Rectangular Wave"
					/>
				</p>
			</div>
		</div>
	{/if}
{/snippet}

<!-- Output -->
<details open>
	<summary class="section-details-summary">Output</summary>
	<div class="section-row">
		<div class="section-content">
			{#if calculating}
				<LoadingSpinner message="Fitting rectangular wave…" />
			{:else if p.args.valid && p.args.out.rectwavex != -1}
				{@const xout = getColumnById(p.args.out.rectwavex)}
				<div class="tp-outputs">
					<div class="tp-output-row">
						<span class="tp-output-label">{getColumnById(p.args.xIN)?.name ?? 'x'} (shared)</span>
						<ColumnComponent col={xout} />
					</div>
					{#each p.args.yIN ?? [] as yId}
						{@const outKey = 'rectwavey_' + yId}
						{@const yOutId = p.args.out[outKey]}
						{#if yOutId >= 0}
							{@const yout = getColumnById(yOutId)}
							{#if yout}
								{@const yResult = rwave?.y_results?.[yId]}
								{@const srcName = getColumnById(Number(yId))?.name ?? yId}
								<div class="tp-output-row">
									<span class="tp-output-label">{srcName}</span>
									<ColumnComponent col={yout} />
									{#if yResult}
										{@render rwaveStats(yResult, srcName)}
									{/if}
								</div>
							{/if}
						{/if}
					{/each}
				</div>
			{:else if p.args.valid}
				<p>Preview:</p>
				{#each Object.entries(rwave?.y_results ?? {}) as [yId, yResult]}
					{@const srcName = getColumnById(Number(yId))?.name ?? yId}
					<div class="div-line"></div>
					<p><strong>{srcName}</strong></p>
					{@render rwaveStats(yResult, srcName)}
				{/each}
				{@const xData = rwave.outputXData ?? rwave.t}
				{@const yIds = Object.keys(rwave?.y_results ?? {})}
				{@const totalRows = xData.length}
				<Table
					headers={[
						'x',
						...yIds.map(
							(id) =>
								(rwave.outputXData ? 'predicted ' : 'fitted ') +
								(getColumnById(Number(id))?.name ?? id)
						)
					]}
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
						...yIds.map((id) => {
							const yr = rwave.y_results[id];
							return yr.fitted.slice(previewStart - 1, previewStart + 5).map((y) => y.toFixed(2));
						})
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
</details>
{#if !calculating && p.args.valid && p.args.out.rectwavex != -1}
	<div class="tp-stat-actions">
		<button
			class="tp-stat-btn"
			onclick={() => {
				const { headers, rows } = getRwaveStatsData();
				showStaticDataAsTable('Rectangular wave stats', headers, rows, getRwaveStatsData);
			}}>View stats</button
		>
		<button
			class="tp-stat-btn"
			onclick={() => {
				const { headers, rows } = getRwaveStatsData();
				saveStaticDataAsCSV('rectwave_stats', headers, rows);
			}}>Download stats</button
		>
	</div>
{/if}

<style>
	.tp-stat-actions {
		display: flex;
		gap: 0.4rem;
		margin-top: 0.3rem;
	}

	.tp-stat-btn {
		font-size: 11px;
		padding: 0.25rem 0.5rem;
		border: 1px solid var(--color-lightness-75, #aaa);
		border-radius: 3px;
		background: none;
		cursor: pointer;
		color: var(--color-lightness-35, #555);
	}

	.tp-stat-btn:hover {
		background: var(--color-lightness-95);
		border-color: var(--color-lightness-55, #888);
	}
</style>
