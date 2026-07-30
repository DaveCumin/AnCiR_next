// Palette switching must actually reach the figures.
//
// THE BUG THIS COVERS (shipped in v70.3, fixed in v71)
//
// core.seriesColours stored the RESOLVED '#rrggbb'. getPaletteColor reads the live
// palette, but colourForSeries returned the cached hex before ever consulting it,
// so changing the palette in Settings recoloured only columns that had never been
// pinned. Precedence rule 1 is meant to protect a colour the USER chose; an
// auto-assigned one is not a user choice, and treating it as one made the rule mean
// something it does not say.
//
// Two halves have to work together, and each is useless alone:
//   - the map stores a SLOT, so a NEW series resolves through the live palette;
//   - repaintPinnedSeries pushes the change into series ALREADY constructed, since
//     each resolved its colour once into its own $state.
import { describe, it, expect, beforeEach } from 'vitest';
import { core, appState } from '$lib/core/core.svelte';
import {
	colourForSeries,
	colourForColumn,
	paletteIndexOf,
	normaliseEntry,
	migrateSeriesColourMap,
	pinnedColourSnapshot,
	repaintPinnedSeries,
	releaseSeriesColour,
	seriesColumnId,
	colourForCategory,
	colourForCategoryLabel,
	migrateCategoryColourMap,
	pinnedCategorySnapshot,
	releaseCategoryColour
} from './seriesColour.js';

const PAL_A = ['#aa0000', '#00aa00', '#0000aa', '#aaaa00'];
const PAL_B = ['#ff1111', '#11ff11', '#1111ff', '#ffff11'];

beforeEach(() => {
	appState.appColours = [...PAL_A];
	core.seriesColours = {};
	core.plots = [];
});

/** A minimal plot series shaped the way the real ones are. */
function mkSeries(colId, styleColour, extra = {}) {
	return { y: { refId: colId }, points: { colour: styleColour, ...extra } };
}

describe('slot assignment', () => {
	it('pins a slot and resolves it through the live palette', () => {
		const c = colourForSeries(null, 7, 0);
		expect(c).toBe(PAL_A[0]);
		expect(core.seriesColours[7]).toEqual({ slot: 0 });
	});

	it('the same column gets the same colour everywhere', () => {
		const first = colourForSeries(null, 7, 0);
		// A second plot wires the same column at a different position.
		const second = colourForSeries(null, 7, 3);
		expect(second).toBe(first);
	});

	it('different columns claim different slots', () => {
		colourForSeries(null, 1, 0);
		colourForSeries(null, 2, 0);
		expect(core.seriesColours[1].slot).not.toBe(core.seriesColours[2].slot);
	});

	it('an explicit colour always wins', () => {
		expect(colourForSeries('#123456', 7, 0)).toBe('#123456');
	});

	it('an off-palette explicit colour is NOT pinned', () => {
		colourForSeries('#123456', 7, 0);
		expect(core.seriesColours[7]).toBeUndefined();
	});

	it('adopts a baked colour that exactly matches a palette entry', () => {
		// A saved session bakes the resolved colour into every series, so without this
		// nothing claims a slot on load and palette switching still does nothing to any
		// existing figure. Appearance is unchanged: the slot resolves to the same colour.
		expect(colourForSeries(PAL_A[2], 7, 0)).toBe(PAL_A[2]);
		expect(core.seriesColours[7]).toEqual({ slot: 2 });
	});

	it('adoption does not override an existing pin', () => {
		core.seriesColours[7] = { slot: 1 };
		colourForSeries(PAL_A[3], 7, 0);
		expect(core.seriesColours[7]).toEqual({ slot: 1 });
	});

	it('an adopted series then follows a palette switch', () => {
		// The end-to-end point of adoption.
		const c = colourForSeries(PAL_A[1], 7, 0);
		core.plots = [{ plot: { data: [mkSeries(7, c)] } }];
		const before = pinnedColourSnapshot();
		appState.appColours = [...PAL_B];
		repaintPinnedSeries(before);
		expect(core.plots[0].plot.data[0].points.colour).toBe(PAL_B[1]);
	});

	it('an unwired series falls back to position without pinning', () => {
		expect(colourForSeries(null, null, 2)).toBe(PAL_A[2]);
		expect(Object.keys(core.seriesColours)).toHaveLength(0);
	});

	it('terminates when every slot is taken', () => {
		// Previously the loop searched for an unused colour up to 64 times; with a
		// palette of 4 and 5 columns there is no unused slot, and the loop has to stop
		// rather than spin.
		for (let colId = 0; colId < PAL_A.length + 1; colId++) {
			expect(colourForSeries(null, colId, 0)).toBeTruthy();
		}
		expect(Object.keys(core.seriesColours)).toHaveLength(PAL_A.length + 1);
	});
});

describe('the palette actually propagates', () => {
	it('a pinned column resolves differently after a palette swap', () => {
		colourForSeries(null, 7, 1);
		const before = colourForColumn(7);
		expect(before).toBe(PAL_A[1]);
		appState.appColours = [...PAL_B];
		expect(colourForColumn(7)).toBe(PAL_B[1]);
	});

	it('repaintPinnedSeries updates series that were following the palette', () => {
		const c = colourForSeries(null, 7, 0);
		core.plots = [{ plot: { data: [mkSeries(7, c)] } }];
		const before = pinnedColourSnapshot();
		appState.appColours = [...PAL_B];
		expect(repaintPinnedSeries(before)).toBeGreaterThan(0);
		expect(core.plots[0].plot.data[0].points.colour).toBe(PAL_B[0]);
	});

	it('repaintPinnedSeries LEAVES a hand-picked colour alone', () => {
		// The whole point of the snapshot discriminator. Without it, every palette
		// switch would wipe deliberate per-series colours.
		colourForSeries(null, 7, 0);
		core.plots = [{ plot: { data: [mkSeries(7, '#ff00ff')] } }];
		const before = pinnedColourSnapshot();
		appState.appColours = [...PAL_B];
		repaintPinnedSeries(before);
		expect(core.plots[0].plot.data[0].points.colour).toBe('#ff00ff');
	});

	it('moves a box fill along with its stroke', () => {
		// Otherwise a repainted box keeps its old fill and the two disagree.
		const c = colourForSeries(null, 7, 0);
		core.plots = [{ plot: { data: [{ y: { refId: 7 }, box: { colour: c, fillColour: c } }] } }];
		const before = pinnedColourSnapshot();
		appState.appColours = [...PAL_B];
		repaintPinnedSeries(before);
		expect(core.plots[0].plot.data[0].box.colour).toBe(PAL_B[0]);
		expect(core.plots[0].plot.data[0].box.fillColour).toBe(PAL_B[0]);
	});

	it('is a no-op when the palette did not change', () => {
		const c = colourForSeries(null, 7, 0);
		core.plots = [{ plot: { data: [mkSeries(7, c)] } }];
		expect(repaintPinnedSeries(pinnedColourSnapshot())).toBe(0);
	});

	it('tolerates a missing snapshot and unwired series', () => {
		core.plots = [{ plot: { data: [{ points: { colour: '#abc' } }] } }];
		expect(repaintPinnedSeries(null)).toBe(0);
		expect(repaintPinnedSeries({})).toBe(0);
	});
});

describe('legacy migration', () => {
	it('converts a hex that is in the active palette to a slot', () => {
		const migrated = migrateSeriesColourMap({ 5: PAL_A[2] });
		expect(migrated[5]).toEqual({ slot: 2 });
	});

	it('LOCKS a hex that is not in the active palette', () => {
		// It was either user-chosen or assigned under a different palette. Re-mapping it
		// would change a saved figure's colours, so it is left exactly as it was.
		const migrated = migrateSeriesColourMap({ 5: '#123456' });
		expect(migrated[5]).toEqual({ hex: '#123456' });
		core.seriesColours = migrated;
		expect(colourForColumn(5)).toBe('#123456');
	});

	it('a locked entry ignores palette changes', () => {
		core.seriesColours = { 5: { hex: '#123456' } };
		appState.appColours = [...PAL_B];
		expect(colourForColumn(5)).toBe('#123456');
	});

	it('is case-insensitive about palette matching', () => {
		expect(migrateSeriesColourMap({ 5: PAL_A[2].toUpperCase() })[5]).toEqual({ slot: 2 });
	});

	it('accepts the already-migrated shapes unchanged', () => {
		expect(migrateSeriesColourMap({ 1: { slot: 3 }, 2: { hex: '#abcdef' } })).toEqual({
			1: { slot: 3 },
			2: { hex: '#abcdef' }
		});
	});

	it('drops junk rather than pinning something unusable', () => {
		expect(migrateSeriesColourMap({ 1: null, 2: '', 3: {}, 4: { slot: -1 }, 5: 7 })).toEqual({});
		expect(migrateSeriesColourMap(null)).toEqual({});
		expect(migrateSeriesColourMap('nope')).toEqual({});
	});
});

describe('helpers', () => {
	it('paletteIndexOf finds and misses correctly', () => {
		expect(paletteIndexOf(PAL_A[3])).toBe(3);
		expect(paletteIndexOf('#nonsense')).toBe(-1);
	});

	it('normaliseEntry round-trips a slot', () => {
		expect(normaliseEntry({ slot: 0 })).toEqual({ slot: 0 });
	});

	it('colourForColumn returns null for an unpinned column', () => {
		expect(colourForColumn(999)).toBeNull();
	});

	it('releaseSeriesColour unpins', () => {
		colourForSeries(null, 7, 0);
		releaseSeriesColour(7);
		expect(colourForColumn(7)).toBeNull();
	});

	it('seriesColumnId reads either binding shape', () => {
		expect(seriesColumnId({ y: { refId: 4 } })).toBe(4);
		expect(seriesColumnId({ column: { refId: 9 } })).toBe(9);
		expect(seriesColumnId({ y: { refId: -1 } })).toBeNull();
		expect(seriesColumnId(null)).toBeNull();
	});
});

// Category colours: the sibling map for what the column map cannot express.
//
// A boxplot's boxes come from unique VALUES of an x column, and one y column split
// across three categories is ONE series, so the column-keyed map resolves all three
// boxes to a single colour. There is no column per category to key on, so the label
// is the identity here.
describe('category colours', () => {
	beforeEach(() => {
		core.categoryColours = {};
	});

	it('pins a slot per label and is stable across calls', () => {
		const first = colourForCategory('control', 0);
		expect(first).toBe(PAL_A[0]);
		expect(colourForCategory('control', 3)).toBe(first);
	});

	it('different labels get different slots', () => {
		colourForCategory('control', 0);
		colourForCategory('treatment', 0);
		expect(core.categoryColours.control.slot).not.toBe(core.categoryColours.treatment.slot);
	});

	it('keys on the string form, so 1 and "1" are one category', () => {
		// x values arrive from a column and may be numbers; the DOM and the map must not
		// disagree about which category a box belongs to.
		const c = colourForCategory(1, 0);
		expect(colourForCategoryLabel('1')).toBe(c);
	});

	it('follows a palette switch, with no repaint needed', () => {
		// Unlike series colour, this is read at render time rather than baked into
		// per-series state, so the live palette reaches it directly.
		colourForCategory('control', 2);
		appState.appColours = [...PAL_B];
		expect(colourForCategoryLabel('control')).toBe(PAL_B[2]);
	});

	it('reads as null before anything is pinned', () => {
		// The render path relies on this: it must be able to READ without pinning,
		// because pinning during render would mutate $state mid-render.
		expect(colourForCategoryLabel('never-seen')).toBeNull();
	});

	it('a locked hex ignores the palette', () => {
		core.categoryColours = { control: { hex: '#abcdef' } };
		appState.appColours = [...PAL_B];
		expect(colourForCategoryLabel('control')).toBe('#abcdef');
	});

	it('migrates and snapshots like the column map', () => {
		core.categoryColours = migrateCategoryColourMap({ control: PAL_A[1], other: '#123456' });
		expect(core.categoryColours.control).toEqual({ slot: 1 });
		expect(core.categoryColours.other).toEqual({ hex: '#123456' });
		expect(pinnedCategorySnapshot()).toEqual({ control: PAL_A[1], other: '#123456' });
	});

	it('releaseCategoryColour unpins', () => {
		colourForCategory('control', 0);
		releaseCategoryColour('control');
		expect(colourForCategoryLabel('control')).toBeNull();
	});
});
