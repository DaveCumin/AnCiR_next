// @ts-nocheck
// "Specify output x values" > Sequence, end to end through the real app, on all five fitting
// nodes (Cosinor, Rectangular wave, Double logistic, Fit waveform model, Trend fit).
//
// The sequence is made over the node's own x (utils/outputXSequence.js) and goes through the
// same path as an output x COLUMN: a time x comes out as a time column of epoch ms, the fitted
// curve is evaluated on it, residuals stay at the input x. Switching back to Column gives the
// column behaviour again, and every control gesture is one undo step.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts, appState } from '$lib/core/core.svelte.js';
import { getColumnById } from '$lib/core/Column.svelte';
import { _resetComputeOwners } from '$lib/core/computeOwners.svelte.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';
import { mutationService } from '$lib/core/mutationService.js';
import { buildTableProcessDefaults } from '$lib/core/tpDefaults.js';
import { history } from '$lib/core/opHistory.svelte.js';
import { paramDiffWatcher } from '$lib/core/paramDiffWatcher.svelte.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';
import { setWorkerFactory } from '$lib/workers/workerPool.js';
import AppViews from '$lib/components/views/__fixtures__/AppViews.svelte';

const DEMOS = join(process.cwd(), 'static/sessions/demos');
const demo = (name) => JSON.parse(readFileSync(join(DEMOS, name), 'utf8'));
const H = 3600000;
const T0 = Date.UTC(2026, 0, 5, 6, 0, 0);

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
beforeEach(() => {
	appState.view = 'canvas';
	appState.canvasSelectedNodeId = null;
});
afterEach(() => {
	cleanup();
	_resetComputeOwners();
	history.clear();
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

/**
 * The shipped Cosinor demo with x a TIME column: 2 days hourly (48 samples, span 47 h, one
 * blank time), a 24 h cosine as y. The Sequence Column that made x is dropped. With
 * `numeric`, x stays a number column 0..47 instead.
 */
function session({ numeric = false } = {}) {
	const json = demo('demo-tp-cosinor.json');
	const tp = json.tableProcesses.find((t) => t.name === 'Cosinor');
	json.tableProcesses = json.tableProcesses.filter((t) => t.name !== 'SequenceColumn');
	const n = 48;
	const xs = Array.from({ length: n }, (_, i) => (numeric ? i : T0 + i * H));
	xs[10] = null; // a blank x: ignored by the sequence's min and max
	json.rawData[String(tp.args.xIN)] = xs;
	json.rawData[String(tp.args.yIN[0])] = xs.map(
		(_, i) => 50 + 20 * Math.cos((2 * Math.PI * (i - 8)) / 24) + 2 * Math.sin(i * 1.7)
	);
	const x = json.data.find((c) => c.id === tp.args.xIN);
	Object.assign(
		x,
		numeric
			? { name: 'x', tableProcessGUId: '' }
			: {
					name: 'time',
					type: 'time',
					// Epoch ms, as the app's own time outputs are stored (no text format to parse).
					timeFormat: null,
					tableProcessGUId: ''
				}
	);
	return json;
}

async function load(json) {
	render(AppViews);
	await settle(2);
	await importJson(json);
	await settle();
}

const NODES = [
	// name, x output key, y output prefix, args for a quick deterministic fit
	['Cosinor', 'cosinorx', 'cosinory_', { useFixedPeriod: true, fixedPeriod: 24 }],
	['RectangularWave', 'rectwavex', 'rectwavey_', { fixOmega: true, fixedPeriod: 24 }],
	['DoubleLogistic', 'dlogx', 'dlogy_', { fixPeriod: true, fixedPeriod: 24 }],
	['FitFunction', 'fitx', 'fity_', { model: 'cosinor', useFixedPeriod: true, fixedPeriod: 24 }],
	['TrendFit', 'trendx', 'trendy_', { model: 'linear' }]
];

/** A new node of `name` wired to the session's x and y. */
async function addNode(name, extra) {
	const ref = core.tableProcesses.find((t) => t.name === 'Cosinor');
	const entry = appConsts.tableProcessMap.get(name);
	const tp = mutationService.addFreeTableProcess(name, {
		...buildTableProcessDefaults(entry),
		...extra
	});
	tp.args.xIN = ref.args.xIN;
	tp.args.yIN = [...ref.args.yIN];
	await settle();
	return tp;
}
const data = (id) => getColumnById(id)?.getData() ?? [];

describe.each(NODES)('%s: sequence output x', (name, xKey, yPrefix, extra) => {
	it('time x: every 0.1 h (the automatic step) from the first to the last time, as time', async () => {
		await load(session());
		const tp = await addNode(name, extra);
		const yId = tp.args.yIN[0];
		await until(() => data(tp.args.out[xKey]).length > 0);
		const inputLen = data(tp.args.out[xKey]).length;
		expect(inputLen).toBe(47); // the input x (one blank dropped)

		tp.args.outputX = tp.args.xIN;
		tp.args.outputXMode = 'sequence';
		await until(() => data(tp.args.out[xKey]).length === 471);
		const xCol = getColumnById(tp.args.out[xKey]);
		const xo = xCol.getData();
		expect(xCol.type).toBe('time');
		expect(xo).toHaveLength(471); // 0, 0.1, ..., 47 h
		expect(xo[0]).toBe(T0);
		expect(xo[1]).toBeCloseTo(T0 + 0.1 * H, 3);
		expect(xo[470]).toBeCloseTo(T0 + 47 * H, 3);
		const yo = data(tp.args.out[yPrefix + yId]);
		expect(yo).toHaveLength(471);
		expect(yo.every((v) => Number.isFinite(v))).toBe(true);
		// Residuals stay at the input x (one per input row).
		const resid = data(tp.args.out['resid_' + yId]);
		expect(resid).toHaveLength(48);
		expect(tp.warnings.join('\n')).not.toMatch(/output x sequence/);

		// An explicit step; the maximum (47 h) is not on a 2 h grid, so the last value is 46 h.
		tp.args.outputXStep = 2;
		await until(() => data(tp.args.out[xKey]).length === 24);
		expect(data(tp.args.out[xKey]).at(-1)).toBe(T0 + 46 * H);

		// Back to Column: the column outputX names (the x input) again.
		tp.args.outputXMode = 'column';
		await until(() => data(tp.args.out[xKey]).length === inputLen);
		expect(data(tp.args.out[xKey])[0]).toBe(T0);
	});

	it('a step past the 2,000,000-point limit: the fit at the input x, and a warning', async () => {
		await load(session());
		const tp = await addNode(name, extra);
		await until(() => data(tp.args.out[xKey]).length > 0);
		Object.assign(tp.args, { outputX: tp.args.xIN, outputXMode: 'sequence', outputXStep: 1e-5 });
		await until(() => (tp.warnings ?? []).some((w) => /output x sequence/.test(w)));
		expect(tp.warnings.join('\n')).toMatch(
			/No output x sequence was made \(the fit is shown at the input x\): a step of 0\.00001 h over 47 h gives 4,700,001 grid points/
		);
		expect(data(tp.args.out[xKey])).toHaveLength(47);
	});
});

describe('number x: the step is in x units', () => {
	it.each(NODES)('%s', async (name, xKey, yPrefix, extra) => {
		await load(session({ numeric: true }));
		const tp = await addNode(name, extra);
		await until(() => data(tp.args.out[xKey]).length > 0);
		Object.assign(tp.args, { outputX: tp.args.xIN, outputXMode: 'sequence', outputXStep: 0.5 });
		await until(() => data(tp.args.out[xKey]).length === 95);
		const xCol = getColumnById(tp.args.out[xKey]);
		expect(xCol.type).toBe('number');
		expect(xCol.getData().slice(0, 3)).toEqual([0, 0.5, 1]);
		expect(xCol.getData().at(-1)).toBe(47);
		expect(data(tp.args.out[yPrefix + tp.args.yIN[0]])).toHaveLength(95);
	});
});

describe('the control', () => {
	const wrapOf = (tp) =>
		document.querySelector(`.workflow-node-wrapper[data-node-id="tableprocess_${tp.id}"]`);
	const labelled = (wrap, text) =>
		[...(wrap?.querySelectorAll('label') ?? [])].find((l) => l.textContent.trim().startsWith(text));

	it.each(NODES)('%s: tick, Sequence, step, undo each, Column', async (name, xKey, _y, extra) => {
		await load(session());
		const tp = await addNode(name, extra);
		appState.canvasSelectedNodeId = `tableprocess_${tp.id}`;
		await until(() => data(tp.args.out[xKey]).length > 0);
		paramDiffWatcher.rebaseSnapshot();
		history.clear();
		const wrap = wrapOf(tp);
		const box = labelled(wrap, 'Specify output x values')?.querySelector('input');
		expect(box, 'the Specify output x values checkbox').toBeTruthy();
		expect(box.checked).toBe(false);

		await fireEvent.click(box);
		await settle();
		await paramDiffWatcher.flush();
		expect(tp.args.outputX).toBe(tp.args.xIN);
		expect(history.undoCount).toBe(1);
		// Column mode, as before: the column picker shows, no step box.
		const modeSel = labelled(wrap, 'Output x values')?.querySelector('select');
		expect(modeSel.value).toBe('column');
		expect(wrap.textContent).toContain('Output x column');
		expect(labelled(wrap, 'Step')).toBeUndefined();

		await fireEvent.change(modeSel, { target: { value: 'sequence' } });
		await settle();
		await paramDiffWatcher.flush();
		expect(tp.args.outputXMode).toBe('sequence');
		expect(history.undoCount).toBe(2);
		await until(() => data(tp.args.out[xKey]).length === 471);
		// Only the step shows, with the automatic step in it.
		expect(wrap.textContent).not.toContain('Output x column');
		const step = labelled(wrap, 'Step')?.querySelector('input');
		expect(step.value).toBe('0.1');
		expect(wrap.textContent.replace(/\s+/g, ' ')).toMatch(
			/471 values from the smallest x, every 0\.1 h/
		);

		await fireEvent.input(step, { target: { value: '0.5' } });
		await settle();
		await paramDiffWatcher.flush();
		expect(tp.args.outputXStep).toBe(0.5);
		await until(() => data(tp.args.out[xKey]).length === 95);

		// Undo walks back one gesture at a time.
		history.undo();
		await settle();
		expect(tp.args.outputXStep).toBeNull();
		await until(() => data(tp.args.out[xKey]).length === 471);
		history.undo();
		await settle();
		expect(tp.args.outputXMode).toBe('column');
		expect(labelled(wrapOf(tp), 'Output x values')?.querySelector('select').value).toBe('column');
		await until(() => data(tp.args.out[xKey]).length === 47);
		history.undo();
		await settle();
		expect(tp.args.outputX).toBe(-1);
		expect(labelled(wrapOf(tp), 'Specify output x values')?.querySelector('input').checked).toBe(
			false
		);
	});

	it('a saved session without the new args loads as Column, unchanged', async () => {
		const json = session();
		const tp = json.tableProcesses.find((t) => t.name === 'Cosinor');
		tp.args.outputX = tp.args.xIN;
		delete tp.args.outputXMode;
		delete tp.args.outputXStep;
		await load(json);
		const live = core.tableProcesses.find((t) => t.name === 'Cosinor');
		await until(() => data(live.args.out.cosinorx).length === 47);
		expect(live.args.outputXMode).toBe('column');
		expect(live.args.outputXStep).toBeNull();
	});
});
