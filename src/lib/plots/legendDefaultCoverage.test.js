/**
 * Which plots have a legend, and what each one DEFAULTS it to.
 *
 * WHY THIS GUARD EXISTS
 *
 * Six plots have always drawn a legend and default it on. Five more (Periodogram,
 * FFT, Correlogram, Actogram, PairsPlot) gained one later and must default it OFF,
 * because every saved session already contains those plots and a legend that
 * switched itself on at load would silently change a figure the user had finished.
 *
 * The OFF default is expressed by each of those five calling
 * `LegendClass.withDefaults(json.legend, { show: false })` in its own fromJSON and
 * constructor. `LegendClass`'s own fallback is `?? true`, so the failure mode for
 * the NEXT plot to gain a legend is silence: forget the option and it defaults on,
 * every existing session of that type changes appearance at load, and no test
 * notices — legendWithDefaults.test.js covers the helper in isolation and never
 * asks which plots call it.
 *
 * So this drives the registry instead of a hand-kept list, and a plot that grows a
 * legend must be classified here on purpose. Being unlisted is a FAILURE, not a
 * skip: a guard whose response to something new is to ignore it reports success
 * for exactly the case it was written to catch.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadPlots } from './plotMap.js';

const PLOTS_DIR = path.resolve('src/lib/plots');

/** Plots that have drawn a legend since before the feature was generalised. */
const LEGEND_ON = ['scatterplot', 'boxplot', 'histogram', 'meansem', 'qqplot', 'circularphase'];

/** Plots that gained a legend later, so a legend-less saved session must stay bare. */
const LEGEND_OFF = ['periodogram', 'fft', 'correlogram', 'actogram', 'pairsplot'];

let plotMap;
beforeAll(async () => {
	plotMap = await loadPlots();
});

/** Every registered plot whose persisted inner carries a `legend`. */
function legendPlots() {
	const out = [];
	for (const [key, entry] of plotMap) {
		let json;
		try {
			json = entry.data.fromJSON(null, { data: [] })?.toJSON();
		} catch {
			continue; // needs a live parent to serialise; covered elsewhere
		}
		if (json && 'legend' in json) out.push(key);
	}
	return out;
}

describe('plot legend defaults', () => {
	it('covers the whole registry (guards against the list silently shrinking)', () => {
		expect(plotMap.size).toBeGreaterThanOrEqual(11);
	});

	it('finds a legend on every plot that is supposed to have one', () => {
		// Without this the per-plot assertions below could all pass vacuously by
		// finding no legend at all.
		const found = legendPlots();
		expect([...found].sort()).toEqual([...LEGEND_ON, ...LEGEND_OFF].sort());
	});

	it('classifies every legend-bearing plot exactly once', () => {
		const overlap = LEGEND_ON.filter((k) => LEGEND_OFF.includes(k));
		expect(overlap, 'a plot cannot default both ways').toEqual([]);
		const unclassified = legendPlots().filter(
			(k) => !LEGEND_ON.includes(k) && !LEGEND_OFF.includes(k)
		);
		expect(
			unclassified,
			'a new plot with a legend must be listed above: ON if it never shipped without one, OFF if saved sessions already contain it'
		).toEqual([]);
	});

	for (const key of LEGEND_OFF) {
		it(`${key}: a session saved before the legend existed loads with it OFF`, async () => {
			const cls = (await loadPlots()).get(key).data;
			// The three shapes an old inner can take: no legend key, a bare inner, null.
			expect(cls.fromJSON(null, { data: [] }).legend.show, 'no legend key').toBe(false);
			expect(cls.fromJSON(null, {}).legend.show, 'empty inner').toBe(false);
			expect(cls.fromJSON(null, null).legend.show, 'null inner').toBe(false);
		});

		it(`${key}: an explicitly undefined show still lands OFF, not on the ?? true`, async () => {
			// The hole a `{ show: false, ...json }` spread leaves: the key is present,
			// so the spread reinstates it and `undefined ?? true` turns the legend on
			// for exactly the sessions the OFF default protects.
			const cls = (await loadPlots()).get(key).data;
			const inner = { data: [], legend: { position: 'topleft', show: undefined } };
			expect('show' in inner.legend).toBe(true);
			expect(cls.fromJSON(null, inner).legend.show).toBe(false);
		});
	}

	for (const key of LEGEND_ON) {
		it(`${key}: keeps its long-standing ON default`, async () => {
			const cls = (await loadPlots()).get(key).data;
			expect(cls.fromJSON(null, { data: [] }).legend.show).toBe(true);
		});
	}

	it('every legend-bearing plot round-trips a user choice in BOTH directions', async () => {
		// The default only applies when the session is silent. Once the user has
		// decided, that decision outranks it either way.
		for (const key of legendPlots()) {
			const cls = plotMap.get(key).data;
			for (const show of [true, false]) {
				const inst = cls.fromJSON(null, { data: [] });
				inst.legend.show = show;
				const back = cls.fromJSON(null, JSON.parse(JSON.stringify(inst.toJSON())));
				expect(back.legend.show, `${key} with show=${show}`).toBe(show);
			}
		}
	});

	it('every legend-bearing plot exposes the items its legend lists', async () => {
		// A legend that is wired but fed nothing renders as an empty box. Each plot
		// must offer a `getLegendItems` returning an array (empty is legitimate for
		// a plot with no data yet; undefined is not).
		for (const key of legendPlots()) {
			const inst = plotMap.get(key).data.fromJSON(null, { data: [] });
			expect(Array.isArray(inst.getLegendItems), `${key}.getLegendItems`).toBe(true);
		}
	});
});

/**
 * Where the legend's CONTROL sits, and that there is one at all.
 *
 * The checks above are all about the persisted object. A plot can satisfy every
 * one of them, draw a perfectly good legend, and still be unusable: if the
 * component renders `<Legend which="plot">` and forgets `which="controls"`, the
 * legend defaults OFF (as five of them now do) and there is no switch anywhere in
 * the UI to turn it on. Nothing above would notice.
 *
 * The position matters too. Ten of the eleven put the Legend control first in the
 * Properties tab; the correlogram had it last, below the axis controls, so the one
 * control a user hunts for by name was the one in a different place. Pinned by
 * source order because that IS the rendered order.
 */
describe('the legend control', () => {
	const sources = fs
		.readdirSync(PLOTS_DIR, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => path.join(PLOTS_DIR, e.name, `${e.name}.svelte`))
		.filter((f) => fs.existsSync(f))
		.map((f) => ({ name: path.basename(f, '.svelte'), src: fs.readFileSync(f, 'utf8') }))
		.filter(({ src }) => /<Legend\b[^>]*which="plot"/s.test(src));

	it('finds the plots that draw one (so the assertions below are not vacuous)', () => {
		expect(sources.map((s) => s.name).sort()).toEqual(
			[
				'Actogram',
				'Boxplot',
				'CircularPhase',
				'Correlogram',
				'FFT',
				'Histogram',
				'MeanSEM',
				'PairsPlot',
				'Periodogram',
				'QQPlot',
				'Scatterplot'
			].sort()
		);
	});

	it('every plot that draws a legend also offers the control that switches it on', () => {
		const missing = sources
			.filter(({ src }) => !/<Legend\b[^>]*which="controls"/s.test(src))
			.map((s) => s.name);
		expect(missing, 'drawn but with no way to enable it').toEqual([]);
	});

	it('puts the legend control first in the Properties tab', () => {
		const late = [];
		for (const { name, src } of sources) {
			const legendAt = src.search(/<Legend\b[^>]*which="controls"/s);
			// The first control-mode component of ANY kind in the file. The Properties
			// snippet is first in every plot component, so this is the first control the
			// user sees.
			const firstAt = src.search(/<[A-Z][A-Za-z]*\b[^>]*which="controls"/s);
			if (legendAt !== firstAt) late.push(`${name}: legend control is not the first one`);
		}
		expect(late).toEqual([]);
	});
});
