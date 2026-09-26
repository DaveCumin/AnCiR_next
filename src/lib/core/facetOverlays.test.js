// @ts-nocheck
// Facet replication of overlays (plan 2026-09-13, B5, carried into facets as views): the
// generator's reference lines / bands appear on every panel, as copies the panel owns, with
// the generator's ids, so a mark drawn on the generator shows on all its small multiples.
import { describe, it, expect, beforeEach } from 'vitest';
import { core, appConsts, appState } from '$lib/core/core.svelte.js';
import { loadPlots } from '$test/plotRegistry.js';
import { Plot } from '$lib/core/Plot.svelte';
import { Column } from '$lib/core/Column.svelte';
import { OverlayClass } from '$lib/plots/Scatterplot/Overlay.svelte';
import { panelsFor, projectPanel } from '$lib/core/facetPanels.svelte.js';

function mkCol(name, values) {
	const c = new Column({ type: 'number', data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

// A faceted scatterplot with two y series on one x, and an `overlays` array of
// real OverlayClass instances pushed directly.
function makeGenerator() {
	const x = mkCol('t', [0, 1, 2, 3]);
	const gen = new Plot({ type: 'scatterplot', facet: true, plot: { data: [] } });
	gen.plot.addData({ x: { refId: x }, y: { refId: mkCol('a', [1, 2, 3, 4]) } });
	gen.plot.addData({ x: { refId: x }, y: { refId: mkCol('b', [4, 3, 2, 1]) } });
	if (!Array.isArray(gen.plot.overlays)) gen.plot.overlays = [];
	core.plots.push(gen);
	return gen;
}

const projected = (gen) => {
	const panels = panelsFor(gen);
	panels.forEach((p) => projectPanel(p));
	return panels;
};
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
	it('every overlay (form, wiring, typed values, style) is present on each panel', () => {
		const gen = makeGenerator();
		const crossing = mkCol('crossing', [1.5, 2.5]);
		const line = new OverlayClass(gen.plot, { kind: 'line', form: 'vertical', label: 'alert' });
		line.addWire('at', crossing);
		line.colour = '#C0392B';
		const band = new OverlayClass(gen.plot, { kind: 'band', form: 'horizontal' });
		band.setTyped('lower', 1);
		band.setTyped('upper', 3);
		gen.plot.overlays.push(line, band);

		const panels = projected(gen);
		expect(panels).toHaveLength(2);
		for (const panel of panels) {
			expect(panel.plot.overlays).toHaveLength(2);
			expect(panel.plot.overlays.every((o) => o instanceof OverlayClass)).toBe(true);
			expect(jsonOf(panel.plot)).toEqual(jsonOf(gen.plot));
			// Copies, not shared instances: the panel's overlay belongs to the panel.
			expect(panel.plot.overlays[0]).not.toBe(line);
			expect(panel.plot.overlays[0].parentPlot).toBe(panel.plot);
			expect(panel.plot.overlays[0].wiredRefIds('at')).toEqual([crossing]);
			expect(panel.plot.overlays[1].channels.lower.typed).toEqual([1]);
		}
	});

	it("panels carry the generator's overlay ids (same `ov<id>_<key>` ports on every small multiple)", () => {
		const gen = makeGenerator();
		const line = new OverlayClass(gen.plot, { kind: 'line', form: 'vertical' });
		const band = new OverlayClass(gen.plot, { kind: 'band', form: 'repeating' });
		gen.plot.overlays.push(line, band);
		for (const panel of projected(gen)) {
			expect(panel.plot.overlays.map((o) => o.id)).toEqual([line.id, band.id]);
		}
		// A later overlay minted on the generator never collides with a copied id.
		const later = new OverlayClass(gen.plot, { kind: 'line' });
		expect(later.id).toBeGreaterThan(band.id);
	});

	it('follows later edits: a form change, a new wire and a removed overlay all reach the panels', () => {
		const gen = makeGenerator();
		const band = new OverlayClass(gen.plot, { kind: 'band', form: 'ribbon' });
		gen.plot.overlays.push(band);
		expect(projected(gen)[0].plot.overlays[0].form).toBe('ribbon');

		band.setForm('vertical');
		band.setWire('start', mkCol('s', [1]));
		for (const panel of projected(gen)) {
			expect(panel.plot.overlays[0].form).toBe('vertical');
			expect(panel.plot.overlays[0].wiredRefIds('start')).toEqual(band.wiredRefIds('start'));
		}

		gen.plot.overlays = [];
		for (const panel of projected(gen)) expect(panel.plot.overlays).toEqual([]);
	});

	it('a plot type without an overlays array projects panels with none', () => {
		const gen = new Plot({ type: 'histogram', facet: true, plot: { data: [] } });
		gen.plot.addData({ column: { refId: mkCol('A', [1, 2, 3]) } });
		core.plots.push(gen);
		const [panel] = projected(gen);
		expect(panel.plot.overlays ?? []).toEqual([]);
	});
});
