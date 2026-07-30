// The appearance identity map: one record per column, for the whole session.
//
// WHAT THIS REPLACES
//
// Three separate maps shipped in v72.1 — core.seriesColours ({slot}|{hex}),
// core.seriesShapes (string) and core.seriesDashes (string) — all keyed on the same
// column id. Merged into one record because they are one fact about the data: "this
// hive is a red triangle with a dashed line". Three maps meant three migrations,
// three lookups, and no single thing to show a user in an editor.
//
// Per-CHANNEL records (a separate colour for points and line) were considered and
// rejected. "This hive is red" is one fact about the data; "on this figure the fill
// is lighter than the stroke" is a styling choice about the figure, and belongs on
// the series as an override, not here.
//
// PRECEDENCE, resolved at READ time
//
//   1. a per-series override — what the user set on that figure; always wins
//   2. this map's record for the column — the house style for that data
//   3. the next unused index — unique within the session, and RECORDED here
//
// WHY READ TIME, NOT CONSTRUCTION
//
// Colour used to be resolved in the PointsClass constructor. A series is built with
// `y.refId === -1` and the column is wired AFTERWARDS (Scatterplot.svelte:64-77), so
// the column was unknown at exactly the moment it was needed: the positional
// fallback was used and nothing was ever pinned. On the normal interactive path the
// whole feature was inert, which is what a user reported — adding a column to a
// second plot gave it the first palette colour rather than the colour it already had.
//
// Resolving on read makes wiring order irrelevant, which is the actual fix. Patching
// the places a column can change would mean nine plots plus rewiring, Column Set
// expansion and facet children, and "one site gets missed" has already caused four
// defects in this work.
//
// WHERE PINNING HAPPENS
//
// NOT here, and never from a getter. Writing to `core` during a read that a template
// reached is `state_unsafe_mutation` (the trap already hit with categoryColours), so
// `pinAppearance` is called from a single effect outside the render path. Until it
// runs, a read falls back to level 3, which is stable and correct — just not yet
// shared.
//
// Spec: docs/superpowers/specs/2026-07-30-figure-style-system-design.md (Revision)
import { core, appState } from '$lib/core/core.svelte';
import { getPaletteColor } from '$lib/components/inputs/ColourPicker.svelte';
import { POINT_SHAPES } from '$lib/components/plotbits/pointShapes.js';
import { STROKE_STYLES } from '$lib/components/plotbits/Line.svelte';

/**
 * Dash patterns, in claim order. Solid is FIRST so the first series in a figure
 * keeps the appearance it had before markers were varied.
 */
export const DASH_ORDER = STROKE_STYLES;

/**
 * The v72.1 dash vocabulary → this one.
 *
 * That list ('', '6 3', '2 2', '8 3 2 3', '1 3') shared no entry with the dash values the
 * Line control offers, so it is being retired. Sessions saved against it must not silently
 * lose their dashes on load, so translate to the nearest equivalent instead of dropping
 * anything the new list does not contain.
 */
const LEGACY_DASH = {
	'': 'solid',
	'6 3': '5, 5',
	'2 2': '2, 2',
	'8 3 2 3': '5, 2',
	'1 3': '2, 2'
};

/** A dash in this build's vocabulary, translating a v72.1 value, or null. */
export function canonicalDash(dash) {
	if (typeof dash !== 'string') return null;
	if (DASH_ORDER.includes(dash)) return dash;
	return LEGACY_DASH[dash] ?? null;
}

export function appearanceMap() {
	return (core.seriesAppearance ??= {});
}

/** Index of a colour in the active palette, or -1. Case-insensitive. */
export function paletteIndexOf(hex) {
	const palette = appState.appColours ?? [];
	const want = String(hex).toLowerCase();
	return palette.findIndex((c) => String(c).toLowerCase() === want);
}

/**
 * Coerce one stored record into the canonical shape, or null if unusable.
 *
 * Accepts the three legacy forms as well, so a v72.1 session loads: a bare hex
 * string, `{ slot }` and `{ hex }` all came from `seriesColours`.
 */
/**
 * Whether a stored string is plausibly a colour.
 *
 * The legacy form was a bare hex string, so `normaliseRecord` accepts strings — but
 * it accepted ANY non-empty one, which turned a corrupt or hand-edited value into
 * `{ colour: { hex: 'nope' } }` and then painted a series with it. 3/4/6/8 hex digits
 * covers the palettes (some carry an alpha pair) plus rgb()/rgba() and named colours
 * the ColourPicker can emit.
 */
function looksLikeColour(v) {
	if (typeof v !== 'string' || !v) return false;
	if (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return true;
	return /^(rgb|hsl)a?\(/i.test(v);
}

export function normaliseRecord(entry) {
	if (typeof entry === 'string' && looksLikeColour(entry)) {
		const slot = paletteIndexOf(entry);
		return slot >= 0 ? { colour: { slot } } : { colour: { hex: entry } };
	}
	if (!entry || typeof entry !== 'object') return null;

	const out = {};
	// A record may legitimately carry only a shape (markers varied, colour still
	// auto), so an unusable colour is dropped rather than failing the whole record.
	const c = entry.colour ?? entry;
	if (Number.isInteger(c?.slot) && c.slot >= 0) out.colour = { slot: c.slot };
	else if (looksLikeColour(c?.hex)) out.colour = { hex: c.hex };

	if (typeof entry.shape === 'string' && POINT_SHAPES.includes(entry.shape)) {
		out.shape = entry.shape;
	}
	const dash = canonicalDash(entry.dash);
	if (dash) out.dash = dash;
	// `edited` marks a record the user set in the editor. Auto-assignment must never
	// overwrite one, so it has to survive a round trip.
	if (entry.edited === true) out.edited = true;

	return Object.keys(out).length > 0 ? out : null;
}

/**
 * Fold the three v72.1 maps into one.
 *
 * @param {any} appearance an already-merged map (newer sessions)
 * @param {any} colours    legacy core.seriesColours
 * @param {any} shapes     legacy core.seriesShapes
 * @param {any} dashes     legacy core.seriesDashes
 */
export function migrateAppearanceMaps(appearance, colours, shapes, dashes) {
	/** @type {Record<string, any>} */
	const out = {};
	const put = (colId, patch) => {
		const key = String(colId);
		out[key] = { ...(out[key] ?? {}), ...patch };
	};

	for (const [colId, entry] of Object.entries(appearance ?? {})) {
		const norm = normaliseRecord(entry);
		if (norm) put(colId, norm);
	}
	// Legacy maps only fill gaps: an already-merged record is newer and wins.
	for (const [colId, entry] of Object.entries(colours ?? {})) {
		if (out[String(colId)]?.colour) continue;
		const norm = normaliseRecord(entry);
		if (norm?.colour) put(colId, { colour: norm.colour });
	}
	for (const [colId, shape] of Object.entries(shapes ?? {})) {
		if (out[String(colId)]?.shape) continue;
		if (typeof shape === 'string' && POINT_SHAPES.includes(shape)) put(colId, { shape });
	}
	for (const [colId, dash] of Object.entries(dashes ?? {})) {
		if (out[String(colId)]?.dash) continue;
		const canonical = canonicalDash(dash);
		if (canonical) put(colId, { dash: canonical });
	}
	return out;
}

/** The record for a column, or null. */
export function recordFor(columnId) {
	if (columnId == null) return null;
	return normaliseRecord(appearanceMap()[String(columnId)]);
}

/** The colour a column resolves to right now, or null when it has no record. */
export function mappedColour(columnId) {
	const c = recordFor(columnId)?.colour;
	if (!c) return null;
	return c.hex ?? getPaletteColor(c.slot);
}

/** The mapped marker shape / dash, or null. */
export function mappedShape(columnId) {
	return recordFor(columnId)?.shape ?? null;
}
export function mappedDash(columnId) {
	return recordFor(columnId)?.dash ?? null;
}

/** Pick the next value from `order` that no record has claimed yet. */
function nextUnclaimed(order, claimed, startIndex) {
	const size = Math.max(1, order.length);
	let i = ((startIndex % size) + size) % size;
	for (let n = 0; n < size && claimed.has(order[i]); n++) i = (i + 1) % size;
	return order[i];
}

function claimedSlots() {
	const taken = new Set();
	for (const entry of Object.values(appearanceMap())) {
		const slot = normaliseRecord(entry)?.colour?.slot;
		if (slot != null) taken.add(slot);
	}
	return taken;
}

function claimedOf(field, order) {
	const taken = new Set();
	for (const entry of Object.values(appearanceMap())) {
		const v = normaliseRecord(entry)?.[field];
		if (v != null && order.includes(v)) taken.add(v);
	}
	return taken;
}

/**
 * LEVEL 3, recorded. Claim whatever this column still lacks.
 *
 * Idempotent, and never called from a render: see the header note. `edited` records
 * are left completely alone.
 *
 * @param {number} columnId
 * @param {number} fallbackIndex position among the series, only a starting point
 * @returns {boolean} whether anything was written
 */
export function pinAppearance(columnId, fallbackIndex = 0) {
	if (columnId == null) return false;
	const key = String(columnId);
	const map = appearanceMap();
	const current = normaliseRecord(map[key]) ?? {};
	if (current.edited) return false;

	const next = { ...current };
	let changed = false;

	if (!next.colour) {
		const palette = appState.appColours ?? [];
		const size = Math.max(1, palette.length);
		const taken = claimedSlots();
		let slot = ((fallbackIndex % size) + size) % size;
		for (let n = 0; n < size && taken.has(slot); n++) slot = (slot + 1) % size;
		next.colour = { slot };
		changed = true;
	}
	if (next.shape == null) {
		next.shape = nextUnclaimed(POINT_SHAPES, claimedOf('shape', POINT_SHAPES), fallbackIndex);
		changed = true;
	}
	// `== null`, not falsy: the solid dash IS the empty string, so a truthiness check
	// treats an already-pinned solid line as unpinned and re-claims it on every pass,
	// which makes pinning non-idempotent and thrashes the map from a repeating effect.
	if (next.dash == null) {
		next.dash = nextUnclaimed(DASH_ORDER, claimedOf('dash', DASH_ORDER), fallbackIndex);
		changed = true;
	}
	if (changed) map[key] = next;
	return changed;
}

/** Record a value the USER chose in the editor. Never re-derived afterwards. */
export function setEditedAppearance(columnId, patch) {
	if (columnId == null) return false;
	const key = String(columnId);
	const map = appearanceMap();
	const merged = normaliseRecord({ ...(normaliseRecord(map[key]) ?? {}), ...patch });
	if (!merged) return false;
	map[key] = { ...merged, edited: true };
	return true;
}

/** Forget a column entirely (column deleted, or the user reset its row). */
export function releaseAppearance(columnId) {
	if (core.seriesAppearance) delete core.seriesAppearance[String(columnId)];
}

/**
 * LEVEL 1 → 2 → 3 for colour, without recording anything.
 *
 * Safe to call from a getter reached during render, which is the point.
 *
 * @param explicit      a per-series override, or null/undefined for auto
 * @param columnId      from the series' wired y column; null when not wired yet
 * @param fallbackIndex position among the series
 */
export function resolveColour(explicit, columnId, fallbackIndex = 0) {
	if (explicit) return explicit;
	return mappedColour(columnId) ?? getPaletteColor(fallbackIndex);
}

/** LEVEL 1 → 2 → default, for marker shape. */
export function resolveShape(explicit, columnId, varyMarkers = false) {
	if (typeof explicit === 'string' && POINT_SHAPES.includes(explicit)) return explicit;
	if (!varyMarkers) return 'circle';
	return mappedShape(columnId) ?? 'circle';
}

/** LEVEL 1 → 2 → default, for line dash. */
export function resolveDash(explicit, columnId, varyMarkers = false) {
	if (typeof explicit === 'string' && explicit !== '' && explicit !== 'solid') return explicit;
	if (!varyMarkers) return 'solid';
	return mappedDash(columnId) ?? 'solid';
}

/**
 * Pin every wired-but-unpinned column across all figures.
 *
 * Called from ONE `$effect` in the app shell, never from a render. Pure over its
 * argument and idempotent, so a repeating effect settles instead of thrashing.
 *
 * @param {Array<any>} plots core.plots
 * @returns {number} how many columns were newly pinned
 */
export function pinAllSeriesAppearance(plots) {
	let n = 0;
	for (const plot of plots ?? []) {
		const data = plot?.plot?.data;
		if (!Array.isArray(data)) continue;
		data.forEach((datum, i) => {
			const ref = datum?.y?.refId ?? datum?.column?.refId ?? null;
			if (typeof ref !== 'number' || ref < 0) return;
			if (pinAppearance(ref, i)) n++;
		});
	}
	return n;
}

/**
 * Drop every per-series colour override, so all figures fall back to the map.
 *
 * This is what "apply the defaults to all" MEANS for colour, and it is why the
 * action had to be split in two. Typography is a COPY (the template's values are
 * written into each figure); colour is a CLEAR (each figure stops overriding and
 * reveals the shared source of truth). One button cannot do both without lying
 * about one of them.
 *
 * Only possible now that colour resolves at read time: setting the override to null
 * is enough, because the getter then falls through to the map. Before, clearing it
 * would have left the series with no colour at all.
 *
 * Shape and dash are untouched: they still resolve imperatively through
 * applyFigureAppearance, which already derives them from the figure's flags rather
 * than storing an override.
 *
 * @param {Array<any>} plots core.plots
 * @returns {number} how many overrides were dropped
 */
export function clearSeriesColourOverrides(plots) {
	let n = 0;
	for (const plot of plots ?? []) {
		const data = plot?.plot?.data;
		if (!Array.isArray(data)) continue;
		for (const datum of data) {
			if (!datum || typeof datum !== 'object') continue;
			const targets = [];
			if ('colour' in datum) targets.push(datum);
			for (const v of Object.values(datum)) {
				if (v && typeof v === 'object' && !Array.isArray(v) && 'colour' in v) targets.push(v);
			}
			for (const t of targets) {
				// The setter writes the private override; reading back tells us whether the
				// resolved colour actually came from an override or already from the map.
				const before = t.colour;
				t.colour = null;
				if (t.colour !== before) n++;
			}
		}
	}
	return n;
}

/** Human-readable labels for the dash patterns, parallel to DASH_ORDER. */
export const DASH_LABELS = ['Solid', 'Dashed', 'Dotted', 'Dash-dot'];

/**
 * The rows the appearance editor shows: one per column that has a record.
 *
 * After the pinning effect has run, that is every plotted column — which is what
 * makes the editor a view of "the data this session draws" rather than a list of
 * every column that has ever existed.
 *
 * Pure over its arguments so it can be tested without a session: `nameFor` is
 * injected rather than reaching for getColumnById.
 *
 * @param {Record<string, any>} map core.seriesAppearance
 * @param {(id: number) => string} nameFor
 */
export function appearanceRows(map, nameFor) {
	const rows = [];
	for (const key of Object.keys(map ?? {})) {
		const record = normaliseRecord(map[key]);
		if (!record) continue;
		const id = Number(key);
		rows.push({
			columnId: id,
			// A column can be deleted while its record lingers; showing the id keeps the
			// row identifiable and resettable instead of blank.
			name: nameFor(id) || `column ${key}`,
			colour: record.colour?.hex ?? null,
			slot: record.colour?.slot ?? null,
			shape: record.shape ?? 'circle',
			dash: record.dash ?? '',
			edited: record.edited === true
		});
	}
	return rows.sort((a, b) => a.name.localeCompare(b.name));
}
