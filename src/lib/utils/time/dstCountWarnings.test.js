// The daylight-saving column warnings read right for any count: every count-dependent phrase
// agrees with it ("1 time falls ... it does not exist", "2 times fall ... they do not exist").
// The Python and R ports print the same text (clockZone parity fixtures, including one with a
// single skipped and one with a single unordered time).
import { describe, it, expect } from 'vitest';
import { dstCountWarnings } from './dstCountWarnings.js';
import { dstCountWarnings as fromColumnWarnings } from '$lib/core/columnWarnings.js';

const NZ = 'Pacific/Auckland';
const ADVICE = 'This logger may not follow daylight saving: try a fixed offset.';

describe('dstCountWarnings', () => {
	it('is the one the column warnings use', () => {
		expect(fromColumnWarnings).toBe(dstCountWarnings);
	});

	it('one skipped time: singular throughout', () => {
		expect(dstCountWarnings({ zone: NZ, skipped: 1, unordered: 0 })).toEqual([
			`1 time falls in the hour skipped when daylight saving began in ${NZ}, so it does not exist there; it is moved forward by the change (02:30 reads 03:30 after a 1 h change). ${ADVICE}`
		]);
	});

	it('several skipped times: plural throughout, with a thousands separator', () => {
		expect(dstCountWarnings({ zone: NZ, skipped: 1234, unordered: 0 })).toEqual([
			`1,234 times fall in the hour skipped when daylight saving began in ${NZ}, so they do not exist there; they are moved forward by the change (02:30 reads 03:30 after a 1 h change). ${ADVICE}`
		]);
	});

	it('one unordered time: singular throughout', () => {
		expect(dstCountWarnings({ zone: NZ, skipped: 0, unordered: 1 })).toEqual([
			`1 time falls in the hour repeated when daylight saving ended in ${NZ}, and does not step back through it in order, so it is read as the earlier (daylight-saving) time. ${ADVICE}`
		]);
	});

	it('several unordered times: plural throughout', () => {
		expect(dstCountWarnings({ zone: NZ, skipped: 0, unordered: 2 })).toEqual([
			`2 times fall in the hour repeated when daylight saving ended in ${NZ}, and do not step back through it in order, so each is read as the earlier (daylight-saving) time. ${ADVICE}`
		]);
	});

	it('none, or no counts: nothing; both: skipped first', () => {
		expect(dstCountWarnings(null)).toEqual([]);
		expect(dstCountWarnings({ zone: NZ, skipped: 0, unordered: 0 })).toEqual([]);
		const both = dstCountWarnings({ zone: NZ, skipped: 2, unordered: 1 });
		expect(both).toHaveLength(2);
		expect(both[0]).toMatch(/^2 times fall in the hour skipped/);
		expect(both[1]).toMatch(/^1 time falls in the hour repeated/);
	});
});
