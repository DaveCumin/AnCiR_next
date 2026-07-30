// Category colours, and the shared helpers.
//
// The slot/palette tests that used to lead this file moved to
// appearanceIdentity.svelte.test.js along with the code: per-COLUMN identity is one merged
// record now. Categories keep their own map, because a boxplot's boxes come from VALUES of a
// column and there is no column per category to key on.
import { describe, it, expect, beforeEach } from 'vitest';
import { core, appState } from '$lib/core/core.svelte';
import {
	paletteIndexOf,
	normaliseEntry,
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
	core.categoryColours = {};
	core.plots = [];
	core.data = [];
});

/** Register column ids as live, since slot claiming only counts pins for existing columns. */
function liveColumns(...ids) {
	core.data = ids.map((id) => ({ id }));
}

/** A minimal plot series shaped the way the real ones are. */
function mkSeries(colId, styleColour, extra = {}) {
	return { y: { refId: colId }, points: { colour: styleColour, ...extra } };
}

describe('helpers', () => {
	it('paletteIndexOf finds and misses correctly', () => {
		expect(paletteIndexOf(PAL_A[3])).toBe(3);
		expect(paletteIndexOf('#nonsense')).toBe(-1);
	});

	it('normaliseEntry round-trips a slot', () => {
		expect(normaliseEntry({ slot: 0 })).toEqual({ slot: 0 });
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

// A pin is keyed on a column id and nothing removes it when the column goes. If a dead pin
// still counted as claiming its slot, every later series started further down the palette —
// which is what made the cmd-shift-S demo come back mid-palette on its second run.
