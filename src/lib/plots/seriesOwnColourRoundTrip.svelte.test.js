// @ts-nocheck
// A series' own colour (Actogram, CircularPhase, QQPlot `colour`; Histogram `fillColour`;
// Mean +/- SEM `errorColour`) through the REAL save and load path: outputCoreAsJson, then the
// app's loader (importJson, Setting.svelte), which runs releaseLegacyAutoColours.
//
// Since v82.68 these fields save null while automatic (plots/autoSeriesColour.js), and a
// session saved before then has the palette entry of each series' place released on load
// (plots/legacyAutoColours.js). This pins the other half: a pick made in the current version
// survives save and load, INCLUDING a pick that happens to equal the series' own palette slot
// (the one value the legacy rule would release in an older file), and an untouched series
// stays automatic. Found while auditing the v82.68 demo regeneration (2026-11-21).
import { describe, it, expect } from 'vitest';
import { getPaletteColor } from '$lib/components/inputs/ColourPicker.svelte';
import { importJson } from '$lib/components/iconActions/Setting.svelte';

const { AncirSession, ensureRegistry } = await import('../../../mcp/src/engine/session.js');
const { core, appConsts, outputCoreAsJson } = await import('$lib/core/core.svelte.js');
await ensureRegistry();

const OWN_COLOUR = {
	actogram: 'colour',
	circularphase: 'colour',
	qqplot: 'colour',
	histogram: 'fillColour',
	meansem: 'errorColour'
};

/** A plot of three series (columns a, b, c) via the engine's add_plot; returns its id. */
function threeSeries(type) {
	const s = new AncirSession(`own-colour-${type}`);
	const t = Array.from({ length: 48 }, (_, i) => i);
	s.importColumns([
		{ name: 't', values: t },
		...['a', 'b', 'c'].map((n, k) => ({
			name: n,
			values: t.map((h) => 10 + (k + 1) * Math.cos((2 * Math.PI * h) / 24) + k)
		}))
	]);
	const fields = appConsts.plotMap.get(type).defaultInputs ?? [];
	const inputs =
		fields.length === 1
			? { [fields[0]]: ['a', 'b', 'c'] }
			: { [fields[0]]: 't', [fields[1]]: ['a', 'b', 'c'] };
	return s.addPlot(type, inputs).plotId;
}

function savedSession() {
	const out = outputCoreAsJson();
	return JSON.parse(typeof out === 'string' ? out : JSON.stringify(out));
}

describe('series own colour: picks survive a real save and load', () => {
	for (const [type, field] of Object.entries(OWN_COLOUR)) {
		it(`${type}.${field}`, async () => {
			const id = threeSeries(type);
			const series = core.plots.find((p) => p.id === id).plot.data;
			expect(series.length).toBe(3);
			series[0][field] = '#ff0000'; // an arbitrary pick
			series[1][field] = getPaletteColor(1); // a pick equal to its own automatic slot
			// series[2] untouched: automatic

			const json = savedSession();
			const saved = json.plots.find((p) => p.id === id).plot.data.map((d) => d[field]);
			expect(saved).toEqual(['#ff0000', getPaletteColor(1), null]);

			await importJson(json);
			const loaded = core.plots.find((p) => p.id === id).plot.data;
			expect(loaded.map((d) => d.toJSON()[field])).toEqual(['#ff0000', getPaletteColor(1), null]);
			// And each draws: the two picks, and series 3 its own palette slot.
			expect(loaded.map((d) => d[field])).toEqual([
				'#ff0000',
				getPaletteColor(1),
				getPaletteColor(2)
			]);
		});
	}
});
