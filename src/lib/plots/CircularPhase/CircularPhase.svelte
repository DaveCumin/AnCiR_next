<script module>
	import { autoSeriesColour, pickedColour } from '$lib/plots/autoSeriesColour.js';
	import { Column as ColumnClass } from '$lib/core/Column.svelte';
	import { seriesDisplayLabel } from '$lib/components/plotbits/helpers/seriesLabel.js';
	import {
		viewFontScale,
		viewStyleFor,
		scalePadding,
		viewPadFloorFor
	} from '$lib/plots/viewBox.js';
	import Column from '$lib/core/Column.svelte';
	import ColourPicker from '$lib/components/inputs/ColourPicker.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import SeriesBlockHeader from '$lib/components/plotbits/SeriesBlockHeader.svelte';
	import DataAddHeader from '$lib/components/plotbits/DataAddHeader.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import Legend, { LegendClass } from '$lib/components/plotbits/Legend.svelte';
	import { POINT_SHAPES, POINT_SHAPE_LABELS } from '$lib/components/plotbits/pointShapes.js';
	import { createPolar } from '$lib/components/plotbits/polar.js';
	import { placeCircularPoints, maxStackHeight } from '$lib/components/plotbits/circularStack.js';
	import PolarGrid from '$lib/components/plotbits/PolarGrid.svelte';
	import MeanVector from '$lib/components/plotbits/MeanVector.svelte';
	import RoseWedges from '$lib/components/plotbits/RoseWedges.svelte';
	import { scaleLinear } from 'd3-scale';
	import { niceAxisLimit } from '$lib/plots/Boxplot/Boxplot.svelte';
	import { LegendAutoLayout } from '$lib/components/plotbits/legendAuto.svelte.js';
	import {
		LEGEND_MARGIN,
		CLEAR_FRACTION,
		buildOccupancy,
		coveredFraction
	} from '$lib/components/plotbits/legendLayout.js';
	import {
		seriesStats,
		displayPeriodFor,
		cleanNumericColumn,
		columnToPhaseHours,
		weightedSeriesStats,
		setCircularUnit,
		convertPhaseValues
	} from '$lib/utils/circularPlot.js';
	import { watsonWilliams, toRadiansColumn } from '$lib/utils/circular.js';
	import { columnClock } from '$lib/core/columnTimeZone.js';
	import { pUpperFromF } from '$lib/utils/fdist.js';
	import {
		EncodedSeries,
		EncodingKeyLayout,
		COLOUR_BY_SWATCH,
		ensureUniqueEncodingIds
	} from '$lib/components/plotbits/colourBySeries.svelte.js';
	import { markerPaths } from '$lib/components/plotbits/markerPaths.js';

	// Shared radial placement constants: the inner/outer rim fractions of the
	// plot radius, used by both the timed (value-radius clock) valueScale range
	// and the untimed placeCircularPoints stack/bin/rim placement.
	const INNER_RIM = 0.12;
	const OUTER_RIM = 0.98;

	/**
	 * The timed (value-radius) clock's radial scale: the value axis from the inner rim to the
	 * clock ring, with a value ring at each tick (PolarGrid `rings`), the axis minimum's ring
	 * at the inner rim. The hole keeps a zero (an inactive bin, common in activity data) at its
	 * angle instead of collapsing onto the centre. The grid's rings used to stay at quarters of
	 * the radius, so no value label sat on a ring and "0" floated inside the first one.
	 * @param {[number, number]} axis
	 */
	export function timedValueScale(axis) {
		return scaleLinear().domain(axis).range([INNER_RIM, 1]);
	}

	/** The value ticks a timed clock labels, and the ring fraction each sits on. */
	export function timedValueTicks(axis) {
		const scale = timedValueScale(axis);
		return scale
			.ticks(3)
			.map((t) => ({ t, r01: scale(t) }))
			.filter(({ r01 }) => r01 >= INNER_RIM - 1e-9 && r01 <= 1 + 1e-9);
	}
	// The clock ring's radius, as a fraction of half the plot square.
	const RING_RADIUS = 0.82;
	// What the clock draws past its ring (PolarGrid), in px: a legend beside, above or below
	// the clock starts beyond it. The hint line under the clock has its baseline 34 px below
	// the ring, so its lower edge is at 38; the hour labels (11 px type centred 16 px out)
	// reach about 21 px, plus air.
	const HINT_BOTTOM = 38;
	const LABEL_REACH = 26;
	// How far the top hour label ("24 / 0": 11 px type, baseline 12.5 px outside the ring)
	// reaches above the ring.
	const LABEL_TOP = 21;
	// Legend presets that sit in a corner of the plot square (see legendCorner).
	const LEGEND_CORNERS = new Set(['topright', 'topleft', 'bottomright', 'bottomleft']);

	// NOTE on field naming: sibling time-optional plots (Periodogram, Actogram,
	// Correlogram, FFT) all expose 'time'/'values' as the PUBLIC wiring port
	// names (definition.defaultDataInputs) but store the series columns
	// internally as generic `x`/`y`: every reader of a series' columns (edge and
	// passthrough detection, column delete, ref remapping) goes through
	// core/seriesChannelRefs.js, which knows the fixed fields only.
	// CircularPhaseSeries follows the same convention: `x` is the optional time
	// column, `y` is the phase/measurement column.
	class CircularPhaseSeries extends EncodedSeries {
		static descriptors = {
			// Colour by (plotbits/colourBySeries.svelte.js): how the colour column is read and
			// drawn. The column itself is wiring (`colourBy`, a Column), like x and y.
			colourEncoding: { descend: true, label: 'Colour by' },
			// Size by: how the size column is read and drawn (plan 3.7).
			sizeEncoding: { descend: true, label: 'Size by' }
		};
		parentPlot = $state();
		x = $state(); // optional time column: wiring this turns the series into a value-radius clock plot
		y = $state(); // phase column (untimed) or measurement column (timed)
		label = $state('Phase 1');
		// The user's pick, or null while automatic (autoSeriesColour.js): read at draw time, so
		// the column's appearance-map colour applies, and saved as null.
		#explicitColour = $state(null);
		get colour() {
			return autoSeriesColour(this, this.#explicitColour, this.y);
		}
		set colour(v) {
			this.#explicitColour = pickedColour(v);
		}
		shape = $state('circle');
		radius = $state(3.4);
		draw = $state(true); // show this series' points

		constructor(parent, dataIN) {
			super();
			this.parentPlot = parent;
			const xJSON = dataIN?.x ?? dataIN?.time;
			this.x = xJSON ? ColumnClass.fromJSON(xJSON) : new ColumnClass({ refId: -1 });
			// Migration: legacy sessions stored the single value column as `column`;
			// `values` is also accepted directly (the untimed-only public wire shape).
			const yJSON = dataIN?.y ?? dataIN?.values ?? dataIN?.column;
			this.y = yJSON ? ColumnClass.fromJSON(yJSON) : new ColumnClass({ refId: -1 });
			// Blank by default; `displayLabel` falls back to the wired column's name.
			this.label = dataIN?.label ?? '';
			this.colour = dataIN?.colour ?? null;
			this.shape = POINT_SHAPES.includes(dataIN?.shape) ? dataIN.shape : 'circle';
			this.radius = dataIN?.radius ?? 3.4;
			this.draw = dataIN?.draw ?? true;
			// Colour by / Size by: each restored only when it was on (both halves present).
			this.restoreEncodings(dataIN);
		}

		// ---- Encoding hooks (EncodedSeries: Colour by and Size by) ----
		// A mark is a ROW: a timed series draws row i at (time of day, value), an untimed one
		// places row i's phase (placeCircularPoints carries the row through stack / bin / rim).
		get markRowCount() {
			return this.rawValues.length;
		}
		get markCount() {
			return this.rawValues.length;
		}
		get markDrawnTest() {
			if (this.timeWired) {
				const angles = this.angles;
				const values = this.rawValues;
				return (i) => Number.isFinite(angles[i]) && Number.isFinite(values[i]);
			}
			const place = this.placeValues;
			return (i) => Number.isFinite(place[i]);
		}
		get drawsPoints() {
			return !!this.draw;
		}
		get colourPointColour() {
			return this.colour;
		}
		// Size by: a dot with no size value keeps the series' dot radius, in its shape.
		get defaultRadius() {
			return this.radius ?? 3.4;
		}
		get pointShape() {
			return this.shape;
		}
		/**
		 * The dot radius the placements space dots by (stack, bin, rim): the series' own, or,
		 * sized by a column, its largest, so sized dots stack without overlapping.
		 */
		get placeRadius() {
			return this.sizeActive && this.drawsPoints ? this.sizeMaxRadius : this.radius;
		}

		timeWired = $derived(this.x?.refId >= 0);
		rawValues = $derived.by(() => cleanNumericColumn(this.y?.getData?.() ?? []));
		// Untimed series only: the phase values in the plot's display unit, which is where they
		// are placed (points, wedges, hover). Usually rawValues itself. When a timed series is
		// also wired the plot works in clock hours, so values recorded in degrees or radians are
		// converted to hours here; before, 90 degrees was drawn as 90 h (18 h on a 24 h clock).
		placeValues = $derived.by(() => {
			const p = this.parentPlot;
			return convertPhaseValues(this.rawValues, p.unit, p.displayUnit, p.period);
		});

		// Per-row phase, timed series only. Deliberately period-space (the same
		// convention as rawValues / stats.meanValue below), NOT the TAU-radian
		// output of timeToAngleRad — P.toXY / MeanVector expect a value in
		// [0, period) that they convert to radians themselves (see polar.js).
		// The TAU-radian conversion is only needed inside the Rayleigh-stats
		// machinery (weightedSeriesStats), which does its own conversion.
		// The clock the times are read on: the time column's own zone (per-column time zone;
		// David, 2026-10-22). A legacy session keeps UTC: its circular plots never read the
		// session's one zone, so their numbers stay.
		clockZone = $derived.by(() => {
			if (!this.timeWired) return 'utc';
			const c = columnClock(this.x);
			return c.legacy ? 'utc' : c.zone;
		});
		angles = $derived.by(() =>
			this.timeWired ? columnToPhaseHours(this.x.getData(), this.x.type, this.clockZone) : []
		);

		stats = $derived.by(() =>
			this.timeWired
				? weightedSeriesStats(
						this.x.getData(),
						this.x.type,
						this.y.getData(),
						this.parentPlot.period,
						this.clockZone
					)
				: this.untimedStats()
		);

		// Rayleigh stats on the values in their own unit (exact); only the mean direction is
		// re-expressed in the display unit, where the mean vector is drawn.
		untimedStats() {
			const p = this.parentPlot;
			const s = seriesStats(this.rawValues, p.unit, p.period);
			const [meanValue] = convertPhaseValues([s.meanValue], p.unit, p.displayUnit, p.period);
			return { ...s, meanValue };
		}

		get displayLabel() {
			return seriesDisplayLabel(this);
		}

		getLegendItem() {
			const s = this.stats;
			const rTxt = Number.isFinite(s.R) ? ` (R=${s.R.toFixed(2)})` : '';
			return {
				label: this.displayLabel + rTxt,
				// Coloured by a column, a neutral grey: the colour bar is the key (plan 3.8).
				elements: [
					{
						type: 'points',
						color: this.colourActive && !this.colourRefusal ? COLOUR_BY_SWATCH : this.colour,
						size: this.radius,
						shape: this.shape
					}
				]
			};
		}

		toJSON() {
			return {
				x: this.x,
				y: this.y,
				label: this.label,
				colour: this.#explicitColour,
				shape: this.shape,
				radius: this.radius,
				draw: this.draw,
				// Only while Colour by / Size by is on, so a plain series saves exactly as before.
				...this.encodingsJSON()
			};
		}
		static fromJSON(json, parent) {
			return new CircularPhaseSeries(parent, json);
		}
	}

	export class CircularPhaseClass {
		static descriptors = {
			padding: { group: 'Padding' },
			// A select, not free text: every keystroke of a typed unit would be a unit change.
			unit: { label: 'Values are in', input: 'select', options: ['hours', 'degrees', 'radians'] }
		};

		// Fields whose edit must convert others (plots/pairedEdits.js). Changing the unit the
		// values are recorded in converts the bin widths, which are stored in that unit, by
		// every edit route: Properties, the multi-select panel, an AI edit, the MCP settings.
		static pairedEdits = { unit: { apply: setCircularUnit } };
		// The colour-by host contract (components/plotbits/encodingHost.js): the points, per row,
		// in every placement. Rose wedges and mean vectors keep the series colour.
		static encodingCapabilities = { colour: true, size: true, lines: false };

		parentBox = $state();
		// Draw at the VIEW's size when one is given (a workflow node), else the figure's own.
		// See plots/viewBox.js for the whole story and why type scales with it.
		renderBox = $state(null);
		viewWidth = $derived(this.renderBox?.w ?? this.parentBox.width);
		viewHeight = $derived(this.renderBox?.h ?? this.parentBox.height);
		fontScale = $derived(viewFontScale(this.renderBox, this.parentBox));
		viewStyle = $derived(viewStyleFor(this.parentBox?.style, this.fontScale));
		data = $state([]);
		legend = $state();

		// The unit the phase column's values are recorded in ('radians' | 'degrees' | 'hours');
		// the angle axis is shown in it too. binWidth and wedgeBinWidth are stored in it, so a
		// change goes through pairedEdits, which converts them (circularPlot.setCircularUnit).
		unit = $state('hours');
		period = $state(24);
		placement = $state('stack'); // 'stack' | 'bin' | 'rim' — applies to untimed series
		binWidth = $state(1);
		showMeanVectors = $state(true);
		showWedges = $state(false);
		wedgeBinWidth = $state(2);
		showWatsonWilliams = $state(false);
		// Stored padding belongs to the FIGURE. A view that draws the type smaller needs
		// proportionally less room for it, so `padding` reads back SCALED while a renderBox is
		// set; the raw value is what gets saved. See plots/viewBox.js.
		#padding = $state({ top: 24, right: 20, bottom: 30, left: 20 });
		// A node view's own measured floor (fitViewPadding, plots/viewBox.js); never saved.
		viewPadFloor = $state(null);
		paddingScaled = $derived(
			scalePadding(
				this.#padding,
				this.fontScale,
				viewPadFloorFor(this.viewPadFloor, this.renderBox)
			)
		);
		get padding() {
			return this.renderBox ? this.paddingScaled : this.#padding;
		}
		set padding(v) {
			this.#padding = v;
		}
		// The stored figure padding, for the Padding controls. While a node view is mounted
		// `padding` reads back a derived, scaled copy, so an edit bound there was lost.
		get figurePadding() {
			return this.#padding;
		}

		// True when any series has a wired time column (value-radius clock mode).
		// A timed series' angles are always expressed in period-space HOURS
		// (columnToPhaseHours / weightedSeriesStats) regardless of `unit`, so
		// displayPeriod must stay in hours whenever a timed series is present —
		// otherwise the polar projection's period (radians/degrees) mismatches
		// the timed data's hours, mis-scaling the clock.
		hasTimed = $derived(this.data.some((d) => d.timeWired));
		// Every series is timed: Placement (stack / bin / rim) arranges untimed series only, so
		// it has nothing to act on and the panel disables it.
		allTimed = $derived(this.data.length > 0 && this.data.every((d) => d.timeWired));
		displayPeriod = $derived(
			this.hasTimed
				? displayPeriodFor('hours', this.period)
				: displayPeriodFor(this.unit, this.period)
		);
		// The unit the angle axis, and so the bin widths, are in: clock hours with a time wired.
		// Untimed series are converted from `unit` into it (CircularPhaseSeries.placeValues).
		displayUnit = $derived(this.hasTimed ? 'hours' : this.unit);
		// The room inside the padding. The plot is the largest square that fits, drawn at the
		// top left; an outside legend (legendAuto.svelte.js) takes its share of this first.
		availWidth = $derived(this.viewWidth - this.padding.left - this.padding.right);
		availHeight = $derived(this.viewHeight - this.padding.top - this.padding.bottom);
		// The square before any legend reservation: what 'auto' decides on (the acyclic rule).
		basePlotWidth = $derived(Math.max(40, Math.min(this.availWidth, this.availHeight)));
		basePlotHeight = $derived(this.basePlotWidth);
		plotSize = $derived(
			Math.max(
				40,
				Math.min(
					this.availWidth -
						this.legendLayout.reserveW -
						(this.legendCorner?.reserveW ?? 0) -
						this.encodingKeys.reserveW,
					this.availHeight - this.legendLayout.reserveH - (this.legendCorner?.reserveH ?? 0),
					this.clockFitSize
				)
			)
		);

		// The clock draws past its square: the hour labels LABEL_TOP px above the ring and the
		// hint line HINT_BOTTOM px below it, at fixed type sizes. The figure's padding takes
		// that in the workspace, but in a workflow node the padding shrinks with the type while
		// the overhang grows as the square does (38 - 0.09 x size px at the bottom), and the hint
		// line was cut off at the node's bottom edge. So, unless a legend strip below the clock
		// already clears it, the square is no larger than lets everything fit between the view's
		// top and bottom edges, and moves down (clockShiftY) when the labels need more room
		// above it than the top padding gives. Infinity when nothing limits it.
		#clockBelowStrip = $derived(
			this.legendLayout.outsidePlacement?.side === 'below' ||
				(this.legendCorner?.reserveH > 0 && !(this.legendCorner.offsetY > 0))
		);
		clockFitSize = $derived.by(() => {
			if (this.#clockBelowStrip) return Infinity;
			// From the square's top (below any top legend strip) to the view's bottom edge.
			const room = this.viewHeight - this.padding.top - (this.legendCorner?.offsetY ?? 0);
			const ringBottom = 0.5 + RING_RADIUS / 2; // the ring's lowest point, per square size
			return Math.min(
				(room - HINT_BOTTOM - 1) / ringBottom,
				// With the labels pushing the clock down: label reach + ring diameter + hint.
				(room + this.padding.top - LABEL_TOP - HINT_BOTTOM - 1) / RING_RADIUS
			);
		});
		clockShiftY = $derived.by(() => {
			if (this.#clockBelowStrip) return 0;
			const ringTop = (0.5 - RING_RADIUS / 2) * this.plotSize; // ring's top, from the square's
			const above = this.padding.top + (this.legendCorner?.offsetY ?? 0) + ringTop;
			return Math.max(0, LABEL_TOP - above);
		});

		// A corner legend (Top Right, the default, and the other three corners). On a polar plot
		// the corners of the square are small: a legend of a few long labels reaches in over the
		// ring and its hour labels ("24 / 0" under a Top Right legend). Such a legend gets room
		// of its own on its corner's side instead: a strip beside the clock (right for the right
		// corners, left for the left) or above / below it, whichever shrinks the clock least, and
		// the clock moves over by `offsetX` / `offsetY` when the strip is on its left or top. A
		// legend that fits in its corner clear of the ring stays there and costs nothing. Decided
		// on the square before any reservation, with the 'auto' obstacles (the acyclic rule in
		// legendAuto.svelte.js). Null when nothing is reserved.
		legendCorner = $derived.by(() => {
			const position = this.legend?.position;
			const box = this.legendLayout.box;
			if (!box || !LEGEND_CORNERS.has(position)) return null;
			const S = this.basePlotWidth;
			const M = box.margin ?? LEGEND_MARGIN;
			const right = position.endsWith('right');
			const top = position.startsWith('top');
			// Where Legend.svelte puts a corner legend over a plot of size S.
			const x = right ? S - box.width - M : M;
			const y = top ? M : S - box.height - M;
			const occupancy = buildOccupancy({ width: S, height: S, series: this.legendObstacles(S) });
			if (coveredFraction(occupancy, x, y, box.width, box.height) <= CLEAR_FRACTION) return null;
			// Beside clears the "6" / "18" labels; above, "24 / 0"; below, the hint line. A colour
			// bar (Colour by) shares a right strip with the legend (the wider sets it), and has a
			// strip of its own beside the clock otherwise, which the comparison counts.
			const keyW = this.keyStripWidth;
			const beside = this.roomBeside(
				right ? Math.max(box.width, keyW) : box.width,
				M,
				LABEL_REACH,
				true
			);
			const end = this.roomBeside(box.height, M, top ? LABEL_REACH : HINT_BOTTOM, false);
			const besideSize =
				keyW > 0 && !right
					? Math.min(beside.size, this.keyStripFor(keyW, M, this.availWidth - beside.reserve).size)
					: beside.size;
			const endSize =
				keyW > 0 ? Math.min(end.size, this.keyStripFor(keyW, M, this.availWidth).size) : end.size;
			if (besideSize >= endSize) {
				const offsetX = right ? 0 : beside.reserve;
				return { reserveW: beside.reserve, reserveH: 0, offsetX, offsetY: 0 };
			}
			return { reserveW: 0, reserveH: end.reserve, offsetX: 0, offsetY: top ? end.reserve : 0 };
		});

		legendLayout = new LegendAutoLayout(this, {
			obstacles: (w) => this.legendObstacles(w),
			outside: (box, { explicit }) => this.legendOutside(box, explicit)
		});

		// ---- Colour by / Size by: the keys (plan 3.7, 3.8; colourBySeries.svelte.js) ----
		// The corners of a polar square are small and the hour labels hang past the ring, so the
		// bar always sits BESIDE the clock, clear of the "6" label: under a legend that has a
		// strip on the right (outside, or a right-corner legend given a strip), else in a strip
		// of its own, centred on the clock. "Beside plot" is the only position offered.
		encodingKeys = new EncodingKeyLayout(this, {
			positions: ['right'],
			reserveW: () => this.colourStripReserveW,
			place: (keys) => this.colourKeyPlace(keys),
			// A category key's rows fit the strip beside the ring (colourKeyPlace's own room),
			// so the strip width reserved already counts any columns they wrap into.
			categoryRoom: () => this.basePlotHeight * RING_RADIUS
		});
		get colourScale() {
			return this.encodingKeys.scale;
		}
		set colourScale(v) {
			this.encodingKeys.scale = v;
		}
		get colourKey() {
			return this.encodingKeys.key;
		}
		// Size by: the size key's settings and content (plan 3.7).
		get sizeScale() {
			return this.encodingKeys.sizeScale;
		}
		set sizeScale(v) {
			this.encodingKeys.sizeScale = v;
		}
		get sizeKey() {
			return this.encodingKeys.sizeKey;
		}
		/**
		 * The keys' strip width: the wider of the colour bar and the size key (0 without
		 * either); decided before any reservation.
		 */
		keyStripWidth = $derived(
			Math.max(this.encodingKeys.base?.width ?? 0, this.encodingKeys.sizeBase?.width ?? 0)
		);
		/** The series legend sits in a strip on the clock's right, which the bar then shares. */
		legendSharesKeyStrip = $derived(
			this.legendLayout.outsidePlacement?.side === 'right' ||
				(this.legendCorner?.reserveW > 0 && !!this.legend?.position?.endsWith('right'))
		);
		/** A strip `extent` px wide beside the clock, out of `along` px (roomBeside, clearing "6"). */
		keyStripFor(extent, M, along) {
			return this.roomBeside(extent, M, LABEL_REACH, true, along);
		}
		/** The room the bar's own strip takes (0 when it shares the legend's, or has none). */
		colourStripReserveW = $derived.by(() => {
			const w = this.keyStripWidth;
			if (!(w > 0) || this.legendSharesKeyStrip) return 0;
			const along =
				this.availWidth - this.legendLayout.reserveW - (this.legendCorner?.reserveW ?? 0);
			return this.keyStripFor(w, this.legendLayout.margin, along).reserve;
		});

		/**
		 * Where the keys go, relative to the padding's top left: the colour bar ({ x, y,
		 * length }) with the size key under it ({ x, y } in `size`), as one block in the strip.
		 * Either may be absent (`length` null without a bar, `size` null without a size key).
		 */
		colourKeyPlace(keys) {
			const base = keys.base;
			const sizeBox = keys.sizeBase;
			const M = keys.margin;
			const size = this.plotSize;
			const corner = this.legendCorner;
			const box = this.legendLayout.box;
			const out = this.legendLayout.outsidePlacement;
			const fixed = keys.storedLength;
			// The size key's share of the block's height (it sits under the bar, M apart).
			const under = sizeBox ? sizeBox.height + (base ? M : 0) : 0;
			// The bar's length for `room` px of height for the whole block (bar, "no value", and
			// the size key under it).
			const fit = (room) => {
				if (!base) return null;
				if (fixed != null) return fixed;
				const besides = base.height - keys.length0;
				// Never under the bar's minimum (its end labels would crowd; ColourScale
				// minBarLength), nor longer than it would be.
				return Math.min(keys.length0, Math.max(keys.minLength, room - besides - under));
			};
			const barH = (length) => (base ? (keys.geometry(length)?.height ?? base.height) : 0);
			const at = (x, y, length) => ({
				x,
				y,
				length,
				size: sizeBox ? { x, y: base ? y + barH(length) + M : y } : null
			});
			if (out?.side === 'right' && box) {
				const y = out.y + box.height + M;
				return at(out.x, y, fit(this.availHeight - y));
			}
			if (this.legendSharesKeyStrip && corner && box) {
				// Right-aligned with the corner legend in its strip, under it or above it.
				const x = size + corner.reserveW - M - this.keyStripWidth;
				if (this.legend.position.startsWith('top')) {
					const y = M + box.height + M;
					return at(x, y, fit(size - y - M));
				}
				return at(x, M, fit(size - box.height - 3 * M));
			}
			// A strip of its own: past the ring and its labels, centred on the clock's middle.
			const k = 0.5 + RING_RADIUS / 2;
			const gap = Math.max(M, size * k + LABEL_REACH - size);
			const length = fit(size * RING_RADIUS);
			const height = barH(length) + under;
			const middle = (corner?.offsetY ?? 0) + this.clockShiftY + size / 2;
			return at((corner?.offsetX ?? 0) + size + gap, Math.max(0, middle - height / 2), length);
		}

		// An outside legend beside or below the square. It goes where the figure already has
		// spare room if either side does (costing the plot nothing); otherwise on the side that
		// shrinks the square least. 'Outside Right' chosen explicitly always goes right.
		legendOutside(box, explicit) {
			// The view's inset (scaled in a workflow node), carried on the box.
			const M = box.margin ?? LEGEND_MARGIN;
			// A colour bar (Colour by) stacks under a legend beside the clock (the wider sets the
			// strip); with the legend below, the bar takes a strip of its own, which counts.
			const keyW = this.keyStripWidth;
			const right = this.roomBeside(Math.max(box.width, keyW), M, LABEL_REACH, true);
			const below = this.roomBeside(box.height, M, HINT_BOTTOM, false);
			const belowSize =
				keyW > 0
					? Math.min(below.size, this.keyStripFor(keyW, M, this.availWidth).size)
					: below.size;
			if (explicit || right.size >= belowSize) {
				return {
					reserveW: right.reserve,
					reserveH: 0,
					x: right.size + right.gap,
					y: 0,
					side: 'right'
				};
			}
			return {
				reserveW: 0,
				reserveH: below.reserve,
				x: Math.max(0, (below.size - box.width) / 2),
				y: below.size + below.gap,
				side: 'below'
			};
		}

		// Room for a legend `extent` px deep in a strip on one side of the clock: beside it
		// (`horizontal`, extent = the box width) or above / below it (extent = its height).
		// Returns the clock size that leaves, the gap from the clock's square to the legend
		// and the strip's depth. The gap clears what the clock draws past its square on that
		// side, `beyond` px past the ring (the hour labels, or the hint line below), which
		// hangs further out the smaller the square is: hence the second case.
		roomBeside(extent, M, beyond, horizontal, alongIN = null) {
			const along = alongIN ?? (horizontal ? this.availWidth : this.availHeight);
			const across = horizontal ? this.availHeight : this.availWidth;
			const k = 0.5 + RING_RADIUS / 2; // the ring's reach from the square's middle, per S
			const overhang = (S) => S * k + beyond - S;
			let size = Math.min(across, along - extent - 2 * M);
			if (overhang(size) > M) size = Math.min(across, (along - extent - M - beyond) / k);
			size = Math.max(40, size);
			const gap = Math.max(M, overhang(size));
			return { size, gap, reserve: extent + M + gap };
		}

		// What a legend must not cover, in px over a size x size square: the outer ring with
		// its hour labels, the hint beneath, every point and the mean vectors. The inner grid
		// is not an obstacle: a legend over faint rings reads fine, one over data does not.
		legendObstacles(size) {
			const P = createPolar({
				cx: size / 2,
				cy: size / 2,
				radius: (size / 2) * RING_RADIUS,
				period: this.displayPeriod
			});
			const out = [];
			// Outer ring and labels: a band from the ring out past the label radius (+16 px).
			const ringX = [];
			const ringY = [];
			for (let k = 0; k <= 96; k++) {
				const [x, y] = P.toXY((this.displayPeriod * k) / 96, 1 + 16 / P.radius);
				ringX.push(x);
				ringY.push(y);
			}
			out.push({ px: ringX, py: ringY, line: true, radius: 18 });
			// The hint line under the plot (see PolarGrid).
			out.push({
				rects: [[P.cx - 110, P.cy + P.radius + 24, P.cx + 110, P.cy + P.radius + HINT_BOTTOM]]
			});
			const valueScale = timedValueScale(this.valueAxis);
			for (const d of this.data) {
				if (d.draw) {
					const px = [];
					const py = [];
					if (d.timeWired) {
						d.angles.forEach((ph, i) => {
							const v = d.rawValues[i];
							if (!Number.isFinite(ph) || !Number.isFinite(v)) return;
							const [x, y] = P.toXY(ph, valueScale(v));
							px.push(x);
							py.push(y);
						});
					} else {
						const placed = placeCircularPoints(d.placeValues, {
							placement: this.placement,
							period: this.displayPeriod,
							binWidth: this.binWidth,
							dotRadius: d.placeRadius,
							plotRadius: P.radius,
							maxStack: this.untimedMaxStack,
							innerRim: INNER_RIM,
							outerRim: OUTER_RIM
						});
						for (const pt of placed) {
							const [x, y] = P.toXY(pt.value, pt.r01);
							px.push(x);
							py.push(y);
						}
					}
					out.push({ px, py, radius: d.placeRadius });
				}
				if (this.showMeanVectors && Number.isFinite(d.stats?.meanValue)) {
					const [x, y] = P.toXY(d.stats.meanValue, d.stats.R);
					out.push({ px: [P.cx, x], py: [P.cy, y], line: true, radius: 4 });
				}
			}
			return out;
		}
		perSeriesStats = $derived.by(() =>
			this.data.map((d) => ({ label: d.displayLabel, colour: d.colour, ...d.stats }))
		);

		// Shared radial value axis (timed series only): [floor(min(0,dataMin)), ceil(dataMax)].
		valueAxis = $derived.by(() => {
			let dataMin = Infinity;
			let dataMax = -Infinity;
			for (const d of this.data) {
				if (!d.timeWired) continue;
				for (const v of d.rawValues) {
					if (!Number.isFinite(v)) continue;
					if (v < dataMin) dataMin = v;
					if (v > dataMax) dataMax = v;
				}
			}
			if (!Number.isFinite(dataMin) || !Number.isFinite(dataMax)) return [0, 1];
			return [niceAxisLimit(Math.min(0, dataMin), 'floor'), niceAxisLimit(dataMax, 'ceil')];
		});

		// Largest stack/bin column height across untimed series, so `placeCircularPoints`
		// can fit-scale the dodge step instead of overflowing the plot radius.
		untimedMaxStack = $derived.by(() =>
			maxStackHeight(
				this.data.filter((d) => !d.timeWired).map((d) => d.placeValues),
				{
					placement: this.placement,
					period: this.displayPeriod,
					binWidth: this.binWidth,
					quant: 0.5
				}
			)
		);

		// Watson-Williams across UNTIMED series' mean directions only. WW is an
		// unweighted-event circular ANOVA (Fisher/Batschelet): it compares samples
		// of discrete angle observations. A timed series is a continuous,
		// amplitude-weighted rhythm (its concentration comes from the *values*,
		// not from event density — evenly-sampled time points fold to a uniform,
		// near-zero-R angle distribution regardless of the underlying rhythm), so
		// it has no valid unweighted-event representation to feed WW and is
		// excluded rather than silently misrepresented.
		ww = $derived.by(() => {
			if (!this.showWatsonWilliams) return null;
			const groups = this.data
				.filter((d) => !d.timeWired)
				.map((d) => toRadiansColumn(d.rawValues, this.unit, this.period));
			return watsonWilliams(groups, pUpperFromF);
		});

		constructor(parent, dataIN) {
			this.parentBox = parent;
			this.legend = new LegendClass(dataIN?.legend);
			// single-input create path (drag-wire onto an empty node, or a flat legacy payload)
			if (dataIN && (dataIN.time || dataIN.values || dataIN.column || dataIN.x || dataIN.y))
				this.addData(dataIN);
		}

		addData(dataIN) {
			this.addSeries(dataIN);
			ensureUniqueEncodingIds(this);
		}
		addSeries(dataIN) {
			// Public wiring shape is {time, values}; remap to the internal {x, y}
			// convention shared with Periodogram/Actogram/Correlogram/FFT (preserving
			// any other keys, e.g. label/colour, unlike the sibling plots' remap).
			let payload = dataIN;
			if (dataIN && Object.keys(dataIN).includes('time')) {
				payload = {
					...dataIN,
					x: { refId: dataIN.time?.refId ?? -1 },
					y: { refId: dataIN.values?.refId ?? -1 }
				};
			}
			this.data.push(new CircularPhaseSeries(this, payload));
		}
		removeData(idx) {
			this.data.splice(idx, 1);
		}

		getLegendItems = $derived.by(() => {
			const items = [];
			this.data.forEach((d) => {
				const li = d.getLegendItem();
				if (li) items.push(li);
			});
			return items;
		});

		// No Cartesian axes; padding is fixed/symmetric. Present as a no-op so the
		// generic plot lifecycle (which may call autoScalePadding) is satisfied.
		autoScalePadding() {}

		getDownloadData() {
			const headers = ['Series', 'n', 'mean_or_acrophase', 'R', 'z', 'p'];
			const rows = this.perSeriesStats.map((s) => [
				s.label,
				s.n,
				Number.isFinite(s.meanValue) ? s.meanValue : '',
				Number.isFinite(s.R) ? s.R : '',
				Number.isFinite(s.z) ? s.z : '',
				Number.isFinite(s.pValue) ? s.pValue : ''
			]);
			const w = this.ww;
			if (w && w.valid) {
				rows.push([`Watson-Williams F(${w.df1},${w.df2})`, w.N, '', '', w.F, w.pValue]);
			}
			return { headers, rows };
		}

		toJSON() {
			return {
				unit: this.unit,
				period: this.period,
				placement: this.placement,
				binWidth: this.binWidth,
				showMeanVectors: this.showMeanVectors,
				showWedges: this.showWedges,
				wedgeBinWidth: this.wedgeBinWidth,
				showWatsonWilliams: this.showWatsonWilliams,
				padding: this.#padding,
				data: this.data,
				legend: this.legend.toJSON(),
				// The colour bar's settings, while any series is coloured by a column.
				...this.encodingKeys.toJSON()
			};
		}
		static fromJSON(parent, json) {
			const c = new CircularPhaseClass(parent, null);
			if (!json) return c;
			c.unit = json.unit ?? 'hours';
			c.period = json.period ?? 24;
			c.placement = json.placement ?? 'stack';
			c.binWidth = json.binWidth ?? 1;
			c.showMeanVectors = json.showMeanVectors ?? true;
			c.showWedges = json.showWedges ?? false;
			c.wedgeBinWidth = json.wedgeBinWidth ?? 2;
			c.showWatsonWilliams = json.showWatsonWilliams ?? false;
			c.padding = json.padding ?? c.padding;
			c.legend = LegendClass.fromJSON(json.legend);
			// `show` defaults on: a bar absent from the file (not coloured when saved) comes back.
			c.colourScale = json.colourScale ?? null;
			c.sizeScale = json.sizeScale ?? null;
			if (json.data) {
				c.data = json.data.map((d) => CircularPhaseSeries.fromJSON(d, c));
				ensureUniqueEncodingIds(c);
			} else if (json.column)
				c.addData({ column: json.column }); // very old flat single-series sessions
			else if (json.dataIn) c.addData(json.dataIn); // creation-time hint (mirrors sibling plots)
			return c;
		}
	}

	export const definition = {
		defaultDataInputs: ['time', 'values'],
		controlHeaders: ['Properties', 'Data'],
		displayName: 'Circular phase plot',
		plotClass: CircularPhaseClass
	};
</script>

<script>
	import { appState } from '$lib/core/core.svelte';
	import { editPlotInners } from '$lib/plots/pairedEdits.js';
	import { tick } from 'svelte';
	import { flip } from 'svelte/animate';
	import { slide } from 'svelte/transition';
	import { dataSettingsScrollTo } from '$lib/components/views/dataSettingsScroll.js';
	import PlotTooltip from '$lib/components/plotbits/PlotTooltip.svelte';
	import Encoding from '$lib/components/plotbits/Encoding.svelte';
	import ColourScale from '$lib/components/plotbits/ColourScale.svelte';
	import SizeKey from '$lib/components/plotbits/SizeKey.svelte';
	import {
		bindAltTooltipToggle,
		computeTooltipPosition,
		dispatchTooltip,
		escapeHtml,
		hideTooltip,
		safeColour
	} from '$lib/components/plotbits/helpers/tooltipHelpers.js';

	let { theData, which } = $props();

	const fmt = (v, dp = 3) => (Number.isFinite(v) ? v.toFixed(dp) : '—');
	const fmtP = (p) => (Number.isFinite(p) ? (p < 1e-4 ? '< 0.0001' : p.toFixed(4)) : '—');
	// Value-unit suffix for the placement bin-width control.
	const unitSuffix = (u) => (u === 'hours' ? 'h' : u === 'degrees' ? '°' : 'rad');

	// Format one observation's phase for the tooltip: HH:MM clock time when the
	// plot unit is 'hours' (the value is already expressed on the display period),
	// otherwise a plain number with the unit suffix.
	function fmtPhase(value, unit, period) {
		if (!Number.isFinite(value)) return '—';
		if (unit === 'hours') {
			const p = Number.isFinite(period) && period > 0 ? period : 24;
			const v = ((value % p) + p) % p;
			const periodMinutes = Math.round(p * 60);
			let totalMinutes = Math.round(v * 60);
			if (totalMinutes >= periodMinutes) totalMinutes -= periodMinutes;
			const hh = Math.floor(totalMinutes / 60);
			const mm = totalMinutes % 60;
			return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
		}
		return `${fmt(value, unit === 'degrees' ? 1 : 3)}${unitSuffix(unit)}`;
	}

	let tooltip = $state({ visible: false, x: 0, y: 0, content: '' });
	const handleTooltip = bindAltTooltipToggle(
		() => tooltip,
		(v) => {
			tooltip = v;
		}
	);

	// Hover on a series' merged points <path>: map the pointer to the polar
	// projection's data space, then snap to the nearest observation in that
	// series by circular (wrap-around) distance on the display period. Untimed
	// series search by phase in the display unit (placeValues); timed series by time-of-day
	// (angles, period-space hours).
	function handleSeriesHover(evt, plot, P, d) {
		const svg = evt.currentTarget.ownerSVGElement;
		const ctm = svg?.getScreenCTM();
		if (!ctm) return;
		const pt = new DOMPoint(evt.clientX, evt.clientY).matrixTransform(ctm.inverse());
		const { value } = P.fromXY(pt.x, pt.y);
		const period = P.period;
		const positions = d.timeWired ? d.angles : d.placeValues;

		let bestIdx = -1;
		let bestDist = Infinity;
		positions.forEach((v, i) => {
			if (!Number.isFinite(v)) return;
			const diff = Math.abs(v - value) % period;
			const dist = Math.min(diff, period - diff);
			if (dist < bestDist) {
				bestDist = dist;
				bestIdx = i;
			}
		});
		if (bestIdx < 0) {
			hideTooltip(evt.currentTarget);
			return;
		}

		// Same two surfaces as buildAggregatedContent: the label is text (escaped) and
		// the colour is a `style` attribute (shape-validated, then escaped).
		// A coloured series' dot is in the hovered row's own colour.
		const cb = d.colourRender;
		const b = cb ? (cb.idx[bestIdx] ?? -1) : -1;
		const dotColour = cb ? (b >= 0 ? cb.colours[b] : cb.noValueColour) : d.colour;
		const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${escapeHtml(
			safeColour(dotColour)
		)};margin-right:4px;vertical-align:middle;"></span>`;
		const content = d.timeWired
			? `${dot}<strong>${escapeHtml(d.displayLabel)}</strong><br/><span style="opacity:0.7">time:</span> ${fmtPhase(d.angles[bestIdx], 'hours', plot.period)}<br/><span style="opacity:0.7">value:</span> ${fmt(d.rawValues[bestIdx])}`
			: `${dot}<strong>${escapeHtml(d.displayLabel)}</strong><br/><span style="opacity:0.7">phase:</span> ${fmtPhase(d.rawValues[bestIdx], plot.unit, plot.period)}${
					// Mixed plot: the value as recorded, then where it sits on the clock.
					plot.displayUnit !== plot.unit
						? ` (${fmtPhase(d.placeValues[bestIdx], plot.displayUnit, plot.period)})`
						: ''
				}`;

		// Coloured or sized by a column: the row's encoded values too (no encoding is the only
		// channel).
		const colourLine = [cb, d.sizeRender]
			.filter((enc) => enc)
			.map(
				(enc) =>
					`<br/><span style="opacity:0.7">${escapeHtml(enc.label)}:</span> ${escapeHtml(enc.format(enc.values[bestIdx]))}`
			)
			.join('');

		const { x: xPos, y: yPos } = computeTooltipPosition(evt.clientX, evt.clientY);
		dispatchTooltip(evt.currentTarget, {
			visible: true,
			x: xPos,
			y: yPos,
			content: content + colourLine
		});
	}

	// One series' dots in px (row order) and the marker paths for them. A timed series draws
	// row i at (time of day, value); an untimed one where placeCircularPoints puts it, which
	// carries each dot's row (`index`) through stack, bin and rim.
	function seriesPaths(plot, P, valueScale, d) {
		const px = [];
		const py = [];
		const marks = [];
		if (d.timeWired) {
			d.angles.forEach((ph, i) => {
				const v = d.rawValues[i];
				if (!Number.isFinite(ph) || !Number.isFinite(v)) return;
				const [x, y] = P.toXY(ph, valueScale(v));
				px.push(x);
				py.push(y);
				marks.push(i);
			});
		} else {
			const placed = placeCircularPoints(d.placeValues, {
				placement: plot.placement,
				period: plot.displayPeriod,
				binWidth: plot.binWidth,
				dotRadius: d.placeRadius,
				plotRadius: P.radius,
				maxStack: plot.untimedMaxStack,
				innerRim: INNER_RIM,
				outerRim: OUTER_RIM
			});
			for (const p of placed) {
				const [x, y] = P.toXY(p.value, p.r01);
				px.push(x);
				py.push(y);
				marks.push(p.index);
			}
		}
		return markerPaths(px, py, {
			shape: d.shape,
			radius: d.radius,
			colour: d.colour,
			colourBy: d.colourRender,
			sizeBy: d.sizeRender,
			marks
		});
	}

	function handleSeriesLeave(evt) {
		hideTooltip(evt.currentTarget);
	}
</script>

{#snippet plot(theData)}
	{@const plot = theData.plot}
	{@const size = plot.plotSize}
	{@const corner = plot.legendCorner}
	{@const cx = plot.padding.left + (corner?.offsetX ?? 0) + size / 2}
	{@const cy = plot.padding.top + (corner?.offsetY ?? 0) + plot.clockShiftY + size / 2}
	{@const P = createPolar({ cx, cy, radius: (size / 2) * RING_RADIUS, period: plot.displayPeriod })}
	{@const hasTimed = plot.hasTimed}
	{@const valueScale = timedValueScale(plot.valueAxis)}
	{@const valueTicks = hasTimed ? timedValueTicks(plot.valueAxis) : []}
	<svg
		id={'plot' + plot.parentBox.id}
		width={plot.viewWidth}
		height={plot.viewHeight}
		viewBox="0 0 {plot.viewWidth} {plot.viewHeight}"
		style="background: var(--surface-card); position: absolute;"
		ontooltip={handleTooltip}
	>
		<PolarGrid
			projection={P}
			rings={hasTimed ? valueTicks.map((k) => k.r01) : undefined}
			hint={hasTimed
				? `value ${plot.valueAxis[0]}–${plot.valueAxis[1]} · period ${plot.displayPeriod} ${unitSuffix(plot.displayUnit)}`
				: `phase · period ${plot.displayPeriod} ${unitSuffix(plot.displayUnit)}`}
		/>

		{#each plot.data as d (d.x.id + '-' + d.y.id)}
			{#if !d.timeWired && plot.showWedges}
				<RoseWedges
					projection={P}
					values={d.placeValues}
					binWidth={plot.wedgeBinWidth}
					colour={d.colour}
				/>
			{/if}
			{#if d.draw}
				<!-- One path in the series colour, or one per colour bucket (and size layer) when the
				     series is coloured (or sized) by a column (markerPaths.js); every row keeps its
				     own colour and size in each placement, since the placement carries the row. -->
				{#each seriesPaths(plot, P, valueScale, d) as p (p.key)}
					<path
						d={p.d}
						fill={p.fill}
						fill-opacity="0.9"
						data-colour-bucket={d.colourRender ? p.key : undefined}
						data-size-layer={d.sizeRender ? p.layer : undefined}
						role="presentation"
						onpointermove={(evt) => handleSeriesHover(evt, plot, P, d)}
						onpointerleave={handleSeriesLeave}
					/>
				{/each}
			{/if}
			{#if plot.showMeanVectors}
				<MeanVector projection={P} value={d.stats.meanValue} length={d.stats.R} colour={d.colour} />
			{/if}
		{/each}

		<!-- Radial scale labels: the value ticks (timed) or R = 0.5 / 1 (untimed). Drawn AFTER
		     the data, with a halo in the plot's own background colour (paint-order: stroke
		     first), so a point under a label can never make it illegible. The halo colour is a
		     CSS variable, which the export resolves like every other paint (exportStyle.js). -->
		<g
			class="radial-scale-labels"
			font-size="9"
			fill="var(--color-lightness-50)"
			stroke="var(--surface-card)"
			stroke-width="3"
			stroke-linejoin="round"
			paint-order="stroke"
		>
			{#if hasTimed}
				{#each valueTicks as { t, r01 } (t)}
					<!-- On its ring (centred on the line, the halo parting it), right of the 0
					     spoke; the axis minimum on the inner rim's ring. -->
					<text x={P.cx + 3} y={P.cy - P.radius * r01 + 3.5}>{t}</text>
				{/each}
			{:else}
				{#each [0.5, 1] as f (f)}
					<text x={P.cx + 3} y={P.cy - P.radius * f + 4}>R={f}</text>
				{/each}
			{/if}
		</g>

		<Legend
			figureStyle={plot.viewStyle}
			legendData={plot.legend}
			items={plot.getLegendItems}
			plotWidth={size + (corner?.reserveW ?? 0)}
			plotHeight={size + (corner?.reserveH ?? 0)}
			padding={plot.padding}
			autoPlacement={plot.legendLayout.auto}
			outsidePosition={plot.legendLayout.outsidePosition}
			which="plot"
		/>
		<!-- Colour by: the colour bar, beside the clock clear of its labels and the legend. -->
		{#if plot.encodingKeys.drawProps}
			<ColourScale {...plot.encodingKeys.drawProps} which="plot" />
		{/if}
		{#if plot.encodingKeys.sizeDrawProps}
			<SizeKey {...plot.encodingKeys.sizeDrawProps} which="plot" />
		{/if}
	</svg>
	<PlotTooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} content={tooltip.content} />
{/snippet}

{#snippet controls(theData)}
	{#if appState.currentControlTab === 'properties'}
		<div class="div-line"></div>

		<Legend
			legendData={theData.legend}
			figureStyle={theData.parentBox?.style}
			canPlaceOutside={theData.legendLayout.canPlaceOutside}
			which="controls"
		/>

		{#if theData.colourKey}
			<div class="div-line"></div>
			<!-- The colour bar of Colour by (a series' Data settings); always beside the clock. -->
			<ColourScale
				scaleData={theData.colourScale}
				categories={theData.colourKey?.categorical ? theData.colourKey.categories : null}
				figureStyle={theData.parentBox?.style}
				positions={theData.encodingKeys.positions}
				which="controls"
			/>
		{/if}
		{#if theData.sizeKey}
			<div class="div-line"></div>
			<!-- The size key of Size by. -->
			<SizeKey
				scaleData={theData.sizeScale}
				figureStyle={theData.parentBox?.style}
				positions={theData.encodingKeys.positions}
				which="controls"
			/>
		{/if}
		<div class="div-line"></div>

		<div class="control-component">
			<div class="control-component-title"><p>Angle</p></div>
			{#if theData.allTimed}
				<p class="cp-hint">A time is wired: angle is always clock hours.</p>
			{:else if theData.hasTimed}
				<p class="cp-hint">
					A time is wired, so the clock is in hours. Series without a time are read in the unit
					below and converted to hours.
				</p>
			{/if}
			<!-- Stacked: side by side, the unit select was half the panel and cut "Clock hours"
			     to "Clock h...". -->
			<div class="control-input-vertical">
				<!-- Hidden only when every series is timed: in a mixed plot a series without a time
				     still needs its unit (its values are converted to clock hours). -->
				{#if !theData.allTimed}
					<ControlInput label="Values are in">
						<select
							value={theData.unit}
							onchange={(e) =>
								editPlotInners(
									[theData.parentBox ?? { plot: theData }],
									'unit',
									e.currentTarget.value
								)}
						>
							<option value="hours">Clock hours</option>
							<option value="degrees">Degrees</option>
							<option value="radians">Radians</option>
						</select>
					</ControlInput>
				{/if}
				{#if theData.hasTimed || theData.unit === 'hours'}
					<ControlInput label="Period (h)">
						<NumberWithUnits bind:value={theData.period} min="0.1" step="1" />
					</ControlInput>
				{/if}
			</div>
		</div>
		<div class="div-line"></div>

		<div class="control-component">
			<div class="control-component-title"><p>Points</p></div>
			{#if theData.allTimed}
				<p class="cp-hint">
					Every series has a time column, so each point sits at its measured value on the radial
					axis. Placement arranges series without a time column only.
				</p>
			{:else}
				<p class="cp-hint">Placement applies to series without a wired time column.</p>
			{/if}
			<div class="control-input-horizontal">
				<ControlInput label="Placement">
					<select
						bind:value={theData.placement}
						disabled={theData.allTimed}
						title={theData.allTimed
							? 'Every series has a time column, so there are no untimed points to place'
							: undefined}
					>
						<option value="stack">Stacked</option>
						<option value="bin">Binned</option>
						<option value="rim">On circumference</option>
					</select>
				</ControlInput>
				{#if theData.placement === 'bin' && !theData.allTimed}
					<ControlInput label={`Bin (${unitSuffix(theData.displayUnit)})`}>
						<NumberWithUnits bind:value={theData.binWidth} min="0.05" step="0.5" />
					</ControlInput>
				{/if}
			</div>
		</div>
		<div class="div-line"></div>

		<div class="control-component">
			<label class="cp-toggle"
				><input type="checkbox" bind:checked={theData.showMeanVectors} /> Mean resultant vectors</label
			>
			<label class="cp-toggle"
				><input type="checkbox" bind:checked={theData.showWedges} /> Rose wedges (circular histogram)</label
			>
			{#if theData.showWedges}
				<ControlInput label={`Wedge bin (${unitSuffix(theData.displayUnit)})`}>
					<NumberWithUnits bind:value={theData.wedgeBinWidth} min="0.05" step="0.5" />
				</ControlInput>
			{/if}
			<label class="cp-toggle"
				><input type="checkbox" bind:checked={theData.showWatsonWilliams} /> Watson-Williams test (equal
				mean direction)</label
			>
		</div>

		{#if theData.showWatsonWilliams && theData.ww}
			<div class="cp-ww">
				{#if theData.ww.valid}
					<p>
						F({theData.ww.df1}, {theData.ww.df2}) = {fmt(theData.ww.F, 3)}, p = {fmtP(
							theData.ww.pValue
						)}
					</p>
				{:else}
					<p class="cp-hint">
						Wire two or more phase columns without a time (Watson-Williams compares untimed groups'
						unweighted event angles) to compare mean directions.
					</p>
				{/if}
			</div>
		{/if}
	{:else if appState.currentControlTab === 'data'}
		<div id="dataSettings">
			<DataAddHeader
				count={theData.data.length}
				onadd={async () => {
					theData.addData({});
					await tick();
					dataSettingsScrollTo('bottom');
				}}
			/>

			{#each theData.data as datum, i (datum.x.id + '-' + datum.y.id)}
				<div
					class="dataBlock"
					animate:flip={{ duration: 500 }}
					in:slide={{ duration: 500, axis: 'y' }}
					out:slide={{ duration: 500, axis: 'y' }}
				>
					<SeriesBlockHeader inner={theData} {datum} index={i} />
					<div class="data-wrapper">
						<div class="y-select">
							<ControlInput label="Time (optional)"></ControlInput>
							<Column col={datum.x} canChange={true} />
							{#if datum.x.refId >= 0}
								<button
									type="button"
									class="icon"
									onclick={() => {
										datum.x.refId = -1;
									}}
								>
									<Icon name="reset" width={14} height={14} />
								</button>
							{/if}
						</div>
						<div class="y-select">
							<ControlInput label="Values (phase column)"></ControlInput>
							<Column col={datum.y} canChange={true} />
						</div>
						{#if datum.timeWired}
							<p class="cp-hint">
								Time wired: this series plots as a value-radius clock (point radius = value; angle =
								time-of-day).
							</p>
						{/if}
						<div class="control-input-horizontal">
							<div class="control-input control-input-swatch">
								<p>Col</p>
								<ColourPicker bind:value={datum.colour} />
							</div>
							<ControlInput label="Shape">
								<select bind:value={datum.shape}>
									{#each POINT_SHAPES as s, si (s)}
										<option value={s}>{POINT_SHAPE_LABELS[si]}</option>
									{/each}
								</select>
							</ControlInput>
							<ControlInput label="Size">
								<NumberWithUnits bind:value={datum.radius} min="0.5" step="0.5" />
							</ControlInput>
						</div>
						{#if datum.draw}
							<Encoding {datum} />
						{/if}
					</div>

					{#if datum.stats}
						<p class="cp-stat">
							n {datum.stats.n} ·
							{#if datum.timeWired}acrophase {fmtPhase(
									datum.stats.meanValue,
									'hours',
									theData.period
								)} ·{/if}
							R {fmt(datum.stats.R, 3)}
							<!-- Timed series have no Rayleigh z or p: the values are weights, and the
							     weighted p moves with the series' baseline (weightedSeriesStats). -->
							{#if !datum.timeWired}· z {fmt(datum.stats.z, 2)} · p {fmtP(datum.stats.pValue)}{/if}
						</p>
					{/if}
					<div class="div-line"></div>
				</div>
			{/each}
		</div>
	{/if}
{/snippet}

{#if which === 'plot'}
	{@render plot(theData)}
{:else if which === 'controls'}
	{@render controls(theData)}
{/if}

<style>
	.cp-toggle {
		display: flex;
		align-items: center;
		gap: var(--space-2, 0.4rem);
		font-size: var(--font-sm);
		margin: 0.2rem 0;
	}
	.cp-ww,
	.cp-stat,
	.cp-hint {
		font-size: var(--font-sm);
		opacity: 0.85;
		margin: 0.2rem 0;
	}
</style>
