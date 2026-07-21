import { describe, it, expect } from 'vitest';
import { FACETABLE_PLOT_TYPES } from './Plot.svelte';

// This registry gates the facet toggle per plot type. Guard its contents so a type isn't
// silently added/dropped. Most types use an x/y series model; the histogram is column-based
// (one `column` ref per series) and the engine handles both.
describe('FACETABLE_PLOT_TYPES', () => {
	it('includes every rolled-out plot type (x/y and column-based)', () => {
		for (const t of ['scatterplot', 'boxplot', 'actogram', 'correlogram', 'periodogram', 'fft', 'histogram']) {
			expect(FACETABLE_PLOT_TYPES.has(t), t).toBe(true);
		}
	});

	it('excludes types that cannot facet with the current engine', () => {
		for (const t of ['tableplot', 'dataview']) {
			expect(FACETABLE_PLOT_TYPES.has(t), t).toBe(false);
		}
	});
});
