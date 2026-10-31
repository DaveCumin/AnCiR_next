// @ts-nocheck
// Full days only (decision 2026-11-01), end to end through the real app: a SAVED session that
// never stored the option loads with it OFF (stored explicitly, numbers unchanged); a NEW node
// starts with it ON; toggling it recomputes. Real importJson, real mounted components.
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

describe('Nonparametric RA full days only', () => {
	it('a saved session without the option keeps the partial last day, stored as false', async () => {
		const json = demo('demo-tp-nonparametricra.json');
		const saved = json.tableProcesses.find((t) => t.name === 'NonparametricRA');
		expect('fullDays' in saved.args).toBe(false);
		render(AppViews);
		await settle(2);
		await importJson(json);
		await settle();
		const tp = core.tableProcesses.find((t) => t.name === 'NonparametricRA');
		appState.canvasSelectedNodeId = `tableprocess_${tp.id}`;
		await settle();
		expect(tp.args.fullDays).toBe(false);
		const xCol = getColumnById(tp.args.xIN);
		const t = xCol.type === 'time' ? xCol.hoursSinceStart : xCol.getData();
		const y = col(tp.args.yIN[0]);
		const off = computeNPCRA(t, y, { epochHours: 1 });
		expect(col(tp.args.out.IS)[0]).toBeCloseTo(off.IS, 12);
		const out = JSON.parse(outputCoreAsJson());
		expect(out.tableProcesses.find((s) => s.id === tp.id).args.fullDays).toBe(false);
	});

	it('a new node starts with it on', () => {
		const entry = appConsts.tableProcessMap.get('NonparametricRA');
		expect(buildTableProcessDefaults(entry).fullDays).toBe(true);
		expect(
			buildTableProcessDefaults(appConsts.tableProcessMap.get('MovingAnalysis')).npcraFullDays
		).toBe(true);
	});
});
