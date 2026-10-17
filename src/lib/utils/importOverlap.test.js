import { describe, it, expect } from 'vitest';
import {
	describeOverlapNote,
	findTimeOverlaps,
	isMissingCell,
	timeRange
} from './importOverlap.js';
import * as overlapModule from './importOverlap.js';

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
		expect(r).toMatchObject({ times: 0, conflicts: 0, pairs: [] });
	});

	it('counts shared times and the times whose values differ', () => {
		const r = findTimeOverlaps({ ...twoFiles(), compareColumns: ['v'] });
		expect(r.times).toBe(2);
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

// Import keeps every row (David, 2026-10-17: "import data simply imports the data (without
// merging)"), so the module only detects and describes shared times; nothing merges them.
describe('no merging', () => {
	it('exports no merge function or merge mode', () => {
		expect(Object.keys(overlapModule).sort()).toEqual(
			['describeOverlapNote', 'findTimeOverlaps', 'isMissingCell', 'timeRange'].sort()
		);
	});
});

describe('describeOverlapNote', () => {
	it('the ESF case: 30 shared times, 3 with different values', () => {
		expect(describeOverlapNote({ times: 30, conflicts: 3 })).toBe(
			'30 times appear in more than one file; at 3 of them the files have different values. ' +
				'All rows are imported. To combine rows that share a time, bin the data after import (Bin\u00a0Data).'
		);
	});

	it('one shared time with different values', () => {
		expect(describeOverlapNote({ times: 1, conflicts: 1 })).toBe(
			'1 time appears in more than one file, and the files have different values there. ' +
				'All rows are imported. To combine rows that share a time, bin the data after import (Bin\u00a0Data).'
		);
	});

	it('shared times whose values agree', () => {
		expect(describeOverlapNote({ times: 1234, conflicts: 0 })).toBe(
			'1,234 times appear in more than one file, and the files agree at all of them. ' +
				'All rows are imported. To combine rows that share a time, bin the data after import (Bin\u00a0Data).'
		);
	});

	it('one shared time whose values agree', () => {
		expect(describeOverlapNote({ times: 1, conflicts: 0 })).toMatch(
			/^1 time appears in more than one file, and the files agree there\. /
		);
	});

	it('nothing shared: no note', () => {
		expect(describeOverlapNote(null)).toBe(null);
		expect(describeOverlapNote({ times: 0, conflicts: 0 })).toBe(null);
	});

	it('no em-dashes', () => {
		for (const r of [
			{ times: 1, conflicts: 0 },
			{ times: 2, conflicts: 1 }
		]) {
			expect(describeOverlapNote(r)).not.toMatch(/\u2014/);
		}
	});
});

describe('timeRange', () => {
	it('the earliest and latest instant, ignoring rows without a time', () => {
		expect(timeRange([5, NaN, 2, 9, null])).toEqual({ first: 2, last: 9 });
		expect(timeRange([NaN])).toBe(null);
	});
});
