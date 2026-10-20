// @ts-check
// The colour-by HOST contract and the helpers every host shares (colour-by plan 2026-10-20,
// sections 3.2, 3.5 and 3.8; phase 1b: Scatterplot points).
//
// A host is a plot's inner data object (Scatterplotclass today; Q-Q, Mean +/- SEM and
// Circular phase in phase 2). It declares what it can encode and gives each series two
// fields, so the canvas, the panel, save/load, facets and the colour bar find everything
// through one shape:
//
//   static encodingCapabilities = { colour: true, lines: false }  // per plot class
//   series.colourBy        Column wrapper (the wired colour column), or null while off
//   series.colourEncoding  ColourEncodingClass (Encoding.svelte), or null while off
//   series.enableColourBy() / series.disableColourBy()
//
// The colour column is a series CHANNEL (core/seriesChannelRefs.js, field `colourBy`, not
// primary, no passthrough), so the data hash, column delete, ref remapping, copy/paste and
// the facet projection already reach it. Its canvas port is a NAMED port, `enc<id>_colour`,
// where `id` is the encoding's own stable number (like an overlay's), so the positional
// x<n>/ys<n> storage rule (plots/portVsStorageFields.test.js) is untouched.
//
// Pure: no Svelte, no core. The host passes in what it knows.

import { isCyclicMode, encodingModesFor } from './encodings.js';
import {
	DEFAULT_COLORMAP,
	DEFAULT_CYCLIC_COLORMAP,
	isCyclicColormap,
	monochromeColormap,
	COLORMAPS
} from './colormaps.js';

/** The encoding channels a series can carry, and the word each port ends in. */
export const ENCODING_CHANNELS = Object.freeze(['colour']);

const ENCODING_PORT_RE = /^enc(\d+)_(colour)$/;

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

/** The series of `inner` whose colour encoding is switched on, in data order. */
export function colourEncodedSeries(inner) {
	return (inner?.data ?? []).filter((dp) => dp?.colourEncoding && dp?.colourBy);
}

/**
 * The series an encoding port belongs to: `{ datum, channel, encoding }`, or null when the
 * name is not an encoding port, or no series of this inner has that encoding switched on.
 */
export function resolveEncodingPort(inner, portName) {
	const parsed = parseEncodingPort(portName);
	if (!parsed) return null;
	const datum = colourEncodedSeries(inner).find((dp) => dp.colourEncoding.id === parsed.id);
	return datum ? { datum, channel: parsed.channel, encoding: datum.colourEncoding } : null;
}

/** The next free encoding id on a plot (1 for the first). */
export function nextEncodingId(inner) {
	let max = 0;
	for (const dp of inner?.data ?? []) {
		const id = dp?.colourEncoding?.id;
		if (typeof id === 'number' && id > max) max = id;
	}
	return max + 1;
}

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
 * Where the colour bar goes and what room it takes (plan 3.8), in px relative to the plot
 * area's top-left corner. Pure, so "never overlaps the legend" is tested on numbers.
 *
 * - 'right' (beside the plot, the default): in the right margin, past a right axis. Below
 *   the series legend when the legend is outside too (they stack; the wider one sets the
 *   room taken). Its length is capped to the height left under the legend.
 * - an inside corner: the corner, inset like the legend presets. When the series legend sits
 *   in the SAME corner (a fixed preset), the bar moves past it (under a top legend, above a
 *   bottom one). An 'auto' legend never lands on it: the host passes the bar's rectangle to
 *   the legend as an obstacle (`colourKeyObstacle`).
 * - 'custom': the fractions, over the same inset area the legend's custom placement uses.
 *
 * @param {object} o
 * @param {string} o.position ColourScaleClass.position
 * @param {{width: number, height: number}} o.box the bar's footprint
 * @param {number} o.plotW the plot area as drawn
 * @param {number} o.plotH
 * @param {number} o.margin the legend inset (scaled to the view)
 * @param {boolean} [o.hasRightAxis]
 * @param {number} [o.paddingRight]
 * @param {{x: number, y: number, width: number, height: number, outside: boolean, corner?: string|null}|null} [o.legend]
 *   the series legend as placed (null when hidden)
 * @param {{customX?: number, customY?: number}} [o.custom]
 * @param {number} [o.inset] the backdrop ColourScale draws round the key when it sits over the
 *   data (its `padding`): inside the plot the key is placed by its BACKDROP, so the backdrop
 *   keeps the same inset from the edges and from the legend as a legend box does
 * @returns {{x: number, y: number, maxLength: number}} x, y of the key itself (not its backdrop)
 */
export function placeColourKey({
	position,
	box,
	plotW,
	plotH,
	margin,
	hasRightAxis = false,
	paddingRight = 0,
	legend = null,
	custom = {},
	inset = 0
}) {
	if (position === 'right') {
		const x = plotW + (hasRightAxis ? paddingRight : 0) + margin;
		const y = legend?.outside ? legend.y + legend.height + margin : 0;
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
		legend,
		custom
	});
	return { x: p.x + inset, y: p.y + inset, maxLength: Math.max(0, p.maxLength - 2 * inset) };
}

/** placeColourKey's inside positions, for a backdrop of `width` x `height`. */
function placeBackdrop({ position, width, height, plotW, plotH, margin, legend, custom }) {
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
	let y = bottom ? plotH - height - margin : margin;
	let maxLength = plotH - 2 * margin;
	if (legend && !legend.outside && legend.corner === position) {
		if (bottom) {
			y = legend.y - height - margin;
			maxLength = Math.max(0, legend.y - 2 * margin);
		} else {
			y = legend.y + legend.height + margin;
			maxLength = Math.max(0, plotH - y - margin);
		}
	}
	return { x, y, maxLength };
}

/** The room a beside-the-plot colour bar takes from the plot area's width. */
export function colourKeyReserveW(boxWidth, margin, hasRightAxis = false) {
	return boxWidth > 0 ? boxWidth + margin + (hasRightAxis ? margin : 0) : 0;
}

/**
 * The colour bar as an obstacle for the 'auto' series legend: `[x0, y0, x1, y1]` over a
 * w x h plot area, or null when the bar is not inside the plot area. Same corner rule as
 * placeColourKey without a legend (the legend is what is being placed).
 */
export function colourKeyObstacle(position, box, w, h, margin, custom = {}, inset = 0) {
	if (!box || position === 'right') return null;
	const p = placeColourKey({ position, box, plotW: w, plotH: h, margin, custom, inset });
	return [p.x - inset, p.y - inset, p.x + box.width + inset, p.y + box.height + inset];
}
