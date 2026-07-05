import { describe, it, expect } from 'vitest';
import { facetSetFor, applyLinkedZoom } from './plotZoom.js';

// Minimal stand-in for an outer Plot with an inner model holding limit arrays.
function makePlot(id, extra = {}) {
	return {
		id,
		facet: extra.facet ?? false,
		facetParent: extra.facetParent ?? null,
		plot: {
			xlimsIN: [null, null],
			ylimsLeftIN: [null, null],
			ylimsRightIN: [null, null]
		}
	};
}

describe('facetSetFor', () => {
	it('returns just the plot when standalone', () => {
		const p = makePlot('a');
		expect(facetSetFor(p, [p]).map((q) => q.id)).toEqual(['a']);
	});

	it('gathers generator + children when given the generator', () => {
		const gen = makePlot('gen', { facet: true });
		const c1 = makePlot('c1', { facetParent: 'gen' });
		const c2 = makePlot('c2', { facetParent: 'gen' });
		const ids = facetSetFor(gen, [gen, c1, c2]).map((q) => q.id).sort();
		expect(ids).toEqual(['c1', 'c2', 'gen']);
	});

	it('gathers generator + siblings when given a child', () => {
		const gen = makePlot('gen', { facet: true });
		const c1 = makePlot('c1', { facetParent: 'gen' });
		const c2 = makePlot('c2', { facetParent: 'gen' });
		const ids = facetSetFor(c1, [gen, c1, c2]).map((q) => q.id).sort();
		expect(ids).toEqual(['c1', 'c2', 'gen']);
	});
});

describe('applyLinkedZoom', () => {
	const limits = { xlims: [2, 6], ylimsLeft: [10, 40], ylimsRight: null };

	it('applies full x+y limits to a standalone plot', () => {
		const p = makePlot('a');
		applyLinkedZoom(p, limits, [p]);
		expect(p.plot.xlimsIN).toEqual([2, 6]);
		expect(p.plot.ylimsLeftIN).toEqual([10, 40]);
	});

	it('shares x across the facet set but keeps y local to the brushed plot', () => {
		const gen = makePlot('gen', { facet: true });
		const c1 = makePlot('c1', { facetParent: 'gen' });
		const c2 = makePlot('c2', { facetParent: 'gen' });
		applyLinkedZoom(c1, limits, [gen, c1, c2]);

		// Brushed child: full x + y.
		expect(c1.plot.xlimsIN).toEqual([2, 6]);
		expect(c1.plot.ylimsLeftIN).toEqual([10, 40]);

		// Siblings + generator: x shared, y untouched.
		expect(c2.plot.xlimsIN).toEqual([2, 6]);
		expect(c2.plot.ylimsLeftIN).toEqual([null, null]);
		expect(gen.plot.xlimsIN).toEqual([2, 6]);
		expect(gen.plot.ylimsLeftIN).toEqual([null, null]);
	});

	it('reset (null limits) clears the brushed plot and shared x on siblings', () => {
		const gen = makePlot('gen', { facet: true });
		const c1 = makePlot('c1', { facetParent: 'gen' });
		c1.plot.xlimsIN = [2, 6];
		c1.plot.ylimsLeftIN = [10, 40];
		gen.plot.xlimsIN = [2, 6];

		applyLinkedZoom(
			c1,
			{ xlims: [null, null], ylimsLeft: [null, null], ylimsRight: [null, null] },
			[gen, c1]
		);
		expect(c1.plot.xlimsIN).toEqual([null, null]);
		expect(c1.plot.ylimsLeftIN).toEqual([null, null]);
		expect(gen.plot.xlimsIN).toEqual([null, null]);
	});

	it('does not mutate the caller-supplied limit arrays', () => {
		const p = makePlot('a');
		const src = { xlims: [1, 2], ylimsLeft: [3, 4] };
		applyLinkedZoom(p, src, [p]);
		p.plot.xlimsIN[0] = 999;
		expect(src.xlims[0]).toBe(1); // copied, not aliased
	});
});
