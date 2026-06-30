import { describe, it, expect } from 'vitest';
import { FACETABLE_PLOT_TYPES } from './Plot.svelte';

// The faceting engine (syncFacetChildren) is plot-type-agnostic; this registry is
// what gates the facet toggle per plot type. Guard its contents so a type isn't
// silently added/dropped. (Histogram is pending — it uses a column-based series
// model the engine doesn't yet handle.)
describe('FACETABLE_PLOT_TYPES', () => {
	it('includes every rolled-out (x/y series) plot type', () => {
		for (const t of ['scatterplot', 'boxplot', 'actogram', 'correlogram', 'periodogram', 'fft']) {
			expect(FACETABLE_PLOT_TYPES.has(t), t).toBe(true);
		}
	});

	it('excludes types that cannot facet with the current engine', () => {
		for (const t of ['histogram', 'tableplot', 'dataview']) {
			expect(FACETABLE_PLOT_TYPES.has(t), t).toBe(false);
		}
	});
});
