<script module>
	// @ts-nocheck
	import { core, appConsts } from '$lib/core/core.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import { min as arrayMin, minMax as arrayMinMax } from '$lib/utils/stats.js';
	// Pure compute (getStatKeys + the windowed loop) lives in utils/ so it can run
	// in the compute worker; getStatKeys is re-exported for the component + tests.
	import { getStatKeys, computeMovingWindows } from '$lib/utils/movinganalysis.js';
	import { runComputeTask } from '$lib/workers/workerPool.js';
	import { shouldUseWorkers } from '$lib/workers/workerGate.js';
	import '$lib/utils/movinganalysis.worker-task.js';
	export { getStatKeys };

	const displayName = 'Moving Analysis';
	const defaults = new Map([
		['xIN', { val: -1 }],
		['yIN', { val: [] }],
		['windowSize', { val: 48 }], // hours
		['stepSize', { val: 12 }], // hours
		// 'start' | 'center' | 'end'
		['binLabel', { val: 'center' }],
		// 'periodogram' | 'cosinor' | 'fft' | 'correlogram' | 'rectfit' | 'doublelogistic' | 'trend'
		['analysis', { val: 'periodogram' }],
		// trend-fit params (used when analysis === 'trend')
		// 'linear' | 'polynomial' | 'logarithmic' | 'exponential'
		['trendModel', { val: 'linear' }],
		['trendPolyDegree', { val: 2 }],
		// periodogram params
		['pgMethod', { val: 'Lomb-Scargle' }], // 'Lomb-Scargle' | 'Chi-squared' | 'Enright'
		['periodMin', { val: 20 }],
		['periodMax', { val: 28 }],
		['periodStep', { val: 0.1 }],
		['pgBinSize', { val: 0.25 }],
		['pgAlpha', { val: 0.05 }],
		// cosinor / shared period params (also used by rectfit + doublelogistic)
		['useFixedPeriod', { val: true }],
		['fixedPeriod', { val: 24 }],
		['nHarmonics', { val: 1 }],
		['Ncurves', { val: 1 }],
		['alpha', { val: 0.05 }],
		// fft params
		['fftFreqStep', { val: 0 }], // 0 = auto (next power of two)
		// correlogram params
		['corrMinLag', { val: 0 }], // 0 = no lower bound (includes lag=0 except for peak-pick)
		['corrMaxLag', { val: 0 }], // 0 = auto (half window)
		// rectangular-wave fit params
		['rwFixKappa', { val: false }],
		['rwFixedKappa', { val: 5 }],
		['rwFixDutyCycle', { val: false }],
		['rwFixedDutyCycle', { val: 0.5 }],
		// double-logistic fit params
		['dlPeriodic', { val: true }],
		['dlFixK1', { val: false }],
		['dlFixedK1', { val: 0.5 }],
		['dlFixK2', { val: false }],
		['dlFixedK2', { val: 0.5 }],
		// outputs & misc
		['out', { movex: { val: -1 } }],
		['valid', { val: false }],
		['forcollected', { val: false }],
		['collectedType', { val: 'moving' }],
		['preProcesses', { val: [] }],
		['tableProcesses', { val: [] }]
	]);

	export const definition = {
		displayName,
		defaults,
		func: movinganalysis,
		columnIdFields: { scalar: ['xIN'], array: ['yIN'] },
		nodeSpec: {
			id: 'tableprocess.movinganalysis',
			inputs: [
				{ name: 'xIN', kind: 'column', cardinality: 'one' },
				{ name: 'yIN', kind: 'column', cardinality: 'many' }
			],
			outputs: [{ name: 'stats_*', kind: 'column', cardinality: 'many', dynamicPrefix: 'stats_' }]
		}
	};

	export async function movinganalysis(argsIN) {
		const xIN = argsIN.xIN;
		let yINs = argsIN.yIN;
		if (!Array.isArray(yINs)) yINs = yINs != null && yINs !== -1 ? [yINs] : [];
		const windowSize = Number(argsIN.windowSize);
		const stepSize = Number(argsIN.stepSize);
		const xOUT = argsIN.out?.movex;

		const empty = { bins: [], y_results: {}, statKeys: [], originTime_ms: null };

		if (
			xIN == null ||
			xIN === -1 ||
			!getColumnById(xIN) ||
			yINs.length === 0 ||
			!(windowSize > 0) ||
			!(stepSize > 0)
		) {
			return [empty, false];
		}

		const tCol = getColumnById(xIN);
		const isTimeX = tCol.type === 'time';
		const tAll = isTimeX ? tCol.hoursSinceStart : tCol.getData();
		// hoursSinceStart is relative to min(getData()), so anchor origin to the
		// same baseline; using getData()[0] breaks when the first row is null or
		// when the data isn't sorted.
		const originTime_ms = isTimeX ? (arrayMin(tCol.getData()) ?? null) : null;

		// hoursSinceStart now preserves null for filtered rows; isNaN(null) is false,
		// so we have to guard against null explicitly or Math.min/max coerce it to 0.
		const isInvalid = (v) => v == null || isNaN(v);
		const validX = tAll.filter((v) => !isInvalid(v));
		if (validX.length < 3) return [empty, false];
		const { min: xMin, max: xMax } = arrayMinMax(validX);
		if (xMin == null || xMax == null) return [empty, false];
		if (xMax - xMin < windowSize) return [empty, false];

		// Window starts: xMin, xMin+step, ... up to xMax - windowSize
		const starts = [];
		for (let s = xMin; s <= xMax - windowSize + 1e-9; s += stepSize) {
			starts.push(s);
		}
		if (starts.length === 0) return [empty, false];

		const binLabel = argsIN.binLabel ?? 'center';
		const binOffset = binLabel === 'start' ? 0 : binLabel === 'end' ? windowSize : windowSize / 2;
		const bins = starts.map((s) => s + binOffset);

		const statKeys = getStatKeys(argsIN);
		const y_results = {};
		let anyValid = false;

		// Resolve y data on the main thread (needs core), then run the heavy
		// windowed loop — off-thread when the aggregate work (windows × series) is
		// large enough, else inline. The sync fallback keeps results identical.
		const yEntries = [];
		for (const yId of yINs) {
			if (yId == null || yId === -1) continue;
			const yCol = getColumnById(yId);
			if (!yCol) continue;
			yEntries.push({ yId, yData: yCol.getData() });
		}
		const maParams = {
			tAll,
			ys: yEntries.map((e) => e.yData),
			starts,
			windowSize,
			statKeys,
			args: argsIN
		};
		const perY = shouldUseWorkers({ work: starts.length * yEntries.length })
			? await runComputeTask('movingAnalysis.compute', maParams)
			: computeMovingWindows(maParams);
		for (let i = 0; i < yEntries.length; i++) {
			y_results[yEntries[i].yId] = perY[i];
			anyValid = true;
		}

		// Apply pre-processes to each stat array before writing
		for (const pp of argsIN.preProcesses ?? []) {
			if (!pp.processName) continue;
			const proc = appConsts.processMap.get(pp.processName);
			if (!proc?.func) continue;
			for (const yId of yINs) {
				const ys = y_results[yId];
				if (!ys) continue;
				for (const k of statKeys) {
					ys[k] = proc.func(ys[k], pp.processArgs ?? {});
				}
			}
		}

		if (anyValid && xOUT != null && xOUT !== -1) {
			const processHash = crypto.randomUUID();
			const xColOut = getColumnById(xOUT);
			if (xColOut) {
				// For time inputs, store actual ms timestamps so the column reads as
				// real time data. windowSize/stepSize stay on the column as metadata
				// so plots can show window extent.
				if (originTime_ms != null) {
					core.rawData.set(
						xOUT,
						bins.map((h) => originTime_ms + h * 3600000)
					);
					xColOut.type = 'time';
					xColOut.timeFormat = null;
				} else {
					core.rawData.set(xOUT, bins);
					xColOut.type = 'number';
				}
				xColOut.data = xOUT;
				xColOut.binWidth = windowSize;
				xColOut.binStep = stepSize;
				xColOut.originTime_ms = originTime_ms;
				xColOut.tableProcessGUId = processHash;
			}

			for (const yId of yINs) {
				const ys = y_results[yId];
				if (!ys) continue;
				for (const k of statKeys) {
					const outKey = `${yId}_${k}`;
					const outId = argsIN.out?.[outKey];
					if (outId == null || outId === -1) continue;
					const outCol = getColumnById(outId);
					if (!outCol) continue;
					core.rawData.set(outId, ys[k]);
					outCol.data = outId;
					outCol.type = 'number';
					outCol.tableProcessGUId = processHash;
				}
			}
		}

		return [{ bins, y_results, statKeys, originTime_ms }, anyValid];
	}
</script>

<script>
	// @ts-nocheck
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';
	import { Column, getColumnById, removeColumn } from '$lib/core/Column.svelte';
	import { pushObj } from '$lib/core/core.svelte.js';
	import { onMount, untrack } from 'svelte';
	import { formatTimeFromUNIX } from '$lib/utils/time/TimeUtils.js';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';

	let { p = $bindable(), hideInputs = false } = $props();

	// Backward compat: convert legacy single yIN to array
	if (typeof p.args.yIN === 'number') {
		p.args.yIN = p.args.yIN !== -1 ? [p.args.yIN] : [];
	}
	if (typeof p.args.out !== 'object' || p.args.out === null) {
		p.args.out = { movex: -1 };
	}
	// Initialise trend-fit args for sessions saved before the trend analysis
	// option existed.
	if (p.args.trendModel === undefined) p.args.trendModel = 'linear';
	if (p.args.trendPolyDegree === undefined) p.args.trendPolyDegree = 2;

	let result = $state();
	let mounted = $state(false);
	let calculating = $state(false);
	let previewStart = $state(1);
	let _calcToken = 0;

	// for reactivity -----------
	let xIN_col = $derived.by(() => (p.args.xIN >= 0 ? getColumnById(p.args.xIN) : null));
	let xIsTime = $derived(xIN_col?.type === 'time');

	let currentStatKeys = $derived.by(() => getStatKeys(p.args));

	let getHash = $derived.by(() => {
		let out = '';
		out += xIN_col?.getDataHash ?? '';
		for (const yId of p.args.yIN ?? []) {
			const col = yId >= 0 ? getColumnById(yId) : null;
			out += col?.getDataHash ?? '';
		}
		out +=
			p.args.windowSize +
			'|' +
			p.args.stepSize +
			'|' +
			p.args.binLabel +
			'|' +
			p.args.analysis +
			'|' +
			p.args.pgMethod +
			'|' +
			p.args.periodMin +
			'|' +
			p.args.periodMax +
			'|' +
			p.args.periodStep +
			'|' +
			p.args.pgBinSize +
			'|' +
			p.args.useFixedPeriod +
			'|' +
			p.args.fixedPeriod +
			'|' +
			p.args.nHarmonics +
			'|' +
			p.args.Ncurves +
			'|' +
			p.args.fftFreqStep +
			'|' +
			p.args.corrMinLag +
			'|' +
			p.args.corrMaxLag +
			'|' +
			p.args.rwFixKappa +
			'|' +
			p.args.rwFixedKappa +
			'|' +
			p.args.rwFixDutyCycle +
			'|' +
			p.args.rwFixedDutyCycle +
			'|' +
			p.args.dlPeriodic +
			'|' +
			p.args.dlFixK1 +
			'|' +
			p.args.dlFixedK1 +
			'|' +
			p.args.dlFixK2 +
			'|' +
			p.args.dlFixedK2 +
			'|' +
			(p.args.trendModel ?? '') +
			'|' +
			(p.args.trendPolyDegree ?? '') +
			'|' +
			currentStatKeys.join(',');
		return out;
	});
	let lastHash = '';

	$effect(() => {
		const h = getHash;
		if (!mounted) return;
		if (lastHash !== h) {
			untrack(() => recompute());
		}
	});

	// Reconcile output columns whenever yIN or stat-key set changes
	$effect(() => {
		const _y = p.args.yIN;
		const _keys = currentStatKeys;
		if (!mounted) return;
		untrack(() => {
			if (syncStatColumns()) recompute();
		});
	});

	function recompute() {
		previewStart = 1;
		calculating = true;
		const token = ++_calcToken;
		setTimeout(async () => {
			if (token !== _calcToken) return;
			const [data, valid] = await movinganalysis(p.args);
			if (token !== _calcToken) return; // re-check after await (analysis is async now)
			result = data;
			p.args.valid = valid;
			calculating = false;
			lastHash = getHash;
		}, 0);
	}

	/**
	 * Add/remove output columns so that the committed set of `out` keys
	 * matches exactly {movex} ∪ {`${yId}_${statKey}` for every selected Y}.
	 * Returns true when anything changed so the caller can recompute.
	 */
	function syncStatColumns() {
		if (!p.parent) return false;

		const activeIds = new Set((p.args.yIN ?? []).map(Number).filter((id) => id >= 0));
		const wantedKeys = currentStatKeys;
		const desired = new Set(['movex']);
		for (const yId of activeIds) {
			for (const k of wantedKeys) desired.add(`${yId}_${k}`);
		}

		let changed = false;

		// Remove stale output keys (e.g., deselected Y, or stat-key change)
		for (const key of Object.keys(p.args.out ?? {})) {
			if (desired.has(key)) continue;
			const colId = p.args.out[key];
			if (colId != null && colId >= 0) {
				core.rawData.delete(colId);
				removeColumn(colId);
				if (p.parent) {
					p.parent.columnRefs = p.parent.columnRefs.filter((id) => id !== colId);
				}
			}
			delete p.args.out[key];
			changed = true;
		}

		// Ensure movex exists
		if (p.args.out.movex == null || p.args.out.movex < 0) {
			const xCol = new Column({});
			xCol.name = `movex_${p.id}`;
			pushObj(xCol);
			p.parent.columnRefs = [xCol.id, ...p.parent.columnRefs];
			p.args.out.movex = xCol.id;
			changed = true;
		}

		// Add missing stat columns for each active Y
		for (const yId of activeIds) {
			const srcName = getColumnById(yId)?.name ?? String(yId);
			for (const k of wantedKeys) {
				const key = `${yId}_${k}`;
				if (p.args.out[key] == null || p.args.out[key] === -1) {
					const col = new Column({});
					col.name = `${srcName}_${k}`;
					pushObj(col);
					p.parent.columnRefs = [col.id, ...p.parent.columnRefs];
					p.args.out[key] = col.id;
					changed = true;
				}
			}
		}

		return changed;
	}

	// Exclude own output column IDs from selectors
	let ownOutIds = $derived.by(() =>
		Object.values(p.args.out ?? {}).filter((v) => typeof v === 'number' && v >= 0)
	);

	let yExcludeIds = $derived.by(() => {
		if (hideInputs) return [];
		const ids = [p.args.xIN, ...ownOutIds];
		return ids.filter((id) => id >= 0);
	});

	onMount(() => {
		if (!p.args.out) p.args.out = { movex: -1 };
		// Initial sync creates movex + per-(Y,stat) columns if they don't exist
		const needsCompute = syncStatColumns();

		if (needsCompute) {
			recompute();
		} else {
			// Try to load existing data from rawData
			const xKey = p.args.out.movex;
			if (xKey >= 0 && core.rawData.has(xKey) && core.rawData.get(xKey).length > 0) {
				const storedX = core.rawData.get(xKey);
				const xOutCol = getColumnById(xKey);
				const originTime_ms = xOutCol?.originTime_ms ?? null;
				// Convert stored ms timestamps back to hour offsets for the in-memory
				// preview (which expects bins to be hours so labelForBin can render).
				const bins =
					originTime_ms != null ? storedX.map((ms) => (ms - originTime_ms) / 3600000) : storedX;
				const y_results = {};
				for (const yId of p.args.yIN ?? []) {
					const per = {};
					for (const k of currentStatKeys) {
						const outKey = `${yId}_${k}`;
						const outId = p.args.out[outKey];
						if (outId >= 0 && core.rawData.has(outId)) {
							per[k] = core.rawData.get(outId);
						}
					}
					y_results[yId] = per;
				}
				result = { bins, y_results, statKeys: currentStatKeys, originTime_ms };
				p.args.valid = true;
				const inputsAreStale =
					(p.args.xIN >= 0 && (getColumnById(p.args.xIN)?.rawDataVersion ?? 0) > 0) ||
					(p.args.yIN ?? []).some((id) => (getColumnById(id)?.rawDataVersion ?? 0) > 0);
				if (!inputsAreStale) lastHash = getHash;
			}
		}
		mounted = true;
	});

	function labelForBin(binHrs) {
		if (xIsTime && result?.originTime_ms != null) {
			return {
				isTime: true,
				raw: formatTimeFromUNIX(result.originTime_ms + binHrs * 3600000),
				computed: binHrs.toFixed(2)
			};
		}
		return binHrs.toFixed(2);
	}
</script>

<!-- Input Section -->
{#if !hideInputs}
	<div class="section-row">
		<div class="tableProcess-label"><span>Input</span></div>
		<div class="control-input-vertical">
			<div class="control-input">
				<p>X column</p>
				<ColumnSelector bind:value={p.args.xIN} />
			</div>
			<div class="control-input">
				<p>Y columns</p>
				<ColumnSelector bind:value={p.args.yIN} excludeColIds={yExcludeIds} multiple={true} />
			</div>
		</div>
	</div>
{/if}

<!-- Window Parameters -->
<div class="section-row">
	<div class="tableProcess-label"><span>Window</span></div>
	<div class="control-input-horizontal">
		<div class="control-input">
			<p>Window size (hrs)</p>
			<NumberWithUnits bind:value={p.args.windowSize} min="0.1" step="0.5" />
		</div>
		<div class="control-input">
			<p>Step size (hrs)</p>
			<NumberWithUnits bind:value={p.args.stepSize} min="0.1" step="0.5" />
		</div>
		<div class="control-input">
			<p>Bin label</p>
			<AttributeSelect
				bind:value={p.args.binLabel}
				options={['start', 'center', 'end']}
				optionsDisplay={['Window start', 'Window center', 'Window end']}
			/>
		</div>
	</div>
</div>

<!-- Analysis Parameters -->
<div class="section-row">
	<div class="tableProcess-label"><span>Analysis</span></div>
	<div class="control-input-horizontal">
		<div class="control-input">
			<p>Analysis</p>
			<AttributeSelect
				bind:value={p.args.analysis}
				options={[
					'periodogram',
					'cosinor',
					'fft',
					'correlogram',
					'rectfit',
					'doublelogistic',
					'trend'
				]}
				optionsDisplay={[
					'Periodogram',
					'Cosinor',
					'FFT',
					'Correlogram',
					'Rectangular wave fit',
					'Double logistic fit',
					'Trend fit'
				]}
			/>
		</div>
	</div>

	{#if p.args.analysis === 'periodogram'}
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>Method</p>
				<AttributeSelect
					bind:value={p.args.pgMethod}
					options={['Lomb-Scargle', 'Chi-squared', 'Enright']}
					optionsDisplay={['Lomb-Scargle', 'Chi-squared', 'Enright']}
				/>
			</div>
		</div>
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>Period min (hrs)</p>
				<NumberWithUnits bind:value={p.args.periodMin} min="0.01" step="0.5" />
			</div>
			<div class="control-input">
				<p>Period max (hrs)</p>
				<NumberWithUnits bind:value={p.args.periodMax} min="0.01" step="0.5" />
			</div>
			<div class="control-input">
				<p>Period step (hrs)</p>
				<NumberWithUnits bind:value={p.args.periodStep} min="0.001" step="0.01" />
			</div>
		</div>
		{#if p.args.pgMethod === 'Chi-squared' || p.args.pgMethod === 'Enright'}
			<div class="control-input-horizontal">
				<div class="control-input">
					<p>Bin size (hrs)</p>
					<NumberWithUnits bind:value={p.args.pgBinSize} min="0.01" step="0.05" />
				</div>
			</div>
		{/if}
	{:else if p.args.analysis === 'cosinor'}
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
					<NumberWithUnits bind:value={p.args.fixedPeriod} min="0.1" step="0.5" />
				</div>
				<div class="control-input">
					<p>N harmonics</p>
					<NumberWithUnits bind:value={p.args.nHarmonics} min="1" step="1" />
				</div>
			</div>
		{:else}
			<div class="control-input-horizontal">
				<div class="control-input">
					<p>N cosine curves</p>
					<NumberWithUnits bind:value={p.args.Ncurves} min="1" step="1" />
				</div>
			</div>
		{/if}
	{:else if p.args.analysis === 'fft'}
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>Frequency step (cycles/hr; 0 = auto)</p>
				<NumberWithUnits bind:value={p.args.fftFreqStep} min="0" step="0.001" />
			</div>
		</div>
	{:else if p.args.analysis === 'correlogram'}
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>Min lag (hrs)</p>
				<NumberWithUnits bind:value={p.args.corrMinLag} min="0" step="1" />
			</div>
			<div class="control-input">
				<p>Max lag (hrs; 0 = half window)</p>
				<NumberWithUnits bind:value={p.args.corrMaxLag} min="0" step="1" />
			</div>
		</div>
	{:else if p.args.analysis === 'rectfit'}
		<div class="control-input-horizontal">
			<div class="control-input">
				<label>
					<input type="checkbox" bind:checked={p.args.useFixedPeriod} />
					Fixed period
				</label>
			</div>
			{#if p.args.useFixedPeriod}
				<div class="control-input">
					<p>Period (hrs)</p>
					<NumberWithUnits bind:value={p.args.fixedPeriod} min="0.1" step="0.5" />
				</div>
			{/if}
		</div>
		<div class="control-input-horizontal">
			<div class="control-input">
				<label>
					<input type="checkbox" bind:checked={p.args.rwFixKappa} />
					Fixed sharpness (κ)
				</label>
			</div>
			{#if p.args.rwFixKappa}
				<div class="control-input">
					<p>κ</p>
					<NumberWithUnits bind:value={p.args.rwFixedKappa} min="0.01" step="0.5" />
				</div>
			{/if}
		</div>
		<div class="control-input-horizontal">
			<div class="control-input">
				<label>
					<input type="checkbox" bind:checked={p.args.rwFixDutyCycle} />
					Fixed duty cycle
				</label>
			</div>
			{#if p.args.rwFixDutyCycle}
				<div class="control-input">
					<p>Duty cycle (0–1)</p>
					<NumberWithUnits bind:value={p.args.rwFixedDutyCycle} min="0.01" max="0.99" step="0.05" />
				</div>
			{/if}
		</div>
	{:else if p.args.analysis === 'doublelogistic'}
		<div class="control-input-horizontal">
			<div class="control-input">
				<label>
					<input type="checkbox" bind:checked={p.args.dlPeriodic} />
					Periodic (tiled)
				</label>
			</div>
			{#if p.args.dlPeriodic}
				<div class="control-input">
					<label>
						<input type="checkbox" bind:checked={p.args.useFixedPeriod} />
						Fixed period
					</label>
				</div>
				{#if p.args.useFixedPeriod}
					<div class="control-input">
						<p>Period (hrs)</p>
						<NumberWithUnits bind:value={p.args.fixedPeriod} min="0.1" step="0.5" />
					</div>
				{/if}
			{/if}
		</div>
		<div class="control-input-horizontal">
			<div class="control-input">
				<label>
					<input type="checkbox" bind:checked={p.args.dlFixK1} />
					Fixed rise rate (k1)
				</label>
			</div>
			{#if p.args.dlFixK1}
				<div class="control-input">
					<p>k1</p>
					<NumberWithUnits bind:value={p.args.dlFixedK1} min="0.001" step="0.1" />
				</div>
			{/if}
		</div>
		<div class="control-input-horizontal">
			<div class="control-input">
				<label>
					<input type="checkbox" bind:checked={p.args.dlFixK2} />
					Fixed fall rate (k2)
				</label>
			</div>
			{#if p.args.dlFixK2}
				<div class="control-input">
					<p>k2</p>
					<NumberWithUnits bind:value={p.args.dlFixedK2} min="0.001" step="0.1" />
				</div>
			{/if}
		</div>
	{:else if p.args.analysis === 'trend'}
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>Model</p>
				<AttributeSelect
					bind:value={p.args.trendModel}
					options={['linear', 'exponential', 'logarithmic', 'polynomial']}
					optionsDisplay={['Linear', 'Exponential', 'Logarithmic', 'Polynomial']}
				/>
			</div>
			{#if p.args.trendModel === 'polynomial'}
				<div class="control-input">
					<p>Degree</p>
					<NumberWithUnits bind:value={p.args.trendPolyDegree} min="1" step="1" />
				</div>
			{/if}
		</div>
	{/if}
</div>

<!-- Output / Preview -->
<details open>
	<summary class="section-details-summary">Output</summary>
	<div class="section-row">
		<div class="section-content">
			{#if calculating}
				<LoadingSpinner message="Running moving analysis…" />
			{:else if p.args.valid && result?.bins?.length && ownOutIds.length > 1}
				{@const xout = getColumnById(p.args.out.movex)}
				<div class="tp-outputs">
					<div class="tp-output-row">
						<span class="tp-output-label">{xIsTime ? 'window time' : 'window x'}</span>
						<ColumnComponent col={xout} />
					</div>
					{#each p.args.yIN ?? [] as yId (yId)}
						{@const srcName = getColumnById(Number(yId))?.name ?? yId}
						{#each currentStatKeys as k (k)}
							{@const outId = p.args.out[`${yId}_${k}`]}
							{#if outId >= 0}
								{@const col = getColumnById(outId)}
								{#if col}
									<div class="tp-output-row">
										<span class="tp-output-label">{srcName} — {k}</span>
										<ColumnComponent {col} />
									</div>
								{/if}
							{/if}
						{/each}
					{/each}
				</div>
			{:else if p.args.valid && result?.bins?.length}
				{@const totalRows = result.bins.length}
				{@const yIds = Object.keys(result.y_results)}
				<p>Preview:</p>
				<Table
					headers={[
						xIsTime ? 'window time' : 'window x',
						...yIds.flatMap((id) =>
							currentStatKeys.map((k) => `${getColumnById(Number(id))?.name ?? id} — ${k}`)
						)
					]}
					data={[
						result.bins.slice(previewStart - 1, previewStart + 5).map(labelForBin),
						...yIds.flatMap((id) => {
							const per = result.y_results[id] ?? {};
							return currentStatKeys.map((k) =>
								(per[k] ?? [])
									.slice(previewStart - 1, previewStart + 5)
									.map((v) => (Number.isFinite(v) ? v.toFixed(3) : '—'))
							);
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
				<p>Select X/Y columns and ensure the window fits within the data range.</p>
			{/if}
		</div>
	</div>
</details>
