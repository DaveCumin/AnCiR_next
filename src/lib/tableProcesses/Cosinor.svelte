<script module>
	import { core, appConsts } from '$lib/core/core.svelte';
	import { nodeMemo } from '$lib/core/computeMemo.js';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import { evaluateCosinorAtPoints } from '$lib/utils/cosinor.js';
	import { checkFitResultsFinite } from '$lib/utils/fitDomain.js';
	import { fitPermutationPValue, PERMUTATION_DEFAULTS } from '$lib/utils/fitFunction.js';
	import { runComputeTask } from '$lib/workers/workerPool.js';
	import { shouldUseWorkers } from '$lib/workers/workerGate.js';
	// Side-effect: registers 'cosinor.fitMany' on the main thread so sync fallback works.
	import { cosinorFitMany } from '$lib/utils/cosinor.worker-task.js';
	import {
		normalizeYInputs,
		migrateLegacyYIN,
		fillDefaults
	} from '$lib/tableProcesses/tpArgHelpers.js';
	import { writeOutputColumn, writeXOutput } from '$lib/tableProcesses/outputColumns.js';
	import { writeResidual, spawnResidualPlot } from '$lib/tableProcesses/residualSupport.js';
	import { attachPermutation } from '$lib/tableProcesses/permutationSupport.js';
	import { bathyphase, phaseAngleOfEntrainment, wrapToPeriod } from '$lib/utils/cosinorAddons.js';
	import { isInvalidValue } from '$lib/utils/stats.js';

	const displayName = 'Cosinor';
	const defaults = new Map([
		['xIN', { val: -1 }],
		['yIN', { val: [] }],
		['Ncurves', { val: 0 }],
		['outputX', { val: -1 }],
		// `cosinorx` + per-y `cosinory_<id>` are the fitted curve outputs. The
		// `period`/`amplitude`/`rsquared` outputs are scalar metrics exposed as
		// PORTS (the "stored values as output ports" pilot): each is an array with
		// one value per y input, so wiring e.g. `period` straight into a boxplot
		// compares the metric across series/animals without the global registry.
		[
			'out',
			{
				cosinorx: { val: -1 },
				period: { val: -1 },
				// MESOR (rhythm-adjusted mean), amplitude and acrophase (peak time, h)
				// are the three classical cosinor parameters — each a scalar metric port.
				mesor: { val: -1 },
				amplitude: { val: -1 },
				acrophase: { val: -1 },
				// Confidence intervals for the first harmonic's amplitude and acrophase.
				// fitCosinorFixed already computes both (CI_A / CI_acrophase) and the
				// panel shows them; these ports make them wireable. Fixed-period mode
				// only — the free-period fit has no closed-form interval.
				amplitude_ciLow: { val: -1 },
				amplitude_ciHigh: { val: -1 },
				acrophase_ciLow: { val: -1 },
				acrophase_ciHigh: { val: -1 },
				rsquared: { val: -1 },
				pvalue: { val: -1 },
				// Cheap add-on metrics derived from the fitted acrophase (one value
				// per y input, like the other scalar ports). `bathyphase` is the
				// trough time (acrophase + half-period); `phase_angle` is the phase
				// angle of entrainment (acrophase relative to `referenceHrs`).
				bathyphase: { val: -1 },
				phase_angle: { val: -1 }
			}
		],
		['valid', { val: false }],
		['useFixedPeriod', { val: false }],
		['fixedPeriod', { val: 24 }],
		['nHarmonics', { val: 1 }],
		['alpha', { val: 0.05 }],
		// Reference zeitgeber time (h) for the phase-angle-of-entrainment metric.
		['referenceHrs', { val: 0 }],
		// Permutation test: a model-vs-chance significance test for each y fit.
		['permuteTest', { val: PERMUTATION_DEFAULTS.permuteTest }],
		['nPermutations', { val: PERMUTATION_DEFAULTS.nPermutations }],
		['permutationSeed', { val: PERMUTATION_DEFAULTS.permutationSeed }],
		['permutationStatistic', { val: PERMUTATION_DEFAULTS.permutationStatistic }],
		['forcollected', { val: true }],
		['collectedType', { val: 'cosinor' }],
		['preProcesses', { val: [] }],
		['tableProcesses', { val: [] }]
	]);

	export const definition = {
		displayName,
		defaults,
		func: cosinor,
		columnIdFields: { scalar: ['xIN'], array: ['yIN'] },
		xOutKey: 'cosinorx',
		yOutKeyPrefix: 'cosinory_',
		nodeSpec: {
			id: 'tableprocess.cosinor',
			inputs: [
				{ name: 'xIN', kind: 'column', cardinality: 'one' },
				{ name: 'yIN', kind: 'column', cardinality: 'many' }
			],
			outputs: [
				{ name: 'cosinorx', kind: 'column', cardinality: 'one' },
				{
					name: 'cosinory_*',
					kind: 'column',
					cardinality: 'many',
					dynamicPrefix: 'cosinory_'
				},
				{ name: 'resid_*', kind: 'column', cardinality: 'many', dynamicPrefix: 'resid_' },
				// Scalar-metric ports (one value per y input).
				{ name: 'period', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'mesor', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'amplitude', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'amplitude_ciLow', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'amplitude_ciHigh', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'acrophase_ciLow', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'acrophase_ciHigh', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'acrophase', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'rsquared', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'pvalue', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'bathyphase', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'phase_angle', kind: 'column', cardinality: 'one', metric: true }
			]
		}
	};

	export async function evaluateCosinor(argsIN) {
		const xIN = argsIN.xIN;
		const yINs = normalizeYInputs(argsIN.yIN);
		const Ncurves = argsIN.Ncurves;
		const outputXId = argsIN.outputX;
		const useFixedPeriod = argsIN.useFixedPeriod ?? false;
		const fixedPeriod = argsIN.fixedPeriod ?? 24;
		const nHarmonics = argsIN.nHarmonics ?? 1;
		const alpha = argsIN.alpha ?? 0.05;

		// The permutation fit must match this node's fit, or the null distribution
		// is not the null for the model being reported.
		const permOptions = {
			useFixedPeriod,
			fixedPeriod,
			nHarmonics,
			Ncurves: Ncurves ?? 1,
			alpha
		};

		async function fitOne(tt, yy) {
			const payload = {
				t: tt,
				ys: [yy],
				Ncurves,
				useFixedPeriod,
				fixedPeriod,
				nHarmonics,
				alpha
			};
			let results;
			if (shouldUseWorkers({ inputLen: tt.length })) {
				({ results } = await runComputeTask('cosinor.fitMany', payload));
			} else {
				({ results } = cosinorFitMany(payload));
			}
			return results[0];
		}

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
			// Same null trap as the pair filter below: a null here survived `!isNaN` and the
			// curve was then evaluated at Number(null) === 0, drawing a spurious point back at
			// the time origin. A Split segment wired as the output grid is exactly that case.
			outputXData = outputXData.filter((v) => !isInvalidValue(v));
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
			// `isNaN(null)` is FALSE and `Number(null)` is 0, so an isNaN-only filter let every
			// null row through to be fitted as a zero. That matters because Split/Filter emit
			// full-length segments padded with null outside the window: a post-pulse segment
			// halved its mesor/amplitude and dragged a free-period fit to ~220 h (see
			// Cosinor.nulls.test.js). Same guard as RhythmicityAnalysis / MovingAnalysis.
			const validIndices = t
				.map((v, i) => (isInvalidValue(v) || isInvalidValue(y[i]) ? -1 : i))
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
				const fixedResult = await fitOne(tt, yy);
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
				const fittedData = await fitOne(tt, yy);
				if (fittedData) {
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
			}

			// Permutation test: model-vs-chance significance for THIS fit. Computed
			// here (not in the output-writing pass) so the panel and the stats table
			// can show it even when nothing downstream is wired to the `pvalue` port.
			if (argsIN.permuteTest) {
				attachPermutation(yResult, fitPermutationPValue(tt, yy, 'cosinor', permOptions, argsIN));
			}

			result.y_results[yId] = yResult;
			if (result.t.length === 0) result.t = tt;
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

		return [result, anyValid];
	}

	function writeCosinorOutputs(argsIN, result) {
		const xOUT = argsIN.out.cosinorx;
		if (xOUT == null || xOUT === -1) return;

		const yINs = normalizeYInputs(argsIN.yIN);
		if (!Object.keys(result.y_results ?? {}).length) return;

		const processHash = crypto.randomUUID();

		const firstYId = Object.keys(result.y_results)[0];
		const firstYResult = result.y_results[firstYId];
		const xOutData = firstYResult.xOutData ?? result.outputXData ?? firstYResult.t;
		writeXOutput(xOUT, xOutData, { originTime_ms: result.originTime_ms, processHash });

		// Full input x (in the fit's hour space), for residuals evaluated at every input row.
		const residTCol = getColumnById(argsIN.xIN);
		const tFull = residTCol
			? residTCol.type === 'time'
				? residTCol.hoursSinceStart
				: residTCol.getData()
			: [];

		for (const yId of yINs) {
			const yOUT = argsIN.out['cosinory_' + yId];
			const yResult = result.y_results[yId];
			if (yOUT != null && yOUT !== -1 && yResult) {
				const yOutData = yResult.yOutData ?? yResult.predicted ?? yResult.fittedData.fitted;
				writeOutputColumn(yOUT, yOutData, { processHash });
			}

			// Residual = observed − cosinor evaluated at every input x (full length).
			const residId = argsIN.out['resid_' + yId];
			if (residId != null && residId !== -1 && yResult) {
				const predicted = evaluateCosinorAtPoints(yResult.fittedData.parameters, tFull);
				writeResidual(residId, predicted, getColumnById(yId)?.getData() ?? [], tFull, processHash);
			}
		}

		// Scalar-metric ports: one value per y input, in yIN order. Reuses the
		// exact expressions behind the per-y StoreValueButtons so the wired values
		// match what users previously stored by name.
		const useFixed = argsIN.useFixedPeriod ?? false;
		const fixedPeriod = argsIN.fixedPeriod ?? 24;
		const referenceHrs = argsIN.referenceHrs ?? 0;
		const periodArr = [];
		const mesorArr = [];
		const amplitudeArr = [];
		const acrophaseArr = [];
		const ampCiLowArr = [];
		const ampCiHighArr = [];
		const acroCiLowArr = [];
		const acroCiHighArr = [];
		const rsquaredArr = [];
		const pvalueArr = [];
		const bathyphaseArr = [];
		const phaseAngleArr = [];
		for (const yId of yINs) {
			const yr = result.y_results[yId];
			let period = NaN;
			let mesor = NaN;
			let amplitude = NaN;
			let rsq = NaN;
			let acrophase = NaN;
			if (yr) {
				rsq = yr.fittedData?.rSquared ?? NaN;
				if (useFixed && yr.fixedStats) {
					period = fixedPeriod;
					// MESOR is the rhythm-adjusted mean (fixed-period fit's offset M).
					mesor = yr.fixedStats.M ?? NaN;
					amplitude = yr.fixedStats.harmonics?.[0]?.amplitude ?? NaN;
					// fixedStats gives the CLASSICAL acrophase (acrophase_hrs = wrap(-t_peak));
					// the free branch below feeds bathyphase/phaseAngle the true PEAK time,
					// so convert here to the same peak-time convention (t_peak = wrap(-acrophase_hrs)).
					// Without this, bathyphase/phase_angle were sign-inverted in fixed-period mode.
					const classicalAcro = yr.fixedStats.harmonics?.[0]?.acrophase_hrs ?? NaN;
					acrophase = wrapToPeriod(-classicalAcro, period);
				} else {
					const c = yr.fittedData?.parameters?.cosines?.[0];
					period = c?.frequency ? (2 * Math.PI) / c.frequency : NaN;
					// Free-fit offset O is the MESOR (rhythm-adjusted mean).
					mesor = yr.fittedData?.parameters?.O ?? NaN;
					amplitude = c?.amplitude ?? NaN;
					// Free cosine model: A·cos(ω·t + φ) peaks when ω·t + φ = 0, i.e.
					// t_peak = −φ/ω, wrapped into [0, period). bathyphase/phaseAngle
					// wrap internally so an unwrapped value here is fine.
					if (c?.frequency) acrophase = -c.phase / c.frequency;
				}
			}
			periodArr.push(period);
			mesorArr.push(mesor);
			amplitudeArr.push(amplitude);
			// CIs come from the fixed-period linear fit only; the free-period
			// nonlinear fit has no closed-form interval, so those stay NaN.
			const h1 = useFixed ? yr?.fixedStats?.harmonics?.[0] : null;
			ampCiLowArr.push(h1?.CI_A?.[0] ?? NaN);
			ampCiHighArr.push(h1?.CI_A?.[1] ?? NaN);
			// The acrophase CI is reported on the same peak-time convention as
			// `acrophase` itself, so the interval brackets the value shown.
			acroCiLowArr.push(h1?.CI_acrophase ? wrapToPeriod(-h1.CI_acrophase[1], period) : NaN);
			acroCiHighArr.push(h1?.CI_acrophase ? wrapToPeriod(-h1.CI_acrophase[0], period) : NaN);
			// Report acrophase as the peak time wrapped into [0, period), matching the
			// convention bathyphase/phase_angle already use.
			acrophaseArr.push(wrapToPeriod(acrophase, period));
			rsquaredArr.push(rsq);
			bathyphaseArr.push(bathyphase(acrophase, period));
			phaseAngleArr.push(phaseAngleOfEntrainment(acrophase, referenceHrs, period));

			// Already computed against the same null-filtered pairs the fit used.
			pvalueArr.push(yr?.pValue ?? NaN);
		}
		const writeScalarOut = (key, arr) => writeOutputColumn(argsIN.out[key], arr, { processHash });
		writeScalarOut('period', periodArr);
		writeScalarOut('mesor', mesorArr);
		writeScalarOut('amplitude', amplitudeArr);
		writeScalarOut('amplitude_ciLow', ampCiLowArr);
		writeScalarOut('amplitude_ciHigh', ampCiHighArr);
		writeScalarOut('acrophase_ciLow', acroCiLowArr);
		writeScalarOut('acrophase_ciHigh', acroCiHighArr);
		writeScalarOut('acrophase', acrophaseArr);
		writeScalarOut('rsquared', rsquaredArr);
		writeScalarOut('pvalue', pvalueArr);
		writeScalarOut('bathyphase', bathyphaseArr);
		writeScalarOut('phase_angle', phaseAngleArr);
	}

	// A cosinor needs enough of the cycle sampled AND enough cycles observed, and
	// they fail in different ways. Too few points per cycle and the waveform is
	// undersampled; too few CYCLES and the fit is essentially interpolating one
	// bump, which produces a confident amplitude and acrophase that no repetition
	// supports. Nelson et al. (1979) and the standard cosinor guidance ask for
	// several cycles before a period-fixed fit is interpretable.
	const COSINOR_MIN_CYCLES = 2;
	const COSINOR_MIN_POINTS_PER_CYCLE = 4; // Nyquist-ish floor for a sinusoid + harmonics

	function cosinorSampleWarnings(t, argsIN, nHarmonics) {
		const warnings = [];
		const finite = (t ?? []).filter((v) => v != null && Number.isFinite(Number(v))).map(Number);
		if (finite.length < 2) return warnings;

		const period = Number(argsIN.fixedPeriod) || 24;
		const span = Math.max(...finite) - Math.min(...finite);
		const cycles = span / period;
		const perCycle = finite.length / Math.max(cycles, 1e-9);

		if (argsIN.useFixedPeriod && cycles < COSINOR_MIN_CYCLES) {
			warnings.push(
				`Short record: ${cycles.toFixed(1)} cycles at a ${period} h period. A cosinor fitted to fewer than ${COSINOR_MIN_CYCLES} cycles is close to interpolating a single bump — the amplitude and acrophase will look precise but no repetition supports them.`
			);
		}

		// Harmonics need more points than the fundamental does.
		const needed = COSINOR_MIN_POINTS_PER_CYCLE * Math.max(1, nHarmonics);
		if (Number.isFinite(perCycle) && perCycle < needed) {
			warnings.push(
				`Sparse sampling: about ${perCycle.toFixed(1)} points per ${period} h cycle, and ${nHarmonics} harmonic${nHarmonics > 1 ? 's' : ''} needs at least ~${needed}. The waveform is undersampled, so amplitude is biased low and acrophase is unstable.`
			);
		}

		// The F-test needs residual degrees of freedom to mean anything.
		const nParams = 1 + 2 * Math.max(1, nHarmonics);
		if (finite.length <= nParams + 1) {
			warnings.push(
				`Only ${finite.length} usable points for a model with ${nParams} parameters. R² is inflated and the p-value is not trustworthy with this little residual freedom.`
			);
		}
		return warnings;
	}

	export async function cosinor(argsIN) {
		const [result, anyValid] = await evaluateCosinor(argsIN);
		if (anyValid && argsIN?.out?.cosinorx !== -1) {
			writeCosinorOutputs(argsIN, result);
		}
		const xCol = argsIN.xIN != null && argsIN.xIN !== -1 ? getColumnById(argsIN.xIN) : null;
		const t = xCol ? (xCol.type === 'time' ? xCol.hoursSinceStart : xCol.getData()) : null;
		// Deliberately NOT gated on anyValid: when the fit fails, "1.1 points per
		// 24 h cycle" is the most useful thing we can say, and suppressing it would
		// leave the user with a silent failure and no explanation.
		// A cosinor that ran but produced NaN (the optimiser gave up, or the fixed-period
		// design matrix was singular) has no convergence flag to read, so the non-finite
		// R²/RMSE is the observable symptom — and worth a sentence rather than dashes.
		const fitEntries = Object.entries(result?.y_results ?? {}).map(([yId, yr]) => ({
			label: `"${getColumnById(Number(yId))?.name ?? yId}"`,
			result: yr?.fittedData ?? null
		}));
		result.warnings = [
			...checkFitResultsFinite(fitEntries, 'The cosinor fit'),
			...cosinorSampleWarnings(t, argsIN, Math.max(1, Number(argsIN.nHarmonics) || 1))
		];
		return [result, anyValid];
	}
</script>

<script>
	// @ts-nocheck
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';
	import StoreValueButton from '$lib/components/inputs/StoreValueButton.svelte';
	import { Column, getColumnById } from '$lib/core/Column.svelte';
	import { pushObj } from '$lib/core/core.svelte.js';
	import { useMultiYTP } from '$lib/tableProcesses/useMultiYTP.svelte.js';
	import { syncMetricOutColumns } from '$lib/tableProcesses/metricOutputs.js';
	import { formatTimeFromUNIX } from '$lib/utils/time/TimeUtils.js';
	import { onMount, untrack } from 'svelte';
	import {
		showStaticDataAsTable,
		saveStaticDataAsCSV
	} from '$lib/components/plotbits/helpers/save.svelte.js';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';
	import PermutationSummary from '$lib/components/PermutationSummary.svelte';

	let { p = $bindable(), hideInputs = false } = $props();

	// Backwards compatibility: legacy scalar yIN → array, and initialise fields
	// absent in sessions saved before they existed.
	migrateLegacyYIN(p.args);
	fillDefaults(p.args, defaults);

	let cosinorData = $state();
	let showOutputX = $state(p.args.outputX !== -1);
	let mounted = $state(false);
	let previewStart = $state(1);
	let calculating = $state(false);
	let _calcToken = 0;

	// One entry per fitted y series, for the permutation readout under the test's controls.
	let permEntries = $derived(
		Object.entries(cosinorData?.y_results ?? {}).map(([yId, result]) => ({
			name: getColumnById(Number(yId))?.name ?? String(yId),
			result
		}))
	);

	const { syncYColumns, initYColumns } = useMultiYTP(p, 'cosinory_', 'cosinor_');
	const { syncYColumns: syncResidColumns, initYColumns: initResidColumns } = useMultiYTP(
		p,
		'resid_',
		'resid_'
	);

	// Residual diagnostic: spawn a scatterplot of the input x against this Y's residual column.
	function plotResiduals(yId, yName) {
		spawnResidualPlot(p, { xId: p.args.xIN, residId: p.args.out?.['resid_' + yId], label: yName });
	}

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
		out += p.args.referenceHrs;
		out += p.args.permuteTest;
		out += p.args.nPermutations;
		out += p.args.permutationSeed;
		out += p.args.permutationStatistic;
		// These change the result but were missing from this hash. While the memo
		// was component-local a view switch recomputed anyway and hid it; now that
		// the memo survives a remount, an omission here means an edit is ignored.
		out +=
			'|' +
			p.args.fixedPeriod +
			'|' +
			p.args.nHarmonics +
			'|' +
			p.args.alpha +
			'|' +
			p.args.Ncurves;
		return out;
	});
	// The stats (MESOR / amplitude / phase / CIs / F-stat / RMSE) live only in the
	// transient `cosinorData` and are NOT persisted with the session. That used to
	// force a recompute on every mount: seeding the hash from a persisted
	// `_fitHash` would skip the fit and leave the stats panel blank. The memo
	// carries the stats themselves alongside the hash, so the mount above puts them
	// back and the fit can safely be skipped. Mirrors RectangularWave /
	// NonparametricRA.
	// Backed by the session-lifetime compute memo, so a view switch (which destroys
	// and rebuilds this component) does not recompute unchanged inputs.
	const memo = nodeMemo(p, 'tableprocess');
	// Mirror the panel state into the memo so the next mount can restore it.
	// Guarded on undefined: a fresh instance that has not computed yet must not
	// wipe a cached result another instance is still showing.
	$effect(() => {
		if (cosinorData !== undefined) memo.payload = cosinorData;
	});

	$effect(() => {
		const dataHash = getHash;
		if (!mounted) return;
		if (memo.hash !== dataHash) {
			memo.hash = getHash; // read before untrack so it's tracked
			p.args._fitHash = memo.hash;
			calculating = true;
			const token = ++_calcToken;
			setTimeout(async () => {
				if (token !== _calcToken) return; // superseded by a newer request
				previewStart = 1;
				const promise = untrack(() => cosinor(p.args));
				const [data, valid] = await promise;
				if (token !== _calcToken) return; // re-check after await
				cosinorData = data;
				p.args.valid = valid;
				p.warnings = cosinorData?.warnings ?? [];
				calculating = false;
			}, 0);
		}
	});

	// Reconcile output columns when yIN changes (from ColumnSelector or parent)
	$effect(() => {
		p.args.yIN;
		if (!mounted) return;
		// Defer reconcile out of the effect: syncYColumns() calls `new Column()`, whose
		// $derived fields go inert if created while this effect is the active reaction
		// (Svelte derived_inert). A microtask runs with no active effect → root-owned.
		queueMicrotask(() =>
			untrack(() => {
				// `|` (not `||`) so both reconcile every time — short-circuit would skip resid columns.
				if (syncYColumns() | syncResidColumns()) getCosinor();
			})
		);
	});

	//------------
	function getCosinor() {
		previewStart = 1;
		calculating = true;
		const token = ++_calcToken;
		setTimeout(async () => {
			if (token !== _calcToken) return;
			const promise = untrack(() => cosinor(p.args));
			const [data, valid] = await promise;
			if (token !== _calcToken) return; // re-check after await
			cosinorData = data;
			p.args.valid = valid;
			p.warnings = cosinorData?.warnings ?? [];
			calculating = false;
			memo.hash = getHash;
			p.args._fitHash = memo.hash;
		}, 0);
	}

	// Exclude own output column IDs from the Y selector
	let yExcludeIds = $derived.by(() => {
		const ids = [p.args.xIN];
		if (p.args.out.cosinorx >= 0) ids.push(p.args.out.cosinorx);
		for (const key of Object.keys(p.args.out)) {
			if ((key.startsWith('cosinory_') || key.startsWith('resid_')) && p.args.out[key] >= 0) {
				ids.push(p.args.out[key]);
			}
		}
		return ids;
	});

	// Scalar-metric out-keys (one value per y input). bathyphase/phase_angle were
	// added after the original period/amplitude/rsquared/pvalue ports, so old
	// sessions lack their columns; syncMetricOutColumns backfills any missing ones.
	const METRIC_KEYS = [
		'period',
		'mesor',
		'amplitude',
		'acrophase',
		'rsquared',
		'pvalue',
		'bathyphase',
		'phase_angle'
	];

	onMount(() => {
		// Put the previous result back before anything else: the compute effect
		// skips when nothing changed, and this state died with the last instance.
		// Whether the cached result came back. The placeholder branch below must not
		// overwrite it: that placeholder carries no stats (rmse NaN, no parameters), and
		// since the memo already holds this hash the compute effect will not fire to
		// replace it — so the panel would stay stat-less until an input changed.
		const restoredFromMemo = memo.payload !== undefined && memo.hash === getHash;
		if (restoredFromMemo) cosinorData = memo.payload;
		// Create X output column if not present (needed in collected mode)
		let needsCompute = false;
		// Backfill scalar-metric out-columns for sessions saved before they existed.
		if (syncMetricOutColumns(p, METRIC_KEYS, (k) => METRIC_KEYS.includes(k))) {
			needsCompute = true;
		}
		if (p.args.out.cosinorx == null || p.args.out.cosinorx < 0) {
			if (p.parent) {
				const xCol = new Column({});
				xCol.name = 'cosinorx_' + p.id;
				pushObj(xCol);
				p.parent.columnRefs = [xCol.id, ...p.parent.columnRefs];
				p.args.out.cosinorx = xCol.id;
				needsCompute = true;
			}
		}
		if (initYColumns()) needsCompute = true;
		if (initResidColumns()) needsCompute = true;

		if (needsCompute) {
			getCosinor();
		} else if (!restoredFromMemo) {
			const xKey = p.args.out.cosinorx;
			if (xKey >= 0 && core.rawData.has(xKey) && core.rawData.get(xKey).length > 0) {
				// Check if any input columns have been replaced since session was saved
				const inputsAreStale =
					(p.args.xIN >= 0 && (getColumnById(p.args.xIN)?.rawDataVersion ?? 0) > 0) ||
					(p.args.yIN ?? []).some((id) => (getColumnById(id)?.rawDataVersion ?? 0) > 0);
				if (!inputsAreStale) {
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
					p.warnings = cosinorData?.warnings ?? [];
					// NOTE: memo.hash is deliberately NOT set here. The rehydrated
					// cosinorData only holds the fitted curve (from the saved output
					// column), not the derived stats, so we let the $effect fire once
					// after mount to recompute them. The curve above is just an instant
					// placeholder while that (worker-offloaded) recompute runs.
				}
			}
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

	function getCosinorStatsData() {
		if (!cosinorData?.y_results) return { headers: [], rows: [] };
		const useFixed = p.args.useFixedPeriod ?? false;
		const validEntries = Object.entries(cosinorData.y_results).filter(
			([, r]) => (r.fittedData?.fitted?.length ?? 0) > 0
		);
		if (!validEntries.length) return { headers: [], rows: [] };
		// The permutation p is a different test from the fixed-period F-test, so it
		// gets its own column (and only appears when the test was actually run).
		const withPerm = validEntries.some(([, r]) => Number.isFinite(r.pValue));
		const permHeader = withPerm ? ['perm_p_value'] : [];
		const permCell = (r) => (withPerm ? [r.pValue ?? null] : []);

		if (useFixed) {
			const maxH = Math.max(...validEntries.map(([, r]) => r.fixedStats?.harmonics?.length ?? 0));
			const headers = [
				'column',
				'rmse',
				'r2',
				'mesor',
				'mesor_ci_lo',
				'mesor_ci_hi',
				'F_stat',
				'F_p_value',
				...permHeader
			];
			for (let h = 1; h <= maxH; h++) {
				headers.push(
					`H${h}_amplitude`,
					`H${h}_amp_ci_lo`,
					`H${h}_amp_ci_hi`,
					`H${h}_acrophase_hrs`,
					`H${h}_acro_ci_lo`,
					`H${h}_acro_ci_hi`
				);
			}
			const rows = validEntries.map(([yId, r]) => {
				const name = getColumnById(Number(yId))?.name ?? String(yId);
				const s = r.fixedStats;
				const row = [
					name,
					r.fittedData.rmse,
					r.fittedData.rSquared,
					s?.M ?? null,
					s?.CI_M?.[0] ?? null,
					s?.CI_M?.[1] ?? null,
					s?.F_stat ?? null,
					s?.pF ?? null,
					...permCell(r)
				];
				for (let h = 0; h < maxH; h++) {
					const hd = s?.harmonics?.[h];
					row.push(
						hd?.amplitude ?? null,
						hd?.CI_A?.[0] ?? null,
						hd?.CI_A?.[1] ?? null,
						hd?.acrophase_hrs ?? null,
						hd?.CI_acrophase?.[0] ?? null,
						hd?.CI_acrophase?.[1] ?? null
					);
				}
				return row;
			});
			return { headers, rows };
		} else {
			const maxC = Math.max(
				...validEntries.map(([, r]) => r.fittedData?.parameters?.cosines?.length ?? 0)
			);
			const headers = ['column', 'rmse', 'r2', ...permHeader];
			for (let c = 1; c <= maxC; c++) {
				headers.push(`curve${c}_period`, `curve${c}_amplitude`, `curve${c}_phase`);
			}
			const rows = validEntries.map(([yId, r]) => {
				const name = getColumnById(Number(yId))?.name ?? String(yId);
				const row = [name, r.fittedData.rmse, r.fittedData.rSquared, ...permCell(r)];
				for (let c = 0; c < maxC; c++) {
					const cd = r.fittedData.parameters?.cosines?.[c];
					const period = cd?.frequency ? (2 * Math.PI) / cd.frequency : null;
					row.push(period, cd?.amplitude ?? null, cd?.phase ?? null);
				}
				return row;
			});
			return { headers, rows };
		}
	}
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
				<ColumnSelector bind:value={p.args.xIN} />
			</div>

			<div class="control-input-vertical">
				<div class="control-input">
					<p>Y columns</p>
					<ColumnSelector bind:value={p.args.yIN} excludeColIds={yExcludeIds} multiple={true} />
				</div>
			</div>
		</div>
	</div>
{/if}

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
			<ControlInput label="Period (hrs)">
				<NumberWithUnits
					bind:value={p.args.fixedPeriod}
					onInput={() => getCosinor()}
					min="0.1"
					step="0.5"
				/>
			</ControlInput>
			<ControlInput label="N harmonics">
				<NumberWithUnits
					bind:value={p.args.nHarmonics}
					onInput={() => getCosinor()}
					min="1"
					step="1"
				/>
			</ControlInput>
		</div>
		<div class="control-input-horizontal">
			<ControlInput label="CI level">
				<select bind:value={p.args.alpha} onchange={() => getCosinor()}>
					<option value={0.05}>95%</option>
					<option value={0.01}>99%</option>
				</select>
			</ControlInput>
		</div>
	{:else}
		<div class="control-input-horizontal">
			<ControlInput label="N cosine curves">
				<NumberWithUnits
					bind:value={p.args.Ncurves}
					onInput={() => getCosinor()}
					min="1"
					step="1"
				/>
			</ControlInput>
		</div>
	{/if}

	<div class="control-input-horizontal">
		<ControlInput label="Reference time (h)">
			<NumberWithUnits bind:value={p.args.referenceHrs} onInput={() => getCosinor()} step="1" />
		</ControlInput>
	</div>

	<div class="tableProcess-label">
		<span>Permutation test</span>
	</div>
	<div class="control-input-horizontal">
		<div class="control-input">
			<label>
				<input type="checkbox" bind:checked={p.args.permuteTest} onchange={() => getCosinor()} />
				Test significance (model vs chance)
			</label>
		</div>
	</div>
	{#if p.args.permuteTest}
		<div class="control-input-horizontal">
			<ControlInput label="Permutations">
				<NumberWithUnits
					bind:value={p.args.nPermutations}
					onInput={() => getCosinor()}
					min="99"
					step="100"
				/>
			</ControlInput>
			<ControlInput label="Seed">
				<NumberWithUnits
					bind:value={p.args.permutationSeed}
					onInput={() => getCosinor()}
					min="0"
					step="1"
				/>
			</ControlInput>
		</div>
		<PermutationSummary entries={permEntries} nodeId={p.id} label="Cosinor" />
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

{#snippet cosinorStats(yResult, yName, yId)}
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
			{#if yId != null && p.args.out?.['resid_' + yId] >= 0}
				<button
					class="tp-stat-btn"
					onclick={() => plotResiduals(yId, yName)}
					title="Scatter the residuals (observed − fitted) against the input x to check the fit"
					>Plot residuals</button
				>
			{/if}
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
			{#if Number.isFinite(yResult?.pValue)}
				<p
					style="color: {yResult.significant
						? 'var(--color-success)'
						: 'var(--color-warning-text)'}; font-weight: 600;"
				>
					Permutation p: {yResult.pValue.toFixed(4)}
					{#if yResult.significant}
						✓ Significant (p &lt; 0.05)
					{:else}
						⚠ Not significant (p ≥ 0.05)
					{/if}
					<StoreValueButton
						label="Permutation p"
						getter={() => yResult?.pValue}
						defaultName={`cosinor_perm_p_${yName}`}
						source="Cosinor (permutation)"
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
				<!-- {#if !yResult?.fixedStats}
					<p>
						Equation: {cosine.amplitude.toFixed(2)}*cos({cosine.frequency.toFixed(2)}*t + {cosine.phase.toFixed(
							2
						)})
					</p>
				{/if} -->
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
<details open>
	<summary class="section-details-summary">Output</summary>
	<div class="section-row">
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
					{#each p.args.yIN ?? [] as yId (yId)}
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
										{@render cosinorStats(yResult, yout.name, yId)}
									{/if}
								</div>
							{/if}
						{/if}
					{/each}
				</div>
			{:else if p.args.valid}
				<p>Preview:</p>
				{#each Object.entries(cosinorData?.y_results ?? {}) as [yId, yResult] (yId)}
					{@const srcName = getColumnById(Number(yId))?.name ?? yId}
					<div class="div-line"></div>
					<p><strong>{srcName}</strong></p>
					{@render cosinorStats(yResult, srcName, yId)}
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
						xData.slice(previewStart - 1, previewStart + 5).map((x) =>
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
</details>
{#if !calculating && p.args.valid && p.args.out.cosinorx != -1}
	<div class="tp-stat-actions">
		<button
			class="tp-stat-btn"
			onclick={() => {
				const { headers, rows } = getCosinorStatsData();
				showStaticDataAsTable(
					'Cosinor stats',
					headers,
					rows,
					getCosinorStatsData,
					`tableprocess_${p.id}`
				);
			}}>View stats</button
		>
		<button
			class="tp-stat-btn"
			onclick={() => {
				const { headers, rows } = getCosinorStatsData();
				saveStaticDataAsCSV('cosinor_stats', headers, rows);
			}}>Download stats</button
		>
	</div>
{/if}

{#each cosinorData?.warnings ?? [] as w (w)}
	<p class="warn">{w}</p>
{/each}

<style>
	/* Matches ChiSquared / Rayleigh / NPCRA. */
	.warn {
		font-size: var(--font-xs);
		color: var(--color-warning-text);
		background: var(--color-warning-bg);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		margin: var(--space-1) 0 0;
	}
	.tp-stat-actions {
		display: flex;
		gap: 0.4rem;
		margin-top: 0.3rem;
	}

	.tp-stat-btn {
		font-size: var(--font-xs);
		padding: var(--space-2) var(--space-4);
		border: 1px solid var(--color-lightness-75);
		border-radius: var(--radius-xs);
		background: none;
		cursor: pointer;
		color: var(--color-lightness-35);
	}

	.tp-stat-btn:hover {
		background: var(--color-lightness-95);
		border-color: var(--color-lightness-55);
	}
</style>
