<script module>
	import { core } from '$lib/core/core.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import { fitCosineCurves, evaluateCosinorAtPoints, fitCosinorFixed } from '$lib/utils/cosinor.js';

	export const cosinor_defaults = new Map([
		['xIN', { val: -1 }],
		['yIN', { val: [] }],
		['Ncurves', { val: 0 }],
		['outputX', { val: -1 }],
		['out', { cosinorx: { val: -1 } }],
		['valid', { val: false }],
		['useFixedPeriod', { val: false }],
		['fixedPeriod', { val: 24 }],
		['nHarmonics', { val: 1 }],
		['alpha', { val: 0.05 }]
	]);

	export function cosinor(argsIN) {
		const xIN = argsIN.xIN;
		let yINs = argsIN.yIN;
		if (!Array.isArray(yINs)) yINs = yINs != null && yINs !== -1 ? [yINs] : [];
		const Ncurves = argsIN.Ncurves;
		const outputXId = argsIN.outputX;
		const xOUT = argsIN.out.cosinorx;
		const useFixedPeriod = argsIN.useFixedPeriod ?? false;
		const fixedPeriod = argsIN.fixedPeriod ?? 24;
		const nHarmonics = argsIN.nHarmonics ?? 1;
		const alpha = argsIN.alpha ?? 0.05;

		let result = {
			t: [],
			outputXData: null,
			y_results: {},
			originTime_ms: null
		};
		let anyValid = false;

		const canRunBase =
			xIN != -1 &&
			getColumnById(xIN) &&
			yINs.length > 0 &&
			(useFixedPeriod ? nHarmonics >= 1 : Ncurves >= 1);

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

		// Determine origin time for converting hours → ms on the x output
		let originTime_ms = null;
		if (outputXId != -1) {
			const _outputXColForOrigin = getColumnById(outputXId);
			if (_outputXColForOrigin && _outputXColForOrigin.type === 'time') {
				originTime_ms = _outputXColForOrigin.getData()[0];
			}
		}
		if (originTime_ms == null && tCol.type === 'time') {
			originTime_ms = tCol.getData()[0];
		}

		result.outputXData = outputXData;
		result.originTime_ms = originTime_ms;

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

			if (tt.length === 0) continue;

			let yResult = {
				fittedData: { fitted: [], parameters: { cosines: [] }, rmse: NaN, rSquared: NaN },
				fixedStats: null,
				predicted: null,
				t: tt,
				xOutData: null,
				yOutData: null
			};

			if (useFixedPeriod) {
				const fixedResult = fitCosinorFixed(tt, yy, fixedPeriod, nHarmonics, alpha);
				if (fixedResult) {
					const omega = (2 * Math.PI) / fixedPeriod;
					const xOutData = outputXData ?? tt;
					const yOutData = outputXData
						? outputXData.map((ti) => {
								let val = fixedResult.M;
								for (const h of fixedResult.harmonics) {
									val += h.beta * Math.cos(h.k * omega * ti) + h.gamma * Math.sin(h.k * omega * ti);
								}
								return val;
							})
						: fixedResult.fitted;

					yResult = {
						fittedData: {
							fitted: fixedResult.fitted,
							parameters: {
								cosines: fixedResult.harmonics.map((h) => ({
									amplitude: h.amplitude,
									frequency: (2 * Math.PI * h.k) / fixedPeriod,
									phase: h.phi_rad
								}))
							},
							rmse: fixedResult.RMSE,
							rSquared: fixedResult.R2
						},
						fixedStats: fixedResult,
						predicted: outputXData ? yOutData : null,
						t: tt,
						xOutData,
						yOutData
					};
					anyValid = true;
				}
			} else {
				const fittedData = fitCosineCurves(tt, yy, Ncurves);
				const predicted = outputXData
					? evaluateCosinorAtPoints(fittedData.parameters, outputXData)
					: null;

				yResult = {
					fittedData: { ...fittedData },
					fixedStats: null,
					predicted,
					t: tt,
					xOutData: outputXData ?? tt,
					yOutData: predicted ?? fittedData.fitted
				};
				if (fittedData.fitted.length > 0) anyValid = true;
			}

			result.y_results[yId] = yResult;
			if (result.t.length === 0) result.t = tt;
		}

		// Write output columns
		if (anyValid && xOUT !== -1) {
			const processHash = crypto.randomUUID();

			// Use first valid Y's x output data for the shared X column
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
				const outKey = 'cosinory_' + yId;
				const yOUT = argsIN.out[outKey];
				const yResult = result.y_results[yId];
				if (yOUT != null && yOUT !== -1 && yResult) {
					const yOutData = yResult.yOutData ?? yResult.predicted ?? yResult.fittedData.fitted;
					const yColOut = getColumnById(yOUT);
					if (yColOut) {
						core.rawData.set(yOUT, yOutData);
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

	import { Column, getColumnById, removeColumn } from '$lib/core/Column.svelte';
	import { pushObj } from '$lib/core/core.svelte.js';
	import { formatTimeFromUNIX } from '$lib/utils/time/TimeUtils.js';
	import { onMount, untrack } from 'svelte';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';

	let { p = $bindable() } = $props();

	// Backward compat: convert legacy single yIN to array
	if (typeof p.args.yIN === 'number') {
		p.args.yIN = p.args.yIN !== -1 ? [p.args.yIN] : [];
	}

	// Backwards compatibility: initialise fields absent in sessions saved before this version
	if (p.args.useFixedPeriod === undefined) p.args.useFixedPeriod = false;
	if (p.args.fixedPeriod === undefined) p.args.fixedPeriod = 24;
	if (p.args.nHarmonics === undefined) p.args.nHarmonics = 1;
	if (p.args.alpha === undefined) p.args.alpha = 0.05;

	let cosinorData = $state();
	let showOutputX = $state(p.args.outputX !== -1);
	let mounted = $state(false);
	let previewStart = $state(1);
	let calculating = $state(false);
	let _calcToken = 0;

	// Track previous Y IDs to detect what changed (non-reactive)
	let prevYIds = [...(p.args.yIN ?? [])].map(Number);

	// for reactivity -----------
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
		out += p.args.useFixedPeriod;
		return out;
	});
	let lastHash = '';
	$effect(() => {
		const dataHash = getHash;
		if (!mounted) return;
		if (lastHash !== dataHash) {
			lastHash = getHash; // read before untrack so it's tracked
			calculating = true;
			const token = ++_calcToken;
			setTimeout(() => {
				if (token !== _calcToken) return; // superseded by a newer request
				untrack(() => {
					previewStart = 1;
					[cosinorData, p.args.valid] = cosinor(p.args);
					calculating = false;
				});
			}, 0);
		}
	});

	// Called when Y selection changes in the multi-select.
	// bind:value has already updated p.args.yIN, so we compare against prevYIds.
	function onYSelectionChange() {
		const newIds = (p.args.yIN ?? []).map(Number).filter((id) => id >= 0);
		const newSet = new Set(newIds);
		const oldSet = new Set(prevYIds);

		// Skip if no actual change
		if (newIds.length === prevYIds.length && newIds.every((id) => oldSet.has(id))) return;

		// Remove output columns for deselected Y inputs
		for (const oldId of prevYIds) {
			if (!newSet.has(oldId)) {
				const outKey = 'cosinory_' + oldId;
				const outColId = p.args.out[outKey];
				if (outColId != null && outColId >= 0) {
					core.rawData.delete(outColId);
					removeColumn(outColId);
				}
				delete p.args.out[outKey];
			}
		}

		// Create output columns for newly selected Y inputs
		for (const newId of newIds) {
			const outKey = 'cosinory_' + newId;
			if (p.args.out[outKey] == null || p.args.out[outKey] === -1) {
				if (p.parent) {
					const srcName = getColumnById(newId)?.name ?? String(newId);
					const yCol = new Column({});
					yCol.name = 'cosinor_' + srcName + '_' + p.id;
					pushObj(yCol);
					p.parent.columnRefs = [yCol.id, ...p.parent.columnRefs];
					p.args.out[outKey] = yCol.id;
				}
			}
		}

		// Update tracking
		prevYIds = [...newIds];

		// Recompute
		getCosinor();
	}

	//------------
	function getCosinor() {
		previewStart = 1;
		calculating = true;
		const token = ++_calcToken;
		setTimeout(() => {
			if (token !== _calcToken) return;
			[cosinorData, p.args.valid] = cosinor(p.args);
			calculating = false;
			lastHash = getHash;
		}, 0);
	}

	// Exclude own output column IDs from the Y selector
	let yExcludeIds = $derived.by(() => {
		const ids = [p.args.xIN];
		if (p.args.out.cosinorx >= 0) ids.push(p.args.out.cosinorx);
		for (const key of Object.keys(p.args.out)) {
			if (key.startsWith('cosinory_') && p.args.out[key] >= 0) {
				ids.push(p.args.out[key]);
			}
		}
		return ids;
	});

	onMount(() => {
		const xKey = p.args.out.cosinorx;
		if (xKey >= 0 && core.rawData.has(xKey) && core.rawData.get(xKey).length > 0) {
			const y_results = {};
			for (const yId of p.args.yIN ?? []) {
				const outKey = 'cosinory_' + yId;
				const yOutId = p.args.out[outKey];
				if (yOutId >= 0 && core.rawData.has(yOutId)) {
					y_results[yId] = {
						fittedData: {
							fitted: core.rawData.get(yOutId),
							parameters: { cosines: [] },
							rmse: NaN
						},
						fixedStats: null,
						predicted: null,
						t: core.rawData.get(xKey)
					};
				}
			}
			cosinorData = {
				t: core.rawData.get(xKey),
				outputXData: null,
				y_results
			};
			p.args.valid = true;
		}
		lastHash = getHash;
		mounted = true;
	});

	function toggleOutputX(checked) {
		if (!checked) {
			p.args.outputX = -1;
		} else {
			p.args.outputX = p.args.xIN; // default to input X
		}
	}
</script>

<!-- Input Section -->
<div class="section-row">
	<div class="tableProcess-label">
		<span>Input</span>
	</div>

	<div class="control-input-vertical">
		<div class="control-input">
			<p>X column</p>
			<ColumnSelector bind:value={p.args.xIN} />
		</div>

		<div class="control-input-vertical">
			<div class="control-input">
				<p>Y columns</p>
				<ColumnSelector bind:value={p.args.yIN} excludeColIds={yExcludeIds} multiple={true} onChange={onYSelectionChange} />
			</div>
		</div>
	</div>
</div>

<!-- Process Section -->
<div class="section-row">
	<div class="tableProcess-label">
		<span>Cosinor parameters</span>
	</div>

	<div class="control-input-horizontal">
		<div class="control-input">
			<label>
				<input type="checkbox" bind:checked={p.args.useFixedPeriod} />
				Use fixed period
			</label>
		</div>
	</div>

	{#if p.args.useFixedPeriod}
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>Period (hrs)</p>
				<NumberWithUnits
					bind:value={p.args.fixedPeriod}
					onInput={() => getCosinor()}
					min="0.1"
					step="0.5"
				/>
			</div>
			<div class="control-input">
				<p>N harmonics</p>
				<NumberWithUnits
					bind:value={p.args.nHarmonics}
					onInput={() => getCosinor()}
					min="1"
					step="1"
				/>
			</div>
		</div>
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>CI level</p>
				<select bind:value={p.args.alpha} onchange={() => getCosinor()}>
					<option value={0.05}>95%</option>
					<option value={0.01}>99%</option>
				</select>
			</div>
		</div>
	{:else}
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>N cosine curves</p>
				<NumberWithUnits
					bind:value={p.args.Ncurves}
					onInput={() => getCosinor()}
					min="1"
					step="1"
				/>
			</div>
		</div>
	{/if}

	<div class="control-input-horizontal">
		<div class="control-input">
			<label>
				<input
					type="checkbox"
					bind:checked={showOutputX}
					onchange={(e) => toggleOutputX(e.target.checked)}
				/>
				Specify output x values
			</label>
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
</div>

{#snippet cosinorStats(yResult, yName)}
	<div class="control-input-horizontal">
		<div class="control-input">
			<p>
				RMSE: {yResult?.fittedData?.rmse.toFixed(3)}
				<StoreValueButton
					label="RMSE"
					getter={() => yResult?.fittedData?.rmse}
					defaultName={`cosinor_rmse_${yName}`}
					source="Cosinor"
				/>
			</p>
			{#if yResult?.fittedData?.rSquared != null}
				<p>
					R²: {yResult.fittedData.rSquared.toFixed(3)}
					<StoreValueButton
						label="R²"
						getter={() => yResult?.fittedData?.rSquared}
						defaultName={`cosinor_r2_${yName}`}
						source="Cosinor"
					/>
				</p>
			{/if}
		</div>
	</div>
	{#each yResult?.fittedData?.parameters.cosines ?? [] as cosine, i}
		{@const period = 2 * Math.PI * (1 / cosine.frequency)}
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>
					Period: {period.toFixed(2)}
					<StoreValueButton
						label="Period"
						getter={() => {
							const c = yResult?.fittedData?.parameters?.cosines?.[i];
							return c ? (2 * Math.PI) / c.frequency : NaN;
						}}
						defaultName={`cosinor_period_${yName}${(yResult?.fittedData?.parameters?.cosines?.length ?? 0) > 1 ? '_' + (i + 1) : ''}`}
						source="Cosinor"
					/>
				</p>
				<p>
					Amplitude: {cosine.amplitude.toFixed(2)}
					<StoreValueButton
						label="Amplitude"
						getter={() => yResult?.fittedData?.parameters?.cosines?.[i]?.amplitude}
						defaultName={`cosinor_amplitude_${yName}${(yResult?.fittedData?.parameters?.cosines?.length ?? 0) > 1 ? '_' + (i + 1) : ''}`}
						source="Cosinor"
					/>
				</p>
				<p>
					Phase: {cosine.phase.toFixed(2)}
					<StoreValueButton
						label="Phase"
						getter={() => yResult?.fittedData?.parameters?.cosines?.[i]?.phase}
						defaultName={`cosinor_phase_${yName}${(yResult?.fittedData?.parameters?.cosines?.length ?? 0) > 1 ? '_' + (i + 1) : ''}`}
						source="Cosinor"
					/>
				</p>
				{#if !yResult?.fixedStats}
					<p>
						Equation: {cosine.amplitude.toFixed(2)}*cos({cosine.frequency.toFixed(2)}*t + {cosine.phase.toFixed(
							2
						)})
					</p>
				{/if}
			</div>
		</div>
	{/each}
	{#if yResult?.fixedStats}
		{@const s = yResult.fixedStats}
		<div class="div-line"></div>
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>
					Mesor: {s.M.toFixed(3)} &nbsp;[{Math.round((1 - s.alpha) * 100)}% CI: {s.CI_M[0].toFixed(
						3
					)}, {s.CI_M[1].toFixed(3)}]
					<StoreValueButton
						label="Mesor"
						getter={() => yResult?.fixedStats?.M}
						defaultName={`cosinor_mesor_${yName}`}
						source="Cosinor (fixed)"
					/>
				</p>
				{#each s.harmonics as h}
					<p>
						H{h.k} Amplitude: {h.amplitude.toFixed(3)} &nbsp;[CI: {h.CI_A[0].toFixed(3)}, {h.CI_A[1].toFixed(
							3
						)}]
						<StoreValueButton
							label={`H${h.k} Amplitude`}
							getter={() => yResult?.fixedStats?.harmonics?.[h.k - 1]?.amplitude}
							defaultName={`cosinor_amplitude_${yName}${s.harmonics.length > 1 ? '_H' + h.k : ''}`}
							source="Cosinor (fixed)"
						/>
					</p>
					<p>
						H{h.k} Acrophase: {h.acrophase_hrs.toFixed(2)} h &nbsp;[CI: {h.CI_acrophase[0].toFixed(
							2
						)}, {h.CI_acrophase[1].toFixed(2)}]
						<StoreValueButton
							label={`H${h.k} Acrophase`}
							getter={() => yResult?.fixedStats?.harmonics?.[h.k - 1]?.acrophase_hrs}
							defaultName={`cosinor_acrophase_${yName}${s.harmonics.length > 1 ? '_H' + h.k : ''}`}
							source="Cosinor (fixed)"
						/>
					</p>
				{/each}
				<p>
					F({s.df[0]}, {s.df[1]}) = {s.F_stat.toFixed(3)}, p {s.pF < 0.001
						? '< 0.001'
						: '= ' + s.pF.toFixed(3)}
					<StoreValueButton
						label="p-value"
						getter={() => yResult?.fixedStats?.pF}
						defaultName={`cosinor_pvalue_${yName}`}
						source="Cosinor (fixed)"
					/>
				</p>
			</div>
		</div>
	{/if}
{/snippet}

<!-- Output Section -->
<div class="section-row">
	<div class="tableProcess-label">
		<span>Output</span>
	</div>
	<div class="section-content">
		{#if calculating}
			<LoadingSpinner message="Fitting cosinor…" />
		{:else if p.args.valid && p.args.out.cosinorx != -1}
			{@const xout = getColumnById(p.args.out.cosinorx)}
			<div class="tp-outputs">
				<div class="tp-output-row">
					<span class="tp-output-label">{getColumnById(p.args.xIN)?.name ?? 'x'} (shared)</span>
					<ColumnComponent col={xout} />
				</div>
				{#each p.args.yIN ?? [] as yId}
					{@const outKey = 'cosinory_' + yId}
					{@const yOutId = p.args.out[outKey]}
					{#if yOutId >= 0}
						{@const yout = getColumnById(yOutId)}
						{#if yout}
							{@const yResult = cosinorData?.y_results?.[yId]}
							{@const srcName = getColumnById(Number(yId))?.name ?? yId}
							<div class="tp-output-row">
								<span class="tp-output-label">{srcName}</span>
								<ColumnComponent col={yout} />
								{#if yResult}
									{@render cosinorStats(yResult, srcName)}
								{/if}
							</div>
						{/if}
					{/if}
				{/each}
			</div>
		{:else if p.args.valid}
			<p>Preview:</p>
			{#each Object.entries(cosinorData?.y_results ?? {}) as [yId, yResult]}
				{@const srcName = getColumnById(Number(yId))?.name ?? yId}
				<div class="div-line"></div>
				<p><strong>{srcName}</strong></p>
				{@render cosinorStats(yResult, srcName)}
			{/each}
			{@const xData = cosinorData.outputXData ?? cosinorData.t}
			{@const yIds = Object.keys(cosinorData?.y_results ?? {})}
			{@const totalRows = xData.length}
			<Table
				headers={[
					'x',
					...yIds.map(
						(id) =>
							(cosinorData.outputXData ? 'predicted ' : 'fitted ') +
							(getColumnById(Number(id))?.name ?? id)
					)
				]}
				data={[
					xData
						.slice(previewStart - 1, previewStart + 5)
						.map((x) =>
							xIsTime && cosinorData.originTime_ms != null
								? {
										isTime: true,
										raw: formatTimeFromUNIX(cosinorData.originTime_ms + x * 3600000),
										computed: x.toFixed(2)
									}
								: x.toFixed(2)
						),
					...yIds.map((id) => {
						const yr = cosinorData.y_results[id];
						const yData = yr.predicted ?? yr.fittedData.fitted;
						return yData.slice(previewStart - 1, previewStart + 5).map((x) => x.toFixed(2));
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
			<p>Need to have valid inputs to create columns.</p>
		{/if}
	</div>
</div>

<style>
	.tp-outputs {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 0.25rem;
	}

	.tp-output-row {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		border-left: 2px solid var(--color-lightness-85);
		padding-left: 0.5rem;
	}

	.tp-output-label {
		font-size: 11px;
		color: var(--color-lightness-45, #666);
		font-style: italic;
	}
</style>
