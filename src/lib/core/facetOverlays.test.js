// @ts-nocheck
// Facet replication of overlays (plan 2026-09-13, B5): the generator's reference
// lines / bands are copied onto every child, idempotently, so a mark drawn on
// the generator appears on all its small multiples.
import { describe, it, expect, beforeEach } from 'vitest';
import { core, appConsts, appState } from '$lib/core/core.svelte.js';
import { loadPlots } from '$lib/plots/plotMap.js';
import { Plot, syncFacetChildren, syncFacetOverlays } from '$lib/core/Plot.svelte';
import { Column } from '$lib/core/Column.svelte';
import { OverlayClass } from '$lib/plots/Scatterplot/Overlay.svelte';

function mkCol(name, values) {
	const c = new Column({ type: 'number', data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

// A faceted scatterplot with two y series on one x, and an `overlays` array of
// real OverlayClass instances pushed directly (the ScatterPlotclass half of the
// feature adds the same array; this test does not depend on it).
function makeGenerator() {
	const x = mkCol('t', [0, 1, 2, 3]);
	const gen = new Plot({ type: 'scatterplot', facet: true, plot: { data: [] } });
	gen.plot.addData({ x: { refId: x }, y: { refId: mkCol('a', [1, 2, 3, 4]) } });
	gen.plot.addData({ x: { refId: x }, y: { refId: mkCol('b', [4, 3, 2, 1]) } });
	if (!Array.isArray(gen.plot.overlays)) gen.plot.overlays = [];
	core.plots.push(gen);
	return gen;
}

const children = (gen) => core.plots.filter((p) => p.facetParent === gen.id);
const stripIds = (inner) =>
	(inner.overlays ?? []).map((o) =>
		Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'id'))
	);
const jsonOf = (inner) => stripIds({ overlays: (inner.overlays ?? []).map((o) => o.toJSON()) });

beforeEach(async () => {
	appConsts.plotMap = await loadPlots();
	core.data = [];
	core.plots = [];
	core.rawData = new Map();
	appState.gridSize = 15;
});

describe('facet overlay replication', () => {
	it('copies every overlay (form, wiring, typed values, style) onto each child', () => {
		const gen = makeGenerator();
		const crossing = mkCol('crossing', [1.5, 2.5]);
		const line = new OverlayClass(gen.plot, { kind: 'line', form: 'vertical', label: 'alert' });
		line.addWire('at', crossing);
		line.colour = '#C0392B';
		const band = new OverlayClass(gen.plot, { kind: 'band', form: 'horizontal' });
		band.setTyped('lower', 1);
		band.setTyped('upper', 3);
		gen.plot.overlays.push(line, band);

		syncFacetChildren(gen);
		const kids = children(gen);
		expect(kids).toHaveLength(2);
		for (const kid of kids) {
			expect(kid.plot.overlays).toHaveLength(2);
			expect(kid.plot.overlays.every((o) => o instanceof OverlayClass)).toBe(true);
			expect(jsonOf(kid.plot)).toEqual(jsonOf(gen.plot));
			// Copies, not shared instances: the child's overlay belongs to the child.
			expect(kid.plot.overlays[0]).not.toBe(line);
			expect(kid.plot.overlays[0].parentPlot).toBe(kid.plot);
			expect(kid.plot.overlays[0].wiredRefIds('at')).toEqual([crossing]);
			expect(kid.plot.overlays[1].channels.lower.typed).toEqual([1]);
		}
	});

	it("children carry the generator's overlay ids (same `ov<id>_<key>` ports on every small multiple)", () => {
		const gen = makeGenerator();
		const line = new OverlayClass(gen.plot, { kind: 'line', form: 'vertical' });
		const band = new OverlayClass(gen.plot, { kind: 'band', form: 'repeating' });
		gen.plot.overlays.push(line, band);
		syncFacetChildren(gen);
		for (const kid of children(gen)) {
			expect(kid.plot.overlays.map((o) => o.id)).toEqual([line.id, band.id]);
		}
		// A later overlay minted on the generator never collides with a copied id.
		const later = new OverlayClass(gen.plot, { kind: 'line' });
		expect(later.id).toBeGreaterThan(band.id);
	});

	it('is idempotent: a second sync with nothing changed keeps the child instances', () => {
		const gen = makeGenerator();
		gen.plot.overlays.push(new OverlayClass(gen.plot, { kind: 'line', form: 'horizontal' }));
		syncFacetChildren(gen);
		const before = children(gen).map((k) => k.plot.overlays[0]);
		syncFacetChildren(gen);
		const after = children(gen).map((k) => k.plot.overlays[0]);
		expect(after).toEqual(before);
		after.forEach((o, i) => expect(o).toBe(before[i]));
	});

	it('follows later edits: a form change, a new wire and a removed overlay all propagate', () => {
		const gen = makeGenerator();
		const band = new OverlayClass(gen.plot, { kind: 'band', form: 'ribbon' });
		gen.plot.overlays.push(band);
		syncFacetChildren(gen);
		expect(children(gen)[0].plot.overlays[0].form).toBe('ribbon');

		band.setForm('vertical');
		band.setWire('start', mkCol('s', [1]));
		syncFacetChildren(gen);
		for (const kid of children(gen)) {
			expect(kid.plot.overlays[0].form).toBe('vertical');
			expect(kid.plot.overlays[0].wiredRefIds('start')).toEqual(band.wiredRefIds('start'));
		}

		gen.plot.overlays = [];
		syncFacetChildren(gen);
		for (const kid of children(gen)) expect(kid.plot.overlays).toEqual([]);
	});

	it('syncFacetOverlays leaves a child alone when the generator has no overlays array', () => {
		const gen = { plot: { data: [] } };
		const child = { plot: { data: [], overlays: [] } };
		syncFacetOverlays(gen, child);
		expect(child.plot.overlays).toEqual([]);
		syncFacetOverlays(null, child);
		syncFacetOverlays(gen, null);
	});
});
