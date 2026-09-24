// @ts-nocheck
// The reactive half of legend placement, shared by every plot that draws a legend.
//
// legendLayout.js holds the pure geometry (box size, occupancy grid, candidate choice). This
// class wires it to a plot: it measures the legend box from the plot's own items and figure
// style, rasterises the plot's marks through a callback the plot supplies, resolves 'auto',
// and says how much room an OUTSIDE legend takes from the plot area and where it goes.
//
// THE ONE RULE THAT KEEPS THIS ACYCLIC. The plot's drawing area depends on the reservation,
// and the reservation depends on the decision, so the decision must be made on the area
// BEFORE any reservation: the host exposes `basePlotWidth` / `basePlotHeight` (padding only),
// and the obstacles callback must map data with scales built from domains and those base
// sizes, never with the plot's own scales (whose ranges depend on the reservation).
//
// Host contract (all reactive getters on the plot class):
//   legend           LegendClass
//   getLegendItems   the legend's items
//   viewStyle        the figure style the legend is drawn with
//   basePlotWidth    plot-area width before an outside legend is reserved
//   basePlotHeight   plot-area height before an outside legend is reserved
import { resolveStyle } from '$lib/plots/figureStyle.js';
import {
	LEGEND_MARGIN,
	measureLabelWidths,
	legendBoxSize,
	buildOccupancy,
	chooseLegendPlacement
} from './legendLayout.js';

/**
 * Outside placement for a Cartesian plot: to the right of the plot area (past the right
 * axis when there is one), top-aligned, taking its width from the plot area.
 *
 * @param {() => {baseWidth: number, hasRightAxis?: boolean, paddingRight?: number}} get
 */
export function rightOfPlot(get) {
	return (box) => {
		const { baseWidth, hasRightAxis = false, paddingRight = 0 } = get();
		const reserveW = box.width + LEGEND_MARGIN + (hasRightAxis ? LEGEND_MARGIN : 0);
		const plotW = baseWidth - reserveW;
		return {
			reserveW,
			reserveH: 0,
			x: plotW + (hasRightAxis ? paddingRight : 0) + LEGEND_MARGIN,
			y: 0,
			side: 'right'
		};
	};
}

export class LegendAutoLayout {
	#host;
	#obstacles;
	#outside;

	/**
	 * @param {object} host the plot class instance (see the contract above)
	 * @param {object} opts
	 * @param {(w: number, h: number) => Array<object>} opts.obstacles the plot's marks, in px
	 *   over a w x h plot area, as buildOccupancy series
	 * @param {((box: {width:number,height:number}, o: {explicit: boolean}) =>
	 *   {reserveW:number, reserveH:number, x:number, y:number, side:string}) | null} [opts.outside]
	 *   where an outside legend goes and what it costs; null when the plot cannot make room
	 */
	constructor(host, { obstacles, outside = null }) {
		this.#host = host;
		this.#obstacles = obstacles;
		this.#outside = outside;
	}

	get canPlaceOutside() {
		return !!this.#outside;
	}

	/** Font size the legend is drawn at: a per-legend override, else the figure's. */
	fontPx = $derived.by(() => {
		const legend = this.#host.legend;
		return legend?.fontSize ?? resolveStyle(this.#host.viewStyle).sizes.legend;
	});

	/** The legend box in px, or null when there is nothing to draw. */
	box = $derived.by(() => {
		const legend = this.#host.legend;
		const items = this.#host.getLegendItems ?? [];
		if (!legend?.show || items.length === 0) return null;
		const labelWidths = measureLabelWidths(
			items.map((it) => it.label),
			this.fontPx,
			resolveStyle(this.#host.viewStyle).fontFamily
		);
		return legendBoxSize({
			labelWidths,
			fontPx: this.fontPx,
			padding: legend.padding,
			itemSpacing: legend.itemSpacing,
			orientation: legend.orientation
		});
	});

	/** Where the marks are, over the plot area before any reservation. */
	occupancy = $derived.by(() => {
		if (this.#host.legend?.position !== 'auto' || !this.box) return null;
		const w = this.#host.basePlotWidth;
		const h = this.#host.basePlotHeight;
		if (!(w > 0) || !(h > 0)) return null;
		return buildOccupancy({ width: w, height: h, series: this.#obstacles(w, h) ?? [] });
	});

	/** The resolved 'auto' placement ({ outside, name, x, y, covered }), or null. */
	auto = $derived.by(() => {
		if (!this.occupancy) return null;
		return chooseLegendPlacement({
			occupancy: this.occupancy,
			plotW: this.#host.basePlotWidth,
			plotH: this.#host.basePlotHeight,
			boxW: this.box.width,
			boxH: this.box.height,
			margin: LEGEND_MARGIN,
			allowOutside: !!this.#outside
		});
	});

	/** The outside placement in force, or null when the legend is inside (or hidden). */
	outsidePlacement = $derived.by(() => {
		if (!this.box || !this.#outside) return null;
		const position = this.#host.legend?.position;
		if (position === 'outsideright') return this.#outside(this.box, { explicit: true });
		if (position === 'auto' && this.auto?.outside) {
			return this.#outside(this.box, { explicit: false });
		}
		return null;
	});

	/** Room taken from the plot area, in px. */
	reserveW = $derived(this.outsidePlacement?.reserveW ?? 0);
	reserveH = $derived(this.outsidePlacement?.reserveH ?? 0);

	/** Legend position relative to the plot area when outside, for <Legend outsidePosition>. */
	outsidePosition = $derived(
		this.outsidePlacement ? { x: this.outsidePlacement.x, y: this.outsidePlacement.y } : null
	);
}
