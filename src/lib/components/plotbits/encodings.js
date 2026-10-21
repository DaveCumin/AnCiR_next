// @ts-check
/**
 * Colour by: the pure, shared machinery (colour-by plan 2026-10-20, sections 3.2 to 3.5).
 *
 * Every plot that colours its marks by a column (Scatterplot first; Q-Q, Mean +/- SEM and
 * Circular phase later) goes through these functions, and the Python export ports them, so
 * the rules live once:
 *
 *   1. MODE: how a column's cells become the value that is coloured (`encodingValues`):
 *      the value itself, the hour of day or day of year of a time (in a zone), or days since
 *      the column's first time. A cell that is missing (stats.js isInvalidValue) or not a
 *      finite number gives NaN, "no value": the mark is still drawn, in the series colour.
 *   2. DOMAIN: the value range the colour scale spans (`encodingDomain`): all rows of every
 *      series it is given (so facet panels share one scale), with a manual override per end;
 *      Hour of day is fixed at [0, 24) and wraps.
 *   3. BUCKET: the position in the domain, t in [0, 1], becomes one of K = 64 colour buckets,
 *      `min(K - 1, floor(t * K))` (`bucketIndex`). A plot draws one path per bucket, and the
 *      Python export's ListedColormap of the same K colours indexes exactly the same way.
 *   4. COLOUR: bucket b takes the colormap at its centre, t = (b + 0.5) / K (`bucketColours`).
 *
 * The zone is an argument everywhere (the encoded column's clock zone, core/columnTimeZone.js
 * columnClock), so a colour bar and a clock-time acrophase never disagree: both call
 * clockHourOfDay.
 */
import { clockHourOfDay } from '$lib/utils/phaseReference.js';
import { isInvalidValue } from '$lib/utils/stats.js';
import { isMissingCategory } from '$lib/utils/chisquare.js';
import { wallClockDayjs } from '$lib/utils/time/zones.js';
import { colormapRGB } from './colormaps.js';

/** Colour buckets per scale (plan 3.5: no visible banding at 64; at most 64 paths). */
export const COLOUR_BUCKETS = 64;

/** The bucket index of a mark with no colour value (drawn in the series colour). */
export const NO_VALUE = -1;

const MS_PER_HOUR = 3600000;
const MS_PER_DAY = 86400000;
const HOURS_PER_DAY = 24;

/** The modes, in the order a control lists them. */
export const ENCODING_MODES = Object.freeze([
	'value',
	'hourOfDay',
	'dayOfYear',
	'daysSinceStart',
	'category'
]);

/** UI words for each mode (plan 3.3). */
export const ENCODING_MODE_LABELS = Object.freeze({
	value: 'Value',
	hourOfDay: 'Hour of day',
	dayOfYear: 'Day of year',
	daysSinceStart: 'Days since start',
	category: 'Category'
});

/** A mode whose values wrap (Hour of day, period 24 h): its domain is fixed and cyclic. */
export function isCyclicMode(mode) {
	return mode === 'hourOfDay';
}

/**
 * Category (colour-by plan v1.1): each distinct value is its own colour, the one the Boxplot
 * gives that category (core.categoryColours, plots/seriesColour.js). Colour only: a category
 * has no "bigger", so Size by never offers it.
 */
export function isCategoryMode(mode) {
	return mode === 'category';
}

/** The modes Size by can read a column as: neither cyclic nor categorical (plan 3.7). */
export const SIZE_ENCODING_MODES = Object.freeze(
	ENCODING_MODES.filter((m) => !isCyclicMode(m) && !isCategoryMode(m))
);

/** A column whose cells are labels (text or category), not numbers. */
export function isCategoricalColumn(column) {
	return column?.type === 'category' || column?.type === 'text';
}

/**
 * The epoch-ms clock of one cell, or NaN: a time column's own value, or a number / bin
 * column's hours from its time origin (`originTime_ms`), as Scatterplotclass.xOriginFor
 * places such a column on a time axis.
 */
function clockMs(v, type, originMs) {
	if (isInvalidValue(v)) return NaN;
	const n = Number(v);
	if (!Number.isFinite(n)) return NaN;
	if (type === 'time') return n;
	if (Number.isFinite(originMs)) return originMs + n * MS_PER_HOUR;
	return NaN;
}

/** A cell as a finite number, or NaN for no value. */
function finiteOrNaN(v) {
	if (isInvalidValue(v)) return NaN;
	const n = Number(v);
	return Number.isFinite(n) ? n : NaN;
}

/** True when the column has a clock: a time column, or hours from a time origin. */
function hasClock(type, originMs) {
	return type === 'time' || Number.isFinite(originMs);
}

/**
 * Day of year (1 to 366) of an instant in `zone` ('utc', a fixed offset or an IANA name), from the local
 * calendar date, so a time near midnight lands on the zone's day.
 */
export function dayOfYear(ms, zone = 'utc') {
	if (!Number.isFinite(ms)) return NaN;
	const dt = wallClockDayjs(ms, zone || 'utc');
	if (!dt.isValid()) return NaN;
	const y = dt.year();
	return Math.round((Date.UTC(y, dt.month(), dt.date()) - Date.UTC(y, 0, 1)) / MS_PER_DAY) + 1;
}

/**
 * The modes a column can be coloured by, each with a warning when the mode reads the column
 * in a way the user should know about.
 *
 * Category (v1.1): the only mode of a text or category column, and offered LAST for a number
 * column without a clock (numbers as labels: a colony or animal id, as the Boxplot already
 * reads a number x column). Never for a time or clock column (every instant would be its own
 * category). `{ categories: false }` leaves it out (Size by).
 * @param {{type?: string, originTime_ms?: number|null}} column
 * @param {{categories?: boolean}} [o]
 * @returns {{mode: string, warning: string|null}[]}
 */
export function encodingModesFor(column, { categories = true } = {}) {
	const type = column?.type;
	const origin = column?.originTime_ms ?? NaN;
	if (categories && isCategoricalColumn(column)) return [{ mode: 'category', warning: null }];
	if (type === 'time') {
		return ['hourOfDay', 'dayOfYear', 'daysSinceStart'].map((mode) => ({ mode, warning: null }));
	}
	if (hasClock(type, origin)) {
		return ['value', 'hourOfDay', 'dayOfYear', 'daysSinceStart'].map((mode) => ({
			mode,
			warning: null
		}));
	}
	return [
		{ mode: 'value', warning: null },
		{ mode: 'hourOfDay', warning: WRAPPED_HOURS_WARNING },
		{ mode: 'daysSinceStart', warning: null },
		...(categories ? [{ mode: 'category', warning: null }] : [])
	];
}

/** Hour of day of a number column with no time origin (plan 3.3). */
export const WRAPPED_HOURS_WARNING =
	'This column has no clock time, so hour of day is its hours since start, wrapped at 24 h.';

/** Day of year needs a date. */
export const NO_DATE_WARNING = 'Day of year needs a time column (or hours from a time origin).';

/**
 * The value each row is coloured by. Row-aligned with `values`; NaN is "no value".
 *
 * - value: the cell as a number.
 * - hourOfDay: clockHourOfDay(ms, zone) in [0, 24). A number column without a time origin
 *   has no clock, so its hours since start are wrapped at 24 (with a warning).
 * - dayOfYear: day of year (1 to 366) in `zone`; NaN everywhere (with a warning) without a
 *   clock.
 * - daysSinceStart: days after the column's earliest valid value. A number column (and a
 *   bin column) counts hours, the app's unit for a numeric time axis.
 * - category: the cell's LABEL, `String(v)` as the Boxplot keys a category, or null for a
 *   missing cell (isMissingCategory); these values are strings, not numbers.
 *
 * @param {string} mode one of ENCODING_MODES
 * @param {ArrayLike<any>} values the column's cells
 * @param {{type?: string, originTime_ms?: number|null, zone?: string}} [opts]
 * @returns {{values: any[], warning: string|null}}
 */
export function encodingValues(mode, values, opts = {}) {
	const type = opts.type ?? 'number';
	const origin = opts.originTime_ms ?? NaN;
	const zone = opts.zone ?? 'utc';
	const n = values?.length ?? 0;
	const out = new Array(n);
	let warning = null;

	if (mode === 'category') {
		for (let i = 0; i < n; i++) out[i] = categoryLabel(values[i]);
		return { values: out, warning };
	}

	if (mode === 'hourOfDay') {
		if (hasClock(type, origin)) {
			for (let i = 0; i < n; i++) out[i] = clockHourOfDay(clockMs(values[i], type, origin), zone);
		} else {
			warning = WRAPPED_HOURS_WARNING;
			for (let i = 0; i < n; i++) {
				const h = finiteOrNaN(values[i]);
				out[i] = Number.isFinite(h) ? ((h % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY : NaN;
			}
		}
		return { values: out, warning };
	}

	if (mode === 'dayOfYear') {
		if (!hasClock(type, origin)) return { values: out.fill(NaN), warning: NO_DATE_WARNING };
		for (let i = 0; i < n; i++) out[i] = dayOfYear(clockMs(values[i], type, origin), zone);
		return { values: out, warning };
	}

	if (mode === 'daysSinceStart') {
		const perDay = type === 'time' ? MS_PER_DAY : HOURS_PER_DAY;
		let first = Infinity;
		for (let i = 0; i < n; i++) {
			const v = finiteOrNaN(values[i]);
			out[i] = v;
			if (v < first) first = v;
		}
		for (let i = 0; i < n; i++) out[i] = Number.isFinite(out[i]) ? (out[i] - first) / perDay : NaN;
		return { values: out, warning };
	}

	for (let i = 0; i < n; i++) out[i] = finiteOrNaN(values[i]);
	return { values: out, warning };
}

/**
 * The range a colour scale spans (plan 3.5, decision 8).
 *
 * Cyclic (Hour of day): fixed [0, 24), period 24; a manual range is ignored, since a partial
 * clock would break the wrap. Otherwise: the finite minimum and maximum over EVERY array
 * given (pass all series, or all facet panels, to share one scale), with `domainIN`
 * overriding either end when it holds a finite number (null leaves that end automatic).
 *
 * Category: the categories (categoryDomain); a manual range does not apply.
 *
 * @param {ArrayLike<any>[]} valueArrays encoded values (from encodingValues)
 * @param {{mode?: string, domainIN?: (number|null|undefined)[]|null}} [opts]
 * @returns {{lo: number, hi: number, cyclic: boolean, period: number|null, categories?: string[], firstSeen?: string[]}}
 */
export function encodingDomain(valueArrays, opts = {}) {
	if (isCategoryMode(opts.mode)) return categoryDomain(valueArrays);
	if (isCyclicMode(opts.mode))
		return { lo: 0, hi: HOURS_PER_DAY, cyclic: true, period: HOURS_PER_DAY };
	let lo = Infinity;
	let hi = -Infinity;
	for (const arr of valueArrays ?? []) {
		const n = arr?.length ?? 0;
		for (let i = 0; i < n; i++) {
			const v = arr[i];
			if (!Number.isFinite(v)) continue;
			if (v < lo) lo = v;
			if (v > hi) hi = v;
		}
	}
	const manual = opts.domainIN ?? [];
	if (manual[0] != null && Number.isFinite(Number(manual[0]))) lo = Number(manual[0]);
	if (manual[1] != null && Number.isFinite(Number(manual[1]))) hi = Number(manual[1]);
	if (!Number.isFinite(lo) || !Number.isFinite(hi))
		return { lo: NaN, hi: NaN, cyclic: false, period: null };
	return { lo, hi, cyclic: false, period: null };
}

/**
 * Where a value sits in a domain, t in [0, 1], or NaN for no value. A cyclic domain wraps
 * (24 h is 0 h); otherwise values outside the range clamp to its ends. A degenerate range
 * (lo = hi) puts every value at 0, as normaliseTo01 does for the heatmaps. A manual range
 * given high-to-low reverses the scale.
 * @param {number} v
 * @param {{lo: number, hi: number, cyclic?: boolean, period?: number|null}} domain
 */
export function domainPosition(v, domain) {
	if (!Number.isFinite(v) || !domain) return NaN;
	const { lo, hi } = domain;
	if (!Number.isFinite(lo) || !Number.isFinite(hi)) return NaN;
	if (domain.cyclic) {
		const period = domain.period ?? hi - lo;
		if (!(period > 0)) return NaN;
		const u = (v - lo) / period;
		return u - Math.floor(u);
	}
	const span = hi - lo;
	if (span === 0) return 0;
	const t = (v - lo) / span;
	return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * The bucket of a position: `min(K - 1, floor(t * K))`, or NO_VALUE when t is not a
 * number. t is clamped to [0, 1] first, so t = 1 is the top bucket.
 * @param {number} t
 * @param {number} [K]
 */
export function bucketIndex(t, K = COLOUR_BUCKETS) {
	if (!Number.isFinite(t)) return NO_VALUE;
	const u = t < 0 ? 0 : t > 1 ? 1 : t;
	return Math.min(K - 1, Math.floor(u * K));
}

/**
 * The bucket of every row (NO_VALUE where the row has no value).
 * @param {ArrayLike<number>} values encoded values
 * @param {{lo: number, hi: number, cyclic?: boolean, period?: number|null}} domain
 * @param {number} [K]
 * @returns {Int16Array}
 */
export function colourBuckets(values, domain, K = COLOUR_BUCKETS) {
	const n = values?.length ?? 0;
	const out = new Int16Array(n);
	for (let i = 0; i < n; i++) out[i] = bucketIndex(domainPosition(values[i], domain), K);
	return out;
}

/**
 * The K bucket colours of a colormap: bucket b is the map at its centre, (b + 0.5) / K.
 * @param {string} colormap
 * @param {number} [K]
 * @returns {string[]} `rgb(r, g, b)` strings
 */
export function bucketColours(colormap, K = COLOUR_BUCKETS) {
	return Array.from({ length: K }, (_, b) => colormapRGB(colormap, (b + 0.5) / K));
}

// ---- Category (colour-by plan v1.1) ----------------------------------------------------
//
// A category is its LABEL (String of the cell), exactly as the Boxplot keys its boxes, so a
// label has one colour everywhere: core.categoryColours (plots/seriesColour.js). The colours
// themselves are resolved there (categoryPalette); these rules are pure.

/** A cell's category label, or null for a missing one (blank, null, NaN: isMissingCategory). */
export function categoryLabel(v) {
	return isMissingCategory(v) ? null : String(v);
}

/**
 * The order the Boxplot lists categories in (Boxplotclass.uniqueXValues): numerically when
 * both labels read as numbers, else by localeCompare.
 * @param {string} a
 * @param {string} b
 */
export function compareCategories(a, b) {
	const sa = String(a);
	const sb = String(b);
	if (!isNaN(+sa) && !isNaN(+sb)) return +sa - +sb;
	return sa.localeCompare(sb);
}

/**
 * The categories a colour scale spans: every label of every array (pass all series, or all
 * facet panels, so they share one key), `categories` in the Boxplot's order (the key and the
 * monochrome greys), `firstSeen` in order of first appearance (the order a label claims a
 * palette slot in, as the Boxplot claims them: plots/seriesColour.js colourForCategory).
 * @param {ArrayLike<any>[]} labelArrays encoded labels (null: no value)
 */
export function categoryDomain(labelArrays) {
	const seen = new Set();
	const firstSeen = [];
	for (const arr of labelArrays ?? []) {
		const n = arr?.length ?? 0;
		for (let i = 0; i < n; i++) {
			const v = arr[i];
			if (v == null || seen.has(v)) continue;
			seen.add(v);
			firstSeen.push(v);
		}
	}
	const categories = firstSeen.slice().sort(compareCategories);
	return { lo: NaN, hi: NaN, cyclic: false, period: null, categories, firstSeen };
}

/**
 * The category index of every mark (its place in `categories`), or NO_VALUE where it has no
 * label (or a label outside the list).
 * @param {ArrayLike<any>} labels
 * @param {string[]} categories
 * @returns {Int16Array}
 */
export function categoryIndices(labels, categories) {
	const at = new Map(categories.map((c, i) => [c, i]));
	const n = labels?.length ?? 0;
	const out = new Int16Array(n);
	for (let i = 0; i < n; i++) {
		const v = labels[i];
		out[i] = v != null && at.has(v) ? /** @type {number} */ (at.get(v)) : NO_VALUE;
	}
	return out;
}

/**
 * The category of a GROUP of rows (Mean +/- SEM): the label every row with a label shares, or
 * null when no row has one. A group whose rows carry DIFFERENT labels is `mixed`: its mean is
 * of no single category, so it is drawn as "no value" (in the series colour) and counted.
 * @param {ArrayLike<any>} labels
 * @returns {{label: string|null, mixed: boolean}}
 */
export function groupCategory(labels) {
	let label = null;
	for (let i = 0; i < (labels?.length ?? 0); i++) {
		const v = labels[i];
		if (v == null) continue;
		if (label == null) label = v;
		else if (v !== label) return { label: null, mixed: true };
	}
	return { label, mixed: false };
}

/**
 * The circular mean of values on a cycle of `period` (hours of day: 24), in [0, period), or
 * NaN when there is no value or the values cancel out (no mean direction). 23:00 and 01:00
 * average to 00:00, not 12:00.
 * @param {ArrayLike<number>} values
 * @param {number} [period]
 */
export function circularMean(values, period = HOURS_PER_DAY) {
	let s = 0;
	let c = 0;
	let n = 0;
	for (let i = 0; i < (values?.length ?? 0); i++) {
		const v = values[i];
		if (!Number.isFinite(v)) continue;
		const a = (2 * Math.PI * v) / period;
		s += Math.sin(a);
		c += Math.cos(a);
		n++;
	}
	if (n === 0 || Math.hypot(s, c) / n < 1e-12) return NaN;
	const m = (Math.atan2(s, c) * period) / (2 * Math.PI);
	const wrapped = ((m % period) + period) % period;
	// atan2 of a tiny negative angle wraps to just under the period; read that as 0.
	return period - wrapped < 1e-9 ? 0 : wrapped;
}

/**
 * The encoded value of a group of rows (plan 3.12, for plots that draw one mark per group):
 * the circular mean for a cyclic mode, the shared label for Category (null when the rows are
 * mixed or unlabelled: groupCategory), else the arithmetic mean; NaN when no row has a value.
 * @param {ArrayLike<number>} values the group's encoded values
 * @param {string} mode
 */
export function groupEncodingValue(values, mode) {
	if (isCategoryMode(mode)) return groupCategory(values).label;
	if (isCyclicMode(mode)) return circularMean(values, HOURS_PER_DAY);
	let sum = 0;
	let n = 0;
	for (let i = 0; i < (values?.length ?? 0); i++) {
		const v = values[i];
		if (!Number.isFinite(v)) continue;
		sum += v;
		n++;
	}
	return n ? sum / n : NaN;
}

// ---- Size by (colour-by plan 2026-10-20, section 3.7; phase 3) --------------------------
//
// The same mode, domain and bucket rules as colour, with an AREA-proportional scale: between
// a smallest and a largest point radius the marker's AREA is linear in the value, so a value
// twice as far along the range covers twice the extra ink, and large values are not
// exaggerated (plan 3.14). The radius stays EXACT per mark; the S = 8 size buckets ("layers")
// exist only to order drawing, largest first, so small points are not hidden under big ones.

/** Size layers per scale (drawing order only; plan 3.7). */
export const SIZE_BUCKETS = 8;

/** The default smallest and largest point radius, px (plan 3.7). */
export const DEFAULT_MIN_RADIUS = 2;
export const DEFAULT_MAX_RADIUS = 10;

/** No point is drawn smaller than this radius, px: it stays visible and hoverable. */
export const MIN_RADIUS_FLOOR = 1;

/**
 * The modes a column can be SIZED by: the colour modes without Hour of day. A cyclic
 * quantity has no "bigger": 23:59 must not be drawn largest beside a smallest 00:00.
 * @param {{type?: string, originTime_ms?: number|null}} column
 * @returns {{mode: string, warning: string|null}[]}
 */
export function sizeModesFor(column) {
	return encodingModesFor(column, { categories: false }).filter((m) => !isCyclicMode(m.mode));
}

/**
 * A size range as drawn: both ends finite and at least MIN_RADIUS_FLOOR. A range given
 * large-to-small is kept (it reverses the scale, as a reversed manual value range does).
 * @param {number|null|undefined} rMin
 * @param {number|null|undefined} rMax
 * @returns {{rMin: number, rMax: number}}
 */
export function sizeRange(rMin, rMax) {
	const lo = Number.isFinite(Number(rMin)) && rMin != null ? Number(rMin) : DEFAULT_MIN_RADIUS;
	const hi = Number.isFinite(Number(rMax)) && rMax != null ? Number(rMax) : DEFAULT_MAX_RADIUS;
	return { rMin: Math.max(MIN_RADIUS_FLOOR, lo), rMax: Math.max(MIN_RADIUS_FLOOR, hi) };
}

/**
 * The radius at position t in [0, 1] (clamped): r = sqrt(rMin^2 + t (rMax^2 - rMin^2)), so
 * t = 0.5 is the AREA midpoint, not the radius midpoint. NaN for no position.
 * @param {number} t
 * @param {number} rMin
 * @param {number} rMax
 */
export function sizeRadius(t, rMin, rMax) {
	if (!Number.isFinite(t)) return NaN;
	const u = t < 0 ? 0 : t > 1 ? 1 : t;
	return Math.sqrt(rMin * rMin + u * (rMax * rMax - rMin * rMin));
}

/**
 * The drawing layer of a radius: its AREA position between the smallest and largest radius
 * drawn (lo, hi: whichever way round), cut into S layers. A radius outside clamps (a "no
 * value" mark at the series' own size can be smaller or larger than the range).
 * @param {number} r
 * @param {number} lo the smallest radius of the range
 * @param {number} hi the largest
 * @param {number} [S]
 */
export function sizeLayer(r, lo, hi, S = SIZE_BUCKETS) {
	const span = hi * hi - lo * lo;
	if (!Number.isFinite(r) || !(span > 0)) return 0;
	return bucketIndex((r * r - lo * lo) / span, S);
}

/**
 * The radius and drawing layer of every mark (plan 3.7). A mark with no size value is drawn
 * at the series' own point size (`fallback`).
 * @param {ArrayLike<number>} values encoded values (encodingValues), one per mark
 * @param {{lo: number, hi: number, cyclic?: boolean, period?: number|null}} domain
 * @param {{rMin: number, rMax: number, fallback: number, S?: number}} o
 * @returns {{r: Float64Array, layer: Int8Array, noValueLayer: number}}
 */
export function sizeRadii(values, domain, { rMin, rMax, fallback, S = SIZE_BUCKETS }) {
	const n = values?.length ?? 0;
	const r = new Float64Array(n);
	const layer = new Int8Array(n);
	const lo = Math.min(rMin, rMax);
	const hi = Math.max(rMin, rMax);
	const noValueLayer = sizeLayer(fallback, lo, hi, S);
	for (let i = 0; i < n; i++) {
		const ri = sizeRadius(domainPosition(values[i], domain), rMin, rMax);
		if (Number.isFinite(ri)) {
			r[i] = ri;
			layer[i] = sizeLayer(ri, lo, hi, S);
		} else {
			r[i] = fallback;
			layer[i] = noValueLayer;
		}
	}
	return { r, layer, noValueLayer };
}
