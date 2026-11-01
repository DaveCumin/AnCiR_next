// @ts-nocheck
// Circadian Function Index "Full days only" (decision 2026-11-01, as Nonparametric RA in
// v82.66), end to end through the real app: a SAVED session that never stored the option
// loads with it OFF (stored explicitly, the CFI it was saved with unchanged, partial last day
// folded in); switching it on recomputes the CFI from the trimmed IS/IV/RA; a NEW node starts
// with it ON. Real importJson, real mounted components.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts, appState, outputCoreAsJson } from '$lib/core/core.svelte.js';
import { getColumnById } from '$lib/core/Column.svelte';
import { _resetComputeOwners } from '$lib/core/computeOwners.svelte.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';
import { buildTableProcessDefaults } from '$lib/core/tpDefaults.js';
import { computeNPCRA } from '$lib/utils/npcra.js';
import { circadianFunctionIndex } from '$lib/utils/cosinorAddons.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';
import { setWorkerFactory } from '$lib/workers/workerPool.js';
import AppViews from '$lib/components/views/__fixtures__/AppViews.svelte';

const demo = (name) =>
	JSON.parse(readFileSync(join(process.cwd(), 'static/sessions/demos', name), 'utf8'));

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
beforeEach(() => {
	appState.view = 'canvas';
	appState.canvasSelectedNodeId = null;
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
const col = (id) => getColumnById(id)?.getData() ?? [];

describe('Circadian Function Index full days only', () => {
	it('a saved session without the option keeps the partial last day; switching it on trims', async () => {
		const json = demo('demo-tp-circadianfunctionindex.json');
		const saved = json.tableProcesses.find((t) => t.name === 'CircadianFunctionIndex');
		expect('fullDays' in saved.args).toBe(false);
		// The demo is 14 whole days; give the saved record a 12 h partial day unlike the rest.
		const xs = json.rawData[saved.args.xIN];
		const ys = json.rawData[saved.args.yIN[0]];
		const last = xs[xs.length - 1];
		for (let h = 1; h <= 12; h++) {
			xs.push(last + h);
			ys.push(55);
		}
		render(AppViews);
		await settle(2);
		await importJson(json);
		await settle();
		const tp = core.tableProcesses.find((t) => t.name === 'CircadianFunctionIndex');
		appState.canvasSelectedNodeId = `tableprocess_${tp.id}`;
		await settle();
		expect(tp.args.fullDays).toBe(false);
		const t = col(tp.args.xIN);
		const y = col(tp.args.yIN[0]);
		const opts = { epochHours: 1, period: 24, mWindow: 10, lWindow: 5 };
		const off = computeNPCRA(t, y, opts);
		const on = computeNPCRA(t, y, { ...opts, fullDays: true });
		expect(on.droppedEpochs).toBe(12);
		const cfiOff = circadianFunctionIndex(off).CFI;
		const cfiOn = circadianFunctionIndex(on).CFI;
		expect(Math.abs(cfiOn - cfiOff)).toBeGreaterThan(1e-3);
		expect(col(tp.args.out.CFI)[0]).toBeCloseTo(cfiOff, 12);
		const out = JSON.parse(outputCoreAsJson());
		expect(out.tableProcesses.find((s) => s.id === tp.id).args.fullDays).toBe(false);

		// Switching it on recomputes CFI and its IS/IV/RA from the same whole days.
		tp.args.fullDays = true;
		await settle();
		expect(col(tp.args.out.CFI)[0]).toBeCloseTo(cfiOn, 12);
		expect(col(tp.args.out.IS)[0]).toBeCloseTo(on.IS, 12);
		expect(col(tp.args.out.IV)[0]).toBeCloseTo(on.IV, 12);
		expect(col(tp.args.out.RA)[0]).toBeCloseTo(on.RA, 12);
	});

	it('a new node starts with it on', () => {
		const entry = appConsts.tableProcessMap.get('CircadianFunctionIndex');
		expect(buildTableProcessDefaults(entry).fullDays).toBe(true);
	});
});
