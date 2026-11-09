// @ts-nocheck
// Automatic colours, for EVERY plot type: a new, untouched series saves every colour it did not
// get from a person as null (automatic), never a copied palette value; and series k draws in
// palette slot k, so three series are three colours.
//
// Generalises 2026-11-09 bug 12 (Mean +/- SEM error bars all took palette slot 0, and that
// derived colour was saved as a user's choice; MeanSEM/errorColour.test.js pins that field).
import { describe, it, expect } from 'vitest';
import { getPaletteColor } from '$lib/components/inputs/ColourPicker.svelte';
import { STYLE_SLOTS } from './legacyAutoColours.js';

const { AncirSession, ensureRegistry } = await import('../../../mcp/src/engine/session.js');
const { core, appConsts } = await import('$lib/core/core.svelte.js');
await ensureRegistry();

const PLOTS = [...appConsts.plotMap.keys()].filter((t) => t !== 'tableplot').sort();
const COLOUR_KEY = /colou?r$/i;
// A saved colour that is a palette entry is a copied automatic colour; a fixed default that is
// not one (a box's black median line) is the plot's own constant, not the bug this guards.
const PALETTE = new Set(Array.from({ length: 24 }, (_, i) => getPaletteColor(i)?.toLowerCase()));

// Actogram, CircularPhase and QQPlot (`colour`) and Histogram (`fillColour`) used to COPY
// getPaletteColor(parent.data.length) into a plain field, so it saved as if it were a pick and
// the appearance map never engaged for them (found by this guard 2026-11-09). They now follow
// the LineClass / PointsClass rule (plots/autoSeriesColour.js) and are guarded like the rest.
const OWN_COLOUR = ['colour', 'fillColour'];

/** Every saved colour field of a series' JSON: [path, value]. */
function colourFields(json, path = '') {
	const out = [];
	for (const [k, v] of Object.entries(json ?? {})) {
		const p = path ? `${path}.${k}` : k;
		if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...colourFields(v, p));
		else if (COLOUR_KEY.test(k) && typeof v !== 'boolean') out.push([p, v]);
	}
	return out;
}

/** A plot of three series (each its own column; one for a one-series plot), via add_plot. */
function threeSeries(type) {
	const s = new AncirSession(`colours-${type}`);
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
	let r;
	try {
		r = s.addPlot(type, inputs);
	} catch (e) {
		if (!/draws one series/.test(e.message)) throw e;
		r = s.addPlot(type, { ...inputs, [fields.at(-1)]: 'a' });
	}
	return core.plots.find((p) => p.id === r.plotId);
}

describe('auto colours of new series', () => {
	it('covers the plot types', () => expect(PLOTS.length).toBeGreaterThanOrEqual(12));

	for (const type of PLOTS) {
		it(`${type}: saves automatic colours as null; series k draws in slot k`, () => {
			const plot = threeSeries(type);
			const series = plot.plot.data;
			expect(series.length, `${type} series`).toBeGreaterThanOrEqual(1);
			for (const [k, s] of series.entries()) {
				const saved = colourFields(s.toJSON?.() ?? {}).filter(
					([, v]) => typeof v === 'string' && PALETTE.has(v.toLowerCase())
				);
				expect(saved, `${type} series ${k}: colours saved as picks`).toEqual([]);
				// Every style slot the series has draws its own palette slot.
				for (const slot of STYLE_SLOTS) {
					const style = s[slot];
					if (!style || typeof style !== 'object' || !('colour' in style)) continue;
					expect(style.colour, `${type} series ${k} ${slot}`).toBe(getPaletteColor(k));
				}
				if ('errorColour' in s) {
					expect(s.errorColour, `${type} series ${k} error bars`).toBe(getPaletteColor(k));
				}
				// A series' own colour (not in a style slot) draws its slot too.
				for (const field of OWN_COLOUR) {
					if (typeof s[field] !== 'string') continue;
					expect(s[field], `${type} series ${k} ${field}`).toBe(getPaletteColor(k));
				}
			}
		});
	}
});
