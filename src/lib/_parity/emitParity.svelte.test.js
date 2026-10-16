/**
 * JS side of the JS↔Python parity harness (NOT a normal test).
 *
 * Runs every fixture in tools/parity/fixtures.json through the REAL AnCiR JS
 * engine and writes outputs to tools/parity/js_results.json. tools/test_parity.py
 * runs the same fixtures through ancir_runtime.py and asserts the two agree.
 *
 * The JS side is the single source of INPUT data too: fixtures may declare a
 * seeded `generate` spec (deterministic rhythm / groups / linear data); the
 * emitter generates the arrays and writes them into js_results.json so the Python
 * side analyses the *identical* numbers (no RNG to re-implement in Python).
 *
 * Compute runs synchronously: a ThrowOnPost fake worker forces the worker pool's
 * documented sync fallback (workerPool.js), so worker-dispatched analyses
 * (e.g. Cosinor's cosinor.fitMany) execute on the main thread and finish before
 * we read their outputs — deterministic, no hangs.
 *
 * Run it explicitly (gated so it never runs in the normal suite):
 *   GEN_PARITY=1 npx vitest run src/lib/_parity/emitParity.svelte.test.js
 */
import { describe, it } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts, appState, pushObj } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { ruleOutputValues } from '$lib/plots/plotMetricDefs.js';
import { isOutsideFitRange } from '$lib/plots/Actogram/markerSelection.js';
import { TableProcess } from '$lib/core/TableProcess.svelte';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';
import { setWorkerFactory } from '$lib/workers/workerPool.js';
import { computeFFT, fftPeak, regridUniform } from '$lib/utils/fft.js';
import { computeAutocorrelation } from '$lib/utils/correlogram.js';
import { gaussianKDE } from '$lib/utils/kde.js';
import { meanSemByGroup } from '$lib/utils/meanSem.js';
import {
	rayleighTest,
	circularMean,
	weightedCircularMean,
	weightedRayleigh
} from '$lib/utils/circular.js';
import {
	bathyphase,
	phaseAngleOfEntrainment,
	circadianFunctionIndex
} from '$lib/utils/cosinorAddons.js';
import { correlate, correlationCI } from '$lib/utils/correlation.js';
import { describeStats } from '$lib/utils/describeStats.js';
import { shapiroWilk, dAgostino, jarqueBera } from '$lib/utils/normality.js';
import { qqPoints } from '$lib/utils/qq.js';
import { crossCorrelation } from '$lib/utils/crossCorrelation.js';
import { chiSquareGoodnessOfFit, chiSquareIndependence } from '$lib/utils/chisquare.js';
import { logisticRegression } from '$lib/utils/logistic.js';
import { pAdjust } from '$lib/utils/pAdjust.js';
import { gridPointCount, gridTooLargeWarning } from '$lib/utils/interpolate.js';
import { sequenceLimitWarning } from '$lib/tableProcesses/SequenceColumn.svelte';
import { fisherExact, conditionalOddsRatio, oddsRatioCI } from '$lib/utils/fisherExact.js';
import { cwt } from '$lib/utils/cwt.js';
import { getStatKeys, computeMovingWindows } from '$lib/utils/movinganalysis.js';
import { isInvalidValue } from '$lib/utils/stats.js';
import { runPeriodogramCalculation } from '$lib/utils/periodogram.js';
import { migrateLegacyEnrightBins } from '$lib/core/enrightBinMigration.js';
import { createSeededRNG } from '$lib/utils/permutationTest.js';
import { studentizedRangeSf, studentizedRangeQuantile } from '$lib/utils/studentizedRange.js';
import { oneWayAnova, tukeyKramerPostHoc } from '$lib/tableProcesses/GroupComparison.svelte';
import { mean as sampleMean, sampleStd } from '$lib/utils/sampleStats.js';

const PARITY_DIR = join(process.cwd(), 'tools', 'parity');

// Adapters so the harness's positional (arrays, ...jsArgs) call convention reaches the
// utils that take an options object or a slightly different signature.
const crossCorrelationAdapter = (x, y, opts = {}) => crossCorrelation(x, y, opts);
const describeStatsAdapter = (values) => describeStats(values);
// Flatten the array-of-objects `coefficients` into parallel arrays so the fixture can compare
// them the same way as the statsmodels reference (which returns parallel arrays).
const logisticRegressionAdapter = (y, predictorCols, names) => {
	const r = logisticRegression(y, predictorCols, names);
	const pick = (k) => r.coefficients.map((c) => c[k]);
	return {
		term: pick('name'),
		coef: pick('coef'),
		se: pick('se'),
		z: pick('z'),
		pvalue: pick('pvalue'),
		oddsRatio: pick('oddsRatio'),
		n: r.n,
		logLik: r.logLik,
		lrChiSq: r.lrChiSq,
		lrPvalue: r.lrPvalue,
		pseudoR2: r.pseudoR2,
		eta: r.perObs?.eta ?? [],
		fitted: r.perObs?.fitted ?? [],
		outcome: r.perObs?.outcome ?? []
	};
};

// Pure calculating-plot compute functions, keyed by the fixture's `jsFn`.
// These are the same functions the plot classes call for periodData/fftData/
// acfData — testing them directly gives numeric parity without constructing a
// reactive plot (see the `plotCompute` fixture kind).
const PLOT_COMPUTE_FNS = { computeFFT, computeAutocorrelation };

// Pure numeric utils exercised directly (no engine, no reactivity) via the
// `pureUtil` fixture kind. Keyed by the fixture's `jsFn`. Each takes one or
// more input arrays (named by `argRefs`, or the single `valuesRef`) followed by
// the fixture's `jsArgs`, and returns either a dict of arrays (compareArrays),
// an array of objects (compareFields), or a dict of scalars (compareScalars).
const PURE_UTIL_FNS = {
	// The Sequence Column limit: allowed (1/0) and the warning ('' when it fits). jsArgs = [count].
	sequenceLimit: (_unused, count) => {
		const w = sequenceLimitWarning(count);
		return { allowed: w ? 0 : 1, warning: w ?? '' };
	},
	// The resample-grid limit (Interpolate): the grid size and the warning ('' when it fits).
	// The input array is unused. jsArgs = [start, end, step, unit].
	interpolateGridLimit: (_unused, start, end, step, unit = '') => ({
		count: gridPointCount(start, end, step),
		warning: gridTooLargeWarning(start, end, step, unit) ?? ''
	}),
	// Studentized range upper tail and quantile. values = [q, k, df, p].
	studentizedRange: (v) => ({
		sf: studentizedRangeSf(v[0], v[1], v[2]),
		quantile: studentizedRangeQuantile(v[3], v[1], v[2])
	}),
	// One-way ANOVA then the Tukey-Kramer post hoc, on groups given as value arrays named
	// g1, g2, ... (argRefs in order); the last jsArg is alpha. Returns the pair rows.
	tukeyKramer: (...args) => {
		const alpha = args.pop();
		const groups = args.map((vals, i) => {
			const values = vals.filter((v) => v != null).map(Number);
			return {
				name: `g${i + 1}`,
				values,
				n: values.length,
				mean: sampleMean(values),
				sd: sampleStd(values)
			};
		});
		const an = oneWayAnova(groups);
		return an.valid ? tukeyKramerPostHoc(groups, an.msWithin, an.dfWithin, alpha) : [];
	},
	// The first n draws of createSeededRNG(seed) (@stdlib minstd-shuffle). The input array is
	// unused: the harness always passes at least one.
	seededSequence: (_unused, n, seed) => {
		const rng = createSeededRNG(seed);
		return { values: Array.from({ length: n }, () => rng()) };
	},
	// The refined FFT peak (fftPeak over computeFFT), flattened to scalars; no peak (flat data,
	// a refused grid) is NaN throughout. jsArgs = [freqStep, periodMin, periodMax].
	fftPeakOf: (t, y, freqStep, periodMin, periodMax) => {
		const pk = fftPeak(computeFFT(t, y, freqStep ?? null), {
			periodMin: periodMin ?? undefined,
			periodMax: periodMax ?? undefined
		});
		return pk
			? { frequency: pk.frequency, period: pk.period, magnitude: pk.magnitude, phase: pk.phase }
			: { frequency: NaN, period: NaN, magnitude: NaN, phase: NaN };
	},
	// The FFT grid (regridUniform): ok flag, step, filled count, longest run and the gridded y.
	regridUniform: (t, y) => {
		const g = regridUniform(t, y);
		return { ok: g.ok ? 1 : 0, dt: g.dt, nFilled: g.nFilled, longestGap: g.longestGap, y: g.y };
	},
	// Also a PLOT_COMPUTE_FN: reachable here so a fixture can compare its scalar
	// peak (peakLag/peakCorrelation) and not only the lag/correlation arrays.
	computeAutocorrelation,
	gaussianKDE,
	meanSemByGroup,
	rayleighTest,
	circularMean,
	weightedCircularMean,
	weightedRayleigh,
	bathyphase,
	phaseAngleOfEntrainment,
	circadianFunctionIndex,
	correlate,
	// values = [r, n]; the harness passes arrays, so unpack here.
	correlationCI: (values, method, confidence) => {
		const [lo, hi] = correlationCI(values[0], values[1], method, confidence);
		return { ciLow: lo, ciHigh: hi };
	},
	describeStats: describeStatsAdapter,
	shapiroWilk,
	dAgostino,
	jarqueBera,
	// Flatten the nested {line, band} shape into named arrays for compareArrays.
	// jsArgs = [confidence].
	qqPoints: (values, confidence) => {
		const q = qqPoints(values, { confidence });
		return {
			theoretical: q.theoretical,
			sample: q.sample,
			linePar: [q.line.slope, q.line.intercept],
			bandLo: q.band.lo,
			bandHi: q.band.hi
		};
	},
	// The probability-plot correlation r the Q-Q plot displays (and emits as its
	// qq_r metric column), plus the clean-value count n it was computed on.
	qqCorrelation: (values) => {
		const q = qqPoints(values);
		return { r: q.r, n: q.n };
	},
	crossCorrelation: crossCorrelationAdapter,
	chiSquareGoodnessOfFit,
	chiSquareIndependence,
	logisticRegression: logisticRegressionAdapter,
	pAdjust: pAdjustAdapter,
	cwtPeakScaleIndex: cwtPeakScaleIndexAdapter,
	movingWindows: movingWindowsAdapter,
	fisherExact,
	// Chi-squared (Sokolove-Bushell) periodogram. The fixtures compare `period`,
	// `power`, `df` AND `threshold`: with binSize at or below the sampling
	// interval every bin holds at most one point, so the Python/R mod-binning
	// ports and the JS binData-then-fold pipeline are the SAME fold and must
	// agree exactly — including on grids where most bins are empty, which is the
	// regime whose occupancy-weighted empty-bin handling (effective df =
	// occupied columns - 1) the pure-chisq-periodogram-emptybins fixture pins.
	// With several points per bin the pipelines still differ (grand mean over
	// bin means vs raw points); that regime stays unpinned. These fixtures exist
	// because the drawn threshold was wrong in all three languages, differently,
	// and then the statistic itself was ~2.5-10x inflated on empty-bin grids,
	// and nothing compared either.
	chiSquaredPeriodogram: (t, y, opts) => {
		const r = runPeriodogramCalculation({
			method: 'Chi-squared',
			xData: t,
			yData: y,
			binSize: opts.binSize ?? 0.25,
			periodMin: opts.periodMin,
			periodMax: opts.periodMax,
			periodSteps: opts.periodStep,
			chiSquaredAlpha: opts.alpha ?? 0.05
		});
		return { period: r.x, power: r.y, df: r.df, threshold: r.threshold, pvalue: r.pvalue };
	},
	// Lomb-Scargle through runPeriodogramCalculation (valid pairs, flat-data rule).
	lombScarglePeriodogram: (t, y, opts) => {
		const r = runPeriodogramCalculation({
			method: 'Lomb-Scargle',
			xData: t,
			yData: y,
			periodMin: opts.periodMin,
			periodMax: opts.periodMax,
			periodSteps: opts.periodStep
		});
		return { period: r.x, power: r.y };
	},
	// Enright periodogram through the real binData pipeline: the ports must
	// reproduce Enright's A_p (RMS deviation of the folded column means, each over its
	// occupied bins), including the empty bins that missing values and gaps leave.
	enrightPeriodogram: (t, y, opts) => {
		const r = runPeriodogramCalculation({
			method: 'Enright',
			xData: t,
			yData: y,
			binSize: opts.binSize ?? 0.25,
			periodMin: opts.periodMin,
			periodMax: opts.periodMax,
			periodSteps: opts.periodStep
		});
		return { period: r.x, power: r.y };
	},
	fisherConditionalOR: (table, confidence, alternative) => {
		const ci = oddsRatioCI(table, confidence, alternative);
		return { conditionalOddsRatio: conditionalOddsRatio(table), ciLow: ci[0], ciHigh: ci[1] };
	}
};

/**
 * Rolling-window statistics as flat arrays, one per stat key.
 *
 * Targets the PURE windowing function rather than the MovingAnalysis node: the
 * node's per-stat output COLUMNS are created by its component reconcile, not by
 * its `func`, so the table-process parity path cannot reach them (which is why
 * this node never had a fixture). computeMovingWindows is where the windowing
 * and the per-window maths actually live, so checking it checks the thing that
 * could be wrong.
 */
function movingWindowsAdapter(t, y, opts) {
	const windowSize = opts.windowSize ?? 168;
	const step = opts.stepSize ?? 24;
	// Preserve missing values (null / blank string) instead of Number()-coercing
	// them to 0 — computeMovingWindows applies the house isInvalidValue filter,
	// and the blank-cell fixture exists to pin exactly that (v72.28).
	const coerce = (v) => (isInvalidValue(v) ? NaN : Number(v));
	const tt = t.map(coerce);
	const validT = tt.filter(Number.isFinite);
	const lo = Math.min(...validT);
	const hi = Math.max(...validT);
	const starts = [];
	for (let s = lo; s <= hi - windowSize + 1e-9; s += step) starts.push(s);

	const statKeys = getStatKeys(opts);
	const per = computeMovingWindows({
		tAll: tt,
		ys: [y.map(coerce)],
		starts,
		windowSize,
		statKeys,
		args: opts,
		// The node's phase frame: the record start, and (with `clockOffsetHours`) a clock
		// reference whose origin is that many hours after local midnight.
		phase: {
			recordStart: lo,
			ref:
				opts.clockOffsetHours != null ? { clock: true, offsetHours: opts.clockOffsetHours } : null
		}
	})[0];

	const out = { starts };
	for (const k of statKeys) out[k] = safeArray(per[k]);
	return out;
}

/** pAdjust returns a bare array; the harness compares named arrays. */
function pAdjustAdapter(pvalues, method) {
	return { adjusted: pAdjust(pvalues, method) };
}

/**
 * Index of the maximum-power SCALE at each interior time point.
 *
 * Compared against PyWavelets rather than the full power map on purpose:
 * pywt's cmor normalisation and edge handling differ from Torrence & Compo's,
 * so the two fields agree only up to a scale-dependent factor. The argmax over
 * scales is invariant to any such factor and is the quantity that carries the
 * science. Interior points only — inside the cone of influence both
 * implementations report edge artefacts, not measurements.
 */
function cwtPeakScaleIndexAdapter(values, opts) {
	const r = cwt(values, opts.dt, {
		dj: opts.dj,
		s0: opts.s0,
		j1: opts.j1,
		param: opts.w0,
		rectify: false
	});
	const out = [];
	for (let i = opts.lo; i < opts.hi; i++) {
		let best = 0;
		for (let j = 1; j < r.power.length; j++) if (r.power[j][i] > r.power[best][i]) best = j;
		out.push(best);
	}
	return { peakScaleIndex: out };
}

class ThrowOnPost {
	postMessage() {
		throw new Error('parity harness: forcing synchronous compute');
	}
	terminate() {}
}

// --- deterministic seeded data (mirrors the demo/classroom generators) --------
function mulberry32(seed) {
	return function () {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
function normal(rng, mean = 0, sd = 1) {
	const u = Math.max(rng(), 1e-12);
	const v = rng();
	return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const seq = (n, f) => Array.from({ length: n }, (_, i) => f(i));

// Returns { ref: { type, values } } from a seeded spec. Same seed → same arrays.
function generateInputs(spec) {
	const rng = mulberry32(spec.seed ?? 1);
	if (spec.type === 'rhythm') {
		// `dt` is the time step in x units (default 1). A fixture whose axis is in
		// days sets dt: 1/24 (written as 0.041666… in JSON) so the time values are
		// the same non-representable multiples a day-unit session would carry.
		// Optional missing data: `missingEvery` nulls every k-th y (from index
		// `missingOffset`), and `gap: [from, to]` nulls y for from <= index < to.
		// The noise draw still runs for a nulled row, so the rest of the series is
		// identical to the spec without them.
		// `trend` (optional) adds a linear drift of `trend` per x unit: the case that
		// used to drag the free-period cosinor out to thousands of hours.
		const { n, period, amp, mesor = 0, phase = 0, noise = 0, dt = 1, trend = 0, refs } = spec;
		const { missingEvery = 0, missingOffset = 0, gap = null } = spec;
		const t = seq(n, (i) => i * dt);
		// `xStart` (optional, ISO) turns x into a TIME column: epoch ms at xStart + t hours.
		// y is drawn on the same hours, so the series is otherwise identical.
		const xStartMs = spec.xStart != null ? Date.parse(spec.xStart) : null;
		// `second: {period, amp, phase}` (optional) adds a second cosine component, e.g. a weak
		// 24 h H1 under a strong 12 h H2 for the per-harmonic acrophase CI test (FIT-7).
		const sec = spec.second ?? null;
		const y = t.map((h, i) => {
			const v =
				mesor +
				amp * Math.cos((2 * Math.PI * (h - phase)) / period) +
				(sec ? sec.amp * Math.cos((2 * Math.PI * (h - (sec.phase ?? 0))) / sec.period) : 0) +
				(noise ? normal(rng, 0, noise) : 0);
			const skipped = missingEvery > 0 && i % missingEvery === missingOffset;
			const inGap = gap && i >= gap[0] && i < gap[1];
			if (skipped || inGap) return null;
			return trend ? v + trend * h : v;
		});
		// `missingX` (optional): row indices whose x is missing (null), negative from the end,
		// e.g. [0, -1] for both ends. y is unchanged.
		const nullX = (xs) => {
			for (const k of spec.missingX ?? []) xs[k < 0 ? n + k : k] = null;
			return xs;
		};
		if (xStartMs != null) {
			const ms = nullX(t.map((h) => xStartMs + Math.round(h * 3600000)));
			return { [refs.x]: { type: 'time', values: ms }, [refs.y]: { type: 'number', values: y } };
		}
		return {
			[refs.x]: { type: 'number', values: nullX([...t]) },
			[refs.y]: { type: 'number', values: y }
		};
	}
	if (spec.type === 'pvalues') {
		// A realistic screen: mostly uniform nulls with a handful of genuinely
		// small p-values, plus a couple of MISSING entries so the fixture also
		// pins the "excluded from n" rule against statsmodels.
		const { n, refs } = spec;
		const p = seq(n, (i) => {
			if (i % 17 === 5) return null; // a test that failed to run
			if (i < 5) return Math.max(1e-6, rng() * 0.01);
			return rng();
		});
		return { [refs.y]: { type: 'number', values: p } };
	}
	if (spec.type === 'linear') {
		const { n, slope, intercept = 0, noise = 0, refs } = spec;
		const t = seq(n, (i) => i);
		const y = t.map((x) => slope * x + intercept + (noise ? normal(rng, 0, noise) : 0));
		return { [refs.x]: { type: 'number', values: t }, [refs.y]: { type: 'number', values: y } };
	}
	if (spec.type === 'logistic') {
		// A separable-but-not-perfectly-separable binary outcome. Perfect separation makes
		// the MLE diverge, and the coefficient then depends on where each implementation
		// stops iterating rather than on the data — which would compare optimiser
		// stopping rules across three languages instead of the regression itself.
		const { n, slope = 1.2, intercept = -3, refs } = spec;
		const x = seq(n, (i) => (i / (n - 1)) * 6 - 3);
		const y = x.map((v) => (rng() < 1 / (1 + Math.exp(-(intercept + slope * v))) ? 1 : 0));
		return { [refs.x]: { type: 'number', values: x }, [refs.y]: { type: 'number', values: y } };
	}
	if (spec.type === 'groups') {
		const g = [];
		const v = [];
		for (const grp of spec.groups) {
			for (let i = 0; i < grp.n; i++) {
				g.push(grp.label);
				v.push(normal(rng, grp.mean, grp.sd));
			}
		}
		return {
			[spec.refs.g]: { type: 'category', values: g },
			[spec.refs.v]: { type: 'number', values: v }
		};
	}
	throw new Error(`unknown generate type ${spec.type}`);
}

function tpInputs(fx) {
	if (fx.generate) return generateInputs(fx.generate);
	const out = {};
	for (const inp of fx.inputs) out[inp.ref] = { type: inp.type ?? 'number', values: inp.values };
	return out;
}

// --- core helpers -------------------------------------------------------------
function resetCore() {
	core.data = [];
	core.plots = [];
	core.tableProcesses = [];
	core.groups = [];
	core.notes = [];
	core.nodeNotes = {};
	core.orphanProcesses = [];
	core.storedValues = {};
	core.rawData = new Map();
}

function mkCol(type, values, name) {
	const c = new Column({ type, data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

function resolveTokens(value, idMap) {
	if (typeof value === 'string' && value.startsWith('@')) {
		const ref = value.slice(1);
		if (!(ref in idMap)) throw new Error(`unknown input ref ${value}`);
		return idMap[ref];
	}
	if (Array.isArray(value)) return value.map((v) => resolveTokens(v, idMap));
	if (value && typeof value === 'object') {
		const out = {};
		for (const [k, v] of Object.entries(value)) out[k] = resolveTokens(v, idMap);
		return out;
	}
	return value;
}

function canonicalKey(k) {
	const m = k.match(/^(.*)_\d+$/);
	return m ? m[1] : k;
}

// NaN becomes null (JSON has no NaN). +-Infinity is kept: the writer encodes it as a string
// so an infinite result (an open interval end) stays distinct from an undefined one.
function safeArray(arr) {
	return (arr ?? []).map(safeNum);
}
function safeNum(v) {
	return typeof v === 'number' && Number.isNaN(v) ? null : v;
}

// Build input columns from a {ref:{type,values}} dict; return idMap + resolved args.
function buildTableInputs(fx) {
	const inputs = tpInputs(fx);
	const idMap = {};
	for (const [ref, { type, values }] of Object.entries(inputs))
		idMap[ref] = mkCol(type, values, ref);
	return { inputs, idMap, args: resolveTokens(fx.args, idMap) };
}

// --- runners ------------------------------------------------------------------
function runColumnProcess(fx) {
	const def = appConsts.processMap.get(fx.jsName);
	if (!def?.func) throw new Error(`no JS column process ${fx.jsName}`);
	return {
		input: safeArray(fx.input),
		outputs: { value: safeArray(def.func(fx.input, fx.args ?? {})) }
	};
}

async function runTableProcess(fx) {
	const entry = appConsts.tableProcessMap.get(fx.jsName);
	if (!entry?.func) throw new Error(`no JS table process ${fx.jsName}`);
	const { inputs, args } = buildTableInputs(fx);
	// `storedValues` ({key: value}) seeds core.storedValues in the saved-session entry shape,
	// so a FormulaColumn stored-value token (#key) reads it as the app does.
	if (fx.storedValues) {
		core.storedValues = Object.fromEntries(
			Object.entries(fx.storedValues).map(([k, v]) => [k, { staticValue: v }])
		);
	}
	const tp = new TableProcess({ name: fx.jsName, args }, null);
	pushObj(tp);
	// `perInputOut` (optional): per-y output families the node's COMPONENT creates (e.g.
	// AverageProfile's avgprofsem_<yId>, made by useMultiYTP), which a headless TableProcess
	// does not. Each gets an empty column per y input so the node can write it.
	for (const prefix of fx.perInputOut ?? []) {
		const yIds = Array.isArray(tp.args.yIN) ? tp.args.yIN : [tp.args.yIN];
		for (const yId of yIds) tp.args.out[prefix + yId] = mkCol('number', [], prefix + yId);
	}
	const ret = await entry.func(tp.args);

	const want = new Set(fx.compareOutputs ?? []);
	const outputs = {};
	for (const [key, id] of Object.entries(tp.args.out ?? {})) {
		if (typeof id !== 'number' || id < 0) continue;
		const canon = canonicalKey(key);
		if (!want.has(canon)) continue;
		outputs[canon] = safeArray(core.data.find((c) => c.id === id)?.getData?.());
	}
	// `recordValid` fixtures pin a REFUSAL (the node returns invalid and writes nothing), so
	// the validity flag is part of what the ports must reproduce. Recorded only when asked
	// for, so every other fixture's record stays as it was.
	if (fx.recordValid) return { inputs, outputs, valid: Array.isArray(ret) ? !!ret[1] : !!ret };
	return { inputs, outputs };
}

async function runTableProcessResult(fx) {
	const entry = appConsts.tableProcessMap.get(fx.jsName);
	if (!entry?.func) throw new Error(`no JS table process ${fx.jsName}`);
	const { inputs, args } = buildTableInputs(fx);
	const tp = new TableProcess({ name: fx.jsName, args }, null);
	pushObj(tp);
	const ret = await entry.func(tp.args);
	const result = Array.isArray(ret) ? ret[0] : ret;

	// Single-y fixtures: take the one comparison object (skip the 'multiY' key).
	const comps = result?.comparisons ?? {};
	const key = Object.keys(comps).find((k) => k !== 'multiY') ?? Object.keys(comps)[0];
	const comp = comps[key] ?? {};
	const fields = {};
	for (const f of fx.compareFields ?? []) {
		fields[f] = typeof comp[f] === 'number' ? safeNum(comp[f]) : comp[f];
	}
	return { inputs, result: fields };
}

// Calls a pure plot-compute function (fft/autocorrelation) with seeded inputs
// and captures the arrays the fixture wants compared. No plot/reactivity.
function runPlotCompute(fx) {
	// The actogram's plot data is not a pure function of one (times, values) pair: its rows
	// fold every series at ONE startTime taken over all series in the display zone, so it
	// is read from a real Actogram built as the app builds it.
	if (fx.jsFn === 'actogramDownloadData') return runActogramDownload(fx);
	// The correlogram's rows are the plot's acfData, whose lag step comes from the x
	// COLUMN (its binWidth, else its mean spacing), so they too are read from a real plot.
	if (fx.jsFn === 'correlogramDownloadData') return runCorrelogramDownload(fx);
	const inputs = tpInputs(fx);
	const fn = PLOT_COMPUTE_FNS[fx.jsFn];
	if (!fn) throw new Error(`no JS plot-compute fn ${fx.jsFn}`);
	const t = inputs[fx.xRef].values;
	const y = inputs[fx.yRef].values;
	const res = fn(t, y, ...(fx.extraArgs ?? []));
	const outputs = {};
	for (const k of fx.compareArrays ?? []) outputs[k] = safeArray(res[k]);
	return { inputs, outputs };
}

// Resolve the input arrays for a pure-util fixture into a {ref:{type,values}}
// dict (written to js_results so Python reads the identical numbers). Supports
// a seeded `generate` spec, an `inputs[]` list, or a plain `input` dict of
// named arrays.
function pureUtilInputs(fx) {
	if (fx.generate) return generateInputs(fx.generate);
	if (fx.inputs) {
		const out = {};
		for (const inp of fx.inputs) out[inp.ref] = { type: inp.type ?? 'number', values: inp.values };
		return out;
	}
	const out = {};
	for (const [ref, values] of Object.entries(fx.input ?? {})) out[ref] = { type: 'raw', values };
	return out;
}

// Calls a pure numeric util with the fixture's input arrays + jsArgs, capturing
// the arrays/fields/scalars the fixture wants compared. No engine, no reactivity.
function runPureUtil(fx) {
	const inputs = pureUtilInputs(fx);
	const fn = PURE_UTIL_FNS[fx.jsFn];
	if (!fn) throw new Error(`no JS pure-util fn ${fx.jsFn}`);
	const argRefs = fx.argRefs ?? [fx.valuesRef];
	const posArgs = argRefs.map((r) => inputs[r].values);
	const res = fn(...posArgs, ...(fx.jsArgs ?? []));
	const outputs = {};
	if (fx.compareArrays) {
		for (const k of fx.compareArrays) outputs[k] = safeArray(res[k]);
	} else if (fx.compareFields) {
		for (const f of fx.compareFields)
			outputs[f] = res.map((o) => (typeof o[f] === 'number' ? safeNum(o[f]) : o[f]));
	} else if (fx.compareScalars) {
		for (const k of fx.compareScalars)
			outputs[k] = typeof res[k] === 'number' ? safeNum(res[k]) : res[k];
	}
	return { inputs, outputs };
}

// Build one time column and read it back, with no analysis in between.
//
// The time path is the least-verified part of the ports and the one most likely
// to be quietly wrong, because a wrong timezone or unit shifts every downstream
// result without ever throwing. It is also the one place the three languages do
// NOT share an approach: JS parses strictly against the stored `timeFormat`,
// Python ignores that format (a Luxon format string is not valid Python) and
// auto-detects with pandas, and R ignores it too and tries a short list of
// formats. Three different parsers agreeing is an assumption, not a fact, and
// until now nothing checked it — every other fixture generates plain numeric `t`.
//
// `data` is the parsed epoch-ms column; `hoursSinceStart` is what every analysis
// actually consumes, so a disagreement about the baseline shows up there even
// when the instants themselves match.
function runTimeColumn(fx) {
	const spec = fx.column;
	const c = new Column({ type: spec.type ?? 'time', data: -1 });
	c.customName = fx.id;
	if (spec.timeFormat !== undefined) c.timeFormat = spec.timeFormat;
	if (spec.compression) c.compression = spec.compression;
	// AWD columns store {start, step, length} rather than an array; the expansion
	// is the thing under test, so hand the raw object over untouched.
	core.rawData.set(c.id, spec.awd ?? spec.values);
	c.data = c.id;
	core.data.push(c);

	const outputs = {};
	for (const k of fx.compareArrays ?? []) {
		outputs[k] = safeArray(k === 'hoursSinceStart' ? c.hoursSinceStart : c.getData());
	}
	// Echo the column spec so the Python and R legs rebuild the identical column
	// rather than re-reading the fixture and drifting from what JS actually ran.
	return { column: spec, outputs };
}

// --- actogram marker rules (the `actogramMarkers` kind) ---------------------------------
//
// One fixture is one ACTOGRAM: its series (x, y and x type), its row length, the display
// zone its rows snap to, its marker rules, and each series' per-rule data (ticked days,
// hand-placed points), detachments and own blocks. The emitter builds it as the app does
// (Plot.fromJSON over real Columns, so the rule instances, the row folding at the plot's
// startTime and the cfg adapter are the app's own) and records, per series and per rule,
// the five output values `ruleOutputValues` gives the port AND every intermediate the ports
// compute on the way: detections, absolute times, the day-selection mask, the unwrapped
// fit points, the regression, the reference day, the phase and the harmonic candidates.
// The ports rebuild the same actogram from the recorded plain arrays.
//
// Why a kind of its own rather than several pureUtil fixtures: the five outputs are not one
// function's result but a chain (fold -> detect -> select -> unwrap -> fit -> phase ->
// harmonic check) whose inputs come from the plot (startTime and Ndays are computed over
// ALL series, the rule's fixed tau/theta are re-encoded through the reference day). A
// pure-util fixture per function would pin each link and still leave the joins unchecked;
// recording the intermediates of one real chain pins both.

/** Synthetic rest/activity series for an actogram fixture (seeded, deterministic). */
function generateActogramSeries(spec) {
	const rng = mulberry32(spec.seed ?? 1);
	return spec.series.map((s) => {
		const {
			xType = 'time',
			start = '2024-03-04T06:30:00Z',
			dtHrs = 0.25,
			days = 10,
			tau = 24,
			activeHrs = 12,
			onsetHr = 20,
			low = 2,
			high = 40,
			noise = 3,
			gap = null,
			spike = null
		} = s;
		// `stepPattern` (optional, hours) cycles through uneven sample spacings instead of a
		// fixed dtHrs; the record length is then days * 24 over the pattern's mean step.
		const pattern = s.stepPattern ?? null;
		const meanStep = pattern ? pattern.reduce((a, b) => a + b, 0) / pattern.length : dtHrs;
		const n = Math.round((days * 24) / meanStep);
		const startMs = xType === 'time' ? Date.parse(start) : 0;
		const x = [];
		const y = [];
		const hs = [];
		let hAcc = 0;
		for (let i = 0; i < n; i++) {
			if (pattern && i > 0) hAcc += pattern[(i - 1) % pattern.length];
			const h = pattern ? hAcc : i * dtHrs;
			hs.push(h);
			x.push(xType === 'time' ? startMs + Math.round(h * 3600000) : (s.startHr ?? 0) + h);
			const phase = (((h - onsetHr) % tau) + tau) % tau;
			let v = (phase < activeHrs ? high : low) + (noise ? normal(rng, 0, noise) : 0);
			if (v < 0) v = 0;
			// A spike: a short bout outside the active phase, so a row's template match can
			// be pulled away from the true onset.
			if (spike && h >= spike[0] && h < spike[1]) v = high * 1.5;
			if (gap && h >= gap[0] && h < gap[1]) v = null;
			y.push(v);
		}
		// `missingX` (optional): row indices whose TIME is missing (null), negative from the
		// end, e.g. [0, -1] for both ends. The y draw is unchanged.
		for (const k of s.missingX ?? []) x[k < 0 ? n + k : k] = null;
		// `dropHrs: [from, to]` (optional): REMOVE the rows (x and y) in that hour window, a
		// recording gap with no rows at all, unlike `gap`, which keeps the rows with y missing.
		if (s.dropHrs) {
			const [from, to] = s.dropHrs;
			const keep = hs.map((h) => h < from || h >= to);
			const kx = x.filter((_, i) => keep[i]);
			const ky = y.filter((_, i) => keep[i]);
			x.splice(0, x.length, ...kx);
			y.splice(0, y.length, ...ky);
		}
		// `bin: {binWidth, originTime}` on a number series makes it a BIN column as an
		// import schema would (ImportData, e.g. the Enspire multiplate wells): x holds the
		// raw bin starts, and the column carries binWidth and originTime_ms.
		if (s.bin) {
			return {
				xType: 'bin',
				x,
				y,
				binWidth: s.bin.binWidth,
				originTime_ms: s.bin.originTime != null ? Date.parse(s.bin.originTime) : null
			};
		}
		return { xType, x, y };
	});
}

/** The plain arrays a fixture's series hold, from a shipped session's actogram. */
function sessionActogramSeries(src) {
	const session = JSON.parse(readFileSync(join(process.cwd(), src.session), 'utf8'));
	core.rawData = new Map(Object.entries(session.rawData ?? {}).map(([k, v]) => [+k, v]));
	core.data = [];
	for (const cd of session.data ?? []) pushObj(Column.fromJSON(cd));
	const plot = session.plots.find((p) => p.id === src.plotId);
	if (!plot) throw new Error(`no plot ${src.plotId} in ${src.session}`);
	const byId = (id) => core.data.find((c) => c.id === id);
	const out = plot.plot.data.map((d) => {
		const xc = byId(d.x.refId);
		const yc = byId(d.y.refId);
		return { xType: xc.type, x: [...xc.getData()], y: [...yc.getData()] };
	});
	resetCore();
	return out;
}

/** NaN becomes null, recursively, so the record is valid JSON (the writer encodes +-Infinity). */
function jsonSafe(v) {
	if (typeof v === 'number') return Number.isNaN(v) ? null : v;
	if (Array.isArray(v)) return v.map(jsonSafe);
	if (v && typeof v === 'object') {
		const out = {};
		for (const [k, val] of Object.entries(v)) out[k] = jsonSafe(val);
		return out;
	}
	return v ?? null;
}

/** Every intermediate of one block's computation, in the shape the ports return. */
function blockRecord(block, source) {
	if (!block) return { source, outputs: ruleOutputValues(null) };
	const cfg = block.cfg;
	const scope = {
		rangeScopesFit: !!cfg.fitWithinRange,
		lineMinDay: cfg.lineMinDay,
		lineMaxDay: cfg.lineMaxDay
	};
	const reg = block.linearRegression;
	const hc = block.harmonicCheck;
	const u = block.onsetUnwrap;
	return {
		source,
		markerHours: [...block.markers],
		markerTimes: [...block.markerTimes],
		selectedMask: [...block.selectedMask],
		outsideRange: block.markers.map((_, i) => isOutsideFitRange(i, scope)),
		unwrap: {
			xs: [...u.xs],
			ys: [...u.ys],
			n: u.n,
			nDetections: u.nDetections,
			nMerged: u.nMerged,
			nAmbiguous: u.nAmbiguous,
			seedTau: u.seedTau
		},
		refDay: block.fitRefDay,
		fitSlope: cfg.fitSlope,
		fitIntercept: cfg.fitIntercept,
		regression:
			reg && typeof reg === 'object'
				? {
						slope: reg.slope,
						intercept: reg.intercept,
						rSquared: reg.rSquared,
						rmse: reg.rmse,
						n: reg.n
					}
				: null,
		phase: block.estimatedPhase?.phase ?? null,
		harmonic: hc
			? {
					candidates: hc.candidates.map((c) => ({
						label: c.label,
						period: c.period,
						peakPeriod: c.peakPeriod,
						power: c.power,
						// The half-cycle F test that decides whether tau/2 or 2 tau may be picked.
						eligible: c.eligible,
						testF: c.test ? safeNum(c.test.F) : null,
						testP: c.test ? safeNum(c.test.pValue) : null
					})),
					strongest: hc.strongest.label,
					powerStrongest: hc.powerStrongest?.label ?? null
				}
			: null,
		outputs: ruleOutputValues(block)
	};
}

/**
 * Build the fixture's actogram as the app does (Plot.fromJSON over real Columns) with the
 * display zone set to `zone`, hand it to `read`, and restore the zone afterwards. `read`
 * must read every derived it needs before returning, because startTime reads the zone.
 */
function withActogram(fx, zone, series, inner, read) {
	const prevZone = appState.displayTimezone;
	appState.displayTimezone = zone;
	try {
		const data = series.map((s, i) => {
			const xId = s.xId ?? mkCol(s.xType, s.x, `x${i}`);
			const yId = s.yId ?? mkCol('number', s.y, `y${i}`);
			if (s.xId == null && s.xType === 'bin') {
				const xc = core.data.find((c) => c.id === xId);
				xc.binWidth = s.binWidth;
				if (s.originTime_ms != null) xc.originTime_ms = s.originTime_ms;
			}
			return { ...inner.data[i], x: { refId: xId }, y: { refId: yId }, colour: '#000000' };
		});
		const plot = Plot.fromJSON({
			id: 0,
			name: fx.id,
			type: 'actogram',
			width: 600,
			height: 400,
			plot: { ...inner, data }
		});
		core.plots.push(plot);
		return read(plot.plot);
	} finally {
		appState.displayTimezone = prevZone;
	}
}

// The actogram's "Show/Save data" rows (Actogramclass.getDownloadData), which the Python
// export writes as `<plot>_data.csv`. A `plotCompute` fixture with jsFn
// 'actogramDownloadData' and a `generate.series` list like the actogramMarkers kind.
// With `binned` (BinnedData args: binSize, binStart, stepSize, aggFunc) each series is
// first run through a real BinnedData node and the actogram plots its OUTPUT columns, so
// the bars come from the binned column's own metadata (binWidth, originTime_ms, type).
async function runActogramDownload(fx) {
	const series = generateActogramSeries(fx.generate);
	const zone = fx.zone ?? 'utc';
	const inner = { periodHrs: fx.periodHrs ?? 24, data: series.map(() => ({})) };
	let plotted = series;
	if (fx.binned) {
		const entry = appConsts.tableProcessMap.get('BinnedData');
		plotted = [];
		for (const [i, s] of series.entries()) {
			const xIn = mkCol(s.xType, s.x, `x${i}`);
			const yIn = mkCol('number', s.y, `y${i}`);
			const tp = new TableProcess(
				{ name: 'BinnedData', args: { ...fx.binned, xIN: xIn, yIN: [yIn], out: { binnedx: -1 } } },
				null
			);
			pushObj(tp);
			await entry.func(tp.args);
			plotted.push({ xId: tp.args.out.binnedx, yId: tp.args.out[`binnedy_${yIn}`] });
		}
	}
	return withActogram(fx, zone, plotted, inner, (act) => {
		const { headers, rows } = act.getDownloadData();
		return jsonSafe({
			inputs: { zone, periodHrs: inner.periodHrs, binned: fx.binned ?? null, series },
			outputs: { headers, rows }
		});
	});
}

// The correlogram's "Show/Save data" rows (Correlogramclass.getDownloadData), which the
// Python export writes as `<plot>_data.csv`. A `plotCompute` fixture with jsFn
// 'correlogramDownloadData', a `generate.series` list as the actogram kinds use (a series
// may add `stepPattern` for uneven spacing, and `maxLag` / `minLag`, saved PER SERIES as
// the app saves them) and, optionally, `binned` BinnedData args: each series is then run
// through a real BinnedData node and the correlogram plots its outputs, so the lag step is
// the binned column's own binWidth.
async function runCorrelogramDownload(fx) {
	const series = generateActogramSeries(fx.generate);
	const lagsOf = (i) => ({
		maxLag: fx.generate.series[i].maxLag ?? null,
		minLag: fx.generate.series[i].minLag ?? 0
	});
	const plotted = [];
	for (const [i, s] of series.entries()) {
		const xId = mkCol(s.xType, s.x, `x${i}`);
		const yId = mkCol('number', s.y, `y${i}`);
		if (s.xType === 'bin') {
			const xc = core.data.find((c) => c.id === xId);
			xc.binWidth = s.binWidth;
			if (s.originTime_ms != null) xc.originTime_ms = s.originTime_ms;
		}
		if (!fx.binned) {
			plotted.push({ xId, yId });
			continue;
		}
		const tp = new TableProcess(
			{ name: 'BinnedData', args: { ...fx.binned, xIN: xId, yIN: [yId], out: { binnedx: -1 } } },
			null
		);
		pushObj(tp);
		await appConsts.tableProcessMap.get('BinnedData').func(tp.args);
		plotted.push({ xId: tp.args.out.binnedx, yId: tp.args.out[`binnedy_${yId}`] });
	}
	const plot = Plot.fromJSON({
		id: 0,
		name: fx.id,
		type: 'correlogram',
		width: 600,
		height: 400,
		plot: {
			data: plotted.map((p, i) => ({ x: { refId: p.xId }, y: { refId: p.yId }, ...lagsOf(i) }))
		}
	});
	core.plots.push(plot);
	const { headers, rows } = plot.plot.getDownloadData();
	return jsonSafe({
		inputs: {
			binned: fx.binned ?? null,
			series: series.map((s, i) => ({ ...s, ...lagsOf(i) }))
		},
		outputs: { headers, rows }
	});
}

// The legacy Enright bin-size migration (core/enrightBinMigration.js) and what it does to the
// spectrum. A `sessionMigration` fixture lists Periodogram series (method, binSize,
// binSizeAuto as saved, plus `xStep`, the series' sampling interval in hours) under one
// session `version`. Each series gets `hours` of a 24 h cosine sampled every xStep. The JS
// side migrates the session JSON, builds the plot with Plot.fromJSON as importJson does,
// lets each series follow its x exactly as the plot component's effect does
// (followSamplingInterval over x.hoursSinceStart), and records per series the bin size it
// then computes with and the peak period over [periodlimsIN] at periodSteps.
function runSessionMigration(fx) {
	const hours = fx.hours ?? 168;
	const series = fx.series.map(({ xStep, ...saved }) => {
		const n = Math.round(hours / xStep);
		const x = Array.from({ length: n }, (_, i) => i * xStep);
		const y = x.map((t) => 10 + 5 * Math.cos((2 * Math.PI * (t - 6)) / 24));
		return { saved, x, y };
	});
	const [periodMin, periodMax] = fx.periodlimsIN;
	const session = {
		version: fx.version,
		plots: [
			{
				id: 0,
				name: fx.id,
				type: 'periodogram',
				width: 600,
				height: 400,
				plot: {
					periodlimsIN: fx.periodlimsIN,
					periodSteps: fx.periodSteps,
					data: series.map((s, i) => ({
						...s.saved,
						x: { refId: mkCol('number', s.x, `x${i}`) },
						y: { refId: mkCol('number', s.y, `y${i}`) }
					}))
				}
			}
		]
	};
	const { json, migrated } = migrateLegacyEnrightBins(session);
	const plot = Plot.fromJSON(json.plots[0]);
	core.plots.push(plot);
	const out = plot.plot.data.map((datum, i) => {
		datum.followSamplingInterval(datum.x.hoursSinceStart);
		const res = runPeriodogramCalculation({
			xData: series[i].x,
			yData: series[i].y,
			method: datum.method,
			binSize: datum.binSize,
			periodMin,
			periodMax,
			periodSteps: fx.periodSteps,
			chiSquaredAlpha: datum.chiSquaredAlpha
		});
		return {
			binSizeAuto: datum.binSizeAuto,
			binSize: datum.binSize,
			peakPeriod: res.x[res.y.indexOf(Math.max(...res.y))]
		};
	});
	return jsonSafe({
		inputs: {
			version: fx.version,
			periodlimsIN: fx.periodlimsIN,
			periodSteps: fx.periodSteps,
			series: series.map((s) => ({ saved: s.saved, x: s.x, y: s.y }))
		},
		outputs: { migrated, series: out }
	});
}

function runActogramMarkers(fx) {
	const series = fx.source ? sessionActogramSeries(fx.source) : generateActogramSeries(fx.generate);
	const zone = fx.zone ?? 'utc';
	const extra = fx.series ?? [];
	const inner = {
		periodHrs: fx.periodHrs ?? 24,
		markerRules: fx.markerRules ?? [],
		data: series.map((_, i) => ({
			phaseMarkers: extra[i]?.phaseMarkers ?? [],
			...(extra[i]?.ruleData ? { ruleData: extra[i].ruleData } : {}),
			...(extra[i]?.detachedRules ? { detachedRules: extra[i].detachedRules } : {})
		}))
	};

	return withActogram(fx, zone, series, inner, (act) => {
		const outputs = {
			startTime: act.startTime,
			Ndays: act.Ndays,
			series: act.data.map((d) => {
				const rules = {};
				for (const r of act.markerRules) {
					const inst = d.ruleInstances.find((b) => b.ruleId === r.id);
					const det = inst ? null : d.phaseMarkers.find((m) => m.fromRule === r.id);
					rules[r.id] = blockRecord(
						inst ?? det ?? null,
						inst ? 'instance' : det ? 'detached' : 'none'
					);
				}
				return { binSize: d.binSize, rules };
			})
		};
		// A bin series is recorded as the ports' frame reads it: x as the column's getData
		// (bin CENTRES), plus the raw first bin start and the origin the row offset uses.
		const recorded = series.map((s, i) => {
			if (s.xType !== 'bin') return s;
			const xc = act.data[i].x;
			return {
				xType: 'bin',
				x: [...xc.getData()],
				y: s.y,
				rawBinStart0: core.rawData.get(xc.data)?.[0] ?? 0,
				originTime_ms: xc.originTime_ms ?? null
			};
		});
		return jsonSafe({ inputs: { zone, inner, series: recorded }, outputs });
	});
}

describe.runIf(process.env.GEN_PARITY)('emit JS parity results', () => {
	it('runs every fixture through the JS engine', async () => {
		appConsts.processMap = await loadProcesses();
		appConsts.plotMap = await loadPlots();
		appConsts.tableProcessMap = await loadTableProcesses();
		setWorkerFactory(() => new ThrowOnPost());

		const { fixtures } = JSON.parse(readFileSync(join(PARITY_DIR, 'fixtures.json'), 'utf8'));
		const results = {};
		for (const fx of fixtures) {
			resetCore();
			if (fx.kind === 'columnProcess') results[fx.id] = runColumnProcess(fx);
			else if (fx.kind === 'tableProcessResult') results[fx.id] = await runTableProcessResult(fx);
			else if (fx.kind === 'plotCompute') results[fx.id] = await runPlotCompute(fx);
			else if (fx.kind === 'pureUtil') results[fx.id] = runPureUtil(fx);
			else if (fx.kind === 'timeColumn') results[fx.id] = runTimeColumn(fx);
			else if (fx.kind === 'actogramMarkers') results[fx.id] = runActogramMarkers(fx);
			else if (fx.kind === 'sessionMigration') results[fx.id] = runSessionMigration(fx);
			else results[fx.id] = await runTableProcess(fx);
		}
		// The FormulaColumn injection fixture's payload sets window.__pwned if it ever runs
		// (SEC-1). Refuse to write results that were produced by an engine that executed it.
		if (globalThis.__pwned !== undefined)
			throw new Error('a FormulaColumn payload executed during the parity run (SEC-1)');

		mkdirSync(PARITY_DIR, { recursive: true });
		// JSON has no Infinity, and JSON.stringify writes it as null, the same as NaN. That made
		// an infinite result (a one-sided odds-ratio interval's open end) indistinguishable from
		// an undefined one. Write the two infinities as strings; both legs decode them on load.
		const withInf = (_k, v) => (v === Infinity ? 'Infinity' : v === -Infinity ? '-Infinity' : v);
		writeFileSync(join(PARITY_DIR, 'js_results.json'), JSON.stringify(results, withInf, 2), 'utf8');
		console.log(`PARITY: wrote js_results.json (${Object.keys(results).length} fixtures)`);
		// Generous timeout: this runs EVERY fixture through the real engine, including the
		// multi-start nonlinear fits, and it grows with the fixture set. It had no explicit
		// timeout and inherited vitest's 5s default, which the suite quietly outgrew — the
		// emitter then failed and left js_results.json stale, so the Python and R legs were
		// comparing against yesterday's numbers rather than reporting a problem.
	}, 300_000);
});
