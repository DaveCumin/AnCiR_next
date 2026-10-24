// @ts-nocheck
// A free-period Cosinor with more than one cosine curve reported curve 1 only: the panel and
// the stats table listed every curve, but only curve 1 had ports, so curves 2..N could not be
// wired anywhere. Each further curve c now has `period_c<c>`, `amplitude_c<c>`,
// `acrophase_c<c>` and `bathyphase_c<c>` metric ports (named like the harmonic ports,
// `amplitude_h1`), while curve 1 keeps its original ports and column ids, so saved sessions
// and their wires do not move.
//
// The real app: the shipped Cosinor demo loaded through importJson, the real components
// mounted, nothing mocked.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts, appState } from '$lib/core/core.svelte.js';
import { getColumnById } from '$lib/core/Column.svelte';
import { _resetComputeOwners } from '$lib/core/computeOwners.svelte.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';
import { outputLabel } from '$lib/core/outputLabels.js';
import { outputDescription } from '$lib/core/portDescriptions.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';
import { setWorkerFactory } from '$lib/workers/workerPool.js';
import AppViews from '$lib/components/views/__fixtures__/AppViews.svelte';
import { readNodeResultTable } from '$lib/core/nodeResultTables.svelte.js';
import { cosinorCurveOutKeys, cosinorMetrics } from './Cosinor.svelte';

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
});
afterEach(() => {
	cleanup();
	_resetComputeOwners();
	appState.canvasSelectedNodeId = null;
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

const CURVE_2 = ['period_c2', 'amplitude_c2', 'acrophase_c2', 'bathyphase_c2'];
const CURVE_3 = ['period_c3', 'amplitude_c3', 'acrophase_c3', 'bathyphase_c3'];

/**
 * The shipped Cosinor demo with a plain number x (one week, hourly) and a y made of a 24 h
 * rhythm (amplitude 12, peak at 7 h) plus an 8.5 h one (amplitude 5, peak at 2 h), fitted
 * with a free period and two cosine curves. The Sequence Column that made x is dropped.
 */
function twoCurveSession() {
	const json = JSON.parse(
		readFileSync(join(process.cwd(), 'static/sessions/demos/demo-tp-cosinor.json'), 'utf8')
	);
	const tp = json.tableProcesses.find((t) => t.name === 'Cosinor');
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
	Object.assign(tp.args, { useFixedPeriod: false, Ncurves: 2, minPeriod: 4, maxPeriod: 30 });
	return json;
}

const cosinorTp = () => core.tableProcesses.find((t) => t.name === 'Cosinor');
const value = (tp, key) => getColumnById(tp.args.out[key])?.getData()?.[0];
const hasColumn = (id) => core.data.some((c) => c.id === id);

describe('cosinorCurveOutKeys', () => {
	it('lists curves 2..Ncurves of a free fit, curve by curve, and nothing else', () => {
		expect(cosinorCurveOutKeys({ useFixedPeriod: false, Ncurves: 1 })).toEqual([]);
		expect(cosinorCurveOutKeys({ useFixedPeriod: false, Ncurves: 3 })).toEqual([
			...CURVE_2,
			...CURVE_3
		]);
		// A fixed period has harmonics, not curves.
		expect(cosinorCurveOutKeys({ useFixedPeriod: true, Ncurves: 3 })).toEqual([]);
		expect(cosinorCurveOutKeys({ useFixedPeriod: false, Ncurves: '' })).toEqual([]);
	});

	it('gives NaN for a curve the fit does not have', () => {
		const yr = {
			fittedData: {
				rSquared: 0.9,
				parameters: {
					O: 5,
					cosines: [{ amplitude: 2, frequency: (2 * Math.PI) / 24, phase: -Math.PI / 2 }]
				}
			}
		};
		const m = cosinorMetrics(yr, { useFixedPeriod: false, Ncurves: 2 }, undefined);
		for (const k of CURVE_2) expect(m[k]).toBeNaN();
		expect(m.period).toBeCloseTo(24, 12);
	});
});

describe('Cosinor with several free cosine curves', () => {
	it('puts every curve after the first on its own ports, matching the stats table', async () => {
		render(AppViews);
		await settle(2);
		await importJson(twoCurveSession());
		await settle();
		const tp = cosinorTp();
		const curve1Ids = Object.fromEntries(
			['period', 'amplitude', 'acrophase', 'bathyphase'].map((k) => [k, tp.args.out[k]])
		);
		await until(() => Number.isFinite(value(tp, 'period_c2')));

		// Curve 1 stays on its original ports and columns (the saved ids).
		for (const [k, id] of Object.entries(curve1Ids)) expect(tp.args.out[k]).toBe(id);
		// Curve 2's ports exist, and the curves are the two rhythms in the data.
		for (const k of CURVE_2) expect(hasColumn(tp.args.out[k])).toBe(true);
		const periods = [value(tp, 'period'), value(tp, 'period_c2')].sort((a, b) => a - b);
		expect(periods[0]).toBeCloseTo(8.5, 1);
		expect(periods[1]).toBeCloseTo(24, 1);

		// The ports carry the numbers the node's own stats table prints for curve 2.
		const amp2 = value(tp, 'amplitude_c2');
		const per2 = value(tp, 'period_c2');
		const acro2 = value(tp, 'acrophase_c2');
		const bathy2 = value(tp, 'bathyphase_c2');
		const stats = readNodeResultTable(`tableprocess_${tp.id}`, 'stats');
		const cell = (h) => stats.rows[0][stats.headers.indexOf(h)];
		expect(cell('curve2_period')).toBe(per2);
		expect(cell('curve2_amplitude')).toBe(amp2);
		expect(cell('curve2_acrophase_peak_h')).toBe(acro2);
		expect(bathy2).toBeCloseTo((acro2 + per2 / 2) % per2, 9);
		// And they are the rhythm in the data that curve 2 found.
		expect(acro2).toBeCloseTo(per2 > 20 ? 7 : 2, 0);
		expect(amp2).toBeCloseTo(per2 > 20 ? 12 : 5, 0);

		// Labels and port descriptions name the curve.
		const ctx = { args: tp.args, colType: (id) => getColumnById(id)?.type ?? null };
		expect(outputLabel('Cosinor', 'amplitude_c2', ctx)).toBe('C2 amplitude');
		expect(outputLabel('Cosinor', 'period_c2', ctx)).toBe('C2 period (x units)');
		expect(outputLabel('Cosinor', 'acrophase_c2', ctx)).toBe('C2 acrophase (x units)');
		expect(outputDescription('Cosinor', 'bathyphase_c2', ctx)).toMatch(/cosine curve 2/);
	});

	it('adds and removes curve ports as Ncurves and the mode change', async () => {
		render(AppViews);
		await settle(2);
		await importJson(twoCurveSession());
		await settle();
		const tp = cosinorTp();
		await until(() => Number.isFinite(value(tp, 'period_c2')));
		const c2Ids = CURVE_2.map((k) => tp.args.out[k]);

		tp.args.Ncurves = 3;
		await until(() => Number.isFinite(value(tp, 'period_c3')));
		for (const k of CURVE_3) expect(hasColumn(tp.args.out[k])).toBe(true);
		// Curve 2's columns are the same columns (their wires stay).
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
		// A fixed period has no curves.
		tp.args.useFixedPeriod = true;
		await until(() => !(CURVE_2[0] in tp.args.out));
		for (const k of CURVE_2) expect(k in tp.args.out).toBe(false);
	});
});
