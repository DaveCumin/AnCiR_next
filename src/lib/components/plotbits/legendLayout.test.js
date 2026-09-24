import { describe, it, expect } from 'vitest';
import {
	legendBoxSize,
	buildOccupancy,
	coveredFraction,
	chooseLegendPlacement,
	measureLabelWidths
} from './legendLayout.js';

const W = 400;
const H = 200;
const BOX = { boxW: 100, boxH: 50, margin: 10 };

/** Points filling the given rectangles of the plot area, one every 2 px. */
function occ(rects) {
	const px = [];
	const py = [];
	for (const [x0, y0, x1, y1] of rects) {
		for (let x = x0; x <= x1; x += 2) {
			for (let y = y0; y <= y1; y += 2) {
				px.push(x);
				py.push(y);
			}
		}
	}
	return buildOccupancy({ width: W, height: H, series: [{ px, py, radius: 1 }] });
}

describe('legendBoxSize', () => {
	it('matches the formula Legend.svelte always drew with', () => {
		const v = legendBoxSize({
			labelWidths: [50, 80],
			fontPx: 12,
			padding: 8,
			itemSpacing: 4,
			orientation: 'vertical'
		});
		// 25 icon + 4 gap + (80 + 2 + 4) + 16
		expect(v.width).toBe(131);
		// 2 lines of (12 + 4 + 4) + 16
		expect(v.height).toBe(56);
	});

	it('is empty with no items', () => {
		expect(legendBoxSize({ labelWidths: [], fontPx: 12, padding: 8, itemSpacing: 4 }).width).toBe(
			0
		);
	});
});

describe('measureLabelWidths', () => {
	it('estimates when there is no canvas, and grows with the text', () => {
		const [a, b] = measureLabelWidths(['ab', 'abcd'], 10, 'sans-serif');
		expect(b).toBeGreaterThan(a);
	});
});

describe('buildOccupancy', () => {
	it('marks the cells a sparse line passes through, not only its vertices', () => {
		const o = buildOccupancy({
			width: W,
			height: H,
			series: [{ px: [0, 400], py: [100, 100], line: true }]
		});
		expect(coveredFraction(o, 180, 96, 40, 8)).toBeGreaterThan(0);
	});

	it('breaks a line at a gap', () => {
		const o = buildOccupancy({
			width: W,
			height: H,
			series: [{ px: [0, NaN, 400], py: [100, NaN, 100], line: true }]
		});
		expect(coveredFraction(o, 180, 96, 40, 8)).toBe(0);
	});
});

describe('chooseLegendPlacement', () => {
	it('keeps the conventional top right when it is clear', () => {
		const p = chooseLegendPlacement({ occupancy: occ([]), plotW: W, plotH: H, ...BOX });
		expect(p).toMatchObject({ outside: false, name: 'topright', x: 290, y: 10 });
	});

	it('moves to a clear corner when the top right holds data', () => {
		const p = chooseLegendPlacement({
			occupancy: occ([[280, 0, 400, 80]]),
			plotW: W,
			plotH: H,
			...BOX
		});
		expect(p.name).toBe('topleft');
		expect(p.covered).toBe(0);
	});

	it('goes outside when data fill the plot and the plot can make room (the paper figure)', () => {
		const p = chooseLegendPlacement({
			occupancy: occ([[0, 0, 400, 200]]),
			plotW: W,
			plotH: H,
			...BOX,
			allowOutside: true
		});
		expect(p.outside).toBe(true);
	});

	it('takes the least-covered spot when it cannot go outside', () => {
		// Everything full except the bottom-left, which is half full.
		const p = chooseLegendPlacement({
			occupancy: occ([
				[0, 0, 400, 130],
				[120, 130, 400, 200],
				[0, 130, 50, 200]
			]),
			plotW: W,
			plotH: H,
			...BOX
		});
		expect(p.outside).toBe(false);
		expect(p.name).toBe('bottomleft');
	});
});
