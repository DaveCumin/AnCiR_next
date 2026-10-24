import { describe, it, expect } from 'vitest';
import { placeSelectionToolbar, unionRect } from './selectionToolbarPlacement.js';

const rect = (left, top, width, height) => ({
	left,
	top,
	right: left + width,
	bottom: top + height
});
const VIEW = rect(0, 0, 1000, 800);
const TB = { width: 100, height: 36 };

describe('placeSelectionToolbar', () => {
	it('sits just above the selection, right-aligned with its right edge', () => {
		const r = placeSelectionToolbar({
			selection: rect(200, 300, 400, 300),
			view: VIEW,
			toolbar: TB
		});
		expect(r).toEqual({ left: 500, top: 300 - 8 - 36, placement: 'above', visible: true });
	});

	// REPORTED (2026-10-22): with no room above, the toolbar dropped INSIDE the selection's
	// top-right corner, over the plots' legends and data. It now goes below, then beside.
	it('flips below when there is no room above', () => {
		const r = placeSelectionToolbar({
			selection: rect(200, 30, 400, 300),
			view: VIEW,
			toolbar: TB
		});
		expect(r).toMatchObject({ placement: 'below', top: 330 + 8, left: 500 });
	});

	it('goes beside the selection, right then left, when it is too tall for above or below', () => {
		const right = placeSelectionToolbar({
			selection: rect(200, 20, 400, 770),
			view: VIEW,
			toolbar: TB
		});
		expect(right).toMatchObject({ placement: 'right', left: 600 + 8, top: 20 });
		const left = placeSelectionToolbar({
			selection: rect(300, -200, 650, 1200),
			view: VIEW,
			toolbar: TB
		});
		// Level with the view's top when the selection's top has scrolled above it.
		expect(left).toMatchObject({ placement: 'left', left: 300 - 8 - 100, top: 8 });
	});

	it('never covers the selection while the view has room for it anywhere outside it', () => {
		const overlaps = (r, sel) =>
			r.left < sel.right &&
			r.left + TB.width > sel.left &&
			r.top < sel.bottom &&
			r.top + TB.height > sel.top;
		for (let top = -300; top <= 700; top += 50) {
			for (const [left, width, height] of [
				[100, 400, 300],
				[150, 800, 760],
				[0, 300, 1200]
			]) {
				const sel = rect(left, top, width, height);
				const r = placeSelectionToolbar({ selection: sel, view: VIEW, toolbar: TB });
				if (r.placement === 'clamped') continue;
				expect(overlaps(r, sel), JSON.stringify(sel)).toBe(false);
			}
		}
	});

	it('clamps horizontally inside the view on both sides', () => {
		const right = placeSelectionToolbar({
			selection: rect(700, 300, 600, 200),
			view: VIEW,
			toolbar: TB
		});
		expect(right.left).toBe(1000 - 8 - 100);
		const left = placeSelectionToolbar({
			selection: rect(-500, 300, 520, 200),
			view: VIEW,
			toolbar: TB
		});
		expect(left.left).toBe(8);
	});

	it('keeps the left edge in view when the view is narrower than the toolbar', () => {
		const r = placeSelectionToolbar({
			selection: rect(0, 300, 50, 50),
			view: rect(0, 0, 60, 800),
			toolbar: TB
		});
		expect(r.left).toBe(8);
	});

	it('moves left off an occluder, or up when there is no room to the left', () => {
		const zoomCard = rect(950, 650, 40, 140);
		const r = placeSelectionToolbar({
			selection: rect(600, 700, 400, 80),
			view: VIEW,
			toolbar: TB,
			occluders: [zoomCard]
		});
		expect(r.left + TB.width).toBeLessThanOrEqual(zoomCard.left - 8);

		const wide = rect(0, 650, 990, 140);
		const up = placeSelectionToolbar({
			selection: rect(600, 690, 300, 100),
			view: VIEW,
			toolbar: TB,
			occluders: [wide]
		});
		expect(up.top + TB.height).toBeLessThanOrEqual(wide.top - 8);
	});

	it('is not visible when the selection is entirely outside the view', () => {
		const r = placeSelectionToolbar({
			selection: rect(1200, 300, 100, 100),
			view: VIEW,
			toolbar: TB
		});
		expect(r.visible).toBe(false);
	});
});

describe('unionRect', () => {
	it('is the bounding box of the rects, or null for none', () => {
		expect(unionRect([rect(0, 10, 50, 50), rect(100, 0, 20, 20)])).toEqual({
			left: 0,
			top: 0,
			right: 120,
			bottom: 60
		});
		expect(unionRect([])).toBeNull();
	});
});
