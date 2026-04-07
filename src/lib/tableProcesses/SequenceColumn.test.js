import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/core/core.svelte', () => ({ core: { rawData: new Map() } }));
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: vi.fn() }));
vi.mock('luxon', () => ({ DateTime: { utc: () => ({ toMillis: () => 0, plus: () => ({ toMillis: () => 86400000 }) }) } }));

import { sequencecolumn } from './SequenceColumn.svelte';

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

	it('caps at 100000 elements', () => {
		const [result] = sequencecolumn({ ...base, start: 0, step: 1, count: 200000 });
		expect(result.length).toBe(100000);
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
