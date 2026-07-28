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
// PRECEDENCE, resolved once when a series is created
//
//   1. an explicit colour on the series — always wins, never auto-overwritten
//   2. the session map, if this column already has a colour
//   3. otherwise the next palette entry, PINNED to that column and recorded
//
// Steps 2-3 give "the first plot to draw a column claims a colour, every other
// plot drawing that column adopts it", with no user action.
//
// Assignment is pinned rather than positional on purpose: once colour carries
// identity, adding a series must not shift the colours of everything below it,
// which is exactly what an index into a palette does.
import { core } from '$lib/core/core.svelte';
import { getPaletteColor } from '$lib/components/inputs/ColourPicker.svelte';

/** Column id a plot series is bound to, or null when it is not wired yet. */
export function seriesColumnId(parent) {
	// Points/Line/Box hang off a per-series Dataclass carrying `.y`; a few plots
	// (Histogram, CircularPhase) bind a single `.column` instead.
	const ref = parent?.y?.refId ?? parent?.column?.refId ?? null;
	return typeof ref === 'number' && ref >= 0 ? ref : null;
}

/**
 * The colour this series should use.
 *
 * @param explicit     a colour already on the saved series (precedence 1)
 * @param columnId     from seriesColumnId(); null when the series is not wired
 * @param fallbackIndex positional index, used only when there is no column to key on
 */
export function colourForSeries(explicit, columnId, fallbackIndex = 0) {
	if (explicit) return explicit;
	if (columnId == null) return getPaletteColor(fallbackIndex);

	const map = (core.seriesColours ??= {});
	const existing = map[columnId];
	if (existing) return existing;

	// Next unused palette entry, so two columns claimed in the same session do not
	// collide just because they were created at the same list length.
	const taken = new Set(Object.values(map));
	let colour = getPaletteColor(fallbackIndex);
	for (let i = 0; i < 64 && taken.has(colour); i++) colour = getPaletteColor(fallbackIndex + i + 1);
	map[columnId] = colour;
	return colour;
}

/** Forget a column's pinned colour (column deleted). */
export function releaseSeriesColour(columnId) {
	if (core.seriesColours) delete core.seriesColours[columnId];
}
