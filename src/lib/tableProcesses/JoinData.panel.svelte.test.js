// @ts-nocheck
// Join Data, the mounted panel: it creates its output columns on a free node, reuses them when
// an input is swapped in place, recomputes when an input cell is edited, adds and removes the
// Source column, follows the pairing select, and its Bin Data button adds one wired node as one
// undo step. Real columns and real nodes; synthetic data.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { core, appConsts, appState } from '$lib/core/core.svelte.js';
import { Column, getColumnById } from '$lib/core/Column.svelte';
import { memoClear } from '$lib/core/computeMemo.js';
import { history } from '$lib/core/opHistory.svelte.js';
import { mutationService as M } from '$lib/core/mutationService.js';
import { buildTableProcessDefaults } from '$lib/core/tpDefaults.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';
import JoinData from './JoinData.svelte';

const H = 3600000;
const T0 = Date.UTC(2024, 5, 1);

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
	history.init();
}, 120000);

beforeEach(() => {
	core.data.length = 0;
	core.plots.length = 0;
	core.tableProcesses.length = 0;
	core.orphanProcesses.length = 0;
	core.groups.length = 0;
	core.rawData = new Map();
	history.clear();
});
afterEach(() => {
	cleanup();
	memoClear();
});

const settle = async () => {
	for (let i = 0; i < 3; i++) {
		flushSync();
		await tick();
		await new Promise((r) => queueMicrotask(r));
		await new Promise((r) => setTimeout(r, 0));
	}
	flushSync();
};

function mkCol(type, values, name) {
	const c = new Column({ type, data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

const data = (id) => getColumnById(id)?.getData();

/** A free Join Data node added the way the palette adds one, then wired. */
function freeJoin(wiring) {
	const entry = appConsts.tableProcessMap.get('JoinData');
	return M.addFreeTableProcess('JoinData', { ...buildTableProcessDefaults(entry), ...wiring });
}

function hourlyAndQuarter() {
	const tA = mkCol(
		'time',
		[0, 1, 2, 3].map((h) => T0 + h * H),
		'time'
	);
	const a = mkCol('number', [1, 2, 3, 4], 'temp');
	const a2 = mkCol('number', [5, 6, 7, 8], 'light');
	const tB = mkCol(
		'time',
		Array.from({ length: 12 }, (_, i) => T0 + 5 * 60000 + i * 15 * 60000),
		'time'
	);
	const b = mkCol(
		'number',
		Array.from({ length: 12 }, (_, i) => 20 + i),
		'TEMP'
	);
	const b2 = mkCol(
		'number',
		Array.from({ length: 12 }, (_, i) => 40 + i),
		'rh'
	);
	return { tA, a, a2, tB, b, b2 };
}

describe('Join Data panel', () => {
	it('creates its output columns on a free node and fills them', async () => {
		const { tA, a, tB, b, b2 } = hourlyAndQuarter();
		const tp = freeJoin({ aTimeIN: tA, aValuesIN: [a], bTimeIN: tB, bValuesIN: [b, b2] });
		expect(Object.keys(tp.args.out)).toEqual([]);
		render(JoinData, { props: { p: tp } });
		await settle();
		expect(Object.keys(tp.args.out).sort()).toEqual(
			['jointime', `joined_${a}`, `joined_${b2}`].sort()
		);
		expect(data(tp.args.out.jointime).length).toBe(16);
		expect(data(tp.args.out[`joined_${a}`]).slice(0, 3)).toEqual([1, 20, 21]);
		expect(tp.args.valid).toBe(true);
	});

	it('the summary and the Bin Data hint show; the button adds one wired Bin Data, one undo step', async () => {
		const { tA, a, tB, b, b2 } = hourlyAndQuarter();
		const tp = freeJoin({ aTimeIN: tA, aValuesIN: [a], bTimeIN: tB, bValuesIN: [b, b2] });
		const { getByText } = render(JoinData, { props: { p: tp } });
		await settle();
		getByText('16 rows: 4 from A, 12 from B; 0 times appear in both.');
		getByText(
			'A and B rarely share a time. To compare them row by row, add Bin Data after this node.'
		);
		history.clear();
		const before = core.tableProcesses.length;
		await fireEvent.click(getByText('+ Add Bin Data'));
		await settle();
		const bin = core.tableProcesses.find((t) => t.name === 'BinnedData');
		expect(core.tableProcesses.length).toBe(before + 1);
		expect(bin.args.xIN).toBe(tp.args.out.jointime);
		expect(bin.args.yIN).toEqual([tp.args.out[`joined_${a}`], tp.args.out[`joined_${b2}`]]);
		// Selected and brought into view on the canvas.
		expect(appState.focusNodeRequest?.id).toBe(`tableprocess_${bin.id}`);
		// The coarser of the two sampling intervals: A's hour.
		expect(bin.args.binSize).toBe(1);
		expect(bin.args.stepSize).toBe(1);
		expect(data(bin.args.out[`binnedy_${tp.args.out[`joined_${a}`]}`])[0]).toBeCloseTo(
			(1 + 20 + 21 + 22 + 23) / 5,
			10
		);
		history.undo();
		await settle();
		expect(core.tableProcesses.find((t) => t.name === 'BinnedData')).toBeUndefined();
		expect(core.tableProcesses.length).toBe(before);
	});

	it('no hint when A and B share their times', async () => {
		const tA = mkCol('number', [0, 1, 2], 'x');
		const tB = mkCol('number', [0, 1, 2], 'x');
		const tp = freeJoin({ aTimeIN: tA, aValuesIN: [], bTimeIN: tB, bValuesIN: [] });
		const { queryByText, getByText } = render(JoinData, { props: { p: tp } });
		await settle();
		expect(queryByText('+ Add Bin Data')).toBeNull();
		getByText(
			'Numbers are joined as they are: both time columns must count from the same origin in the same units.'
		);
		getByText("Shift B's x by (x units)");
	});

	it('reuses the output column when a value input is swapped in place', async () => {
		const { tA, a, a2, tB, b } = hourlyAndQuarter();
		const tp = freeJoin({ aTimeIN: tA, aValuesIN: [a], bTimeIN: tB, bValuesIN: [b] });
		render(JoinData, { props: { p: tp } });
		await settle();
		const outId = tp.args.out[`joined_${a}`];
		tp.args.aValuesIN = [a2];
		await settle();
		expect(tp.args.out[`joined_${a}`]).toBeUndefined();
		expect(tp.args.out[`joined_${a2}`]).toBe(outId);
		expect(data(outId).slice(0, 2)).toEqual([5, null]);
	});

	it('recomputes when an input cell is edited', async () => {
		const { tA, a, tB, b } = hourlyAndQuarter();
		const tp = freeJoin({ aTimeIN: tA, aValuesIN: [a], bTimeIN: tB, bValuesIN: [b] });
		render(JoinData, { props: { p: tp } });
		await settle();
		M.setRawCell(a, 0, 99);
		await settle();
		expect(data(tp.args.out[`joined_${a}`])[0]).toBe(99);
	});

	it('the Source checkbox adds and removes the Source column', async () => {
		const { tA, a, tB, b } = hourlyAndQuarter();
		const tp = freeJoin({ aTimeIN: tA, aValuesIN: [a], bTimeIN: tB, bValuesIN: [b] });
		const { getByLabelText } = render(JoinData, { props: { p: tp } });
		await settle();
		expect(tp.args.out.source).toBeUndefined();
		await fireEvent.click(getByLabelText(/Add a Source column/));
		await settle();
		const srcId = tp.args.out.source;
		expect(data(srcId).slice(0, 3)).toEqual(['A', 'B', 'B']);
		await fireEvent.click(getByLabelText(/Add a Source column/));
		await settle();
		expect(tp.args.out.source).toBeUndefined();
		expect(getColumnById(srcId)).toBeFalsy();
	});

	it('the pairing select makes a same-named B column separate, and back', async () => {
		const { tA, a, tB, b } = hourlyAndQuarter();
		const tp = freeJoin({ aTimeIN: tA, aValuesIN: [a], bTimeIN: tB, bValuesIN: [b] });
		const { container, getByText } = render(JoinData, { props: { p: tp } });
		await settle();
		const select = [...container.querySelectorAll('select')].find((s) =>
			[...s.options].some((o) => o.textContent === 'Its own column')
		);
		expect([...select.options].map((o) => o.textContent)).toEqual([
			"A's 'temp' (by name)",
			"A's 'temp'",
			'Its own column'
		]);
		expect(select.title).toBe("A's 'temp' (by name)");
		getByText('Which column does each B column go into?');
		getByText(
			"Columns with the same name share one column; choose 'Its own column' to keep them apart."
		);
		await fireEvent.change(select, { target: { value: '-1' } });
		await settle();
		expect(tp.args.pairing).toEqual({ [b]: -1 });
		expect(select.title).toBe('Its own column');
		expect(tp.args.out[`joined_${b}`]).toBeGreaterThanOrEqual(0);
		expect(data(tp.args.out[`joined_${b}`]).slice(0, 2)).toEqual([null, 20]);
		await fireEvent.change(select, { target: { value: 'auto' } });
		await settle();
		expect(tp.args.pairing).toEqual({});
		expect(tp.args.out[`joined_${b}`]).toBeUndefined();
	});

	it('shows the refusal for mixed time kinds', async () => {
		const tA = mkCol('time', [T0], 'time');
		const tB = mkCol('number', [0], 'hours');
		const tp = freeJoin({ aTimeIN: tA, aValuesIN: [], bTimeIN: tB, bValuesIN: [] });
		const { getByText } = render(JoinData, { props: { p: tp } });
		await settle();
		getByText(/Time A is a time column and time B is a number column/);
		expect(tp.args.valid).toBe(false);
		expect(tp.warnings[0]).toMatch(/Time A is a time column/);
	});

	it('stack mode: no time controls, the stacked output, Source ticked by default', async () => {
		const a = mkCol('number', [3, 1, 2], 'amplitude');
		const b = mkCol('number', [9, 8], 'amplitude');
		const tp = freeJoin({ aValuesIN: [a], bValuesIN: [b] });
		expect(tp.args.sourceColumn).toBeNull();
		const { getByText, queryByText, getByLabelText, container } = render(JoinData, {
			props: { p: tp }
		});
		await settle();
		expect(tp.args.valid).toBe(true);
		expect(Object.keys(tp.args.out).sort()).toEqual([`joined_${a}`, 'source'].sort());
		expect(data(tp.args.out[`joined_${a}`])).toEqual([3, 1, 2, 9, 8]);
		expect(data(tp.args.out.source)).toEqual(['A', 'A', 'A', 'B', 'B']);
		getByText('5 rows: 3 from A, 2 from B.');
		getByText("No time is wired, so A's rows come first, then B's, each in their own order.");
		expect(queryByText(/Shift B's/)).toBeNull();
		expect(queryByText('+ Add Bin Data')).toBeNull();
		expect(queryByText(/rarely share a time/)).toBeNull();
		expect(getByLabelText(/Add a Source column/).checked).toBe(true);
		// The source still null: following the mode, not a stored choice.
		expect(tp.args.sourceColumn).toBeNull();
		expect(container.querySelector('.warn')).toBeNull();
	});

	it('one time wired alone shows the refusal and empties the outputs', async () => {
		const t = mkCol('number', [0, 1, 2], 'x');
		const a = mkCol('number', [3, 1, 2], 'v');
		const tp = freeJoin({ aValuesIN: [a], bValuesIN: [] });
		const { getByText } = render(JoinData, { props: { p: tp } });
		await settle();
		const outId = tp.args.out[`joined_${a}`];
		expect(data(outId)).toEqual([3, 1, 2]);
		tp.args.aTimeIN = t;
		await settle();
		getByText('Wire a time for both datasets, or for neither.');
		expect(tp.args.valid).toBe(false);
		expect(tp.warnings).toEqual(['Wire a time for both datasets, or for neither.']);
		expect(tp.args.out[`joined_${a}`]).toBe(outId);
		expect(data(outId)).toEqual([]);
	});

	it('time -> stack -> time by unwiring and rewiring: value outputs reused, no orphans', async () => {
		const { tA, a, tB, b, b2 } = hourlyAndQuarter();
		const tp = freeJoin({ aTimeIN: tA, aValuesIN: [a], bTimeIN: tB, bValuesIN: [b, b2] });
		render(JoinData, { props: { p: tp } });
		await settle();
		const ids0 = { a: tp.args.out[`joined_${a}`], b2: tp.args.out[`joined_${b2}`] };
		const time0 = tp.args.out.jointime;
		const nCols = core.data.length;
		expect(tp.args.out.source).toBeUndefined();

		// Unwire A's time (refused), then B's: stacking.
		tp.args.aTimeIN = -1;
		await settle();
		expect(tp.args.out.jointime).toBe(time0); // kept while only one time is unwired
		tp.args.bTimeIN = -1;
		await settle();
		expect(tp.args.valid).toBe(true);
		expect(tp.args.out.jointime).toBeUndefined();
		expect(getColumnById(time0)).toBeFalsy();
		expect(tp.args.out[`joined_${a}`]).toBe(ids0.a);
		expect(tp.args.out[`joined_${b2}`]).toBe(ids0.b2);
		expect(data(ids0.a)).toEqual([1, 2, 3, 4, ...Array.from({ length: 12 }, (_, i) => 20 + i)]);
		// Source on by default when stacking: one new column, the time column gone.
		expect(tp.args.out.source).toBeGreaterThanOrEqual(0);
		expect(core.data.length).toBe(nCols);

		// Rewire both times: back to time mode, Source back off (never chosen), time column anew.
		tp.args.aTimeIN = tA;
		tp.args.bTimeIN = tB;
		await settle();
		expect(tp.args.valid).toBe(true);
		expect(tp.args.out.source).toBeUndefined();
		expect(tp.args.out.jointime).toBeGreaterThanOrEqual(0);
		expect(tp.args.out[`joined_${a}`]).toBe(ids0.a);
		expect(tp.args.out[`joined_${b2}`]).toBe(ids0.b2);
		expect(data(tp.args.out.jointime).length).toBe(16);
		expect(core.data.length).toBe(nCols);
		// Every output id is a live column, and no node-made column is left without a key.
		const outIds = Object.values(tp.args.out);
		for (const id of outIds) expect(getColumnById(id)).toBeTruthy();
		const made = core.data.filter((c) => /^(jointime|joined_\d+|source)_/.test(c.name ?? ''));
		expect(made.map((c) => c.id).sort()).toEqual([...outIds].sort());
	});

	it('an explicit Source choice is kept when the mode changes by wiring', async () => {
		const { tA, a, tB, b } = hourlyAndQuarter();
		const tp = freeJoin({ aValuesIN: [a], bValuesIN: [b] });
		const { getByLabelText } = render(JoinData, { props: { p: tp } });
		await settle();
		const box = () => getByLabelText(/Add a Source column/);
		expect(box().checked).toBe(true);
		await fireEvent.click(box()); // untick while stacking
		await settle();
		expect(tp.args.sourceColumn).toBe(false);
		expect(tp.args.out.source).toBeUndefined();
		tp.args.aTimeIN = tA;
		tp.args.bTimeIN = tB;
		await settle();
		expect(box().checked).toBe(false);
		await fireEvent.click(box()); // tick in time mode
		await settle();
		expect(tp.args.sourceColumn).toBe(true);
		tp.args.aTimeIN = -1;
		tp.args.bTimeIN = -1;
		await settle();
		expect(box().checked).toBe(true);
		expect(tp.args.sourceColumn).toBe(true);
		expect(data(tp.args.out.source).slice(0, 5)).toEqual(['A', 'A', 'A', 'A', 'B']);
	});

	it('keeps the outputs in order (values, then Source) when Source came first', async () => {
		const a = mkCol('number', [1, 2], 'amp');
		const a2 = mkCol('number', [3, 4], 'phase');
		const tp = freeJoin({ aValuesIN: [a], bValuesIN: [] });
		render(JoinData, { props: { p: tp } });
		await settle();
		expect(Object.keys(tp.args.out)).toEqual([`joined_${a}`, 'source']);
		const ids = { ...tp.args.out };
		tp.args.aValuesIN = [a, a2];
		await settle();
		expect(Object.keys(tp.args.out)).toEqual([`joined_${a}`, `joined_${a2}`, 'source']);
		expect(tp.args.out.source).toBe(ids.source);
		expect(tp.args.out[`joined_${a}`]).toBe(ids[`joined_${a}`]);
	});
});
