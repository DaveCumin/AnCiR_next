// @ts-nocheck
// ROB-U1 (2026-10-03 review, "possible, not confirmed"): NodeComputeHost.stale.svelte.test.js
// was seen to emit Svelte's `derived_inert` warning ("Reading a derived belonging to a
// now-destroyed effect may result in stale values"), and a collapsed SmoothedData might read
// a stale derived after its component re-mounts.
//
// Checked 2026-10-28 on Svelte 5.57.2: the stale suite emits no derived_inert at v82.64, nor
// at v79.0 (the commit that added it) run against the current dependencies. This test is the
// user's scenario as a guard: the shipped SmoothedData demo, the node collapsed, then
// expanded and collapsed again (each a re-mount: the hidden NodeComputeHost instance and the
// canvas panel hand over), with an argument edit and an upstream data edit made while it is
// collapsed after a re-mount. After every step the output must equal a fresh smoothing of
// the current input, and no step may warn derived_inert.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts, appState } from '$lib/core/core.svelte.js';
import { getColumnById } from '$lib/core/Column.svelte';
import { _resetComputeOwners } from '$lib/core/computeOwners.svelte.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';
import { movingAverage } from '$lib/utils/smoothing.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';
import { setWorkerFactory } from '$lib/workers/workerPool.js';
import AppViews from './__fixtures__/AppViews.svelte';

const DEMO = join(process.cwd(), 'static/sessions/demos/demo-tp-smootheddata.json');
const NODE = 'tableprocess_89'; // SmoothedData: y (881) -> smoothedy_881 (883)
const Y_IN = 881;
const Y_OUT = 883;

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
	vi.restoreAllMocks();
});

async function settle(rounds = 6) {
	for (let i = 0; i < rounds; i++) {
		flushSync();
		await tick();
		await new Promise((r) => setTimeout(r, 20));
	}
	flushSync();
}

const data = (id) => getColumnById(id)?.getData() ?? [];
const tp = () => core.tableProcesses.find((t) => t.id === 89);
const wrapper = () => document.querySelector(`.workflow-node-wrapper[data-node-id="${NODE}"]`);
const expanded = () => !!wrapper()?.querySelector('.process-editor-panel');
async function toggle() {
	await fireEvent.click(
		wrapper().querySelector('button[aria-label="Expand"], button[aria-label="Collapse"]')
	);
	await settle();
}

/** The output must be a fresh smoothing of the input as it is now. */
function expectCurrent(step) {
	const a = tp().args;
	const want = movingAverage(data(Y_IN), a.movingAvgWindowSize, a.movingAvgType);
	const got = data(Y_OUT);
	expect(got.length, step).toBe(want.length);
	for (let i = 0; i < want.length; i++) expect(got[i], `${step}: row ${i}`).toBeCloseTo(want[i], 9);
}

describe('ROB-U1: a collapsed SmoothedData stays current across re-mounts', () => {
	it('expand, collapse, edit while collapsed: always current, never derived_inert', async () => {
		const warn = vi.spyOn(console, 'warn');
		const json = JSON.parse(readFileSync(DEMO, 'utf8'));
		json.nodeLayout[NODE] = { ...json.nodeLayout[NODE], collapsed: true };
		appState.view = 'canvas';
		render(AppViews);
		await settle(2);
		await importJson(json);
		await settle();

		expect(expanded()).toBe(false);
		expectCurrent('loaded collapsed');

		await toggle(); // expand: the canvas panel takes over from the hidden instance
		expect(expanded()).toBe(true);
		expectCurrent('expanded');
		await toggle(); // collapse: the hidden instance re-mounts
		expect(expanded()).toBe(false);

		tp().args.movingAvgWindowSize = 9;
		await settle();
		expectCurrent('window edited while collapsed after a re-mount');

		const y = getColumnById(Y_IN);
		core.rawData.set(
			y.data,
			core.rawData.get(y.data).map((v, i) => v * 2 + (i % 3))
		);
		y.rawDataVersion++;
		await settle();
		expectCurrent('input edited while collapsed after a re-mount');

		for (let i = 0; i < 3; i++) await toggle();
		expect(expanded()).toBe(true);
		tp().args.movingAvgType = 'weighted';
		await settle();
		expectCurrent('type edited while expanded after several re-mounts');
		await toggle();
		tp().args.movingAvgWindowSize = 3;
		await settle();
		expectCurrent('window edited while collapsed again');

		const inert = warn.mock.calls.filter((c) => c.some((a) => String(a).includes('derived_inert')));
		expect(inert).toEqual([]);
	});
});
