// @ts-nocheck
// Switching a free-period Cosinor with two cosine curves to a fixed period removes curve 2's
// ports (`period_c2`, ...) and orphans their wires, as Trend Fit does when its model changes.
// That is accepted; what must hold is that ONE undo of the click brings the ports back with
// their column ids, their numbers and the wires into them, and redo removes them again.
//
// The real app: the shipped Cosinor demo loaded through importJson, the real components
// mounted, the live parameter watcher and the real op history, and the click on the node's
// own "Use fixed period" checkbox. Nothing mocked.
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

const CURVE_2 = ['period_c2', 'amplitude_c2', 'acrophase_c2', 'bathyphase_c2'];

/** The shipped Cosinor demo refitted with a free period and two cosine curves. */
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

describe('Cosinor free to fixed, undo and redo', () => {
	it('one undo restores the curve ports with their ids, numbers and wires; redo removes them', async () => {
		const { container } = render(AppViews);
		await settle(2);
		await importJson(twoCurveSession());
		await settle();
		const tp = cosinorTp();
		await until(() => Number.isFinite(value(tp, 'amplitude_c2')));

		// A downstream node wired to curve 2's amplitude.
		const ampId = tp.args.out.amplitude_c2;
		const consumer = mutationService.addFreeTableProcess('DescribeData', { yIN: [ampId] });
		await settle();
		const ids = Object.fromEntries(CURVE_2.map((k) => [k, tp.args.out[k]]));
		const numbers = Object.fromEntries(CURVE_2.map((k) => [k, value(tp, k)]));

		// The user's gesture: the live watcher records it, through the node's own checkbox.
		paramDiffWatcher.init();
		history.clear();
		appState.canvasSelectedNodeId = `tableprocess_${tp.id}`;
		await settle();
		const box = [...container.querySelectorAll('label')]
			.find((l) => l.textContent.trim() === 'Use fixed period')
			?.querySelector('input[type="checkbox"]');
		expect(box).toBeTruthy();
		await fireEvent.click(box);
		await until(() => !(CURVE_2[0] in tp.args.out));
		await settle();
		expect(tp.args.useFixedPeriod).toBe(true);
		for (const k of CURVE_2) expect(hasColumn(ids[k])).toBe(false);
		// One click, one step.
		expect(history.undoCount).toBe(1);

		history.undo();
		await settle();
		expect(tp.args.useFixedPeriod).toBe(false);
		for (const k of CURVE_2) {
			expect(tp.args.out[k]).toBe(ids[k]);
			expect(hasColumn(ids[k])).toBe(true);
		}
		await until(() => Number.isFinite(value(tp, 'amplitude_c2')));
		for (const k of CURVE_2) expect(value(tp, k)).toBeCloseTo(numbers[k], 9);
		// The wire into curve 2's amplitude is whole again.
		expect(consumer.args.yIN).toEqual([ampId]);
		// Undo did not record a step of its own (redo stays available).
		expect(history.redoCount).toBe(1);

		history.redo();
		await settle();
		expect(tp.args.useFixedPeriod).toBe(true);
		for (const k of CURVE_2) {
			expect(k in tp.args.out).toBe(false);
			expect(hasColumn(ids[k])).toBe(false);
		}

		// And back once more: the same ids again.
		history.undo();
		await settle();
		for (const k of CURVE_2) expect(tp.args.out[k]).toBe(ids[k]);
		expect(history.redoCount).toBe(1);
	});
});
