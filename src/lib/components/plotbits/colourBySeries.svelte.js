// @ts-nocheck
// Colour by and Size by, the REACTIVE half every host shares (colour-by plan 2026-10-20,
// sections 3.2, 3.5, 3.7, 3.8 and 3.12; phase 2 moved it here from the Scatterplot so Q-Q,
// Mean +/- SEM and Circular phase run the same code; phase 3 added size as a second CHANNEL of
// the same machinery). The pure rules stay in encodings.js (mode, range, bucket, colour, size
// scale) and encodingHost.js (ports, mode and map choice, the keys' words and placement).
//
// Three pieces:
//
//   EncodingChannel   one channel ('colour' or 'size') of one series: whether it is on and
//                     wired, how the column is read (mode, clock origin, zone), the value of
//                     every MARK and the range they span. Written once, used by both channels.
//   EncodedSeries     a base class for a plot SERIES meeting the encoding host contract
//                     (encodingHost.js): the two channels' fields, and what each draws with
//                     (colour buckets and a palette; exact radii and drawing layers). A host
//                     overrides a few hooks to say what a MARK is (below); the rest is shared.
//   EncodingKeyLayout the plot-level keys: the colour bar and the size key, their saved
//                     settings (`colourScale`, `sizeScale`), what they show (the first series
//                     encoded on that channel), their geometry, and where they go, stacked
//                     with the series legend and clear of it.
//
// MARKS. The encoded values are per drawn MARK, in the order the host hands its marks to the
// renderer:
//   - Scatterplot, Circular phase: a mark is a row (identity).
//   - Q-Q: a mark is a sorted sample; `markRows` is the sort permutation, so each sample keeps
//     its own row's colour and size (plan 3.12).
//   - Mean +/- SEM: a mark is a group; its value is the group's summary of the column (the
//     mean; the circular mean for a colour by Hour of day), over exactly the rows the mean
//     used.
// A channel's range spans the marks' values over every series reading the same column the
// same way (and, on a faceted plot, every panel), so a colour or a size means the same thing
// everywhere.

import { Column as ColumnClass, getColumnById } from '$lib/core/Column.svelte';
import { isWiredRef } from '$lib/core/seriesChannelRefs.js';
import { displayNameById } from '$lib/core/columnLabels.js';
import { getDisplayZone } from '$lib/utils/time/displayTime.js';
import { resolveStyle } from '$lib/plots/figureStyle.js';
import { ColourEncodingClass, SizeEncodingClass } from './Encoding.svelte';
import { ColourScaleClass, colourScaleGeometry, autoBarLength } from './ColourScale.svelte';
import { SizeScaleClass, sizeKeyGeometry } from './SizeKey.svelte';
import {
	encodingValues,
	encodingDomain,
	colourBuckets,
	bucketColours,
	groupEncodingValue,
	sizeRange,
	sizeRadii,
	NO_VALUE,
	COLOUR_BUCKETS,
	SIZE_BUCKETS
} from './encodings.js';
import { colouredLineSegments } from './colouredLine.js';
import {
	ENCODING_FIELDS,
	ENCODING_CHANNELS,
	effectiveColourMode,
	effectiveSizeMode,
	effectiveColormap,
	colourBarTitle,
	colourBarTicks,
	formatColourValue,
	nextEncodingId,
	placeKey,
	sizeKeyItems,
	colourKeyReserveW,
	keyObstacle
} from './encodingHost.js';

// The series legend swatch of a coloured series and the size key's circles (encodingHost.js).
export { COLOUR_BY_SWATCH } from './encodingHost.js';

/**
 * A saved wrapper column reduced to what may go through Column.fromJSON: passing the saved
 * `type` / `name` / `originTime_ms` would overwrite the wrapper's $derived getters with
 * literals and sever its live view of the column (see ScatterDataclass.fromJSON).
 */
export function slimWrapper(json) {
	return json?.refId != null ? { id: json.id, refId: json.refId, processes: json.processes } : json;
}

function columnData(col) {
	return typeof col?.getData === 'function' ? (col.getData() ?? []) : [];
}

function finiteOrNull(v) {
	if (v == null) return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

/** What each channel reads a column as, and the settings class it saves. */
const CHANNEL_SPECS = {
	colour: { effectiveMode: effectiveColourMode, Settings: ColourEncodingClass, word: 'colour' },
	size: { effectiveMode: effectiveSizeMode, Settings: SizeEncodingClass, word: 'size' }
};

/**
 * One encoding channel of one series (plan 3.11: the pieces colour and size share). Reads
 * the series' channel fields (ENCODING_FIELDS) and the series' mark hooks.
 */
export class EncodingChannel {
	#series;
	#channel;
	#fields;
	#spec;

	constructor(series, channel) {
		this.#series = series;
		this.#channel = channel;
		this.#fields = ENCODING_FIELDS[channel];
		this.#spec = CHANNEL_SPECS[channel];
	}

	get channel() {
		return this.#channel;
	}
	/** The wired column wrapper (null while off). */
	get column() {
		return this.#series[this.#fields.column];
	}
	/** The settings (null while off). */
	get encoding() {
		return this.#series[this.#fields.encoding];
	}

	/** On AND wired to a column that exists: the marks are encoded. */
	active = $derived(
		!!this.encoding && isWiredRef(this.column?.refId) && getColumnById(this.column.refId) != null
	);
	// A number or bin column's time origin, so hour of day reads its clock (as an x axis does).
	origin = $derived(
		this.column && this.column.type !== 'time'
			? (this.#series.parentPlot?.resolveXOriginMs?.(this.column) ??
					finiteOrNull(this.column.originTime_ms))
			: null
	);
	mode = $derived(
		this.column
			? this.#spec.effectiveMode(this.encoding?.mode, {
					type: this.column.type,
					originTime_ms: this.origin
				})
			: null
	);
	/** The value each ROW is encoded by ({ values, warning }), or null while inactive. */
	encoded = $derived.by(() => {
		if (!this.active) return null;
		return encodingValues(this.mode, columnData(this.column), {
			type: this.column.type,
			originTime_ms: this.origin,
			zone: getDisplayZone()
		});
	});
	warning = $derived(this.encoded?.warning ?? null);
	/**
	 * The value of each MARK: the row's own (identity), the row a sorted mark came from, or
	 * the summary of a group's rows. A mark past the column's end has no value.
	 */
	markValues = $derived.by(() => {
		const enc = this.encoded;
		if (!enc) return null;
		const rowValues = enc.values;
		const groups = this.#series.markGroups;
		if (groups) {
			const mode = this.mode;
			return groups.map((rows) =>
				groupEncodingValue(
					rows.map((r) => (r < rowValues.length ? rowValues[r] : NaN)),
					mode
				)
			);
		}
		const rows = this.#series.markRows;
		if (rows) {
			const out = new Array(rows.length);
			for (let k = 0; k < rows.length; k++) {
				const r = rows[k];
				out[k] = r < rowValues.length ? rowValues[r] : NaN;
			}
			return out;
		}
		return rowValues;
	});
	/** The range over every series (and facet panel) sharing this column and mode. */
	autoDomain = $derived(
		this.active
			? encodingDomainFor(this.#series.parentPlot, this.#series, this.#channel, { manual: false })
			: null
	);
	domain = $derived(
		this.active ? encodingDomainFor(this.#series.parentPlot, this.#series, this.#channel) : null
	);
	/** The key's title: what the colours or sizes mean (the zone named for clock modes). */
	title = $derived(
		this.active
			? colourBarTitle(this.mode, {
					// As the user sees the column (a node output's label, "Binned: ambient temp").
					columnName: displayNameById(this.column.refId, ''),
					zone: getDisplayZone(),
					wrapped: !!this.warning && this.mode === 'hourOfDay'
				})
			: ''
	);

	/** Drawn marks whose value (`idx[k]` NO_VALUE, or past its end) is missing. */
	noValueCount(missing) {
		if (!this.active) return 0;
		const n = this.#series.markCount;
		const drawn = this.#series.markDrawnTest;
		let count = 0;
		for (let k = 0; k < n; k++) {
			if (drawn && !drawn(k)) continue;
			if (missing(k)) count++;
		}
		return count;
	}

	/** The column is shorter than the series: say how many rows it covers. */
	get lengthNote() {
		if (!this.active) return null;
		const nc = this.encoded.values.length;
		const n = this.#series.markRowCount;
		return nc < n
			? `The ${this.#spec.word} column has ${nc} rows and this series ${n}; the rest have no ${this.#spec.word} value.`
			: null;
	}

	/** Restore from saved series JSON: only when it was on (both halves present). */
	restore(json) {
		const f = this.#fields;
		if (json?.[f.encoding] && json?.[f.column]) {
			this.#series[f.column] = json[f.column];
			this.#series[f.encoding] = json[f.encoding];
		}
	}

	/** The fields a series saves, only while this channel is on. */
	toJSON() {
		const f = this.#fields;
		return this.encoding && this.column
			? { [f.column]: this.column, [f.encoding]: this.encoding.toJSON() }
			: {};
	}

	/** Switch on: an empty port appears on the canvas. `extra` seeds the settings. */
	enable(extra = {}) {
		if (this.encoding) return;
		const f = this.#fields;
		this.#series[f.column] = new ColumnClass({ refId: -1 });
		this.#series[f.encoding] = new this.#spec.Settings({
			id: nextEncodingId(this.#series.parentPlot, this.#channel, this.#series),
			...extra
		});
	}

	/** Switch off: the port and its wire go. */
	disable() {
		const f = this.#fields;
		this.#series[f.column] = null;
		this.#series[f.encoding] = null;
	}
}

/**
 * The base class of a series that can be coloured and sized by columns. Hooks a host may
 * override (all plain getters, read inside deriveds):
 *
 *   markRows          null (a mark is a row), or the source row of each mark
 *   markGroups        null, or the source rows of each mark (a mark summarises them)
 *   markRowCount      how many rows an encoding column should cover (the length note)
 *   markDrawnTest     null (every mark is drawn), or a test (k) => whether mark k is drawn
 *                     (for the "no value" counts); read once per count, so it should close
 *                     over plain locals rather than read state per mark
 *   markCount         how many marks there are (default: the colour or size values' length)
 *   drawsPoints       whether the series draws point marks (default points.draw)
 *   defaultRadius     the series' own point radius, px (what a point with no size value keeps)
 *   pointShape        the series' marker shape (the size key draws it)
 *   colourPointColour the series colour a "no value" point is drawn in
 *   colourLineXY      { x, y } the line is drawn through (mark-aligned), for its count
 *   markWords         ['point', 'points'], how the panel names a mark
 *   colourSummaryNote / sizeSummaryNote  a panel note on how a mark's value is made
 *                     (aggregated plots)
 *
 * The setters take saved JSON as well as instances: the panel's undo recorder writes changed
 * paths in place (plots/plotEdits.js setPlotFields), so switching an encoding on or off writes
 * `colourBy` / `colourEncoding` (or `sizeBy` / `sizeEncoding`) as JSON, and that must become
 * the classes again.
 */
export class EncodedSeries {
	#colourBy = $state(null);
	#colourEncoding = $state(null);
	#sizeBy = $state(null);
	#sizeEncoding = $state(null);
	get colourBy() {
		return this.#colourBy;
	}
	set colourBy(v) {
		this.#colourBy = asWrapper(v);
	}
	get colourEncoding() {
		return this.#colourEncoding;
	}
	set colourEncoding(v) {
		this.#colourEncoding =
			v == null ? null : v instanceof ColourEncodingClass ? v : ColourEncodingClass.fromJSON(v);
	}
	get sizeBy() {
		return this.#sizeBy;
	}
	set sizeBy(v) {
		this.#sizeBy = asWrapper(v);
	}
	get sizeEncoding() {
		return this.#sizeEncoding;
	}
	set sizeEncoding(v) {
		this.#sizeEncoding =
			v == null ? null : v instanceof SizeEncodingClass ? v : SizeEncodingClass.fromJSON(v);
	}

	#channels = {
		colour: new EncodingChannel(this, 'colour'),
		size: new EncodingChannel(this, 'size')
	};
	/** One channel's shared state (EncodingChannel). */
	encodingChannel(channel) {
		return this.#channels[channel] ?? null;
	}

	// ---- hooks (see the class comment) ----
	get markRows() {
		return null;
	}
	get markGroups() {
		return null;
	}
	get markRowCount() {
		return columnData(this.y ?? this.column).length;
	}
	get markDrawnTest() {
		return null;
	}
	get markCount() {
		return (this.colourMarkValues ?? this.sizeMarkValues)?.length ?? 0;
	}
	get drawsPoints() {
		return !!this.points?.draw;
	}
	get defaultRadius() {
		return this.points?.radius ?? 4;
	}
	get pointShape() {
		return this.points?.shape ?? 'circle';
	}
	get colourPointColour() {
		return this.points?.colour ?? this.colour;
	}
	get colourLineXY() {
		return { x: this.xData ?? [], y: this.yData ?? [] };
	}
	get markWords() {
		return ['point', 'points'];
	}
	get colourSummaryNote() {
		return null;
	}
	get sizeSummaryNote() {
		return null;
	}

	/** Restore both encodings from saved series JSON: each only when it was on. */
	restoreEncodings(json) {
		for (const ch of ENCODING_CHANNELS) this.#channels[ch].restore(json);
	}

	/** The fields a series saves, only while an encoding is on (a plain series saves as before). */
	encodingsJSON() {
		return { ...this.#channels.colour.toJSON(), ...this.#channels.size.toJSON() };
	}

	// ---- Colour by (the shared channel, then what colour draws with) ----
	get colourActive() {
		return this.#channels.colour.active;
	}
	get colourOrigin() {
		return this.#channels.colour.origin;
	}
	get colourMode() {
		return this.#channels.colour.mode;
	}
	get colourEncoded() {
		return this.#channels.colour.encoded;
	}
	get colourWarning() {
		return this.#channels.colour.warning;
	}
	get colourMarkValues() {
		return this.#channels.colour.markValues;
	}
	get colourAutoDomain() {
		return this.#channels.colour.autoDomain;
	}
	get colourDomain() {
		return this.#channels.colour.domain;
	}
	get colourTitle() {
		return this.#channels.colour.title;
	}
	get colourLengthNote() {
		return this.#channels.colour.lengthNote;
	}

	/** The colour bucket of each MARK (NO_VALUE where it has no value). */
	colourIdx = $derived(
		this.colourActive ? colourBuckets(this.colourMarkValues, this.colourDomain) : null
	);
	colourMonochrome = $derived(this.parentPlot?.parentBox?.style?.monochrome === true);
	/** The map as chosen (before monochrome), and the map drawn. */
	colourMapBase = $derived(
		this.colourMode ? effectiveColormap(this.colourEncoding?.colormap, this.colourMode) : null
	);
	colourMap = $derived(
		this.colourMode
			? effectiveColormap(this.colourEncoding?.colormap, this.colourMode, this.colourMonochrome)
			: null
	);
	colourPalette = $derived(this.colourMap ? bucketColours(this.colourMap) : null);
	/** Drawn marks with no colour value: drawn in the series colour. */
	colourNoValueCount = $derived.by(() => {
		if (!this.colourActive) return 0;
		const idx = this.colourIdx;
		return this.#channels.colour.noValueCount((k) => k >= idx.length || idx[k] === NO_VALUE);
	});
	/** What a point renderer draws with (Points' `colourBy` prop), or null for one path. */
	colourRender = $derived.by(() => {
		if (!this.colourActive || !this.drawsPoints) return null;
		return this.#colourSpec(this.colourPointColour);
	});
	/** Whether this series can colour its line (it draws one, and its plot colours lines). */
	get colourLineCapable() {
		return !!this.line?.draw && this.parentPlot?.constructor?.encodingCapabilities?.lines === true;
	}
	/**
	 * The LINE is coloured too (plan 3.6): Colour by is active, the line is drawn and the
	 * series' "Colour the line too" is on.
	 */
	colourLineActive = $derived(
		this.colourActive && this.colourLineCapable && this.colourEncoding?.colourLine === true
	);
	/** What Line draws with (its `colourBy` prop), or null for one line-coloured path. */
	colourLineRender = $derived.by(() => {
		if (!this.colourLineActive) return null;
		return this.#colourSpec(this.line.colour);
	});
	/** Line segments drawn whose starting mark has no colour value (in the line colour). */
	colourLineNoValueCount = $derived.by(() => {
		if (!this.colourLineActive) return 0;
		const { x, y } = this.colourLineXY;
		const { groups } = colouredLineSegments(x, y, this.colourIdx, {
			K: COLOUR_BUCKETS,
			joinGaps: this.line.joinGaps
		});
		return groups[0].length / 2;
	});

	#colourSpec(noValueColour) {
		const mode = this.colourMode;
		return {
			idx: this.colourIdx,
			colours: this.colourPalette,
			noValueColour,
			values: this.colourMarkValues,
			label: this.colourTitle,
			format: (v) => formatColourValue(v, mode)
		};
	}

	/** A note for the panel when this series' scale is not the one the colour bar shows. */
	get colourKeyNote() {
		const key = this.parentPlot?.colourKey;
		if (!this.colourActive || !key || key.series === this) return null;
		return key.sameAs(this)
			? null
			: 'The colour bar shows the first coloured series; this one uses a different scale.';
	}

	/**
	 * Switch Colour by on: an empty colour port appears on the canvas. The line stays in the
	 * series colour (decision 5) unless the points are hidden and the line is drawn: then the
	 * line is the only mark, so it is the one coloured.
	 */
	enableColourBy() {
		this.#channels.colour.enable({ colourLine: !this.drawsPoints && this.colourLineCapable });
	}

	/** Switch Colour by off: the port and its wire go; the series colour returns. */
	disableColourBy() {
		this.#channels.colour.disable();
	}

	// ---- Size by (plan 3.7; the shared channel, then what size draws with) ----
	get sizeActive() {
		return this.#channels.size.active;
	}
	get sizeMode() {
		return this.#channels.size.mode;
	}
	get sizeEncoded() {
		return this.#channels.size.encoded;
	}
	get sizeWarning() {
		return this.#channels.size.warning;
	}
	get sizeMarkValues() {
		return this.#channels.size.markValues;
	}
	get sizeAutoDomain() {
		return this.#channels.size.autoDomain;
	}
	get sizeDomain() {
		return this.#channels.size.domain;
	}
	get sizeTitle() {
		return this.#channels.size.title;
	}
	get sizeLengthNote() {
		return this.#channels.size.lengthNote;
	}
	/** Whether this series' plot can size points by a column (encodingCapabilities.size). */
	get sizeCapable() {
		return this.parentPlot?.constructor?.encodingCapabilities?.size === true;
	}

	/** The radius range drawn, px ({ rMin, rMax }, floored at 1 px). */
	sizeRadiusRange = $derived(
		this.sizeEncoding
			? sizeRange(this.sizeEncoding.minRadius, this.sizeEncoding.maxRadius)
			: sizeRange(null, null)
	);
	/**
	 * The exact radius and drawing layer of every MARK ({ r, layer, noValueLayer }), or null
	 * while inactive. A mark with no size value keeps the series' own point size.
	 */
	sizeRadii = $derived.by(() => {
		if (!this.sizeActive) return null;
		const { rMin, rMax } = this.sizeRadiusRange;
		return sizeRadii(this.sizeMarkValues, this.sizeDomain, {
			rMin,
			rMax,
			fallback: this.defaultRadius
		});
	});
	/** The largest radius drawn (hover reach, marker room at the axis ends). */
	sizeMaxRadius = $derived.by(() => {
		const base = this.defaultRadius;
		const radii = this.sizeRadii?.r;
		if (!radii) return base;
		let max = 0;
		for (let k = 0; k < radii.length; k++) if (radii[k] > max) max = radii[k];
		return radii.length ? max : base;
	});
	/** Drawn marks with no size value: drawn at the series' own size. */
	sizeNoValueCount = $derived.by(() => {
		if (!this.sizeActive) return 0;
		const values = this.sizeMarkValues;
		return this.#channels.size.noValueCount(
			(k) => k >= values.length || !Number.isFinite(values[k])
		);
	});
	/**
	 * What a point renderer sizes with (Points' and markerPaths' `sizeBy`), or null for every
	 * mark at the series' radius: { r, layer, noValueLayer, S, values, label, format }.
	 */
	sizeRender = $derived.by(() => {
		if (!this.sizeActive || !this.drawsPoints) return null;
		const mode = this.sizeMode;
		const { r, layer, noValueLayer } = this.sizeRadii;
		return {
			r,
			layer,
			noValueLayer,
			S: SIZE_BUCKETS,
			values: this.sizeMarkValues,
			label: this.sizeTitle,
			format: (v) => formatColourValue(v, mode)
		};
	});

	/** A note for the panel when this series' size scale is not the one the size key shows. */
	get sizeKeyNote() {
		const key = this.parentPlot?.sizeKey;
		if (!this.sizeActive || !key || key.series === this) return null;
		return key.sameAs(this)
			? null
			: 'The size key shows the first sized series; this one uses a different scale.';
	}

	/** Switch Size by on: an empty size port appears on the canvas. */
	enableSizeBy() {
		this.#channels.size.enable();
	}

	/** Switch Size by off: the port and its wire go; every point returns to the series size. */
	disableSizeBy() {
		this.#channels.size.disable();
	}
}

function asWrapper(v) {
	return v == null ? null : v instanceof ColumnClass ? v : ColumnClass.fromJSON(slimWrapper(v));
}

/**
 * The range a series' channel spans (plan 3.5, 3.7, decision 8): the full range of the mark
 * values of every series of this plot encoded on that channel from the same column read the
 * same way. A faceted plot shares ONE scale across its panels (plan 3.9): every series of the
 * generator encoded that way, whichever column each panel reads. `manual: false` gives the
 * automatic range (the panel's placeholder).
 */
export function encodingDomainFor(plot, datum, channel, { manual = true } = {}) {
	const me = datum.encodingChannel(channel);
	const ref = me.column?.refId;
	const mode = me.mode;
	const facetSeries =
		plot?.parentBox?.generator?.plot?.data ?? (plot?.parentBox?.facet ? plot.data : null);
	const pool = facetSeries ?? plot?.data ?? [datum];
	const arrays = [];
	for (const d of pool) {
		const c = d?.encodingChannel?.(channel);
		if (!c?.active || c.mode !== mode) continue;
		if (!facetSeries && c.column.refId !== ref) continue;
		arrays.push(c.markValues);
	}
	return encodingDomain(arrays, {
		mode,
		domainIN: manual ? me.encoding?.domainIN : null
	});
}

/** encodingDomainFor on the colour channel. */
export function colourDomainFor(plot, datum, o) {
	return encodingDomainFor(plot, datum, 'colour', o);
}

/**
 * Give every encoding of a plot a distinct id per channel (its canvas port is named by it).
 * A pasted series or a hand-written session can repeat one; the first keeps it.
 */
export function ensureUniqueEncodingIds(plot) {
	for (const channel of ENCODING_CHANNELS) {
		const field = ENCODING_FIELDS[channel].encoding;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local de-duplication set, never read reactively
		const seen = new Set();
		for (const d of plot?.data ?? []) {
			const enc = d?.[field];
			if (!enc) continue;
			if (seen.has(enc.id)) enc.id = nextEncodingId(plot, channel);
			seen.add(enc.id);
		}
	}
}

/**
 * A Cartesian host's outside-legend placement (legendAuto's `outside` callback) made to share
 * the right margin with keys beside the plot: they stack, the widest sets the room, and the
 * legend sits at its left edge.
 * @param {(box: object, o: object) => object} outside the host's own (usually rightOfPlot)
 * @param {() => EncodingKeyLayout} getKeys
 */
export function withEncodingKeysOutside(outside, getKeys) {
	return (box, o) => {
		const placed = outside(box, o);
		const reserve = getKeys()?.reserveW ?? 0;
		const extra = reserve - placed.reserveW;
		return extra > 0 ? { ...placed, reserveW: reserve, x: placed.x - extra } : placed;
	};
}

/** Two keys stack (the second pushed along by the first) in the same position. */
function samePlace(a, b) {
	return a != null && a === b && a !== 'custom';
}

/**
 * The plot-level keys of Colour by and Size by (plan 3.7, 3.8), shared by every host: the
 * colour bar and the size key, stacked after the series legend in reading order (legend,
 * colour bar, size key) wherever two of them share a position.
 *
 * Host contract (reactive getters on the plot's inner): data, legend, legendLayout
 * (LegendAutoLayout), viewStyle, basePlotHeight, plotwidth, plotheight, padding, parentBox;
 * optional hasRightAxisData. `opts.place(keys)` replaces the Cartesian placement (the
 * Circular phase plot puts both keys in a strip beside its clock) and returns
 * `{ x, y, length, size: { x, y } | null }`; `opts.reserveW(keys)` the room they take from
 * the plot width; `opts.positions` limits the panels' position choices.
 */
export class EncodingKeyLayout {
	#host;
	#opts;

	constructor(host, opts = {}) {
		this.#host = host;
		this.#opts = opts;
	}

	// The saved settings. Setters take saved JSON too (the undo recorder writes JSON). `show`
	// defaults on: a key absent from the file (not encoded when saved) comes back visible.
	#scale = $state(ColourScaleClass.withDefaults(null, { show: true }));
	get scale() {
		return this.#scale;
	}
	set scale(v) {
		this.#scale =
			v instanceof ColourScaleClass ? v : ColourScaleClass.withDefaults(v ?? null, { show: true });
	}
	#sizeScale = $state(SizeScaleClass.withDefaults(null, { show: true }));
	get sizeScale() {
		return this.#sizeScale;
	}
	set sizeScale(v) {
		this.#sizeScale =
			v instanceof SizeScaleClass ? v : SizeScaleClass.withDefaults(v ?? null, { show: true });
	}

	/** The position presets the panels offer (null: all of the keys'). */
	get positions() {
		return this.#opts.positions ?? null;
	}

	/** Whether any series has Colour by switched on (the bar's settings are then saved). */
	get anyEncoded() {
		return (this.#host.data ?? []).some((d) => d?.colourEncoding);
	}
	/** Whether any series has Size by switched on (the size key's settings are then saved). */
	get anySized() {
		return (this.#host.data ?? []).some((d) => d?.sizeEncoding);
	}

	/**
	 * The bar's content: the first series whose marks (points or line) are coloured, or null.
	 * `sameAs` says whether another series draws with the same scale (else the panel says so).
	 * The "no value" swatch shows when any mark used it: in the points' colour when a point has
	 * no value, else the line's (both are the series colour unless overridden).
	 */
	key = $derived.by(() => {
		const data = this.#host.data ?? [];
		const colours = (d) => d?.colourActive && (d.drawsPoints || d.colourLineActive);
		const series = data.find(colours);
		if (!series) return null;
		const domain = series.colourDomain;
		const enc = series.colourEncoding;
		const sig = (d) =>
			JSON.stringify([d.colourBy?.refId, d.colourMode, d.colourMap, d.colourDomain]);
		const mine = sig(series);
		const using = data.filter((d) => colours(d) && sig(d) === mine);
		const noValuePoints = using.find((d) => d.drawsPoints && d.colourNoValueCount > 0);
		const noValueLine = using.find((d) => d.colourLineNoValueCount > 0);
		const noValueColour = noValuePoints
			? noValuePoints.colourPointColour
			: noValueLine
				? noValueLine.line.colour
				: null;
		return {
			series,
			colormap: series.colourMap,
			domain,
			title: series.colourTitle,
			ticks: colourBarTicks(domain, series.colourMode, {
				manualLo: enc.domainMin != null,
				manualHi: enc.domainMax != null
			}),
			noValue: noValueColour ? { colour: noValueColour, label: 'no value' } : null,
			sameAs: (d) => sig(d) === mine
		};
	});

	/**
	 * The size key's content (plan 3.7): the first series whose points are sized, or null.
	 * Three reference circles across its range in its marker shape, and a "no value" entry at
	 * the series' own size when a drawn point of a series on the same scale had no size value.
	 */
	sizeKey = $derived.by(() => {
		const data = this.#host.data ?? [];
		const sized = (d) => d?.sizeActive && d.drawsPoints;
		const series = data.find(sized);
		if (!series) return null;
		const domain = series.sizeDomain;
		const enc = series.sizeEncoding;
		const { rMin, rMax } = series.sizeRadiusRange;
		const sig = (d) =>
			JSON.stringify([d.sizeBy?.refId, d.sizeMode, d.sizeDomain, d.sizeRadiusRange]);
		const mine = sig(series);
		const missing = data.find((d) => sized(d) && sig(d) === mine && d.sizeNoValueCount > 0);
		return {
			series,
			domain,
			title: series.sizeTitle,
			shape: series.pointShape,
			items: sizeKeyItems(domain, series.sizeMode, {
				rMin,
				rMax,
				manualLo: enc.domainMin != null,
				manualHi: enc.domainMax != null
			}),
			noValue: missing ? { r: missing.defaultRadius, label: 'no value' } : null,
			sameAs: (d) => sig(d) === mine
		};
	});

	/** The keys' font sizes, as ColourScale.svelte and SizeKey.svelte draw them. */
	fontPx = $derived(this.#scale?.fontSize ?? resolveStyle(this.#host.viewStyle).sizes.legend);
	sizeFontPx = $derived(
		this.#sizeScale?.fontSize ?? resolveStyle(this.#host.viewStyle).sizes.legend
	);

	/** The bar's geometry at a length (ColourScale.colourScaleGeometry), or null. */
	geometry(length) {
		const key = this.key;
		if (!key || !this.#scale?.show) return null;
		return colourScaleGeometry({
			vertical: this.#scale.orientation !== 'horizontal',
			thickness: this.#scale.barThickness ?? 10,
			barLen: length,
			fontSize: this.fontPx,
			tickLabels: key.ticks.map((t) => t.label),
			label: key.title,
			noValueLabel: key.noValue ? key.noValue.label : null
		});
	}

	/** The size key's geometry (SizeKey.sizeKeyGeometry), or null when there is none. */
	sizeBase = $derived.by(() => {
		const key = this.sizeKey;
		if (!key || !this.#sizeScale?.show) return null;
		return sizeKeyGeometry({
			items: key.items,
			noValue: key.noValue,
			title: key.title,
			fontSize: this.sizeFontPx,
			itemSpacing: this.#sizeScale.itemSpacing ?? 4
		});
	});

	/** The backdrop a key draws round itself over the data (its padding), in px. */
	inset = $derived(
		this.#opts.place || this.#scale?.position === 'right' ? 0 : (this.#scale?.padding ?? 8)
	);
	sizeInset = $derived(
		this.#opts.place || this.#sizeScale?.position === 'right' ? 0 : (this.#sizeScale?.padding ?? 8)
	);

	/** The bar's length before any legend shortens it: stored, else the plot height's. */
	length0 = $derived(this.#scale?.barLength ?? autoBarLength(this.#host.basePlotHeight));
	base = $derived(this.geometry(this.length0));

	/** The view's legend inset, which the keys share. */
	get margin() {
		return this.#host.legendLayout?.margin ?? 0;
	}

	/** The size key sits after the colour bar in the same place (so the bar leaves it room). */
	sizeSharesBar = $derived(
		!!this.base && !!this.sizeBase && samePlace(this.#scale.position, this.#sizeScale.position)
	);

	/** Room the beside-the-plot keys take from the plot width (independent of the legend). */
	reserveW = $derived.by(() => {
		if (this.#opts.reserveW) return this.#opts.reserveW(this);
		const right = (geom, scale) => (geom && scale.position === 'right' ? geom.width : 0);
		const w = Math.max(right(this.base, this.#scale), right(this.sizeBase, this.#sizeScale));
		return colourKeyReserveW(w, this.margin, !!this.#host.hasRightAxisData);
	});

	/** The series legend as drawn on a Cartesian plot, for the keys to keep clear of. */
	legendPlaced = $derived.by(() => {
		const host = this.#host;
		const box = host.legendLayout?.box;
		if (!box) return null;
		const pos = host.legend?.position;
		const out = host.legendLayout.outsidePosition;
		if (out) return { x: out.x, y: out.y, width: box.width, height: box.height, outside: true };
		const m = host.legendLayout.margin;
		const corner =
			pos === 'auto' ? (host.legendLayout.auto?.name ?? null) : pos === 'custom' ? null : pos;
		const bottom = corner === 'bottomright' || corner === 'bottomleft';
		const left = corner === 'topleft' || corner === 'bottomleft';
		const auto = pos === 'auto' ? host.legendLayout.auto : null;
		const y = auto ? auto.y : bottom ? host.plotheight - box.height - m : m;
		const x = auto ? auto.x : left ? m : host.plotwidth - box.width - m;
		return { x, y, width: box.width, height: box.height, outside: false, corner };
	});

	/** The common placeKey arguments of a Cartesian host. */
	#placeArgs() {
		const host = this.#host;
		return {
			plotW: host.plotwidth,
			plotH: host.plotheight,
			margin: this.margin,
			hasRightAxis: !!host.hasRightAxisData,
			paddingRight: host.padding?.right ?? 0
		};
	}

	/** What a host that places the keys itself returned ({ x, y, length, size }), or null. */
	#hostPlaced = $derived(
		this.#opts.place && (this.base || this.sizeBase) ? this.#opts.place(this) : null
	);

	/** Where the bar is drawn and how long it is: { x, y, length }, or null. */
	placement = $derived.by(() => {
		if (!this.base) return null;
		if (this.#opts.place) return this.#hostPlaced;
		const vertical = this.#scale.orientation !== 'horizontal';
		const args = {
			...this.#placeArgs(),
			position: this.#scale.position,
			legend: this.legendPlaced,
			custom: { customX: this.#scale.customX, customY: this.#scale.customY },
			inset: this.inset
		};
		return this.fitVertical(args, vertical);
	});

	/**
	 * placeKey, then an automatic vertical bar shortened to the room left beside or under the
	 * legend (the room is for the whole key: the bar plus its "no value" entry, and the size
	 * key under it when they share the place).
	 */
	fitVertical(args, vertical = this.#scale.orientation !== 'horizontal') {
		const { legend = null, ...rest } = args;
		const stack = legend ? [legend] : [];
		const first = placeKey({ ...rest, stack, box: this.base });
		const length = this.length0;
		const after = this.sizeSharesBar ? this.sizeBase.height + 2 * this.sizeInset + this.margin : 0;
		const room = first.maxLength - after;
		const besides = this.base.height - length;
		if (vertical && this.#scale.barLength == null && room < length + besides) {
			const shorter = Math.max(20, room - besides);
			const placed = placeKey({ ...rest, stack, box: this.geometry(shorter) });
			return { x: placed.x, y: placed.y, length: shorter };
		}
		return { x: first.x, y: first.y, length };
	}

	/** The bar as placed, a box for the size key to stack after (its backdrop included). */
	barPlaced = $derived.by(() => {
		const at = this.placement;
		if (!at || !this.base) return null;
		const geom = this.geometry(at.length) ?? this.base;
		const pos = this.#scale.position;
		const i = this.inset;
		return {
			x: at.x - i,
			y: at.y - i,
			width: geom.width + 2 * i,
			height: geom.height + 2 * i,
			outside: pos === 'right',
			corner: pos === 'right' || pos === 'custom' ? null : pos
		};
	});

	/** Where the size key is drawn: { x, y }, or null. */
	sizePlacement = $derived.by(() => {
		if (!this.sizeBase) return null;
		if (this.#opts.place) return this.#hostPlaced?.size ?? null;
		const stack = [this.legendPlaced, this.barPlaced].filter(Boolean);
		const p = placeKey({
			...this.#placeArgs(),
			position: this.#sizeScale.position,
			box: this.sizeBase,
			stack,
			custom: { customX: this.#sizeScale.customX, customY: this.#sizeScale.customY },
			inset: this.sizeInset
		});
		return { x: p.x, y: p.y };
	});

	/**
	 * The keys as obstacles for an 'auto' series legend over a w x h plot area (a
	 * buildOccupancy series), or null when neither is inside the plot area.
	 */
	obstacle(w, h) {
		const rects = [];
		const bar = keyObstacle(
			this.#scale?.position,
			this.base,
			w,
			h,
			this.margin,
			{ customX: this.#scale?.customX, customY: this.#scale?.customY },
			this.inset
		);
		if (bar) rects.push(bar);
		const before =
			bar && this.sizeSharesBar
				? [
						{
							x: bar[0],
							y: bar[1],
							width: bar[2] - bar[0],
							height: bar[3] - bar[1],
							outside: false,
							corner: this.#scale.position
						}
					]
				: [];
		const size = keyObstacle(
			this.#sizeScale?.position,
			this.sizeBase,
			w,
			h,
			this.margin,
			{ customX: this.#sizeScale?.customX, customY: this.#sizeScale?.customY },
			this.sizeInset,
			before
		);
		if (size) rects.push(size);
		return rects.length ? { rects } : null;
	}

	/** The plot area an inside legend is placed over, beside keys in the right margin. */
	legendArea() {
		return { w: this.#host.basePlotWidth - this.reserveW, h: this.#host.basePlotHeight };
	}

	#plotFrame() {
		const host = this.#host;
		return {
			// A square polar plot has no plotwidth / plotheight: its square's side.
			plotWidth: host.plotwidth ?? host.plotSize,
			plotHeight: host.plotheight ?? host.plotSize,
			padding: host.padding,
			figureStyle: host.viewStyle
		};
	}

	/** Everything ColourScale.svelte's plot view takes, or null when there is no bar. */
	drawProps = $derived.by(() => {
		const key = this.key;
		const at = this.placement;
		if (!key || !at) return null;
		const host = this.#host;
		return {
			...this.#plotFrame(),
			scaleData: this.#scale,
			colormap: key.colormap,
			domain: [key.domain.lo, key.domain.hi],
			label: key.title,
			ticks: key.ticks,
			noValue: key.noValue,
			idPrefix: 'colourby-' + String(host.parentBox?.id ?? 'plot').replace(/[^\w-]/g, '_'),
			placement: { x: at.x, y: at.y },
			length: at.length,
			// A host that places the bar itself (beside the Circular phase clock) keeps it
			// clear of the marks, so it needs no backdrop whatever position is saved.
			backdrop: this.#opts.place ? false : null
		};
	});

	/** Everything SizeKey.svelte's plot view takes, or null when there is no size key. */
	sizeDrawProps = $derived.by(() => {
		const key = this.sizeKey;
		const at = this.sizePlacement;
		if (!key || !at || !this.sizeBase) return null;
		return {
			...this.#plotFrame(),
			scaleData: this.#sizeScale,
			items: key.items,
			noValue: key.noValue,
			title: key.title,
			shape: key.shape,
			geometry: this.sizeBase,
			placement: at,
			backdrop: this.#opts.place ? false : null
		};
	});

	/** The plot JSON's key entries, each only while a series is encoded on its channel. */
	toJSON() {
		return {
			...(this.anyEncoded ? { colourScale: this.#scale.toJSON() } : {}),
			...(this.anySized ? { sizeScale: this.#sizeScale.toJSON() } : {})
		};
	}
}
