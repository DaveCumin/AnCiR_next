// A plot spawned by the Quick-Plot button is created via mutationService.addPlot
// with a PARTIAL inner (just `{ data: [...] }`) — no padding/axis fields. Each
// plot class's fromJSON must keep its default padding rather than clobber it with
// `undefined`, or the plotheight derived throws
// "Cannot read properties of undefined (reading 'top')" at render.
import { describe, it, expect } from 'vitest';
import { Scatterplotclass } from './Scatterplot/Scatterplot.svelte';
import { Boxplotclass } from './Boxplot/Boxplot.svelte';

describe('plot fromJSON is robust to a partial (quick-plot) inner', () => {
	it('Scatterplot.fromJSON({data:[]}) keeps a valid padding + computable plotheight', () => {
		const s = Scatterplotclass.fromJSON(null, { data: [] });
		expect(s.padding).toMatchObject({
			top: expect.any(Number),
			bottom: expect.any(Number)
		});
		s.parentBox = { width: 400, height: 300 };
		expect(s.plotheight).toBe(300 - s.padding.top - s.padding.bottom);
	});

	it('Boxplot.fromJSON({data:[]}) keeps a valid padding + computable plotheight', () => {
		const b = Boxplotclass.fromJSON(null, { data: [] });
		expect(b.padding).toMatchObject({
			top: expect.any(Number),
			bottom: expect.any(Number)
		});
		b.parentBox = { width: 400, height: 300 };
		expect(b.plotheight).toBe(300 - b.padding.top - b.padding.bottom);
	});
});
