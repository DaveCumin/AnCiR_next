// A node view's padding floor (plots/viewBox.js scalePadding, viewPadFloorFor, fitViewPadding).
//
// REPORTED (2026-10-22): the canvas preview of the Join Data demo's plot cut its left y-axis
// title in half. A node draws the figure's padding scaled to its type, and a session opened
// straight into the canvas (every demo) carries a padding nobody measured: the workspace
// measures it when it draws the figure, the canvas never had. The node now measures what its
// own drawing needs and never draws a side with less (never saving it as the figure's).
import { describe, it, expect } from 'vitest';
import { scalePadding, viewPadFloorFor, fitViewPadding } from './viewBox.js';

const FIGURE = { top: 15, right: 30, bottom: 30, left: 30 };

describe('scalePadding with a floor', () => {
	it('raises only the sides the scaled padding leaves short', () => {
		const p = scalePadding(FIGURE, 0.5, { left: 28 });
		expect(p.left).toBe(28);
		// 10 px of chrome held back, the rest scaled (AXIS_CHROME).
		expect(p.right).toBe(4 + 26 * 0.5);
		expect(p.bottom).toBe(10 + 20 * 0.5);
		// A floor under the scaled padding changes nothing.
		expect(scalePadding(FIGURE, 0.5, { bottom: 1 }).bottom).toBe(20);
	});

	it('applies a floor at full size too, and is the stored padding unchanged without one', () => {
		expect(scalePadding(FIGURE, 1)).toBe(FIGURE);
		expect(scalePadding(FIGURE, 1, null)).toBe(FIGURE);
		expect(scalePadding(FIGURE, 1, { left: 50 }).left).toBe(50);
	});

	it('writes through to the figure padding', () => {
		const fig = { ...FIGURE };
		const p = scalePadding(fig, 0.5, { left: 28 });
		p.left = 44;
		expect(fig.left).toBe(44);
	});
});

describe('viewPadFloorFor', () => {
	const stored = { box: { w: 240, h: 140 }, sides: { left: 28 } };
	it('is the floor for the box it was measured at, and none for another or none', () => {
		expect(viewPadFloorFor(stored, { w: 240, h: 140 })).toEqual({ left: 28 });
		expect(viewPadFloorFor(stored, { w: 300, h: 140 })).toBe(null);
		expect(viewPadFloorFor(stored, null)).toBe(null);
		expect(viewPadFloorFor(null, { w: 240, h: 140 })).toBe(null);
	});
});

describe('fitViewPadding', () => {
	const plot = (need, fontScale = 0.5) => ({
		renderBox: { w: 240, h: 140 },
		fontScale,
		viewPadFloor: null,
		getAutoScaleValues: () => need
	});

	it('keeps what the axes need, with their full-size air shrunk with the type', () => {
		const p = plot({ left: 32, right: null, top: 0, bottom: 31 });
		expect(fitViewPadding(p)).toBe(true);
		// 6 px of air on the left and 12 under the x axis, at half size.
		expect(p.viewPadFloor).toEqual({
			box: { w: 240, h: 140 },
			sides: { left: 32 - 3, bottom: 31 - 6 }
		});
		// Measured again with nothing changed: no new floor, so no redraw loop.
		expect(fitViewPadding(p)).toBe(false);
	});

	it('does nothing outside a node view or for a plot without the field', () => {
		expect(fitViewPadding({ ...plot({ left: 40 }), renderBox: null })).toBe(false);
		const noField = plot({ left: 40 });
		delete noField.viewPadFloor;
		expect(fitViewPadding(noField)).toBe(false);
	});
});
