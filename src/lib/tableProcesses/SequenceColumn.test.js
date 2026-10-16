import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/core/core.svelte', () => ({ core: { rawData: new Map() } }));
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: vi.fn() }));

import { sequencecolumn, sequenceWarnings, MAX_SEQUENCE_LENGTH } from './SequenceColumn.svelte';

// Preview mode: out.result === -1, no column writes needed.

describe('sequencecolumn — number sequence', () => {
	const base = { seqType: 'number', out: { result: -1 } };

	it('generates correct count of values', () => {
		const [result, valid] = sequencecolumn({ ...base, start: 0, step: 1, count: 5 });
		expect(valid).toBe(true);
		expect(result).toHaveLength(5);
	});

	it('starts at the given start value', () => {
		const [result] = sequencecolumn({ ...base, start: 10, step: 2, count: 3 });
		expect(result[0]).toBeCloseTo(10, 8);
	});

	it('increments by the given step', () => {
		const [result] = sequencecolumn({ ...base, start: 0, step: 5, count: 4 });
		expect(result[1]).toBeCloseTo(5, 8);
		expect(result[2]).toBeCloseTo(10, 8);
	});

	it('returns invalid for step = 0', () => {
		const [result, valid] = sequencecolumn({ ...base, start: 0, step: 0, count: 5 });
		expect(valid).toBe(false);
		expect(result).toHaveLength(0);
	});

	// The old cap cut to 100,000 silently (after building every value). Now the limit is
	// MAX_SEQUENCE_LENGTH, shared with the Python and R ports, and refused with a warning.
	it('makes every value past the old 100,000 cut (one-second samples for a week)', () => {
		const [result, valid] = sequencecolumn({ ...base, start: 0, step: 1, count: 604_800 });
		expect(valid).toBe(true);
		expect(result).toHaveLength(604_800);
		expect(result.at(-1)).toBe(604_799);
		expect(sequenceWarnings({ ...base, count: 604_800 })).toEqual([]);
	});

	it('exactly MAX_SEQUENCE_LENGTH values: made, no warning', () => {
		expect(MAX_SEQUENCE_LENGTH).toBe(2_000_000);
		const [result, valid] = sequencecolumn({ ...base, start: 0, step: 1, count: 2_000_000 });
		expect(valid).toBe(true);
		expect(result).toHaveLength(2_000_000);
		expect(sequenceWarnings({ ...base, count: 2_000_000 })).toEqual([]);
	});

	it('one past the limit: nothing made, and a warning that says why', () => {
		const [result, valid] = sequencecolumn({ ...base, start: 0, step: 1, count: 2_000_001 });
		expect(valid).toBe(false);
		expect(result).toEqual([]);
		expect(sequenceWarnings({ ...base, count: 2_000_001 })).toEqual([
			'Nothing was made: 2,000,001 values is more than the limit of 2,000,000. Lower the ' +
				'count, or use a larger step for the same start and end.'
		]);
		// A time sequence is held to the same limit.
		const [tRes, tValid] = sequencecolumn({
			seqType: 'time',
			out: { result: -1 },
			startTime: 0,
			stepHours: 1,
			count: 2_000_001
		});
		expect([tRes, tValid]).toEqual([[], false]);
	});

	it('count of 1 produces a single value', () => {
		const [result, valid] = sequencecolumn({ ...base, start: 7, step: 1, count: 1 });
		expect(valid).toBe(true);
		expect(result).toEqual([7]);
	});
});

describe('sequencecolumn — time sequence', () => {
	const base = { seqType: 'time', out: { result: -1 }, startTime: 0, stepHours: 1, count: 3 };

	it('generates the correct number of ISO timestamps', () => {
		const [result, valid] = sequencecolumn(base);
		expect(valid).toBe(true);
		expect(result).toHaveLength(3);
		expect(typeof result[0]).toBe('string');
	});

	it('returns invalid for stepHours = 0', () => {
		const [, valid] = sequencecolumn({ ...base, stepHours: 0 });
		expect(valid).toBe(false);
	});
});
