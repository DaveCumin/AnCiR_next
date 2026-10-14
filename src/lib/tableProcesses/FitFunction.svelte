<script module>
	// @ts-nocheck
	import { core, appConsts } from '$lib/core/core.svelte';
	import { nodeMemo } from '$lib/core/computeMemo.js';
	import {
		fitCurveModel,
		evaluateCurveModelAtPoints,
		fitPermutationPValue,
		PERMUTATION_DEFAULTS
	} from '$lib/utils/fitFunction.js';
	import { wrapToPeriod, multiComponentWaveform } from '$lib/utils/cosinorAddons.js';
	import { freePeriodFitWarnings, FREE_PERIOD_DEFAULTS } from '$lib/utils/cosinor.js';
	import { rectWaveFitWarnings } from '$lib/utils/rectwave.js';
	import { doubleLogisticFitWarnings } from '$lib/utils/doublelogistic.js';
	import { periodRangeWarnings } from '$lib/utils/periodRangeWarnings.js';
	import { periodUnitForColumn, periodInputProps } from '$lib/utils/periodUnits.js';
	import { newPeriodRangeArgs } from '$lib/tableProcesses/periodRangeAuto.svelte.js';
	import { permutationValidityWarnings } from '$lib/tableProcesses/permutationSupport.js';
	import { runComputeTask } from '$lib/workers/workerPool.js';
	import { shouldUseWorkers } from '$lib/workers/workerGate.js';
	import '$lib/utils/fitFunction.worker-task.js';
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
	import {
		residualColumn as computeResidual,
		spawnResidualPlot
	} from '$lib/tableProcesses/residualSupport.js';
	import { isInvalidValue } from '$lib/utils/stats.js';
	import {
		fitTimeFrame,
		applyPhaseReference,
		PHASE_REFERENCE_START
	} from '$lib/utils/phaseReference.js';
	import { resolveNodePhaseReference } from '$lib/tableProcesses/phaseReferenceSupport.js';
	import { checkFitResultsFinite } from '$lib/utils/fitDomain.js';

	const displayName = 'Fit waveform model';
	const defaults = new Map([
		['xIN', { val: -1 }],
		['yIN', { val: [] }],
		['model', { val: 'cosinor' }],
		['outputX', { val: -1 }],
		// `fitx` + per-y `fity_<id>` are the fitted-curve outputs. `r2`/`rmse`/
		// `perm_pvalue` plus the per-model parameter keys are scalar metrics
		// exposed as PORTS (one value per y input, in yIN order) — see
		// metricOutputs.js. The keys seeded here match the default model
		// ('cosinor'); the component reconciles them when the model changes,
		// the TrendFit coef_* pattern.
		[
			'out',
			{
				fitx: { val: -1 },
				r2: { val: -1 },
				rmse: { val: -1 },
				// The permutation test's empirical p — the ONLY p this node emits as a
				// port (the cosinor fixed-period fit also computes an analytic F-test p,
				// but that exists in one of five model modes only; the dedicated Cosinor
				// node owns the analytic `pvalue` port). Named like RectangularWave /
				// DoubleLogistic so the same column name means the same test everywhere.
				perm_pvalue: { val: -1 },
				period: { val: -1 },
				mesor: { val: -1 },
				amplitude: { val: -1 },
				acrophase: { val: -1 },
				// Harmonic 1 of a multi-harmonic fixed cosinor (the two keys above then
				// describe the overall waveform; review FIT-13). Same numbers otherwise.
				amplitude_h1: { val: -1 },
				acrophase_h1: { val: -1 }
			}
		],
		// What hour 0 means for the phase outputs (acrophase, onset, offset):
		// 'start' = hours after the first sample (x = 0 for a numeric x; the default,
		// and what saved sessions report), 'clock' = hours after local midnight in the
		// display timezone, wrapped to one period. Review FIT-9; utils/phaseReference.js.
		['phaseReference', { val: PHASE_REFERENCE_START }],
		['valid', { val: false }],
		['forcollected', { val: true }],
		['collectedType', { val: 'fit' }],
		['preProcesses', { val: [] }],
		['tableProcesses', { val: [] }],
		['useFixedPeriod', { val: true }],
		['fixedPeriod', { val: 24 }],
		['Ncurves', { val: 1 }],
		// Free-period fits (cosinor, rectangular wave, periodic double logistic): the period
		// range the fit may use, in x units (hours for a time x; see FREE_PERIOD_DEFAULTS in
		// cosinor.js). Old sessions get these defaults; a NEW node's range follows its x
		// (newNodeArgs below). Unbounded, the waveform models followed trends to thousands of
		// hours (review FIT-1).
		['minPeriod', { val: FREE_PERIOD_DEFAULTS.minPeriod }],
		['maxPeriod', { val: FREE_PERIOD_DEFAULTS.maxPeriod }],
		['nHarmonics', { val: 1 }],
		['alpha', { val: 0.05 }],
		['fixKappa', { val: false }],
		['fixedKappa', { val: 5 }],
		['fixOmega', { val: false }],
		['fixDutyCycle', { val: false }],
		['fixedDutyCycle', { val: 0.5 }],
		['periodic', { val: true }],
		['fixK1', { val: false }],
		['fixedK1', { val: 0.5 }],
		['fixK2', { val: false }],
		['fixedK2', { val: 0.5 }],
		['permuteTest', { val: false }],
		['autoPermutations', { val: false }],
		['nPermutations', { val: 999 }],
		['permutationSeed', { val: 12345 }],
		['permutationStatistic', { val: 'rSquared' }],
		// 'shuffle' (single values; assumes exchangeable observations) or 'block' (one-period
		// circular blocks, which keep short-range autocorrelation). Review finding FIT-5.
		['permutationScheme', { val: PERMUTATION_DEFAULTS.permutationScheme }]
	]);

	export const definition = {
		displayName,
		defaults,
		// Only a new node's period range follows its x (periodRangeAuto.svelte.js).
		newNodeArgs: newPeriodRangeArgs,
		func: fitFunction,
		columnIdFields: { scalar: ['xIN'], array: ['yIN'] },
		xOutKey: 'fitx',
		yOutKeyPrefix: 'fity_',
		nodeSpec: {
			id: 'tableprocess.fitfunction',
			inputs: [
				{ name: 'xIN', kind: 'column', cardinality: 'one' },
				{ name: 'yIN', kind: 'column', cardinality: 'many' }
			],
			outputs: [
				{ name: 'fitx', kind: 'column', cardinality: 'one' },
				{ name: 'fity_*', kind: 'column', cardinality: 'many', dynamicPrefix: 'fity_' },
				{ name: 'resid_*', kind: 'column', cardinality: 'many', dynamicPrefix: 'resid_' },
				{ name: 'permstats_*', kind: 'column', cardinality: 'many', dynamicPrefix: 'permstats_' },
				// Scalar-metric ports (one value per y input, in yIN order). The
				// union across models; only the current model's set exists at any
				// time (getFitMetricKeys), reconciled like TrendFit's coef_* keys.
				{ name: 'r2', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'rmse', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'perm_pvalue', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'period', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'mesor', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'amplitude', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'acrophase', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'amplitude_h1', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'acrophase_h1', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'duty_cycle', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'kappa', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'onset', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'offset', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'k1', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'k2', kind: 'column', cardinality: 'one', metric: true }
			]
		}
	};

	function getModelOptions(argsIN) {
		if (argsIN.model === 'cosinor') {
			return {
				useFixedPeriod: argsIN.useFixedPeriod ?? true,
				fixedPeriod: argsIN.fixedPeriod ?? 24,
				nHarmonics: argsIN.nHarmonics ?? 1,
				Ncurves: argsIN.Ncurves ?? 1,
				alpha: argsIN.alpha ?? 0.05,
				minPeriod: argsIN.minPeriod ?? FREE_PERIOD_DEFAULTS.minPeriod,
				maxPeriod: argsIN.maxPeriod ?? FREE_PERIOD_DEFAULTS.maxPeriod
			};
		}
		if (argsIN.model === 'rectangular') {
			return {
				fixKappa: argsIN.fixKappa ?? false,
				fixedKappa: argsIN.fixedKappa ?? 5,
				fixOmega: argsIN.fixOmega ?? false,
				fixedPeriod: argsIN.fixedPeriod ?? 24,
				fixDutyCycle: argsIN.fixDutyCycle ?? false,
				fixedDutyCycle: argsIN.fixedDutyCycle ?? 0.5,
				minPeriod: argsIN.minPeriod ?? FREE_PERIOD_DEFAULTS.minPeriod,
				maxPeriod: argsIN.maxPeriod ?? FREE_PERIOD_DEFAULTS.maxPeriod
			};
		}
		if (argsIN.model === 'doublelogistic') {
			return {
				periodic: argsIN.periodic ?? true,
				fixK1: argsIN.fixK1 ?? false,
				fixedK1: argsIN.fixedK1 ?? 0.5,
				fixK2: argsIN.fixK2 ?? false,
				fixedK2: argsIN.fixedK2 ?? 0.5,
				fixPeriod: argsIN.fixPeriod ?? false,
				fixedPeriod: argsIN.fixedPeriod ?? 24,
				minPeriod: argsIN.minPeriod ?? FREE_PERIOD_DEFAULTS.minPeriod,
				maxPeriod: argsIN.maxPeriod ?? FREE_PERIOD_DEFAULTS.maxPeriod
			};
		}
		return {};
	}

	/**
	 * Every metric out-key this node can own, across all three models. The
	 * per-model set is getFitMetricKeys; this union drives the reconcile
	 * predicate so a model switch DELETES keys that no longer mean anything
	 * (metricOutputs.js: silently rebinding a consumer to a different quantity
	 * would be worse than orphaning it).
	 */
	export const FIT_METRIC_KEYS_ALL = [
		'r2',
		'rmse',
		'perm_pvalue',
		'period',
		'mesor',
		'amplitude',
		'acrophase',
		'amplitude_h1',
		'acrophase_h1',
		'duty_cycle',
		'kappa',
		'onset',
		'offset',
		'k1',
		'k2'
	];

	/**
	 * The metric out-keys for the current model: the shared fit-quality core
	 * (r2/rmse/perm_pvalue) plus the model's own parameters. Key names follow
	 * the dedicated fit nodes where the quantity is identical (r2/rmse/
	 * perm_pvalue as on RectangularWave/DoubleLogistic; period/mesor/amplitude/
	 * acrophase as on Cosinor) so a downstream consumer finds the same shape
	 * either way.
	 */
	export function getFitMetricKeys(args) {
		const shared = ['r2', 'rmse', 'perm_pvalue'];
		const model = args?.model ?? 'cosinor';
		if (model === 'cosinor')
			return [
				...shared,
				'period',
				'mesor',
				'amplitude',
				'acrophase',
				'amplitude_h1',
				'acrophase_h1'
			];
		if (model === 'rectangular')
			return [...shared, 'period', 'mesor', 'amplitude', 'acrophase', 'duty_cycle', 'kappa'];
		if (model === 'doublelogistic')
			return [
				...shared,
				'period',
				'mesor',
				'amplitude',
				'onset',
				'offset',
				'k1',
				'k2',
				'duty_cycle'
			];
		return shared;
	}

	/**
	 * One metric value for `key` off a fit result. Mirrors the expressions the
	 * panel prints (and Cosinor's port conventions for the cosinor model:
	 * acrophase is the PEAK time wrapped into [0, period)). `perm_pvalue` is
	 * strictly the permutation test's empirical p — gated on the null
	 * distribution actually existing, so the cosinor fixed-period fit's analytic
	 * pF (which also lands on fitResult.pValue) can never leak onto this port.
	 *
	 * Phase keys (acrophase, acrophase_h1, onset, offset) are expressed in
	 * `phaseRef` (utils/phaseReference.js): untouched in the default "since first
	 * sample", clock time of day otherwise, wrapped to the model's period (24 h for a
	 * non-periodic double logistic, whose onset and offset are single instants).
	 *
	 * Multi-harmonic fixed cosinor: `amplitude` / `acrophase` describe the overall
	 * fitted waveform (half its range, time of its maximum), as on the Cosinor node
	 * (review FIT-13); `amplitude_h1` / `acrophase_h1` keep harmonic 1. With one
	 * harmonic the two pairs are the same numbers.
	 */
	export function fitMetricValue(key, model, fr, phaseRef) {
		const v = rawFitMetricValue(key, model, fr);
		if (!phaseRef?.clock || !PHASE_KEYS.has(key)) return v;
		return applyPhaseReference(v, phaseRef, fitPhasePeriod(model, fr));
	}

	const PHASE_KEYS = new Set(['acrophase', 'acrophase_h1', 'onset', 'offset']);

	/** The period a model's phase outputs wrap to (h). */
	function fitPhasePeriod(model, fr) {
		if (model === 'cosinor') return rawFitMetricValue('period', model, fr);
		if (model === 'rectangular') return fr?.period ?? NaN;
		if (model === 'doublelogistic') return fr?.parameters?.T ?? 24;
		return NaN;
	}

	function rawFitMetricValue(key, model, fr) {
		if (!fr) return NaN;
		if (key === 'r2') return fr.rSquared ?? NaN;
		if (key === 'rmse') return fr.rmse ?? NaN;
		if (key === 'perm_pvalue') {
			const ran = Array.isArray(fr.permutedStats) && fr.permutedStats.length > 0;
			return ran && Number.isFinite(fr.pValue) ? fr.pValue : NaN;
		}
		if (model === 'cosinor') {
			if (fr.mode === 'fixed') {
				const period = fr.parameters?.period ?? NaN;
				if (key === 'period') return period;
				if (key === 'mesor') return fr.fixedStats?.M ?? fr.parameters?.M ?? NaN;
				const hs = fr.fixedStats?.harmonics ?? [];
				if (hs.length > 1 && (key === 'amplitude' || key === 'acrophase')) {
					const w = multiComponentWaveform(fr.fixedStats?.M, hs, period);
					return key === 'amplitude' ? w.amplitude : w.orthophase;
				}
				if (key === 'amplitude' || key === 'amplitude_h1') return hs[0]?.amplitude ?? NaN;
				// fitCosinorFixed reports acrophase_hrs as the time of peak already,
				// the convention Cosinor's port and every panel use.
				if (key === 'acrophase' || key === 'acrophase_h1') return hs[0]?.acrophase_hrs ?? NaN;
			} else {
				const c = fr.parameters?.cosines?.[0];
				const period = c?.frequency ? (2 * Math.PI) / c.frequency : NaN;
				if (key === 'period') return period;
				if (key === 'mesor') return fr.parameters?.O ?? NaN;
				if (key === 'amplitude' || key === 'amplitude_h1') return c?.amplitude ?? NaN;
				if (key === 'acrophase' || key === 'acrophase_h1')
					// A·cos(ωt + φ) peaks at t = −φ/ω, wrapped into [0, period).
					return c?.frequency ? wrapToPeriod(-c.phase / c.frequency, period) : NaN;
			}
			return NaN;
		}
		if (model === 'rectangular') {
			if (key === 'period') return fr.period ?? NaN;
			if (key === 'acrophase') return fr.acrophase ?? NaN;
			if (key === 'mesor') return fr.parameters?.M ?? NaN;
			if (key === 'amplitude') return fr.parameters?.A ?? NaN;
			if (key === 'duty_cycle') return fr.parameters?.dutyCycle ?? NaN;
			if (key === 'kappa') return fr.parameters?.kappa ?? NaN;
			return NaN;
		}
		if (model === 'doublelogistic') {
			if (key === 'period') return fr.parameters?.T ?? NaN;
			if (key === 'mesor') return fr.parameters?.M ?? NaN;
			if (key === 'amplitude') return fr.parameters?.A ?? NaN;
			if (key === 'onset') return fr.onsetPhase ?? fr.parameters?.t1 ?? NaN;
			if (key === 'offset') return fr.offsetPhase ?? fr.parameters?.t2 ?? NaN;
			if (key === 'k1') return fr.parameters?.k1 ?? NaN;
			if (key === 'k2') return fr.parameters?.k2 ?? NaN;
			if (key === 'duty_cycle') return fr.dutyCycle ?? NaN;
			return NaN;
		}
		return NaN;
	}

	/**
	 * Scalar-metric ports: one value per y input, in yIN order. Reuses the exact
	 * expressions behind the panel readout so the wired values match what users
	 * previously stored by hand with StoreValueButton. Shared by the module func
	 * and the component's getFit, like TrendFit's writeTrendMetricOutputs.
	 */
	export function writeFitMetricOutputs(argsIN, result, processHash) {
		const yINs = normalizeYInputs(argsIN.yIN);
		const model = argsIN.model ?? 'cosinor';
		for (const key of getFitMetricKeys(argsIN)) {
			writeOutputColumn(
				argsIN.out?.[key],
				yINs.map((yId) =>
					fitMetricValue(key, model, result.y_results?.[yId]?.fitResult, result.phaseRef)
				),
				{ processHash }
			);
		}
	}

	function getXDataForColumn(col) {
		return col.type === 'time' ? col.hoursSinceStart : col.getData();
	}

	function getValidPairs(t, y) {
		const validIndices = t
			.map((v, i) => (isInvalidValue(v) || isInvalidValue(y[i]) ? -1 : i))
			.filter((i) => i !== -1);
		return {
			tt: validIndices.map((i) => t[i]),
			yy: validIndices.map((i) => y[i])
		};
	}

	async function computeSingleFit(tt, yy, argsIN) {
		const model = argsIN.model ?? 'cosinor';
		const options = getModelOptions(argsIN);
		return shouldUseWorkers({ inputLen: tt.length })
			? await runComputeTask('fitfunction.fit', { tt, yy, model, options })
			: fitCurveModel(tt, yy, model, options);
	}

	function evaluateForOutput(fitResult, argsIN, outputXData) {
		if (!outputXData) return null;
		return evaluateCurveModelAtPoints(fitResult, argsIN.model ?? 'cosinor', outputXData);
	}

	async function buildYResult(tt, yy, argsIN, outputXData) {
		const fitResult = await computeSingleFit(tt, yy, argsIN);
		if (!fitResult) return null;
		const predicted = evaluateForOutput(fitResult, argsIN, outputXData);
		return {
			fitResult,
			predicted,
			t: tt,
			yy,
			xOutData: outputXData ?? tt,
			yOutData: predicted ?? fitResult.fitted
		};
	}

	/**
	 * Residuals (observed − fitted) aligned to the FULL input length, so they pair 1:1 with the
	 * input x column (NaN wherever the input pair was invalid). Evaluating the model at every input
	 * x — rather than reusing fitResult.fitted, which covers only the valid points — is what keeps
	 * the residual column the same length as xIN, so the residual quick-plot lines up.
	 */
	function residualColumn(yResult, model, tFull, yFull) {
		if (!yResult?.fitResult || !Array.isArray(tFull)) return null;
		const predicted = evaluateCurveModelAtPoints(yResult.fitResult, model ?? 'cosinor', tFull);
		return computeResidual(predicted, yFull, tFull);
	}

	async function buildFitResult(argsIN) {
		const xIN = argsIN.xIN;
		const yINs = normalizeYInputs(argsIN.yIN);
		const outputXId = argsIN.outputX;
		const xOUT = argsIN.out?.fitx;

		let result = {
			t: [],
			outputXData: null,
			y_results: {},
			originTime_ms: null
		};
		let anyValid = false;

		if (xIN == -1 || !getColumnById(xIN) || yINs.length === 0) return [result, false];

		const tCol = getColumnById(xIN);
		const t = getXDataForColumn(tCol);

		// Output grid in the fit's hour frame + the origin (minimum valid input time)
		// that turns hours back into timestamps (review STAT-19; utils/phaseReference.js).
		const { outputXData, originTime_ms } = fitTimeFrame(
			tCol,
			outputXId != -1 ? getColumnById(outputXId) : null
		);
		result.outputXData = outputXData;
		result.originTime_ms = originTime_ms;
		// The frame the phase outputs are reported in (FIT-9).
		result.phaseRef = resolveNodePhaseReference(argsIN, tCol);

		for (const yId of yINs) {
			if (yId == null || yId === -1) continue;
			const yCol = getColumnById(yId);
			if (!yCol) continue;

			const y = yCol.getData();
			const { tt, yy } = getValidPairs(t, y);
			if (tt.length === 0) continue;

			const yResult = await buildYResult(tt, yy, argsIN, outputXData);
			if (!yResult) continue;

			// Permutation test on the HEADLESS path too (MCP engine, doProcess),
			// so the perm_pvalue port and permstats_* hold real values without the
			// component ever mounting. The component's getFit runs its own async,
			// progress-reporting version instead of this one.
			if (argsIN.permuteTest && yResult.fitResult) {
				attachFitPermutation(
					yResult,
					fitPermutationPValue(tt, yy, argsIN.model ?? 'cosinor', getModelOptions(argsIN), argsIN)
				);
			}

			result.y_results[yId] = yResult;
			if (result.t.length === 0) result.t = tt;
			if (yResult.fitResult?.fitted?.length > 0) anyValid = true;
		}

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

		if (anyValid && xOUT !== -1) {
			const processHash = crypto.randomUUID();
			const firstYId = Object.keys(result.y_results)[0];
			const firstYResult = result.y_results[firstYId];
			const xOutData = firstYResult.xOutData ?? outputXData ?? firstYResult.t;
			writeXOutput(xOUT, xOutData, { originTime_ms, processHash });

			for (const yId of yINs) {
				const yOUT = argsIN.out?.['fity_' + yId];
				const yResult = result.y_results[yId];
				if (yOUT != null && yOUT !== -1 && yResult) {
					writeOutputColumn(yOUT, yResult.yOutData, { processHash });
				}

				const residOUT = argsIN.out?.['resid_' + yId];
				if (residOUT != null && residOUT !== -1 && yResult) {
					const yCol = getColumnById(yId);
					const resid = residualColumn(
						yResult,
						argsIN.model ?? 'cosinor',
						t,
						yCol?.getData() ?? []
					);
					if (resid) writeOutputColumn(residOUT, resid, { processHash });
				}

				writeOutputColumn(
					argsIN.out?.['permstats_' + yId],
					Array.isArray(yResult?.fitResult?.permutedStats) ? yResult.fitResult.permutedStats : [],
					{ processHash }
				);
			}

			writeFitMetricOutputs(argsIN, result, processHash);
		}

		// Not gated on anyValid: when a fit fails, the point count is the explanation.
		// A fit that RAN but produced NaN gets its own line: these are iterative
		// optimisers with no convergence flag to read, so non-finite R²/RMSE is the
		// only observable symptom, and dashes with no explanation is what the user
		// otherwise sees.
		result.warnings = fitWarnings(argsIN, result);
		return [result, anyValid];
	}

	/**
	 * Copy a fitPermutationPValue(Async) outcome onto a y result's fitResult, where the panel,
	 * the stats table and the perm_pvalue / permstats_* ports read it. Shared by the headless
	 * path and the panel so both carry the scheme (review FIT-5).
	 */
	export function attachFitPermutation(yResult, perm) {
		const fr = yResult?.fitResult;
		if (!fr || !perm) return yResult;
		fr.pValue = perm.pValue;
		fr.significant = perm.significant;
		fr.permutedStats = perm.permutedStats;
		fr.permScheme = perm.scheme ?? 'shuffle';
		fr.permBlockLength = perm.blockLength ?? null;
		yResult.perm = perm;
		return yResult;
	}

	/** Whether the current model's period is estimated (so the period range applies). */
	function isFreePeriod(argsIN) {
		const model = argsIN.model ?? 'cosinor';
		if (model === 'cosinor') return !argsIN.useFixedPeriod;
		if (model === 'rectangular') return !argsIN.fixOmega;
		if (model === 'doublelogistic') return (argsIN.periodic ?? true) && !argsIN.fixPeriod;
		return false;
	}

	// Shared by the headless path above and the component's getFit, so the panel
	// shows the same warnings the engine computes (getFit used to publish none).
	export function fitWarnings(argsIN, result) {
		const model = argsIN.model ?? 'cosinor';
		const fitEntries = Object.entries(result?.y_results ?? {}).map(([yId, yr]) => ({
			label: `"${getColumnById(Number(yId))?.name ?? yId}"`,
			result: yr?.fitResult ?? null,
			t: yr?.t
		}));
		// The free-period fits report an empty or unresolvable range, and when the period
		// finished on a bound of the range or the optimiser gave up (each model carries its
		// diagnostics through fitCurveModel). Review FIT-1.
		let freeWarnings = [];
		if (isFreePeriod(argsIN)) {
			const xCol = argsIN.xIN != null && argsIN.xIN !== -1 ? getColumnById(argsIN.xIN) : null;
			const t = xCol ? (xCol.type === 'time' ? xCol.hoursSinceStart : xCol.getData()) : null;
			// Periods are in x's units: hours for a time x, else the column's own.
			const opts = { unit: periodUnitForColumn(xCol) };
			const fitDiag =
				model === 'rectangular'
					? rectWaveFitWarnings(fitEntries, 'The free-period rectangular-wave fit', opts)
					: model === 'doublelogistic'
						? doubleLogisticFitWarnings(fitEntries, 'The free-period double-logistic fit', opts)
						: freePeriodFitWarnings(fitEntries, 'The free-period cosinor fit', opts);
			freeWarnings = [
				...periodRangeWarnings(t, argsIN.minPeriod, argsIN.maxPeriod, opts),
				...fitDiag
			];
		}
		// Test validity (review FIT-5): the shuffle permutation test and the fixed-period
		// cosinor F-test (reported in the stats table) assume independent observations.
		const validity = [];
		for (const [yId, yr] of Object.entries(result?.y_results ?? {})) {
			const fitted = yr?.fitResult?.fitted;
			const yy = yr?.yy;
			if (!Array.isArray(yy) || !Array.isArray(fitted) || fitted.length !== yy.length) continue;
			validity.push(
				...permutationValidityWarnings(
					yr.perm ?? null,
					yy.map((v, i) => v - fitted[i]),
					`"${getColumnById(Number(yId))?.name ?? yId}"`,
					{ fTest: model === 'cosinor' && !!argsIN.useFixedPeriod }
				)
			);
		}
		return [
			...checkFitResultsFinite(fitEntries, `The ${model} fit`),
			...freeWarnings,
			...validity,
			...(result?.phaseRef?.warning ? [result.phaseRef.warning] : []),
			...fitSampleWarnings(argsIN)
		];
	}

	// Self-contained sample-size check for this node. A fit needs meaningfully
	// more usable points than it has free parameters before its R² and p-value
	// mean anything; at n = nParams the model interpolates exactly and R² = 1.
	function fitSampleWarnings(argsIN) {
		const warnings = [];
		const xId = argsIN.xIN;
		const xCol = xId != null && xId !== -1 ? getColumnById(xId) : null;
		const yIds = Array.isArray(argsIN.yIN) ? argsIN.yIN : [argsIN.yIN];
		const yCol = yIds?.[0] != null && yIds[0] !== -1 ? getColumnById(yIds[0]) : null;
		if (!xCol || !yCol) return warnings;
		const xs = (xCol.type === 'time' ? xCol.hoursSinceStart : xCol.getData()) ?? [];
		const ys = yCol.getData() ?? [];
		let nUsable = 0;
		for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
			const a = Number(xs[i]);
			const b = Number(ys[i]);
			if (xs[i] != null && ys[i] != null && Number.isFinite(a) && Number.isFinite(b)) nUsable++;
		}
		const model = argsIN.model ?? 'cosinor';
		const nParams = model === 'doublelogistic' ? 6 : model === 'rectangular' ? 5 : 3;
		if (!Number.isFinite(nUsable) || nUsable <= 0) return warnings;
		if (nUsable <= nParams) {
			warnings.push(
				`Only ${nUsable} usable points for a fit model with ${nParams} free parameters, so the fit is interpolating, not estimating. R² here is meaningless.`
			);
		} else if (nUsable < nParams * 3) {
			warnings.push(
				`Small sample: ${nUsable} usable points for ${nParams} free parameters. A nonlinear fit with barely more points than parameters will follow the noise; R² is inflated and the p-value is not trustworthy.`
			);
		}
		return warnings;
	}

	export async function fitFunction(argsIN) {
		return await buildFitResult(argsIN);
	}
</script>

<script>
	// @ts-nocheck
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';
	import StoreValueButton from '$lib/components/inputs/StoreValueButton.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';

	import { Column, getColumnById } from '$lib/core/Column.svelte';
	import { pushObj } from '$lib/core/core.svelte.js';
	import { syncMetricOutColumns } from '$lib/tableProcesses/metricOutputs.js';
	import PhaseReferenceSelect from '$lib/components/inputs/PhaseReferenceSelect.svelte';
	import { appState } from '$lib/core/core.svelte';
	import { useMultiYTP } from '$lib/tableProcesses/useMultiYTP.svelte.js';
	import {
		usePeriodRangeAuto,
		stopFollowingX
	} from '$lib/tableProcesses/periodRangeAuto.svelte.js';
	import { onMount, untrack } from 'svelte';
	import {
		showNodeResultTable,
		saveStaticDataAsCSV
	} from '$lib/components/plotbits/helpers/save.svelte.js';
	import { useNodeResultTables } from '$lib/core/nodeResultTables.svelte.js';
	import { fitPermutationPValueAsync } from '$lib/utils/fitFunction.js';
	import { createComputeRunner, computeErrorMessage } from '$lib/core/asyncCompute.js';
	import { permutationSchemeLabel } from '$lib/tableProcesses/permutationSupport.js';

	let { p = $bindable(), hideInputs = false } = $props();

	// Backwards compatibility: legacy scalar yIN → array, ensure the out map
	// exists, and initialise fields absent in sessions saved before they existed.
	migrateLegacyYIN(p.args);
	if (typeof p.args.out !== 'object' || p.args.out === null) {
		p.args.out = { fitx: -1 };
	}
	fillDefaults(p.args, defaults);

	let fitData = $state();
	let showOutputX = $state(p.args.outputX !== -1);
	let mounted = $state(false);
	let previewStart = $state(1);
	let calculating = $state(false);
	let permutationProgress = $state(0);
	let permutationLabel = $state('');
	// The message of a compute that threw (ROB-11), shown on the node with a Retry.
	let calcError = $state(null);
	// Lets a superseded run stop early between series (the runner already drops its result).
	let _calcToken = 0;

	const { syncYColumns, initYColumns } = useMultiYTP(p, 'fity_', 'fit_');
	const { syncYColumns: syncPermColumns, initYColumns: initPermColumns } = useMultiYTP(
		p,
		'permstats_',
		'permstats_'
	);
	const { syncYColumns: syncResidColumns, initYColumns: initResidColumns } = useMultiYTP(
		p,
		'resid_',
		'resid_'
	);

	let xIN_col = $derived.by(() => (p.args.xIN >= 0 ? getColumnById(p.args.xIN) : null));
	// The unit of every period and phase on this panel: h for a time x, else "x units".
	let periodUnit = $derived(periodUnitForColumn(xIN_col));
	// A new node's period range follows its x until the user edits it.
	usePeriodRangeAuto(p, () => xIN_col);
	let outputX_col = $derived.by(() => (p.args.outputX >= 0 ? getColumnById(p.args.outputX) : null));
	let getHash = $derived.by(() => {
		let out = '';
		out += xIN_col?.getDataHash ?? '';
		for (const yId of p.args.yIN ?? []) {
			const col = yId >= 0 ? getColumnById(yId) : null;
			out += col?.getDataHash ?? '';
		}
		out += outputX_col?.getDataHash ?? '';
		out += p.args.model;
		out += p.args.useFixedPeriod;
		out += p.args.fixedPeriod;
		out += p.args.Ncurves;
		out += '|' + p.args.minPeriod + '|' + p.args.maxPeriod;
		out += p.args.nHarmonics;
		out += p.args.fixKappa;
		out += p.args.fixOmega;
		out += p.args.fixDutyCycle;
		out += p.args.periodic;
		out += p.args.fixK1;
		out += p.args.fixK2;
		out += p.args.permuteTest;
		out += p.args.autoPermutations;
		out += p.args.nPermutations;
		out += p.args.permutationSeed;
		out += p.args.permutationStatistic;
		out += '|' + p.args.permutationScheme;
		// These change the result but were missing from this hash. While the memo
		// was component-local a view switch recomputed anyway and hid it; now that
		// the memo survives a remount, an omission here means an edit is ignored.
		out +=
			'|' +
			p.args.alpha +
			'|' +
			p.args.fixedDutyCycle +
			'|' +
			p.args.fixedK1 +
			'|' +
			p.args.fixedK2 +
			'|' +
			p.args.fixedKappa;
		// Clock-time phases move with the display timezone, so it is an input then.
		out +=
			'|' +
			p.args.phaseReference +
			(p.args.phaseReference === 'clock' ? '@' + appState.displayTimezone : '');
		return out;
	});
	// The fit stats live only in transient state and aren't persisted with the
	// session, which used to force a recompute on every mount — skipping the fit
	// left the stats panel blank. The memo carries the stats alongside the hash, so
	// the mount above restores them and the fit can be skipped. Mirrors
	// RectangularWave / NonparametricRA.
	// Backed by the session-lifetime compute memo, so a view switch (which destroys
	// and rebuilds this component) does not recompute unchanged inputs.
	const memo = nodeMemo(p, 'tableprocess');

	// The metric keys this node owns: the shared core plus the current model's
	// parameters (getFitMetricKeys). The predicate spans the UNION across models
	// so a model switch deletes the keys that no longer apply.
	function syncFitMetricColumns() {
		return syncMetricOutColumns(p, getFitMetricKeys(p.args), (k) =>
			FIT_METRIC_KEYS_ALL.includes(k)
		);
	}

	function onYSelectionChange() {
		const fitColsChanged = syncYColumns();
		const permColsChanged = syncPermColumns();
		const residColsChanged = syncResidColumns();
		if (fitColsChanged || permColsChanged || residColsChanged) getFit();
	}

	// Residual diagnostic: spawn a scatterplot of the input x against the residual column for this Y.
	function plotResiduals(yId, yName) {
		spawnResidualPlot(p, { xId: p.args.xIN, residId: p.args.out?.['resid_' + yId], label: yName });
	}

	function getXData(col) {
		return col.type === 'time' ? col.hoursSinceStart : col.getData();
	}

	// getValidPairs is the module-script helper above (shared with the headless path).

	// One guard for the deferred compute (ROB-11, src/lib/core/asyncCompute.js): the spinner
	// is cleared in a finally, a throw is shown on the node instead of spinning forever over
	// the previous result, and the memo hash is committed only on success (the effect's claim
	// is released on failure, so a remount or Retry tries the same inputs again).
	const runner = createComputeRunner({
		memo,
		label: 'Fit waveform model',
		setBusy: (v) => (calculating = v),
		setError: (msg) => (calcError = msg)
	});

	function getFit() {
		previewStart = 1;
		permutationProgress = 0;
		permutationLabel = '';
		const hash = untrack(() => getHash);
		const my = ++_calcToken;
		return runner.run(
			hash,
			() => untrack(() => computeFit(my)),
			(out) => {
				if (out) applyFit(out);
				p.args._fitHash = hash;
			},
			(e) => {
				// No stale stats on the panel, and none flowing downstream either.
				fitData = undefined;
				p.args.valid = false;
				p.warnings = [`The ${p.args.model ?? 'cosinor'} fit failed: ${computeErrorMessage(e)}`];
				clearOutputColumns(p.args.out, { processHash: crypto.randomUUID() });
			}
		);
	}

	/**
	 * The fits and permutation tests for the current inputs, or null when there is nothing
	 * to fit or a newer run superseded this one (`my` is that run's token).
	 */
	async function computeFit(my) {
		const xIN = p.args.xIN;
		const yINs = normalizeYInputs(p.args.yIN);
		const xCol = xIN >= 0 ? getColumnById(xIN) : null;
		if (!xCol || yINs.length === 0) return null;

		const t = getXData(xCol);
		const outputXId = p.args.outputX;
		// Same frame and origin as the headless path above (STAT-19).
		const { outputXData, originTime_ms } = fitTimeFrame(
			xCol,
			outputXId != -1 ? getColumnById(outputXId) : null
		);

		const result = {
			t: [],
			outputXData,
			originTime_ms,
			phaseRef: resolveNodePhaseReference(p.args, xCol),
			y_results: {}
		};

		const activeY = [];
		for (const yId of yINs) {
			const yCol = getColumnById(yId);
			if (!yCol) continue;
			const y = yCol.getData();
			const { tt, yy } = getValidPairs(t, y);
			if (tt.length === 0) continue;
			activeY.push({ yId, tt, yy });
		}
		if (activeY.length === 0) return null;

		const model = p.args.model ?? 'cosinor';
		let anyValid = false;
		for (let index = 0; index < activeY.length; index++) {
			const { yId, tt, yy } = activeY[index];
			if (my !== _calcToken) return null;

			const yResult = await buildYResult(tt, yy, p.args, outputXData);
			if (!yResult) continue;

			if (p.args.permuteTest) {
				// The same preparation, scheme, count and seed as the headless path
				// (fitPermutationPValue), so the panel and the engine report the same p.
				const perm = await fitPermutationPValueAsync(
					tt,
					yy,
					model,
					getModelOptions(p.args),
					p.args,
					{
						onProgress: (current, total) => {
							if (my !== _calcToken) return;
							const progress = (index + current / total) / activeY.length;
							permutationProgress = Math.max(0, Math.min(100, Math.round(progress * 100)));
							permutationLabel = `${index + 1} / ${activeY.length}`;
						}
					}
				);
				attachFitPermutation(yResult, perm);
			}

			result.y_results[yId] = yResult;
			if (result.t.length === 0) result.t = tt;
			if (yResult.fitResult?.fitted?.length > 0) anyValid = true;
		}

		for (const pp of p.args.preProcesses ?? []) {
			if (!pp.processName) continue;
			const proc = appConsts.processMap.get(pp.processName);
			if (proc?.func) {
				for (const yId of Object.keys(result.y_results)) {
					result.y_results[yId].yOutData = proc.func(
						result.y_results[yId].yOutData,
						pp.processArgs ?? {}
					);
				}
			}
		}

		if (my !== _calcToken) return null;
		result.warnings = fitWarnings(p.args, result);
		return { result, anyValid, yINs, t, outputXData, originTime_ms };
	}

	/** Publish a finished compute: panel state, warnings and every output column. */
	function applyFit({ result, anyValid, yINs, t, outputXData, originTime_ms }) {
		fitData = result;
		p.args.valid = anyValid;
		p.warnings = result?.warnings ?? [];
		if (anyValid && p.args.out?.fitx !== -1) {
			const processHash = crypto.randomUUID();
			const firstYId = Object.keys(result.y_results)[0];
			const firstYResult = result.y_results[firstYId];
			const xOutData = firstYResult.xOutData ?? outputXData ?? firstYResult.t;
			writeXOutput(p.args.out.fitx, xOutData, { originTime_ms, processHash });

			for (const yId of yINs) {
				const yOUT = p.args.out['fity_' + yId];
				const yResult = result.y_results[yId];
				if (yOUT != null && yOUT !== -1 && yResult) {
					writeOutputColumn(yOUT, yResult.yOutData, { processHash });
				}

				const residOUT = p.args.out['resid_' + yId];
				if (residOUT != null && residOUT !== -1 && yResult) {
					const yCol = getColumnById(yId);
					const resid = residualColumn(
						yResult,
						p.args.model ?? 'cosinor',
						t,
						yCol?.getData() ?? []
					);
					if (resid) writeOutputColumn(residOUT, resid, { processHash });
				}

				writeOutputColumn(
					p.args.out['permstats_' + yId],
					Array.isArray(yResult?.fitResult?.permutedStats) ? yResult.fitResult.permutedStats : [],
					{ processHash }
				);
			}

			writeFitMetricOutputs(p.args, result, processHash);
		}

		if (!p.args.permuteTest) {
			for (const yId of yINs) {
				// Clear stale permutation stats (no processHash — GUId untouched).
				writeOutputColumn(p.args.out['permstats_' + yId], []);
			}
		}
	}

	let yExcludeIds = $derived.by(() => {
		if (hideInputs) return [];
		const ids = [p.args.xIN];
		if (p.args.out.fitx >= 0) ids.push(p.args.out.fitx);
		for (const key of Object.keys(p.args.out)) {
			if (
				(key.startsWith('fity_') || key.startsWith('resid_') || key.startsWith('permstats_')) &&
				p.args.out[key] >= 0
			)
				ids.push(p.args.out[key]);
		}
		return ids;
	});

	// Mirror the panel state into the memo so the next mount can restore it.
	// Guarded on undefined: a fresh instance that has not computed yet must not
	// wipe a cached result another instance is still showing.
	$effect(() => {
		if (fitData !== undefined) memo.payload = fitData;
	});
	function restore(cached) {
		fitData = cached;
	}
	// Every mounted instance follows the shared result: with the node expanded on
	// the canvas AND selected in the control panel there are two, and only the
	// first to run the compute effect claims the hash and computes (see
	// computeMemo.js).
	$effect(() => memo.follow(getHash, restore));

	$effect(() => {
		const dataHash = getHash;
		if (!mounted) return;
		if (memo.hash !== dataHash) {
			// Claim this hash BEFORE the deferred getFit runs, so the effect cannot re-enter
			// and a second mounted instance does not run the same compute. No `calculating`
			// gate: the runner lets a newer hash supersede the run in flight (the old gate
			// made an edit during a long permutation test wait for it to finish).
			memo.hash = dataHash;
			untrack(() => {
				getFit();
			});
		}
	});

	$effect(() => {
		void p.args.yIN; // dependency read: re-reconcile when the Y selection changes
		if (!mounted) return;
		// Defer reconcile out of the effect: syncYColumns() calls `new Column()`, whose
		// $derived fields go inert if created while this effect is the active reaction
		// (Svelte derived_inert). A microtask runs with no active effect → root-owned.
		queueMicrotask(() =>
			untrack(() => {
				// Reconcile all three per-Y output families; recompute if any changed. `|` (not `||`)
				// so every sync runs — short-circuiting would skip resid/perm reconcile.
				const changed = syncYColumns() | syncResidColumns() | syncPermColumns();
				if (changed) getFit();
			})
		);
	});

	// Reconcile the metric columns when the model changes (each model owns a
	// different parameter set). Deferred out of the effect: syncMetricOutColumns
	// constructs Columns, which must not happen under an active reaction
	// (derived_inert). Mirrors TrendFit's coef_* reconcile.
	$effect(() => {
		void p.args.model;
		if (!mounted) return;
		queueMicrotask(() =>
			untrack(() => {
				if (syncFitMetricColumns()) getFit();
			})
		);
	});

	onMount(() => {
		// Put the previous result back before anything else: the compute effect
		// skips when nothing changed, and this state died with the last instance.
		// Whether the cached result came back. The placeholder branch below must not
		// overwrite it: that placeholder carries no stats (rmse NaN, no parameters), and
		// since the memo already holds this hash the compute effect will not fire to
		// replace it — so the panel would stay stat-less until an input changed.
		const restoredFromMemo = memo.has(getHash);
		if (restoredFromMemo) restore(memo.payload);
		if (!p.args.out) p.args.out = {};
		if ((p.args.out.fitx == null || p.args.out.fitx < 0) && p.parent) {
			const xCol = new Column({});
			xCol.name = 'fitx_' + p.id;
			pushObj(xCol);
			p.parent.columnRefs = [xCol.id, ...p.parent.columnRefs];
			p.args.out.fitx = xCol.id;
		}
		// Evaluate all separately — `||` would short-circuit and skip creating the resid /
		// perm / metric columns whenever an earlier init already reported a change.
		const fitInit = initYColumns();
		const permInit = initPermColumns();
		const residInit = initResidColumns();
		// Backfill metric out-columns for sessions saved before the ports existed.
		const metricInit = syncFitMetricColumns();
		const needsCompute = fitInit || permInit || residInit || metricInit;
		if (needsCompute) {
			getFit();
		} else if (!restoredFromMemo) {
			const xKey = p.args.out.fitx;
			if (xKey >= 0 && core.rawData.has(xKey) && core.rawData.get(xKey).length > 0) {
				const y_results = {};
				for (const yId of p.args.yIN ?? []) {
					const outKey = 'fity_' + yId;
					const yOutId = p.args.out[outKey];
					if (yOutId >= 0 && core.rawData.has(yOutId)) {
						y_results[yId] = {
							fitResult: {
								fitted: core.rawData.get(yOutId),
								parameters: {},
								rmse: NaN,
								rSquared: NaN
							},
							predicted: null,
							t: core.rawData.get(xKey)
						};
					}
				}
				fitData = {
					t: core.rawData.get(xKey),
					outputXData: null,
					y_results,
					originTime_ms: null
				};
				p.args.valid = true;
				// NOTE: memo.hash deliberately NOT set here — the rehydrated fitData
				// holds only the fitted curve, not the derived stats, so let the
				// $effect recompute them once after mount (curve above is a placeholder).
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

	// Panel phases in the node's phase reference (the same conversion as the ports).
	const panelPhase = (v, period) => applyPhaseReference(v, fitData?.phaseRef, period);
	let phaseNote = $derived(fitData?.phaseRef?.clock ? 'clock time' : `${periodUnit} after start`);

	function getFitStatsData() {
		if (!fitData?.y_results) return { headers: [], rows: [] };
		const model = p.args.model ?? 'cosinor';
		const validEntries = Object.entries(fitData.y_results).filter(
			([, r]) => (r.fitResult?.fitted?.length ?? 0) > 0
		);
		if (!validEntries.length) return { headers: [], rows: [] };
		const includePermutation = validEntries.some(
			([, r]) =>
				Number.isFinite(r.fitResult?.pValue) || typeof r.fitResult?.significant === 'boolean'
		);

		// Phases in the node's phase reference, as on the ports (FIT-9).
		const phaseRef = fitData.phaseRef;
		const unit = phaseRef?.clock ? 'clock_h' : 'peak_h';
		const ph = (v, period) => (v == null ? null : applyPhaseReference(v, phaseRef, period));
		const clockSuffix = phaseRef?.clock ? '_clock_h' : '';
		let maxH = 0;
		let headers = ['column', 'rmse', 'r2'];
		if (model === 'cosinor') {
			if (p.args.useFixedPeriod) {
				headers.push('M', 'period', 'pValue');
				maxH = Math.max(
					...validEntries.map(([, r]) => r.fitResult?.fixedStats?.harmonics?.length ?? 0)
				);
				// The overall waveform the amplitude / acrophase ports report (FIT-13).
				if (maxH > 1) headers.push('overall_amplitude', `orthophase_${unit}`);
				// Acrophase = time of peak in the phase reference, as on `acrophase_h1`.
				for (let i = 0; i < maxH; i++)
					headers.push(`H${i + 1}_amplitude`, `H${i + 1}_acrophase_${unit}`);
			} else {
				const maxC = Math.max(
					...validEntries.map(([, r]) => r.fitResult?.parameters?.cosines?.length ?? 0)
				);
				// `phase_rad` is the model's φ in A·cos(ωt + φ); `acrophase_peak_h` is the
				// time of peak, the convention every acrophase in AnCiR uses.
				for (let i = 0; i < maxC; i++)
					headers.push(
						`C${i + 1}_period`,
						`C${i + 1}_amplitude`,
						`C${i + 1}_phase_rad`,
						`C${i + 1}_acrophase_${unit}`
					);
			}
		} else if (model === 'rectangular') {
			headers.push('period', `acrophase${clockSuffix}`, 'duty_cycle', 'kappa', 'M', 'A', 'pValue');
		} else if (model === 'doublelogistic') {
			headers.push(
				`onset${clockSuffix}`,
				`offset${clockSuffix}`,
				'k1',
				'k2',
				'period',
				'duty_cycle',
				'M',
				'A',
				'pValue'
			);
		}

		if (includePermutation) headers.push('significant');

		const rows = validEntries.map(([yId, r]) => {
			const name = getColumnById(Number(yId))?.name ?? String(yId);
			const fr = r.fitResult;
			const row = [name, fr.rmse, fr.rSquared];
			if (model === 'cosinor') {
				if (p.args.useFixedPeriod) {
					row.push(
						fr.fixedStats?.M ?? fr.parameters?.M ?? null,
						fr.parameters?.period ?? null,
						fr.pValue ?? null
					);
					if (maxH > 1) {
						const multi = (fr.fixedStats?.harmonics?.length ?? 0) > 1;
						row.push(
							multi ? fitMetricValue('amplitude', model, fr, phaseRef) : null,
							multi ? fitMetricValue('acrophase', model, fr, phaseRef) : null
						);
					}
					const P = fr.parameters?.period ?? p.args.fixedPeriod ?? 24;
					for (const h of fr.fixedStats?.harmonics ?? []) {
						row.push(h.amplitude ?? null, ph(h.acrophase_hrs ?? null, P / h.k));
					}
					while (row.length < headers.length) row.push(null);
				} else {
					for (const c of fr.parameters?.cosines ?? []) {
						const period = c.frequency ? (2 * Math.PI) / c.frequency : NaN;
						row.push(
							period,
							c.amplitude ?? null,
							c.phase ?? null,
							c.frequency ? ph(wrapToPeriod(-c.phase / c.frequency, period), period) : null
						);
					}
					while (row.length < headers.length) row.push(null);
				}
			} else if (model === 'rectangular') {
				row.push(
					fr.period ?? null,
					fitMetricValue('acrophase', model, fr, phaseRef),
					fr.parameters?.dutyCycle ?? null,
					fr.parameters?.kappa ?? null,
					fr.parameters?.M ?? null,
					fr.parameters?.A ?? null,
					fr.pValue ?? null
				);
			} else if (model === 'doublelogistic') {
				row.push(
					fitMetricValue('onset', model, fr, phaseRef),
					fitMetricValue('offset', model, fr, phaseRef),
					fr.parameters?.k1 ?? null,
					fr.parameters?.k2 ?? null,
					fr.parameters?.T ?? null,
					fr.dutyCycle ?? null,
					fr.parameters?.M ?? null,
					fr.parameters?.A ?? null,
					fr.pValue ?? null
				);
			}
			if (includePermutation) {
				row.push(typeof fr.significant === 'boolean' ? fr.significant : null);
			}
			return row;
		});

		return { headers, rows };
	}

	// Publish this node's result tables live, for the Tables that "View stats" (and "View
	// permutations") open; see core/nodeResultTables.
	useNodeResultTables(() => `tableprocess_${p.id}`, {
		stats: { title: 'Fit function stats', get: getFitStatsData }
	});
</script>

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
		<span>Fit parameters</span>
	</div>

	<div class="control-input-horizontal">
		<div class="control-input">
			<p>Model</p>
			<AttributeSelect
				bind:value={p.args.model}
				options={['cosinor', 'rectangular', 'doublelogistic']}
				optionsDisplay={['Cosinor', 'Rectangular wave', 'Double logistic']}
				onChange={() => getFit()}
			/>
		</div>
	</div>

	{#if p.args.model === 'cosinor'}
		<div class="control-input-horizontal">
			<div class="control-input">
				<label>
					<input type="checkbox" bind:checked={p.args.useFixedPeriod} onchange={() => getFit()} />
					Use fixed period / harmonic model
				</label>
			</div>
		</div>
		{#if p.args.useFixedPeriod}
			<div class="control-input-horizontal">
				<ControlInput label={`Fixed period (${periodUnit})`}>
					<NumberWithUnits
						bind:value={p.args.fixedPeriod}
						min="0.1"
						step="0.1"
						onInput={() => getFit()}
					/>
				</ControlInput>
				<ControlInput label="Harmonics">
					<NumberWithUnits
						bind:value={p.args.nHarmonics}
						min="1"
						step="1"
						onInput={() => getFit()}
					/>
				</ControlInput>
				<ControlInput label="Alpha">
					<NumberWithUnits
						bind:value={p.args.alpha}
						min="0.001"
						max="0.2"
						step="0.005"
						onInput={() => getFit()}
					/>
				</ControlInput>
			</div>
		{:else}
			<div class="control-input-horizontal">
				<ControlInput label="Number of cosines">
					<NumberWithUnits bind:value={p.args.Ncurves} min="1" step="1" onInput={() => getFit()} />
				</ControlInput>
			</div>
			<!-- The free period is searched for, and kept, inside this range. -->
			<div class="control-input-horizontal">
				<ControlInput label={`Min period (${periodUnit})`}>
					<NumberWithUnits
						bind:value={p.args.minPeriod}
						{...periodInputProps(p.args.minPeriod)}
						onInput={() => {
							stopFollowingX(p.args);
							getFit();
						}}
					/>
				</ControlInput>
				<ControlInput label={`Max period (${periodUnit})`}>
					<NumberWithUnits
						bind:value={p.args.maxPeriod}
						{...periodInputProps(p.args.maxPeriod)}
						onInput={() => {
							stopFollowingX(p.args);
							getFit();
						}}
					/>
				</ControlInput>
			</div>
		{/if}
	{:else if p.args.model === 'rectangular'}
		<div class="control-input-horizontal">
			<div class="control-input">
				<label
					><input type="checkbox" bind:checked={p.args.fixKappa} onchange={() => getFit()} /> Fix sharpness
					(κ)</label
				>
			</div>
			<div class="control-input">
				<label
					><input type="checkbox" bind:checked={p.args.fixOmega} onchange={() => getFit()} /> Fix period</label
				>
			</div>
			<div class="control-input">
				<label
					><input type="checkbox" bind:checked={p.args.fixDutyCycle} onchange={() => getFit()} /> Fix
					duty cycle</label
				>
			</div>
		</div>
		{#if p.args.fixKappa}
			<div class="control-input-horizontal">
				<ControlInput label="κ value">
					<NumberWithUnits
						bind:value={p.args.fixedKappa}
						min="0.1"
						step="0.5"
						onInput={() => getFit()}
					/>
				</ControlInput>
			</div>
		{/if}
		{#if p.args.fixOmega}
			<div class="control-input-horizontal">
				<ControlInput label={`Period (${periodUnit})`}>
					<NumberWithUnits
						bind:value={p.args.fixedPeriod}
						min="0.1"
						step="0.1"
						onInput={() => getFit()}
					/>
				</ControlInput>
			</div>
		{:else}
			<!-- The free period is searched for, and kept, inside this range (review FIT-1). -->
			<div class="control-input-horizontal">
				<ControlInput label={`Min period (${periodUnit})`}>
					<NumberWithUnits
						bind:value={p.args.minPeriod}
						{...periodInputProps(p.args.minPeriod)}
						onInput={() => {
							stopFollowingX(p.args);
							getFit();
						}}
					/>
				</ControlInput>
				<ControlInput label={`Max period (${periodUnit})`}>
					<NumberWithUnits
						bind:value={p.args.maxPeriod}
						{...periodInputProps(p.args.maxPeriod)}
						onInput={() => {
							stopFollowingX(p.args);
							getFit();
						}}
					/>
				</ControlInput>
			</div>
		{/if}
		{#if p.args.fixDutyCycle}
			<div class="control-input-horizontal">
				<ControlInput label="Duty cycle">
					<NumberWithUnits
						bind:value={p.args.fixedDutyCycle}
						min="0.01"
						max="0.99"
						step="0.05"
						onInput={() => getFit()}
					/>
				</ControlInput>
			</div>
		{/if}
	{:else if p.args.model === 'doublelogistic'}
		<div class="control-input-horizontal">
			<div class="control-input">
				<label
					><input type="checkbox" bind:checked={p.args.periodic} onchange={() => getFit()} /> Periodic
					mode</label
				>
			</div>
			<div class="control-input">
				<label
					><input type="checkbox" bind:checked={p.args.fixK1} onchange={() => getFit()} /> Fix k1</label
				>
			</div>
			<div class="control-input">
				<label
					><input type="checkbox" bind:checked={p.args.fixK2} onchange={() => getFit()} /> Fix k2</label
				>
			</div>
			<div class="control-input">
				<label
					><input type="checkbox" bind:checked={p.args.fixPeriod} onchange={() => getFit()} /> Fix period</label
				>
			</div>
		</div>
		{#if p.args.fixK1}
			<div class="control-input-horizontal">
				<ControlInput label="k1">
					<NumberWithUnits
						bind:value={p.args.fixedK1}
						min="0.01"
						step="0.1"
						onInput={() => getFit()}
					/>
				</ControlInput>
			</div>
		{/if}
		{#if p.args.fixK2}
			<div class="control-input-horizontal">
				<ControlInput label="k2">
					<NumberWithUnits
						bind:value={p.args.fixedK2}
						min="0.01"
						step="0.1"
						onInput={() => getFit()}
					/>
				</ControlInput>
			</div>
		{/if}
		{#if p.args.fixPeriod}
			<div class="control-input-horizontal">
				<ControlInput label={`Period (${periodUnit})`}>
					<NumberWithUnits
						bind:value={p.args.fixedPeriod}
						min="0.1"
						step="0.1"
						onInput={() => getFit()}
					/>
				</ControlInput>
			</div>
		{:else if p.args.periodic}
			<!-- The free period is searched for, and kept, inside this range (review FIT-1). -->
			<div class="control-input-horizontal">
				<ControlInput label={`Min period (${periodUnit})`}>
					<NumberWithUnits
						bind:value={p.args.minPeriod}
						{...periodInputProps(p.args.minPeriod)}
						onInput={() => {
							stopFollowingX(p.args);
							getFit();
						}}
					/>
				</ControlInput>
				<ControlInput label={`Max period (${periodUnit})`}>
					<NumberWithUnits
						bind:value={p.args.maxPeriod}
						{...periodInputProps(p.args.maxPeriod)}
						onInput={() => {
							stopFollowingX(p.args);
							getFit();
						}}
					/>
				</ControlInput>
			</div>
		{/if}
	{/if}

	<div class="control-input-horizontal">
		<div class="control-input">
			<label>
				<input type="checkbox" bind:checked={p.args.permuteTest} onchange={() => getFit()} />
				Permutation test for significance
			</label>
		</div>
	</div>

	{#if p.args.permuteTest}
		<div
			class="control-input-vertical"
			style="background-color: var(--color-lightness-95); padding: 10px; border-radius: var(--radius-sm); margin: 10px 0;"
		>
			<div class="control-input">
				<label>
					<input
						type="checkbox"
						bind:checked={p.args.autoPermutations}
						disabled={calculating}
						onchange={() => getFit()}
					/>
					Auto permutations based on data size
				</label>
			</div>
			{#if !p.args.autoPermutations}
				<ControlInput label="Permutations">
					<NumberWithUnits
						bind:value={p.args.nPermutations}
						min="99"
						max="9999"
						step="100"
						disabled={calculating}
						onInput={() => getFit()}
					/>
				</ControlInput>
			{/if}
			<ControlInput label="Seed">
				<NumberWithUnits
					bind:value={p.args.permutationSeed}
					min="1"
					max="2147483646"
					step="1"
					disabled={calculating}
					onInput={() => getFit()}
				/>
			</ControlInput>
			<div class="control-input">
				<p>Statistic</p>
				<AttributeSelect
					bind:value={p.args.permutationStatistic}
					options={['rSquared', 'rmse']}
					optionsDisplay={['R²', 'RMSE']}
					onChange={() => getFit()}
				/>
			</div>
			<ControlInput label="Permute">
				<select
					bind:value={p.args.permutationScheme}
					disabled={calculating}
					onchange={() => getFit()}
				>
					<option value="shuffle">single values</option>
					<option value="block">one-period blocks</option>
				</select>
			</ControlInput>
			<p class="hint">
				Permuting single values assumes the observations are exchangeable (independent). Time series
				are usually autocorrelated, which makes that p-value too small; one-period blocks keep the
				autocorrelation, and the Surrogate Test node offers block and AR(1) surrogates.
			</p>
			<button onclick={() => getFit()} disabled={calculating} style="margin-top: 10px;">
				{#if calculating}
					Testing... {permutationProgress}%
				{:else}
					Run permutation test
				{/if}
			</button>
		</div>
	{/if}

	<div class="control-input-horizontal">
		<PhaseReferenceSelect
			bind:value={p.args.phaseReference}
			xIsTime={xIN_col?.type === 'time'}
			onchange={() => getFit()}
		/>
	</div>

	{#if !hideInputs}
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
	{/if}
</div>

{#snippet fitStats(yResult, yName, yId)}
	<div class="control-input-horizontal">
		<div class="control-input">
			<p>
				R²: {yResult?.fitResult?.rSquared?.toFixed(3)}
				<StoreValueButton
					label="R²"
					getter={() => yResult?.fitResult?.rSquared}
					defaultName={`fit_r2_${yName}`}
					source={'Fit waveform model (' + p.args.model + ')'}
				/>
				&ensp;RMSE: {yResult?.fitResult?.rmse?.toFixed(3)}
				<StoreValueButton
					label="RMSE"
					getter={() => yResult?.fitResult?.rmse}
					defaultName={`fit_rmse_${yName}`}
					source={'Fit waveform model (' + p.args.model + ')'}
				/>
			</p>
			{#if yId != null && p.args.out?.['resid_' + yId] >= 0}
				<button
					class="resid-btn"
					onclick={() => plotResiduals(yId, yName)}
					title="Scatter the residuals (observed − fitted) against the input x to check the fit"
				>
					Plot residuals
				</button>
			{/if}
			{#if Array.isArray(yResult?.fitResult?.permutedStats) && yResult.fitResult.permutedStats.length > 0 && Number.isFinite(yResult?.fitResult?.pValue)}
				<p
					style="color: {yResult.fitResult.significant
						? 'var(--color-success)'
						: 'var(--color-warning-text)'}; font-weight: 600;"
				>
					Perm p-value: {yResult.fitResult.pValue.toFixed(4)}
					{#if yResult.fitResult.significant}
						✓ Significant (p &lt; 0.05)
					{:else}
						⚠ Not significant (p ≥ 0.05)
					{/if}
				</p>
				<p class="hint">
					{yResult.fitResult.permutedStats.length} permutations ({permutationSchemeLabel({
						permScheme: yResult.fitResult.permScheme,
						permBlockLength: yResult.fitResult.permBlockLength
					})})
				</p>
			{/if}
		</div>
	</div>
	<div class="control-input-horizontal">
		<div class="control-input">
			{#if p.args.model === 'cosinor'}
				{#if p.args.useFixedPeriod}
					<p>Mesor: {yResult?.fitResult?.fixedStats?.M?.toFixed(3)}</p>
					<p>Period: {p.args.fixedPeriod?.toFixed?.(3)} {periodUnit}</p>
					{#if (yResult?.fitResult?.fixedStats?.harmonics?.length ?? 0) > 1}
						<!-- The waveform the amplitude / acrophase ports report (FIT-13). -->
						<p>
							Overall: amp (half the curve's range) {fitMetricValue(
								'amplitude',
								'cosinor',
								yResult.fitResult,
								fitData?.phaseRef
							)?.toFixed(3)}, orthophase (time of overall peak, {phaseNote}) {fitMetricValue(
								'acrophase',
								'cosinor',
								yResult.fitResult,
								fitData?.phaseRef
							)?.toFixed(3)}
							{periodUnit}
						</p>
					{/if}
					{#each yResult?.fitResult?.fixedStats?.harmonics ?? [] as h, i (i)}
						<p>
							H{i + 1}: amp {h.amplitude?.toFixed(3)}, acrophase (time of peak, {phaseNote}) {panelPhase(
								h.acrophase_hrs,
								(p.args.fixedPeriod ?? 24) / (i + 1)
							)?.toFixed(3)}
							{periodUnit}
							<StoreValueButton
								label={`H${i + 1}`}
								getter={() => h.amplitude}
								defaultName={`fit_h${i + 1}_${yName}`}
								source="Fit waveform model (cosinor)"
							/>
						</p>
					{/each}
				{:else}
					{#each yResult?.fitResult?.parameters?.cosines ?? [] as c, i (i)}
						<p>
							C{i + 1}: amp {c.amplitude?.toFixed(3)}, period {c.frequency
								? ((2 * Math.PI) / c.frequency).toFixed(3)
								: 'NaN'}
							{periodUnit}, acrophase (time of peak, {phaseNote}) {c.frequency
								? panelPhase(
										wrapToPeriod(-c.phase / c.frequency, (2 * Math.PI) / c.frequency),
										(2 * Math.PI) / c.frequency
									).toFixed(3)
								: 'NaN'}
							{periodUnit}
							<StoreValueButton
								label={`C${i + 1}`}
								getter={() => c.amplitude}
								defaultName={`fit_c${i + 1}_${yName}`}
								source="Fit waveform model (cosinor)"
							/>
						</p>
					{/each}
				{/if}
			{:else if p.args.model === 'rectangular'}
				<p>Mesor: {yResult?.fitResult?.parameters?.M?.toFixed(3)}</p>
				<p>Amplitude: {yResult?.fitResult?.parameters?.A?.toFixed(3)}</p>
				<p>Period: {yResult?.fitResult?.period?.toFixed(3)} {periodUnit}</p>
				<p>
					Acrophase ({phaseNote}): {fitMetricValue(
						'acrophase',
						'rectangular',
						yResult?.fitResult,
						fitData?.phaseRef
					)?.toFixed(3)}
					{periodUnit}
				</p>
				<p>Duty cycle: {(yResult?.fitResult?.parameters?.dutyCycle * 100)?.toFixed?.(1)}%</p>
				<p>κ: {yResult?.fitResult?.parameters?.kappa?.toFixed(3)}</p>
			{:else if p.args.model === 'doublelogistic'}
				<p>Mesor: {yResult?.fitResult?.parameters?.M?.toFixed(3)}</p>
				<p>Amplitude: {yResult?.fitResult?.parameters?.A?.toFixed(3)}</p>
				<p>
					Onset ({phaseNote}): {fitMetricValue(
						'onset',
						'doublelogistic',
						yResult?.fitResult,
						fitData?.phaseRef
					)?.toFixed(3)}
					{periodUnit}
				</p>
				<p>
					Offset ({phaseNote}): {fitMetricValue(
						'offset',
						'doublelogistic',
						yResult?.fitResult,
						fitData?.phaseRef
					)?.toFixed(3)}
					{periodUnit}
				</p>
				<p>k1: {yResult?.fitResult?.parameters?.k1?.toFixed(3)}</p>
				<p>k2: {yResult?.fitResult?.parameters?.k2?.toFixed(3)}</p>
				{#if yResult?.fitResult?.parameters?.T != null}
					<p>Period: {yResult.fitResult.parameters.T.toFixed(3)} {periodUnit}</p>
				{/if}
			{/if}
		</div>
	</div>
{/snippet}

<details open>
	<summary class="section-details-summary">Output</summary>
	<div class="section-row">
		<div class="section-content">
			{#if calculating}
				<LoadingSpinner
					message="Fitting model"
					detail={p.args.permuteTest
						? `${permutationProgress}% complete${permutationLabel ? `, ${permutationLabel}` : ''}`
						: ''}
				/>
			{:else if calcError}
				<p class="warn">
					The {p.args.model ?? 'cosinor'} fit failed: {calcError}
					<button class="tp-stat-btn" onclick={() => getFit()}>Retry</button>
				</p>
			{:else if p.args.valid && p.args.out.fitx != -1}
				{@const xout = getColumnById(p.args.out.fitx)}
				<div class="tp-outputs">
					<div class="tp-output-row">
						<span class="tp-output-label">{getColumnById(p.args.xIN)?.name ?? 'x'} (shared)</span>
						<ColumnComponent col={xout} />
					</div>
					{#each p.args.yIN ?? [] as yId (yId)}
						{@const outKey = 'fity_' + yId}
						{@const yOutId = p.args.out[outKey]}
						{#if yOutId >= 0}
							{@const yout = getColumnById(yOutId)}
							{#if yout}
								{@const yResult = fitData?.y_results?.[yId]}
								{@const srcName = getColumnById(Number(yId))?.name ?? yId}
								{@const permOutKey = 'permstats_' + yId}
								{@const permOutId = p.args.out[permOutKey]}
								{@const permOut = permOutId >= 0 ? getColumnById(permOutId) : null}
								<div class="tp-output-row">
									<span class="tp-output-label">{srcName}</span>
									<ColumnComponent col={yout} />
									{#if yResult}
										{@render fitStats(yResult, srcName, yId)}
									{/if}
								</div>
								{#if permOut}
									<div class="tp-output-row">
										<span class="tp-output-label">Permutation stats ({srcName})</span>
										<ColumnComponent col={permOut} />
									</div>
								{/if}
							{/if}
						{/if}
					{/each}
				</div>
			{:else if p.args.valid}
				<p>Preview:</p>
				{#each Object.entries(fitData?.y_results ?? {}) as [yId, yResult] (yId)}
					{@const srcName = getColumnById(Number(yId))?.name ?? yId}
					<div class="div-line"></div>
					<p><strong>{srcName}</strong></p>
					{@render fitStats(yResult, srcName, yId)}
				{/each}
				{@const xData = fitData.outputXData ?? fitData.t}
				{@const yIds = Object.keys(fitData?.y_results ?? {})}
				{@const totalRows = xData.length}
				<Table
					headers={[
						'x',
						...yIds.map(
							(id) =>
								(fitData.outputXData ? 'predicted ' : 'fitted ') +
								(getColumnById(Number(id))?.name ?? id)
						)
					]}
					data={[
						xData.slice(previewStart - 1, previewStart + 5).map((x) => x.toFixed(2)),
						...yIds.map((id) => {
							const yr = fitData.y_results[id];
							const yData = yr.predicted ?? yr.fitResult.fitted;
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

{#if !calculating && !calcError && p.args.valid && p.args.out.fitx != -1}
	<div class="tp-stat-actions">
		<button
			class="tp-stat-btn"
			onclick={() =>
				showNodeResultTable({
					sourceNodeId: `tableprocess_${p.id}`,
					resultKey: 'stats',
					title: 'Fit function stats',
					get: getFitStatsData
				})}>View stats</button
		>
		<button
			class="tp-stat-btn"
			onclick={() => {
				const { headers, rows } = getFitStatsData();
				saveStaticDataAsCSV('fit_function_stats', headers, rows);
			}}>Download stats</button
		>
	</div>
{/if}

<!-- Fit-failure and sample-size cautions, inline as well as on the node badge
     (the badge is a tooltip; the reason a fit shows dashes must be readable
     without hovering). Same markup as Cosinor. -->
{#each fitData?.warnings ?? [] as w (w)}
	<p class="warn">{w}</p>
{/each}

<style>
	.hint {
		font-size: var(--font-sm);
		color: var(--color-text-muted);
		margin: var(--space-1) 0 0;
	}
	/* Matches ChiSquared / Rayleigh / Cosinor / NPCRA. */
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

	.resid-btn {
		font: inherit;
		font-size: var(--font-2xs);
		padding: var(--space-1) var(--space-2);
		margin-top: var(--space-1);
		border: 1px solid var(--color-lightness-85);
		border-radius: var(--radius-sm);
		background: var(--color-lightness-99);
		color: var(--color-lightness-25);
		cursor: pointer;
	}

	.resid-btn:hover {
		border-color: var(--color-accent);
		background: var(--color-hover);
	}
</style>
