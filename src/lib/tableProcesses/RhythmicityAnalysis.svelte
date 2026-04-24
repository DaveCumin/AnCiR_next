<script module>
	// @ts-nocheck
	import { core, appConsts } from '$lib/core/core.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import { runPeriodogramCalculation } from '$lib/utils/periodogram.js';
	import { computeFFT } from '$lib/utils/fft.js';
	import { computeAutocorrelation } from '$lib/utils/correlogram.js';
	import { fitCosineCurves, fitCosinorFixed } from '$lib/utils/cosinor.js';

	const displayName = 'Rhythmicity Analysis';

	const defaults = new Map([
		['xIN', { val: -1 }],
		['yIN', { val: [] }],
		// 'periodogram' | 'fft' | 'correlogram' | 'cosinor'
		['analysis', { val: 'periodogram' }],
		// periodogram params
		['pgMethod', { val: 'Lomb-Scargle' }],
		['periodMin', { val: 20 }],
		['periodMax', { val: 28 }],
		['periodStep', { val: 0.1 }],
		['pgBinSize', { val: 0.25 }],
		['pgAlpha', { val: 0.05 }],
		// fft params
		['fftFreqStep', { val: 0 }],
		// correlogram params
		['corrMaxLag', { val: 0 }],
		// cosinor params
		['useFixedPeriod', { val: true }],
		['fixedPeriod', { val: 24 }],
		['nHarmonics', { val: 1 }],
		['Ncurves', { val: 1 }],
		['alpha', { val: 0.05 }],
		// outputs & misc
		['out', {}],
		['valid', { val: false }],
		['forcollected', { val: true }],
		['collectedType', { val: 'rhythmicity' }],
		['preProcesses', { val: [] }],
		['tableProcesses', { val: [] }]
	]);

	export const definition = {
		displayName,
		defaults,
		func: rhythmicityanalysis,
		columnIdFields: { scalar: ['xIN'], array: ['yIN'] },
		xOutKey: 'rhythmicityx',
		yOutKeyPrefix: 'rhythmicityy_'
	};

	/**
	 * In collected / L2W mode the chain wants one shared X column + one Y per
	 * input, like Cosinor. These keys pick which output array becomes that
	 * X/Y pair for each analysis.
	 */
	export function getPrimaryKeys(args) {
		if (args.analysis === 'periodogram') return { x: 'period', y: 'power' };
		if (args.analysis === 'fft') return { x: 'period', y: 'magnitude' };
		if (args.analysis === 'correlogram') return { x: 'lag', y: 'correlation' };
		if (args.analysis === 'cosinor') return { x: 'time', y: 'fitted' };
		return { x: null, y: null };
	}

	/**
	 * Per-Y output array-columns produced by the current analysis.
	 * Names are suffixed onto each Y id to form the output-map key.
	 */
	export function getOutputKeys(args) {
		if (args.analysis === 'periodogram') {
			const keys = ['period', 'power'];
			if (args.pgMethod === 'Chi-squared') keys.push('threshold');
			return keys;
		}
		if (args.analysis === 'fft') return ['frequency', 'period', 'magnitude', 'phase'];
		if (args.analysis === 'correlogram') return ['lag', 'correlation'];
		if (args.analysis === 'cosinor') return ['time', 'fitted'];
		return [];
	}

	/**
	 * Scalar stats displayed in the UI (per Y). Not stored as columns; each one
	 * gets a StoreValueButton so the user can save it to core.storedValues.
	 */
	export function getStatKeys(args) {
		if (args.analysis === 'periodogram') return ['peak_period', 'peak_power'];
		if (args.analysis === 'fft') return ['peak_period', 'peak_frequency', 'peak_magnitude'];
		if (args.analysis === 'correlogram') return ['peak_lag', 'peak_correlation'];
		if (args.analysis === 'cosinor') {
			if (args.useFixedPeriod) {
				const keys = ['mesor'];
				const H = Math.max(1, args.nHarmonics ?? 1);
				for (let h = 1; h <= H; h++) keys.push(`H${h}_amplitude`, `H${h}_acrophase`);
				keys.push('r2', 'rmse', 'pvalue');
				return keys;
			}
			const keys = [];
			const N = Math.max(1, args.Ncurves ?? 1);
			for (let c = 1; c <= N; c++) keys.push(`C${c}_period`, `C${c}_amplitude`, `C${c}_phase`);
			keys.push('r2', 'rmse');
			return keys;
		}
		return [];
	}

	function runAnalysis(tt, yy, args) {
		const outputs = {};
		const stats = {};
		for (const k of getOutputKeys(args)) outputs[k] = [];
		for (const k of getStatKeys(args)) stats[k] = NaN;

		if (tt.length < 3) return { outputs, stats };

		if (args.analysis === 'periodogram') {
			const res = runPeriodogramCalculation({
				method: args.pgMethod ?? 'Lomb-Scargle',
				xData: tt,
				yData: yy,
				periodMin: args.periodMin,
				periodMax: args.periodMax,
				periodSteps: args.periodStep,
				binSize: args.pgBinSize ?? 0.25,
				chiSquaredAlpha: args.pgAlpha ?? 0.05
			});
			outputs.period = res.x ?? [];
			outputs.power = res.y ?? [];
			if (args.pgMethod === 'Chi-squared') outputs.threshold = res.threshold ?? [];
			if (!res.y?.length) return { outputs, stats };
			let bestIdx = 0;
			let bestPow = -Infinity;
			for (let i = 0; i < res.y.length; i++) {
				if (Number.isFinite(res.y[i]) && res.y[i] > bestPow) {
					bestPow = res.y[i];
					bestIdx = i;
				}
			}
			stats.peak_period = res.x[bestIdx];
			stats.peak_power = res.y[bestIdx];
			return { outputs, stats };
		}

		if (args.analysis === 'fft') {
			const step = args.fftFreqStep > 0 ? args.fftFreqStep : null;
			const r = computeFFT(tt, yy, step);
			outputs.frequency = r.frequencies ?? [];
			outputs.period = (r.frequencies ?? []).map((f) => (f !== 0 ? 1 / f : NaN));
			outputs.magnitude = r.magnitudes ?? [];
			outputs.phase = r.phases ?? [];
			if (!r.frequencies?.length) return { outputs, stats };
			let bestIdx = 0;
			for (let i = 1; i < r.magnitudes.length; i++) {
				if (r.magnitudes[i] > r.magnitudes[bestIdx]) bestIdx = i;
			}
			const freq = r.frequencies[bestIdx];
			stats.peak_frequency = freq;
			stats.peak_period = freq !== 0 ? 1 / freq : NaN;
			stats.peak_magnitude = r.magnitudes[bestIdx];
			return { outputs, stats };
		}

		if (args.analysis === 'correlogram') {
			const maxLag = args.corrMaxLag > 0 ? args.corrMaxLag : null;
			const r = computeAutocorrelation(tt, yy, null, maxLag);
			outputs.lag = r.lags ?? [];
			outputs.correlation = r.correlations ?? [];
			if (!r.lags || r.lags.length < 2) return { outputs, stats };
			let bestIdx = 1;
			for (let i = 2; i < r.correlations.length; i++) {
				if (r.correlations[i] > r.correlations[bestIdx]) bestIdx = i;
			}
			stats.peak_lag = r.lags[bestIdx];
			stats.peak_correlation = r.correlations[bestIdx];
			return { outputs, stats };
		}

		if (args.analysis === 'cosinor') {
			if (args.useFixedPeriod) {
				const r = fitCosinorFixed(
					tt,
					yy,
					args.fixedPeriod ?? 24,
					Math.max(1, args.nHarmonics ?? 1),
					args.alpha ?? 0.05
				);
				if (!r) return { outputs, stats };
				outputs.time = tt;
				outputs.fitted = r.fitted;
				stats.mesor = r.M;
				for (let h = 0; h < r.harmonics.length; h++) {
					stats[`H${h + 1}_amplitude`] = r.harmonics[h].amplitude;
					stats[`H${h + 1}_acrophase`] = r.harmonics[h].acrophase_hrs;
				}
				stats.r2 = r.R2;
				stats.rmse = r.RMSE;
				stats.pvalue = r.pF;
				return { outputs, stats };
			}
			const N = Math.max(1, args.Ncurves ?? 1);
			const r = fitCosineCurves(tt, yy, N);
			if (!r?.parameters?.cosines?.length) return { outputs, stats };
			outputs.time = tt;
			outputs.fitted = r.fitted ?? [];
			for (let c = 0; c < r.parameters.cosines.length; c++) {
				const cos = r.parameters.cosines[c];
				stats[`C${c + 1}_period`] = cos.frequency ? (2 * Math.PI) / cos.frequency : NaN;
				stats[`C${c + 1}_amplitude`] = cos.amplitude;
				stats[`C${c + 1}_phase`] = cos.phase;
			}
			stats.r2 = r.rSquared;
			stats.rmse = r.rmse;
			return { outputs, stats };
		}

		return { outputs, stats };
	}

	export function rhythmicityanalysis(argsIN) {
		const xIN = argsIN.xIN;
		let yINs = argsIN.yIN;
		if (!Array.isArray(yINs)) yINs = yINs != null && yINs !== -1 ? [yINs] : [];

		const empty = { y_results: {}, outputKeys: [], statKeys: [] };

		if (xIN == null || xIN === -1 || !getColumnById(xIN) || yINs.length === 0) {
			return [empty, false];
		}

		const tCol = getColumnById(xIN);
		const tAll = tCol.type === 'time' ? tCol.hoursSinceStart : tCol.getData();

		const outputKeys = getOutputKeys(argsIN);
		const statKeys = getStatKeys(argsIN);
		const y_results = {};
		let anyValid = false;

		for (const yId of yINs) {
			if (yId == null || yId === -1) continue;
			const yCol = getColumnById(yId);
			if (!yCol) continue;
			const yData = yCol.getData();

			const tt = [];
			const yy = [];
			for (let i = 0; i < tAll.length; i++) {
				const ti = tAll[i];
				const yi = yData[i];
				if (ti == null || yi == null || isNaN(ti) || isNaN(yi)) continue;
				tt.push(ti);
				yy.push(yi);
			}
			if (tt.length < 3) continue;

			const { outputs, stats } = runAnalysis(tt, yy, argsIN);
			y_results[yId] = { outputs, stats };
			if (outputKeys.some((k) => (outputs[k]?.length ?? 0) > 0)) anyValid = true;
		}

		// Apply pre-processes to each output array before writing
		for (const pp of argsIN.preProcesses ?? []) {
			if (!pp.processName) continue;
			const proc = appConsts.processMap.get(pp.processName);
			if (!proc?.func) continue;
			for (const yId of yINs) {
				const ys = y_results[yId];
				if (!ys) continue;
				for (const k of outputKeys) {
					if (Array.isArray(ys.outputs[k])) {
						ys.outputs[k] = proc.func(ys.outputs[k], pp.processArgs ?? {});
					}
				}
			}
		}

		if (anyValid) {
			const processHash = crypto.randomUUID();

			// Standalone-mode per-Y per-key writes (one column per array)
			for (const yId of yINs) {
				const ys = y_results[yId];
				if (!ys) continue;
				for (const k of outputKeys) {
					const outKey = `${yId}_${k}`;
					const outId = argsIN.out?.[outKey];
					if (outId == null || outId === -1) continue;
					const outCol = getColumnById(outId);
					if (!outCol) continue;
					core.rawData.set(outId, ys.outputs[k] ?? []);
					outCol.data = outId;
					outCol.type = 'number';
					outCol.tableProcessGUId = processHash;
				}
			}

			// Collected-mode shared X + per-Y primary Y (used inside CollectColumns / LongToWide)
			const primary = getPrimaryKeys(argsIN);
			const sharedXId = argsIN.out?.rhythmicityx;
			const hasSharedX = sharedXId != null && sharedXId !== -1;
			if (hasSharedX && primary.x) {
				// Grab the X array from the first Y that produced output
				let xData = [];
				for (const yId of yINs) {
					const ys = y_results[yId];
					const arr = ys?.outputs?.[primary.x];
					if (Array.isArray(arr) && arr.length > 0) {
						xData = arr;
						break;
					}
				}
				// For cosinor with a time-typed input X, convert hrs-since-start back to ms
				let xType = 'number';
				let xOut = xData;
				if (argsIN.analysis === 'cosinor' && tCol.type === 'time') {
					const originMs = tCol.getData()[0];
					if (originMs != null) {
						xOut = xData.map((h) => originMs + h * 3600000);
						xType = 'time';
					}
				}
				const xCol = getColumnById(sharedXId);
				if (xCol) {
					core.rawData.set(sharedXId, xOut);
					xCol.data = sharedXId;
					xCol.type = xType;
					if (xType === 'time') xCol.timeFormat = null;
					xCol.tableProcessGUId = processHash;
				}
			}
			if (primary.y) {
				for (const yId of yINs) {
					const ys = y_results[yId];
					if (!ys) continue;
					const yOutId = argsIN.out?.[`rhythmicityy_${yId}`];
					if (yOutId == null || yOutId === -1) continue;
					const yCol = getColumnById(yOutId);
					if (!yCol) continue;
					core.rawData.set(yOutId, ys.outputs[primary.y] ?? []);
					yCol.data = yOutId;
					yCol.type = 'number';
					yCol.tableProcessGUId = processHash;
				}
			}
		}

		return [{ y_results, outputKeys, statKeys }, anyValid];
	}
</script>

<script>
	// @ts-nocheck
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import StoreValueButton from '$lib/components/inputs/StoreValueButton.svelte';
	import { Column, getColumnById, removeColumn } from '$lib/core/Column.svelte';
	import { pushObj } from '$lib/core/core.svelte.js';
	import { onMount, untrack } from 'svelte';
	import {
		showStaticDataAsTable,
		saveStaticDataAsCSV
	} from '$lib/components/plotbits/helpers/save.svelte.js';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';

	let { p = $bindable(), hideInputs = false } = $props();

	// Backward compat: ensure yIN is always an array
	if (typeof p.args.yIN === 'number') {
		p.args.yIN = p.args.yIN !== -1 ? [p.args.yIN] : [];
	}
	if (typeof p.args.out !== 'object' || p.args.out === null) {
		p.args.out = {};
	}

	let result = $state();
	let mounted = $state(false);
	let calculating = $state(false);
	let _calcToken = 0;

	let xIN_col = $derived.by(() => (p.args.xIN >= 0 ? getColumnById(p.args.xIN) : null));

	let currentOutputKeys = $derived.by(() => getOutputKeys(p.args));
	let currentStatKeys = $derived.by(() => getStatKeys(p.args));

	let getHash = $derived.by(() => {
		let out = '';
		out += xIN_col?.getDataHash ?? '';
		for (const yId of p.args.yIN ?? []) {
			const col = yId >= 0 ? getColumnById(yId) : null;
			out += col?.getDataHash ?? '';
		}
		out +=
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
			p.args.pgAlpha +
			'|' +
			p.args.fftFreqStep +
			'|' +
			p.args.corrMaxLag +
			'|' +
			p.args.useFixedPeriod +
			'|' +
			p.args.fixedPeriod +
			'|' +
			p.args.nHarmonics +
			'|' +
			p.args.Ncurves +
			'|' +
			p.args.alpha +
			'|' +
			currentOutputKeys.join(',');
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

	// Reconcile output columns whenever yIN or output-key set changes
	$effect(() => {
		const _y = p.args.yIN;
		const _keys = currentOutputKeys;
		if (!mounted) return;
		untrack(() => {
			if (syncOutputColumns()) recompute();
		});
	});

	function recompute() {
		calculating = true;
		const token = ++_calcToken;
		setTimeout(() => {
			if (token !== _calcToken) return;
			[result, p.args.valid] = rhythmicityanalysis(p.args);
			calculating = false;
			lastHash = getHash;
		}, 0);
	}

	/**
	 * Reconcile `p.args.out` to match the current mode.
	 *  - Standalone (hideInputs=false): one column per (yId × output key)
	 *  - Collected  (hideInputs=true):  one shared X column + one Y per input,
	 *    mirroring Cosinor so CollectColumns / LongToWide chains stay simple.
	 */
	function syncOutputColumns() {
		if (!p.parent) return false;

		const activeIds = [...new Set((p.args.yIN ?? []).map(Number).filter((id) => id >= 0))];
		const desired = new Set();
		if (hideInputs) {
			if (activeIds.length > 0) desired.add('rhythmicityx');
			for (const yId of activeIds) desired.add(`rhythmicityy_${yId}`);
		} else {
			for (const yId of activeIds) {
				for (const k of currentOutputKeys) desired.add(`${yId}_${k}`);
			}
		}

		let changed = false;

		// Remove stale output keys (including ones from the other mode)
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

		// Add missing output columns
		if (hideInputs) {
			if (
				activeIds.length > 0 &&
				(p.args.out.rhythmicityx == null || p.args.out.rhythmicityx === -1)
			) {
				const col = new Column({});
				col.name = `rhythmicityx_${p.id ?? ''}`;
				pushObj(col);
				p.parent.columnRefs = [col.id, ...p.parent.columnRefs];
				p.args.out.rhythmicityx = col.id;
				changed = true;
			}
			for (const yId of activeIds) {
				const srcName = getColumnById(yId)?.name ?? String(yId);
				const key = `rhythmicityy_${yId}`;
				if (p.args.out[key] == null || p.args.out[key] === -1) {
					const col = new Column({});
					col.name = `rhythmicityy_${srcName}`;
					pushObj(col);
					p.parent.columnRefs = [col.id, ...p.parent.columnRefs];
					p.args.out[key] = col.id;
					changed = true;
				}
			}
		} else {
			for (const yId of activeIds) {
				const srcName = getColumnById(yId)?.name ?? String(yId);
				for (const k of currentOutputKeys) {
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
		}

		return changed;
	}

	let ownOutIds = $derived.by(() =>
		Object.values(p.args.out ?? {}).filter((v) => typeof v === 'number' && v >= 0)
	);

	let yExcludeIds = $derived.by(() => {
		if (hideInputs) return [];
		const ids = [p.args.xIN, ...ownOutIds];
		return ids.filter((id) => id >= 0);
	});

	onMount(() => {
		if (!p.args.out) p.args.out = {};
		const needsCompute = syncOutputColumns();
		if (needsCompute) {
			recompute();
		} else {
			// Try to load existing data from rawData (mode-aware)
			const y_results = {};
			let loadedAny = false;
			const primary = getPrimaryKeys(p.args);
			const sharedX =
				hideInputs && p.args.out.rhythmicityx >= 0 && core.rawData.has(p.args.out.rhythmicityx)
					? core.rawData.get(p.args.out.rhythmicityx)
					: null;
			for (const yId of p.args.yIN ?? []) {
				const outputs = {};
				if (hideInputs) {
					const yOutId = p.args.out[`rhythmicityy_${yId}`];
					if (yOutId >= 0 && core.rawData.has(yOutId) && primary.y) {
						outputs[primary.y] = core.rawData.get(yOutId);
						if (sharedX && primary.x) outputs[primary.x] = sharedX;
						loadedAny = true;
					}
				} else {
					for (const k of currentOutputKeys) {
						const outId = p.args.out[`${yId}_${k}`];
						if (outId >= 0 && core.rawData.has(outId)) {
							outputs[k] = core.rawData.get(outId);
							loadedAny = true;
						}
					}
				}
				y_results[yId] = { outputs, stats: {} };
			}
			if (loadedAny) {
				result = { y_results, outputKeys: currentOutputKeys, statKeys: currentStatKeys };
				p.args.valid = true;
				const inputsAreStale =
					(p.args.xIN >= 0 && (getColumnById(p.args.xIN)?.rawDataVersion ?? 0) > 0) ||
					(p.args.yIN ?? []).some((id) => (getColumnById(id)?.rawDataVersion ?? 0) > 0);
				if (!inputsAreStale) {
					lastHash = getHash;
				} else {
					recompute();
				}
			} else {
				recompute();
			}
		}
		mounted = true;
	});

	function formatStat(v) {
		if (v == null || !Number.isFinite(v)) return '—';
		const a = Math.abs(v);
		if (a !== 0 && (a < 0.01 || a >= 1e4)) return v.toExponential(3);
		return v.toFixed(3);
	}

	function getStatsData() {
		const headers = ['column', ...currentStatKeys];
		const rows = [];
		for (const yId of p.args.yIN ?? []) {
			const name = getColumnById(Number(yId))?.name ?? String(yId);
			const ys = result?.y_results?.[yId];
			const row = [name];
			for (const k of currentStatKeys) {
				const v = ys?.stats?.[k];
				row.push(Number.isFinite(v) ? v : null);
			}
			rows.push(row);
		}
		return { headers, rows };
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

<!-- Analysis Parameters -->
<div class="section-row">
	<div class="tableProcess-label"><span>Analysis</span></div>
	<div class="control-input-horizontal">
		<div class="control-input">
			<p>Analysis</p>
			<AttributeSelect
				bind:value={p.args.analysis}
				options={['periodogram', 'fft', 'cosinor', 'correlogram']}
				optionsDisplay={['Periodogram', 'FFT', 'Cosinor', 'Correlogram']}
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
				{#if p.args.pgMethod === 'Chi-squared'}
					<div class="control-input">
						<p>α (significance)</p>
						<NumberWithUnits bind:value={p.args.pgAlpha} min="0.0001" max="0.9999" step="0.01" />
					</div>
				{/if}
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
				<p>Max lag (hrs; 0 = half range)</p>
				<NumberWithUnits bind:value={p.args.corrMaxLag} min="0" step="1" />
			</div>
		</div>
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
			<div class="control-input-horizontal">
				<div class="control-input">
					<p>CI level</p>
					<select bind:value={p.args.alpha}>
						<option value={0.05}>95%</option>
						<option value={0.01}>99%</option>
					</select>
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
	{/if}
</div>

<!-- Output / Stats -->
<details open>
	<summary class="section-details-summary">Output</summary>
	<div class="section-row">
		<div class="section-content">
			{#if calculating}
				<LoadingSpinner message="Running analysis…" />
			{:else if p.args.valid && (p.args.yIN ?? []).length > 0}
				{@const primary = getPrimaryKeys(p.args)}
				<div class="tp-outputs">
					{#if hideInputs && p.args.out.rhythmicityx >= 0}
						{@const xOut = getColumnById(p.args.out.rhythmicityx)}
						{#if xOut}
							<div class="tp-output-row">
								<span class="tp-output-label">{primary.x} (shared)</span>
								<ColumnComponent col={xOut} />
							</div>
						{/if}
					{/if}
					{#each p.args.yIN ?? [] as yId (yId)}
						{@const srcName = getColumnById(Number(yId))?.name ?? yId}
						{@const yResult = result?.y_results?.[yId]}
						<div class="tp-output-block">
							<p><strong>{srcName}</strong></p>
							{#if hideInputs}
								{@const yOutId = p.args.out[`rhythmicityy_${yId}`]}
								{#if yOutId >= 0}
									{@const yOutCol = getColumnById(yOutId)}
									{#if yOutCol}
										<div class="tp-output-row">
											<span class="tp-output-label">{primary.y}</span>
											<ColumnComponent col={yOutCol} />
										</div>
									{/if}
								{/if}
							{:else}
								{#each currentOutputKeys as k (k)}
									{@const outId = p.args.out[`${yId}_${k}`]}
									{#if outId >= 0}
										{@const col = getColumnById(outId)}
										{#if col}
											<div class="tp-output-row">
												<span class="tp-output-label">{k}</span>
												<ColumnComponent {col} />
											</div>
										{/if}
									{/if}
								{/each}
							{/if}
							{#if yResult?.stats}
								<div class="tp-stats">
									{#each currentStatKeys as k (k)}
										<p>
											{k}: {formatStat(yResult.stats[k])}
											{#if Number.isFinite(yResult.stats[k])}
												<StoreValueButton
													label={k}
													getter={() => result?.y_results?.[yId]?.stats?.[k]}
													defaultName={`${p.args.analysis}_${k}_${srcName}`}
													source="Rhythmicity ({p.args.analysis})"
												/>
											{/if}
										</p>
									{/each}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{:else}
				<p>Select X and Y columns to run the analysis.</p>
			{/if}
		</div>
	</div>
</details>

{#if !calculating && p.args.valid && currentStatKeys.length > 0}
	<div class="tp-stat-actions">
		<button
			class="tp-stat-btn"
			onclick={() => {
				const { headers, rows } = getStatsData();
				showStaticDataAsTable('Rhythmicity stats', headers, rows, getStatsData);
			}}>View stats</button
		>
		<button
			class="tp-stat-btn"
			onclick={() => {
				const { headers, rows } = getStatsData();
				saveStaticDataAsCSV('rhythmicity_stats', headers, rows);
			}}>Download stats</button
		>
	</div>
{/if}

<style>
	.tp-output-block {
		margin-bottom: 0.5rem;
		padding-bottom: 0.25rem;
		border-bottom: 1px solid var(--color-lightness-95, #eee);
	}
	.tp-stats {
		margin-top: 0.25rem;
		padding-left: 0.25rem;
	}
	.tp-stats p {
		margin: 0.15rem 0;
	}
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
