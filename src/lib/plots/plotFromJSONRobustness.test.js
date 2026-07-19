// A plot spawned by the Quick-Plot button is created via mutationService.addPlot
// with a PARTIAL inner (just `{ data: [...] }`) — no padding/axis fields. Each
// plot class's fromJSON must keep its default padding rather than clobber it with
// `undefined`, or the plotheight derived throws
// "Cannot read properties of undefined (reading 'top')" at render.
import { describe, it, expect, beforeAll } from 'vitest';
import { Scatterplotclass } from './Scatterplot/Scatterplot.svelte';
import { Boxplotclass } from './Boxplot/Boxplot.svelte';
import { loadPlots } from './plotMap.js';

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

// The two suites above hand-pick Scatterplot and Boxplot — the only plots Quick-Plot could
// spawn when they were written. That left the other nine untested, and three of them
// (Actogram, Histogram, MeanSEM) assigned `json.padding` straight over their default. A
// session written by a tool omits padding, so the default became `undefined` and rendering
// threw "Cannot read properties of undefined (reading 'left')" out of the actogram's
// LightBand. Drive every plot in the registry instead of a hand-kept list, so a new plot
// class is covered the day it is added.
describe('EVERY registered plot survives a partial inner', () => {
	let plotMap;
	beforeAll(async () => {
		plotMap = await loadPlots();
	});

	it('covers the whole registry (guards against the list silently shrinking)', () => {
		expect(plotMap.size).toBeGreaterThanOrEqual(10);
	});

	it('keeps a usable padding for a minimal `{data:[]}` inner', async () => {
		for (const [key, entry] of await loadPlots()) {
			const cls = entry.data;
			// Compare against the class's OWN defaults rather than a hardcoded expectation: plots
			// name the box `padding` or `paddingIN`, and the table-like plots (tableplot,
			// dataview) have no padding at all. Deriving the field from a fresh instance keeps
			// this honest — it asserts only where a default actually exists, and adapts to a new
			// plot without anyone remembering to update a list.
			const fresh = cls.fromJSON(null, null);
			const field =
				fresh?.paddingIN !== undefined ? 'paddingIN' : fresh?.padding !== undefined ? 'padding' : null;
			if (!field) continue; // no padding concept (tableplot / dataview)

			const partial = cls.fromJSON(null, { data: [] });
			const box = partial[field];
			expect(box, `${key}: ${field} is undefined — fromJSON clobbered the class default`).toBeDefined();
			for (const side of ['top', 'right', 'bottom', 'left']) {
				expect(box?.[side], `${key}.${field}.${side}`).toEqual(expect.any(Number));
			}
		}
	});

	it('survives a completely empty inner `{}` and a null inner', async () => {
		for (const [key, entry] of await loadPlots()) {
			expect(() => entry.data.fromJSON(null, {}), `${key} with {}`).not.toThrow();
			expect(() => entry.data.fromJSON(null, null), `${key} with null`).not.toThrow();
		}
	});

	// `padding` was only the first field to be clobbered this way, and fixing it one field at a
	// time is how Periodogram kept `periodlimsIN = json.periodlimsIN` three lines below the
	// comment explaining the bug. That undefined reached the renderer as
	// `theData.plot.periodlimsIN[0]` → "Cannot read properties of undefined (reading '0')", and
	// took the whole plot node down with it.
	//
	// So assert the general rule instead of a list: a class's own toJSON says what it considers
	// state; anything it can WRITE it must be able to READ BACK from an inner that omits it.
	// Derived from each class at runtime, so a new plot (or a new field) is covered without
	// anyone remembering this file exists.
	it('never clobbers a serialisable default with undefined', async () => {
		for (const [key, entry] of await loadPlots()) {
			const cls = entry.data;
			const fresh = cls.fromJSON(null, null);
			if (typeof fresh?.toJSON !== 'function') continue;

			let defaults;
			try {
				defaults = fresh.toJSON();
			} catch {
				continue; // toJSON needs a live parent/box — not this test's business
			}

			const partial = cls.fromJSON(null, { data: [] });
			let got;
			try {
				got = partial.toJSON();
			} catch (e) {
				throw new Error(`${key}: toJSON threw after a partial inner — ${e.message}`);
			}

			for (const [field, value] of Object.entries(defaults)) {
				if (value === undefined) continue; // never had a default to lose
				expect(
					got[field],
					`${key}.${field}: the class defaults it, but fromJSON({data:[]}) left it undefined`
				).toBeDefined();
			}
		}
	});
});

// Every plot keeps a series colour in a DIFFERENT place: line/points plots in their `line`/
// `points` slots, the actogram in a top-level `colour`, the boxplot in its own `boxPlot` slot.
// So the normalizer emits all of them (the union) and each type reads the one it knows. These
// pin that contract from the plot side: the colour must reach the plots that read it, and must
// not disturb the plots that don't.
describe('a normalizer-emitted series colour reaches the plots that read it', () => {
	// Exactly the shape the normalizer's seriesStyle() produces for `colour: 'pink'`.
	const emitted = (colour) => ({
		x: { refId: 1 },
		y: { refId: 2 },
		colour,
		line: { colour, draw: false, strokeWidth: 2, stroke: 'solid' },
		points: { colour, draw: true, radius: 3, shape: 'circle' },
		boxPlot: { colour, fillColour: colour }
	});

	it('the actogram honours the top-level colour (its reported bug)', async () => {
		const acto = (await loadPlots()).get('actogram').data.fromJSON(null, { data: [emitted('pink')] });
		expect(acto.data[0].colour).toBe('pink');
	});

	it('the boxplot honours the boxPlot-slot colour', async () => {
		const box = (await loadPlots()).get('boxplot').data.fromJSON(null, { data: [emitted('pink')] });
		expect(box.data[0].boxPlot.colour).toBe('pink');
		expect(box.data[0].boxPlot.fillColour).toBe('pink');
	});

	it('a boxplot series with NO boxPlot slot survives instead of dropping the whole plot', async () => {
		// The original bug: BoxPlotDataClass.fromJSON eagerly called BoxClass.fromJSON(undefined),
		// which read `undefined.colour` and threw, so importJson dropped the plot silently. Now the
		// raw slot goes through the constructor, which defaults it.
		const boxCls = (await loadPlots()).get('boxplot').data;
		const bare = { x: { refId: 1 }, y: { refId: 2 } };
		let box;
		expect(() => {
			box = boxCls.fromJSON(null, { data: [bare] });
		}, 'a boxplot with no boxPlot slot must not throw').not.toThrow();
		expect(box.data[0].boxPlot, 'a box style is present, defaulted').toBeTruthy();
		expect(box.data[0].boxPlot.colour, 'colour defaulted from the palette').toEqual(expect.any(String));
	});

	it('a line/points plot ignores the extra slots and keeps reading its own', async () => {
		const s = Scatterplotclass.fromJSON(null, {
			data: [{ ...emitted('pink'), line: { colour: '#234154' }, points: { colour: '#BE796B' } }]
		});
		expect(s.data[0].line.colour).toBe('#234154');
		expect(s.data[0].points.colour).toBe('#BE796B');
	});
});
