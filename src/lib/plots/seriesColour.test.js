// The same column must draw the same colour in every plot, and a colour the user
// chose must never be overwritten by that rule.
//
// A golden-value guard cannot cover this — colour is not in the demo metric
// snapshot — so the precedence rules are pinned directly.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/components/inputs/ColourPicker.svelte', () => ({
	// A small deterministic palette, so "next entry" is checkable.
	getPaletteColor: (n) => ['#aa0000', '#00bb00', '#0000cc', '#dddd00'][n % 4]
}));

const { core } = await import('$lib/core/core.svelte');
const { colourForSeries, seriesColumnId, releaseSeriesColour } = await import('./seriesColour.js');

beforeEach(() => {
	core.seriesColours = {};
});

describe('a column keeps its colour across plots', () => {
	it('the second plot to draw a column adopts the first plot’s colour', () => {
		// Different positional indices: this is the whole bug. Column 7 is the first
		// series in one plot and the third in another.
		const first = colourForSeries(undefined, 7, 0);
		const second = colourForSeries(undefined, 7, 2);
		expect(second).toBe(first);
	});

	it('different columns get different colours', () => {
		const a = colourForSeries(undefined, 7, 0);
		const b = colourForSeries(undefined, 8, 0);
		expect(b).not.toBe(a);
	});

	it('a column claimed at the same index as another does not collide', () => {
		// Two columns wired as "the first series" of two different plots would both
		// ask for palette[0]. Pinned assignment has to hand out the next free one.
		expect(colourForSeries(undefined, 1, 0)).not.toBe(colourForSeries(undefined, 2, 0));
	});

	it('adding a series does not re-colour the existing ones', () => {
		// Positional assignment shifts every colour below an insertion; pinned does not.
		const a = colourForSeries(undefined, 10, 0);
		colourForSeries(undefined, 11, 1);
		expect(colourForSeries(undefined, 10, 5)).toBe(a);
	});
});

describe('an explicit colour always wins', () => {
	it('a saved or user-chosen colour is returned untouched', () => {
		expect(colourForSeries('#123456', 7, 0)).toBe('#123456');
	});

	it('and is not recorded as the column’s colour', () => {
		// An override is for THAT series, not a claim on the column for every plot.
		colourForSeries('#123456', 7, 0);
		expect(core.seriesColours[7]).toBeUndefined();
	});

	it('survives a later auto-resolve of the same column', () => {
		const auto = colourForSeries(undefined, 7, 0);
		expect(colourForSeries('#123456', 7, 0)).toBe('#123456');
		expect(colourForSeries(undefined, 7, 0)).toBe(auto);
	});
});

describe('an unwired series', () => {
	it('falls back to the positional palette and claims nothing', () => {
		// A series created before its column is chosen must not pin a colour to
		// "no column" and hand it to every other unwired series.
		expect(colourForSeries(undefined, null, 1)).toBe('#00bb00');
		expect(core.seriesColours).toEqual({});
	});
});

describe('seriesColumnId', () => {
	it('reads the y ref for the per-series shape', () => {
		expect(seriesColumnId({ y: { refId: 4 } })).toBe(4);
	});

	it('reads the single-column shape used by Histogram and CircularPhase', () => {
		expect(seriesColumnId({ column: { refId: 9 } })).toBe(9);
	});

	it('treats an unwired ref as no column, not as column -1', () => {
		expect(seriesColumnId({ y: { refId: -1 } })).toBeNull();
		expect(seriesColumnId(undefined)).toBeNull();
	});
});

describe('releasing a colour', () => {
	it('lets the id be reused without inheriting the old colour', () => {
		// Column ids are reused across sessions and after deletion.
		const a = colourForSeries(undefined, 7, 0);
		releaseSeriesColour(7);
		expect(core.seriesColours[7]).toBeUndefined();
		const b = colourForSeries(undefined, 7, 1);
		expect(b).not.toBe(a);
	});
});
