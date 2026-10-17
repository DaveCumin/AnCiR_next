import { describe, it, expect } from 'vitest';
import {
	DEFAULT_OVERLAP_MODE,
	findTimeOverlaps,
	isMissingCell,
	mergeOverlappingRows,
	timeRange
} from './importOverlap.js';

// Two files concatenated: A has t = 1..4, B has t = 3..6 (3 and 4 overlap).
function twoFiles({ aVals = [10, 20, 30, 40], bVals = [30, 41, 50, 60] } = {}) {
	return {
		times: [1, 2, 3, 4, 3, 4, 5, 6],
		fileOf: [0, 0, 0, 0, 1, 1, 1, 1],
		data: {
			t: ['t1', 't2', 't3', 't4', 't3', 't4', 't5', 't6'],
			v: [...aVals, ...bVals]
		}
	};
}

describe('isMissingCell', () => {
	it('treats null, undefined, blank text and NaN as missing, and 0 as a value', () => {
		expect([null, undefined, '', '  ', NaN].every(isMissingCell)).toBe(true);
		expect([0, '0', 'a', false].some(isMissingCell)).toBe(false);
	});
});

describe('findTimeOverlaps', () => {
	it('no shared time: nothing to report', () => {
		const r = findTimeOverlaps({
			times: [1, 2, 3, 4],
			fileOf: [0, 0, 1, 1],
			data: { v: [1, 2, 3, 4] },
			compareColumns: ['v']
		});
		expect(r).toMatchObject({ times: 0, extraRows: 0, conflicts: 0, pairs: [] });
	});

	it('counts shared times, the rows merging removes, and the times whose values differ', () => {
		const r = findTimeOverlaps({ ...twoFiles(), compareColumns: ['v'] });
		expect(r.times).toBe(2);
		expect(r.extraRows).toBe(2);
		// t = 3: 30 vs 30 agree; t = 4: 40 vs 41 differ.
		expect(r.conflicts).toBe(1);
		expect(r.conflictCells).toBe(1);
		expect(r.pairs).toEqual([{ files: [0, 1], times: 2, conflicts: 1 }]);
	});

	it('a blank in one file is not a disagreement', () => {
		const r = findTimeOverlaps({
			...twoFiles({ aVals: [10, 20, null, ''], bVals: [30, 41, 50, 60] }),
			compareColumns: ['v']
		});
		expect(r.conflicts).toBe(0);
	});

	it('only the compared columns can disagree (the time columns are not compared)', () => {
		const r = findTimeOverlaps({ ...twoFiles(), compareColumns: [] });
		expect(r.times).toBe(2);
		expect(r.conflicts).toBe(0);
	});

	it('rows without a time are never matched', () => {
		const r = findTimeOverlaps({
			times: [NaN, 1, NaN, 2],
			fileOf: [0, 0, 1, 1],
			data: { v: [1, 2, 3, 4] },
			compareColumns: ['v']
		});
		expect(r.times).toBe(0);
	});

	it('a time repeated inside ONE file is not an overlap between files', () => {
		const r = findTimeOverlaps({
			times: [1, 1, 2, 3],
			fileOf: [0, 0, 1, 1],
			data: { v: [1, 2, 3, 4] },
			compareColumns: ['v']
		});
		expect(r.times).toBe(0);
	});

	it('reports each pair of files on its own', () => {
		const r = findTimeOverlaps({
			times: [1, 2, 2, 3, 3, 4],
			fileOf: [0, 0, 1, 1, 2, 2],
			data: { v: [1, 2, 9, 3, 3, 4] },
			compareColumns: ['v']
		});
		expect(r.pairs).toEqual([
			{ files: [0, 1], times: 1, conflicts: 1 },
			{ files: [1, 2], times: 1, conflicts: 0 }
		]);
	});
});

describe('mergeOverlappingRows', () => {
	it('keeps one row per time; where both have a value, the first file wins', () => {
		const { data, removed } = mergeOverlappingRows({ ...twoFiles(), keep: 'first' });
		expect(removed).toBe(2);
		expect(data.t).toEqual(['t1', 't2', 't3', 't4', 't5', 't6']);
		expect(data.v).toEqual([10, 20, 30, 40, 50, 60]);
	});

	it('the last file wins when asked', () => {
		const { data } = mergeOverlappingRows({ ...twoFiles(), keep: 'last' });
		expect(data.v).toEqual([10, 20, 30, 41, 50, 60]);
	});

	it('a blank cell is filled from the other file whichever file wins', () => {
		// The ESF case: the earlier file's overlapping rows are blank.
		const input = twoFiles({ aVals: [10, 20, null, null], bVals: [33, 44, 50, 60] });
		expect(mergeOverlappingRows({ ...input, keep: 'first' }).data.v).toEqual([
			10, 20, 33, 44, 50, 60
		]);
		const late = twoFiles({ aVals: [10, 20, 30, 40], bVals: ['', null, 50, 60] });
		expect(mergeOverlappingRows({ ...late, keep: 'last' }).data.v).toEqual([
			10, 20, 30, 40, 50, 60
		]);
	});

	it('"all" keeps every row', () => {
		const input = twoFiles();
		const { data, removed } = mergeOverlappingRows({ ...input, keep: 'all' });
		expect(removed).toBe(0);
		expect(data.v).toEqual(input.data.v);
	});

	it('names the file that supplied the values in the source column', () => {
		const input = twoFiles({ aVals: [10, 20, null, 40], bVals: [33, 44, 50, 60] });
		input.data.src = input.fileOf.map((i) => ['a.csv', 'b.csv'][i]);
		const { data } = mergeOverlappingRows({
			...input,
			keep: 'first',
			sourceColumn: 'src',
			fileNames: ['a.csv', 'b.csv'],
			compareColumns: ['v']
		});
		// t3: a.csv is blank, so b.csv supplied it; t4: a.csv wins.
		expect(data.src).toEqual(['a.csv', 'a.csv', 'b.csv', 'a.csv', 'b.csv', 'b.csv']);
	});

	it('leaves a time repeated inside one file alone', () => {
		const { data, removed } = mergeOverlappingRows({
			times: [1, 1, 2],
			fileOf: [0, 0, 1],
			data: { v: [1, 2, 3] },
			keep: 'first'
		});
		expect(removed).toBe(0);
		expect(data.v).toEqual([1, 2, 3]);
	});

	it('the default keeps one row per time, first file wins', () => {
		expect(DEFAULT_OVERLAP_MODE).toBe('first');
	});
});

describe('timeRange', () => {
	it('the earliest and latest instant, ignoring rows without a time', () => {
		expect(timeRange([5, NaN, 2, 9, null])).toEqual({ first: 2, last: 9 });
		expect(timeRange([NaN])).toBe(null);
	});
});
