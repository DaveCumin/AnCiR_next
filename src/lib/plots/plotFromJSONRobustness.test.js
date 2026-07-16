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

// The case above only covers an EMPTY data array, so it never exercised a series that omits
// its style. A partial SERIES is just as real: Quick-Plot builds `{x:{refId},y:{refId},...}`
// and a session written by a tool may carry no `line`/`points` at all. Those slots are
// deserialised with an unguarded `LineClass.fromJSON(json.line)`, so a missing slot threw
// `undefined (reading 'colour')` — and because importJson wraps each plot in a try/catch and
// only console.errors, the entire plot vanished with no visible error.
describe('plot fromJSON is robust to a series with no style slots', () => {
	const series = { x: { refId: 1 }, y: { refId: 2 } }; // no line, no points

	it('Scatterplot.fromJSON survives a series with no line/points and defaults them', () => {
		const s = Scatterplotclass.fromJSON(null, { data: [series] });
		expect(s.data).toHaveLength(1);
		// defaulted, not undefined — a colour must come from the palette
		expect(s.data[0].line.colour).toEqual(expect.any(String));
		expect(s.data[0].points.colour).toEqual(expect.any(String));
		expect(s.data[0].line.strokeWidth).toEqual(expect.any(Number));
		expect(s.data[0].points.radius).toEqual(expect.any(Number));
	});

	it('an explicitly undefined colour also defaults (the palette fallback needs no parent)', () => {
		const s = Scatterplotclass.fromJSON(null, {
			data: [{ ...series, line: { colour: undefined }, points: { colour: undefined } }]
		});
		expect(s.data[0].line.colour).toEqual(expect.any(String));
		expect(s.data[0].points.colour).toEqual(expect.any(String));
	});

	it('an explicit colour is still honoured', () => {
		const s = Scatterplotclass.fromJSON(null, {
			data: [{ ...series, line: { colour: '#234154' }, points: { colour: '#BE796B' } }]
		});
		expect(s.data[0].line.colour).toBe('#234154');
		expect(s.data[0].points.colour).toBe('#BE796B');
	});
});
