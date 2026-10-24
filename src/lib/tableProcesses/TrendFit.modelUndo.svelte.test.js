// @ts-nocheck
// Switching Trend Fit's model swaps its coefficient ports (linear `coef_slope` /
// `coef_intercept` for polynomial `coef_c0..c2`), removing the old ports' columns and every
// wire into them. ONE undo of the choice must bring the old ports back with their column ids,
// their numbers and the wires into them, and redo must swap them out again: one user gesture,
// one history step (outputShapingArgs, as Cosinor and Fit waveform do).
//
// The real app: the shipped Trend Fit demo loaded through importJson, the real components
// mounted, the live parameter watcher and the real op history, and a change on the node's
// own Model select. Nothing mocked.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
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

const LINEAR = ['coef_slope', 'coef_intercept'];
const POLY = ['coef_c0', 'coef_c1', 'coef_c2'];

/** The shipped Trend Fit demo on a plain number x (no Sequence node in between). */
function trendSession() {
	const json = JSON.parse(
		readFileSync(join(process.cwd(), 'static/sessions/demos/demo-tp-trendfit.json'), 'utf8')
	);
	const tp = json.tableProcesses.find((t) => t.name === 'TrendFit');
	json.tableProcesses = json.tableProcesses.filter((t) => t.name !== 'SequenceColumn');
	const t = Array.from({ length: 50 }, (_, i) => i);
	json.rawData[String(tp.args.xIN)] = t;
	json.rawData[String(tp.args.yIN[0])] = t.map((x) => 3 + 0.5 * x + 0.02 * x * x);
	Object.assign(
		json.data.find((c) => c.id === tp.args.xIN),
		{ name: 'x', type: 'number', tableProcessGUId: '' }
	);
	return json;
}

const trendTp = () => core.tableProcesses.find((t) => t.name === 'TrendFit');
const value = (tp, key) => getColumnById(tp.args.out[key])?.getData()?.[0];
const hasColumn = (id) => core.data.some((c) => c.id === id);

describe('Trend Fit model switch, undo and redo', () => {
	it('one change is one step; undo restores the coefficient ports with ids, numbers and wires', async () => {
		const { container } = render(AppViews);
		await settle(2);
		await importJson(trendSession());
		await settle();
		const tp = trendTp();
		await until(() => Number.isFinite(value(tp, 'coef_slope')));

		// A downstream node wired to the slope.
		const slopeId = tp.args.out.coef_slope;
		const consumer = mutationService.addFreeTableProcess('DescribeData', { yIN: [slopeId] });
		await settle();
		const ids = Object.fromEntries(LINEAR.map((k) => [k, tp.args.out[k]]));
		const numbers = Object.fromEntries(LINEAR.map((k) => [k, value(tp, k)]));

		// The user's gesture: the live watcher records it, through the node's own select.
		paramDiffWatcher.init();
		history.clear();
		appState.canvasSelectedNodeId = `tableprocess_${tp.id}`;
		await settle();
		const select = [...container.querySelectorAll('select')].find((s) =>
			[...s.options].some((o) => o.value === 'polynomial')
		);
		expect(select).toBeTruthy();
		select.value = 'polynomial';
		await fireEvent.change(select);
		await until(() => !(LINEAR[0] in tp.args.out) && POLY.every((k) => k in tp.args.out));
		await settle();
		expect(tp.args.model).toBe('polynomial');
		for (const k of LINEAR) expect(hasColumn(ids[k])).toBe(false);
		const polyIds = Object.fromEntries(POLY.map((k) => [k, tp.args.out[k]]));
		// One change, one step.
		expect(history.undoCount).toBe(1);

		history.undo();
		await settle();
		expect(tp.args.model).toBe('linear');
		for (const k of LINEAR) {
			expect(tp.args.out[k]).toBe(ids[k]);
			expect(hasColumn(ids[k])).toBe(true);
		}
		for (const k of POLY) expect(k in tp.args.out).toBe(false);
		await until(() => Number.isFinite(value(tp, 'coef_slope')));
		for (const k of LINEAR) expect(value(tp, k)).toBeCloseTo(numbers[k], 9);
		// The wire into the slope is whole again.
		expect(consumer.args.yIN).toEqual([slopeId]);
		// Undo did not record a step of its own (redo stays available).
		expect(history.undoCount).toBe(0);
		expect(history.redoCount).toBe(1);

		history.redo();
		await settle();
		expect(tp.args.model).toBe('polynomial');
		for (const k of LINEAR) {
			expect(k in tp.args.out).toBe(false);
			expect(hasColumn(ids[k])).toBe(false);
		}
		for (const k of POLY) expect(tp.args.out[k]).toBe(polyIds[k]);
		expect(consumer.args.yIN).toEqual([]);

		history.undo();
		await settle();
		for (const k of LINEAR) expect(tp.args.out[k]).toBe(ids[k]);
		expect(consumer.args.yIN).toEqual([slopeId]);
		expect(history.redoCount).toBe(1);
	});
});
