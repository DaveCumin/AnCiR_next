// @ts-nocheck
// Facets as views (plan 2026-09-26-facets-as-views, sections 1.2 to 1.4): stable unit
// identity, the memoised panel list, panel geometry equal to today's child geometry, and
// the two-level projection (rebuild vs in-place mirror) of a panel instance.
//
// The unit list and the panel geometry are pinned to values captured from v76.4's
// child-plot reconcile in its last run before it was deleted (v76.4, `58679bc8`), so
// the module is held to the behaviour users had, not to itself.
import { describe, it, expect, beforeEach } from 'vitest';
import { core, appConsts, appState, snapToGrid } from '$lib/core/core.svelte.js';
import { loadPlots } from '$test/plotRegistry.js';
import { Plot, FACETABLE_PLOT_TYPES as PLOT_FACETABLE } from '$lib/core/Plot.svelte';
import { Column } from '$lib/core/Column.svelte';
import { OverlayClass } from '$lib/plots/Scatterplot/Overlay.svelte';
import { FACETABLE_PLOT_TYPES, COLUMN_BASED_FACET_TYPES } from '$lib/core/facetTypes.js';
import {
	unitKeyFor,
	facetUnits,
	facetSets,
	FacetPanel,
	panelsFor,
	allPanels,
	projectPanel,
	schedulePanelProjection,
	unitListSig,
	panelStructureSig
} from '$lib/core/facetPanels.svelte.js';

function mkCol(name, values) {
	const c = new Column({ type: 'number', data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

function makeScatter({ facet = true, ys = ['a', 'b', 'c'], extra = {} } = {}) {
	const x = mkCol('t', [0, 1, 2, 3]);
	const gen = new Plot({ type: 'scatterplot', facet, plot: { data: [] }, ...extra });
	for (const name of ys) {
		gen.plot.addData({ x: { refId: x }, y: { refId: mkCol(name, [1, 2, 3, 4]) } });
	}
	core.plots.push(gen);
	return { gen, x };
}

function makeHistogram(n, extra = {}) {
	const gen = new Plot({ type: 'histogram', facet: true, plot: { data: [] }, ...extra });
	for (let i = 0; i < n; i++)
		gen.plot.addData({ column: { refId: mkCol(`col${i}`, [1, 2, 3, 4, 5]) } });
	core.plots.push(gen);
	return gen;
}

// Child geometry captured from v76.4's child reconcile for a generator at x 47, y 123,
// 372 x 218, gridSize 15: every child was 375 x 225 (the generator's size snapped), the grid
// origin was (45, 435) and it stepped 405 across and 285 down. Cells are [col, row] per unit
// index, so the pin below is the exact [x, y, w, h] each child had.
const PIN = { originX: 45, originY: 435, stepX: 405, stepY: 285, w: 375, h: 225 };
// prettier-ignore
const PINNED_CELLS = {
	// facetRows 0 (automatic, near-square)
	'0:1': [[0, 0]],
	'0:2': [[0, 0], [1, 0]],
	'0:3': [[0, 0], [1, 0], [0, 1]],
	'0:4': [[0, 0], [1, 0], [0, 1], [1, 1]],
	'0:5': [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1]],
	'0:6': [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]],
	'0:7': [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2]],
	// facetRows 1
	'1:1': [[0, 0]],
	'1:2': [[0, 0], [1, 0]],
	'1:3': [[0, 0], [1, 0], [2, 0]],
	'1:4': [[0, 0], [1, 0], [2, 0], [3, 0]],
	'1:5': [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]],
	'1:6': [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]],
	'1:7': [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0]],
	// facetRows 2
	'2:1': [[0, 0]],
	'2:2': [[0, 0], [0, 1]],
	'2:3': [[0, 0], [1, 0], [0, 1]],
	'2:4': [[0, 0], [1, 0], [0, 1], [1, 1]],
	'2:5': [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1]],
	'2:6': [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]],
	'2:7': [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1]],
	// facetRows 3
	'3:1': [[0, 0]],
	'3:2': [[0, 0], [0, 1]],
	'3:3': [[0, 0], [0, 1], [0, 2]],
	'3:4': [[0, 0], [1, 0], [0, 1], [0, 2]],
	'3:5': [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]],
	'3:6': [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]],
	'3:7': [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [0, 2], [1, 2]]
};
const pinnedGeometry = (rows, n) =>
	PINNED_CELLS[`${rows}:${n}`].map(([c, r]) => [
		PIN.originX + c * PIN.stepX,
		PIN.originY + r * PIN.stepY,
		PIN.w,
		PIN.h
	]);

const flush = () => new Promise((r) => queueMicrotask(r));

beforeEach(async () => {
	appConsts.plotMap = await loadPlots();
	core.data = [];
	core.plots = [];
	core.rawData = new Map();
	appState.gridSize = 15;
});

describe('facetTypes is the one facet type set (Plot.svelte re-exports it)', () => {
	it('FACETABLE_PLOT_TYPES is the same set', () => {
		expect([...FACETABLE_PLOT_TYPES].sort()).toEqual([...PLOT_FACETABLE].sort());
	});
	it('the column-based set is the histogram', () => {
		expect([...COLUMN_BASED_FACET_TYPES]).toEqual(['histogram']);
	});
});

describe('unit identity', () => {
	it('unitKeyFor formats role, ref and ordinal', () => {
		expect(unitKeyFor('y', 112, 0)).toBe('y112#0');
		expect(unitKeyFor('c', 241, 3)).toBe('c241#3');
	});

	it('x/y units are keyed by the y column with role y; column-based by the column with role c', () => {
		const { gen } = makeScatter();
		const refs = gen.plot.data.map((d) => d.y.refId);
		expect(facetUnits(gen).map((u) => u.key)).toEqual(refs.map((r) => `y${r}#0`));
		const hist = makeHistogram(2);
		const crefs = hist.plot.data.map((d) => d.column.refId);
		expect(facetUnits(hist).map((u) => u.key)).toEqual(crefs.map((r) => `c${r}#0`));
	});

	it('the same column wired twice gives #0 and #1 in data order', () => {
		const { gen, x } = makeScatter({ ys: ['a', 'b'] });
		const aRef = gen.plot.data[0].y.refId;
		gen.plot.addData({ x: { refId: x }, y: { refId: aRef } });
		const keys = facetUnits(gen).map((u) => u.key);
		expect(keys).toEqual([`y${aRef}#0`, `y${gen.plot.data[1].y.refId}#0`, `y${aRef}#1`]);
	});

	it('each unit records the generator data indices it is built from (seriesIdx)', () => {
		// Set 1 (x1): a, b. Set 2 (x2, the fit): fa, fb. Unit i = [set1[i], set2[i]].
		const { gen } = makeScatter({ ys: ['a', 'b'] });
		const x2 = mkCol('t2', [0, 1, 2, 3]);
		gen.plot.addData({ x: { refId: x2 }, y: { refId: mkCol('fa', [1, 1, 1, 1]) } });
		gen.plot.addData({ x: { refId: x2 }, y: { refId: mkCol('fb', [2, 2, 2, 2]) } });
		const units = facetUnits(gen);
		expect(units.map((u) => u.seriesIdx)).toEqual([
			[0, 2],
			[1, 3]
		]);
		expect(units.map((u) => u.index)).toEqual([0, 1]);
		expect(facetSets(gen.plot.data).map((s) => s.idx)).toEqual([
			[0, 1],
			[2, 3]
		]);
	});
});

describe('the unit LIST equals the v76.4 child list (pinned from the child reconcile)', () => {
	it('x/y type with a paired second set: one unit per y of set 1, the i-th y of set 2 paired onto unit i', () => {
		const { gen, x } = makeScatter({ ys: ['a', 'b', 'c'] });
		const x2 = mkCol('t2', [0, 1, 2, 3]);
		const fa = mkCol('fa', [1, 1, 1, 1]);
		const fb = mkCol('fb', [2, 2, 2, 2]);
		gen.plot.addData({ x: { refId: x2 }, y: { refId: fa } });
		gen.plot.addData({ x: { refId: x2 }, y: { refId: fb } });
		const [a, b, c] = gen.plot.data.slice(0, 3).map((d) => d.y.refId);
		const units = facetUnits(gen);
		// v76.4 spawned three children named a, b, c: a and b each carried its own series plus
		// the paired fit series (set 2 has only two ys), c carried its series alone.
		expect(units.map((u) => u.name)).toEqual(['a', 'b', 'c']);
		expect(units.map((u) => u.desired)).toEqual([
			[
				{ xRef: x, yRef: a },
				{ xRef: x2, yRef: fa }
			],
			[
				{ xRef: x, yRef: b },
				{ xRef: x2, yRef: fb }
			],
			[{ xRef: x, yRef: c }]
		]);
		expect(units.map((u) => u.sig)).toEqual([
			`${x}:${a},${x2}:${fa}`,
			`${x}:${b},${x2}:${fb}`,
			`${x}:${c}`
		]);
		// The v76.4 key was `${gen.id}:${i}:${yRef}`; the column part is what the unit keeps.
		expect(units.map((u) => u.key)).toEqual([`y${a}#0`, `y${b}#0`, `y${c}#0`]);
	});

	it('column-based type: one unit per wired column, in wired order, named by the column', () => {
		const gen = makeHistogram(4);
		const refs = gen.plot.data.map((d) => d.column.refId);
		const units = facetUnits(gen);
		expect(units).toHaveLength(4);
		expect(units.map((u) => u.name)).toEqual(['col0', 'col1', 'col2', 'col3']);
		expect(units.map((u) => u.desired)).toEqual(refs.map((r) => [{ column: r }]));
		expect(units.map((u) => u.sig)).toEqual(refs.map((r) => `c${r}`));
	});

	it('an unwired (refId -1) or deleted-column series is skipped, as v76.4 skipped it', () => {
		const { gen } = makeScatter({ ys: ['a', 'b'] });
		gen.plot.data[1].y.refId = -1;
		expect(facetUnits(gen)).toHaveLength(1);
		expect(panelsFor(gen)).toHaveLength(1);
		expect(panelsFor(gen)[0].name).toBe('a');
	});
});

describe('panelsFor: memoised, identity-stable', () => {
	it('returns one FacetPanel per unit with the plan surface, and an empty list when facet is off', () => {
		const { gen } = makeScatter({ ys: ['a', 'b'] });
		const panels = panelsFor(gen);
		expect(panels).toHaveLength(2);
		const [p0] = panels;
		expect(p0).toBeInstanceOf(FacetPanel);
		expect(p0.id).toBe(`${gen.id}:${p0.unitKey}`);
		expect(typeof p0.id).toBe('string');
		expect(p0.generator).toBe(gen);
		expect(p0.type).toBe('scatterplot');
		expect(p0.index).toBe(0);
		expect(p0.name).toBe('a');
		expect(p0.style).toBe(gen.style);
		expect(p0.selected).toBe(false);
		expect(p0.plot).toBeUndefined();
		expect(p0.rev).toBe(0);
		// Snapped, exactly as v76.4's children were sized (the generator's size, snapped).
		expect(p0.width).toBe(snapToGrid(gen.width));
		expect(p0.height).toBe(snapToGrid(gen.height));

		gen.facet = false;
		expect(panelsFor(gen)).toEqual([]);
		expect(panelsFor(null)).toEqual([]);
	});

	it('the same list object comes back while nothing changed; nothing is written into core', () => {
		const { gen } = makeScatter();
		const before = core.plots.length;
		const a = panelsFor(gen);
		const b = panelsFor(gen);
		expect(b).toBe(a);
		expect(core.plots.length).toBe(before);
		expect(core.plots).toEqual([gen]);
	});

	it('unit keys are stable under reorder: same objects, index updated', () => {
		const { gen } = makeScatter({ ys: ['a', 'b', 'c'] });
		const before = panelsFor(gen);
		const byKey = Object.fromEntries(before.map((p) => [p.unitKey, p]));
		const keysBefore = before.map((p) => p.unitKey);

		// Move last to first (the case that remints every child today, plan 0.4 item 5).
		const [d0, d1, d2] = gen.plot.data;
		gen.plot.data = [d2, d0, d1];

		const after = panelsFor(gen);
		expect(after.map((p) => p.unitKey)).toEqual([keysBefore[2], keysBefore[0], keysBefore[1]]);
		after.forEach((p) => expect(p).toBe(byKey[p.unitKey]));
		expect(after.map((p) => p.index)).toEqual([0, 1, 2]);
		expect(after.map((p) => p.name)).toEqual(['c', 'a', 'b']);
		expect(byKey[keysBefore[2]].index).toBe(0);
	});

	it('rewiring one series creates one new panel and disposes one; the others are the same objects', () => {
		const { gen } = makeScatter({ ys: ['a', 'b', 'c'] });
		const before = panelsFor(gen);
		const [p0, p1, p2] = before;
		p1.selected = true;

		gen.plot.data[1].y.refId = mkCol('d', [9, 9, 9, 9]);

		const after = panelsFor(gen);
		expect(after).toHaveLength(3);
		expect(after[0]).toBe(p0);
		expect(after[2]).toBe(p2);
		expect(after[1]).not.toBe(p1);
		expect(after[1].name).toBe('d');
		expect(after[1].selected).toBe(false);
		expect(after).not.toContain(p1);
	});

	it('a column rename reaches the panel name without rebuilding the list', () => {
		const { gen } = makeScatter({ ys: ['a'] });
		const list = panelsFor(gen);
		const col = core.data.find((c) => c.id === gen.plot.data[0].y.refId);
		col.customName = 'renamed';
		expect(panelsFor(gen)).toBe(list);
		expect(list[0].name).toBe('renamed');
	});

	it('allPanels flattens every generator and ignores plain plots', () => {
		makeScatter({ facet: false, ys: ['z'] });
		const { gen: g1 } = makeScatter({ ys: ['a', 'b'] });
		const g2 = makeHistogram(3);
		const all = allPanels();
		expect(all).toEqual([...panelsFor(g1), ...panelsFor(g2)]);
		expect(all).toHaveLength(5);
	});

	it('unitListSig changes on reorder, rewire and count; not on a style edit', () => {
		const { gen } = makeScatter({ ys: ['a', 'b'] });
		const s0 = unitListSig(facetUnits(gen));
		gen.plot.data[0].points.radius = 9;
		expect(unitListSig(facetUnits(gen))).toBe(s0);
		gen.plot.data = [gen.plot.data[1], gen.plot.data[0]];
		const s1 = unitListSig(facetUnits(gen));
		expect(s1).not.toBe(s0);
		gen.plot.data[0].y.refId = mkCol('q', [1, 2, 3, 4]);
		expect(unitListSig(facetUnits(gen))).not.toBe(s1);
	});
});

describe('panel geometry equals the v76.4 child geometry to the pixel (pinned)', () => {
	for (const rows of [0, 1, 2, 3]) {
		for (let n = 1; n <= 7; n++) {
			it(`facetRows=${rows}, ${n} unit(s)`, () => {
				const gen = makeHistogram(n, { facetRows: rows, x: 47, y: 123, width: 372, height: 218 });
				const panels = panelsFor(gen);
				expect(panels).toHaveLength(n);
				expect(panels.map((p) => [p.x, p.y, p.width, p.height])).toEqual(pinnedGeometry(rows, n));
			});
		}
	}

	it('geometry follows the generator: moving or resizing it moves every panel (reactively on read)', () => {
		const gen = makeHistogram(2, { x: 0, y: 0 });
		const [p0, p1] = panelsFor(gen);
		const x0 = p1.x;
		gen.x += 150;
		expect(p1.x).toBe(x0 + 150);
		gen.width = 600;
		expect(p0.width).toBe(600);
		// Pinned from v76.4: two children of a generator at (150, 0), 600 wide, default height.
		expect([p0, p1].map((p) => [p.x, p.y, p.width, p.height])).toEqual([
			[150, 330, 600, 255],
			[780, 330, 600, 255]
		]);
	});
});

describe('projectPanel: the panel instance', () => {
	it('builds a real plot-class instance whose parentBox IS the panel (id, width, height, style resolve to it)', () => {
		const { gen } = makeScatter({ ys: ['a', 'b'] });
		const [p0, p1] = panelsFor(gen);
		const r = projectPanel(p1);
		expect(r.mode).toBe('rebuild');
		expect(p1.plot).toBeInstanceOf(gen.plot.constructor);
		expect(p1.plot.parentBox).toBe(p1);
		expect(p1.plot.parentBox.id).toBe(p1.id);
		expect(p1.plot.data).toHaveLength(1);
		expect(p1.plot.data[0].y.refId).toBe(gen.plot.data[1].y.refId);
		expect(p1.plot.data[0].x.refId).toBe(gen.plot.data[1].x.refId);
		// Copies, not the generator's series objects.
		expect(p1.plot.data[0]).not.toBe(gen.plot.data[1]);
		expect(p1.plot.data[0].parentPlot).toBe(p1.plot);
		expect(p1.rev).toBe(1);
		expect(p0.plot).toBeUndefined();
	});

	it('carries the generator’s overlays with the SAME ids, as copies owned by the panel', () => {
		const { gen } = makeScatter({ ys: ['a', 'b'] });
		const line = new OverlayClass(gen.plot, { kind: 'line', form: 'vertical', label: 'alert' });
		line.setTyped('at', 2);
		line.colour = '#C0392B';
		const band = new OverlayClass(gen.plot, { kind: 'band', form: 'horizontal' });
		band.setTyped('lower', 1);
		band.setTyped('upper', 3);
		gen.plot.overlays.push(line, band);

		for (const p of panelsFor(gen)) {
			projectPanel(p);
			expect(p.plot.overlays.map((o) => o.id)).toEqual([line.id, band.id]);
			expect(p.plot.overlays.every((o) => o instanceof OverlayClass)).toBe(true);
			expect(p.plot.overlays[0]).not.toBe(line);
			expect(p.plot.overlays[0].parentPlot).toBe(p.plot);
			expect(p.plot.overlays[0].colour).toBe('#C0392B');
			expect(p.plot.overlays[0].label).toBe('alert');
			expect(p.plot.overlays[1].channels.lower.typed).toEqual([1]);
		}
		const later = new OverlayClass(gen.plot, { kind: 'line' });
		expect(later.id).toBeGreaterThan(band.id);
	});

	it('copies per-series style from the generator (a 6 px marker stays 6 px; v76.4 children got the default)', () => {
		// The documented difference from v76.4 (plan 0.4 item 4): a child was a fresh series with
		// the class default style, so a 6 px generator marker drew at the default radius.
		const { gen } = makeScatter({ ys: ['a', 'b'] });
		gen.plot.data[1].points.radius = 6;
		gen.plot.data[1].line.strokeWidth = 5;
		const [, p1] = panelsFor(gen);
		projectPanel(p1);
		expect(p1.plot.data[0].points.radius).toBe(6);
		expect(p1.plot.data[0].line.strokeWidth).toBe(5);
	});

	it('copies whole-plot properties (limits, axes, padding) the reconcile never copied', () => {
		const { gen } = makeScatter({ ys: ['a'] });
		gen.plot.xlimsIN = [1, 2];
		gen.plot.xAxis.label = 'Time (h)';
		gen.plot.padding.top = 44;
		const [p0] = panelsFor(gen);
		projectPanel(p0);
		expect(p0.plot.xlimsIN).toEqual([1, 2]);
		expect(p0.plot.xAxis.label).toBe('Time (h)');
		expect(p0.plot.padding.top).toBe(44);
	});

	it('panel wrapper columns mint their own ids (never the generator wrapper’s)', () => {
		const { gen } = makeScatter({ ys: ['a'] });
		const [p0] = panelsFor(gen);
		projectPanel(p0);
		expect(p0.plot.data[0].y.id).not.toBe(gen.plot.data[0].y.id);
		expect(p0.plot.data[0].x.id).not.toBe(gen.plot.data[0].x.id);
	});

	it('a second projection with nothing changed is a no-op (same instance, no writes)', () => {
		const { gen } = makeScatter({ ys: ['a'] });
		const [p0] = panelsFor(gen);
		projectPanel(p0);
		const inst = p0.plot;
		const r = projectPanel(p0);
		expect(r).toEqual({ mode: 'noop', paths: [] });
		expect(p0.plot).toBe(inst);
		expect(p0.rev).toBe(1);
	});

	it('MIRRORS a scalar edit in place: same instance, only the changed paths written', () => {
		const { gen } = makeScatter({ ys: ['a', 'b'] });
		const [p0] = panelsFor(gen);
		projectPanel(p0);
		const inst = p0.plot;

		gen.plot.xAxis.label = 'Time';
		let r = projectPanel(p0);
		expect(r.mode).toBe('mirror');
		expect(r.paths).toEqual(['xAxis.label']);
		expect(p0.plot).toBe(inst);
		expect(inst.xAxis.label).toBe('Time');
		expect(p0.rev).toBe(2);

		gen.plot.ylimsLeftIN = [0, 10];
		gen.plot.padding.top = 33;
		gen.plot.data[0].points.radius = 7;
		r = projectPanel(p0);
		expect(r.mode).toBe('mirror');
		expect(r.paths.sort()).toEqual([
			'data[0].points.radius',
			'padding.top',
			'ylimsLeftIN[0]',
			'ylimsLeftIN[1]'
		]);
		expect(p0.plot).toBe(inst);
		expect(inst.ylimsLeftIN).toEqual([0, 10]);
		expect(inst.padding.top).toBe(33);
		expect(inst.data[0].points.radius).toBe(7);

		// A style edit on ANOTHER series is not this panel's business.
		gen.plot.data[1].points.radius = 9;
		expect(projectPanel(p0)).toEqual({ mode: 'noop', paths: [] });
	});

	it('mirrors an overlay style edit in place; an overlay wiring change rebuilds', () => {
		const { gen } = makeScatter({ ys: ['a'] });
		const line = new OverlayClass(gen.plot, { kind: 'line', form: 'vertical' });
		line.setTyped('at', 2);
		gen.plot.overlays.push(line);
		const [p0] = panelsFor(gen);
		projectPanel(p0);
		const inst = p0.plot;

		line.colour = '#123456';
		let r = projectPanel(p0);
		expect(r.mode).toBe('mirror');
		expect(r.paths).toEqual(['overlays[0].colour']);
		expect(p0.plot).toBe(inst);
		expect(inst.overlays[0].colour).toBe('#123456');

		line.setTyped('at', 3);
		r = projectPanel(p0);
		expect(r.mode).toBe('rebuild');
		expect(p0.plot).not.toBe(inst);
		expect(p0.plot.overlays[0].channels.at.typed).toEqual([3]);
	});

	it('REBUILDS on a series rewire (different instance), and on an added overlay', () => {
		const { gen } = makeScatter({ ys: ['a', 'b'] });
		const [p0] = panelsFor(gen);
		projectPanel(p0);
		const inst = p0.plot;

		gen.plot.overlays.push(new OverlayClass(gen.plot, { kind: 'line', form: 'horizontal' }));
		let r = projectPanel(p0);
		expect(r.mode).toBe('rebuild');
		expect(p0.plot).not.toBe(inst);
		const inst2 = p0.plot;

		// Rewire THIS panel's series: the unit key changes, so it is a NEW panel; the old one is
		// disposed and projecting it reports nothing to do.
		const oldRef = gen.plot.data[0].y.refId;
		gen.plot.data[0].y.refId = mkCol('d', [5, 5, 5, 5]);
		const after = panelsFor(gen);
		expect(after[0]).not.toBe(p0);
		expect(projectPanel(p0)).toEqual({ mode: 'disposed', paths: [] });
		expect(p0.plot).toBe(inst2);
		projectPanel(after[0]);
		expect(after[0].plot.data[0].y.refId).not.toBe(oldRef);
	});

	it('a plot-column process on the generator series is part of the structural signature (rebuild, not mirror)', () => {
		const { gen } = makeScatter({ ys: ['a'] });
		const unit = facetUnits(gen)[0];
		const json = JSON.parse(JSON.stringify(gen.plot));
		json.data = [json.data[0]];
		const s0 = panelStructureSig('scatterplot', unit, json);
		json.data[0].y.processes = [{ id: 1, type: 'filter', args: { threshold: 1 } }];
		expect(panelStructureSig('scatterplot', unit, json)).not.toBe(s0);
		// A wrapper column's display fields are NOT wiring: a rename must not rebuild.
		json.data[0].y.processes = [];
		json.data[0].y.name = 'renamed';
		expect(panelStructureSig('scatterplot', unit, json)).toBe(s0);
	});

	it('applies the unit’s Phase 1 override (axis limits) on top of the generator’s inner', () => {
		const { gen } = makeScatter({ ys: ['a', 'b'] });
		gen.plot.ylimsLeftIN = [0, 100];
		const [p0, p1] = panelsFor(gen);
		gen.facetOverrides = { [p1.unitKey]: { 'ylimsLeftIN[1]': 10, xlimsIN: [1, 2] } };
		projectPanel(p0);
		projectPanel(p1);
		expect(p0.plot.ylimsLeftIN).toEqual([0, 100]);
		expect(p1.plot.ylimsLeftIN).toEqual([0, 10]);
		expect(p1.plot.xlimsIN).toEqual([1, 2]);
		expect(p0.plot.xlimsIN).toEqual([null, null]);

		// A changed override mirrors; a generator edit on the overridden leaf does not reach the panel.
		const inst = p1.plot;
		gen.facetOverrides[p1.unitKey]['ylimsLeftIN[1]'] = 20;
		expect(projectPanel(p1)).toEqual({ mode: 'mirror', paths: ['ylimsLeftIN[1]'] });
		expect(p1.plot).toBe(inst);
		expect(inst.ylimsLeftIN).toEqual([0, 20]);
		gen.plot.ylimsLeftIN = [5, 100];
		expect(projectPanel(p1)).toEqual({ mode: 'mirror', paths: ['ylimsLeftIN[0]'] });
		expect(inst.ylimsLeftIN).toEqual([5, 20]);
	});

	it('the structural signature covers type, unit sig, overlay ids and series wiring, nothing else', () => {
		const { gen } = makeScatter({ ys: ['a'] });
		const [p0] = panelsFor(gen);
		const unit = facetUnits(gen)[0];
		const json = JSON.parse(JSON.stringify(gen.plot));
		json.data = [json.data[0]];
		const s0 = panelStructureSig('scatterplot', unit, json);
		expect(s0).toBe(
			JSON.stringify({
				type: 'scatterplot',
				sig: unit.sig,
				overlays: [],
				wiring: [
					JSON.stringify({
						x: { refId: json.data[0].x.refId, processes: [] },
						y: { refId: json.data[0].y.refId, processes: [] }
					})
				]
			})
		);
		json.xAxis.label = 'changed';
		expect(panelStructureSig('scatterplot', unit, json)).toBe(s0);
		json.overlays = [{ id: 4 }];
		expect(panelStructureSig('scatterplot', unit, json)).not.toBe(s0);
		expect(p0.unitKey).toBe(unit.key);
	});

	it('an actogram panel computes its OWN Ndays from its single series, not the generator’s', () => {
		// One shared x (14 days of hours): series A spans all of it, series B is null after day 3.
		// (Two series on DIFFERENT x columns would be two paired sets and ONE unit, as today.)
		const hours = Array.from({ length: 14 * 24 }, (_, i) => i);
		const x = mkCol('h', hours);
		const gen = new Plot({ type: 'actogram', facet: true, plot: { data: [] } });
		gen.plot.addData({
			x: { refId: x },
			y: {
				refId: mkCol(
					'a14',
					hours.map((h) => (h % 24 < 12 ? 10 : 90))
				)
			}
		});
		gen.plot.addData({
			x: { refId: x },
			y: {
				refId: mkCol(
					'a3',
					hours.map((h) => (h < 72 ? (h % 24 < 12 ? 10 : 90) : null))
				)
			}
		});
		core.plots.push(gen);
		expect(gen.plot.Ndays).toBe(14);
		const [p0, p1] = panelsFor(gen);
		projectPanel(p0);
		projectPanel(p1);
		expect(p0.plot.Ndays).toBe(14);
		expect(p1.plot.Ndays).toBe(3);
		expect(p1.plot.data[0].parentPlot).toBe(p1.plot);
	});

	it('schedulePanelProjection defers to a microtask and dedupes', async () => {
		const { gen } = makeScatter({ ys: ['a'] });
		const [p0] = panelsFor(gen);
		schedulePanelProjection(p0);
		schedulePanelProjection(p0);
		expect(p0.plot).toBeUndefined();
		await flush();
		expect(p0.plot).toBeDefined();
		expect(p0.rev).toBe(1);
	});
});
