import { describe, it, expect } from 'vitest';
import { editvalue } from './EditValue.svelte';

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
		const out = editvalue([1, 2, 3], { edits: [{ position: 0, value: 99 }, { position: 10, value: 99 }] });
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
