// The appearance identity map, and read-time resolution.
//
// THE BUG THIS EXISTS FOR. Colour was resolved in the PointsClass constructor, but a
// series is built with `y.refId === -1` and the column is wired AFTERWARDS. So the
// column was unknown at exactly the moment it was needed: the positional fallback ran
// and nothing was pinned. Adding a column to a second plot gave it the first palette
// colour instead of the colour it already had.
//
// EVERY earlier colour test passed a known column id up front, which is precisely why
// none of them caught it. The "wiring order" block below models the real sequence:
// construct with -1, then wire.
import { describe, it, expect, beforeEach } from 'vitest';
import { core, appState } from '$lib/core/core.svelte';
import {
	DASH_ORDER,
	paletteIndexOf,
	normaliseRecord,
	migrateAppearanceMaps,
	recordFor,
	mappedColour,
	mappedShape,
	mappedDash,
	pinAppearance,
	setEditedAppearance,
	releaseAppearance,
	resolveColour,
	resolveShape,
	resolveDash,
	clearSeriesColourOverrides,
	appearanceRows
} from './appearanceIdentity.js';
import { POINT_SHAPES } from '$lib/components/plotbits/pointShapes.js';

const PAL_A = ['#aa0000', '#00aa00', '#0000aa', '#aaaa00'];
const PAL_B = ['#ff1111', '#11ff11', '#1111ff', '#ffff11'];

beforeEach(() => {
	appState.appColours = [...PAL_A];
	core.seriesAppearance = {};
	// Slot claiming only counts records whose column still exists.
	core.data = Array.from({ length: 20 }, (_, id) => ({ id }));
});

describe('wiring order (the reported bug)', () => {
	it('an unwired series gets a positional colour and pins NOTHING', () => {
		// Level 3 without a column: stable, but not yet shared. Critically it must not
		// write a record keyed on null/-1.
		expect(resolveColour(null, null, 1)).toBe(PAL_A[1]);
		expect(Object.keys(core.seriesAppearance)).toHaveLength(0);
	});

	it('resolves correctly once the column arrives, with no re-construction', () => {
		// The whole point of read-time resolution: the same series object, read again
		// after wiring, now gets the column's colour.
		expect(resolveColour(null, null, 0)).toBe(PAL_A[0]);
		pinAppearance(5, 0);
		expect(resolveColour(null, 5, 0)).toBe(mappedColour(5));
	});

	it('a SECOND plot adding the same column first gets that column’s colour', () => {
		// The exact repro. Plot 1 wires column 5 then 6; plot 2 wires 6 first. Under the
		// old constructor-time resolution, 6 took palette slot 0 in plot 2.
		pinAppearance(5, 0);
		pinAppearance(6, 1);
		const sixInPlotOne = resolveColour(null, 6, 1);
		const sixInPlotTwo = resolveColour(null, 6, 0); // first series of a new plot
		expect(sixInPlotTwo).toBe(sixInPlotOne);
		expect(sixInPlotTwo).not.toBe(resolveColour(null, 5, 0));
	});
});

describe('precedence', () => {
	it('a per-series override always wins', () => {
		pinAppearance(5, 0);
		expect(resolveColour('#123456', 5, 0)).toBe('#123456');
	});

	it('the map beats the positional fallback', () => {
		pinAppearance(5, 3);
		expect(resolveColour(null, 5, 0)).toBe(mappedColour(5));
	});

	it('shape and dash follow the same chain, gated by varyMarkers', () => {
		pinAppearance(5, 2);
		expect(resolveShape(null, 5, false)).toBe('circle');
		expect(resolveShape(null, 5, true)).toBe(mappedShape(5));
		// 'solid' is this build's spelling for an unbroken line — the same value the Line
		// control offers, so the Style dropdown can actually show it.
		expect(resolveDash(null, 5, false)).toBe('solid');
		expect(resolveDash(null, 5, true)).toBe(mappedDash(5));
		// An override still wins even with the gate off.
		expect(resolveShape('star', 5, false)).toBe('star');
	});
});

describe('pinning', () => {
	it('claims colour, shape and dash together', () => {
		expect(pinAppearance(5, 0)).toBe(true);
		const r = recordFor(5);
		expect(r.colour).toBeTruthy();
		expect(POINT_SHAPES).toContain(r.shape);
		expect(DASH_ORDER).toContain(r.dash);
	});

	it('is idempotent', () => {
		pinAppearance(5, 0);
		expect(pinAppearance(5, 0)).toBe(false);
	});

	it('gives different columns different slots and shapes', () => {
		pinAppearance(5, 0);
		pinAppearance(6, 0);
		expect(recordFor(5).colour.slot).not.toBe(recordFor(6).colour.slot);
		expect(recordFor(5).shape).not.toBe(recordFor(6).shape);
	});

	it('terminates when everything is claimed', () => {
		for (let i = 0; i < POINT_SHAPES.length + 3; i++) expect(pinAppearance(i, 0)).toBe(true);
	});

	it('never touches an edited record', () => {
		setEditedAppearance(7, { colour: { hex: '#ff00ff' }, shape: 'star' });
		expect(pinAppearance(7, 0)).toBe(false);
		expect(mappedColour(7)).toBe('#ff00ff');
		expect(mappedShape(7)).toBe('star');
	});

	it('ignores a null column', () => {
		expect(pinAppearance(null, 0)).toBe(false);
	});
});

describe('slots follow the palette', () => {
	it('a pinned colour changes with the palette', () => {
		pinAppearance(5, 1);
		const before = mappedColour(5);
		appState.appColours = [...PAL_B];
		expect(mappedColour(5)).not.toBe(before);
		expect(PAL_B).toContain(mappedColour(5));
	});

	it('an edited hex does NOT', () => {
		setEditedAppearance(5, { colour: { hex: '#123456' } });
		appState.appColours = [...PAL_B];
		expect(mappedColour(5)).toBe('#123456');
	});
});

describe('migration from the three v72.1 maps', () => {
	it('folds colours, shapes and dashes into one record', () => {
		const merged = migrateAppearanceMaps(null, { 5: { slot: 2 } }, { 5: 'triangle' }, { 5: '6 3' });
		// '6 3' was the v72.1 spelling; it is translated rather than dropped.
		expect(merged['5']).toEqual({ colour: { slot: 2 }, shape: 'triangle', dash: '5, 5' });
	});

	it('accepts the legacy bare-hex form, converting a palette match to a slot', () => {
		expect(migrateAppearanceMaps(null, { 5: PAL_A[2] }, null, null)['5']).toEqual({
			colour: { slot: 2 }
		});
	});

	it('locks a legacy hex that is not in the palette', () => {
		// Either user-chosen or assigned under a different palette; re-mapping it would
		// change a saved figure.
		expect(migrateAppearanceMaps(null, { 5: '#123456' }, null, null)['5']).toEqual({
			colour: { hex: '#123456' }
		});
	});

	it('an already-merged record wins over the legacy maps', () => {
		const merged = migrateAppearanceMaps(
			{ 5: { colour: { slot: 1 }, shape: 'star', edited: true } },
			{ 5: { slot: 3 } },
			{ 5: 'square' },
			null
		);
		expect(merged['5'].colour).toEqual({ slot: 1 });
		expect(merged['5'].shape).toBe('star');
		expect(merged['5'].edited).toBe(true);
	});

	it('fills only the gaps a merged record leaves', () => {
		const merged = migrateAppearanceMaps({ 5: { shape: 'star' } }, { 5: { slot: 3 } }, null, null);
		expect(merged['5']).toEqual({ shape: 'star', colour: { slot: 3 } });
	});

	it('drops junk rather than storing something unusable', () => {
		expect(
			migrateAppearanceMaps({ 1: null, 2: {}, 3: 7 }, { 4: '' }, { 5: 'blob' }, { 6: 'nope' })
		).toEqual({});
		expect(migrateAppearanceMaps(null, null, null, null)).toEqual({});
	});

	it('keeps a shape-only record, since colour may still be auto', () => {
		expect(normaliseRecord({ shape: 'triangle' })).toEqual({ shape: 'triangle' });
	});
});

describe('helpers', () => {
	it('paletteIndexOf is case-insensitive and reports misses', () => {
		expect(paletteIndexOf(PAL_A[3].toUpperCase())).toBe(3);
		expect(paletteIndexOf('#nope')).toBe(-1);
	});

	it('release forgets the record', () => {
		pinAppearance(5, 0);
		releaseAppearance(5);
		expect(recordFor(5)).toBeNull();
		expect(mappedColour(5)).toBeNull();
	});

	it('reads of an unknown column are null, never a thrown error', () => {
		expect(recordFor(999)).toBeNull();
		expect(mappedColour(999)).toBeNull();
		expect(mappedShape(999)).toBeNull();
		expect(mappedDash(999)).toBeNull();
	});
});

// Slice 2: "reset data colours" — the CLEAR half of apply-to-all.
//
// Typography is copied into each figure; colour is cleared so each figure reveals the
// shared map. One button cannot do both. This only became possible once colour
// resolved at read time: before, clearing an override left the series with nothing.
describe('clearSeriesColourOverrides', () => {
	/** A series whose style object behaves like the real accessor-backed ones. */
	const mkSeries = (colId, override) => {
		let explicit = override ?? null;
		const parent = { y: { refId: colId } };
		parent.points = {
			get colour() {
				return resolveColour(explicit, colId, 0);
			},
			set colour(v) {
				explicit = v;
			}
		};
		return parent;
	};

	it('drops an override so the series falls back to the map', () => {
		pinAppearance(5, 0);
		const s = mkSeries(5, '#ff00ff');
		const plots = [{ plot: { data: [s] } }];
		expect(s.points.colour).toBe('#ff00ff');
		expect(clearSeriesColourOverrides(plots)).toBe(1);
		expect(s.points.colour).toBe(mappedColour(5));
	});

	it('reports nothing when there was no override to drop', () => {
		pinAppearance(5, 0);
		const plots = [{ plot: { data: [mkSeries(5, null)] } }];
		expect(clearSeriesColourOverrides(plots)).toBe(0);
	});

	it('is idempotent', () => {
		pinAppearance(5, 0);
		const plots = [{ plot: { data: [mkSeries(5, '#ff00ff')] } }];
		clearSeriesColourOverrides(plots);
		expect(clearSeriesColourOverrides(plots)).toBe(0);
	});

	it('tolerates junk without throwing', () => {
		expect(clearSeriesColourOverrides(null)).toBe(0);
		expect(clearSeriesColourOverrides([null, {}, { plot: {} }])).toBe(0);
	});
});

// Slice 3: the rows the editor shows.
describe('appearanceRows', () => {
	it('one row per record, with the resolved values', () => {
		pinAppearance(5, 0);
		const rows = appearanceRows(core.seriesAppearance, () => 'hive A');
		expect(rows).toHaveLength(1);
		expect(rows[0].columnId).toBe(5);
		expect(rows[0].name).toBe('hive A');
		expect(POINT_SHAPES).toContain(rows[0].shape);
		expect(DASH_ORDER).toContain(rows[0].dash);
		expect(rows[0].edited).toBe(false);
	});

	it('marks an edited record and keeps its hex', () => {
		setEditedAppearance(5, { colour: { hex: '#ff00ff' } });
		const [row] = appearanceRows(core.seriesAppearance, () => 'x');
		expect(row.edited).toBe(true);
		expect(row.colour).toBe('#ff00ff');
	});

	it('still lists a column that no longer exists, so the row can be reset', () => {
		// A record can outlive its column. A blank row would be unidentifiable and the
		// stale entry unreachable.
		pinAppearance(42, 0);
		const [row] = appearanceRows(core.seriesAppearance, () => '');
		expect(row.name).toContain('42');
	});

	it('sorts by name so rows do not jump around as columns are added', () => {
		setEditedAppearance(1, { colour: { hex: '#111111' } });
		setEditedAppearance(2, { colour: { hex: '#222222' } });
		const names = { 1: 'zebra', 2: 'alpha' };
		expect(appearanceRows(core.seriesAppearance, (id) => names[id]).map((r) => r.name)).toEqual([
			'alpha',
			'zebra'
		]);
	});

	it('an edit MERGES rather than replacing the record', () => {
		// Setting a shape must not wipe the colour, or editing one channel would silently
		// reset the others.
		pinAppearance(5, 2);
		const slotBefore = recordFor(5).colour.slot;
		setEditedAppearance(5, { shape: 'star' });
		expect(recordFor(5).shape).toBe('star');
		expect(recordFor(5).colour.slot).toBe(slotBefore);
	});

	it('reset removes the record so pinning re-derives it', () => {
		setEditedAppearance(5, { colour: { hex: '#ff00ff' } });
		releaseAppearance(5);
		expect(appearanceRows(core.seriesAppearance, () => 'x')).toHaveLength(0);
		expect(pinAppearance(5, 0)).toBe(true);
	});

	it('tolerates an empty or junk map', () => {
		expect(appearanceRows(null, () => 'x')).toEqual([]);
		expect(appearanceRows({ 1: null, 2: 'nope' }, () => 'x')).toEqual([]);
	});
});

// Carried over from the map this replaced (v72.3). Nothing releases a record when its column
// is deleted, so without a liveness check a dead record goes on holding its palette slot and
// every later series starts further down the palette.
describe('slots held by columns that no longer exist', () => {
	const live = (...ids) => (core.data = ids.map((id) => ({ id })));

	it('does not let a deleted column keep its slot', () => {
		live(1);
		pinAppearance(1, 0);
		const first = mappedColour(1);
		core.data = [];
		live(2);
		pinAppearance(2, 0);
		expect(mappedColour(2)).toBe(first);
	});

	it('still gives two live columns different slots', () => {
		live(1, 2);
		pinAppearance(1, 0);
		pinAppearance(2, 0);
		expect(mappedColour(1)).not.toBe(mappedColour(2));
	});

	it('hands a returning column the colour it had', () => {
		live(1);
		pinAppearance(1, 0);
		const had = mappedColour(1);
		core.data = [];
		live(2);
		pinAppearance(2, 0);
		live(1, 2);
		expect(mappedColour(1)).toBe(had);
	});
});
