// VirtualList's scroll maths, both sides of the scaling threshold. A table over about 400,000
// rows used to pass the browsers' element-height cap, so its last rows could not be scrolled
// to (the spacer was silently clamped).
import { describe, it, expect } from 'vitest';
import { scrollWindow, MAX_SCROLL_HEIGHT } from './virtualScroll.js';

const H = 44; // the Table plot's one-line row
const VH = 600;

/** Rows wholly or partly inside the viewport for this window. */
function visibleRows(w, scrollTop, vh = VH, h = H) {
	const out = [];
	for (let i = w.startIndex; i < w.endIndex; i++) {
		const top = w.offsetY + (i - w.startIndex) * h - scrollTop;
		if (top + h > 0 && top < vh) out.push(i);
	}
	return out;
}

describe('scrollWindow', () => {
	it('under the cap: identity mapping, exactly as before (one scroll px is one row px)', () => {
		const total = Math.floor(MAX_SCROLL_HEIGHT / H); // 227,272 rows: just under
		const w = scrollWindow({ scrollTop: 44_000, viewportH: VH, total, itemHeight: H });
		expect(w.scaled).toBe(false);
		expect(w.spacerHeight).toBe(total * H);
		expect(w.startIndex).toBe(1000 - 6);
		expect(w.offsetY).toBe((1000 - 6) * H);
		expect(visibleRows(w, 44_000)[0]).toBe(1000);
		const end = total * H - VH;
		const last = scrollWindow({ scrollTop: end, viewportH: VH, total, itemHeight: H });
		expect(visibleRows(last, end).at(-1)).toBe(total - 1);
	});

	it('1,000,000 rows: the spacer stays under the cap and every row is reachable', () => {
		const total = 1_000_000;
		const top = scrollWindow({ scrollTop: 0, viewportH: VH, total, itemHeight: H });
		expect(top.scaled).toBe(true);
		expect(top.spacerHeight).toBe(MAX_SCROLL_HEIGHT);
		expect(visibleRows(top, 0)[0]).toBe(0);
		expect(top.offsetY).toBe(0);

		// The end of the scroll shows the last row, flush with the bottom.
		const end = MAX_SCROLL_HEIGHT - VH;
		const bottom = scrollWindow({ scrollTop: end, viewportH: VH, total, itemHeight: H });
		expect(bottom.endIndex).toBe(total);
		expect(visibleRows(bottom, end).at(-1)).toBe(total - 1);
		expect(bottom.offsetY + (total - bottom.startIndex) * H).toBeCloseTo(MAX_SCROLL_HEIGHT, 6);

		// Every row is shown at SOME scroll position: one px of scroll moves fewer rows than a
		// viewport holds, so no row is skipped between neighbouring positions.
		let prevLast = -1;
		for (let s = 0; s <= end; s += 97) {
			const w = scrollWindow({ scrollTop: s, viewportH: VH, total, itemHeight: H });
			const rows = visibleRows(w, s);
			expect(rows[0]).toBeLessThanOrEqual(prevLast + 1);
			// Contiguous, and the viewport never shows anything below the spacer (overscan rows
			// past it are clipped by the spacer's overflow-y: clip, so cannot extend the scroll).
			expect(rows.at(-1) - rows[0] + 1).toBe(rows.length);
			expect(s + VH).toBeLessThanOrEqual(w.spacerHeight);
			prevLast = rows.at(-1);
		}
		expect(prevLast).toBeGreaterThan(total - 20);
	});

	it('the halfway scroll position shows the middle of the list', () => {
		const total = 1_000_000;
		const s = (MAX_SCROLL_HEIGHT - VH) / 2;
		const rows = visibleRows(
			scrollWindow({ scrollTop: s, viewportH: VH, total, itemHeight: H }),
			s
		);
		const mid = (total * H - VH) / 2 / H;
		expect(Math.abs(rows[0] - mid)).toBeLessThan(2);
	});

	it('empty and tiny lists', () => {
		expect(scrollWindow({ scrollTop: 0, viewportH: VH, total: 0, itemHeight: H })).toMatchObject({
			spacerHeight: 0,
			startIndex: 0,
			endIndex: 0
		});
		const w = scrollWindow({ scrollTop: 0, viewportH: VH, total: 3, itemHeight: H });
		expect([w.startIndex, w.endIndex, w.scaled]).toEqual([0, 3, false]);
	});
});
