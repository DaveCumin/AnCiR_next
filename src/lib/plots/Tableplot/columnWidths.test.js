import { describe, it, expect } from 'vitest';
import {
	columnWidths,
	headerMinWidths,
	HEADER_PAD_X,
	DEFAULT_COL_W,
	MIN_AUTO_COL_W,
	MAX_AUTO_COL_W
} from './columnWidths.js';

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

// UI-17 follow-up: a single long word ("Rhythmicity", "Acrophase") broke mid-word in an 80px
// auto column. An auto column is now at least as wide as its header's longest word.
describe('Tableplot column widths: content-aware minimum', () => {
	// 8px per character stands in for the real text measurement.
	const measure = (w) => w.length * 8;

	it('headerMinWidths is the longest word plus the header padding', () => {
		const m = headerMinWidths({ a: 'Peak period (h)', b: 'Rhythmicity' }, measure);
		expect(m.a).toBe(Math.ceil(6 * 8 + HEADER_PAD_X)); // "period"
		expect(m.b).toBe(Math.ceil(11 * 8 + HEADER_PAD_X));
		expect(headerMinWidths({ a: '' }, measure).a).toBe(0);
	});

	it('a crowded table still gives a long-word column room for that word', () => {
		const ids = Array.from({ length: 10 }, (_, i) => `c${i}`);
		const mins = headerMinWidths({ c3: 'Rhythmicity' }, measure);
		const w = columnWidths(ids, {}, 300, 0, mins);
		expect(w.c3).toBe(mins.c3);
		expect(w.c3).toBeGreaterThan(MIN_AUTO_COL_W);
		expect(w.c0).toBe(MIN_AUTO_COL_W);
	});

	it('the long-word column takes its minimum first and the rest share what is left', () => {
		const mins = { a: 150 };
		const w = columnWidths(['a', 'b', 'c'], {}, 360, 0, mins);
		expect(w.a).toBe(150);
		expect(w.b).toBe(105);
		expect(w.c).toBe(105);
		expect(w.a + w.b + w.c).toBeLessThanOrEqual(360);
	});

	it('a minimum below the fair share changes nothing', () => {
		expect(columnWidths(['a', 'b'], {}, 236, 0, { a: 60 })).toEqual({ a: 118, b: 118 });
	});

	it('applies before the box is measured, and is capped at the auto maximum', () => {
		expect(columnWidths(['a', 'b'], {}, 0, 0, { a: 170 })).toEqual({ a: 170, b: DEFAULT_COL_W });
		expect(columnWidths(['a'], {}, 300, 0, { a: 900 }).a).toBe(MAX_AUTO_COL_W);
	});

	it('never overrides a width the user set', () => {
		expect(columnWidths(['a'], { a: 60 }, 300, 0, { a: 150 })).toEqual({ a: 60 });
	});
});
