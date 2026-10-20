// @ts-nocheck
// Colour by, the REACTIVE half every host shares (colour-by plan 2026-10-20, sections 3.2, 3.5,
// 3.8 and 3.12; phase 2 moved it here from the Scatterplot so Q-Q, Mean +/- SEM and Circular
// phase run the same code). The pure rules stay in encodings.js (mode, range, bucket, colour)
// and encodingHost.js (ports, mode and map choice, the colour bar's words and placement).
//
// Two pieces:
//
//   ColourBySeries   a base class for a plot SERIES meeting the encoding host contract
//                    (encodingHost.js): the `colourBy` column, its `colourEncoding`, and every
//                    derived the panel (Encoding.svelte), the renderers (Points, Line, the
//                    plot's own marks) and the colour bar read. A host overrides a few hooks
//                    to say what a MARK is (below); everything else is shared.
//   ColourKeyLayout  the plot-level colour bar: its saved settings (`colourScale`), what it
//                    shows (the first coloured series), its geometry, and where it goes
//                    clear of the series legend.
//
// MARKS. The colour index (`colourIdx`) and the tooltip values are per drawn MARK, in the
// order the host hands its marks to the renderer:
//   - Scatterplot, Circular phase: a mark is a row (identity).
//   - Q-Q: a mark is a sorted sample; `colourMarkRows` is the sort permutation, so each
//     sample keeps its own row's colour (plan 3.12).
//   - Mean +/- SEM: a mark is a group; its value is the group's summary of the colour column
//     (the mean; the circular mean for Hour of day), over exactly the rows the mean used.
// The colour range spans the marks' values over every series reading the same column the same
// way (and, on a faceted plot, every panel), so a colour means the same thing everywhere.

import { Column as ColumnClass, getColumnById } from '$lib/core/Column.svelte';
import { isWiredRef } from '$lib/core/seriesChannelRefs.js';
import { displayNameById } from '$lib/core/columnLabels.js';
import { getDisplayZone } from '$lib/utils/time/displayTime.js';
import { resolveStyle } from '$lib/plots/figureStyle.js';
import { ColourEncodingClass } from './Encoding.svelte';
import { ColourScaleClass, colourScaleGeometry, autoBarLength } from './ColourScale.svelte';
import {
	encodingValues,
	encodingDomain,
	colourBuckets,
	bucketColours,
	groupEncodingValue,
	NO_VALUE,
	COLOUR_BUCKETS
} from './encodings.js';
import { colouredLineSegments } from './colouredLine.js';
import {
	effectiveColourMode,
	effectiveColormap,
	colourBarTitle,
	colourBarTicks,
	formatColourValue,
	nextEncodingId,
	placeColourKey,
	colourKeyReserveW,
	colourKeyObstacle
} from './encodingHost.js';

/**
 * The series legend swatch of a series coloured by a column (plan 3.8): a neutral mid grey.
 * Figure ink, not interface chrome, so a literal rather than a CSS token: a saved SVG or PNG
 * cannot resolve var(--…) outside the app.
 */
export const COLOUR_BY_SWATCH = 'rgb(140, 140, 140)';

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

/**
 * The base class of a series that can be coloured by a column. Hooks a host may override
 * (all plain getters or methods, read inside deriveds):
 *
 *   colourMarkRows          null (a mark is a row), or the source row of each mark
 *   colourMarkGroups        null, or the source rows of each mark (a mark summarises them)
 *   colourSeriesRowCount    how many rows the colour column should cover (the length note)
 *   colourDrawnTest         null (every mark is drawn), or a test (k) => whether mark k is
 *                           drawn (for the "no value" count); read once per count, so it
 *                           should close over plain locals rather than read state per mark
 *   colourMarkCount         how many marks there are (default: the colour values' length)
 *   colourDrawsPoints       whether the series draws point marks (default points.draw)
 *   colourPointColour       the series colour a "no value" point is drawn in
 *   colourLineXY            { x, y } the line is drawn through (mark-aligned), for its count
 *   colourMarkWords         ['point', 'points'], how the panel names a mark
 *   colourSummaryNote       a panel note on how a mark's value is made (aggregated plots)
 *
 * The setters take saved JSON as well as instances: the panel's undo recorder writes changed
 * paths in place (plots/plotEdits.js setPlotFields), so switching Colour by on or off writes
 * `colourBy` / `colourEncoding` as JSON, and that must become the classes again.
 */
export class ColourBySeries {
	#colourBy = $state(null);
	#colourEncoding = $state(null);
	get colourBy() {
		return this.#colourBy;
	}
	set colourBy(v) {
		this.#colourBy =
			v == null ? null : v instanceof ColumnClass ? v : ColumnClass.fromJSON(slimWrapper(v));
	}
	get colourEncoding() {
		return this.#colourEncoding;
	}
	set colourEncoding(v) {
		this.#colourEncoding =
			v == null ? null : v instanceof ColourEncodingClass ? v : ColourEncodingClass.fromJSON(v);
	}

	// ---- hooks (see the class comment) ----
	get colourMarkRows() {
		return null;
	}
	get colourMarkGroups() {
		return null;
	}
	get colourSeriesRowCount() {
		return columnData(this.y ?? this.column).length;
	}
	get colourDrawnTest() {
		return null;
	}
	get colourMarkCount() {
		return this.colourMarkValues?.length ?? 0;
	}
	get colourDrawsPoints() {
		return !!this.points?.draw;
	}
	get colourPointColour() {
		return this.points?.colour ?? this.colour;
	}
	get colourLineXY() {
		return { x: this.xData ?? [], y: this.yData ?? [] };
	}
	get colourMarkWords() {
		return ['point', 'points'];
	}
	get colourSummaryNote() {
		return null;
	}

	/** Restore Colour by from saved series JSON: only when it was on (both halves present). */
	restoreColourBy(json) {
		if (json?.colourEncoding && json?.colourBy) {
			this.colourBy = json.colourBy;
			this.colourEncoding = json.colourEncoding;
		}
	}

	/** The fields a series saves, only while Colour by is on (a plain series saves as before). */
	colourByJSON() {
		return this.colourEncoding && this.colourBy
			? { colourBy: this.colourBy, colourEncoding: this.colourEncoding.toJSON() }
			: {};
	}

	/** On AND wired to a column that exists: the marks are coloured. */
	colourActive = $derived(
		!!this.colourEncoding &&
			isWiredRef(this.colourBy?.refId) &&
			getColumnById(this.colourBy.refId) != null
	);
	// A number or bin column's time origin, so hour of day reads its clock (as an x axis does).
	colourOrigin = $derived(
		this.colourBy && this.colourBy.type !== 'time'
			? (this.parentPlot?.resolveXOriginMs?.(this.colourBy) ??
					finiteOrNull(this.colourBy.originTime_ms))
			: null
	);
	colourMode = $derived(
		this.colourBy
			? effectiveColourMode(this.colourEncoding?.mode, {
					type: this.colourBy.type,
					originTime_ms: this.colourOrigin
				})
			: null
	);
	/** The value each ROW is coloured by ({ values, warning }), or null while inactive. */
	colourEncoded = $derived.by(() => {
		if (!this.colourActive) return null;
		return encodingValues(this.colourMode, columnData(this.colourBy), {
			type: this.colourBy.type,
			originTime_ms: this.colourOrigin,
			zone: getDisplayZone()
		});
	});
	colourWarning = $derived(this.colourEncoded?.warning ?? null);
	/**
	 * The value each MARK is coloured by: the row's own (identity), the row a sorted mark came
	 * from, or the summary of a group's rows. A mark past the colour column's end has no value.
	 */
	colourMarkValues = $derived.by(() => {
		const enc = this.colourEncoded;
		if (!enc) return null;
		const rowValues = enc.values;
		const groups = this.colourMarkGroups;
		if (groups) {
			const mode = this.colourMode;
			return groups.map((rows) =>
				groupEncodingValue(
					rows.map((r) => (r < rowValues.length ? rowValues[r] : NaN)),
					mode
				)
			);
		}
		const rows = this.colourMarkRows;
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
	colourAutoDomain = $derived(
		this.colourActive ? colourDomainFor(this.parentPlot, this, { manual: false }) : null
	);
	colourDomain = $derived(this.colourActive ? colourDomainFor(this.parentPlot, this) : null);
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
	colourTitle = $derived(
		this.colourActive
			? colourBarTitle(this.colourMode, {
					// As the user sees the column (a node output's label, "Binned: ambient temp").
					columnName: displayNameById(this.colourBy.refId, ''),
					zone: getDisplayZone(),
					wrapped: !!this.colourWarning && this.colourMode === 'hourOfDay'
				})
			: ''
	);
	/** Drawn marks with no colour value: drawn in the series colour. */
	colourNoValueCount = $derived.by(() => {
		if (!this.colourActive) return 0;
		const idx = this.colourIdx;
		const n = this.colourMarkCount;
		const drawn = this.colourDrawnTest;
		let count = 0;
		for (let k = 0; k < n; k++) {
			if (drawn && !drawn(k)) continue;
			if (k >= idx.length || idx[k] === NO_VALUE) count++;
		}
		return count;
	});
	/** What a point renderer draws with (Points' `colourBy` prop), or null for one path. */
	colourRender = $derived.by(() => {
		if (!this.colourActive || !this.colourDrawsPoints) return null;
		return this.#renderSpec(this.colourPointColour);
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
		return this.#renderSpec(this.line.colour);
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

	#renderSpec(noValueColour) {
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

	/** The colour column is shorter than the series: say how many rows it covers. */
	get colourLengthNote() {
		if (!this.colourActive) return null;
		const nc = this.colourEncoded.values.length;
		const n = this.colourSeriesRowCount;
		return nc < n
			? `The colour column has ${nc} rows and this series ${n}; the rest have no colour value.`
			: null;
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
		if (this.colourEncoding) return;
		this.colourBy = new ColumnClass({ refId: -1 });
		this.colourEncoding = new ColourEncodingClass({
			id: nextEncodingId(this.parentPlot),
			colourLine: !this.colourDrawsPoints && this.colourLineCapable
		});
	}

	/** Switch Colour by off: the port and its wire go; the series colour returns. */
	disableColourBy() {
		this.colourBy = null;
		this.colourEncoding = null;
	}
}

/**
 * The range a series' colours span (plan 3.5, decision 8): the full range of the mark values
 * of every coloured series of this plot reading the same column the same way. A faceted plot
 * shares ONE scale across its panels (plan 3.9): every coloured series of the generator read
 * the same way, whichever column each panel colours by. `manual: false` gives the automatic
 * range (the panel's placeholder).
 */
export function colourDomainFor(plot, datum, { manual = true } = {}) {
	const ref = datum.colourBy?.refId;
	const mode = datum.colourMode;
	const facetSeries =
		plot?.parentBox?.generator?.plot?.data ?? (plot?.parentBox?.facet ? plot.data : null);
	const pool = facetSeries ?? plot?.data ?? [datum];
	const arrays = [];
	for (const d of pool) {
		if (!d?.colourActive || d.colourMode !== mode) continue;
		if (!facetSeries && d.colourBy.refId !== ref) continue;
		arrays.push(d.colourMarkValues);
	}
	return encodingDomain(arrays, {
		mode,
		domainIN: manual ? datum.colourEncoding?.domainIN : null
	});
}

/**
 * Give every colour encoding of a plot a distinct id (its canvas port is named by it). A
 * pasted series or a hand-written session can repeat one; the first keeps it.
 */
export function ensureUniqueEncodingIds(plot) {
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local de-duplication set, never read reactively
	const seen = new Set();
	for (const d of plot?.data ?? []) {
		const enc = d?.colourEncoding;
		if (!enc) continue;
		if (seen.has(enc.id)) enc.id = nextEncodingId(plot);
		seen.add(enc.id);
	}
}

/**
 * A Cartesian host's outside-legend placement (legendAuto's `outside` callback) made to share
 * the right margin with a colour bar beside the plot: they stack, the wider sets the room, and
 * the legend sits at its left edge.
 * @param {(box: object, o: object) => object} outside the host's own (usually rightOfPlot)
 * @param {() => ColourKeyLayout} getKeys
 */
export function withColourKeyOutside(outside, getKeys) {
	return (box, o) => {
		const placed = outside(box, o);
		const reserve = getKeys()?.reserveW ?? 0;
		const extra = reserve - placed.reserveW;
		return extra > 0 ? { ...placed, reserveW: reserve, x: placed.x - extra } : placed;
	};
}

/**
 * The plot-level colour bar of Colour by (plan 3.8), shared by every host.
 *
 * Host contract (reactive getters on the plot's inner): data, legend, legendLayout
 * (LegendAutoLayout), viewStyle, basePlotHeight, plotwidth, plotheight, padding, parentBox;
 * optional hasRightAxisData. `opts.place(keys)` replaces the Cartesian placement (the
 * Circular phase plot puts the bar in a strip beside its clock) and `opts.reserveW(keys)` the
 * room it takes from the plot width; `opts.positions` limits the panel's position choices.
 */
export class ColourKeyLayout {
	#host;
	#opts;

	constructor(host, opts = {}) {
		this.#host = host;
		this.#opts = opts;
	}

	// The saved settings. A setter that takes saved JSON too (the undo recorder writes JSON).
	// `show` defaults on: a bar absent from the file (not coloured when saved) comes back visible.
	#scale = $state(ColourScaleClass.withDefaults(null, { show: true }));
	get scale() {
		return this.#scale;
	}
	set scale(v) {
		this.#scale =
			v instanceof ColourScaleClass ? v : ColourScaleClass.withDefaults(v ?? null, { show: true });
	}

	/** The position presets the panel offers (null: all of ColourScale's). */
	get positions() {
		return this.#opts.positions ?? null;
	}

	/** Whether any series has Colour by switched on (the bar's settings are then saved). */
	get anyEncoded() {
		return (this.#host.data ?? []).some((d) => d?.colourEncoding);
	}

	/**
	 * The bar's content: the first series whose marks (points or line) are coloured, or null.
	 * `sameAs` says whether another series draws with the same scale (else the panel says so).
	 * The "no value" swatch shows when any mark used it: in the points' colour when a point has
	 * no value, else the line's (both are the series colour unless overridden).
	 */
	key = $derived.by(() => {
		const data = this.#host.data ?? [];
		const colours = (d) => d?.colourActive && (d.colourDrawsPoints || d.colourLineActive);
		const series = data.find(colours);
		if (!series) return null;
		const domain = series.colourDomain;
		const enc = series.colourEncoding;
		const sig = (d) =>
			JSON.stringify([d.colourBy?.refId, d.colourMode, d.colourMap, d.colourDomain]);
		const mine = sig(series);
		const using = data.filter((d) => colours(d) && sig(d) === mine);
		const noValuePoints = using.find((d) => d.colourDrawsPoints && d.colourNoValueCount > 0);
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

	/** The key's font size, as ColourScale.svelte draws it. */
	fontPx = $derived(this.#scale?.fontSize ?? resolveStyle(this.#host.viewStyle).sizes.legend);

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

	/** The backdrop ColourScale draws round a key over the data (its padding), in px. */
	inset = $derived(
		this.#opts.place || this.#scale?.position === 'right' ? 0 : (this.#scale?.padding ?? 8)
	);

	/** The bar's length before any legend shortens it: stored, else the plot height's. */
	length0 = $derived(this.#scale?.barLength ?? autoBarLength(this.#host.basePlotHeight));
	base = $derived(this.geometry(this.length0));

	/** The view's legend inset, which the bar shares. */
	get margin() {
		return this.#host.legendLayout?.margin ?? 0;
	}

	/** Room a beside-the-plot bar takes from the plot width (independent of the legend). */
	reserveW = $derived.by(() => {
		if (this.#opts.reserveW) return this.#opts.reserveW(this);
		return this.base && this.#scale.position === 'right'
			? colourKeyReserveW(this.base.width, this.margin, !!this.#host.hasRightAxisData)
			: 0;
	});

	/** The series legend as drawn on a Cartesian plot, for the bar to keep clear of. */
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
		const y =
			pos === 'auto' && host.legendLayout.auto
				? host.legendLayout.auto.y
				: bottom
					? host.plotheight - box.height - m
					: m;
		return { x: 0, y, width: box.width, height: box.height, outside: false, corner };
	});

	/** Where the bar is drawn and how long it is: { x, y, length }, or null. */
	placement = $derived.by(() => {
		if (!this.base) return null;
		if (this.#opts.place) return this.#opts.place(this);
		const host = this.#host;
		const vertical = this.#scale.orientation !== 'horizontal';
		const args = {
			position: this.#scale.position,
			plotW: host.plotwidth,
			plotH: host.plotheight,
			margin: this.margin,
			hasRightAxis: !!host.hasRightAxisData,
			paddingRight: host.padding?.right ?? 0,
			legend: this.legendPlaced,
			custom: { customX: this.#scale.customX, customY: this.#scale.customY },
			inset: this.inset
		};
		return this.fitVertical(args, vertical);
	});

	/**
	 * placeColourKey, then an automatic vertical bar shortened to the room left beside or under
	 * the legend (the room is for the whole key: the bar plus its "no value" entry).
	 */
	fitVertical(args, vertical = this.#scale.orientation !== 'horizontal') {
		const first = placeColourKey({ ...args, box: this.base });
		const length = this.length0;
		const besides = this.base.height - length;
		if (vertical && this.#scale.barLength == null && first.maxLength < length + besides) {
			const shorter = Math.max(20, first.maxLength - besides);
			const placed = placeColourKey({ ...args, box: this.geometry(shorter) });
			return { x: placed.x, y: placed.y, length: shorter };
		}
		return { x: first.x, y: first.y, length };
	}

	/**
	 * The bar as an obstacle for an 'auto' series legend over a w x h plot area (a
	 * buildOccupancy series), or null when it is not inside the plot area.
	 */
	obstacle(w, h) {
		const bar = colourKeyObstacle(
			this.#scale?.position,
			this.base,
			w,
			h,
			this.margin,
			{ customX: this.#scale?.customX, customY: this.#scale?.customY },
			this.inset
		);
		return bar ? { rects: [bar] } : null;
	}

	/** The plot area an inside legend is placed over, beside a bar in the right margin. */
	legendArea() {
		return { w: this.#host.basePlotWidth - this.reserveW, h: this.#host.basePlotHeight };
	}

	/** Everything ColourScale.svelte's plot view takes, or null when there is no bar. */
	drawProps = $derived.by(() => {
		const key = this.key;
		const at = this.placement;
		if (!key || !at) return null;
		const host = this.#host;
		return {
			scaleData: this.#scale,
			colormap: key.colormap,
			domain: [key.domain.lo, key.domain.hi],
			label: key.title,
			ticks: key.ticks,
			noValue: key.noValue,
			// A square polar plot has no plotwidth / plotheight: its square's side.
			plotWidth: host.plotwidth ?? host.plotSize,
			plotHeight: host.plotheight ?? host.plotSize,
			padding: host.padding,
			idPrefix: 'colourby-' + String(host.parentBox?.id ?? 'plot').replace(/[^\w-]/g, '_'),
			figureStyle: host.viewStyle,
			placement: { x: at.x, y: at.y },
			length: at.length,
			// A host that places the bar itself (beside the Circular phase clock) keeps it
			// clear of the marks, so it needs no backdrop whatever position is saved.
			backdrop: this.#opts.place ? false : null
		};
	});

	/** The plot JSON's colour bar entry, only while a series is coloured. */
	toJSON() {
		return this.anyEncoded ? { colourScale: this.#scale.toJSON() } : {};
	}
}
