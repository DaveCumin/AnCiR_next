// @ts-nocheck
// Fit waveform model, cosinor model with a free period and N cosine curves: it reported curve
// 1 only (the stats table listed every curve). Each further curve c now has `period_c<c>`,
// `amplitude_c<c>` and `acrophase_c<c>` metric ports, named like the Cosinor node's, while
// curve 1 keeps `period` / `amplitude` / `acrophase` and their column ids. Switching to a fixed
// period (or another model) removes the curve ports; one undo brings them back with their ids,
// numbers and wires.
//
// The real app: the shipped Fit waveform model demo loaded through importJson, the real
// components mounted, the live parameter watcher and the real op history. Nothing mocked.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts, appState } from '$lib/core/core.svelte.js';
import { getColumnById } from '$lib/core/Column.svelte';
import { _resetComputeOwners } from '$lib/core/computeOwners.svelte.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';
import { history } from '$lib/core/opHistory.svelte.js';
import { paramDiffWatcher } from '$lib/core/paramDiffWatcher.svelte.js';
import { mutationService } from '$lib/core/mutationService.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';
import { setWorkerFactory } from '$lib/workers/workerPool.js';
import AppViews from '$lib/components/views/__fixtures__/AppViews.svelte';
import { readNodeResultTable } from '$lib/core/nodeResultTables.svelte.js';
import { outputLabel } from '$lib/core/outputLabels.js';
import { outputDescription } from '$lib/core/portDescriptions.js';
import { fitCurveOutKeys, getFitMetricKeys, fitMetricValue } from './FitFunction.svelte';

class ThrowOnPost {
	postMessage() {
		throw new Error('synchronous compute in tests');
	}
	terminate() {}
}

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
	setWorkerFactory(() => new ThrowOnPost());
	history.init();
});
afterEach(() => {
	cleanup();
	paramDiffWatcher._disposeForTests();
	_resetComputeOwners();
	appState.canvasSelectedNodeId = null;
	history.clear();
});

async function settle(rounds = 8) {
	for (let i = 0; i < rounds; i++) {
		flushSync();
		await tick();
		await new Promise((r) => setTimeout(r, 20));
	}
	flushSync();
}
async function until(ok, ms = 8000) {
	const t0 = Date.now();
	while (!ok() && Date.now() - t0 < ms) await settle(1);
	await settle(2);
}

const CURVE_2 = ['period_c2', 'amplitude_c2', 'acrophase_c2'];
const CURVE_3 = ['period_c3', 'amplitude_c3', 'acrophase_c3'];

/**
 * The shipped Fit waveform model demo with a plain number x (one week, hourly) and a y made of
 * a 24 h rhythm (amplitude 12, peak at 7) plus an 8.5 h one (amplitude 5, peak at 2), fitted
 * by the cosinor model with a free period and two cosine curves.
 */
function twoCurveSession() {
	const json = JSON.parse(
		readFileSync(join(process.cwd(), 'static/sessions/demos/demo-tp-fitfunction.json'), 'utf8')
	);
	const tp = json.tableProcesses.find((t) => t.name === 'FitFunction');
	json.tableProcesses = json.tableProcesses.filter((t) => t.name !== 'SequenceColumn');
	const t = Array.from({ length: 168 }, (_, i) => i);
	json.rawData[String(tp.args.xIN)] = t;
	json.rawData[String(tp.args.yIN[0])] = t.map(
		(h) =>
			50 +
			12 * Math.cos((2 * Math.PI * (h - 7)) / 24) +
			5 * Math.cos((2 * Math.PI * (h - 2)) / 8.5) +
			0.3 * Math.sin(h * 1.7)
	);
	Object.assign(
		json.data.find((c) => c.id === tp.args.xIN),
		{ name: 'hours', type: 'number', tableProcessGUId: '' }
	);
	Object.assign(tp.args, {
		model: 'cosinor',
		useFixedPeriod: false,
		Ncurves: 2,
		minPeriod: 4,
		maxPeriod: 30
	});
	return json;
}

const fitTp = () => core.tableProcesses.find((t) => t.name === 'FitFunction');
const value = (tp, key) => getColumnById(tp.args.out[key])?.getData()?.[0];
const hasColumn = (id) => core.data.some((c) => c.id === id);

describe('fitCurveOutKeys', () => {
	it('lists curves 2..Ncurves of a free cosinor, curve by curve, and nothing else', () => {
		const free = { model: 'cosinor', useFixedPeriod: false };
		expect(fitCurveOutKeys({ ...free, Ncurves: 1 })).toEqual([]);
		expect(fitCurveOutKeys({ ...free, Ncurves: 3 })).toEqual([...CURVE_2, ...CURVE_3]);
		expect(fitCurveOutKeys({ ...free, Ncurves: '' })).toEqual([]);
		// A fixed period (this node's default) has harmonics, not curves; the other models
		// have no cosine curves at all.
		expect(fitCurveOutKeys({ model: 'cosinor', Ncurves: 3 })).toEqual([]);
		expect(fitCurveOutKeys({ ...free, model: 'rectangular', Ncurves: 3 })).toEqual([]);
		expect(getFitMetricKeys({ ...free, Ncurves: 2 })).toEqual(
			expect.arrayContaining([...CURVE_2, 'period', 'amplitude', 'acrophase'])
		);
	});

	it('gives NaN for a curve the fit does not have, and for a fixed fit', () => {
		const fr = {
			mode: 'free',
			parameters: {
				O: 5,
				cosines: [{ amplitude: 2, frequency: (2 * Math.PI) / 24, phase: -Math.PI / 2 }]
			}
		};
		for (const k of CURVE_2) expect(fitMetricValue(k, 'cosinor', fr, undefined)).toBeNaN();
		expect(fitMetricValue('period', 'cosinor', fr, undefined)).toBeCloseTo(24, 12);
		const fixed = { mode: 'fixed', parameters: { period: 24, cosines: fr.parameters.cosines } };
		expect(fitMetricValue('period_c1', 'cosinor', fixed, undefined)).toBeNaN();
	});
});

describe('Fit waveform model with several free cosine curves', () => {
	it('puts every curve after the first on its own ports, matching the stats table', async () => {
		render(AppViews);
		await settle(2);
		await importJson(twoCurveSession());
		await settle();
		const tp = fitTp();
		const curve1Ids = Object.fromEntries(
			['period', 'amplitude', 'acrophase'].map((k) => [k, tp.args.out[k]])
		);
		await until(() => Number.isFinite(value(tp, 'period_c2')));

		for (const [k, id] of Object.entries(curve1Ids)) expect(tp.args.out[k]).toBe(id);
		for (const k of CURVE_2) expect(hasColumn(tp.args.out[k])).toBe(true);
		const periods = [value(tp, 'period'), value(tp, 'period_c2')].sort((a, b) => a - b);
		expect(periods[0]).toBeCloseTo(8.5, 1);
		expect(periods[1]).toBeCloseTo(24, 1);

		const per2 = value(tp, 'period_c2');
		const amp2 = value(tp, 'amplitude_c2');
		const acro2 = value(tp, 'acrophase_c2');
		const stats = readNodeResultTable(`tableprocess_${tp.id}`, 'stats');
		const cell = (h) => stats.rows[0][stats.headers.indexOf(h)];
		expect(cell('C2_period')).toBe(per2);
		expect(cell('C2_amplitude')).toBe(amp2);
		expect(cell('C2_acrophase_peak_h')).toBe(acro2);
		expect(acro2).toBeCloseTo(per2 > 20 ? 7 : 2, 0);
		expect(amp2).toBeCloseTo(per2 > 20 ? 12 : 5, 0);

		const ctx = { args: tp.args, colType: (id) => getColumnById(id)?.type ?? null };
		expect(outputLabel('FitFunction', 'amplitude_c2', ctx)).toBe('C2 amplitude');
		expect(outputLabel('FitFunction', 'period_c2', ctx)).toBe('C2 period (x units)');
		expect(outputLabel('FitFunction', 'acrophase_c2', ctx)).toBe('C2 acrophase (x units)');
		expect(outputDescription('FitFunction', 'acrophase_c2', ctx)).toMatch(/cosine curve 2/);
	});

	it('adds and removes curve ports as Ncurves, the mode and the model change', async () => {
		render(AppViews);
		await settle(2);
		await importJson(twoCurveSession());
		await settle();
		const tp = fitTp();
		await until(() => Number.isFinite(value(tp, 'period_c2')));
		const c2Ids = CURVE_2.map((k) => tp.args.out[k]);

		tp.args.Ncurves = 3;
		await until(() => Number.isFinite(value(tp, 'period_c3')));
		for (const k of CURVE_3) expect(hasColumn(tp.args.out[k])).toBe(true);
		expect(CURVE_2.map((k) => tp.args.out[k])).toEqual(c2Ids);

		// A cleared field on the way to a new number keeps the ports.
		tp.args.Ncurves = '';
		await settle();
		for (const k of [...CURVE_2, ...CURVE_3]) expect(tp.args.out[k]).toBeGreaterThanOrEqual(0);

		tp.args.Ncurves = 1;
		await until(() => !(CURVE_2[0] in tp.args.out));
		for (const k of [...CURVE_2, ...CURVE_3]) expect(k in tp.args.out).toBe(false);
		for (const id of c2Ids) expect(hasColumn(id)).toBe(false);

		tp.args.Ncurves = 2;
		await until(() => Number.isFinite(value(tp, 'period_c2')));
		tp.args.model = 'rectangular';
		await until(() => !(CURVE_2[0] in tp.args.out));
		tp.args.model = 'cosinor';
		await until(() => Number.isFinite(value(tp, 'period_c2')));
		// A fixed period has no curves, and gets its rmse_n port back.
		tp.args.useFixedPeriod = true;
		await until(() => !(CURVE_2[0] in tp.args.out));
		expect(hasColumn(tp.args.out.rmse_n)).toBe(true);
	});

	it('one undo of the switch to a fixed period restores the ports, ids, numbers and wires', async () => {
		render(AppViews);
		await settle(2);
		await importJson(twoCurveSession());
		await settle();
		const tp = fitTp();
		await until(() => Number.isFinite(value(tp, 'amplitude_c2')));
		const ampId = tp.args.out.amplitude_c2;
		const consumer = mutationService.addFreeTableProcess('DescribeData', { yIN: [ampId] });
		await settle();
		const ids = Object.fromEntries(CURVE_2.map((k) => [k, tp.args.out[k]]));
		const numbers = Object.fromEntries(CURVE_2.map((k) => [k, value(tp, k)]));

		paramDiffWatcher.init();
		history.clear();
		// The checkbox's bind writes the arg; the live watcher records it.
		tp.args.useFixedPeriod = true;
		await until(() => !(CURVE_2[0] in tp.args.out));
		await settle();
		for (const k of CURVE_2) expect(hasColumn(ids[k])).toBe(false);
		expect(consumer.args.yIN).toEqual([]);
		expect(history.undoCount).toBe(1);

		history.undo();
		await settle();
		expect(tp.args.useFixedPeriod).toBe(false);
		for (const k of CURVE_2) expect(tp.args.out[k]).toBe(ids[k]);
		await until(() => Number.isFinite(value(tp, 'amplitude_c2')));
		for (const k of CURVE_2) expect(value(tp, k)).toBeCloseTo(numbers[k], 9);
		expect(consumer.args.yIN).toEqual([ampId]);
		expect(history.redoCount).toBe(1);

		history.redo();
		await settle();
		for (const k of CURVE_2) expect(hasColumn(ids[k])).toBe(false);
		expect(consumer.args.yIN).toEqual([]);
	});
});
