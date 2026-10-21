// Bin Data's daylight-saving note (plan 3.5): said when a change inside the record moves the
// bin edges against the local clock. Pacific/Auckland went back an hour at 03:00 NZDT on
// 7 Apr 2024 (6 Apr 14:00 UTC); Lord Howe back 30 minutes the same day (6 Apr 15:00 UTC).
import { describe, it, expect } from 'vitest';
import { binDstNote, clockPhaseDstWarning } from './dstNotes.js';
import { zoneTransitions } from './zones.js';

const NZ = 'Pacific/Auckland';
const clock = (z) => ({ zone: z, named: z });
const changes = (z) => zoneTransitions(z, Date.UTC(2024, 3, 1), Date.UTC(2024, 3, 12));
// Local midnight 1 Apr 2024 NZDT.
const NZ_MIDNIGHT = Date.UTC(2024, 2, 31, 11);

describe('binDstNote', () => {
	it('daily bins from local midnight: after the change they start at 23:00', () => {
		expect(
			binDstNote(clock(NZ), changes(NZ), { firstEdge: NZ_MIDNIGHT, stepHrs: 24, binHrs: 24 })
		).toBe(
			'Daylight saving ended on 7 Apr 2024 in Pacific/Auckland. Bins are 24 h of elapsed time, so bins after it start at 23:00 local time.'
		);
	});
	it('12 h bins move too', () => {
		expect(
			binDstNote(clock(NZ), changes(NZ), { firstEdge: NZ_MIDNIGHT, stepHrs: 12, binHrs: 12 })
		).toMatch(/bins after it start at (11|23):00 local time\.$/);
	});
	it('hourly or half-hourly bins keep their clock times through a 1 h change: no note', () => {
		expect(
			binDstNote(clock(NZ), changes(NZ), { firstEdge: NZ_MIDNIGHT, stepHrs: 1, binHrs: 1 })
		).toBeNull();
		expect(
			binDstNote(clock(NZ), changes(NZ), { firstEdge: NZ_MIDNIGHT, stepHrs: 0.5, binHrs: 0.5 })
		).toBeNull();
	});
	it("hourly bins and Lord Howe's 30-minute change: noted", () => {
		const z = 'Australia/Lord_Howe';
		// Local midnight 1 Apr 2024 LHDT (+11:00).
		expect(
			binDstNote(clock(z), changes(z), {
				firstEdge: Date.UTC(2024, 2, 31, 13),
				stepHrs: 1,
				binHrs: 1
			})
		).toMatch(/Bins are 1 h of elapsed time, so bins after it start at \d\d:30 local time\.$/);
	});
	it('no change, utc or no step: no note', () => {
		expect(
			binDstNote(clock(NZ), [], { firstEdge: NZ_MIDNIGHT, stepHrs: 24, binHrs: 24 })
		).toBeNull();
		expect(
			binDstNote(clock('utc'), changes('utc'), { firstEdge: 0, stepHrs: 24, binHrs: 24 })
		).toBeNull();
		expect(
			binDstNote(clock(NZ), changes(NZ), { firstEdge: NZ_MIDNIGHT, stepHrs: 0, binHrs: 24 })
		).toBeNull();
	});
});

describe('more changes than are named', () => {
	// Pacific/Auckland changes in Apr and Sep each year; the first two are named.
	const span = (to) => zoneTransitions(NZ, Date.UTC(2024, 0, 1), to);
	const warn = (to) => clockPhaseDstWarning(clock(NZ), span(to), { perWindow: true });
	it('one more: singular', () => {
		expect(span(Date.UTC(2025, 5, 1))).toHaveLength(3);
		expect(warn(Date.UTC(2025, 5, 1))).toMatch(/ \(and 1 more change\) in /);
	});
	it('several more: plural', () => {
		expect(span(Date.UTC(2025, 11, 1))).toHaveLength(4);
		expect(warn(Date.UTC(2025, 11, 1))).toMatch(/ \(and 2 more changes\) in /);
	});
	it('two or fewer: none', () => {
		expect(warn(Date.UTC(2024, 11, 1))).not.toMatch(/more change/);
	});
});
