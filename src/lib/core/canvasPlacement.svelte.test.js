// @ts-nocheck
// A new group (an imported table, a palette group) lands in free canvas space at the top left
// of the view, not at a fixed (80, 80) where it covered the previous import. E2E:
// tests/e2e/import-placement.spec.js.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { core, appState, createGroup } from '$lib/core/core.svelte.js';
import {
	visibleTopLeft,
	groupBox,
	layoutObstacles,
	freeCanvasSpot,
	newGroupPosition,
	registerCanvasBoxes,
	NEW_GROUP_GAP,
	DEFAULT_NODE_BOX
} from './canvasPlacement.js';
import { nodePortAreaHeight } from '$lib/components/workflow/nodeRows.js';

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

beforeEach(() => {
	core.groups = [];
	core.nodeLayout = {};
	appState.workflowViewport = { x: 0, y: 0, z: 1 };
});
let unregister = null;
afterEach(() => {
	unregister?.();
	unregister = null;
});

describe('visibleTopLeft', () => {
	it('is (80, 80) on an unpanned canvas, where the first import always landed', () => {
		expect(visibleTopLeft({ x: 0, y: 0, z: 1 })).toEqual({ x: 80, y: 80 });
		expect(visibleTopLeft(undefined)).toEqual({ x: 80, y: 80 });
	});
	it('follows a pan and a zoom', () => {
		// Panned 600 left and 400 up: the visible top left is at canvas (600, 400).
		expect(visibleTopLeft({ x: -600, y: -400, z: 1 })).toEqual({ x: 680, y: 480 });
		expect(visibleTopLeft({ x: 0, y: 0, z: 2 })).toEqual({ x: 40, y: 40 });
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

describe('freeCanvasSpot', () => {
	const want = { x: 80, y: 80, w: 240, h: 180 };
	it('keeps the wanted spot when it is free', () => {
		expect(freeCanvasSpot(want, [{ x: 400, y: 80, w: 240, h: 180 }])).toEqual({ x: 80, y: 80 });
	});
	it('moves below or right of what is in the way, never left of or above the wanted spot', () => {
		const first = { x: 80, y: 80, w: 240, h: 180 };
		const second = freeCanvasSpot(want, [first]);
		expect(second).toEqual({ x: 80, y: 80 + 180 + NEW_GROUP_GAP });
		const third = freeCanvasSpot(want, [first, { ...want, ...second }]);
		expect(third).toEqual({ x: 80 + 240 + NEW_GROUP_GAP, y: 80 });
		for (const spot of [second, third]) {
			expect(spot.x).toBeGreaterThanOrEqual(want.x);
			expect(spot.y).toBeGreaterThanOrEqual(want.y);
		}
	});
	it('clears a crowd of obstacles', () => {
		const obstacles = [];
		for (let i = 0; i < 4; i++)
			for (let j = 0; j < 4; j++)
				obstacles.push({ x: 60 + i * 260, y: 60 + j * 200, w: 250, h: 190 });
		const spot = freeCanvasSpot(want, obstacles);
		expect(obstacles.some((o) => overlap({ ...want, ...spot }, o))).toBe(false);
	});
});

describe('newGroupPosition', () => {
	it('places successive groups clear of each other, the first at (80, 80)', () => {
		const boxes = [];
		for (let i = 0; i < 5; i++) {
			const at = newGroupPosition({ rows: 3 });
			const id = createGroup({ name: `t${i}`, ...at });
			const g = core.groups.find((x) => x.id === id);
			if (i === 0) expect(at).toEqual({ x: 80, y: 80 });
			boxes.push(groupBox(g));
		}
		for (let i = 0; i < boxes.length; i++)
			for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j])).toBe(false);
	});

	it('lands in view after a pan, and clear of a group already there', () => {
		createGroup({ name: 'old', x: 80, y: 80 });
		appState.workflowViewport = { x: -1000, y: -500, z: 1 };
		expect(newGroupPosition()).toEqual({ x: 1080, y: 580 });
		createGroup({ name: 'there', x: 1080, y: 580 });
		const at = newGroupPosition();
		expect(at.x).toBeGreaterThanOrEqual(1080);
		expect(at.y).toBeGreaterThanOrEqual(580);
		expect(overlap(groupBox(core.groups[1]), { ...at, w: 240, h: 180 })).toBe(false);
	});

	it('uses the drawn node boxes when the canvas registers them (an expanded node is tall)', () => {
		// The saved layout has no size for this node; drawn, it is 700 px tall.
		core.nodeLayout = { tableprocess_1: { x: 60, y: 60 } };
		const tall = { id: 'tableprocess_1', x: 60, y: 60, w: 460, h: 700 };
		unregister = registerCanvasBoxes(() => [tall]);
		const at = newGroupPosition();
		expect(overlap(tall, { ...at, w: 240, h: 180 })).toBe(false);
		unregister();
		unregister = null;
		// Unregistered, the saved layout's default box is all it knows.
		expect(newGroupPosition()).toEqual({ x: 80, y: 60 + DEFAULT_NODE_BOX.h + NEW_GROUP_GAP });
	});

	it('a taller group (many rows) is placed by its full height', () => {
		createGroup({ name: 'old', x: 80, y: 500 });
		// 20 rows (507 px) do not fit between y 80 and the group at y 500; 2 rows (180 px) do.
		const at = newGroupPosition({ rows: 20 });
		expect(at).not.toEqual({ x: 80, y: 80 });
		expect(overlap(groupBox(core.groups[0]), { ...at, w: 240, h: nodePortAreaHeight(20) })).toBe(
			false
		);
		expect(newGroupPosition({ rows: 2 })).toEqual({ x: 80, y: 80 });
	});
});
