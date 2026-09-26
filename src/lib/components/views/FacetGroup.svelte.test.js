// @ts-nocheck
// A facet generator on the workspace is ONE FacetGroup: a Draggable per derived panel
// (plan 2026-09-26-facets-as-views, section 1.5), nothing minted into core.plots.
// Pins: one card per unit at the panel's derived position with the panel's svg id; a
// series reorder keeps every card's DOM element (no remount); dragging a card moves the
// GENERATOR; alt-click selects across panels; a rewire adds a card without disturbing
// the others.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { core, appConsts, appState } from '$lib/core/core.svelte.js';
import { loadPlots } from '$test/plotRegistry.js';
import { Plot } from '$lib/core/Plot.svelte';
import { Column } from '$lib/core/Column.svelte';
import { panelsFor } from '$lib/core/facetPanels.svelte.js';
import { history } from '$lib/core/opHistory.svelte.js';
import FacetGroup from './FacetGroup.svelte';

function mkCol(name, values) {
	const c = new Column({ type: 'number', data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

function makeHistogram(names, extra = {}) {
	const gen = new Plot({
		type: 'histogram',
		facet: true,
		x: 60,
		y: 60,
		width: 520,
		height: 300,
		plot: { data: [] },
		...extra
	});
	for (const n of names) gen.plot.addData({ column: { refId: mkCol(n, [1, 2, 3, 4, 5, 6]) } });
	core.plots.push(gen);
	return gen;
}

/** Let the projection microtasks and the resulting renders settle. */
async function settle() {
	await new Promise((r) => queueMicrotask(r));
	await new Promise((r) => setTimeout(r, 0));
	flushSync();
}

const cards = (container) => [...container.querySelectorAll('section.draggable')];
const svgs = (container) => [...container.querySelectorAll('svg[id^="plot"]')];

function mouse(target, type, { x = 0, y = 0, alt = false } = {}) {
	target.dispatchEvent(
		new MouseEvent(type, {
			bubbles: true,
			cancelable: true,
			clientX: x,
			clientY: y,
			button: 0,
			altKey: alt
		})
	);
}

beforeEach(async () => {
	appConsts.plotMap = await loadPlots();
	core.data = [];
	core.plots = [];
	core.rawData = new Map();
	appState.gridSize = 15;
	appState.canvasScale = 1;
	appState.canvasOffset = { x: 0, y: 0 };
	history.init();
	history.clear();
});
afterEach(() => cleanup());

describe('FacetGroup', () => {
	it('renders one card per panel, at the panel position, with the panel svg id, and mints nothing', async () => {
		const gen = makeHistogram(['height', 'weight', 'income', 'noise']);
		const { container } = render(FacetGroup, { props: { generator: gen } });
		await settle();

		const panels = panelsFor(gen);
		expect(panels).toHaveLength(4);
		const secs = cards(container);
		expect(secs).toHaveLength(4);
		// The same grid the v76.4 children sat on: (60,435), (615,435), (60,795), (615,795).
		expect(panels.map((p) => [p.x, p.y])).toEqual([
			[60, 435],
			[615, 435],
			[60, 795],
			[615, 795]
		]);
		secs.forEach((sec, i) => {
			expect(sec.style.left).toBe(`${panels[i].x}px`);
			expect(sec.style.top).toBe(`${panels[i].y}px`);
		});
		expect(svgs(container).map((s) => s.id)).toEqual(panels.map((p) => 'plot' + p.id));
		// Each svg is the generator's snapped size, exactly as a child was.
		for (const s of svgs(container)) {
			expect(s.getAttribute('width')).toBe('525');
			expect(s.getAttribute('height')).toBe('300');
		}
		expect(core.plots).toHaveLength(1);
		// Titles are the column names and are not editable.
		expect([...container.querySelectorAll('.plot-title')].map((t) => t.textContent.trim())).toEqual(
			['height', 'weight', 'income', 'noise']
		);
		expect(container.querySelector('.plot-title input')).toBeNull();
	});

	it('a series reorder keeps every card and svg element (no remount) and only moves them', async () => {
		const gen = makeHistogram(['a', 'b', 'c']);
		const { container } = render(FacetGroup, { props: { generator: gen } });
		await settle();
		const before = cards(container);
		const svgBefore = svgs(container);
		const idsBefore = panelsFor(gen).map((p) => p.id);

		// Move the last series first, the way reorderSeries does it.
		const data = gen.plot.data;
		const [last] = data.splice(2, 1);
		data.splice(0, 0, last);
		await settle();

		const after = cards(container);
		expect(after).toHaveLength(3);
		// Same three elements, now in the new order.
		expect(after[0]).toBe(before[2]);
		expect(after[1]).toBe(before[0]);
		expect(after[2]).toBe(before[1]);
		expect(svgs(container)[0]).toBe(svgBefore[2]);
		expect(panelsFor(gen).map((p) => p.id)).toEqual([idsBefore[2], idsBefore[0], idsBefore[1]]);
		// The moved panel now sits in the first cell.
		expect(after[0].style.left).toBe('60px');
		expect(after[0].style.top).toBe('435px');
	});

	it('wiring one more column adds a card and leaves the existing elements alone', async () => {
		const gen = makeHistogram(['a', 'b']);
		const { container } = render(FacetGroup, { props: { generator: gen } });
		await settle();
		const before = cards(container);
		gen.plot.addData({ column: { refId: mkCol('c', [1, 2, 3]) } });
		await settle();
		const after = cards(container);
		expect(after).toHaveLength(3);
		expect(after[0]).toBe(before[0]);
		expect(after[1]).toBe(before[1]);
	});

	it('dragging a panel header moves the GENERATOR by the same delta (and every panel with it)', async () => {
		const gen = makeHistogram(['a', 'b']);
		const { container } = render(FacetGroup, { props: { generator: gen } });
		await settle();
		const [p0, p1] = panelsFor(gen);
		const startGen = { x: gen.x, y: gen.y };
		const startP1 = { x: p1.x, y: p1.y };
		const header = cards(container)[1].querySelector('.plot-header');

		mouse(header, 'mousedown', { x: 100, y: 100 });
		mouse(window, 'mousemove', { x: 130, y: 145 });
		mouse(window, 'mouseup', { x: 130, y: 145 });
		flushSync();

		expect(gen.x).toBe(startGen.x + 30);
		expect(gen.y).toBe(startGen.y + 45);
		expect([p1.x, p1.y]).toEqual([startP1.x + 30, startP1.y + 45]);
		expect(p0.x).toBe(60 + 30);
		expect(core.plots).toHaveLength(1);
		// One undo step, on the generator.
		expect(history.undoStack).toHaveLength(1);
		history.undo();
		expect([gen.x, gen.y]).toEqual([startGen.x, startGen.y]);
	});

	it('alt-clicking a second panel keeps the first selected; a plain click selects only that one', async () => {
		const gen = makeHistogram(['a', 'b', 'c']);
		const { container } = render(FacetGroup, { props: { generator: gen } });
		await settle();
		const [p0, p1, p2] = panelsFor(gen);
		const headers = cards(container).map((c) => c.querySelector('.plot-header'));

		mouse(headers[0], 'mousedown');
		mouse(window, 'mouseup');
		expect([p0.selected, p1.selected, p2.selected]).toEqual([true, false, false]);

		mouse(headers[1], 'mousedown', { alt: true });
		mouse(window, 'mouseup');
		expect([p0.selected, p1.selected, p2.selected]).toEqual([true, true, false]);

		mouse(headers[2], 'mousedown');
		mouse(window, 'mouseup');
		expect([p0.selected, p1.selected, p2.selected]).toEqual([false, false, true]);
		flushSync();
		expect(cards(container)[2].classList.contains('selected')).toBe(true);
		expect(cards(container)[0].classList.contains('selected')).toBe(false);
	});

	it('a scalar edit on the generator reaches every panel without remounting it', async () => {
		const gen = makeHistogram(['a', 'b']);
		const { container } = render(FacetGroup, { props: { generator: gen } });
		await settle();
		const before = svgs(container);
		gen.plot.xlimsIN = [0, 10];
		await settle();
		for (const p of panelsFor(gen)) expect(p.plot.xlimsIN).toEqual([0, 10]);
		expect(svgs(container)[0]).toBe(before[0]);
		expect(svgs(container)[1]).toBe(before[1]);
	});
});
