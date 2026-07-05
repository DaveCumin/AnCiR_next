import { describe, it, expect } from 'vitest';
import { rectsIntersect } from './layoutHelpers.js';

const box = (x, y, w, h) => ({ x, y, w, h });

describe('rectsIntersect', () => {
	it('detects clear overlap', () => {
		expect(rectsIntersect(box(0, 0, 10, 10), box(5, 5, 10, 10))).toBe(true);
	});

	it('detects full containment (marquee swallows a node)', () => {
		expect(rectsIntersect(box(0, 0, 100, 100), box(40, 40, 10, 10))).toBe(true);
	});

	it('returns false for clearly separated rects', () => {
		expect(rectsIntersect(box(0, 0, 10, 10), box(50, 50, 10, 10))).toBe(false);
	});

	it('treats edge-touching as intersecting', () => {
		// a's right edge (x=10) meets b's left edge (x=10)
		expect(rectsIntersect(box(0, 0, 10, 10), box(10, 0, 10, 10))).toBe(true);
	});

	it('normalises a negatively-sized drag rect (start below-right of end)', () => {
		// Raw marquee dragged up-left: negative w/h from the start corner.
		const marquee = box(60, 60, -30, -30); // covers 30..60
		expect(rectsIntersect(marquee, box(40, 40, 10, 10))).toBe(true);
		expect(rectsIntersect(marquee, box(0, 0, 10, 10))).toBe(false);
	});

	it('a zero-area marquee still hits a box it lands inside', () => {
		expect(rectsIntersect(box(45, 45, 0, 0), box(40, 40, 10, 10))).toBe(true);
	});
});
