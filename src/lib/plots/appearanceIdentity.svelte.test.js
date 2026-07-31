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
	appearanceRows,
	pinAllSeriesAppearance,
	adoptedRecord
} from './appearanceIdentity.js';
import { POINT_SHAPES } from '$lib/components/plotbits/pointShapes.js';

const PAL_A = ['#aa0000', '#00aa00', '#0000aa', '#aaaa00'];
const PAL_B = ['#ff1111', '#11ff11', '#1111ff', '#ffff11'];

beforeEach(() => {
	appState.appColours = [...PAL_A];
	core.seriesAppearance = {};
	// Slot claiming only counts records whose column still exists.
	core.data = Array.from({ length: 20 }, (_, id) => ({ id }));
	// No ancestry unless a test builds some: every column above is a root.
	core.orphanProcesses = [];
	core.tableProcesses = [];
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

// TIER 2b: a column with no record of its own adopts its source column's.
//
// THE ANNOYANCE THIS FIXES. A processed column is a NEW column with a NEW id, so
// `a → Detrend` had no record, took the next palette index, and came out a different
// colour from `a`.
//
// The two mechanisms (refId, producerNodeId) are exercised separately here for the
// same reason columnAncestry.test.js does it: they share no code, so one fixture
// cannot speak for both. Adoption must also TRACK rather than copy — the tests that
// change the source afterwards are the ones that would catch a regression to a
// one-time copy.
describe('ancestry adoption', () => {
	/** A free process node, as producerRuntime finds it. */
	const node = (id, args) => ({ id, args });
	const setGraph = (columns, processes = []) => {
		core.data = columns;
		core.orphanProcesses = processes;
	};

	it('a referential column adopts colour, shape and dash from its referent', () => {
		setGraph([{ id: 1 }, { id: 2, refId: 1 }]);
		pinAppearance(1, 0);
		expect(mappedColour(2)).toBe(mappedColour(1));
		expect(mappedShape(2)).toBe(mappedShape(1));
		expect(mappedDash(2)).toBe(mappedDash(1));
	});

	it('a produced column adopts from the column it was made from', () => {
		setGraph(
			[{ id: 1 }, { id: 10, producerNodeId: 'process_5', producerPort: 'out_1' }],
			[node(5, { inIN: [1] })]
		);
		pinAppearance(1, 0);
		expect(mappedColour(10)).toBe(mappedColour(1));
	});

	it('adopts through two hops', () => {
		setGraph(
			[
				{ id: 1 },
				{ id: 2, producerNodeId: 'process_5', producerPort: 'out_1' },
				{ id: 3, producerNodeId: 'process_6', producerPort: 'out_2' }
			],
			[node(5, { inIN: [1] }), node(6, { inIN: [2] })]
		);
		pinAppearance(1, 0);
		expect(mappedColour(3)).toBe(mappedColour(1));
	});

	it('prefers the NEAREST ancestor that has a record', () => {
		// The user styled the intermediate deliberately; jumping past it back to the
		// original would ignore that.
		setGraph(
			[
				{ id: 1 },
				{ id: 2, producerNodeId: 'process_5', producerPort: 'out_1' },
				{ id: 3, producerNodeId: 'process_6', producerPort: 'out_2' }
			],
			[node(5, { inIN: [1] }), node(6, { inIN: [2] })]
		);
		pinAppearance(1, 0);
		setEditedAppearance(2, { colour: { hex: '#abcdef' } });
		expect(mappedColour(3)).toBe('#abcdef');
	});

	it('each output of a FAN-OUT node adopts its own input', () => {
		setGraph(
			[
				{ id: 1 },
				{ id: 2 },
				{ id: 10, producerNodeId: 'process_5', producerPort: 'out_1' },
				{ id: 11, producerNodeId: 'process_5', producerPort: 'out_2' }
			],
			[node(5, { inIN: [1, 2] })]
		);
		pinAppearance(1, 0);
		pinAppearance(2, 1);
		expect(mappedColour(10)).toBe(mappedColour(1));
		expect(mappedColour(11)).toBe(mappedColour(2));
		expect(mappedColour(10)).not.toBe(mappedColour(11));
	});

	it('a two-input node adopts NOTHING and falls back to the index', () => {
		// Cross-correlating a and b makes something new. Painting it as a would be a
		// confident lie; a fresh palette index at least reads as "this is new".
		setGraph(
			[{ id: 1 }, { id: 2 }, { id: 10, producerNodeId: 'process_5' }],
			[node(5, { xIN: 1, yIN: 2 })]
		);
		pinAppearance(1, 0);
		expect(mappedColour(10)).toBeNull();
		expect(resolveColour(null, 10, 2)).toBe(PAL_A[2]);
	});

	it('a reference cycle resolves rather than hanging', () => {
		setGraph([
			{ id: 1, refId: 2 },
			{ id: 2, refId: 1 }
		]);
		// Pinning either one settles the family; the read must terminate whichever way
		// the walk goes round.
		pinAppearance(1, 0);
		expect(resolveColour(null, 1, 0)).toBeTruthy();
		expect(resolveColour(null, 2, 0)).toBeTruthy();
	});

	it('creates no record for the adopting column', () => {
		// The editor must not fill with rows the user never made, and a stored copy
		// would stop tracking the source.
		setGraph([{ id: 1 }, { id: 2, refId: 1 }]);
		pinAppearance(1, 0);
		mappedColour(2);
		resolveColour(null, 2, 0);
		expect(Object.keys(core.seriesAppearance)).toEqual(['1']);
		expect(appearanceRows(core.seriesAppearance, () => 'x')).toHaveLength(1);
	});

	it('pinning leaves an adopting column alone', () => {
		setGraph([{ id: 1 }, { id: 2, refId: 1 }]);
		pinAppearance(1, 0);
		expect(pinAppearance(2, 1)).toBe(false);
		expect(core.seriesAppearance['2']).toBeUndefined();
	});

	it('pins the ROOT when a derived column is plotted first', () => {
		// Order-independence. Pinning the derived column here would give it slot 0 and
		// leave `1` to take a different one later — the original bug, one step removed.
		setGraph([{ id: 1 }, { id: 2, refId: 1 }]);
		expect(pinAppearance(2, 0)).toBe(true);
		expect(core.seriesAppearance['2']).toBeUndefined();
		expect(core.seriesAppearance['1']).toBeTruthy();
		expect(mappedColour(2)).toBe(mappedColour(1));
	});

	it('tracks the source instead of copying it', () => {
		// The whole point. Recolour `1` and everything derived from it follows.
		setGraph([{ id: 1 }, { id: 2, refId: 1 }]);
		pinAppearance(1, 0);
		const before = mappedColour(2);
		setEditedAppearance(1, { colour: { hex: '#ff00ff' }, shape: 'star' });
		expect(mappedColour(2)).toBe('#ff00ff');
		expect(mappedColour(2)).not.toBe(before);
		expect(mappedShape(2)).toBe('star');
	});

	it('follows the palette through an adopted slot', () => {
		setGraph([{ id: 1 }, { id: 2, refId: 1 }]);
		pinAppearance(1, 1);
		appState.appColours = [...PAL_B];
		expect(mappedColour(2)).toBe(mappedColour(1));
		expect(PAL_B).toContain(mappedColour(2));
	});

	it('an explicit record on the derived column beats its ancestor', () => {
		setGraph([{ id: 1 }, { id: 2, refId: 1 }]);
		setEditedAppearance(1, { colour: { hex: '#111111' } });
		setEditedAppearance(2, { colour: { hex: '#222222' } });
		expect(mappedColour(2)).toBe('#222222');
		// The ancestor's record is still what it would fall back to.
		expect(adoptedRecord(2).colour).toEqual({ hex: '#111111' });
	});

	it('does not double-claim a palette slot for the family', () => {
		// The derived column holds no record, so `3` must be free to take the slot the
		// derived column would otherwise have consumed.
		setGraph([{ id: 1 }, { id: 2, refId: 1 }, { id: 3 }]);
		pinAppearance(1, 0);
		pinAppearance(2, 1);
		pinAppearance(3, 1);
		expect(recordFor(3).colour.slot).toBe(1);
	});

	it('pinAllSeriesAppearance settles with a derived series', () => {
		setGraph([{ id: 1 }, { id: 2, refId: 1 }]);
		const plots = [{ plot: { data: [{ y: { refId: 2 } }, { y: { refId: 1 } }] } }];
		expect(pinAllSeriesAppearance(plots)).toBe(1);
		expect(pinAllSeriesAppearance(plots)).toBe(0);
		expect(Object.keys(core.seriesAppearance)).toEqual(['1']);
	});
});

// The case adoption matters MOST in, and the one it used to miss. A Cosinor or
// FitFunction output has neither refId nor producerNodeId, so it took a fresh palette
// index; Quick-plot then drew the data and the fit it belongs to on one figure in two
// different colours, which reads as two different things.
describe('ancestry adoption for analysis outputs', () => {
	/** A TableProcess as core.tableProcesses holds it. */
	const tp = (id, args) => ({ id, args });

	/** The Cosinor shape: one Y in, a fitted Y and a residual out. */
	const cosinorOn = (yId, fitId, residId) => {
		core.data = [{ id: yId }, { id: fitId }, { id: residId }];
		core.tableProcesses = [
			tp(1, { yIN: [yId], out: { [`cosinory_${yId}`]: fitId, [`resid_${yId}`]: residId } })
		];
	};

	it('a fit column takes the colour of the column it was fitted to', () => {
		cosinorOn(7, 20, 21);
		pinAppearance(7, 0);
		expect(mappedColour(20)).toBe(mappedColour(7));
		expect(mappedShape(20)).toBe(mappedShape(7));
		expect(mappedDash(20)).toBe(mappedDash(7));
		// The residual is the same data too, so it follows as well.
		expect(mappedColour(21)).toBe(mappedColour(7));
	});

	it('TRACKS the source rather than copying it', () => {
		cosinorOn(7, 20, 21);
		pinAppearance(7, 0);
		const before = mappedColour(20);
		setEditedAppearance(7, { colour: { hex: '#ff00ff' }, shape: 'star' });
		expect(mappedColour(20)).toBe('#ff00ff');
		expect(mappedColour(20)).not.toBe(before);
		expect(mappedShape(20)).toBe('star');
	});

	it('creates no record for the fit column', () => {
		cosinorOn(7, 20, 21);
		pinAppearance(7, 0);
		mappedColour(20);
		resolveColour(null, 20, 1);
		expect(Object.keys(core.seriesAppearance)).toEqual(['7']);
	});

	it('pins the ROOT when the fit is plotted before the data', () => {
		// Quick-plot's actual order: the fit series is often built first.
		cosinorOn(7, 20, 21);
		expect(pinAppearance(20, 0)).toBe(true);
		expect(core.seriesAppearance['20']).toBeUndefined();
		expect(core.seriesAppearance['7']).toBeTruthy();
		expect(mappedColour(20)).toBe(mappedColour(7));
		// And the second pass finds the family already pinned.
		expect(pinAppearance(7, 0)).toBe(false);
	});

	it('each Y of a multi-Y analysis keeps its own colour', () => {
		core.data = [{ id: 7 }, { id: 8 }, { id: 20 }, { id: 21 }];
		core.tableProcesses = [tp(1, { yIN: [7, 8], out: { cosinory_7: 20, cosinory_8: 21 } })];
		pinAppearance(7, 0);
		pinAppearance(8, 1);
		expect(mappedColour(20)).toBe(mappedColour(7));
		expect(mappedColour(21)).toBe(mappedColour(8));
		expect(mappedColour(20)).not.toBe(mappedColour(21));
	});

	it('a multi-input analysis output adopts NOTHING and falls back to the index', () => {
		core.data = [{ id: 1 }, { id: 2 }, { id: 50 }];
		core.tableProcesses = [tp(1, { xIN: 1, yIN: [2], out: { period: 50 } })];
		pinAppearance(1, 0);
		pinAppearance(2, 1);
		expect(mappedColour(50)).toBeNull();
		expect(resolveColour(null, 50, 2)).toBe(PAL_A[2]);
	});

	it('pinAllSeriesAppearance settles on a data + fit figure', () => {
		cosinorOn(7, 20, 21);
		const plots = [{ plot: { data: [{ y: { refId: 20 } }, { y: { refId: 7 } }] } }];
		expect(pinAllSeriesAppearance(plots)).toBe(1);
		expect(pinAllSeriesAppearance(plots)).toBe(0);
		expect(Object.keys(core.seriesAppearance)).toEqual(['7']);
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
