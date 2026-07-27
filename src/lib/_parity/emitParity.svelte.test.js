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
import { core, appConsts, pushObj } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { TableProcess } from '$lib/core/TableProcess.svelte';
import { loadProcesses } from '$lib/processes/processMap.js';
import { loadPlots } from '$lib/plots/plotMap.js';
import { loadTableProcesses } from '$lib/tableProcesses/tableProcessMap.js';
import { setWorkerFactory } from '$lib/workers/workerPool.js';
import { computeFFT } from '$lib/utils/fft.js';
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
import { crossCorrelation } from '$lib/utils/crossCorrelation.js';
import { chiSquareGoodnessOfFit, chiSquareIndependence } from '$lib/utils/chisquare.js';
import { logisticRegression } from '$lib/utils/logistic.js';
import { pAdjust } from '$lib/utils/pAdjust.js';
import { fisherExact, conditionalOddsRatio, oddsRatioCI } from '$lib/utils/fisherExact.js';
import { cwt } from '$lib/utils/cwt.js';
import { getStatKeys, computeMovingWindows } from '$lib/utils/movinganalysis.js';

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
	crossCorrelation: crossCorrelationAdapter,
	chiSquareGoodnessOfFit,
	chiSquareIndependence,
	logisticRegression: logisticRegressionAdapter,
	pAdjust: pAdjustAdapter,
	cwtPeakScaleIndex: cwtPeakScaleIndexAdapter,
	movingWindows: movingWindowsAdapter,
	fisherExact,
	fisherConditionalOR: (table, confidence) => {
		const ci = oddsRatioCI(table, confidence);
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
	const tt = t.map(Number);
	const lo = Math.min(...tt);
	const hi = Math.max(...tt);
	const starts = [];
	for (let s = lo; s <= hi - windowSize + 1e-9; s += step) starts.push(s);

	const statKeys = getStatKeys(opts);
	const per = computeMovingWindows({
		tAll: tt,
		ys: [y.map(Number)],
		starts,
		windowSize,
		statKeys,
		args: opts
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
		const { n, period, amp, mesor = 0, phase = 0, noise = 0, refs } = spec;
		const t = seq(n, (i) => i);
		const y = t.map(
			(h) =>
				mesor +
				amp * Math.cos((2 * Math.PI * (h - phase)) / period) +
				(noise ? normal(rng, 0, noise) : 0)
		);
		return { [refs.x]: { type: 'number', values: t }, [refs.y]: { type: 'number', values: y } };
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

function safeArray(arr) {
	return (arr ?? []).map((v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v));
}
function safeNum(v) {
	return typeof v === 'number' && !Number.isFinite(v) ? null : v;
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
	const tp = new TableProcess({ name: fx.jsName, args }, null);
	pushObj(tp);
	await entry.func(tp.args);

	const want = new Set(fx.compareOutputs ?? []);
	const outputs = {};
	for (const [key, id] of Object.entries(tp.args.out ?? {})) {
		if (typeof id !== 'number' || id < 0) continue;
		const canon = canonicalKey(key);
		if (!want.has(canon)) continue;
		outputs[canon] = safeArray(core.data.find((c) => c.id === id)?.getData?.());
	}
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
			else if (fx.kind === 'plotCompute') results[fx.id] = runPlotCompute(fx);
			else if (fx.kind === 'pureUtil') results[fx.id] = runPureUtil(fx);
			else results[fx.id] = await runTableProcess(fx);
		}

		mkdirSync(PARITY_DIR, { recursive: true });
		writeFileSync(join(PARITY_DIR, 'js_results.json'), JSON.stringify(results, null, 2), 'utf8');
		// eslint-disable-next-line no-console
		console.log(`PARITY: wrote js_results.json (${Object.keys(results).length} fixtures)`);
	});
});
