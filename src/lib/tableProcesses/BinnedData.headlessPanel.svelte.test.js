// The headless compute and the mounted panel must produce the same binned output.
//
// BinnedData computes in two places. `definition.func` is what runs when the node's
// component is NOT mounted: a node created by an op (the AI build route, undo/redo),
// the MCP engine, the demo generator and the parity emitter. The panel's own effect
// runs when the node is expanded or selected. They used to disagree: the func was
// registered as `binneddata` and called with ONE argument, so the step-size flag
// (passed positionally by the panel) was always undefined and the headless path always
// stepped by the bin size. A session built by the MCP engine with `diffStep` on therefore
// saved 7 rows where the panel computes 25, and the node showed 7 while collapsed and
// 25 once expanded.
//
// These tests build real columns and real TableProcess nodes (no mocks of core), run the
// headless func on one node and mount the panel on another with identical args, and
// compare every output. Then they check that the panel recomputes whenever any
// result-changing argument changes, including two arguments changed in one flush.
/* global $state */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { core, appConsts, pushObj } from '$lib/core/core.svelte.js';
import { Column, getColumnById } from '$lib/core/Column.svelte';
import { TableProcess } from '$lib/core/TableProcess.svelte';
import { memoClear } from '$lib/core/computeMemo.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';
import BinnedData, { definition, binnedDataHash } from './BinnedData.svelte';

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.tableProcessMap = await loadTableProcesses();
});
afterEach(() => {
	cleanup();
	memoClear();
});

function mkCol(type, values, name) {
	const c = new Column({ type, data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

// 48 half-hourly samples of a noisy daily rhythm; x in hours from 0.
const X = Array.from({ length: 48 }, (_, i) => i * 0.5);
const Y = X.map((t, i) => 10 + 5 * Math.sin((2 * Math.PI * t) / 24) + (i % 3));
// The same instants as a time column (epoch ms), first sample 06:20Z.
const T0 = Date.UTC(2024, 2, 4, 6, 20);
const XT = X.map((h) => T0 + h * 3600000);

const settle = async () => {
	flushSync();
	await tick();
	await new Promise((r) => queueMicrotask(r));
	await new Promise((r) => setTimeout(r, 0));
	flushSync();
	await tick();
};

function outputsOf(tp, yId) {
	const xCol = getColumnById(tp.args.out.binnedx);
	const yCol = getColumnById(tp.args.out['binnedy_' + yId]);
	const clean = (a) => Array.from(a ?? []).map((v) => (Number.isFinite(v) ? v : null));
	return {
		x: clean(xCol?.getData()),
		xRaw: clean(core.rawData.get(xCol?.data)),
		y: clean(yCol?.getData()),
		xType: xCol?.type,
		binWidth: xCol?.binWidth ?? null,
		binStep: xCol?.binStep ?? null
	};
}

/** Headless: a node created with unminted outputs computes via definition.func. */
async function headless(params, xId, yId) {
	const tp = new TableProcess(
		{
			name: 'BinnedData',
			args: structuredClone({ ...params, xIN: xId, yIN: [yId], out: { binnedx: -1 } })
		},
		null
	);
	pushObj(tp);
	await definition.func(tp.args);
	return outputsOf(tp, yId);
}

/** Panel: the same args on a second node, outputs wiped, then the component mounted. */
async function panel(params, xId, yId) {
	const tp = new TableProcess(
		{
			name: 'BinnedData',
			args: structuredClone({ ...params, xIN: xId, yIN: [yId], out: { binnedx: -1 } })
		},
		null
	);
	pushObj(tp);
	// The constructor already ran the headless func; wipe what it wrote so only the
	// panel's own compute can fill the columns.
	for (const id of Object.values(tp.args.out)) core.rawData.set(getColumnById(id).data, []);
	render(BinnedData, { props: { p: tp, hideInputs: true } });
	await settle();
	return { tp, out: outputsOf(tp, yId) };
}

const AGGS = ['mean', 'median', 'min', 'max', 'stddev', 'count'];

describe('BinnedData: headless func and mounted panel agree', () => {
	for (const diffStep of [true, false]) {
		for (const aggFunction of AGGS) {
			it(`uniform bins, diffStep ${diffStep}, ${aggFunction}`, async () => {
				const xId = mkCol('number', X, 'x');
				const yId = mkCol('number', Y, 'y');
				const params = {
					binMode: 'uniform',
					binSize: 4,
					binStart: 0,
					stepSize: 1,
					diffStep,
					aggFunction,
					cuts: []
				};
				const h = await headless(params, xId, yId);
				const { out: pnl } = await panel(params, xId, yId);
				expect(pnl.y.length).toBeGreaterThan(0);
				expect(h).toEqual(pnl);
				// The rule itself: stepSize only when diffStep is ticked, else binSize.
				const step = diffStep ? 1 : 4;
				expect(h.xRaw[1] - h.xRaw[0]).toBe(step);
				expect(h.binStep).toBe(step);
				expect(h.binWidth).toBe(4);
			});
		}
	}

	it('time input with diffStep', async () => {
		const xId = mkCol('time', XT, 't');
		const yId = mkCol('number', Y, 'y');
		const params = {
			binMode: 'uniform',
			binSize: 3,
			binStart: 0,
			stepSize: 0.5,
			diffStep: true,
			aggFunction: 'mean',
			cuts: []
		};
		const h = await headless(params, xId, yId);
		const { out: pnl } = await panel(params, xId, yId);
		expect(h.xType).toBe('time');
		expect(h).toEqual(pnl);
		expect(h.xRaw[1] - h.xRaw[0]).toBe(0.5 * 3600000);
	});

	it('custom cut edges (stepSize and diffStep do not apply)', async () => {
		const xId = mkCol('number', X, 'x');
		const yId = mkCol('number', Y, 'y');
		const params = {
			binMode: 'cuts',
			binSize: 4,
			binStart: 0,
			stepSize: 1,
			diffStep: true,
			aggFunction: 'max',
			cuts: [0, 2, 7, 12, 24]
		};
		const h = await headless(params, xId, yId);
		const { out: pnl } = await panel(params, xId, yId);
		expect(h).toEqual(pnl);
		expect(h.xRaw).toEqual([0, 2, 7, 12]);
	});

	it('diffStep ticked with no usable stepSize falls back to the bin size on both paths', async () => {
		const xId = mkCol('number', X, 'x');
		const yId = mkCol('number', Y, 'y');
		const params = {
			binMode: 'uniform',
			binSize: 4,
			binStart: 0,
			stepSize: null,
			diffStep: true,
			aggFunction: 'mean',
			cuts: []
		};
		const h = await headless(params, xId, yId);
		const { out: pnl } = await panel(params, xId, yId);
		expect(h).toEqual(pnl);
		expect(h.xRaw[1] - h.xRaw[0]).toBe(4);
		expect(h.binStep).toBe(4);
	});

	it('a legacy single `binnedy` output key is migrated on the headless path too', async () => {
		const xId = mkCol('number', X, 'x');
		const yId = mkCol('number', Y, 'y');
		const yOut = mkCol('number', [], 'legacy_out');
		const xOut = mkCol('bin', [], 'legacy_x');
		const args = $state({
			xIN: xId,
			yIN: yId,
			binSize: 4,
			binStart: 0,
			stepSize: 1,
			diffStep: true,
			aggFunction: 'mean',
			out: { binnedx: xOut, binnedy: yOut }
		});
		await definition.func(args);
		expect(args.out.binnedy).toBeUndefined();
		expect(args.out['binnedy_' + yId]).toBe(yOut);
		expect(getColumnById(yOut).getData().length).toBe(25);
	});
});

describe('BinnedData: the panel recomputes when a result-changing argument changes', () => {
	it('recomputes when binSize and binStart change in one flush with the same sum', async () => {
		const xId = mkCol('number', X, 'x');
		const yId = mkCol('number', Y, 'y');
		const params = {
			binMode: 'uniform',
			binSize: 4,
			binStart: 0,
			stepSize: 4,
			diffStep: false,
			aggFunction: 'mean',
			cuts: []
		};
		const { tp, out: before } = await panel(params, xId, yId);
		expect(before.xRaw[0]).toBe(0);
		// 4 + 0 === 3 + 1: a hash that ADDS the numbers cannot see this edit.
		tp.args.binSize = 3;
		tp.args.binStart = 1;
		await settle();
		const after = outputsOf(tp, yId);
		expect(after.binWidth).toBe(3);
		expect(after.xRaw[0]).toBe(1);
		expect(after).toEqual(await headless({ ...params, binSize: 3, binStart: 1 }, xId, yId));
	});

	it('recomputes when diffStep is ticked and when stepSize changes', async () => {
		const xId = mkCol('number', X, 'x');
		const yId = mkCol('number', Y, 'y');
		const params = {
			binMode: 'uniform',
			binSize: 4,
			binStart: 0,
			stepSize: 1,
			diffStep: false,
			aggFunction: 'mean',
			cuts: []
		};
		const { tp } = await panel(params, xId, yId);
		expect(outputsOf(tp, yId).xRaw.length).toBe(7);
		tp.args.diffStep = true;
		await settle();
		expect(outputsOf(tp, yId).xRaw.length).toBe(25);
		tp.args.stepSize = 2;
		await settle();
		expect(outputsOf(tp, yId).xRaw.length).toBe(13);
	});
});

describe('binnedDataHash', () => {
	const base = {
		xIN: -1,
		yIN: [],
		binMode: 'uniform',
		binSize: 4,
		binStart: 0,
		stepSize: 1,
		diffStep: true,
		aggFunction: 'mean',
		cuts: []
	};
	const hash = (over) => binnedDataHash({ ...base, ...over });

	it.each([
		['binSize', { binSize: 5 }],
		['binStart', { binStart: 1 }],
		['stepSize', { stepSize: 2 }],
		['diffStep', { diffStep: false }],
		['aggFunction', { aggFunction: 'max' }],
		['binMode', { binMode: 'cuts' }],
		['cuts', { cuts: [0, 1] }],
		['binSize and binStart with the same sum', { binSize: 3, binStart: 1 }],
		['binSize and stepSize with the same sum', { binSize: 3, stepSize: 2 }]
	])('changes with %s', (_name, over) => {
		expect(hash(over)).not.toBe(hash({}));
	});

	it('is stable for identical args', () => {
		expect(hash({})).toBe(hash({}));
	});
});
