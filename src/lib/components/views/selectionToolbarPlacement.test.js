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

	it('flips inside, under the header band, when the selection is near the top of the view', () => {
		const r = placeSelectionToolbar({
			selection: rect(200, 30, 400, 300),
			view: VIEW,
			toolbar: TB,
			headers: [rect(200, 30, 400, 30)]
		});
		expect(r.placement).toBe('inside');
		// Below the header (30 + 30 header + 8 gap), inset from the right edge by the gap.
		expect(r.top).toBe(68);
		expect(r.left).toBe(600 - 8 - 100);
	});

	it('pins inside to the top of the view when the header has scrolled above it', () => {
		const r = placeSelectionToolbar({
			selection: rect(200, -200, 400, 600),
			view: VIEW,
			toolbar: TB,
			headers: [rect(200, -200, 400, 30)]
		});
		expect(r).toMatchObject({ placement: 'inside', top: 8 });
	});

	it('inside a multi-selection, drops below a lower card header it would cover', () => {
		// One selected card starts far above the view; another's header is at the view top.
		const r = placeSelectionToolbar({
			selection: rect(100, -500, 600, 1000),
			view: VIEW,
			toolbar: TB,
			headers: [rect(100, -500, 300, 30), rect(400, 20, 300, 30)]
		});
		expect(r).toMatchObject({ placement: 'inside', top: 58, left: 700 - 8 - 100 });
	});

	it('flips below when there is no room above and the selection is too short to hold it', () => {
		const r = placeSelectionToolbar({
			selection: rect(200, 20, 400, 60),
			view: VIEW,
			toolbar: TB,
			headers: [rect(200, 20, 400, 30)]
		});
		expect(r).toMatchObject({ placement: 'below', top: 80 + 8 });
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
