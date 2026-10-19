// Join Data, the maths (utils/joinData.js). Synthetic series only, normal and edge cases.
import { describe, it, expect } from 'vitest';
import {
	joinData,
	stackData,
	ONE_TIME_ERROR,
	timeKind,
	timeKindProblem,
	joinTooLargeWarning,
	shiftAmount,
	joinSummary,
	suggestedBinSize,
	MAX_JOIN_ROWS,
	RARE_SHARED_FRACTION
} from './joinData.js';

const H = 3600000;
const T0 = Date.UTC(2024, 0, 1);
const hours = (...hs) => hs.map((h) => T0 + h * H);

/** A (time + one value column 'a') against B (time + one value column 'b'), paired or not. */
function run({ tA, vA, tB, vB, paired = true, types = {}, ...rest }) {
	const outputs = paired
		? [{ key: 'joined_1', aId: 1, bId: 2 }]
		: [
				{ key: 'joined_1', aId: 1, bId: null },
				{ key: 'joined_2', aId: null, bId: 2 }
			];
	return joinData({
		timeA: tA,
		timeB: tB,
		kind: 'time',
		dataOf: { 1: vA, 2: vB },
		typeOf: { 1: types.a ?? 'number', 2: types.b ?? 'number' },
		outputs,
		...rest
	});
}

describe('every row of A and of B, sorted by time', () => {
	it('same rates, identical times: two rows per time, A first', () => {
		const r = run({ tA: hours(0, 1, 2), vA: [1, 2, 3], tB: hours(0, 1, 2), vB: [10, 20, 30] });
		expect(r.time).toEqual(hours(0, 0, 1, 1, 2, 2));
		expect(r.source).toEqual(['A', 'B', 'A', 'B', 'A', 'B']);
		expect(r.columns.joined_1).toEqual([1, 10, 2, 20, 3, 30]);
		expect(r.counts).toMatchObject({ rows: 6, fromA: 3, fromB: 3, sharedTimes: 3, sharedRows: 6 });
		expect(r.rareShared).toBe(false);
	});

	it('different rates (1 h against 15 min): every row kept, interleaved by time', () => {
		const tB = Array.from({ length: 8 }, (_, i) => T0 + i * 15 * 60000);
		const r = run({ tA: hours(0, 1), vA: [5, 6], tB, vB: [0, 1, 2, 3, 4, 5, 6, 7] });
		expect(r.counts.rows).toBe(10);
		expect(r.time).toEqual([...r.time].sort((a, b) => a - b));
		// 00:00 and 01:00 are in both; A's row comes first at each.
		expect(r.source.slice(0, 2)).toEqual(['A', 'B']);
		expect(r.columns.joined_1).toEqual([5, 0, 1, 2, 3, 6, 4, 5, 6, 7]);
		expect(r.counts.sharedTimes).toBe(2);
	});

	it('partial overlap', () => {
		const r = run({
			tA: hours(0, 1, 2, 3),
			vA: [1, 2, 3, 4],
			tB: hours(2, 3, 4, 5),
			vB: [7, 8, 9, 10]
		});
		expect(r.time).toEqual(hours(0, 1, 2, 2, 3, 3, 4, 5));
		expect(r.columns.joined_1).toEqual([1, 2, 3, 7, 4, 8, 9, 10]);
		expect(r.counts.sharedTimes).toBe(2);
	});

	it('no overlap: A then B, nothing shared', () => {
		const r = run({ tA: hours(0, 1), vA: [1, 2], tB: hours(5, 6), vB: [3, 4] });
		expect(r.source).toEqual(['A', 'A', 'B', 'B']);
		expect(r.counts.sharedTimes).toBe(0);
		expect(r.rareShared).toBe(true);
	});

	it('B entirely before A: B rows come first', () => {
		const r = run({ tA: hours(10, 11), vA: [1, 2], tB: hours(0, 1), vB: [3, 4] });
		expect(r.source).toEqual(['B', 'B', 'A', 'A']);
		expect(r.columns.joined_1).toEqual([3, 4, 1, 2]);
	});

	it('unsorted inputs come out sorted, each value still beside its own time', () => {
		const r = run({ tA: hours(2, 0, 1), vA: [12, 10, 11], tB: hours(1.5, 0.5), vB: [21.5, 20.5] });
		expect(r.time).toEqual(hours(0, 0.5, 1, 1.5, 2));
		expect(r.columns.joined_1).toEqual([10, 20.5, 11, 21.5, 12]);
	});

	it('repeated times within one input stay separate rows, in their own order', () => {
		const r = run({
			tA: hours(1, 0, 1),
			vA: ['first', 'zero', 'second'],
			tB: hours(1),
			vB: ['b'],
			types: { a: 'category', b: 'category' }
		});
		expect(r.time).toEqual(hours(0, 1, 1, 1));
		expect(r.columns.joined_1).toEqual(['zero', 'first', 'second', 'b']);
		expect(r.source).toEqual(['A', 'A', 'A', 'B']);
	});
});

describe('missing times and values', () => {
	it('a row with no time is dropped and counted; a missing value is null, never 0', () => {
		const r = run({
			tA: [T0, null, T0 + 2 * H, NaN, ''],
			vA: [1, 2, null, 4, 5],
			tB: [T0 + H, ' ', T0 + 3 * H],
			vB: ['', 7, 8]
		});
		expect(r.counts).toMatchObject({ rows: 4, fromA: 2, fromB: 2, droppedA: 3, droppedB: 1 });
		expect(r.time).toEqual(hours(0, 1, 2, 3));
		expect(r.columns.joined_1).toEqual([1, null, null, 8]);
		expect(r.columns.joined_1).not.toContain(0);
	});

	it('text in a number column is missing; in a category column it is the label', () => {
		const num = run({ tA: hours(0), vA: ['abc'], tB: hours(1), vB: ['2.5'] });
		expect(num.columns.joined_1).toEqual([null, '2.5']);
		const cat = run({
			tA: hours(0, 1),
			vA: ['abc', '  '],
			tB: hours(2),
			vB: ['NaN'],
			types: { a: 'category', b: 'category' }
		});
		expect(cat.columns.joined_1).toEqual(['abc', null, null]);
	});

	it('a real 0 is kept as 0', () => {
		const r = run({ tA: hours(0), vA: [0], tB: hours(1), vB: [0] });
		expect(r.columns.joined_1).toEqual([0, 0]);
	});

	it('a value column shorter than its time column reads blank past its end', () => {
		const r = run({ tA: hours(0, 1, 2), vA: [1], tB: hours(3), vB: [] });
		expect(r.columns.joined_1).toEqual([1, null, null, null]);
	});
});

describe('paired and unpaired value columns', () => {
	it('unpaired: A values blank on B rows, B values blank on A rows', () => {
		const r = run({ tA: hours(0, 2), vA: [1, 3], tB: hours(1), vB: [20], paired: false });
		expect(r.columns.joined_1).toEqual([1, null, 3]);
		expect(r.columns.joined_2).toEqual([null, 20, null]);
	});

	it('A with no value columns at all still contributes its rows', () => {
		const r = joinData({
			timeA: hours(0),
			timeB: hours(1),
			kind: 'time',
			dataOf: { 2: [5] },
			outputs: [{ key: 'joined_2', aId: null, bId: 2 }]
		});
		expect(r.time).toEqual(hours(0, 1));
		expect(r.columns.joined_2).toEqual([null, 5]);
	});
});

describe('empty and tiny inputs', () => {
	it('empty B: the output is A', () => {
		const r = run({ tA: hours(0, 1), vA: [1, 2], tB: [], vB: [] });
		expect(r.ok).toBe(true);
		expect(r.source).toEqual(['A', 'A']);
		expect(r.rareShared).toBe(false); // nothing to line up with
	});
	it('empty A: the output is B', () => {
		const r = run({ tA: [], vA: [], tB: hours(0), vB: [9] });
		expect(r.columns.joined_1).toEqual([9]);
	});
	it('both empty: not valid (nothing to show)', () => {
		expect(run({ tA: [], vA: [], tB: [], vB: [] }).ok).toBe(false);
	});
	it('single-row inputs', () => {
		const r = run({ tA: hours(3), vA: [1], tB: hours(3), vB: [2] });
		expect(r.time).toEqual(hours(3, 3));
		expect(r.columns.joined_1).toEqual([1, 2]);
	});
});

describe('time kinds', () => {
	it('time and time, number and number (bin counts as a number) are allowed', () => {
		expect(timeKindProblem('time', 'time')).toBeNull();
		expect(timeKindProblem('number', 'number')).toBeNull();
		expect(timeKindProblem('bin', 'number')).toBeNull();
		expect(timeKind('bin')).toBe('number');
	});
	it('mixed time and number is refused, naming both', () => {
		const msg = timeKindProblem('time', 'number');
		expect(msg).toMatch(/Time A is a time column and time B is a number column/);
		expect(timeKindProblem('number', 'time')).toMatch(/Time A is a number column/);
	});
	it('a category time column is refused', () => {
		expect(timeKindProblem('category', 'time')).toMatch(/Time A is a category column/);
		expect(timeKindProblem('time', 'category')).toMatch(/Time B is a category column/);
	});
	it('numbers are joined as they are', () => {
		const r = joinData({
			timeA: [0, 1, 2],
			timeB: [0.5, 1.5],
			kind: 'number',
			dataOf: { 1: [1, 2, 3], 2: [4, 5] },
			outputs: [{ key: 'joined_1', aId: 1, bId: 2 }]
		});
		expect(r.time).toEqual([0, 0.5, 1, 1.5, 2]);
		expect(r.columns.joined_1).toEqual([1, 4, 2, 5, 3]);
	});
});

describe("shift B's clock", () => {
	it('is in hours for time columns, whole milliseconds', () => {
		expect(shiftAmount(1, 'time')).toBe(H);
		expect(shiftAmount(-2, 'time')).toBe(-2 * H);
		expect(shiftAmount(0.25, 'time')).toBe(15 * 60000);
		expect(shiftAmount(1.1, 'time')).toBe(3960000); // rounded, not 3960000.0000000005
		expect(shiftAmount(1 / 7, 'time')).toBe(514286);
		expect(shiftAmount('', 'time')).toBe(0);
		expect(shiftAmount(NaN, 'time')).toBe(0);
	});
	it('is in x units for numbers', () => {
		expect(shiftAmount(0.5, 'number')).toBe(0.5);
	});
	it('a positive shift moves B later', () => {
		const r = run({ tA: hours(1), vA: [1], tB: hours(0), vB: [2], shiftB: 2 });
		expect(r.time).toEqual(hours(1, 2));
		expect(r.source).toEqual(['A', 'B']);
	});
	it('a negative fractional shift moves B earlier, and can line B up with A', () => {
		const r = run({ tA: hours(0, 1), vA: [1, 2], tB: hours(0.5, 1.5), vB: [3, 4], shiftB: -0.5 });
		expect(r.time).toEqual(hours(0, 0, 1, 1));
		expect(r.counts.sharedTimes).toBe(2);
	});
	it('a numeric shift adds x units', () => {
		const r = joinData({
			timeA: [10],
			timeB: [0],
			kind: 'number',
			dataOf: {},
			outputs: [],
			shiftB: 10.5
		});
		expect(r.time).toEqual([10, 10.5]);
	});
});

describe('source labels', () => {
	it('default A and B, or the labels given', () => {
		expect(run({ tA: hours(0), vA: [1], tB: hours(1), vB: [2] }).source).toEqual(['A', 'B']);
		const r = run({
			tA: hours(0),
			vA: [1],
			tB: hours(1),
			vB: [2],
			sourceLabels: ['hive', 'weather']
		});
		expect(r.source).toEqual(['hive', 'weather']);
	});
});

describe('UTC, no daylight saving inside the join', () => {
	it('zone-less wall-clock instants either side of a DST date keep exact hourly steps', () => {
		// 2024-03-31 01:00 is the EU spring-forward hour; as UTC ms it is just another hour.
		const base = Date.UTC(2024, 2, 31, 0);
		const tA = [0, 1, 2, 3].map((h) => base + h * H);
		const tB = [0.5, 1.5, 2.5].map((h) => base + h * H);
		const r = run({ tA, vA: [1, 2, 3, 4], tB, vB: [5, 6, 7] });
		const steps = r.time.slice(1).map((t, i) => t - r.time[i]);
		expect(steps).toEqual(Array(6).fill(H / 2));
	});
});

describe('the Bin Data hint', () => {
	it(`shows when fewer than ${RARE_SHARED_FRACTION * 100}% of rows share a time`, () => {
		// 20 A rows, 20 B rows, one shared time: 2 of 40 rows (5%).
		const tA = Array.from({ length: 20 }, (_, i) => T0 + i * H);
		const tB = Array.from({ length: 20 }, (_, i) => T0 + i * H + (i === 0 ? 0 : 7 * 60000));
		const r = run({ tA, vA: tA.map(() => 1), tB, vB: tB.map(() => 2) });
		expect(r.counts.sharedRows).toBe(2);
		expect(r.rareShared).toBe(true);
	});
	it('does not show at exactly 10%', () => {
		// 4 of 40 rows share a time.
		const tA = Array.from({ length: 20 }, (_, i) => T0 + i * H);
		const tB = Array.from({ length: 20 }, (_, i) => T0 + i * H + (i < 2 ? 0 : 7 * 60000));
		const r = run({ tA, vA: tA.map(() => 1), tB, vB: tB.map(() => 2) });
		expect(r.counts.sharedRows / r.counts.rows).toBe(0.1);
		expect(r.rareShared).toBe(false);
	});
	it('the suggested bin is the coarser sampling interval', () => {
		expect(suggestedBinSize(1, 0.25)).toBe(1);
		expect(suggestedBinSize(NaN, 0.25)).toBe(0.25);
		expect(suggestedBinSize(NaN, NaN)).toBe(1);
	});
});

describe('the 2,000,000-row limit, both sides', () => {
	it('the wording matches the shared limit style', () => {
		expect(joinTooLargeWarning(MAX_JOIN_ROWS)).toBeNull();
		expect(joinTooLargeWarning(MAX_JOIN_ROWS + 1)).toBe(
			'Nothing was joined: A and B together have 2,000,001 rows with a time, more than the ' +
				'limit of 2,000,000. Bin or filter one of them first.'
		);
	});

	it('exactly 2,000,000 rows join', () => {
		const n = MAX_JOIN_ROWS / 2;
		const tA = new Array(n);
		const tB = new Array(n);
		for (let i = 0; i < n; i++) {
			tA[i] = i * 2;
			tB[i] = i * 2 + 1;
		}
		const r = joinData({ timeA: tA, timeB: tB, kind: 'number', dataOf: {}, outputs: [] });
		expect(r.ok).toBe(true);
		expect(r.time.length).toBe(MAX_JOIN_ROWS);
		expect(r.time[MAX_JOIN_ROWS - 1]).toBe(MAX_JOIN_ROWS - 1);
	}, 30000);

	it('2,000,001 rows are refused, with nothing joined', () => {
		const tA = new Array(MAX_JOIN_ROWS / 2).fill(0);
		const tB = new Array(MAX_JOIN_ROWS / 2 + 1).fill(0);
		const r = joinData({ timeA: tA, timeB: tB, kind: 'number', dataOf: {}, outputs: [] });
		expect(r.ok).toBe(false);
		expect(r.time).toBeUndefined();
		expect(r.error).toMatch(/2,000,001 rows/);
	});

	it('rows without a time do not count towards the limit', () => {
		const tA = new Array(MAX_JOIN_ROWS).fill(null);
		tA[0] = 0;
		const r = joinData({ timeA: tA, timeB: [1, 2], kind: 'number', dataOf: {}, outputs: [] });
		expect(r.ok).toBe(true);
		expect(r.counts.droppedA).toBe(MAX_JOIN_ROWS - 1);
	});
});

describe('joinSummary', () => {
	it('reads like the spec', () => {
		expect(
			joinSummary({ rows: 580, fromA: 290, fromB: 290, sharedTimes: 30, droppedA: 0, droppedB: 0 })
		).toBe('580 rows: 290 from A, 290 from B; 30 times appear in both.');
	});
	it('says how many rows had no time', () => {
		expect(
			joinSummary({ rows: 3, fromA: 2, fromB: 1, sharedTimes: 1, droppedA: 2, droppedB: 1 })
		).toBe(
			'3 rows: 2 from A, 1 from B; 1 time appears in both. Rows with no time (2 in A, 1 in B) were left out.'
		);
		expect(
			joinSummary({ rows: 1, fromA: 1, fromB: 0, sharedTimes: 0, droppedA: 0, droppedB: 1 })
		).toBe(
			'1 row: 1 from A, 0 from B; 0 times appear in both. A row with no time (1 in B) was left out.'
		);
	});
});

describe('stackData (no times: A then B)', () => {
	const outs = [
		{ key: 'joined_1', aId: 1, bId: 3 },
		{ key: 'joined_2', aId: 2, bId: null },
		{ key: 'joined_4', aId: null, bId: 4 }
	];
	it("keeps A's rows in input order, then B's, values NOT sorted", () => {
		const res = stackData({
			aIds: [1, 2],
			bIds: [3, 4],
			dataOf: { 1: [5, 1, 3], 2: [9, 8, 7], 3: [0.5, 10], 4: ['p', 'q'] },
			typeOf: { 4: 'category' },
			outputs: outs
		});
		expect(res.ok).toBe(true);
		expect(res.columns.joined_1).toEqual([5, 1, 3, 0.5, 10]);
		expect(res.columns.joined_2).toEqual([9, 8, 7, null, null]);
		expect(res.columns.joined_4).toEqual([null, null, null, 'p', 'q']);
		expect(res.source).toEqual(['A', 'A', 'A', 'B', 'B']);
		expect(res.time).toBeUndefined();
		expect(res.counts).toEqual({ rows: 5, fromA: 3, fromB: 2, stacked: true });
		expect(joinSummary(res.counts)).toBe('5 rows: 3 from A, 2 from B.');
	});
	it("a dataset has its longest column's rows; shorter columns and missing cells are blank, never dropped", () => {
		const res = stackData({
			aIds: [1, 2],
			bIds: [3],
			dataOf: { 1: [1, null, 3], 2: [NaN], 3: ['', 7] },
			outputs: outs.slice(0, 2),
			sourceLabels: ['g1', 'g2']
		});
		expect(res.columns.joined_1).toEqual([1, null, 3, null, 7]);
		expect(res.columns.joined_2).toEqual([null, null, null, null, null]);
		expect(res.source).toEqual(['g1', 'g1', 'g1', 'g2', 'g2']);
	});
	it('an empty A or an empty B stacks the other alone; single rows work', () => {
		const onlyB = stackData({
			aIds: [],
			bIds: [3],
			dataOf: { 3: [4] },
			outputs: [{ key: 'joined_3', aId: null, bId: 3 }]
		});
		expect(onlyB.columns.joined_3).toEqual([4]);
		expect(onlyB.source).toEqual(['B']);
		const emptyB = stackData({
			aIds: [1],
			bIds: [3],
			dataOf: { 1: [2.5], 3: [] },
			outputs: [{ key: 'joined_1', aId: 1, bId: 3 }]
		});
		expect(emptyB.columns.joined_1).toEqual([2.5]);
		expect(joinSummary(emptyB.counts)).toBe('1 row: 1 from A, 0 from B.');
		const none = stackData({ aIds: [], bIds: [], outputs: [] });
		expect(none.ok).toBe(false);
	});
	it('refuses more rows than the limit, without "with a time"', () => {
		const res = stackData({
			aIds: [1],
			bIds: [3],
			dataOf: { 1: [1, 2], 3: [3] },
			outputs: [{ key: 'joined_1', aId: 1, bId: 3 }],
			maxRows: 2
		});
		expect(res.ok).toBe(false);
		expect(res.error).toBe(
			'Nothing was joined: A and B together have 3 rows, more than the limit of 2. Bin or filter one of them first.'
		);
	});
	it('the one-time refusal wording', () => {
		expect(ONE_TIME_ERROR).toBe('Wire a time for both datasets, or for neither.');
	});
});
