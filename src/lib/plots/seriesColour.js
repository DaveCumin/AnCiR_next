// CATEGORY colours: one colour per category LABEL, for the whole session.
//
// The column half of this file is gone. Per-COLUMN identity — colour, marker shape and
// dash — now lives in one merged record in plots/appearanceIdentity.js
// (core.seriesAppearance), which replaced the three parallel maps this file used to own.
//
// What is left is the case that map structurally cannot express. A boxplot's boxes come
// from unique VALUES of an x column, and one y column split across three categories is ONE
// series — so a column-keyed map resolves all three boxes to a single colour and there is no
// way to say "control is always grey, treatment always red". There is no column per category
// to key on: here the label genuinely IS the identity.
//
// Deliberately NOT applied when a plot has several series. There, colour distinguishes the
// series and x position distinguishes the category, which is the standard reading of a
// grouped boxplot; recolouring per category would destroy that. The caller decides (see
// `useCategoryColour` in Box.svelte).
//
// `seriesColumnId` also lives here: it answers "which column is this series bound to", which
// every appearance lookup needs and neither map owns.
import { core, appState } from '$lib/core/core.svelte';
import { getPaletteColor } from '$lib/components/inputs/ColourPicker.svelte';

/** Column id a plot series is bound to, or null when it is not wired yet. */
export function seriesColumnId(parent) {
	// Points/Line/Box hang off a per-series Dataclass carrying `.y`; a few plots
	// (Histogram, CircularPhase) bind a single `.column` instead.
	const ref = parent?.y?.refId ?? parent?.column?.refId ?? null;
	return typeof ref === 'number' && ref >= 0 ? ref : null;
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

function catMap() {
	return (core.categoryColours ??= {});
}

/** Migrate/normalise a saved category map: drop anything unusable, keep {slot}|{hex}. */
export function migrateCategoryColourMap(saved) {
	const out = {};
	if (!saved || typeof saved !== 'object') return out;
	for (const [label, entry] of Object.entries(saved)) {
		const norm = normaliseEntry(entry);
		if (norm) out[label] = norm;
	}
	return out;
}

/** The colour a pinned category currently resolves to, or null when unpinned. */
export function colourForCategoryLabel(label) {
	const entry = normaliseEntry(catMap()[String(label)]);
	if (!entry) return null;
	return entry.hex ?? getPaletteColor(entry.slot);
}

/**
 * The colour this category should use, pinning a slot on first sight.
 *
 * @param {any} label the category value, as it appears in the x column
 * @param {number} fallbackIndex position among the categories, used only to pick a
 *   starting slot; the pin is what makes it stable afterwards
 */
export function colourForCategory(label, fallbackIndex = 0) {
	const key = String(label);
	const existing = colourForCategoryLabel(key);
	if (existing) return existing;

	const taken = new Set();
	for (const entry of Object.values(catMap())) {
		const norm = normaliseEntry(entry);
		if (norm && norm.slot != null) taken.add(norm.slot);
	}
	const size = Math.max(1, (appState.appColours ?? []).length);
	let slot = ((fallbackIndex % size) + size) % size;
	for (let i = 0; i < size && taken.has(slot); i++) slot = (slot + 1) % size;
	catMap()[key] = { slot };
	return getPaletteColor(slot);
}

/** Forget a pinned category colour. */
export function releaseCategoryColour(label) {
	if (core.categoryColours) delete core.categoryColours[String(label)];
}

/** What every pinned category resolves to right now: `{ [label]: hex }`. */
export function pinnedCategorySnapshot() {
	const out = {};
	for (const label of Object.keys(catMap())) {
		const hex = colourForCategoryLabel(label);
		if (hex) out[label] = hex;
	}
	return out;
}
