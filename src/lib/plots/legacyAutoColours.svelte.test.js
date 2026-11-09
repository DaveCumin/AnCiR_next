// @ts-nocheck
// The rule that releases automatic series colours an older session saved (plots/
// legacyAutoColours.js), and the style objects that no longer guess it themselves.
//
// REPORTED: a session whose series 2 was saved in palette entry 1 (its automatic colour, by its
// place) kept that colour as a user override on load, so it never followed the palette or its
// column again. The constructors compared every saved colour against
// getPaletteColor(parentPlot.data.length), and while a plot's fromJSON builds its series list
// that length is 0: every series was compared against entry 0. The same comparison released a
// REAL pick of entry 0 on any series.
//
// These load REAL sessions through the app's own loader (importJson, Setting.svelte), which is
// where the session's version is known.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';
import { getPaletteColor } from '$lib/components/inputs/ColourPicker.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { BoxClass } from '$lib/components/plotbits/Box.svelte';
import { PointsClass } from '$lib/components/plotbits/Points.svelte';
import { LineClass } from '$lib/components/plotbits/Line.svelte';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';
import {
	NULL_AUTO_ERROR_COLOUR_VERSION,
	releaseLegacyAutoColours,
	savedBefore,
	versionParts,
	NULL_AUTO_STROKE_VERSION,
	NULL_AUTO_FILL_VERSION
} from './legacyAutoColours.js';

const DEMO = join(process.cwd(), 'static/sessions/demos/demo-workflow-join-data.json');
const PLOT = 68;

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
});

/**
 * The join demo with its boxplot given two series, saved by `version` with these box colours.
 * @param {string} version
 * @param {Array<{colour?: any, fillColour?: any}>} boxes one per series
 */
function session(version, boxes) {
	const s = JSON.parse(readFileSync(DEMO, 'utf8'));
	s.version = version;
	const plot = s.plots.find((p) => p.id === PLOT);
	const d = plot.plot.data[0];
	plot.plot.data = boxes.map((box, i) => ({
		...structuredClone(d),
		y: { ...d.y, id: 9100 + i, refId: i === 0 ? d.y.refId : 490 },
		boxPlot: { ...d.boxPlot, ...box }
	}));
	return s;
}

async function loadBoxes(json) {
	await importJson(json);
	const plot = core.plots.find((p) => p.id === PLOT);
	return plot.plot.data.map((d) => d.boxPlot.toJSON());
}

describe('reproduction: a pre-v72.4 session whose series 2 was saved in palette entry 1', () => {
	it('series 2 follows the palette again (was kept as an override)', async () => {
		const P0 = getPaletteColor(0);
		const P1 = getPaletteColor(1);
		const boxes = await loadBoxes(
			session('β.70.2', [
				{ colour: P0, fillColour: P0 },
				{ colour: P1, fillColour: P0 } // the old bug froze every fill at entry 0
			])
		);
		expect(boxes[0].colour).toBe(null);
		expect(boxes[1].colour).toBe(null);
		// Both fills were only automatic: they follow their strokes.
		expect(boxes[0].fillColour).toBe(null);
		expect(boxes[1].fillColour).toBe(null);
	});

	it('a colour that is NOT its own slot is a pick and is kept, even when it is another slot', async () => {
		const P0 = getPaletteColor(0);
		const P2 = getPaletteColor(2);
		const boxes = await loadBoxes(
			session('β.70.2', [
				{ colour: P2, fillColour: '#123456' },
				{ colour: P0, fillColour: P0 }
			])
		);
		expect(boxes[0].colour).toBe(P2);
		expect(boxes[0].fillColour).toBe('#123456');
		// Series 2 in entry 0 was not its automatic colour (entry 1), so it is a pick. Its fill
		// equal to entry 0 is the old frozen-fill bug: released, and it follows the stroke.
		expect(boxes[1].colour).toBe(P0);
		expect(boxes[1].fillColour).toBe(null);
	});
});

describe('a session saved since v72.4: every saved stroke is a pick', () => {
	it('keeps picks that equal a palette slot, including the series own slot and entry 0', async () => {
		const P0 = getPaletteColor(0);
		const P1 = getPaletteColor(1);
		const boxes = await loadBoxes(
			session('β.82.35', [
				{ colour: P0, fillColour: '#abcdef' },
				{ colour: P1, fillColour: null }
			])
		);
		// Entry 0 on series 1 was RELEASED by the old constructor rule (a lost pick).
		expect(boxes[0].colour).toBe(P0);
		expect(boxes[0].fillColour).toBe('#abcdef');
		expect(boxes[1].colour).toBe(P1);
		expect(boxes[1].fillColour).toBe(null);
	});

	it('an automatic stroke (saved null) stays automatic', async () => {
		const boxes = await loadBoxes(session('β.82.35', [{ colour: null }, { colour: null }]));
		expect(boxes.map((b) => b.colour)).toEqual([null, null]);
	});
});

describe('releaseLegacyAutoColours', () => {
	const P = (i) => getPaletteColor(i);
	const plot = (data) => ({ id: 1, type: 'scatterplot', plot: { data } });

	it('reads versions', () => {
		expect(versionParts('β.82.48')).toEqual([82, 48]);
		expect(versionParts('v72.4')).toEqual([72, 4]);
		expect(versionParts('81')).toEqual([81, 0]);
		expect(versionParts(undefined)).toBe(null);
		expect(savedBefore('β.72.3', NULL_AUTO_STROKE_VERSION)).toBe(true);
		expect(savedBefore('β.72.4', NULL_AUTO_STROKE_VERSION)).toBe(false);
		expect(savedBefore('β.82.48', NULL_AUTO_FILL_VERSION)).toBe(true);
		expect(savedBefore('β.82.49', NULL_AUTO_FILL_VERSION)).toBe(false);
		expect(savedBefore('β.83.0', NULL_AUTO_FILL_VERSION)).toBe(false);
		expect(savedBefore(undefined, NULL_AUTO_STROKE_VERSION)).toBe(true);
	});

	it('releases every line and points slot that is its series own automatic colour', () => {
		const json = {
			version: 'β.71.0',
			plots: [
				plot([
					{ line: { colour: P(0) }, points: { colour: P(0) } },
					{ line: { colour: P(1) }, points: { colour: P(3) }, thresholdline: { colour: P(1) } }
				])
			]
		};
		const { json: out, released } = releaseLegacyAutoColours(json);
		const [a, b] = out.plots[0].plot.data;
		expect([a.line.colour, a.points.colour]).toEqual([null, null]);
		expect([b.line.colour, b.points.colour, b.thresholdline.colour]).toEqual([null, P(3), null]);
		expect(released).toBe(4);
		// Pure: the input is untouched.
		expect(json.plots[0].plot.data[1].line.colour).toBe(P(1));
	});

	it('releases a pre-v82.49 fill equal to the colour its column has in the appearance map', () => {
		const json = {
			version: 'β.80.0',
			seriesAppearance: { 77: { colour: { slot: 5 } } },
			plots: [
				{
					id: 2,
					type: 'boxplot',
					plot: {
						data: [
							{ y: { refId: 77 }, boxPlot: { colour: null, fillColour: P(5) } },
							{ y: { refId: 78 }, boxPlot: { colour: '#222222', fillColour: '#222222' } },
							{ y: { refId: 79 }, boxPlot: { colour: null, fillColour: P(6) } }
						]
					}
				}
			]
		};
		const [a, b, c] = releaseLegacyAutoColours(json).json.plots[0].plot.data;
		expect(a.boxPlot.fillColour).toBe(null);
		expect(b.boxPlot.fillColour).toBe(null); // followed its (picked) stroke
		expect(b.boxPlot.colour).toBe('#222222'); // v80 > v72.4: the stroke is a pick
		expect(c.boxPlot.fillColour).toBe(P(6)); // not what it would have followed: a pick
	});

	it('changes nothing in a session saved by the version that saves null fills', () => {
		const json = {
			version: 'β.82.49',
			plots: [plot([{ boxPlot: { colour: P(0), fillColour: P(0) } }])]
		};
		const res = releaseLegacyAutoColours(json);
		expect(res.released).toBe(0);
		expect(res.json).toBe(json);
	});
});

describe('the style objects keep what they were given', () => {
	it('a saved string is kept and a null stays automatic, for line, points and box', () => {
		for (const Cls of [LineClass, PointsClass, BoxClass]) {
			expect(new Cls({ colour: getPaletteColor(0) }).toJSON().colour).toBe(getPaletteColor(0));
			expect(new Cls({ colour: null }).toJSON().colour).toBe(null);
		}
	});

	it('an automatic colour stays automatic through a plot built by its fromJSON (scatterplot)', () => {
		// Scatterplot's fromJSON builds LineClass/PointsClass first and passes the instances to
		// the constructor: reading their RESOLVED colour would pin an automatic one.
		const p = Plot.fromJSON({
			id: 501,
			type: 'scatterplot',
			name: 's',
			x: 0,
			y: 0,
			width: 300,
			height: 200,
			plot: {
				data: [
					{
						x: { refId: -1 },
						y: { refId: -1 },
						line: { colour: null, draw: true },
						points: { colour: '#0a0b0c' }
					}
				]
			}
		});
		const d = p.plot.data[0];
		expect(d.line.toJSON().colour).toBe(null);
		expect(d.points.toJSON().colour).toBe('#0a0b0c');
	});

	it('a box fill saves null while it follows the stroke, and a pick when chosen', () => {
		const box = new BoxClass({ colour: '#111111' });
		expect(box.fillColour).toBe('#111111');
		expect(box.toJSON().fillColour).toBe(null);
		box.fillColour = '#333333';
		expect(box.toJSON().fillColour).toBe('#333333');
		// BoxClass.fromJSON then the constructor (an instance passed in) keeps both explicit.
		const again = new BoxClass(BoxClass.fromJSON({ colour: null, fillColour: null }));
		expect(again.toJSON()).toMatchObject({ colour: null, fillColour: null });
	});
});

describe('releaseLegacyAutoColours: Mean +/- SEM error bars', () => {
	const P = (i) => getPaletteColor(i);
	const meansem = (data) => ({ id: 1, type: 'meansem', plot: { data } });

	it('releases the colour the old constructor copied (palette 0, or the points’ own)', () => {
		const json = {
			version: 'β.82.67',
			plots: [
				meansem([
					{ y: { refId: 1 }, errorColour: P(0), points: { colour: null } },
					{ y: { refId: 2 }, errorColour: P(0), points: { colour: null } },
					{ y: { refId: 3 }, errorColour: '#123456', points: { colour: '#123456' } }
				])
			]
		};
		const { json: out, released } = releaseLegacyAutoColours(json);
		expect(released).toBe(3);
		expect(out.plots[0].plot.data.map((s) => s.errorColour)).toEqual([null, null, null]);
	});

	it('keeps a real pick, and anything saved from the fixed version on', () => {
		const pick = { y: { refId: 1 }, errorColour: '#ff0000', points: { colour: null } };
		expect(
			releaseLegacyAutoColours({ version: 'β.82.67', plots: [meansem([pick])] }).released
		).toBe(0);
		const auto = { y: { refId: 1 }, errorColour: P(0), points: { colour: null } };
		expect(
			releaseLegacyAutoColours({ version: 'β.82.68', plots: [meansem([auto])] }).released
		).toBe(0);
	});
});

describe('Mean +/- SEM error-bar release is bounded by the fixing version (β.82.68)', () => {
	const P = (i) => getPaletteColor(i);
	// A deliberate pick that equals palette[0], on the SECOND series (i = 1): exactly what the old
	// copy-at-construction wrote, so only the version can tell them apart.
	const session = (version) => ({
		version,
		plots: [
			{
				id: 1,
				type: 'meansem',
				plot: {
					data: [
						{ y: { refId: 1 }, errorColour: null, points: { colour: null } },
						{ y: { refId: 2 }, errorColour: P(0), points: { colour: null } }
					]
				}
			}
		]
	});

	it('pins the threshold the fix shipped in', () => {
		expect(NULL_AUTO_ERROR_COLOUR_VERSION).toEqual([82, 68]);
	});

	it.each(['β.82.68', 'β.82.69', 'β.82.100', 'β.83.0', 'v90.1'])(
		'a session saved by %s keeps the pick',
		(version) => {
			const { json, released } = releaseLegacyAutoColours(session(version));
			expect(released).toBe(0);
			expect(json.plots[0].plot.data[1].errorColour).toBe(P(0));
		}
	);

	it.each(['β.82.67', 'β.82.6', 'β.81.99', 'v72.4'])(
		'a session saved by %s releases it (the old automatic colour)',
		(version) => {
			const { json, released } = releaseLegacyAutoColours(session(version));
			expect(released).toBe(1);
			expect(json.plots[0].plot.data[1].errorColour).toBeNull();
		}
	);
});

describe('releaseLegacyAutoColours: series colours copied from the palette', () => {
	const P = (i) => getPaletteColor(i);
	const plotOf = (type, data) => ({ id: 1, type, plot: { data } });

	it('releases the palette entry of the series’ place, for each plot that copied it', () => {
		for (const [type, field] of [
			['actogram', 'colour'],
			['circularphase', 'colour'],
			['qqplot', 'colour'],
			['histogram', 'fillColour']
		]) {
			const json = {
				version: 'β.82.67',
				plots: [plotOf(type, [{ [field]: P(0) }, { [field]: P(1) }, { [field]: '#123456' }])]
			};
			const { json: out, released } = releaseLegacyAutoColours(json);
			expect(released, type).toBe(2);
			expect(
				out.plots[0].plot.data.map((s) => s[field]),
				type
			).toEqual([null, null, '#123456']);
		}
	});

	it('keeps a colour that is not its own place’s, and anything saved from 82.68 on', () => {
		const shifted = plotOf('actogram', [{ colour: P(1) }]);
		expect(releaseLegacyAutoColours({ version: 'β.82.67', plots: [shifted] }).released).toBe(0);
		const auto = plotOf('qqplot', [{ colour: P(0) }]);
		expect(releaseLegacyAutoColours({ version: 'β.82.68', plots: [auto] }).released).toBe(0);
	});
});
