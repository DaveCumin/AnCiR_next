import { describe, it, expect } from 'vitest';
import { scaleLinear, scaleUtc } from 'd3-scale';
import { toLimitNumber, limitsFromBrush, brushIsSignificant } from './brushHelpers.js';

describe('toLimitNumber', () => {
	it('passes numbers through', () => {
		expect(toLimitNumber(42)).toBe(42);
	});
	it('coerces a Date to epoch ms', () => {
		const d = new Date('2020-01-01T00:00:00Z');
		expect(toLimitNumber(d)).toBe(d.getTime());
	});
});

describe('limitsFromBrush', () => {
	// Plot area 100 wide x 100 tall. x: data 0..10 -> px 0..100. y: data 0..50 -> px 100..0.
	const xScale = scaleLinear().domain([0, 10]).range([0, 100]);
	const yScaleLeft = scaleLinear().domain([0, 50]).range([100, 0]);

	it('maps a box to the enclosed data range (x + left y)', () => {
		// px x 20..60 -> data 2..6 ; px y 25..75 -> data 37.5..12.5
		const out = limitsFromBrush(
			{ x0: 20, y0: 25, x1: 60, y1: 75 },
			{ xScale, yScaleLeft }
		);
		expect(out.xlims[0]).toBeCloseTo(2);
		expect(out.xlims[1]).toBeCloseTo(6);
		expect(out.ylimsLeft[0]).toBeCloseTo(12.5);
		expect(out.ylimsLeft[1]).toBeCloseTo(37.5);
		expect(out.ylimsRight).toBeNull();
	});

	it('normalises corner order (drag up-left)', () => {
		const out = limitsFromBrush(
			{ x0: 60, y0: 75, x1: 20, y1: 25 },
			{ xScale, yScaleLeft }
		);
		expect(out.xlims[0]).toBeCloseTo(2);
		expect(out.xlims[1]).toBeCloseTo(6);
	});

	it('inverts left and right axes independently for the same pixel band', () => {
		const yRight = scaleLinear().domain([0, 200]).range([100, 0]);
		const out = limitsFromBrush(
			{ x0: 0, y0: 0, x1: 100, y1: 50 }, // top half in pixels
			{ xScale, yScaleLeft, yScaleRight: yRight }
		);
		// top half (px 0..50) => upper 25..50 on left, 100..200 on right
		expect(out.ylimsLeft[0]).toBeCloseTo(25);
		expect(out.ylimsLeft[1]).toBeCloseTo(50);
		expect(out.ylimsRight[0]).toBeCloseTo(100);
		expect(out.ylimsRight[1]).toBeCloseTo(200);
	});

	it('returns epoch-ms limits for a time x-scale', () => {
		const t0 = Date.UTC(2020, 0, 1);
		const t1 = Date.UTC(2020, 0, 11); // 10 days
		const tScale = scaleUtc().domain([t0, t1]).range([0, 100]);
		const out = limitsFromBrush({ x0: 0, y0: 0, x1: 50, y1: 10 }, { xScale: tScale });
		expect(out.xlims[0]).toBeCloseTo(t0, -3);
		expect(out.xlims[1]).toBeCloseTo(Date.UTC(2020, 0, 6), -3);
		expect(typeof out.xlims[0]).toBe('number');
	});
});

describe('brushIsSignificant', () => {
	it('rejects a click / hairline drag', () => {
		expect(brushIsSignificant({ x0: 10, y0: 10, x1: 11, y1: 11 })).toBe(false);
	});
	it('accepts a thin tall box (x-range zoom)', () => {
		expect(brushIsSignificant({ x0: 10, y0: 10, x1: 11, y1: 90 })).toBe(true);
	});
	it('accepts a normal box', () => {
		expect(brushIsSignificant({ x0: 10, y0: 10, x1: 40, y1: 40 })).toBe(true);
	});
});
