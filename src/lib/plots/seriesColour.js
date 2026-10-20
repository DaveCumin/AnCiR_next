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
import { greyForIndex } from './seriesAppearance.js';

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

/**
 * The slot colourForCategory would claim for each label, in order, WITHOUT writing: a pinned
 * label keeps its pin; an unpinned one takes its fallback slot, or the next slot free of every
 * pin and of the slots claimed before it in this list. Pinning the same labels in the same
 * order (pinCategoryColours) writes exactly these, so a plot can draw the colours on its first
 * frame (a render must not write core, see state_unsafe_mutation above) and they do not change
 * when the pins land.
 *
 * @param {string[]} labels in the order they claim slots (first appearance, as the Boxplot)
 * @returns {Map<string, string>} label to colour
 */
export function proposedCategoryColours(labels) {
	const out = new Map();
	const taken = new Set();
	for (const entry of Object.values(catMap())) {
		const norm = normaliseEntry(entry);
		if (norm && norm.slot != null) taken.add(norm.slot);
	}
	const size = Math.max(1, (appState.appColours ?? []).length);
	labels.forEach((label, i) => {
		const key = String(label);
		const pinned = colourForCategoryLabel(key);
		if (pinned) {
			out.set(key, pinned);
			return;
		}
		let slot = ((i % size) + size) % size;
		for (let k = 0; k < size && taken.has(slot); k++) slot = (slot + 1) % size;
		taken.add(slot);
		out.set(key, getPaletteColor(slot));
	});
	return out;
}

/**
 * Pin each label's colour (colourForCategory), in the order given, so every figure drawing
 * the label afterwards reads the same colour. Writes core: call from an effect or an event
 * handler, never while rendering. Returns how many labels were newly pinned.
 * @param {string[]} labels in the order they claim slots
 */
export function pinCategoryColours(labels) {
	let n = 0;
	labels.forEach((label, i) => {
		if (colourForCategoryLabel(String(label))) return;
		colourForCategory(label, i);
		n++;
	});
	return n;
}

/**
 * Pin the colour of every category a plot draws through Colour by (Category mode), in each
 * series' first-appearance order, so the next figure to draw the label (a box plot, another
 * coloured plot) reads the same colour. Called from the app shell's effect beside
 * pinAllSeriesAppearance; idempotent, so it settles. Returns how many labels were pinned.
 * @param {any[]} plots core.plots
 */
export function pinAllCategoryColours(plots) {
	let n = 0;
	for (const plot of plots ?? []) {
		for (const d of plot?.plot?.data ?? []) {
			const order = d?.colourCategoryPinOrder ?? null;
			if (order) n += pinCategoryColours(order);
		}
	}
	return n;
}

/**
 * How many categories Colour by can colour (decision 4): one per palette colour, so no two
 * categories ever share a colour. Beyond it the panel refuses rather than colouring some.
 */
export function categoryCap() {
	return Math.max(1, (appState.appColours ?? []).length);
}

/**
 * The colour of each category as a plot draws it: `categories` in the Boxplot's order (the
 * key's order), each its session colour (pinned, else proposedCategoryColours over
 * `firstSeen`). Monochrome draws evenly spaced greys by place in that order, exactly as a
 * monochrome Boxplot draws its boxes (Box.svelte: greyForIndex(index, count)).
 * @param {string[]} categories the Boxplot's order
 * @param {string[]} firstSeen the order they claim palette slots in
 * @param {boolean} [monochrome]
 * @returns {string[]} one colour per category
 */
export function categoryPalette(categories, firstSeen, monochrome = false) {
	if (monochrome) return categories.map((_, i) => greyForIndex(i, categories.length));
	const colours = proposedCategoryColours(firstSeen);
	return categories.map((c) => colours.get(String(c)) ?? getPaletteColor(0));
}

/**
 * Record a colour the USER chose for a category.
 *
 * Stored through `normaliseEntry`, so a hex that is in the current palette is kept as a
 * SLOT (it follows a palette switch, like an auto-assigned colour) and anything else is
 * locked as a hex. Returns whether anything was written; an unusable value writes
 * nothing rather than corrupting the map.
 */
export function setCategoryColour(label, colour) {
	const norm = normaliseEntry(colour);
	if (!norm) return false;
	catMap()[String(label)] = norm;
	return true;
}

/**
 * The category labels a plot draws with per-category colours, or [] when it does not.
 *
 * This is the panel-side statement of the `useCategoryColour` condition in
 * plots/Boxplot/Boxplot.svelte: category colouring applies to a BOXPLOT with exactly
 * one series whose x column carries data spanning more than one category. With several
 * series, colour distinguishes the series (each series row already has its own picker)
 * and this answers []. Monochrome figures draw greys per category, so a colour control
 * would be a lie there and it answers [] too.
 *
 * Pure over the wrapper so it is testable without a browser.
 *
 * @param {{type?: string, style?: any, plot?: any}} plotWrapper a wrapper Plot
 * @returns {string[]}
 */
export function categoryColourLabels(plotWrapper) {
	if (plotWrapper?.style?.monochrome === true) return [];
	if (plotWrapper?.type !== 'boxplot') return colourByCategoryLabels(plotWrapper?.plot);
	const inner = plotWrapper.plot;
	const data = inner?.data;
	if (!Array.isArray(data) || data.length !== 1) return [];
	const labels = inner.uniqueXValues ?? [];
	if (labels.length <= 1) return [];
	const xData = data[0]?.x?.getData?.() ?? [];
	if (xData.length === 0) return [];
	return labels.map(String);
}

/**
 * The categories a plot colours its marks by (Colour by, Category mode), in key order, over
 * every series doing so and not refused (too many categories); [] for none. The same session
 * colours as a Boxplot's boxes, so the same pickers edit them.
 * @param {any} inner a plot's inner (its `data` series built on EncodedSeries)
 * @returns {string[]}
 */
export function colourByCategoryLabels(inner) {
	const out = [];
	const seen = new Set();
	for (const d of inner?.data ?? []) {
		const cats = d?.colourCategoryShown ?? null;
		if (!cats) continue;
		for (const c of cats) {
			if (seen.has(c)) continue;
			seen.add(c);
			out.push(c);
		}
	}
	return out;
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
