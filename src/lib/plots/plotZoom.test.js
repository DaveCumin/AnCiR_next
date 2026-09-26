// @ts-nocheck
// Link-zoom on facets as views (plan 2026-09-26-facets-as-views, sections 0.2 and 1.6):
// brushing a PANEL writes x once, on the generator (every panel projects it), and y to the
// brushed panel's override only; reset clears both. A standalone plot is unchanged.
import { describe, it, expect } from 'vitest';
import { applyLinkedZoom, writeAxisLimit } from './plotZoom.js';

// Minimal stand-ins: an outer Plot with an inner model holding limit arrays, and a panel
// (the FacetPanel surface plotZoom reads: `generator` + `unitKey`).
function makePlot(id, extra = {}) {
	return {
		id,
		facet: extra.facet ?? false,
		facetOverrides: {},
		plot: {
			xlimsIN: [null, null],
			ylimsLeftIN: [null, null],
			ylimsRightIN: [null, null]
		}
	};
}
function makePanel(gen, unitKey) {
	return { id: `${gen.id}:${unitKey}`, unitKey, generator: gen, type: 'scatterplot' };
}

describe('applyLinkedZoom on a standalone plot', () => {
	const limits = { xlims: [2, 6], ylimsLeft: [10, 40], ylimsRight: null };

	it('applies full x+y limits to the plot itself', () => {
		const p = makePlot('a');
		applyLinkedZoom(p, limits);
		expect(p.plot.xlimsIN).toEqual([2, 6]);
		expect(p.plot.ylimsLeftIN).toEqual([10, 40]);
		expect(p.plot.ylimsRightIN).toEqual([null, null]);
		expect(p.facetOverrides).toEqual({});
	});

	it('does not mutate the caller-supplied limit arrays', () => {
		const p = makePlot('a');
		const src = { xlims: [1, 2], ylimsLeft: [3, 4] };
		applyLinkedZoom(p, src);
		p.plot.xlimsIN[0] = 999;
		expect(src.xlims[0]).toBe(1); // copied, not aliased
	});
});

describe('applyLinkedZoom on a facet panel', () => {
	const limits = { xlims: [2, 6], ylimsLeft: [10, 40], ylimsRight: null };

	it("shares x through the generator and keeps y in the brushed panel's override only", () => {
		const gen = makePlot('gen', { facet: true });
		const p1 = makePanel(gen, 'y1#0');
		applyLinkedZoom(p1, limits);

		// x: once, on the generator (what every panel projects).
		expect(gen.plot.xlimsIN).toEqual([2, 6]);
		// y: this panel's override, nothing on the generator, nothing for the sibling.
		expect(gen.plot.ylimsLeftIN).toEqual([null, null]);
		expect(gen.facetOverrides).toEqual({ 'y1#0': { ylimsLeftIN: [10, 40] } });
		expect(gen.facetOverrides['y2#0']).toBeUndefined();
	});

	it('a second panel brushed later shares the new x and gets its own y', () => {
		const gen = makePlot('gen', { facet: true });
		const p1 = makePanel(gen, 'y1#0');
		const p2 = makePanel(gen, 'y2#0');
		applyLinkedZoom(p1, limits);
		applyLinkedZoom(p2, { xlims: [3, 5], ylimsLeft: [0, 1], ylimsRight: [7, 8] });
		expect(gen.plot.xlimsIN).toEqual([3, 5]);
		expect(gen.facetOverrides).toEqual({
			'y1#0': { ylimsLeftIN: [10, 40] },
			'y2#0': { ylimsLeftIN: [0, 1], ylimsRightIN: [7, 8] }
		});
	});

	it("reset (null limits) clears the shared x and removes the panel's y override entirely", () => {
		const gen = makePlot('gen', { facet: true });
		const p1 = makePanel(gen, 'y1#0');
		const p2 = makePanel(gen, 'y2#0');
		applyLinkedZoom(p1, limits);
		applyLinkedZoom(p2, limits);
		applyLinkedZoom(p1, {
			xlims: [null, null],
			ylimsLeft: [null, null],
			ylimsRight: [null, null]
		});
		expect(gen.plot.xlimsIN).toEqual([null, null]);
		// No empty entry left behind for p1; p2's own y survives.
		expect(gen.facetOverrides).toEqual({ 'y2#0': { ylimsLeftIN: [10, 40] } });
	});

	it("the override holds a copy of the limits, not the caller's array", () => {
		const gen = makePlot('gen', { facet: true });
		const p1 = makePanel(gen, 'y1#0');
		const src = { ylimsLeft: [10, 40] };
		applyLinkedZoom(p1, src);
		src.ylimsLeft[0] = 999;
		expect(gen.facetOverrides['y1#0'].ylimsLeftIN).toEqual([10, 40]);
	});

	it('replaces leaf-form overrides of the same key (what the migration writes) and a reset removes them too', () => {
		const gen = makePlot('gen', { facet: true });
		gen.facetOverrides = {
			'y1#0': { 'ylimsLeftIN[0]': 10, 'ylimsLeftIN[1]': 40, xlimsIN: [1, 2] }
		};
		const p1 = makePanel(gen, 'y1#0');
		applyLinkedZoom(p1, { ylimsLeft: [0, 5] });
		expect(gen.facetOverrides['y1#0']).toEqual({ xlimsIN: [1, 2], ylimsLeftIN: [0, 5] });
		gen.facetOverrides = { 'y1#0': { 'ylimsLeftIN[0]': 10, 'ylimsLeftIN[1]': 40 } };
		applyLinkedZoom(p1, { ylimsLeft: [null, null] });
		expect(gen.facetOverrides).toEqual({});
	});

	it('a generator with no override map yet gets one', () => {
		const gen = makePlot('gen', { facet: true });
		delete gen.facetOverrides;
		applyLinkedZoom(makePanel(gen, 'y1#0'), { ylimsLeft: [1, 2] });
		expect(gen.facetOverrides).toEqual({ 'y1#0': { ylimsLeftIN: [1, 2] } });
	});
});

describe("writeAxisLimit (the zoom adapters' write path)", () => {
	it('a non-shared key on a panel is an override; a shared one lands on the generator', () => {
		const gen = makePlot('gen', { facet: true });
		gen.plot.periodlimsIN = [1, 30];
		gen.plot.ylimsIN = [null, null];
		const panel = makePanel(gen, 'y1#0');
		writeAxisLimit(panel, 'periodlimsIN', [5, 10], { shared: true });
		writeAxisLimit(panel, 'ylimsIN', [0, 3]);
		expect(gen.plot.periodlimsIN).toEqual([5, 10]);
		expect(gen.plot.ylimsIN).toEqual([null, null]);
		expect(gen.facetOverrides).toEqual({ 'y1#0': { ylimsIN: [0, 3] } });
	});

	it('on a plot every key goes to its inner, shared or not', () => {
		const p = makePlot('a');
		writeAxisLimit(p, 'periodlimsIN', [5, 10], { shared: true });
		writeAxisLimit(p, 'ylimsIN', [0, 3]);
		expect(p.plot.periodlimsIN).toEqual([5, 10]);
		expect(p.plot.ylimsIN).toEqual([0, 3]);
	});

	it('ignores a missing ref or a non-array value', () => {
		const p = makePlot('a');
		expect(() => writeAxisLimit(null, 'xlimsIN', [1, 2])).not.toThrow();
		writeAxisLimit(p, 'xlimsIN', 'nope');
		expect(p.plot.xlimsIN).toEqual([null, null]);
	});
});
