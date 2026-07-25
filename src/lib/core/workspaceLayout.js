/**
 * Arrange a session's plots into a workspace grid.
 *
 * Every plot is born at the same default position, so a session that adds several without moving
 * them ends up with the whole set stacked in one place. This packs them instead: sensible size per
 * plot type, then shelf-packing into columns.
 *
 * Kept free of Svelte and of `core` so it stays a pure function: the demo generator calls it
 * headlessly, and it is the obvious basis for a "tidy plots" action later.
 */

/** Two columns of this width fit a normal laptop workspace without horizontal scrolling. */
const DEFAULT_SIZE = { width: 520, height: 300 };

/**
 * Draggable.svelte wraps every plot in side chrome and a header bar, so the box that occupies the
 * canvas is bigger than the plot's own width/height. Laying out on the bare numbers leaves rows
 * overlapping by the height of the header, which is invisible in the data and obvious on screen.
 */
export const PLOT_CHROME = { x: 20, y: 50 };

const outerWidth = (w) => w + PLOT_CHROME.x;
const outerHeight = (h) => h + PLOT_CHROME.y;

/**
 * Per-type sizes. The distinction that matters is aspect: a matrix or a polar plot is unreadable
 * squashed into a wide, short box, and a table wants width for its columns but little height.
 */
const SIZE_BY_TYPE = {
	pairsplot: { width: 520, height: 460 },
	correlationheatmap: { width: 520, height: 440 },
	circularphase: { width: 440, height: 440 },
	actogram: { width: 520, height: 440 },
	tableplot: { width: 520, height: 260 },
	histogram: { width: 520, height: 300 },
	boxplot: { width: 520, height: 300 },
	meansem: { width: 520, height: 300 },
	scatterplot: { width: 520, height: 300 },
	periodogram: { width: 520, height: 300 },
	correlogram: { width: 520, height: 300 },
	fft: { width: 520, height: 300 }
};

export function plotSizeFor(type) {
	return SIZE_BY_TYPE[type] ?? DEFAULT_SIZE;
}

/**
 * Vertical space a faceted plot needs for the children it will spawn.
 *
 * Mirrors syncFacetChildren in Plot.svelte, which lays children out in a ceil(sqrt(n)) grid
 * starting one plot-height plus two paddings below the generator. Reserving it here is what stops
 * a facet's children from landing on top of whatever was packed beneath it.
 */
export function facetFootprint({ width, height }, childCount, padding = 15) {
	if (!childCount) return { width: outerWidth(width), height: outerHeight(height) };
	const cols = Math.max(1, Math.ceil(Math.sqrt(childCount)));
	const rows = Math.ceil(childCount / cols);
	const stepX = outerWidth(width) + padding;
	const stepY = outerHeight(height) + padding;
	return {
		width: cols * stepX - padding,
		// The generator itself, the gap beneath it, then the child grid.
		height: outerHeight(height) + 2 * padding + rows * stepY - padding
	};
}

/**
 * Place every top-level plot, mutating x/y/width/height in place.
 *
 * Facet CHILDREN are skipped: they are derived, and syncFacetChildren repositions them relative to
 * their parent whenever it reconciles, so anything written here would be overwritten anyway.
 *
 * Packing is shortest-column-first rather than strict row-major, so a tall plot beside a short one
 * does not leave a hole underneath the short one.
 *
 * @param plots            the session's plots
 * @param facetChildCounts map of plot id → number of children it will spawn
 */
export function layoutWorkspacePlots(plots, opts = {}) {
	const {
		columns = 2,
		gutter = 30,
		originX = 60,
		originY = 60,
		padding = 15,
		facetChildCounts = {}
	} = opts;

	const top = (plots ?? []).filter((p) => p && p.facetParent == null);
	if (top.length === 0) return plots;

	// A faceted plot is as wide as its child grid, so it can need more than one column's width.
	const colWidth = Math.max(
		...top.map((p) => facetFootprint(plotSizeFor(p.type), facetChildCounts[p.id] ?? 0, padding).width),
		DEFAULT_SIZE.width
	);

	const nextY = new Array(columns).fill(originY);

	for (const p of top) {
		const size = plotSizeFor(p.type);
		p.width = size.width;
		p.height = size.height;

		const foot = facetFootprint(size, facetChildCounts[p.id] ?? 0, padding);
		// Shortest column wins; ties go left so the reading order stays predictable.
		let col = 0;
		for (let i = 1; i < columns; i++) if (nextY[i] < nextY[col]) col = i;

		p.x = originX + col * (colWidth + gutter);
		p.y = nextY[col];
		nextY[col] += foot.height + gutter;
	}

	return plots;
}
