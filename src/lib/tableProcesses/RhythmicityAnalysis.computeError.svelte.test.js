// ROB-11, reproduced on a real node: an analysis whose compute THROWS.
//
// Before: `calculating` was set true and only cleared after a successful await, so the
// node showed "Running analysis…" forever; the previous result stayed in the panel and in
// the output columns; and nothing on screen said anything had gone wrong.
/* global $state */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';

const mockColumns = {};
const rawData = new Map();
vi.mock('$lib/core/core.svelte', () => ({
	core: { rawData, data: [], groups: [], plots: [], tableProcesses: [], storedValues: {} },
	appConsts: { processMap: new Map() },
	pushObj: () => {},
	uniqueStoredValueName: (n) => n,
	storeValue: () => {},
	removeStoredValue: () => {}
}));
vi.mock('$lib/core/core.svelte.js', () => ({
	core: { rawData, data: [], groups: [], plots: [], tableProcesses: [], storedValues: {} },
	appConsts: { processMap: new Map() },
	pushObj: () => {},
	uniqueStoredValueName: (n) => n,
	storeValue: () => {},
	removeStoredValue: () => {}
}));
vi.mock('$lib/core/Column.svelte', async () => {
	const actual = await vi.importActual('$lib/core/Column.svelte').catch(() => ({}));
	return { ...actual, getColumnById: (id) => mockColumns[id], default: actual.default };
});

const RhythmicityAnalysis = (await import('./RhythmicityAnalysis.svelte')).default;
const { memoClear } = await import('$lib/core/computeMemo.js');

const t = Array.from({ length: 240 }, (_, i) => i);
const y = t.map((h) => 10 + 5 * Math.cos((2 * Math.PI * h) / 24));
let failWith = null;
let reads = 0;

function mkCol(id, name, getData) {
	mockColumns[id] = { id, name, type: 'number', data: id, getData, getDataHash: `h${id}` };
}

beforeEach(() => {
	memoClear();
	rawData.clear();
	failWith = null;
	reads = 0;
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	mkCol(1, 't', () => t);
	mkCol(2, 'y', () => {
		reads++;
		if (failWith) throw failWith;
		return y;
	});
	// The node's output columns already exist, so no column has to be created.
	mkCol(10, 'rhythmicityx_7', () => rawData.get(10) ?? []);
	mkCol(11, 'rhythmicityy_y', () => rawData.get(11) ?? []);
	rawData.set(10, [20, 21, 22]);
	rawData.set(11, [0.1, 0.9, 0.2]); // a PREVIOUS result, stale for the current inputs
	vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

const settle = async () => {
	for (let i = 0; i < 4; i++) {
		flushSync();
		await tick();
		await new Promise((r) => setTimeout(r, 0));
	}
};

function mkProcess() {
	const p = $state({
		id: 7,
		name: 'RhythmicityAnalysis',
		warnings: [],
		args: {
			xIN: 1,
			yIN: [2],
			analysis: 'periodogram',
			pgMethod: 'Lomb-Scargle',
			periodMin: 20,
			periodMax: 28,
			periodStep: 0.5,
			out: { rhythmicityx: 10, rhythmicityy_2: 11 },
			valid: true
		}
	});
	return p;
}

describe('RhythmicityAnalysis when the compute throws (ROB-11)', () => {
	it('stops spinning, says what failed, clears the stale outputs, and Retry recomputes', async () => {
		failWith = new RangeError('Invalid array length');
		const p = mkProcess();
		const { container, getByRole } = render(RhythmicityAnalysis, {
			props: { p, hideInputs: true }
		});
		await settle();

		expect(container.textContent).not.toMatch(/Running analysis/);
		const alert = getByRole('alert');
		expect(alert.textContent).toMatch(/The analysis failed/);
		expect(alert.textContent).toMatch(/Invalid array length/);
		expect(p.args.valid).toBe(false);
		// The previous result is not left in the output columns for downstream nodes...
		expect(rawData.get(10)).toEqual([]);
		expect(rawData.get(11)).toEqual([]);
		// ...and the columns are re-stamped, which is what invalidates Column.getData()'s
		// cache (it keys on the stamp, not on rawData). Without it every reader kept the
		// old values, as the browser showed.
		expect(mockColumns[11].tableProcessGUId).toBeTruthy();

		failWith = null;
		await fireEvent.click(getByRole('button', { name: 'Try again' }));
		await settle();
		expect(container.querySelector('[role="alert"]')).toBeNull();
		expect(p.args.valid).toBe(true);
		expect(rawData.get(11).length).toBeGreaterThan(0);
	});

	it('the same inputs are tried again on the next mount (the failed hash is not kept)', async () => {
		failWith = new Error('boom');
		const p = mkProcess();
		const first = render(RhythmicityAnalysis, { props: { p, hideInputs: true } });
		await settle();
		const readsAfterFirst = reads;
		expect(readsAfterFirst).toBeGreaterThan(0);
		first.unmount();

		failWith = null;
		render(RhythmicityAnalysis, { props: { p, hideInputs: true } });
		await settle();
		expect(reads).toBeGreaterThan(readsAfterFirst);
		expect(p.args.valid).toBe(true);
	});
});
