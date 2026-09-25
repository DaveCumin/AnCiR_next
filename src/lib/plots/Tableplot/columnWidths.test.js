import { describe, it, expect } from 'vitest';
import { columnWidths, DEFAULT_COL_W, MIN_AUTO_COL_W, MAX_AUTO_COL_W } from './columnWidths.js';

describe('Tableplot column widths', () => {
	it('uses the fixed default before the box has been measured', () => {
		expect(columnWidths(['a', 'b'], {}, 0)).toEqual({ a: DEFAULT_COL_W, b: DEFAULT_COL_W });
	});

	// The Figure 1 case: two 130px columns in a ~236px node preview overflowed it,
	// hiding the second column's right edge and ellipsizing "Peak period (h)".
	it('shares a narrow box so the columns fit it exactly', () => {
		const w = columnWidths(['a', 'b'], {}, 236);
		expect(w).toEqual({ a: 118, b: 118 });
		expect(w.a + w.b).toBeLessThanOrEqual(236);
	});

	it('never sums past the box (no stray horizontal scrollbar)', () => {
		const w = columnWidths(['a', 'b', 'c'], {}, 301);
		expect(w.a + w.b + w.c).toBeLessThanOrEqual(301);
	});

	it('keeps user-resized widths and shares only what is left', () => {
		const w = columnWidths(['a', 'b', 'c'], { a: 100 }, 300);
		expect(w).toEqual({ a: 100, b: 100, c: 100 });
	});

	it('leaves room for the row-number column', () => {
		expect(columnWidths(['a', 'b'], {}, 244, 44)).toEqual({ a: 100, b: 100 });
	});

	it('clamps auto widths: a crowded table scrolls rather than squashing columns', () => {
		const ids = Array.from({ length: 10 }, (_, i) => `c${i}`);
		const w = columnWidths(ids, {}, 300);
		for (const id of ids) expect(w[id]).toBe(MIN_AUTO_COL_W);
	});

	it('clamps auto widths: a wide view does not stretch two columns into bars', () => {
		expect(columnWidths(['a', 'b'], {}, 1600)).toEqual({ a: MAX_AUTO_COL_W, b: MAX_AUTO_COL_W });
	});
});
