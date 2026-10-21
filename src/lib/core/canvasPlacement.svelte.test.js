// @ts-nocheck
// Every new canvas node (an import, a palette group, plot, analysis, transform or note, a quick
// plot, an AI-edit node, a paste) lands in the middle of the canvas view, stepped a little down
// and right when something already sits exactly there. E2E: tests/e2e/import-placement.spec.js.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { core, appState, createGroup } from '$lib/core/core.svelte.js';
import {
	visibleRect,
	centredSpot,
	sameSpot,
	cascadeSpot,
	placeNewNodes,
	groupBox,
	layoutObstacles,
	newNodePosition,
	newGroupPosition,
	registerCanvas,
	readViewSize,
	resetPlacementState,
	CASCADE_STEP,
	VIEW_MARGIN,
	FALLBACK_SPOT,
	GROUP_W,
	GROUP_MIN_H,
	DEFAULT_NODE_BOX
} from './canvasPlacement.js';
import { nodePortAreaHeight } from '$lib/components/workflow/nodeRows.js';

const VIEW = { w: 1200, h: 800 };
const centreOf = (at, size) => ({ x: at.x + size.w / 2, y: at.y + size.h / 2 });

beforeEach(() => {
	resetPlacementState();
	core.groups = [];
	core.nodeLayout = {};
	appState.workflowViewport = { x: 0, y: 0, z: 1 };
});
let unregister = null;
afterEach(() => {
	unregister?.();
	unregister = null;
	resetPlacementState();
});

describe('visibleRect and centredSpot', () => {
	it('centres a node on the middle of an unpanned view', () => {
		expect(visibleRect({ x: 0, y: 0, z: 1 }, VIEW)).toEqual({ x: 0, y: 0, w: 1200, h: 800, z: 1 });
		const size = { w: 240, h: 180 };
		const at = centredSpot(size, { x: 0, y: 0, z: 1 }, VIEW);
		expect(at).toEqual({ x: 480, y: 310 });
		expect(centreOf(at, size)).toEqual({ x: 600, y: 400 });
	});

	it('follows a pan', () => {
		// Panned 600 left and 400 up: the view's middle is canvas (1200, 800).
		const size = { w: 200, h: 100 };
		const at = centredSpot(size, { x: -600, y: -400, z: 1 }, VIEW);
		expect(centreOf(at, size)).toEqual({ x: 1200, y: 800 });
	});

	it('follows a zoom out and a zoom in (with a pan)', () => {
		const size = { w: 200, h: 100 };
		// Zoomed out to 0.5, the view spans 2400 x 1600 canvas px; its middle is (1200, 800).
		expect(centreOf(centredSpot(size, { x: 0, y: 0, z: 0.5 }, VIEW), size)).toEqual({
			x: 1200,
			y: 800
		});
		// Zoomed in to 2 and panned 100, 50: the view spans canvas x -50..550, y -25..375.
		expect(centreOf(centredSpot(size, { x: 100, y: 50, z: 2 }, VIEW), size)).toEqual({
			x: 250,
			y: 175
		});
	});

	it('keeps the header of a node taller (or wider) than the view on screen', () => {
		const tall = { w: 300, h: 2000 };
		const at = centredSpot(tall, { x: 0, y: 0, z: 1 }, VIEW);
		expect(at.y).toBe(VIEW_MARGIN);
		expect(centreOf(at, tall).x).toBe(600);
		// The margin is in screen px, so it scales with the zoom.
		expect(centredSpot(tall, { x: 0, y: 0, z: 2 }, VIEW).y).toBe(VIEW_MARGIN / 2);
		const wide = { w: 1500, h: 100 };
		expect(centredSpot(wide, { x: 0, y: 0, z: 1 }, VIEW).x).toBe(VIEW_MARGIN);
	});

	it('falls back to the old default spot when the canvas size is unknown', () => {
		expect(centredSpot({ w: 240, h: 180 }, { x: -500, y: 0, z: 1 }, null)).toEqual(FALLBACK_SPOT);
		expect(FALLBACK_SPOT).toEqual({ x: 80, y: 80 });
	});
});

describe('sameSpot and cascadeSpot', () => {
	const box = (x, y, w = 200, h = 100) => ({ x, y, w, h });

	it('counts a node at the same top left, or centred on the same point, as the same spot', () => {
		expect(sameSpot(box(100, 100), box(100, 100))).toBe(true);
		expect(sameSpot(box(100, 100), box(110, 95))).toBe(true);
		expect(sameSpot(box(100, 100), box(100 + CASCADE_STEP, 100 + CASCADE_STEP))).toBe(false);
		// Different sizes, same centre (both centred on the view): the same spot.
		expect(sameSpot(box(100, 100, 200, 100), box(50, 25, 300, 250))).toBe(true);
		// Same top left, different sizes (two nodes taller than the view, both pinned to its top).
		expect(sameSpot(box(100, 16, 200, 900), box(100, 16, 300, 1400))).toBe(true);
		// Overlapping but not at the same spot: not a collision.
		expect(sameSpot(box(100, 100), box(160, 140))).toBe(false);
	});

	it('keeps the wanted spot when nothing is exactly there, even if something overlaps', () => {
		const want = box(100, 100);
		expect(cascadeSpot(want, [box(150, 130)])).toEqual({ x: 100, y: 100 });
	});

	it('steps down and right, one step per node already in the cascade', () => {
		const want = box(100, 100);
		const others = [box(100, 100), box(124, 124), box(148, 148)];
		expect(cascadeSpot(want, others)).toEqual({ x: 172, y: 172 });
		expect(cascadeSpot(want, [box(100, 100)])).toEqual({ x: 124, y: 124 });
	});
});

describe('placeNewNodes', () => {
	const size = { w: 200, h: 100 };
	const viewport = { x: 0, y: 0, z: 1 };

	it('places several nodes added at once as a cascade from the view centre', () => {
		const spots = placeNewNodes([size, size, size], { viewport, viewSize: VIEW });
		expect(spots).toEqual([
			{ x: 500, y: 350 },
			{ x: 524, y: 374 },
			{ x: 548, y: 398 }
		]);
	});

	it('steps off a node of another size already centred there', () => {
		const there = { x: 450, y: 250, w: 300, h: 300 }; // centred on (600, 400)
		const [at] = placeNewNodes([size], { viewport, viewSize: VIEW, others: [there] });
		expect(at).toEqual({ x: 500 + CASCADE_STEP, y: 350 + CASCADE_STEP });
	});

	it('steps a second node taller than the view off the first (both pinned to the top)', () => {
		const first = { w: 300, h: 1000 };
		const second = { w: 300, h: 1400 };
		const [a, b] = placeNewNodes([first, second], { viewport, viewSize: VIEW });
		expect(a).toEqual({ x: 450, y: VIEW_MARGIN });
		expect(b).toEqual({ x: 450 + CASCADE_STEP, y: VIEW_MARGIN + CASCADE_STEP });
	});

	it('does not hunt for free space: a node merely overlapping the centre stays put', () => {
		const near = { x: 300, y: 200, w: 400, h: 400 };
		expect(placeNewNodes([size], { viewport, viewSize: VIEW, others: [near] })).toEqual([
			{ x: 500, y: 350 }
		]);
	});

	it('rounds to whole pixels', () => {
		const [at] = placeNewNodes([{ w: 201, h: 101 }], {
			viewport: { x: 0, y: 0, z: 1.3 },
			viewSize: VIEW
		});
		expect(Number.isInteger(at.x) && Number.isInteger(at.y)).toBe(true);
	});
});

describe('groupBox and layoutObstacles', () => {
	it('a group is at least its stored size, taller when its rows need it', () => {
		const g = { id: 'g', x: 10, y: 20, width: 240, height: 180, sourceColumnIds: [1, 2] };
		expect(groupBox(g)).toEqual({ id: 'g', x: 10, y: 20, w: 240, h: 180 });
		const many = { ...g, sourceColumnIds: Array.from({ length: 12 }, (_, i) => i) };
		expect(groupBox(many).h).toBe(nodePortAreaHeight(12));
		expect(groupBox(many).h).toBeGreaterThan(180);
	});
	it('reads a group at its layout position, and other nodes at their saved or default size', () => {
		const groups = [{ id: 'group_1', x: 80, y: 80, width: 240, height: 180, sourceColumnIds: [] }];
		const nodeLayout = {
			group_1: { x: 500, y: 90 },
			plot_0: { x: 900, y: 100, w: 320, h: 200 },
			tableprocess_3: { x: 100, y: 600 },
			bad: { x: 'x' }
		};
		expect(layoutObstacles({ groups, nodeLayout })).toEqual([
			{ id: 'group_1', x: 500, y: 90, w: 240, h: 180 },
			{ id: 'plot_0', x: 900, y: 100, w: 320, h: 200 },
			{ id: 'tableprocess_3', x: 100, y: 600, ...DEFAULT_NODE_BOX }
		]);
	});
});

describe('live placement (newNodePosition, newGroupPosition)', () => {
	const mountCanvas = (boxes = () => [], size = VIEW) =>
		(unregister = registerCanvas({ boxes, viewSize: () => size }));

	it('centres a group on the mounted canvas view, at the current pan and zoom', () => {
		mountCanvas();
		appState.workflowViewport = { x: -1000, y: -500, z: 0.5 };
		// The view spans canvas x 2000..4400, y 1000..2600: its middle is (3200, 1800).
		const at = newGroupPosition();
		expect(centreOf(at, { w: GROUP_W, h: GROUP_MIN_H })).toEqual({ x: 3200, y: 1800 });
	});

	it('cascades successive imports (several files at once) by one step each', () => {
		mountCanvas();
		const spots = [];
		for (let i = 0; i < 3; i++) {
			const at = newGroupPosition({ rows: 2 });
			createGroup({ name: `t${i}`, ...at });
			spots.push(at);
		}
		expect(spots[1]).toEqual({ x: spots[0].x + CASCADE_STEP, y: spots[0].y + CASCADE_STEP });
		expect(spots[2]).toEqual({
			x: spots[0].x + 2 * CASCADE_STEP,
			y: spots[0].y + 2 * CASCADE_STEP
		});
	});

	it('steps off a drawn node already centred in the view, whatever its size', () => {
		const tall = { id: 'tableprocess_1', x: 370, y: 50, w: 460, h: 700 }; // centred on (600, 400)
		mountCanvas(() => [tall]);
		const size = { w: 200, h: 100 };
		expect(newNodePosition(size)).toEqual({ x: 500 + CASCADE_STEP, y: 350 + CASCADE_STEP });
		// ...unless that node is the one being placed.
		expect(newNodePosition(size, { exclude: ['tableprocess_1'] })).toEqual({ x: 500, y: 350 });
	});

	it('a group taller than its stored size (many rows) is centred by its full height', () => {
		mountCanvas();
		const h = nodePortAreaHeight(12);
		expect(h).toBeGreaterThan(GROUP_MIN_H);
		const at = newGroupPosition({ rows: 12 });
		// Rounded to whole pixels, so within half a pixel of the middle.
		expect(Math.abs(centreOf(at, { w: GROUP_W, h }).y - 400)).toBeLessThanOrEqual(0.5);
	});

	it('with the canvas unmounted, uses the saved view and the size the canvas last had', () => {
		mountCanvas();
		unregister();
		unregister = null;
		expect(readViewSize()).toEqual(VIEW);
		appState.workflowViewport = { x: -600, y: -400, z: 1 };
		const at = newGroupPosition();
		expect(centreOf(at, { w: GROUP_W, h: GROUP_MIN_H })).toEqual({ x: 1200, y: 800 });
		// The saved layout still counts as what is there.
		core.nodeLayout = { plot_0: { x: at.x, y: at.y, w: GROUP_W, h: GROUP_MIN_H } };
		expect(newGroupPosition()).toEqual({ x: at.x + CASCADE_STEP, y: at.y + CASCADE_STEP });
	});

	it('with a canvas never mounted, keeps the old default spot (and still cascades)', () => {
		appState.workflowViewport = { x: -600, y: -400, z: 1 };
		expect(newGroupPosition()).toEqual(FALLBACK_SPOT);
		createGroup({ name: 'first', ...FALLBACK_SPOT });
		expect(newGroupPosition()).toEqual({
			x: FALLBACK_SPOT.x + CASCADE_STEP,
			y: FALLBACK_SPOT.y + CASCADE_STEP
		});
	});
});
