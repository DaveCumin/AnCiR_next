// @ts-nocheck
// A node's outputs are a function of its CURRENT inputs whether or not its component is
// mounted, and exactly one instance computes it.
//
// Regression (reported 2026-09-30 after v78.1): a node collapsed on the canvas showed the
// outputs stored in the session file and never recomputed until it was expanded, so a
// session saved before a computation fix kept its old results, and everything wired
// downstream received them. The reproduction below is that report: a BinnedData session
// exported before v78.1 stores 7 binned rows where the current code computes 25. The same
// held after any upstream edit while collapsed, and for a plot hidden from the workspace,
// whose metric output ports stopped following their input.
//
// These tests load sessions through the real importJson and mount the same components
// +page.svelte mounts (WorkflowEditor or PlotDisplay, plus NodeComputeHost and the control
// panel's CanvasNodeControls; see __fixtures__/AppViews.svelte).
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';

// Count every output-column write that actually changes a column (writeOutputColumn skips
// identical data, and a skipped write is not a write).
const writes = vi.hoisted(() => ({ calls: [], core: null }));
vi.mock('$lib/tableProcesses/outputColumns.js', async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		writeOutputColumn: (colId, data, opts) => {
			const before = writes.core?.rawData.get(colId);
			const ok = actual.writeOutputColumn(colId, data, opts);
			if (writes.core?.rawData.get(colId) !== before) writes.calls.push({ colId });
			return ok;
		}
	};
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts, appState } from '$lib/core/core.svelte.js';
import { getColumnById } from '$lib/core/Column.svelte';
import { _computeCount, _resetComputeCount } from '$lib/core/computeMemo.js';
import { computeOwnerCount, _resetComputeOwners } from '$lib/core/computeOwners.svelte.js';
import { computeTargets } from './NodeComputeHost.svelte';
import { importJson } from '$lib/components/iconActions/Setting.svelte';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';
import { setWorkerFactory } from '$lib/workers/workerPool.js';
import AppViews from './__fixtures__/AppViews.svelte';

const FIXTURE = join(
	process.cwd(),
	'src/lib/components/views/__fixtures__/staleBinnedSession.json'
);
const DEMOS = join(process.cwd(), 'static/sessions/demos');
const staleBinned = () => JSON.parse(readFileSync(FIXTURE, 'utf8'));
const demo = (name) => JSON.parse(readFileSync(join(DEMOS, name), 'utf8'));

// Analyses that post to a worker run their synchronous fallback instead.
class ThrowOnPost {
	postMessage() {
		throw new Error('synchronous compute in tests');
	}
	terminate() {}
}

beforeAll(async () => {
	writes.core = core;
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
	setWorkerFactory(() => new ThrowOnPost());
});
beforeEach(() => {
	appState.view = 'canvas';
	appState.canvasSelectedNodeId = null;
	appState.invisiblePlotIds = [];
	writes.calls.length = 0;
});
afterEach(() => {
	cleanup();
	_resetComputeOwners();
	appState.canvasSelectedNodeId = null;
	appState.view = 'canvas';
});

async function settle(rounds = 6) {
	for (let i = 0; i < rounds; i++) {
		flushSync();
		await tick();
		await new Promise((r) => setTimeout(r, 20));
	}
	flushSync();
}

/** Settle until `ok()` holds (the periodogram debounces its calculation by 250 ms). */
async function until(ok, ms = 3000) {
	const t0 = Date.now();
	while (!ok() && Date.now() - t0 < ms) await settle(1);
	await settle(2);
}

async function load(json) {
	render(AppViews);
	await settle(2);
	await importJson(json);
	await settle();
}

const data = (id) => getColumnById(id)?.getData() ?? [];
const tpById = (id) => core.tableProcesses.find((t) => t.id === id);
const hostInstances = (key) =>
	document.querySelectorAll(`.node-compute-host [data-compute-key="${key}"]`).length;
const wrapper = (nodeId) =>
	document.querySelector(`.workflow-node-wrapper[data-node-id="${nodeId}"]`);
const panelShown = (nodeId) => !!wrapper(nodeId)?.querySelector('.process-editor-panel');
async function toggleCollapse(nodeId) {
	const btn = wrapper(nodeId).querySelector(
		'button[aria-label="Expand"], button[aria-label="Collapse"]'
	);
	await fireEvent.click(btn);
	await settle();
}

/**
 * How many VISIBLE computing instances of `key` the mounted views show, read off the DOM
 * and app state rather than the registry (so a mount site that forgets to claim, or a
 * claim that is never released, shows up as a mismatch).
 */
function visibleInstances(t) {
	if (t.kind === 'plot') {
		if (appState.view === 'canvas') return wrapper(t.key) ? 1 : 0;
		return appState.invisiblePlotIds.includes(t.obj.id) ? 0 : 1;
	}
	const canvasPanel = appState.view === 'canvas' && panelShown(t.key) ? 1 : 0;
	const controlPanel = appState.canvasSelectedNodeId === t.key ? 1 : 0;
	return canvasPanel + controlPanel;
}

/**
 * One writer per node: the registry agrees with what is actually shown, and the host adds
 * a hidden instance exactly when nothing is shown.
 */
function expectOneWriterEach() {
	for (const t of computeTargets(core)) {
		const shown = visibleInstances(t);
		expect(computeOwnerCount(t.key), `${t.key}: claims`).toBe(shown);
		expect(hostInstances(t.key), `${t.key}: hidden instances`).toBe(shown > 0 ? 0 : 1);
	}
}

// The BinnedData node (id 0) bins repro_y (col 1) into binnedx (col 2) / binnedy_1 (col 3);
// DescribeData (id 1), downstream and expanded, summarises binnedy_1.
const BINNED_Y = 3;
const describeN = () => data(tpById(1).args.out.n)[0];

describe('a collapsed node computes from its inputs', () => {
	it('recomputes on load, and downstream receives the fresh value', async () => {
		const json = staleBinned();
		expect(json.rawData[BINNED_Y]).toHaveLength(7); // what the file stores (pre-v78.1)
		await load(json);

		expect(panelShown('tableprocess_0')).toBe(false); // still collapsed
		expect(data(BINNED_Y)).toHaveLength(25);
		expect(describeN()).toBe(24); // 25 bins, the last one empty
		expectOneWriterEach();
	});

	it('recomputes after an argument edit and after an upstream data edit', async () => {
		await load(staleBinned());
		const tp = tpById(0);

		tp.args.stepSize = 2;
		await settle();
		expect(data(BINNED_Y)).toHaveLength(13);
		expect(describeN()).toBe(12);

		// Upstream edit: double the input series. Every bin mean doubles.
		const before = data(BINNED_Y);
		const y = getColumnById(1);
		core.rawData.set(
			y.data,
			core.rawData.get(y.data).map((v) => v * 2)
		);
		y.rawDataVersion++;
		await settle();
		const after = data(BINNED_Y);
		expect(after).toHaveLength(13);
		for (let i = 0; i < 12; i++) expect(after[i]).toBeCloseTo(before[i] * 2, 9);
		expect(panelShown('tableprocess_0')).toBe(false);
	});

	it('expanding it neither recomputes nor rewrites anything', async () => {
		await load(staleBinned());
		expect(hostInstances('tableprocess_0')).toBe(1);
		_resetComputeCount();
		writes.calls.length = 0;

		await toggleCollapse('tableprocess_0');

		expect(panelShown('tableprocess_0')).toBe(true);
		expect(hostInstances('tableprocess_0')).toBe(0); // the hidden instance stood down
		expect(computeOwnerCount('tableprocess_0')).toBe(1);
		expect(_computeCount()).toBe(0);
		expect(writes.calls).toEqual([]);
		expect(data(BINNED_Y)).toHaveLength(25);
	});

	it('collapsing and expanding repeatedly never mints a column or moves an id', async () => {
		await load(staleBinned());
		const ids = core.data.map((c) => c.id);
		const outs = JSON.stringify(core.tableProcesses.map((t) => t.args.out));
		_resetComputeCount();
		writes.calls.length = 0;

		for (let i = 0; i < 4; i++) {
			await toggleCollapse('tableprocess_0');
			expectOneWriterEach();
		}

		expect(core.data.map((c) => c.id)).toEqual(ids);
		expect(JSON.stringify(core.tableProcesses.map((t) => t.args.out))).toBe(outs);
		expect(_computeCount()).toBe(0);
		expect(writes.calls).toEqual([]);
	});
});

describe('exactly one writer per node across views', () => {
	it('canvas, plots view, control-panel selection and back: one instance each, no recompute', async () => {
		await load(staleBinned());
		expectOneWriterEach();
		_resetComputeCount();
		writes.calls.length = 0;

		const steps = [
			() => (appState.view = 'plots'),
			() => (appState.canvasSelectedNodeId = 'tableprocess_0'),
			() => (appState.view = 'canvas'),
			() => (appState.canvasSelectedNodeId = 'tableprocess_1'),
			() => (appState.canvasSelectedNodeId = null)
		];
		for (const step of steps) {
			step();
			await settle();
			expectOneWriterEach();
		}
		// The selected node's control-panel instance is its (only) computing instance.
		expect(_computeCount()).toBe(0);
		expect(writes.calls).toEqual([]);
		expect(data(BINNED_Y)).toHaveLength(25);
	});

	it('the plots view keeps an unselected node current after an upstream edit', async () => {
		await load(staleBinned());
		appState.view = 'plots';
		await settle();
		tpById(0).args.stepSize = 2;
		await settle();
		expect(data(BINNED_Y)).toHaveLength(13);
		expect(describeN()).toBe(12);
	});
});

describe('a plot hidden from the workspace keeps its metric ports current', () => {
	it('follows an input change while hidden, with one computing instance', async () => {
		await load(demo('demo-periodogram-rhythm.json'));
		appState.view = 'plots';
		await settle();
		const plot = core.plots.find((p) => p.type === 'periodogram');
		const key = `plot_${plot.id}`;
		const peak = () => data(plot.metricOut?.peak_period)[0];
		await until(() => Number.isFinite(peak()));
		expect(peak()).toBeCloseTo(24, 0);
		expect(computeOwnerCount(key)).toBe(1); // the workspace card
		expect(hostInstances(key)).toBe(0);

		appState.invisiblePlotIds = [plot.id];
		await settle();
		expect(computeOwnerCount(key)).toBe(0);
		expect(hostInstances(key)).toBe(1);

		// Replace the plotted series with a 12 h rhythm.
		const { x, y } = plot.plot.data[0];
		const xs = data(x.refId);
		const yCol = getColumnById(y.refId);
		core.rawData.set(
			yCol.data,
			Array.from(xs, (h) => 50 + 40 * Math.sin((2 * Math.PI * h) / 12))
		);
		yCol.rawDataVersion++;
		await until(() => Math.abs(peak() - 12) < 0.5);
		expect(peak()).toBeCloseTo(12, 0);

		appState.invisiblePlotIds = [];
		await settle();
		expect(hostInstances(key)).toBe(0);
		expect(peak()).toBeCloseTo(12, 0);
	});
});

// Saved outputs are a cache at most. These node types used to PIN their memo hash on mount
// whenever the session held populated outputs ("the baked data is still current"), so they
// did not recompute even when expanded; the other three were stale only while collapsed.
// Each shipped demo is loaded with the node's stored outputs replaced by a sentinel, and the
// node must overwrite every one of them from its inputs.
const SOURCES = new Set(['SequenceColumn', 'Random', 'SimulatedData', 'BlankColumn']);
const SENTINEL = 424242;
const PINNED = [
	'collectcolumns',
	'columnfunctions',
	'crossing',
	'fdrcorrection',
	'formulacolumn',
	'longtowide',
	'movinganalysis',
	'smootheddata',
	'split',
	'threshold',
	'widetolong'
];
const CASES = [
	...PINNED.flatMap((n) => [
		[n, 'expanded'],
		[n, 'collapsed']
	]),
	['binneddata', 'collapsed'],
	['interpolate', 'collapsed'],
	['sort', 'collapsed']
];

describe('stored outputs are never trusted as current', () => {
	it.each(CASES)('%s (%s) recomputes over poisoned stored outputs', async (name, state) => {
		const json = demo(`demo-tp-${name}.json`);
		json.nodeLayout = json.nodeLayout ?? {};
		const poisoned = [];
		for (const tp of json.tableProcesses) {
			if (SOURCES.has(tp.name)) continue;
			if (state === 'collapsed')
				json.nodeLayout[`tableprocess_${tp.id}`] = {
					...(json.nodeLayout[`tableprocess_${tp.id}`] ?? {}),
					collapsed: true
				};
			for (const [key, id] of Object.entries(tp.args.out ?? {})) {
				const d = json.rawData[String(id)];
				if (!Array.isArray(d) || !d.some((v) => typeof v === 'number')) continue;
				json.rawData[String(id)] = d.map((v) => (typeof v === 'number' ? SENTINEL : v));
				poisoned.push({ tpId: tp.id, key });
			}
		}
		expect(poisoned.length).toBeGreaterThan(0);
		await load(json);
		const stillPoisoned = () =>
			poisoned.filter(({ tpId, key }) => data(tpById(tpId).args.out[key]).includes(SENTINEL));
		await until(() => stillPoisoned().length === 0);
		expect(stillPoisoned()).toEqual([]);
		expectOneWriterEach();
	});
});
