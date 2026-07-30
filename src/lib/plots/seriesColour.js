// One colour per column, for the whole session.
//
// THE PROBLEM
//
// Series colour was assigned by POSITION within its plot:
//
//     this.colour = dataIN?.colour ?? getPaletteColor(this.parentPlot.data.length);
//
// So the same hive is colour 0 in the plot where it happens to be wired first and
// colour 2 in the next one. Nothing anywhere recorded that two series in different
// plots are the same thing, so no amount of UI for copying styles between plots
// would fix it — that only makes the reconciliation repeatable by hand.
//
// WHY KEY ON THE COLUMN
//
// An earlier draft keyed on `Column.groupLabel`, which already exists and is
// already persisted. Rejected: the data in question passes through a Long-to-wide
// node before plotting, and labels do not survive that usefully.
//
// Keying on the column is better BECAUSE of Long-to-wide: after the transform each
// hive IS its own column, so column identity already is hive identity. The thing
// we would otherwise ask the user to label is already in the data model, and the
// feature needs no setup at all.
//
// (That reasoning is about SERIES. It does not extend to categorical plots, where
// the boxes come from unique VALUES of an x column and there is no column per
// category to key on. Those need a label-keyed sibling map; separate work.)
//
// SLOTS, NOT HEX  (the v71 fix)
//
// The map used to store the resolved `#rrggbb`. That quietly broke palette
// switching: `getPaletteColor` reads the live palette, but this function returned
// the cached hex before ever consulting it, so changing the palette in Settings
// recoloured only the columns that had never been pinned. Precedence rule 1 below
// is meant to protect a colour the USER chose; an auto-assigned one is not a user
// choice, and treating it as one made the rule mean something it does not say.
//
// So an auto-assigned entry stores `{ slot }` — an index into whatever palette is
// active — and resolves through the palette every time it is read. A colour the
// user picked (or a legacy one we cannot prove was automatic) stores `{ hex }` and
// is never touched.
//
// PRECEDENCE, resolved once when a series is created
//
//   1. an explicit colour on the series — always wins, never auto-overwritten
//   2. the session map, if this column already has a slot or a locked hex
//   3. otherwise the next unused SLOT, pinned to that column and recorded
//
// Steps 2-3 give "the first plot to draw a column claims a colour, every other
// plot drawing that column adopts it", with no user action.
//
// Assignment is pinned rather than positional on purpose: once colour carries
// identity, adding a series must not shift the colours of everything below it,
// which is exactly what an index into a palette does.
import { core, appState } from '$lib/core/core.svelte';
import { getPaletteColor } from '$lib/components/inputs/ColourPicker.svelte';

/** Style sub-objects on a plot series that carry a `colour`. */
const SERIES_STYLE_KEYS = ['points', 'line', 'box'];

/** Column id a plot series is bound to, or null when it is not wired yet. */
export function seriesColumnId(parent) {
	// Points/Line/Box hang off a per-series Dataclass carrying `.y`; a few plots
	// (Histogram, CircularPhase) bind a single `.column` instead.
	const ref = parent?.y?.refId ?? parent?.column?.refId ?? null;
	return typeof ref === 'number' && ref >= 0 ? ref : null;
}

function map() {
	return (core.seriesColours ??= {});
}

/**
 * Normalise one stored entry.
 *
 * Accepts the legacy plain-hex form so a session saved before slots existed still
 * loads. A legacy hex is only converted to a slot when it is actually IN the
 * current palette; otherwise it is locked. That is the conservative reading: a hex
 * we cannot place was either user-chosen or assigned from a different palette, and
 * in both cases silently re-mapping it would change a saved figure's appearance.
 */
export function normaliseEntry(entry) {
	if (typeof entry === 'string' && entry) {
		const slot = paletteIndexOf(entry);
		return slot >= 0 ? { slot } : { hex: entry };
	}
	if (entry && typeof entry === 'object') {
		if (Number.isInteger(entry.slot) && entry.slot >= 0) return { slot: entry.slot };
		if (typeof entry.hex === 'string' && entry.hex) return { hex: entry.hex };
	}
	return null;
}

/** Index of a colour in the active palette, or -1. Case-insensitive. */
export function paletteIndexOf(hex) {
	const palette = appState.appColours ?? [];
	const want = String(hex).toLowerCase();
	return palette.findIndex((c) => String(c).toLowerCase() === want);
}

/**
 * Migrate a whole saved map. Call on session import, before any plot is built.
 * @param {any} saved
 */
export function migrateSeriesColourMap(saved) {
	const out = {};
	if (!saved || typeof saved !== 'object') return out;
	for (const [colId, entry] of Object.entries(saved)) {
		const norm = normaliseEntry(entry);
		if (norm) out[colId] = norm;
	}
	return out;
}

/** The colour a pinned column currently resolves to, or null when unpinned. */
export function colourForColumn(columnId) {
	const entry = normaliseEntry(map()[columnId]);
	if (!entry) return null;
	return entry.hex ?? getPaletteColor(entry.slot);
}

/** Slots already claimed by some column. */
function takenSlots() {
	const taken = new Set();
	for (const entry of Object.values(map())) {
		const norm = normaliseEntry(entry);
		if (norm && norm.slot != null) taken.add(norm.slot);
	}
	return taken;
}

/**
 * The colour this series should use.
 *
 * @param explicit     a colour already on the saved series (precedence 1)
 * @param columnId     from seriesColumnId(); null when the series is not wired
 * @param fallbackIndex positional index, used only when there is no column to key on
 */
export function colourForSeries(explicit, columnId, fallbackIndex = 0) {
	if (explicit) {
		// ADOPTION. A saved session bakes the resolved colour into every series, so on
		// load every series looks "explicit" and nothing claims a slot. Palette switching
		// would then still appear to do nothing to any existing figure, which is the
		// complaint that started this.
		//
		// So a baked colour that EXACTLY matches an entry in the active palette is
		// adopted as that slot: an exact palette match is what auto-assignment produces,
		// and a value that only ever came from a default is not a user decision (the same
		// reasoning as the legend border default). Anything else stays untouched.
		//
		// Nothing changes appearance here: the slot resolves to the very colour that was
		// passed in. It only changes what happens on the NEXT palette switch.
		const slot = paletteIndexOf(explicit);
		if (columnId != null && slot >= 0 && !map()[columnId]) map()[columnId] = { slot };
		return explicit;
	}
	if (columnId == null) return getPaletteColor(fallbackIndex);

	const existing = colourForColumn(columnId);
	if (existing) return existing;

	// Next unused SLOT, so two columns claimed at the same list length do not
	// collide. Bounded by the palette length: past that, slots necessarily repeat
	// (getPaletteColor wraps), and looping further would spin without finding one.
	const taken = takenSlots();
	const size = Math.max(1, (appState.appColours ?? []).length);
	let slot = ((fallbackIndex % size) + size) % size;
	for (let i = 0; i < size && taken.has(slot); i++) slot = (slot + 1) % size;
	map()[columnId] = { slot };
	return getPaletteColor(slot);
}

/** Forget a column's pinned colour (column deleted). */
export function releaseSeriesColour(columnId) {
	if (core.seriesColours) delete core.seriesColours[columnId];
}

/**
 * What every pinned column resolves to right now: `{ [columnId]: hex }`.
 *
 * Taken BEFORE a palette change so `repaintPinnedSeries` can tell which series
 * colours were following the palette and which the user had overridden.
 */
export function pinnedColourSnapshot() {
	const out = {};
	for (const colId of Object.keys(map())) {
		const hex = colourForColumn(colId);
		if (hex) out[colId] = hex;
	}
	return out;
}

/**
 * Push a palette change through to the series already drawn.
 *
 * Needed because a series' `colour` is resolved once, at construction, into its own
 * `$state`. Making the map slot-based fixes what a NEW series resolves to but
 * cannot reach the ones already standing, so switching palette would still appear
 * to do nothing to the current figures.
 *
 * `before` (from pinnedColourSnapshot, taken pre-change) is the discriminator: a
 * series whose colour still equals its column's old pinned colour was following the
 * palette, so it is updated. A series holding anything else was deliberately
 * overridden and is left alone. Without that check this would overwrite hand-picked
 * colours on every palette switch.
 *
 * @param {Record<string, string>} before
 * @returns {number} how many series were repainted
 */
export function repaintPinnedSeries(before) {
	if (!before) return 0;
	let n = 0;
	for (const plot of core.plots ?? []) {
		for (const datum of plot?.plot?.data ?? []) {
			const colId = seriesColumnId(datum);
			if (colId == null) continue;
			const was = before[colId];
			if (!was) continue;
			const now = colourForColumn(colId);
			if (!now || now === was) continue;
			for (const key of SERIES_STYLE_KEYS) {
				const style = datum[key];
				if (style && style.colour === was) {
					style.colour = now;
					n++;
				}
				// Box fill tracks the stroke, so move it together or a repainted box keeps
				// its old fill.
				if (style && style.fillColour === was) {
					style.fillColour = now;
					n++;
				}
			}
		}
	}
	return n;
}
