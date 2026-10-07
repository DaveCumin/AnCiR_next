<script module>
	import { core, appConsts } from '$lib/core/core.svelte';
	import { nodeMemo } from '$lib/core/computeMemo.js';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import {
		evaluateCosinorAtPoints,
		freePeriodFitWarnings,
		FREE_PERIOD_DEFAULTS
	} from '$lib/utils/cosinor.js';
	import { periodRangeWarnings } from '$lib/utils/periodRangeWarnings.js';
	import { periodUnitForColumn, periodInputProps } from '$lib/utils/periodUnits.js';
	import { newPeriodRangeArgs } from '$lib/tableProcesses/periodRangeAuto.svelte.js';
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
	import {
		writeOutputColumn,
		writeXOutput,
		clearOutputColumns
	} from '$lib/tableProcesses/outputColumns.js';
	import { writeResidual, spawnResidualPlot } from '$lib/tableProcesses/residualSupport.js';
	import {
		attachPermutation,
		permutationValidityWarnings
	} from '$lib/tableProcesses/permutationSupport.js';
	import {
		bathyphase,
		phaseAngleOfEntrainment,
		wrapToPeriod,
		multiComponentWaveform
	} from '$lib/utils/cosinorAddons.js';
	import { isInvalidValue } from '$lib/utils/stats.js';
	import {
		fitTimeFrame,
		applyPhaseReference,
		PHASE_REFERENCE_START
	} from '$lib/utils/phaseReference.js';
	import { resolveNodePhaseReference } from '$lib/tableProcesses/phaseReferenceSupport.js';

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
				// With nHarmonics > 1 (fixed period) `amplitude`, `acrophase` and
				// `bathyphase` describe the OVERALL fitted waveform (half its range, the
				// times of its maximum and minimum; review FIT-13), and the `*_h1` ports
				// below carry harmonic 1. With one harmonic (and in free-period mode,
				// curve 1) the two families hold the same numbers.
				mesor: { val: -1 },
				amplitude: { val: -1 },
				acrophase: { val: -1 },
				amplitude_h1: { val: -1 },
				acrophase_h1: { val: -1 },
				bathyphase_h1: { val: -1 },
				// Confidence intervals for the first harmonic's amplitude and acrophase.
				// fitCosinorFixed already computes both (CI_A / CI_acrophase) and the
				// panel shows them; these ports make them wireable. Fixed-period mode
				// only; the free-period fit has no closed-form interval. The acrophase
				// CI is NaN when the amplitude is not significant or the interval spans
				// a full cycle (FIT-7, see acrophaseCIDetermined in utils/cosinor.js).
				amplitude_ciLow: { val: -1 },
				amplitude_ciHigh: { val: -1 },
				acrophase_ciLow: { val: -1 },
				acrophase_ciHigh: { val: -1 },
				rsquared: { val: -1 },
				// `pvalue` is the ANALYTIC fit p: the zero-amplitude F-test of the
				// fixed-period cosinor against the MESOR-only model (Cornelissen 2014).
				// NaN for the free-period fit, which has no analytic test (the period
				// is estimated, so the F null distribution does not hold).
				// `perm_pvalue` is the OPTIONAL permutation test's empirical p — a
				// different test, on its own port, populated only when the test runs.
				// It used to overload `pvalue`, so the port silently changed meaning
				// (and was NaN with the test off, despite a computed F-test).
				pvalue: { val: -1 },
				perm_pvalue: { val: -1 },
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
		// Free-period fit only: the period range the fit may use, in x units (hours
		// for a time x). Without a bound the optimiser followed trends out to
		// thousands of hours on real activity data (see cosinor.js). Sessions saved
		// before these existed get the defaults via fillDefaults. A NEW node's range
		// follows its x instead (newNodeArgs below; periodRangeAuto.svelte.js).
		['minPeriod', { val: FREE_PERIOD_DEFAULTS.minPeriod }],
		['maxPeriod', { val: FREE_PERIOD_DEFAULTS.maxPeriod }],
		['nHarmonics', { val: 1 }],
		['alpha', { val: 0.05 }],
		// Reference zeitgeber time (h) for the phase-angle-of-entrainment metric.
		['referenceHrs', { val: 0 }],
		// What hour 0 means for every phase output (acrophase, bathyphase, their CIs,
		// phase angle): 'start' = hours after the first sample (x = 0 for a numeric
		// x; the default, and what sessions saved before this arg existed report),
		// 'clock' = hours after local midnight in the display timezone, wrapped to
		// [0, period). Review FIT-9; see utils/phaseReference.js.
		['phaseReference', { val: PHASE_REFERENCE_START }],
		// Permutation test: a model-vs-chance significance test for each y fit.
		['permuteTest', { val: PERMUTATION_DEFAULTS.permuteTest }],
		['nPermutations', { val: PERMUTATION_DEFAULTS.nPermutations }],
		['permutationSeed', { val: PERMUTATION_DEFAULTS.permutationSeed }],
		['permutationStatistic', { val: PERMUTATION_DEFAULTS.permutationStatistic }],
		// 'shuffle' (single values; assumes exchangeable observations) or 'block' (one-period
		// circular blocks, which keep short-range autocorrelation). Review finding FIT-5.
		['permutationScheme', { val: PERMUTATION_DEFAULTS.permutationScheme }],
		['forcollected', { val: true }],
		['collectedType', { val: 'cosinor' }],
		['preProcesses', { val: [] }],
		['tableProcesses', { val: [] }]
	]);

	export const definition = {
		displayName,
		defaults,
		// Only a new node's period range follows its x (periodRangeAuto.svelte.js).
		newNodeArgs: newPeriodRangeArgs,
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
				{ name: 'perm_pvalue', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'bathyphase', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'phase_angle', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'amplitude_h1', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'acrophase_h1', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'bathyphase_h1', kind: 'column', cardinality: 'one', metric: true }
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
		const minPeriod = argsIN.minPeriod ?? FREE_PERIOD_DEFAULTS.minPeriod;
		const maxPeriod = argsIN.maxPeriod ?? FREE_PERIOD_DEFAULTS.maxPeriod;

		// The permutation fit must match this node's fit, or the null distribution
		// is not the null for the model being reported.
		const permOptions = {
			useFixedPeriod,
			fixedPeriod,
			nHarmonics,
			Ncurves: Ncurves ?? 1,
			alpha,
			minPeriod,
			maxPeriod
		};

		async function fitOne(tt, yy) {
			const payload = {
				t: tt,
				ys: [yy],
				Ncurves,
				useFixedPeriod,
				fixedPeriod,
				nHarmonics,
				alpha,
				minPeriod,
				maxPeriod
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

		// The output grid (when given) in the fit's hour frame, and the origin that turns
		// those hours back into timestamps: the input's MINIMUM valid time, the baseline
		// hoursSinceStart measures from (review STAT-19). getData()[0] was null for a
		// Split segment and wrong for unsorted data, and a time grid used to be read in
		// its own frame, so a grid starting later than the input was evaluated early.
		// Invalid grid values are dropped: one evaluated at Number(null) === 0 drew a
		// spurious point back at the time origin.
		const outputXCol = outputXId != -1 ? getColumnById(outputXId) : null;
		const { outputXData, originTime_ms } = fitTimeFrame(tCol, outputXCol);

		result.outputXData = outputXData;
		result.originTime_ms = originTime_ms;
		// The frame every phase output is reported in (FIT-9).
		result.phaseRef = resolveNodePhaseReference(argsIN, tCol);
		// Test-validity warnings per series (review FIT-5): the F-test and the shuffle
		// permutation test assume independent observations.
		result.validityWarnings = [];

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
			const perm = argsIN.permuteTest
				? fitPermutationPValue(tt, yy, 'cosinor', permOptions, argsIN)
				: null;
			if (perm) attachPermutation(yResult, perm);
			const fitted = yResult.fittedData?.fitted ?? [];
			if (fitted.length === yy.length) {
				result.validityWarnings.push(
					...permutationValidityWarnings(
						perm,
						yy.map((v, i) => v - fitted[i]),
						`"${yCol.name ?? yId}"`,
						// The F-test p exists only for the fixed-period fit.
						{ fTest: useFixedPeriod && !!yResult.fixedStats }
					)
				);
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

	/**
	 * Every scalar metric of one y series' fit, in the node's phase reference: the
	 * single source for the ports, the panel and the stats table.
	 *
	 * Phases are computed as hours after t = 0 of the fit's frame (the first sample
	 * of a time x; x = 0 of a numeric x) and then expressed in `phaseRef` by
	 * applyPhaseReference, which leaves them untouched in the default reference.
	 *
	 * nHarmonics > 1 (fixed period): `amplitude`, `acrophase`, `bathyphase` are the
	 * overall waveform's half-range, orthophase and bathyphase (multiComponentWaveform,
	 * review FIT-13) and `phase_angle` is measured from that orthophase; the `*_h1`
	 * keys and the acrophase/amplitude CIs are harmonic 1's. Otherwise both families
	 * are harmonic 1 (free period: curve 1), computed exactly as before FIT-13.
	 *
	 * @param {object|undefined} yr  one entry of result.y_results
	 * @param {object} args  the node args
	 * @param {{clock:boolean, offsetHours:number}|undefined} phaseRef
	 * @returns {Record<string, number>}
	 */
	export function cosinorMetrics(yr, args, phaseRef) {
		const useFixed = args.useFixedPeriod ?? false;
		const fixedPeriod = args.fixedPeriod ?? 24;
		const referenceHrs = args.referenceHrs ?? 0;
		let period = NaN;
		let mesor = NaN;
		let amplitude = NaN;
		let rsq = NaN;
		// Harmonic 1's (curve 1's) time of peak, unwrapped, hours after t = 0.
		let acrophase = NaN;
		let overall = null;
		if (yr) {
			rsq = yr.fittedData?.rSquared ?? NaN;
			if (useFixed && yr.fixedStats) {
				period = fixedPeriod;
				// MESOR is the rhythm-adjusted mean (fixed-period fit's offset M).
				mesor = yr.fixedStats.M ?? NaN;
				amplitude = yr.fixedStats.harmonics?.[0]?.amplitude ?? NaN;
				// fitCosinorFixed reports acrophase_hrs as the time of peak (h after
				// t = 0), the same convention as the free branch below and as the
				// panel and stats CSV. (It used to return the classical wrap(−t_peak),
				// which this line negated while the panel and CSV did not.)
				acrophase = yr.fixedStats.harmonics?.[0]?.acrophase_hrs ?? NaN;
				if ((yr.fixedStats.harmonics?.length ?? 0) > 1) {
					overall = multiComponentWaveform(yr.fixedStats.M, yr.fixedStats.harmonics, period);
				}
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
		const ref = (h) => applyPhaseReference(h, phaseRef, period);
		// Harmonic 1, in the node's phase reference.
		const acroH1 = ref(wrapToPeriod(acrophase, period));
		const bathyH1 = ref(bathyphase(acrophase, period));
		// CIs come from the fixed-period linear fit only; the free-period
		// nonlinear fit has no closed-form interval, so those stay NaN. Each end of
		// the (unwrapped) peak-time CI is wrapped onto the clock, as the panel and
		// stats CSV show it, so an interval that spans t = 0 reads e.g. 23.1 to 0.9 h.
		const h1 = useFixed ? yr?.fixedStats?.harmonics?.[0] : null;
		// The peak the phase angle is measured from, before referencing.
		const peak = overall ? overall.orthophase : acrophase;
		const peakRef = phaseRef?.clock ? peak + phaseRef.offsetHours : peak;
		return {
			period,
			mesor,
			amplitude: overall ? overall.amplitude : amplitude,
			// Report acrophase as the peak time wrapped into [0, period), matching the
			// convention bathyphase/phase_angle already use.
			acrophase: overall ? ref(overall.orthophase) : acroH1,
			bathyphase: overall ? ref(overall.bathyphase) : bathyH1,
			phase_angle: phaseAngleOfEntrainment(peakRef, referenceHrs, period),
			amplitude_h1: amplitude,
			acrophase_h1: acroH1,
			bathyphase_h1: bathyH1,
			amplitude_ciLow: h1?.CI_A?.[0] ?? NaN,
			amplitude_ciHigh: h1?.CI_A?.[1] ?? NaN,
			acrophase_ciLow: h1?.CI_acrophase ? ref(wrapToPeriod(h1.CI_acrophase[0], period)) : NaN,
			acrophase_ciHigh: h1?.CI_acrophase ? ref(wrapToPeriod(h1.CI_acrophase[1], period)) : NaN,
			rsquared: rsq,
			// `pvalue` = the ANALYTIC zero-amplitude F-test p, straight off the
			// fixed-period fit — the number the panel prints as "F(df1, df2) = …, p"
			// and the one a user reading "p" next to R² expects. It used to carry the
			// permutation p instead (NaN unless that optional test ran), so the port
			// disagreed with both the handbook and the Python mirror. Free-period
			// fits stay NaN: with the period estimated, no analytic test exists.
			pvalue: useFixed ? (yr?.fixedStats?.pF ?? NaN) : NaN,
			// The permutation p is a DIFFERENT test (model vs chance, empirical
			// null), already computed against the same null-filtered pairs the fit
			// used; it keeps its own port and is NaN when the test did not run.
			perm_pvalue: yr?.pValue ?? NaN
		};
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

		// Scalar-metric ports: one value per y input, in yIN order. The numbers come
		// from cosinorMetrics, the same function the panel and stats table read, so a
		// wired value always matches what the panel shows.
		const metricKeys = [
			'period',
			'mesor',
			'amplitude',
			'amplitude_ciLow',
			'amplitude_ciHigh',
			'acrophase_ciLow',
			'acrophase_ciHigh',
			'acrophase',
			'rsquared',
			'pvalue',
			'perm_pvalue',
			'bathyphase',
			'phase_angle',
			'amplitude_h1',
			'acrophase_h1',
			'bathyphase_h1'
		];
		const perY = yINs.map((yId) => cosinorMetrics(result.y_results[yId], argsIN, result.phaseRef));
		for (const key of metricKeys) {
			writeOutputColumn(
				argsIN.out[key],
				perY.map((m) => m[key]),
				{ processHash }
			);
		}
	}

	// A cosinor needs enough of the cycle sampled AND enough cycles observed, and
	// they fail in different ways. Too few points per cycle and the waveform is
	// undersampled; too few CYCLES and the fit is essentially interpolating one
	// bump, which produces a confident amplitude and acrophase that no repetition
	// supports. Nelson et al. (1979) and the standard cosinor guidance ask for
	// several cycles before a period-fixed fit is interpretable.
	const COSINOR_MIN_CYCLES = 2;
	const COSINOR_MIN_POINTS_PER_CYCLE = 4; // Nyquist-ish floor for a sinusoid + harmonics

	function cosinorSampleWarnings(t, argsIN, nHarmonics, unit = 'h') {
		const warnings = [];
		const finite = (t ?? []).filter((v) => v != null && Number.isFinite(Number(v))).map(Number);
		if (finite.length < 2) return warnings;

		const period = Number(argsIN.fixedPeriod) || 24;
		// Loop rather than Math.max(...finite): a spread of a long series overflows the stack.
		let lo = Infinity;
		let hi = -Infinity;
		for (const v of finite) {
			if (v < lo) lo = v;
			if (v > hi) hi = v;
		}
		const span = hi - lo;
		const cycles = span / period;
		const perCycle = finite.length / Math.max(cycles, 1e-9);

		if (argsIN.useFixedPeriod && cycles < COSINOR_MIN_CYCLES) {
			warnings.push(
				`Short record: ${cycles.toFixed(1)} cycles at a ${period} ${unit} period. A cosinor fitted to fewer than ${COSINOR_MIN_CYCLES} cycles is close to interpolating a single bump. The amplitude and acrophase will look precise, but no repetition supports them.`
			);
		}

		// Harmonics need more points than the fundamental does.
		const needed = COSINOR_MIN_POINTS_PER_CYCLE * Math.max(1, nHarmonics);
		if (Number.isFinite(perCycle) && perCycle < needed) {
			warnings.push(
				`Sparse sampling: about ${perCycle.toFixed(1)} points per ${period} ${unit} cycle, and ${nHarmonics} harmonic${nHarmonics > 1 ? 's' : ''} needs at least ~${needed}. The waveform is undersampled, so amplitude is biased low and acrophase is unstable.`
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
		// Periods and phases are in x's units: hours for a time x, else the column's own.
		const unit = periodUnitForColumn(xCol);
		// Deliberately NOT gated on anyValid: when the fit fails, "1.1 points per
		// 24 h cycle" is the most useful thing we can say, and suppressing it would
		// leave the user with a silent failure and no explanation.
		// A cosinor that ran but produced NaN (the optimiser gave up, or the fixed-period
		// design matrix was singular) has no convergence flag to read, so the non-finite
		// R²/RMSE is the observable symptom — and worth a sentence rather than dashes.
		const fitEntries = Object.entries(result?.y_results ?? {}).map(([yId, yr]) => ({
			label: `"${getColumnById(Number(yId))?.name ?? yId}"`,
			result: yr?.fittedData ?? null,
			t: yr?.t
		}));
		result.warnings = [
			...checkFitResultsFinite(fitEntries, 'The cosinor fit'),
			...(argsIN.useFixedPeriod
				? []
				: [
						...periodRangeWarnings(t, argsIN.minPeriod, argsIN.maxPeriod, { unit }),
						...freePeriodFitWarnings(fitEntries, 'The free-period cosinor fit', { unit })
					]),
			...(result?.validityWarnings ?? []),
			...(result?.phaseRef?.warning ? [result.phaseRef.warning] : []),
			...cosinorSampleWarnings(t, argsIN, Math.max(1, Number(argsIN.nHarmonics) || 1), unit)
		];
		return [result, anyValid];
	}

	/**
	 * The "View stats" / "Download stats" table. Module-level and pure (bar the
	 * column-name lookup) so the acrophase convention it prints is testable
	 * against the ports. Every acrophase here is the time of peak in the node's
	 * phase reference: hours after the start (`*_peak_h` columns) or clock time
	 * of day (`*_clock_h`), the same number as the `acrophase` port.
	 */
	export function cosinorStatsTable(cosinorData, args) {
		if (!cosinorData?.y_results) return { headers: [], rows: [] };
		const useFixed = args.useFixedPeriod ?? false;
		const phaseRef = cosinorData.phaseRef;
		const unit = phaseRef?.clock ? 'clock_h' : 'peak_h';
		const ref = (h, period) => (h == null ? null : applyPhaseReference(h, phaseRef, period));
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
			// With several harmonics, the overall waveform the ports report (FIT-13).
			if (maxH > 1) {
				headers.push('overall_amplitude', `orthophase_${unit}`, `bathyphase_${unit}`);
			}
			for (let h = 1; h <= maxH; h++) {
				headers.push(
					`H${h}_amplitude`,
					`H${h}_amp_ci_lo`,
					`H${h}_amp_ci_hi`,
					// Time of peak in the phase reference, the same number as the
					// `acrophase_h1` port; CI ends wrapped onto the clock like the port.
					`H${h}_acrophase_${unit}`,
					`H${h}_acrophase_ci_lo`,
					`H${h}_acrophase_ci_hi`
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
				if (maxH > 1) {
					const m = cosinorMetrics(r, args, phaseRef);
					const multi = (s?.harmonics?.length ?? 0) > 1;
					row.push(
						multi ? m.amplitude : null,
						multi ? m.acrophase : null,
						multi ? m.bathyphase : null
					);
				}
				for (let h = 0; h < maxH; h++) {
					const hd = s?.harmonics?.[h];
					const hPeriod = (s?.period ?? args.fixedPeriod ?? 24) / (h + 1);
					row.push(
						hd?.amplitude ?? null,
						hd?.CI_A?.[0] ?? null,
						hd?.CI_A?.[1] ?? null,
						ref(hd?.acrophase_hrs ?? null, hPeriod),
						// An undetermined acrophase CI (FIT-7, NaN ends) is an empty cell, as a
						// missing value is.
						Number.isFinite(hd?.CI_acrophase?.[0])
							? ref(wrapToPeriod(hd.CI_acrophase[0], hPeriod), hPeriod)
							: null,
						Number.isFinite(hd?.CI_acrophase?.[1])
							? ref(wrapToPeriod(hd.CI_acrophase[1], hPeriod), hPeriod)
							: null
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
				// `phase_rad` is the model's φ (A·cos(ωt + φ)); `acrophase_peak_h` is the
				// time of peak, the convention every acrophase in AnCiR uses.
				headers.push(
					`curve${c}_period`,
					`curve${c}_amplitude`,
					`curve${c}_phase_rad`,
					`curve${c}_acrophase_${unit}`
				);
			}
			const rows = validEntries.map(([yId, r]) => {
				const name = getColumnById(Number(yId))?.name ?? String(yId);
				const row = [name, r.fittedData.rmse, r.fittedData.rSquared, ...permCell(r)];
				for (let c = 0; c < maxC; c++) {
					const cd = r.fittedData.parameters?.cosines?.[c];
					const period = cd?.frequency ? (2 * Math.PI) / cd.frequency : null;
					row.push(
						period,
						cd?.amplitude ?? null,
						cd?.phase ?? null,
						period ? ref(wrapToPeriod(-cd.phase / cd.frequency, period), period) : null
					);
				}
				return row;
			});
			return { headers, rows };
		}
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
	import {
		usePeriodRangeAuto,
		stopFollowingX
	} from '$lib/tableProcesses/periodRangeAuto.svelte.js';
	import { syncMetricOutColumns } from '$lib/tableProcesses/metricOutputs.js';
	import { formatTimeFromUNIX } from '$lib/utils/time/TimeUtils.js';
	import { onMount, untrack } from 'svelte';
	import {
		showStaticDataAsTable,
		saveStaticDataAsCSV
	} from '$lib/components/plotbits/helpers/save.svelte.js';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';
	import PermutationSummary from '$lib/components/PermutationSummary.svelte';
	import { createComputeRunner, computeErrorMessage } from '$lib/core/asyncCompute.js';
	import ErrorBox from '$lib/components/reusables/ErrorBox.svelte';
	import PhaseReferenceSelect from '$lib/components/inputs/PhaseReferenceSelect.svelte';
	import { appState } from '$lib/core/core.svelte';

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
	// The message of a compute that threw (ROB-11), shown on the node with a Try again button.
	let calcError = $state(null);

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
	// The unit of every period and phase on this panel: h for a time x, else "x units".
	let periodUnit = $derived(periodUnitForColumn(xIN_col));
	// A new node's period range follows its x until the user edits it.
	usePeriodRangeAuto(p, () => xIN_col);
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
			p.args.Ncurves +
			'|' +
			p.args.minPeriod +
			'|' +
			p.args.maxPeriod +
			'|' +
			p.args.permutationScheme;
		// Clock-time phases move with the display timezone, so it is an input then.
		out +=
			'|' +
			p.args.phaseReference +
			(p.args.phaseReference === 'clock' ? '@' + appState.displayTimezone : '');
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
	function restore(cached) {
		cosinorData = cached;
	}
	// Every mounted instance follows the shared result: with the node expanded on
	// the canvas AND selected in the control panel there are two, and only the
	// first to run the compute effect claims the hash and computes (see
	// computeMemo.js).
	$effect(() => memo.follow(getHash, restore));

	// One guard for the deferred compute (ROB-11, src/lib/core/asyncCompute.js): the
	// spinner is cleared in a finally, a throw is shown on the node instead of spinning
	// forever over the previous result, and the memo hash is committed only on success
	// (the claim the effect below makes is released on failure, so a remount or Retry
	// tries the same inputs again).
	const runner = createComputeRunner({
		memo,
		label: 'Cosinor',
		setBusy: (v) => (calculating = v),
		setError: (msg) => (calcError = msg)
	});

	$effect(() => {
		const dataHash = getHash;
		if (!mounted) return;
		if (memo.hash !== dataHash) {
			// Claim the hash before the deferred run starts, so a second mounted instance
			// (canvas node + control panel) does not run the same compute.
			memo.hash = dataHash;
			untrack(() => getCosinor());
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
		const hash = untrack(() => getHash);
		return runner.run(
			hash,
			() => untrack(() => cosinor(p.args)),
			([data, valid]) => {
				cosinorData = data;
				p.args.valid = valid;
				p.warnings = cosinorData?.warnings ?? [];
				p.args._fitHash = hash;
			},
			(e) => {
				// No stale stats on the panel, and none flowing downstream either.
				cosinorData = undefined;
				p.args.valid = false;
				p.warnings = [`The cosinor fit failed: ${computeErrorMessage(e)}`];
				clearOutputColumns(p.args.out, { processHash: crypto.randomUUID() });
			}
		);
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

	// Scalar-metric out-keys (one value per y input). bathyphase/phase_angle and
	// perm_pvalue were added after the original period/amplitude/rsquared/pvalue
	// ports, so old sessions lack their columns; syncMetricOutColumns backfills
	// any missing ones. `pvalue` KEEPS its key across the v72.x semantics fix
	// (analytic F-test p, not the permutation p) so saved sessions wired to it
	// stay wired — only what FEEDS the column changed.
	const METRIC_KEYS = [
		'period',
		'mesor',
		'amplitude',
		'acrophase',
		'rsquared',
		'pvalue',
		'perm_pvalue',
		'bathyphase',
		'phase_angle',
		'amplitude_h1',
		'acrophase_h1',
		'bathyphase_h1'
	];

	onMount(() => {
		// Put the previous result back before anything else: the compute effect
		// skips when nothing changed, and this state died with the last instance.
		// Whether the cached result came back. The placeholder branch below must not
		// overwrite it: that placeholder carries no stats (rmse NaN, no parameters), and
		// since the memo already holds this hash the compute effect will not fire to
		// replace it — so the panel would stay stat-less until an input changed.
		const restoredFromMemo = memo.has(getHash);
		if (restoredFromMemo) restore(memo.payload);
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
		return cosinorStatsTable(cosinorData, p.args);
	}

	// Panel phases in the node's phase reference (the same conversion as the ports).
	const refPhase = (h, period) => applyPhaseReference(h, cosinorData?.phaseRef, period);
	let phaseNote = $derived(
		cosinorData?.phaseRef?.clock ? 'clock time' : `${periodUnit} after start`
	);
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
			<ControlInput label={`Period (${periodUnit})`}>
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
		<!-- The free period is searched for, and kept, inside this range. -->
		<div class="control-input-horizontal">
			<ControlInput label={`Min period (${periodUnit})`}>
				<NumberWithUnits
					bind:value={p.args.minPeriod}
					onInput={() => {
						stopFollowingX(p.args);
						getCosinor();
					}}
					{...periodInputProps(p.args.minPeriod)}
				/>
			</ControlInput>
			<ControlInput label={`Max period (${periodUnit})`}>
				<NumberWithUnits
					bind:value={p.args.maxPeriod}
					onInput={() => {
						stopFollowingX(p.args);
						getCosinor();
					}}
					{...periodInputProps(p.args.maxPeriod)}
				/>
			</ControlInput>
		</div>
	{/if}

	<div class="control-input-horizontal">
		<PhaseReferenceSelect
			bind:value={p.args.phaseReference}
			xIsTime={xIN_col?.type === 'time'}
			onchange={() => getCosinor()}
		/>
	</div>
	<div class="control-input-horizontal">
		<ControlInput label={`Reference time (${periodUnit})`}>
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
		<!-- Its own row: three controls side by side overlap their labels in a canvas node. -->
		<div class="control-input-horizontal">
			<ControlInput label="Permute">
				<select bind:value={p.args.permutationScheme} onchange={() => getCosinor()}>
					<option value="shuffle">single values</option>
					<option value="block">one-period blocks</option>
				</select>
			</ControlInput>
		</div>
		<p class="hint">
			Permuting single values assumes the observations are exchangeable (independent). Time series
			are usually autocorrelated, which makes that p-value too small; one-period blocks keep the
			autocorrelation, and the Surrogate Test node offers block and AR(1) surrogates.
		</p>
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
	{#each yResult?.fittedData?.parameters.cosines ?? [] as cosine, i (i)}
		{@const period = 2 * Math.PI * (1 / cosine.frequency)}
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>
					Period: {period.toFixed(2)}
					{periodUnit}
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
				{#if !yResult?.fixedStats}
					<p>
						Acrophase (time of peak, {phaseNote}): {refPhase(
							wrapToPeriod(-cosine.phase / cosine.frequency, period),
							period
						).toFixed(2)}
						{periodUnit}
						<StoreValueButton
							label={`Acrophase (time of peak, ${phaseNote})`}
							getter={() => {
								const c = yResult?.fittedData?.parameters?.cosines?.[i];
								if (!c?.frequency) return NaN;
								const P = (2 * Math.PI) / c.frequency;
								return refPhase(wrapToPeriod(-c.phase / c.frequency, P), P);
							}}
							defaultName={`cosinor_acrophase_${yName}${(yResult?.fittedData?.parameters?.cosines?.length ?? 0) > 1 ? '_' + (i + 1) : ''}`}
							source="Cosinor"
						/>
					</p>
				{/if}
				<p>
					Phase φ (rad): {cosine.phase.toFixed(2)}
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
				{#each s.harmonics as h (h.k)}
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
					{@const hPeriod = s.period / h.k}
					<p>
						H{h.k} Acrophase (time of peak, {phaseNote}): {refPhase(
							h.acrophase_hrs,
							hPeriod
						).toFixed(2)}
						{periodUnit} &nbsp;{#if Number.isFinite(h.CI_acrophase[0])}[CI: {refPhase(
								wrapToPeriod(h.CI_acrophase[0], hPeriod),
								hPeriod
							).toFixed(2)}, {refPhase(wrapToPeriod(h.CI_acrophase[1], hPeriod), hPeriod).toFixed(
								2
							)}]{:else}<span
								title="No acrophase CI: the amplitude is not significantly different from zero, or the interval would span a full cycle (Bingham et al. 1982)."
								>[CI: not determined]</span
							>{/if}
						<StoreValueButton
							label={`H${h.k} Acrophase (time of peak, ${phaseNote})`}
							getter={() =>
								refPhase(yResult?.fixedStats?.harmonics?.[h.k - 1]?.acrophase_hrs, hPeriod)}
							defaultName={`cosinor_acrophase_${yName}${s.harmonics.length > 1 ? '_H' + h.k : ''}`}
							source="Cosinor (fixed)"
						/>
					</p>
				{/each}
				{#if s.harmonics.length > 1}
					<!-- The waveform the amplitude / acrophase / bathyphase ports report (FIT-13). -->
					{@const m = cosinorMetrics(yResult, p.args, cosinorData?.phaseRef)}
					<p>
						Overall amplitude (half the curve's range): {m.amplitude.toFixed(3)}
						<StoreValueButton
							label="Overall amplitude"
							getter={() => cosinorMetrics(yResult, p.args, cosinorData?.phaseRef).amplitude}
							defaultName={`cosinor_overall_amplitude_${yName}`}
							source="Cosinor (fixed)"
						/>
					</p>
					<p>
						Orthophase (time of overall peak, {phaseNote}): {m.acrophase.toFixed(2)}
						{periodUnit}
						<StoreValueButton
							label={`Orthophase (time of overall peak, ${phaseNote})`}
							getter={() => cosinorMetrics(yResult, p.args, cosinorData?.phaseRef).acrophase}
							defaultName={`cosinor_orthophase_${yName}`}
							source="Cosinor (fixed)"
						/>
					</p>
					<p>
						Bathyphase (time of overall trough, {phaseNote}): {m.bathyphase.toFixed(2)}
						{periodUnit}
						<StoreValueButton
							label={`Bathyphase (time of overall trough, ${phaseNote})`}
							getter={() => cosinorMetrics(yResult, p.args, cosinorData?.phaseRef).bathyphase}
							defaultName={`cosinor_bathyphase_${yName}`}
							source="Cosinor (fixed)"
						/>
					</p>
				{/if}
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
			{:else if calcError}
				<ErrorBox
					title="The cosinor fit failed."
					message={calcError}
					onretry={() => getCosinor()}
				/>
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
	.hint {
		font-size: var(--font-sm);
		color: var(--color-text-muted);
		margin: var(--space-1) 0 0;
	}
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
