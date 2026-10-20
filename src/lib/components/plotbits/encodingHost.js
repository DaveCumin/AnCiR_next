// @ts-check
// The encoding HOST contract and the helpers every host shares (colour-by plan 2026-10-20,
// sections 3.2, 3.5, 3.7 and 3.8; colour by in phases 1 and 2, size by in phase 3).
//
// A host is a plot's inner data object (Scatterplot, Q-Q, Mean +/- SEM, Circular phase). It
// declares what it can encode and gives each series two fields per CHANNEL, so the canvas,
// the panel, save/load, facets and the keys find everything through one shape:
//
//   static encodingCapabilities = { colour: true, size: true, lines: false }  // per class
//   series.colourBy / series.sizeBy              Column wrappers (the wired columns), or null
//   series.colourEncoding / series.sizeEncoding  settings (Encoding.svelte), or null while off
//   series.enableColourBy() / disableColourBy() / enableSizeBy() / disableSizeBy()
//
// Each column is a series CHANNEL (core/seriesChannelRefs.js, fields `colourBy` and `sizeBy`,
// not primary, no passthrough), so the data hash, column delete, ref remapping, copy/paste
// and the facet projection already reach it. Its canvas port is a NAMED port,
// `enc<id>_<channel>`, where `id` is the encoding's own stable number (like an overlay's), so
// the positional x<n>/ys<n> storage rule (plots/portVsStorageFields.test.js) is untouched.
// ENCODING_FIELDS maps a channel to its two fields; every helper here takes the channel.
//
// Pure: no Svelte, no core. The host passes in what it knows.

import {
	isCyclicMode,
	encodingModesFor,
	sizeModesFor,
	sizeRadius,
	domainPosition
} from './encodings.js';
import {
	DEFAULT_COLORMAP,
	DEFAULT_CYCLIC_COLORMAP,
	isCyclicColormap,
	monochromeColormap,
	COLORMAPS
} from './colormaps.js';

/**
 * The encoding channels a series can carry, and the word each port ends in. Each channel is
 * two series fields, both null while it is off: the wired column (a Column wrapper, a
 * seriesChannelRefs channel) and its settings (ColourEncodingClass / SizeEncodingClass in
 * Encoding.svelte). Everything below takes the channel as a parameter, so colour and size
 * share one implementation of ports, ids and wiring.
 */
export const ENCODING_CHANNELS = Object.freeze(['colour', 'size']);

/** The series fields of each channel: its column wrapper and its settings. */
export const ENCODING_FIELDS = Object.freeze({
	colour: Object.freeze({ column: 'colourBy', encoding: 'colourEncoding' }),
	size: Object.freeze({ column: 'sizeBy', encoding: 'sizeEncoding' })
});

const ENCODING_PORT_RE = /^enc(\d+)_(colour|size)$/;

/** `enc<id>_<channel>`: the canvas input port of one series' encoding. */
export function encodingPortName(id, channel = 'colour') {
	return `enc${id}_${channel}`;
}

/** `{ id, channel }` of an encoding port name, or null for any other port. */
export function parseEncodingPort(portName) {
	const m = ENCODING_PORT_RE.exec(portName ?? '');
	return m ? { id: Number(m[1]), channel: m[2] } : null;
}

/** Whether a plot's inner (its class) can colour its series by a column. */
export function supportsColourBy(inner) {
	return inner?.constructor?.encodingCapabilities?.colour === true;
}

/** Whether a plot's inner (its class) can size its series' points by a column. */
export function supportsSizeBy(inner) {
	return inner?.constructor?.encodingCapabilities?.size === true;
}

/** The settings of one channel of a series (null while off). */
export function seriesEncoding(dp, channel = 'colour') {
	const f = ENCODING_FIELDS[channel];
	return f ? (dp?.[f.encoding] ?? null) : null;
}

/** The column wrapper of one channel of a series (null while off). */
export function seriesEncodingColumn(dp, channel = 'colour') {
	const f = ENCODING_FIELDS[channel];
	return f ? (dp?.[f.column] ?? null) : null;
}

/** The series of `inner` whose `channel` encoding is switched on, in data order. */
export function encodedSeries(inner, channel = 'colour') {
	return (inner?.data ?? []).filter(
		(dp) => seriesEncoding(dp, channel) && seriesEncodingColumn(dp, channel)
	);
}

/** The series of `inner` whose colour encoding is switched on, in data order. */
export function colourEncodedSeries(inner) {
	return encodedSeries(inner, 'colour');
}

/**
 * The series an encoding port belongs to: `{ datum, channel, encoding, column }` (column: the
 * channel's Column wrapper), or null when the name is not an encoding port, or no series of
 * this inner has that channel switched on with that id.
 */
export function resolveEncodingPort(inner, portName) {
	const parsed = parseEncodingPort(portName);
	if (!parsed) return null;
	const { channel } = parsed;
	const datum = encodedSeries(inner, channel).find(
		(dp) => seriesEncoding(dp, channel).id === parsed.id
	);
	return datum
		? {
				datum,
				channel,
				encoding: seriesEncoding(datum, channel),
				column: seriesEncodingColumn(datum, channel)
			}
		: null;
}

/**
 * The id a new `channel` encoding of `datum` takes: the series' other encoding's id when no
 * series of the plot uses it on this channel (so one series' colour and size ports read
 * `enc3_colour` and `enc3_size`), else the next free id on the channel (1 for the first).
 */
export function nextEncodingId(inner, channel = 'colour', datum = null) {
	const used = new Set(
		(inner?.data ?? []).map((dp) => seriesEncoding(dp, channel)?.id).filter((id) => id != null)
	);
	for (const other of ENCODING_CHANNELS) {
		if (other === channel) continue;
		const id = seriesEncoding(datum, other)?.id;
		if (Number.isInteger(id) && id > 0 && !used.has(id)) return id;
	}
	let max = 0;
	for (const id of used) if (typeof id === 'number' && id > max) max = id;
	return max + 1;
}

/**
 * The series legend swatch of a series coloured by a column (plan 3.8), and the size key's
 * reference circles: a neutral mid grey. Figure ink, not interface chrome, so a literal rather
 * than a CSS token: a saved SVG or PNG cannot resolve var(--…) outside the app.
 */
export const COLOUR_BY_SWATCH = 'rgb(140, 140, 140)';

/** The stored mode that means "pick for the column" (time: hour of day; number: value). */
export const AUTO = 'auto';

/**
 * The mode a series is coloured by: the stored one when the column offers it, else the
 * column's natural mode (hour of day for a time column, the value for anything else).
 * @param {string|null|undefined} stored
 * @param {{type?: string, originTime_ms?: number|null}|null|undefined} column
 */
export function effectiveColourMode(stored, column) {
	const offered = encodingModesFor(column ?? {}).map((m) => m.mode);
	if (stored && stored !== AUTO && offered.includes(stored)) return stored;
	return column?.type === 'time' ? 'hourOfDay' : offered[0];
}

/**
 * The mode a series is SIZED by: the stored one when the column offers it for size (never
 * Hour of day, plan 3.7), else the column's natural one (days since start for a time column,
 * the value for anything else).
 * @param {string|null|undefined} stored
 * @param {{type?: string, originTime_ms?: number|null}|null|undefined} column
 */
export function effectiveSizeMode(stored, column) {
	const offered = sizeModesFor(column ?? {}).map((m) => m.mode);
	if (stored && stored !== AUTO && offered.includes(stored)) return stored;
	return column?.type === 'time' ? 'daysSinceStart' : offered[0];
}

/**
 * The colormap a series draws with. A stored map is used when it suits the mode (a cyclic map
 * for Hour of day, a non-cyclic one otherwise); else the mode's default. Monochrome swaps it
 * for its grey twin (COLORMAP_META.monochrome): resolved at draw time rather than written
 * into the series, so turning monochrome off needs no memory and a saved file keeps the
 * user's map (plan 3.9, the fifth monochrome branch).
 * @param {string|null|undefined} stored
 * @param {string} mode an effective mode
 * @param {boolean} [monochrome]
 */
export function effectiveColormap(stored, mode, monochrome = false) {
	const cyclic = isCyclicMode(mode);
	let map = cyclic ? DEFAULT_CYCLIC_COLORMAP : DEFAULT_COLORMAP;
	if (stored && stored !== AUTO && COLORMAPS[stored] && isCyclicColormap(stored) === cyclic) {
		map = stored;
	}
	return monochrome ? monochromeColormap(map) : map;
}

/** How a zone reads on a colour bar: 'UTC', or the IANA name. */
export function zoneLabel(zone) {
	return !zone || zone === 'utc' ? 'UTC' : String(zone);
}

/**
 * The colour bar's title: what the colours mean (decision 7: the zone is named).
 * @param {string} mode an effective mode
 * @param {{columnName?: string, zone?: string, wrapped?: boolean}} [o]
 */
export function colourBarTitle(mode, { columnName = '', zone = 'utc', wrapped = false } = {}) {
	if (mode === 'hourOfDay')
		return wrapped ? 'Hours since start, wrapped at 24 h' : `Hour of day (${zoneLabel(zone)})`;
	if (mode === 'dayOfYear') return `Day of year (${zoneLabel(zone)})`;
	if (mode === 'daysSinceStart') return 'Days since start';
	return columnName || 'Value';
}

/** A colour value as the tooltip and the colour bar print it. */
export function formatColourValue(v, mode) {
	if (!Number.isFinite(v)) return 'no value';
	if (mode === 'hourOfDay') {
		const totalMin = Math.round(v * 60) % (24 * 60);
		const h = Math.floor(totalMin / 60);
		const m = totalMin % 60;
		return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
	}
	if (mode === 'dayOfYear') return String(Math.round(v));
	if (v === 0) return '0';
	return String(Number(v.toPrecision(3)));
}

/**
 * The colour bar's ticks, `{ t, label }` with t in [0, 1] along the bar. Hour of day reads
 * 0, 6, 12, 18 and 24 (the ends share a colour, so 0 = 24 shows); otherwise both ends and the
 * middle, from the domain actually drawn. A manual end is marked: values beyond it clamp to
 * the end colour, so the end label says "<=" or ">=".
 * @param {{lo: number, hi: number, cyclic?: boolean}} domain
 * @param {string} mode
 * @param {{manualLo?: boolean, manualHi?: boolean}} [o]
 */
export function colourBarTicks(domain, mode, { manualLo = false, manualHi = false } = {}) {
	if (domain?.cyclic) {
		return [0, 6, 12, 18, 24].map((h) => ({ t: h / 24, label: String(h) }));
	}
	const lo = Number(domain?.lo);
	const hi = Number(domain?.hi);
	if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
	const fmt = (v) => formatColourValue(v, mode);
	if (lo === hi) return [{ t: 0.5, label: fmt(lo) }];
	return [
		{ t: 0, label: (manualLo ? '≤ ' : '') + fmt(lo) },
		{ t: 0.5, label: fmt((lo + hi) / 2) },
		{ t: 1, label: (manualHi ? '≥ ' : '') + fmt(hi) }
	];
}

/**
 * The size key's entries (plan 3.7): reference circles at both ends of the range and its
 * middle, low first, each `{ value, r, label }` with the radius the scale draws that value at.
 * A manual end is marked as the colour bar marks it (values beyond it clamp to the end size).
 * A one-value range has one entry.
 * @param {{lo: number, hi: number}} domain
 * @param {string} mode an effective (size) mode
 * @param {{rMin: number, rMax: number, manualLo?: boolean, manualHi?: boolean}} o
 */
export function sizeKeyItems(domain, mode, { rMin, rMax, manualLo = false, manualHi = false }) {
	const lo = Number(domain?.lo);
	const hi = Number(domain?.hi);
	if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
	const fmt = (v) => formatColourValue(v, mode);
	const at = (v) => sizeRadius(domainPosition(v, domain), rMin, rMax);
	if (lo === hi) return [{ value: lo, r: at(lo), label: fmt(lo) }];
	const mid = (lo + hi) / 2;
	return [
		{ value: lo, r: at(lo), label: (manualLo ? '≤ ' : '') + fmt(lo) },
		{ value: mid, r: at(mid), label: fmt(mid) },
		{ value: hi, r: at(hi), label: (manualHi ? '≥ ' : '') + fmt(hi) }
	];
}

/**
 * @typedef {object} PlacedBox a key already placed, for the next one to keep clear of
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 * @property {boolean} outside in the right margin (the series legend outside, or a key
 *   'right')
 * @property {string|null} [corner] the inside corner it sits in, null for custom
 */

/**
 * Where a key goes (the colour bar, the size key) and what room it takes (plan 3.8), in px
 * relative to the plot area's top-left corner. Pure, so "never overlaps" is tested on
 * numbers. The keys stack in reading order: the series legend, the colour bar, the size key.
 * `stack` lists the boxes placed before this one.
 *
 * - 'right' (beside the plot, the default): in the right margin, past a right axis, below
 *   every box already in the right margin (they stack; the widest sets the room taken). Its
 *   room is the height left below them.
 * - an inside corner: the corner, inset like the legend presets. Boxes in the SAME corner
 *   push it along (under them in a top corner, above them in a bottom one); a box at the
 *   other end that it would run into caps its room (`maxLength`), so a column of keys that can
 *   shrink (an automatic colour bar) stops short of them. An 'auto' legend
 *   never lands on a key: the host passes the keys' rectangles to the legend as obstacles
 *   (`keyObstacle`).
 * - 'custom': the fractions, over the same inset area the legend's custom placement uses.
 *
 * @param {object} o
 * @param {string} o.position ColourScaleClass.position / SizeScaleClass.position
 * @param {{width: number, height: number}} o.box the key's footprint
 * @param {number} o.plotW the plot area as drawn
 * @param {number} o.plotH
 * @param {number} o.margin the legend inset (scaled to the view)
 * @param {boolean} [o.hasRightAxis]
 * @param {number} [o.paddingRight]
 * @param {PlacedBox[]} [o.stack] the boxes placed before this one (hidden ones left out)
 * @param {{customX?: number, customY?: number}} [o.custom]
 * @param {number} [o.inset] the backdrop the key draws round itself when it sits over the
 *   data (its `padding`): inside the plot the key is placed by its BACKDROP, so the backdrop
 *   keeps the same inset from the edges and from the other boxes as a legend box does
 * @returns {{x: number, y: number, maxLength: number}} x, y of the key itself (not its
 *   backdrop); maxLength the height (vertical room) left for it
 */
export function placeKey({
	position,
	box,
	plotW,
	plotH,
	margin,
	hasRightAxis = false,
	paddingRight = 0,
	stack = [],
	custom = {},
	inset = 0
}) {
	if (position === 'right') {
		const x = plotW + (hasRightAxis ? paddingRight : 0) + margin;
		let y = 0;
		for (const b of stack) if (b?.outside) y = Math.max(y, b.y + b.height + margin);
		return { x, y, maxLength: Math.max(0, plotH - y) };
	}
	// Inside: place the backdrop, then step in to the key.
	const p = placeBackdrop({
		position,
		width: box.width + 2 * inset,
		height: box.height + 2 * inset,
		plotW,
		plotH,
		margin,
		stack,
		custom
	});
	return { x: p.x + inset, y: p.y + inset, maxLength: Math.max(0, p.maxLength - 2 * inset) };
}

/**
 * placeKey for the colour bar, with the series legend as the one box before it.
 * @param {Parameters<typeof placeKey>[0] & {legend?: PlacedBox|null}} o
 */
export function placeColourKey({ legend = null, ...o }) {
	return placeKey({ ...o, stack: legend ? [legend] : [] });
}

/**
 * A key placed BESIDE the box before it rather than after it in its column: the colour bar and
 * the size key sharing a place go side by side when a column of both would squeeze an
 * automatic bar under its comfortable length (EncodingKeyLayout.sizeBeside). Beside the plot
 * and in a left corner it goes on the box's right; in a right corner on its left (into the
 * plot, away from the edge). Level with the box's top, or its bottom in a bottom corner.
 * @param {object} o
 * @param {string} o.position the shared position ('right' or a corner)
 * @param {{width: number, height: number}} o.box the key's footprint
 * @param {{x: number, y: number, width: number, height: number}} o.beside the box before it,
 *   its backdrop included
 * @param {number} o.margin the gap between them
 * @param {number} [o.inset] this key's backdrop (its padding), 0 beside the plot
 * @returns {{x: number, y: number}} the key itself (not its backdrop), plot-area px
 */
export function placeBeside({ position, box, beside, margin, inset = 0 }) {
	const w = box.width + 2 * inset;
	const h = box.height + 2 * inset;
	const toLeft = position === 'topright' || position === 'bottomright';
	const bottom = position === 'bottomright' || position === 'bottomleft';
	const x = toLeft ? beside.x - margin - w : beside.x + beside.width + margin;
	const y = bottom ? beside.y + beside.height - h : beside.y;
	return { x: x + inset, y: y + inset };
}

/** placeKey's inside positions, for a backdrop of `width` x `height`. */
function placeBackdrop({ position, width, height, plotW, plotH, margin, stack, custom }) {
	if (position === 'custom') {
		const fx = Math.min(1, Math.max(0, custom.customX ?? 0));
		const fy = Math.min(1, Math.max(0, custom.customY ?? 0));
		const spanX = Math.max(0, plotW - width - margin * 2);
		const spanY = Math.max(0, plotH - height - margin * 2);
		return { x: margin + spanX * fx, y: margin + spanY * fy, maxLength: plotH - 2 * margin };
	}
	const left = position === 'topleft' || position === 'bottomleft';
	const bottom = position === 'bottomright' || position === 'bottomleft';
	const x = left ? margin : plotW - width - margin;
	const inside = (stack ?? []).filter((b) => b && !b.outside);
	// The boxes this one stacks after (its corner), and those it must stop short of: a box in
	// a corner at the other end (top / bottom) that it would run into (they share some x), so a
	// tall column of keys never reaches the far corner's box.
	const same = inside.filter((b) => b.corner === position);
	const far = inside.filter(
		(b) =>
			b.corner && b.corner.startsWith('bottom') !== bottom && b.x < x + width && x < b.x + b.width
	);
	let y;
	let maxLength;
	if (bottom) {
		const floor = same.length ? Math.min(...same.map((b) => b.y)) - margin : plotH - margin;
		const ceiling = far.length ? Math.max(...far.map((b) => b.y + b.height)) + margin : margin;
		y = floor - height;
		maxLength = Math.max(0, floor - ceiling);
	} else {
		y = same.length ? Math.max(...same.map((b) => b.y + b.height)) + margin : margin;
		const floor = far.length ? Math.min(...far.map((b) => b.y)) - margin : plotH - margin;
		maxLength = Math.max(0, floor - y);
	}
	return { x, y, maxLength };
}

/** The room a beside-the-plot colour bar takes from the plot area's width. */
export function colourKeyReserveW(boxWidth, margin, hasRightAxis = false) {
	return boxWidth > 0 ? boxWidth + margin + (hasRightAxis ? margin : 0) : 0;
}

/**
 * A key as an obstacle for the 'auto' series legend: `[x0, y0, x1, y1]` over a w x h plot
 * area, or null when the key is not inside the plot area. Same corner rule as placeKey with
 * the keys before it (`stack`) but no legend (the legend is what is being placed).
 */
export function keyObstacle(position, box, w, h, margin, custom = {}, inset = 0, stack = []) {
	if (!box || position === 'right') return null;
	const p = placeKey({ position, box, plotW: w, plotH: h, margin, custom, inset, stack });
	return [p.x - inset, p.y - inset, p.x + box.width + inset, p.y + box.height + inset];
}

/** The colour bar as an obstacle (keyObstacle with nothing before it). */
export function colourKeyObstacle(position, box, w, h, margin, custom = {}, inset = 0) {
	return keyObstacle(position, box, w, h, margin, custom, inset);
}
