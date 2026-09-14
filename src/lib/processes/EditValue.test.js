import { describe, it, expect } from 'vitest';
import { editvalue, editvalueWarnings, definition } from './EditValue.svelte';

describe('editvalue', () => {
	it('replaces a value at the specified position (1-based)', () => {
		const out = editvalue([10, 20, 30], { edits: [{ position: 2, value: 99 }] });
		expect(out).toEqual([10, 99, 30]);
	});

	it('applies multiple edits', () => {
		const out = editvalue([1, 2, 3, 4], {
			edits: [
				{ position: 1, value: 100 },
				{ position: 4, value: 400 }
			]
		});
		expect(out).toEqual([100, 2, 3, 400]);
	});

	it('does not mutate the original array', () => {
		const original = [1, 2, 3];
		editvalue(original, { edits: [{ position: 1, value: 99 }] });
		expect(original).toEqual([1, 2, 3]);
	});

	it('ignores edits with out-of-bounds positions', () => {
		const out = editvalue([1, 2, 3], {
			edits: [
				{ position: 0, value: 99 },
				{ position: 10, value: 99 }
			]
		});
		expect(out).toEqual([1, 2, 3]);
	});

	it('returns original when edits array is empty', () => {
		expect(editvalue([1, 2, 3], { edits: [] })).toEqual([1, 2, 3]);
	});

	it('returns original when no edits key', () => {
		expect(editvalue([1, 2, 3], {})).toEqual([1, 2, 3]);
	});

	it('works on string arrays', () => {
		const out = editvalue(['a', 'b', 'c'], { edits: [{ position: 2, value: 'z' }] });
		expect(out).toEqual(['a', 'z', 'c']);
	});
});

// ─── out-of-range-edit warning (free-process warnings channel) ───────────────
// An edit pointing past the end of the column (or at row 0, or a fractional
// row) is silently ignored by the compute. That stays true — the warning just
// says so on the node's ⚠ badge (editvalueWarnings → definition.getWarnings →
// processWarnings.js).

describe('editvalueWarnings', () => {
	it('counts edits pointing outside the input column and names the valid range', () => {
		const w = editvalueWarnings([10, 20, 30], {
			edits: [
				{ position: 2, value: 1 },
				{ position: 10, value: 1 },
				{ position: 0, value: 1 }
			]
		});
		expect(w).toHaveLength(1);
		expect(w[0]).toContain('2 of 3'); // the count
		expect(w[0]).toContain('3 rows'); // what the data allows
		expect(w[0]).toContain('between 1 and 3'); // the remedy
	});

	it('flags a fractional position (a silent no-op in the compute)', () => {
		const w = editvalueWarnings([10, 20, 30], { edits: [{ position: 1.5, value: 1 }] });
		expect(w).toHaveLength(1);
		expect(w[0]).toContain('1 of 1');
	});

	it('is silent when every edit lands, or there are no edits', () => {
		expect(
			editvalueWarnings([10, 20, 30], {
				edits: [
					{ position: 1, value: 1 },
					{ position: 3, value: 1 }
				]
			})
		).toEqual([]);
		expect(editvalueWarnings([10, 20, 30], { edits: [] })).toEqual([]);
		expect(editvalueWarnings([10, 20, 30], {})).toEqual([]);
	});
});

describe('definition.getWarnings — node warnings channel', () => {
	const freeNode = (data, args) => ({
		parentCol: null,
		inputCol: data ? { getData: () => data } : null,
		args
	});

	it('surfaces the out-of-range message for a wired free node', () => {
		const w = definition.getWarnings(freeNode([1, 2], { edits: [{ position: 9, value: 0 }] }));
		expect(w).toHaveLength(1);
	});

	it('returns [] when nothing is wired', () => {
		expect(definition.getWarnings(freeNode(null, { edits: [{ position: 9, value: 0 }] }))).toEqual(
			[]
		);
	});
});
