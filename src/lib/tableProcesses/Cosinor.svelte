<script module>
	import { core } from '$lib/core/core.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import { fitCosineCurves, evaluateCosinorAtPoints, fitCosinorFixed } from '$lib/utils/cosinor.js';

	export const cosinor_defaults = new Map([
		['xIN', { val: -1 }],
		['yIN', { val: -1 }],
		['Ncurves', { val: 0 }],
		['outputX', { val: -1 }],
		['out', { cosinorx: { val: -1 }, cosinory: { val: -1 } }], //needed to set up the output columns
		['valid', { val: false }], //needed for the progress step logic
		['useFixedPeriod', { val: false }],
		['fixedPeriod', { val: 24 }],
		['nHarmonics', { val: 1 }],
		['alpha', { val: 0.05 }]
	]);

	export function cosinor(argsIN) {
		const xIN = argsIN.xIN;
		const yIN = argsIN.yIN;
		const Ncurves = argsIN.Ncurves;
		const outputXId = argsIN.outputX;
		const xOUT = argsIN.out.cosinorx;
		const yOUT = argsIN.out.cosinory;
		const useFixedPeriod = argsIN.useFixedPeriod ?? false;
		const fixedPeriod = argsIN.fixedPeriod ?? 24;
		const nHarmonics = argsIN.nHarmonics ?? 1;
		const alpha = argsIN.alpha ?? 0.05;

		let result = {
			t: [],
			outputXData: null,
			fittedData: { fitted: [], parameters: { cosines: [] }, rmse: NaN, rSquared: NaN },
			fixedStats: null
		};
		let valid = false;

		const canRun =
			xIN != -1 &&
			yIN != -1 &&
			getColumnById(xIN) &&
			getColumnById(yIN) &&
			(useFixedPeriod ? nHarmonics >= 1 : Ncurves >= 1);

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

			// Get outputX data if specified
			let outputXData = null;
			if (outputXId != -1 && getColumnById(outputXId)) {
				const outputXCol = getColumnById(outputXId);
				outputXData =
					outputXCol.type === 'time' ? outputXCol.hoursSinceStart : outputXCol.getData();
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

			if (useFixedPeriod) {
				// ── Fixed-period (classical Halberg) cosinor ──
				const fixedResult = fitCosinorFixed(tt, yy, fixedPeriod, nHarmonics, alpha);
				if (fixedResult) {
					valid = true;
					const omega = (2 * Math.PI) / fixedPeriod;
					const xOutData = outputXData ?? tt;
					const yOutData = outputXData
						? outputXData.map((ti) => {
								let val = fixedResult.M;
								for (const h of fixedResult.harmonics) {
									val +=
										h.beta * Math.cos(h.k * omega * ti) +
										h.gamma * Math.sin(h.k * omega * ti);
								}
								return val;
							})
						: fixedResult.fitted;

					if (xOUT != -1 && yOUT != -1) {
						const xColOut = getColumnById(xOUT);
						const yColOut = getColumnById(yOUT);
						if (xColOut && yColOut) {
							const xOutMs = originTime_ms != null
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
						originTime_ms
					};
				}
			} else {
				// ── Free-parameter cosinor (original behaviour) ──
				const fittedData = fitCosineCurves(tt, yy, Ncurves);

				const predicted = outputXData
					? evaluateCosinorAtPoints(fittedData.parameters, outputXData)
					: null;

				if (xOUT != -1 && yOUT != -1) {
					const xColOut = getColumnById(xOUT);
					const yColOut = getColumnById(yOUT);
					if (xColOut && yColOut) {
						const xOutData = outputXData ?? tt;
						const yOutData = predicted ?? fittedData.fitted;
						const xOutMs = originTime_ms != null
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
					fittedData: { ...fittedData },
					fixedStats: null,
					predicted,
					originTime_ms
				};
				valid = fittedData.fitted.length > 0;
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

	import { getColumnById } from '$lib/core/Column.svelte';
	import { formatTimeFromUNIX } from '$lib/utils/time/TimeUtils.js';
	import { onMount, untrack } from 'svelte';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';

	let { p = $bindable() } = $props();

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

	// for reactivity -----------
	let xIN_col = $derived.by(() => (p.args.xIN >= 0 ? getColumnById(p.args.xIN) : null));
	let yIN_col = $derived.by(() => (p.args.yIN >= 0 ? getColumnById(p.args.yIN) : null));
	let outputX_col = $derived.by(() => (p.args.outputX >= 0 ? getColumnById(p.args.outputX) : null));
	let xIsTime = $derived(xIN_col?.type === 'time' || outputX_col?.type === 'time');
	let getHash = $derived.by(() => {
		let out = '';
		out += xIN_col?.getDataHash;
		out += yIN_col?.getDataHash;
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
	//------------
	function getCosinor() {
		previewStart = 1;
		calculating = true;
		const token = ++_calcToken;
		setTimeout(() => {
			if (token !== _calcToken) return;
			[cosinorData, p.args.valid] = cosinor(p.args);
			calculating = false;
		}, 0);
	}

	onMount(() => {
		//If data already exists (e.g. imported from JSON), use it instead of regenerating
		const xKey = p.args.out.cosinorx;
		const yKey = p.args.out.cosinory;
		if (xKey >= 0 && yKey >= 0 && core.rawData.has(xKey) && core.rawData.get(xKey).length > 0) {
			cosinorData = {
				t: core.rawData.get(xKey),
				outputXData: null,
				fittedData: { fitted: core.rawData.get(yKey), parameters: { cosines: [] }, rmse: NaN }
			};
			p.args.valid = true;
			lastHash = getHash; // prevent $effect from recalculating
		}
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
				<p>Y column</p>
				<ColumnSelector
					bind:value={p.args.yIN}
					excludeColIds={[p.xIN]}
				/>
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
				<input
					type="checkbox"
					bind:checked={p.args.useFixedPeriod}
				/>
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
				<ColumnSelector
					bind:value={p.args.outputX}
					excludeColIds={[p.args.out.cosinorx, p.args.out.cosinory]}
				/>
			</div>
		</div>
	{/if}
</div>

<!-- Output Section -->
<div class="section-row">
	<div class="tableProcess-label">
		<span>Output</span>
	</div>
	<div class="section-content">
		{#if calculating}
			<LoadingSpinner message="Fitting cosinor…" />
		{:else if p.args.valid && p.args.out.cosinorx != -1 && p.args.out.cosinory != -1}
			{@const xout = getColumnById(p.args.out.cosinorx)}
			<ColumnComponent col={xout} />
			{@const yout = getColumnById(p.args.out.cosinory)}
			<ColumnComponent col={yout} />
			<div class="control-input-horizontal">
				<div class="control-input">
					<p>RMSE: {cosinorData?.fittedData?.rmse.toFixed(3)}
						<StoreValueButton label="RMSE" getter={() => cosinorData?.fittedData?.rmse} defaultName="cosinor_rmse" source="Cosinor" />
					</p>
					{#if cosinorData?.fittedData?.rSquared != null}
						<p>R²: {cosinorData.fittedData.rSquared.toFixed(3)}
							<StoreValueButton label="R²" getter={() => cosinorData?.fittedData?.rSquared} defaultName="cosinor_r2" source="Cosinor" />
						</p>
					{/if}
				</div>
			</div>
			{#each cosinorData?.fittedData?.parameters.cosines as cosine, i}
				{@const period = 2 * Math.PI * (1 / cosine.frequency)}
				<div class="control-input-horizontal">
					<div class="control-input">
						<p>
							Period: {period.toFixed(2)}
							<StoreValueButton label="Period" getter={() => { const c = cosinorData?.fittedData?.parameters?.cosines?.[i]; return c ? 2 * Math.PI / c.frequency : NaN; }} defaultName={`cosinor_period${cosinorData.fittedData.parameters.cosines.length > 1 ? '_' + (i + 1) : ''}`} source="Cosinor" />
						</p>

						<p>
							Amplitude: {cosine.amplitude.toFixed(2)}
							<StoreValueButton label="Amplitude" getter={() => cosinorData?.fittedData?.parameters?.cosines?.[i]?.amplitude} defaultName={`cosinor_amplitude${cosinorData.fittedData.parameters.cosines.length > 1 ? '_' + (i + 1) : ''}`} source="Cosinor" />
						</p>

						<p>
							Phase: {cosine.phase.toFixed(2)}
							<StoreValueButton label="Phase" getter={() => cosinorData?.fittedData?.parameters?.cosines?.[i]?.phase} defaultName={`cosinor_phase${cosinorData.fittedData.parameters.cosines.length > 1 ? '_' + (i + 1) : ''}`} source="Cosinor" />
						</p>

						{#if !cosinorData?.fixedStats}
							<p>
								Equation: {cosine.amplitude.toFixed(2)}*cos({cosine.frequency.toFixed(2)}*t + {cosine.phase.toFixed(2)})
							</p>
						{/if}
					</div>
				</div>
			{/each}
			{#if cosinorData?.fixedStats}
				{@const s = cosinorData.fixedStats}
				<div class="div-line"></div>
				<div class="control-input-horizontal">
					<div class="control-input">
						<p>Mesor: {s.M.toFixed(3)} &nbsp;[{Math.round((1 - s.alpha) * 100)}% CI: {s.CI_M[0].toFixed(3)}, {s.CI_M[1].toFixed(3)}]
							<StoreValueButton label="Mesor" getter={() => cosinorData?.fixedStats?.M} defaultName="cosinor_mesor" source="Cosinor (fixed)" />
						</p>
						{#each s.harmonics as h}
							<p>H{h.k} Amplitude: {h.amplitude.toFixed(3)} &nbsp;[CI: {h.CI_A[0].toFixed(3)}, {h.CI_A[1].toFixed(3)}]
								<StoreValueButton label={`H${h.k} Amplitude`} getter={() => cosinorData?.fixedStats?.harmonics?.[h.k - 1]?.amplitude} defaultName={`cosinor_amplitude${s.harmonics.length > 1 ? '_H' + h.k : ''}`} source="Cosinor (fixed)" />
							</p>
							<p>H{h.k} Acrophase: {h.acrophase_hrs.toFixed(2)} h &nbsp;[CI: {h.CI_acrophase[0].toFixed(2)}, {h.CI_acrophase[1].toFixed(2)}]
								<StoreValueButton label={`H${h.k} Acrophase`} getter={() => cosinorData?.fixedStats?.harmonics?.[h.k - 1]?.acrophase_hrs} defaultName={`cosinor_acrophase${s.harmonics.length > 1 ? '_H' + h.k : ''}`} source="Cosinor (fixed)" />
							</p>
						{/each}
						<p>F({s.df[0]}, {s.df[1]}) = {s.F_stat.toFixed(3)}, p {s.pF < 0.001 ? '< 0.001' : '= ' + s.pF.toFixed(3)}
							<StoreValueButton label="p-value" getter={() => cosinorData?.fixedStats?.pF} defaultName="cosinor_pvalue" source="Cosinor (fixed)" />
						</p>
					</div>
				</div>
			{/if}
		{:else if p.args.valid}
			<p>Preview:</p>
			<div class="control-input-horizontal">
				<div class="control-input">
					<p>RMSE: {cosinorData?.fittedData?.rmse.toFixed(3)}
						<StoreValueButton label="RMSE" getter={() => cosinorData?.fittedData?.rmse} defaultName="cosinor_rmse" source="Cosinor" />
					</p>
					{#if cosinorData?.fittedData?.rSquared != null}
						<p>R²: {cosinorData.fittedData.rSquared.toFixed(3)}
							<StoreValueButton label="R²" getter={() => cosinorData?.fittedData?.rSquared} defaultName="cosinor_r2" source="Cosinor" />
						</p>
					{/if}
				</div>
			</div>
			{#each cosinorData?.fittedData?.parameters.cosines as cosine, i}
				{@const period = 2 * Math.PI * (1 / cosine.frequency)}
				<div class="control-input-horizontal">
					<div class="control-input">
						<p>
							Period: {period.toFixed(2)}
							<StoreValueButton label="Period" getter={() => { const c = cosinorData?.fittedData?.parameters?.cosines?.[i]; return c ? 2 * Math.PI / c.frequency : NaN; }} defaultName={`cosinor_period${cosinorData.fittedData.parameters.cosines.length > 1 ? '_' + (i + 1) : ''}`} source="Cosinor" />
						</p>
						<p>
							Amplitude: {cosine.amplitude.toFixed(2)}
							<StoreValueButton label="Amplitude" getter={() => cosinorData?.fittedData?.parameters?.cosines?.[i]?.amplitude} defaultName={`cosinor_amplitude${cosinorData.fittedData.parameters.cosines.length > 1 ? '_' + (i + 1) : ''}`} source="Cosinor" />
						</p>
						<p>
							Phase: {cosine.phase.toFixed(2)}
							<StoreValueButton label="Phase" getter={() => cosinorData?.fittedData?.parameters?.cosines?.[i]?.phase} defaultName={`cosinor_phase${cosinorData.fittedData.parameters.cosines.length > 1 ? '_' + (i + 1) : ''}`} source="Cosinor" />
						</p>
						{#if !cosinorData?.fixedStats}
							<p>
								Equation: {cosine.amplitude.toFixed(2)}*cos({cosine.frequency.toFixed(2)}*t + {cosine.phase.toFixed(2)})
							</p>
						{/if}
					</div>
				</div>
			{/each}
			{#if cosinorData?.fixedStats}
				{@const s = cosinorData.fixedStats}
				<div class="div-line"></div>
				<div class="control-input-horizontal">
					<div class="control-input">
						<p>Mesor: {s.M.toFixed(3)} &nbsp;[{Math.round((1 - s.alpha) * 100)}% CI: {s.CI_M[0].toFixed(3)}, {s.CI_M[1].toFixed(3)}]
							<StoreValueButton label="Mesor" getter={() => cosinorData?.fixedStats?.M} defaultName="cosinor_mesor" source="Cosinor (fixed)" />
						</p>
						{#each s.harmonics as h}
							<p>H{h.k} Amplitude: {h.amplitude.toFixed(3)} &nbsp;[CI: {h.CI_A[0].toFixed(3)}, {h.CI_A[1].toFixed(3)}]
								<StoreValueButton label={`H${h.k} Amplitude`} getter={() => cosinorData?.fixedStats?.harmonics?.[h.k - 1]?.amplitude} defaultName={`cosinor_amplitude${s.harmonics.length > 1 ? '_H' + h.k : ''}`} source="Cosinor (fixed)" />
							</p>
							<p>H{h.k} Acrophase: {h.acrophase_hrs.toFixed(2)} h &nbsp;[CI: {h.CI_acrophase[0].toFixed(2)}, {h.CI_acrophase[1].toFixed(2)}]
								<StoreValueButton label={`H${h.k} Acrophase`} getter={() => cosinorData?.fixedStats?.harmonics?.[h.k - 1]?.acrophase_hrs} defaultName={`cosinor_acrophase${s.harmonics.length > 1 ? '_H' + h.k : ''}`} source="Cosinor (fixed)" />
							</p>
						{/each}
						<p>F({s.df[0]}, {s.df[1]}) = {s.F_stat.toFixed(3)}, p {s.pF < 0.001 ? '< 0.001' : '= ' + s.pF.toFixed(3)}
							<StoreValueButton label="p-value" getter={() => cosinorData?.fixedStats?.pF} defaultName="cosinor_pvalue" source="Cosinor (fixed)" />
						</p>
					</div>
				</div>
			{/if}
			{@const xData = cosinorData.outputXData ?? cosinorData.t}
			{@const yData = cosinorData.predicted ?? cosinorData.fittedData.fitted}
			{@const totalRows = xData.length}
			<Table
				headers={['x', cosinorData.outputXData ? 'predicted y' : 'fitted y']}
				data={[
					xData.slice(previewStart - 1, previewStart + 5).map((x) =>
						xIsTime && cosinorData.originTime_ms != null
							? { isTime: true, raw: formatTimeFromUNIX(cosinorData.originTime_ms + x * 3600000), computed: x.toFixed(2) }
							: x.toFixed(2)
					),
					yData.slice(previewStart - 1, previewStart + 5).map((x) => x.toFixed(2))
				]}
			/>
			<p>Row <NumberWithUnits min={1} max={Math.max(1, totalRows - 5)} step={1} bind:value={previewStart} /> to {Math.min(previewStart + 5, totalRows)} of {totalRows}</p>
		{:else}
			<p>Need to have valid inputs to create columns.</p>
		{/if}
	</div>
</div>
