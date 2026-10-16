// @ts-nocheck
// Every node and plot that consults the worker gate gives the same outputs on both sides
// of it, on the kind of record that crosses it.
//
// workerGate.js sends a computation to a worker only at 500+ valid points (or 32+ unit
// analyses). So the worker path is the one users meet on real recordings and tests with
// small fixtures never see: v82.10's lossy worker transport broke Cosinor, Smooth Data,
// Fit waveform model, Double Logistic and Moving Analysis on four imported days while
// one day was fine. workerRoundTrip.test.js covers the tasks; this file covers the
// CALLERS: the real node runs once with the gate forced shut (main thread) and once
// forced open, with tasks going through the real compute.worker.js handler and the real
// encode / structured clone / decode (src/test/loopbackWorker.js). Every output column
// must match, and must hold data (equal-but-empty on both sides is how Double Logistic's
// residual column hid; see the residual test below).
//
// A guard at the end fails when a source file starts calling shouldUseWorkers without a
// case here.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { TableProcess } from '$lib/core/TableProcess.svelte';
import { buildTableProcessDefaults } from '$lib/core/tpDefaults.js';
import { _setGateOverride } from '$lib/workers/workerGate.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';
import {
	installLoopbackWorkers,
	uninstallLoopbackWorkers,
	loopbackTaskCount
} from '$test/loopbackWorker.js';
import { Periodogramclass } from '$lib/plots/Periodogram/Periodogram.svelte';

// Every file under src/lib that calls the gate, found by its source rather than a list.
const GATED_SOURCES = import.meta.glob(
	['/src/lib/**/*.svelte', '/src/lib/**/*.js', '!/src/lib/**/*.test.js', '!**/*conflicted*'],
	{ query: '?raw', import: 'default', eager: true }
);

// The shape of the user files that crossed the gate (ESF activity, four days, 10 min 40 s
// sampling): epoch-ms times with jitter and one dropped sample (uneven spacing), a run
// of blank values at the start (a sensor that starts late) and single blanks, and an
// occupancy-like series with a daily rhythm. 580 rows, 541 valid pairs.
const N = 580;
const T0 = 1774310656000;
const STEP_MS = 640_000;
function esfLike() {
	const times = [];
	let t = T0;
	for (let i = 0; i < N; i++) {
		times.push(t);
		t += STEP_MS + ((i * 7919) % 5) * 1000; // 0..4 s of jitter
		if (i === 300) t += STEP_MS; // one dropped sample
	}
	const y = times.map((ms, i) => {
		if (i < 9) return null; // leading blank run
		if (i % 37 === 5) return null; // single blanks
		if (i >= 200 && i < 220) return null; // a mid-record run
		const h = (ms - T0) / 3_600_000;
		return 0.35 + 0.25 * Math.cos((2 * Math.PI * (h - 14)) / 24) + 0.04 * Math.sin(i * 1.37);
	});
	const y2 = y.map((v, i) => (v == null || i % 23 === 0 ? null : 2 * v + 0.1 * Math.cos(i)));
	return { times, y, y2 };
}

function mkCol(values, type = 'number', name = 'c') {
	const c = new Column({ type, data: -1 });
	core.rawData.set(c.id, values);
	c.data = c.id;
	c.name = name;
	if (type === 'time') c.timeFormat = [];
	core.data.push(c);
	return c;
}

function resetCore() {
	core.data = [];
	core.tableProcesses = [];
	core.rawData = new Map();
}

/**
 * Every wired output of the node as plain arrays, keyed by out-key with each input
 * column id replaced by its position ('fity_151' -> 'fity_y0'), so two runs compare.
 */
function outputsOf(tp) {
	const res = {};
	const yIN = tp.args.yIN ?? [];
	for (const [key, id] of Object.entries(tp.args.out ?? {})) {
		if (typeof id !== 'number' || id < 0) continue;
		const d = core.rawData.get(id);
		const m = key.match(/^(.*_)(\d+)$/);
		const i = m ? yIN.indexOf(Number(m[2])) : -1;
		res[i >= 0 ? `${m[1]}y${i}` : key] = d == null ? null : Array.from(d);
	}
	return res;
}

/**
 * The residual output a mounted node adds on its own (useMultiYTP 'resid_'), seeded so
 * the headless constructor materialises it too. (Other per-input placeholders, such as
 * permstats_ or coef_, are written only by the panel or when an option is on.)
 */
function seedResidualOutputs(entry, args) {
	const outs = entry.definition?.nodeSpec?.outputs ?? [];
	if (!outs.some((o) => o.dynamicPrefix === 'resid_')) return;
	for (const yId of args.yIN) {
		if (!(`resid_${yId}` in args.out)) args.out[`resid_${yId}`] = -1;
	}
}

/** Build, run and read one node with the gate forced to `gate` ('off' | 'on'). */
async function runNode(name, params, gate, { twoSeries = false } = {}) {
	resetCore();
	_setGateOverride(gate);
	const { times, y, y2 } = esfLike();
	const x = mkCol(times, 'time', 'datetime_utc');
	const ya = mkCol(y, 'number', 'occupancy');
	const yIN = [ya.id];
	if (twoSeries) yIN.push(mkCol(y2, 'number', 'occupancy2').id);
	const entry = appConsts.tableProcessMap.get(name);
	const args = { ...buildTableProcessDefaults(entry, {}), ...params, xIN: x.id, yIN };
	seedResidualOutputs(entry, args);
	const before = loopbackTaskCount();
	const tp = new TableProcess({ name, args }, null);
	core.tableProcesses.push(tp);
	await tp.doProcess();
	// The constructor starts a compute of its own; let any worker reply land.
	await new Promise((r) => setTimeout(r, 20));
	return { tp, outputs: outputsOf(tp), tasks: loopbackTaskCount() - before, x, yIN, y };
}

/**
 * The both-sides-of-the-gate check: same outputs below and above, the above run really
 * used the worker, and every output column has data.
 */
async function expectSameAcrossGate(name, params, opts = {}) {
	const below = await runNode(name, params, 'off', opts);
	const above = await runNode(name, params, 'on', opts);
	expect(below.tasks, 'the gate-shut run must not use a worker').toBe(0);
	expect(above.tasks, 'the gate-open run must go through the worker').toBeGreaterThan(0);
	const keys = Object.keys(below.outputs).sort();
	expect(keys.length).toBeGreaterThan(0);
	expect(Object.keys(above.outputs).sort()).toEqual(keys);
	for (const k of keys) {
		expect(below.outputs[k], `output "${k}" is empty`).not.toBeNull();
		expect(below.outputs[k].length, `output "${k}" is empty`).toBeGreaterThan(0);
		expect(above.outputs[k], `output "${k}" differs above the gate`).toEqual(below.outputs[k]);
	}
	return { below, above };
}

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
	await installLoopbackWorkers();
});
afterAll(() => {
	uninstallLoopbackWorkers();
	_setGateOverride(null);
});
beforeEach(() => resetCore());
afterEach(() => _setGateOverride(null));

// Names here are matched against GATED_SOURCES by the guard below.
const CASES = [
	['Cosinor', 'fixed period', { useFixedPeriod: true, fixedPeriod: 24, Ncurves: 1 }],
	['Cosinor', 'free period', { useFixedPeriod: false, minPeriod: 18, maxPeriod: 30, Ncurves: 1 }],
	['TrendFit', 'linear', { model: 'linear' }],
	['DoubleLogistic', 'fixed period', { fixPeriod: true, fixedPeriod: 24 }],
	['SmoothedData', 'Whittaker', {}],
	['SmoothedData', 'moving average', { smootherType: 'moving', movingAvgWindowSize: 5 }],
	['FitFunction', 'cosinor model', { model: 'cosinor', useFixedPeriod: true, fixedPeriod: 24 }],
	['RhythmicityAnalysis', 'Lomb-Scargle', { analysis: 'periodogram' }],
	[
		'MovingAnalysis',
		'periodogram windows',
		{ windowSize: 24, stepSize: 6, analysis: 'periodogram' }
	]
];

describe('worker gate: nodes give the same outputs below and above it', () => {
	it('the record crosses the 500-point gate', () => {
		const { times, y } = esfLike();
		const valid = y.filter((v, i) => v != null && times[i] != null).length;
		expect(valid).toBeGreaterThanOrEqual(500);
	});

	for (const [name, label, params] of CASES) {
		it(`${name} (${label})`, { timeout: 120_000 }, async () => {
			await expectSameAcrossGate(name, params, { twoSeries: true });
		});
	}
});

describe('fit residual columns hold observed minus fitted on both sides of the gate', () => {
	// Double Logistic's resid_<y> column stayed EMPTY at every size: it looked the input
	// column up by the string key of its results map, found nothing, and wrote observed
	// minus fitted over an empty observed series.
	const FITS = [
		['DoubleLogistic', { fixPeriod: true, fixedPeriod: 24 }],
		['Cosinor', { useFixedPeriod: true, fixedPeriod: 24, Ncurves: 1 }],
		['TrendFit', { model: 'linear' }],
		['FitFunction', { model: 'cosinor', useFixedPeriod: true, fixedPeriod: 24 }],
		['RectangularWave', {}]
	];
	for (const [name, params] of FITS) {
		for (const gate of ['off', 'on']) {
			it(`${name}, gate ${gate}`, { timeout: 120_000 }, async () => {
				const { tp, y } = await runNode(name, params, gate);
				const yId = tp.args.yIN[0];
				const residId = tp.args.out['resid_' + yId];
				expect(residId, 'no residual output').toBeGreaterThanOrEqual(0);
				const resid = Array.from(core.rawData.get(residId) ?? []);
				expect(resid).toHaveLength(y.length);
				// Missing observations stay missing; every observed value has a residual.
				y.forEach((v, i) => {
					if (v == null) expect(Number.isFinite(resid[i])).toBe(false);
					else expect(Number.isFinite(resid[i]), `row ${i}`).toBe(true);
				});
				// A least-squares fit with an offset is never worse than the mean, and a
				// rhythm model on a rhythm is far better.
				const obs = y.filter((v) => v != null);
				const mean = obs.reduce((a, b) => a + b, 0) / obs.length;
				const sd = Math.sqrt(obs.reduce((a, b) => a + (b - mean) ** 2, 0) / obs.length);
				const finite = resid.filter(Number.isFinite);
				const rms = Math.sqrt(finite.reduce((a, r) => a + r * r, 0) / finite.length);
				expect(rms).toBeLessThanOrEqual(sd * (name === 'TrendFit' ? 1 : 0.5));
			});
		}
	}
});

describe('worker gate: the Periodogram plot gives the same spectrum below and above it', () => {
	async function spectrum(gate) {
		_setGateOverride(gate);
		const { times, y } = esfLike();
		const valid = times.map((_, i) => i).filter((i) => y[i] != null);
		const xData = valid.map((i) => (times[i] - T0) / 3_600_000);
		const yData = valid.map((i) => y[i]);
		const plot = new Periodogramclass({ width: 500, height: 250, id: 1 }, null);
		plot.addData({ x: { refId: 0 }, y: { refId: 1 } });
		const datum = plot.data[0];
		const before = loopbackTaskCount();
		datum.startCalculation({
			xData,
			yData,
			binSize: 0.25,
			method: 'Lomb-Scargle',
			chiSquaredAlpha: 0.05,
			periodMin: 16,
			periodMax: 32,
			periodSteps: 0.25
		});
		for (let i = 0; i < 200 && datum.calculating; i++) await new Promise((r) => setTimeout(r, 5));
		expect(datum.calculating).toBe(false);
		expect(datum.calcError).toBeNull();
		return {
			data: Object.fromEntries(
				Object.entries(datum.periodData ?? {}).map(([k, v]) => [k, Array.from(v ?? [])])
			),
			tasks: loopbackTaskCount() - before
		};
	}

	it('Lomb-Scargle, 541 points', async () => {
		const below = await spectrum('off');
		const above = await spectrum('on');
		expect(below.tasks).toBe(0);
		expect(above.tasks).toBeGreaterThan(0);
		expect(below.data.y.length).toBeGreaterThan(0);
		expect(above.data).toEqual(below.data);
	});
});

describe('worker gate coverage guard', () => {
	it('every source that calls shouldUseWorkers has a both-sides case here', () => {
		const tested = new Set([...CASES.map(([name]) => name), 'Periodogram']);
		const callers = Object.entries(GATED_SOURCES)
			.filter(([path, src]) => !path.endsWith('workerGate.js') && /shouldUseWorkers\s*\(/.test(src))
			.map(([path]) =>
				path
					.split('/')
					.pop()
					.replace(/\.(svelte|js)$/, '')
			);
		expect(callers.length).toBeGreaterThan(0);
		const missing = callers.filter((c) => !tested.has(c));
		expect(
			missing,
			`${missing.join(', ')} call(s) the worker gate with no both-sides case in ` +
				'src/lib/workers/workerGate.nodes.svelte.test.js. Add one to CASES.'
		).toEqual([]);
	});
});
