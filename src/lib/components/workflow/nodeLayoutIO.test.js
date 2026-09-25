import { describe, it, expect } from 'vitest';
import { buildNodeLayout, nodeLayoutMatches, parseNodeLayout } from './nodeLayoutIO.js';

// The workflow canvas persists its layout through core.nodeLayout (session
// export) and a localStorage mirror. Positions and collapsed flags were saved,
// but a resized plot node's preview box lived only in component state, so
// enlarging a plot and reloading the session reverted it to the default size.

describe('buildNodeLayout', () => {
	it('keeps positions', () => {
		const l = buildNodeLayout({ positions: { plot_1: { x: 10, y: 20 } } });
		expect(l.plot_1).toEqual({ x: 10, y: 20 });
	});

	it('records collapsed flags alongside position', () => {
		const l = buildNodeLayout({
			positions: { tp_1: { x: 1, y: 2 } },
			collapsedIds: new Set(['tp_1'])
		});
		expect(l.tp_1).toEqual({ x: 1, y: 2, collapsed: true });
	});

	it('records a resized plot preview box', () => {
		const l = buildNodeLayout({
			positions: { plot_1: { x: 5, y: 6 } },
			sizes: { plot_1: { w: 480, h: 300 } }
		});
		expect(l.plot_1).toEqual({ x: 5, y: 6, w: 480, h: 300 });
	});

	it('keeps a size even for a node with no recorded position', () => {
		// A plot can be resized before its position is pinned; losing the size
		// here is exactly the reported bug.
		const l = buildNodeLayout({ positions: {}, sizes: { plot_9: { w: 300, h: 200 } } });
		expect(l.plot_9).toEqual({ w: 300, h: 200 });
	});

	it('ignores non-finite or non-positive sizes', () => {
		const l = buildNodeLayout({
			positions: { a: { x: 0, y: 0 } },
			sizes: { a: { w: NaN, h: 0 } }
		});
		expect(l.a).toEqual({ x: 0, y: 0 });
	});

	it('tolerates missing arguments', () => {
		expect(buildNodeLayout({})).toEqual({});
		expect(buildNodeLayout()).toEqual({});
	});
});

describe('parseNodeLayout', () => {
	it('splits a layout into positions, collapsed ids and sizes', () => {
		const { positions, collapsedIds, sizes } = parseNodeLayout({
			plot_1: { x: 5, y: 6, w: 480, h: 300 },
			tp_1: { x: 1, y: 2, collapsed: true }
		});
		expect(positions).toEqual({ plot_1: { x: 5, y: 6 }, tp_1: { x: 1, y: 2 } });
		expect([...collapsedIds]).toEqual(['tp_1']);
		expect(sizes).toEqual({ plot_1: { w: 480, h: 300 } });
	});

	it('round-trips through buildNodeLayout', () => {
		const positions = { plot_1: { x: 5, y: 6 }, tp_1: { x: 1, y: 2 } };
		const collapsedIds = new Set(['tp_1']);
		const sizes = { plot_1: { w: 480, h: 300 } };
		const out = parseNodeLayout(buildNodeLayout({ positions, collapsedIds, sizes }));
		expect(out.positions).toEqual(positions);
		expect([...out.collapsedIds]).toEqual([...collapsedIds]);
		expect(out.sizes).toEqual(sizes);
	});

	it('reads a legacy layout with no sizes (older sessions)', () => {
		const { positions, sizes } = parseNodeLayout({ plot_1: { x: 5, y: 6 } });
		expect(positions).toEqual({ plot_1: { x: 5, y: 6 } });
		expect(sizes).toEqual({});
	});

	it('drops malformed entries rather than throwing', () => {
		const { positions, sizes } = parseNodeLayout({
			ok: { x: 1, y: 2, w: 100, h: 50 },
			bad: { x: 'nope', y: null, w: -5, h: 'x' },
			alsoBad: null
		});
		expect(positions).toEqual({ ok: { x: 1, y: 2 } });
		expect(sizes).toEqual({ ok: { w: 100, h: 50 } });
	});

	it('returns empty structures for junk input', () => {
		expect(parseNodeLayout(null).positions).toEqual({});
		expect(parseNodeLayout(undefined).sizes).toEqual({});
		expect([...parseNodeLayout('nope').collapsedIds]).toEqual([]);
	});

	it('requires BOTH w and h to accept a size', () => {
		const { sizes } = parseNodeLayout({ a: { x: 0, y: 0, w: 100 } });
		expect(sizes).toEqual({});
	});
});

// Regression: two mounted WorkflowEditors (the canvas view plus the legacy
// now-deleted fullscreen `appState.showWorkflow` one) each guard their adopt effect on the
// IDENTITY of the last layout they themselves published, so neither recognises
// the other's write. They then adopt each other's layouts forever and Svelte
// aborts the flush with effect_update_depth_exceeded. The content guard has to
// report "already matches" for a layout that round-tripped through
// buildNodeLayout/parseNodeLayout, whatever object identity it arrived with.
describe('nodeLayoutMatches', () => {
	const state = {
		positions: { plot_1: { x: 10, y: 20 }, tp_2: { x: 30, y: 40 } },
		collapsedIds: new Set(['tp_2']),
		sizes: { plot_1: { w: 300, h: 200 } }
	};

	it('accepts a layout that round-tripped through build/parse', () => {
		const roundTripped = parseNodeLayout(buildNodeLayout(state));
		expect(roundTripped.positions).not.toBe(state.positions); // genuinely a new object
		expect(nodeLayoutMatches(roundTripped, state)).toBe(true);
	});

	it('rejects a moved node', () => {
		const moved = parseNodeLayout(buildNodeLayout(state));
		moved.positions.plot_1.x = 11;
		expect(nodeLayoutMatches(moved, state)).toBe(false);
	});

	it('rejects an added or removed node', () => {
		const extra = parseNodeLayout(buildNodeLayout(state));
		extra.positions.data_9 = { x: 0, y: 0 };
		expect(nodeLayoutMatches(extra, state)).toBe(false);

		const fewer = parseNodeLayout(buildNodeLayout(state));
		delete fewer.positions.tp_2;
		expect(nodeLayoutMatches(fewer, state)).toBe(false);
	});

	it('rejects a changed collapsed set', () => {
		const collapsed = parseNodeLayout(buildNodeLayout(state));
		collapsed.collapsedIds = new Set(['plot_1']);
		expect(nodeLayoutMatches(collapsed, state)).toBe(false);

		const none = parseNodeLayout(buildNodeLayout(state));
		none.collapsedIds = new Set();
		expect(nodeLayoutMatches(none, state)).toBe(false);
	});

	it('rejects a resized preview box', () => {
		const resized = parseNodeLayout(buildNodeLayout(state));
		resized.sizes.plot_1.h = 201;
		expect(nodeLayoutMatches(resized, state)).toBe(false);

		const dropped = parseNodeLayout(buildNodeLayout(state));
		delete dropped.sizes.plot_1;
		expect(nodeLayoutMatches(dropped, state)).toBe(false);
	});

	it('treats two empty layouts as matching', () => {
		expect(
			nodeLayoutMatches(parseNodeLayout({}), { positions: {}, collapsedIds: new Set(), sizes: {} })
		).toBe(true);
	});
});
