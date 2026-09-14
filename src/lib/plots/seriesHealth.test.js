// A wired series that cannot compute must SAY SO — silence was the bug.
//
// The two dead-series shapes seriesHealth diagnoses: a wired column resolving
// to zero rows (broken reference degrades to []), and paired x/y of different
// lengths (nothing can be paired point-for-point). A block that is simply not
// wired yet must stay quiet.
import { describe, it, expect } from 'vitest';
import { seriesComputeWarning } from './seriesHealth.js';

function col(refId, rows) {
	return {
		refId,
		getData: () => rows
	};
}

describe('seriesComputeWarning', () => {
	it('is quiet for a series that is not wired yet', () => {
		expect(seriesComputeWarning({ x: col(-1, []), y: col(-1, []) })).toBeNull();
		expect(seriesComputeWarning({ column: col(-1, []) })).toBeNull();
		expect(seriesComputeWarning(null)).toBeNull();
	});

	it('is quiet for a healthy paired series', () => {
		expect(seriesComputeWarning({ x: col(3, [1, 2, 3]), y: col(4, [4, 5, 6]) })).toBeNull();
	});

	it('is quiet for a healthy single-input series', () => {
		expect(seriesComputeWarning({ column: col(3, [1, 2, 3]) })).toBeNull();
	});

	it('names the wired channel that no longer provides data, with the remedy', () => {
		const w = seriesComputeWarning({ x: col(3, [1, 2]), y: col(9, []) }, 'activity');
		expect(w).toContain('Series "activity" cannot be computed');
		expect(w).toContain('the y input needs a column with data'); // requirement
		expect(w).toContain('provides none'); // actual
		expect(w).toContain('re-wire the y input'); // remedy
	});

	it('flags a broken single-input column as "input"', () => {
		const w = seriesComputeWarning({ column: col(3, []) }, 'temp');
		expect(w).toContain('the input input needs a column with data');
	});

	it('reports an x/y length mismatch with both counts and the compatibility remedy', () => {
		const w = seriesComputeWarning({ x: col(3, [1, 2, 3]), y: col(4, [1, 2]) }, 'activity');
		expect(w).toContain('cannot be computed');
		expect(w).toContain('the same number of values'); // requirement
		expect(w).toContain('x has 3 and y has 2'); // actual
		expect(w).toContain('check the x and y columns are compatible'); // remedy
	});

	it('does NOT report a mismatch while only one side is wired', () => {
		// A half-wired block is mid-edit, not broken: y has data, x is untouched.
		expect(seriesComputeWarning({ x: col(-1, []), y: col(4, [1, 2]) })).toBeNull();
	});

	it('treats a producer-sourced column (refId null) as wired', () => {
		const dead = { refId: null, producerNodeId: 12, getData: () => [] };
		const w = seriesComputeWarning({ column: dead }, 's');
		expect(w).toContain('cannot be computed');
	});

	it('ignores non-column fields that happen to share channel names', () => {
		// e.g. a plot whose datum carries a plain `x` number for layout.
		expect(seriesComputeWarning({ x: 4, y: col(3, [1, 2]) })).toBeNull();
	});
});
