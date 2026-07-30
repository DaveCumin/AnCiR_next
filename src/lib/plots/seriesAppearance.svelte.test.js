// Print-safe appearance: pinned marker shapes, dashes and monochrome.
//
// Colour alone carries all series identity today, so a greyscale print collapses
// every series into the same grey. Shape and dash are the redundant channels that
// survive it. Both stay uniform until varyMarkers is on, so nothing existing changes
// appearance until asked.
import { describe, it, expect, beforeEach } from 'vitest';
import { core, appState } from '$lib/core/core.svelte';
import { colourForSeries } from './seriesColour.js';
import {
	DASH_ORDER,
	shapeForColumn,
	dashForColumn,
	greyForIndex,
	releaseSeriesAppearance,
	applyFigureAppearance,
	applyAppearanceToAll
} from './seriesAppearance.js';
import { POINT_SHAPES } from '$lib/components/plotbits/pointShapes.js';
import { newFigureStyle } from './figureStyle.js';

const PAL = ['#aa0000', '#00aa00', '#0000aa', '#aaaa00'];

beforeEach(() => {
	appState.appColours = [...PAL];
	core.seriesColours = {};
	core.seriesShapes = {};
	core.seriesDashes = {};
	core.plots = [];
});

/** A plot shaped the way the real ones are: wrapper with .style and .plot.data. */
function mkPlot(colIds, style = {}) {
	return {
		style: newFigureStyle(style),
		plot: {
			data: colIds.map((id) => ({
				y: { refId: id },
				points: { colour: '#000000', shape: 'circle' },
				line: { colour: '#000000', stroke: '' }
			}))
		}
	};
}

describe('pinned shapes and dashes', () => {
	it('claims a shape and recalls the same one', () => {
		const first = shapeForColumn(7, 0);
		expect(POINT_SHAPES).toContain(first);
		expect(shapeForColumn(7, 3)).toBe(first);
	});

	it('gives different columns different shapes', () => {
		expect(shapeForColumn(1, 0)).not.toBe(shapeForColumn(2, 0));
	});

	it('solid is the FIRST dash, so series one looks unchanged', () => {
		// Deliberate: turning on varying markers must not restyle the first series.
		expect(DASH_ORDER[0]).toBe('');
		expect(dashForColumn(1, 0)).toBe('');
	});

	it('terminates when every shape is taken', () => {
		for (let i = 0; i < POINT_SHAPES.length + 2; i++) {
			expect(shapeForColumn(i, 0)).toBeTruthy();
		}
	});

	it('release unpins both', () => {
		shapeForColumn(7, 0);
		dashForColumn(7, 0);
		releaseSeriesAppearance(7);
		expect(core.seriesShapes['7']).toBeUndefined();
		expect(core.seriesDashes['7']).toBeUndefined();
	});
});

describe('greyForIndex', () => {
	it('spreads greys between a dark and a mid tone', () => {
		const greys = [0, 1, 2, 3].map((i) => greyForIndex(i, 4));
		expect(new Set(greys).size).toBe(4);
		for (const g of greys) expect(g).toMatch(/^#([0-9a-f]{2})\1\1$/);
	});

	it('avoids pure black and pure white', () => {
		// Black is indistinguishable from axis ink; white is invisible on white paper.
		const greys = [0, 1, 2, 3, 4].map((i) => greyForIndex(i, 5));
		expect(greys).not.toContain('#000000');
		expect(greys).not.toContain('#ffffff');
	});

	it('handles a single series without dividing by zero', () => {
		expect(greyForIndex(0, 1)).toMatch(/^#[0-9a-f]{6}$/);
		expect(greyForIndex(0, 0)).toMatch(/^#[0-9a-f]{6}$/);
	});
});

describe('applyFigureAppearance', () => {
	it('does nothing while both flags are off', () => {
		const plot = mkPlot([1, 2]);
		colourForSeries(null, 1, 0);
		colourForSeries(null, 2, 1);
		applyFigureAppearance(plot);
		expect(plot.plot.data[0].points.shape).toBe('circle');
		expect(plot.plot.data[0].line.stroke).toBe('');
	});

	it('varies shape and dash when varyMarkers is on', () => {
		const plot = mkPlot([1, 2], { varyMarkers: true });
		applyFigureAppearance(plot);
		const shapes = plot.plot.data.map((d) => d.points.shape);
		expect(new Set(shapes).size).toBe(2);
	});

	it('greys the series when monochrome is on', () => {
		const plot = mkPlot([1, 2], { monochrome: true });
		applyFigureAppearance(plot);
		for (const d of plot.plot.data) {
			expect(d.points.colour).toMatch(/^#([0-9a-f]{2})\1\1$/);
		}
		expect(plot.plot.data[0].points.colour).not.toBe(plot.plot.data[1].points.colour);
	});

	it('is REVERSIBLE: turning the flags off restores palette colour and defaults', () => {
		// The toggles have to be toggles. A one-way transformation would strand a figure
		// in greyscale with no way back.
		const plot = mkPlot([1, 2], { monochrome: true, varyMarkers: true });
		const pinned = colourForSeries(null, 1, 0);
		applyFigureAppearance(plot);
		expect(plot.plot.data[0].points.colour).not.toBe(pinned);

		plot.style.monochrome = false;
		plot.style.varyMarkers = false;
		applyFigureAppearance(plot);
		expect(plot.plot.data[0].points.colour).toBe(pinned);
		expect(plot.plot.data[0].points.shape).toBe('circle');
		expect(plot.plot.data[0].line.stroke).toBe('');
	});

	it('shapes are STICKY across a toggle, not reshuffled', () => {
		// Without sticky pins the toggle would be non-deterministic and a figure could
		// change on reload.
		const plot = mkPlot([1, 2], { varyMarkers: true });
		applyFigureAppearance(plot);
		const before = plot.plot.data.map((d) => d.points.shape);
		plot.style.varyMarkers = false;
		applyFigureAppearance(plot);
		plot.style.varyMarkers = true;
		applyFigureAppearance(plot);
		expect(plot.plot.data.map((d) => d.points.shape)).toEqual(before);
	});

	it('is idempotent', () => {
		const plot = mkPlot([1, 2], { monochrome: true, varyMarkers: true });
		applyFigureAppearance(plot);
		expect(applyFigureAppearance(plot)).toBe(0);
	});

	it('leaves other figures alone (monochrome is per figure)', () => {
		const a = mkPlot([1], { monochrome: true });
		const b = mkPlot([1]);
		colourForSeries(null, 1, 0);
		applyFigureAppearance(a);
		applyFigureAppearance(b);
		expect(a.plot.data[0].points.colour).not.toBe(b.plot.data[0].points.colour);
	});

	it('tolerates junk without throwing mid-render', () => {
		expect(applyFigureAppearance(null)).toBe(0);
		expect(applyFigureAppearance({})).toBe(0);
		expect(applyFigureAppearance({ style: newFigureStyle(), plot: {} })).toBe(0);
		expect(applyAppearanceToAll(null)).toBe(0);
	});
});

// REAL PLOT SHAPES. The original fixture used points/line only — the scatterplot's
// shape — so it could not catch that monochrome did nothing on a boxplot (style lives
// in `boxPlot`, not `box`) or an actogram (colour sits directly on the datum). Both
// were reported as broken while this file was green. These fixtures mirror what the
// plot classes actually build.
describe('every plot shape in the app', () => {
	it('greys a BOXPLOT series (style in `boxPlot`)', () => {
		const plot = {
			style: newFigureStyle({ monochrome: true }),
			plot: {
				data: [
					{ y: { refId: 1 }, boxPlot: { colour: '#ff0000', fillColour: '#ff0000' } },
					{ y: { refId: 2 }, boxPlot: { colour: '#00ff00', fillColour: '#00ff00' } }
				]
			}
		};
		expect(applyFigureAppearance(plot)).toBeGreaterThan(0);
		for (const d of plot.plot.data) {
			expect(d.boxPlot.colour).toMatch(/^#([0-9a-f]{2})\1\1$/);
			expect(d.boxPlot.fillColour).toBe(d.boxPlot.colour);
		}
	});

	it('greys an ACTOGRAM series (colour directly on the datum)', () => {
		const plot = {
			style: newFigureStyle({ monochrome: true }),
			plot: { data: [{ y: { refId: 1 }, colour: '#ff0000' }, { y: { refId: 2 }, colour: '#00ff00' }] }
		};
		expect(applyFigureAppearance(plot)).toBeGreaterThan(0);
		for (const d of plot.plot.data) expect(d.colour).toMatch(/^#([0-9a-f]{2})\1\1$/);
	});

	it('greys a SCATTERPLOT series (points + line), the shape that always worked', () => {
		const plot = mkPlot([1, 2], { monochrome: true });
		applyFigureAppearance(plot);
		expect(plot.plot.data[0].points.colour).toMatch(/^#([0-9a-f]{2})\1\1$/);
		expect(plot.plot.data[0].line.colour).toMatch(/^#([0-9a-f]{2})\1\1$/);
	});

	it('does not mistake a column reference for a style object', () => {
		// x/y are Column refs sitting on the same datum. Detection is by the presence of
		// a `colour` field, so they must be left alone.
		const plot = {
			style: newFigureStyle({ monochrome: true }),
			plot: { data: [{ x: { refId: 0 }, y: { refId: 1 }, points: { colour: '#ff0000' } }] }
		};
		applyFigureAppearance(plot);
		expect(plot.plot.data[0].y).toEqual({ refId: 1 });
		expect(plot.plot.data[0].x).toEqual({ refId: 0 });
	});
});

// COLORMAP PLOTS. CWT, CorrelationHeatmap, PairsPlot and Actogram-in-heatmap-mode draw
// through a colormap and have no per-series `colour`, so the appearance loop never
// touched them — reported as "the wavelet plot is the only one that doesn't change".
describe('colormap plots', () => {
	beforeEach(() => {
		core.plotColormaps = {};
	});

	const mkHeatmap = (colormap = 'viridis', style = {}) => ({
		id: 3,
		style: newFigureStyle(style),
		plot: { colormap }
	});

	it('monochrome switches the map to greys', () => {
		const plot = mkHeatmap('viridis', { monochrome: true });
		expect(applyFigureAppearance(plot)).toBeGreaterThan(0);
		expect(plot.plot.colormap).toBe('greys');
	});

	it('turning it off restores the user’s own map, not a default', () => {
		const plot = mkHeatmap('magma', { monochrome: true });
		applyFigureAppearance(plot);
		expect(plot.plot.colormap).toBe('greys');
		plot.style.monochrome = false;
		applyFigureAppearance(plot);
		expect(plot.plot.colormap).toBe('magma');
	});

	it('leaves a hand-picked greys alone when monochrome goes off', () => {
		// Nothing was remembered because monochrome never changed it, so the user's
		// choice must survive rather than being replaced by a default.
		const plot = mkHeatmap('greys');
		applyFigureAppearance(plot);
		expect(plot.plot.colormap).toBe('greys');
	});

	it('is idempotent', () => {
		const plot = mkHeatmap('viridis', { monochrome: true });
		applyFigureAppearance(plot);
		expect(applyFigureAppearance(plot)).toBe(0);
	});

	it('works on a colormap plot with no series data at all', () => {
		// CWT has no `data` array in the series sense; the old code bailed out before
		// doing anything for exactly that reason.
		const plot = { id: 9, style: newFigureStyle({ monochrome: true }), plot: { colormap: 'viridis' } };
		expect(applyFigureAppearance(plot)).toBeGreaterThan(0);
		expect(plot.plot.colormap).toBe('greys');
	});

	it('ignores a plot with no colormap', () => {
		const plot = mkPlot([1], { monochrome: true });
		plot.id = 4;
		applyFigureAppearance(plot);
		expect(core.plotColormaps['4']).toBeUndefined();
	});
});
