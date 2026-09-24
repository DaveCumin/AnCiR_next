// @ts-nocheck
// Legend geometry and automatic placement.
//
// Two jobs, both pure so they can be tested without a browser:
//
// 1. SIZE. The legend box is sized from measured label widths. The plot needs that size too
//    (to reserve room when the legend sits outside the plot area), so the arithmetic lives
//    here and Legend.svelte and the plot class both call it. Two copies of the formula would
//    drift, and the reserved gap would stop matching the drawn box.
//
// 2. PLACEMENT ('auto'). A fixed corner is the classic way a legend ends up printed over the
//    data: the paper's cosinor scatterplot had points in every corner and the top-right
//    legend covered a week of them. 'auto' rasterises the drawn marks onto a coarse grid and
//    picks the first candidate position (corners, then edge midpoints, in matplotlib's
//    order) that covers no data. When every inside position covers data, a plot that can
//    make room puts the legend OUTSIDE the plot area, on the right; one that cannot takes
//    the least-covered position.

/** Width of the icon (line / marker swatch) column. */
export const LEGEND_ICON_W = 25;
/** Gap between the icon and its label. */
export const LEGEND_ICON_GAP = 4;
/** Extra space after each entry in a horizontal legend. */
export const LEGEND_H_SPACING = 10;

/** Average glyph advance as a fraction of the font size, for when there is no canvas. */
const EST_CHAR_EM = 0.55;

let measureCtx = null;
/**
 * Label widths in px, measured in the figure's family when a canvas is available, else
 * estimated from the character count (tests, SSR).
 *
 * @param {string[]} labels
 * @param {number} fontPx
 * @param {string} fontFamily
 * @returns {number[]}
 */
export function measureLabelWidths(labels, fontPx, fontFamily) {
	if (measureCtx === null && typeof document !== 'undefined') {
		try {
			measureCtx = document.createElement('canvas').getContext('2d') ?? false;
		} catch {
			measureCtx = false;
		}
	}
	if (measureCtx) {
		measureCtx.font = `${fontPx}px ${fontFamily}`;
		return labels.map((l) => measureCtx.measureText(String(l ?? '')).width);
	}
	return labels.map((l) => String(l ?? '').length * fontPx * EST_CHAR_EM);
}

/**
 * The legend box, in px. Unchanged from the formula Legend.svelte always used.
 *
 * @param {object} o
 * @param {number[]} o.labelWidths
 * @param {number} o.fontPx
 * @param {number} o.padding inner padding of the box
 * @param {number} o.itemSpacing
 * @param {'vertical'|'horizontal'} o.orientation
 * @returns {{width: number, height: number, lineH: number}}
 */
export function legendBoxSize({ labelWidths, fontPx, padding, itemSpacing, orientation }) {
	const n = labelWidths.length;
	if (n === 0) return { width: 0, height: 0, lineH: 0 };
	const lineH = fontPx + itemSpacing + 4; // +4 for possible overlap
	if (orientation === 'horizontal') {
		const total = labelWidths.reduce(
			(sum, w) => sum + LEGEND_ICON_W + LEGEND_ICON_GAP + w + LEGEND_H_SPACING,
			0
		);
		return { width: total + padding * 2, height: lineH + padding * 2, lineH };
	}
	const maxLabelW = Math.max(...labelWidths, 0) + 2 + padding / 2;
	return {
		width: LEGEND_ICON_W + LEGEND_ICON_GAP + maxLabelW + padding * 2,
		height: n * lineH + padding * 2,
		lineH
	};
}

/**
 * Where the drawn marks are, as a coarse occupancy grid over the plot area.
 *
 * @param {object} o
 * @param {number} o.width plot-area width, px
 * @param {number} o.height plot-area height, px
 * @param {Array<{px: ArrayLike<number>, py: ArrayLike<number>, line?: boolean, radius?: number}>} o.series
 *   pixel coordinates within the plot area (NaN or null for a gap)
 * @param {number} [o.cell] grid cell size in px
 * @returns {{cols: number, rows: number, cell: number, grid: Uint8Array}}
 */
export function buildOccupancy({ width, height, series, cell = 4 }) {
	const cols = Math.max(1, Math.ceil(width / cell));
	const rows = Math.max(1, Math.ceil(height / cell));
	const grid = new Uint8Array(cols * rows);
	const mark = (x, y, r) => {
		const c0 = Math.floor((x - r) / cell);
		const c1 = Math.floor((x + r) / cell);
		const r0 = Math.floor((y - r) / cell);
		const r1 = Math.floor((y + r) / cell);
		for (let rr = Math.max(0, r0); rr <= Math.min(rows - 1, r1); rr++) {
			for (let cc = Math.max(0, c0); cc <= Math.min(cols - 1, c1); cc++) grid[rr * cols + cc] = 1;
		}
	};
	const ok = (v) => typeof v === 'number' && Number.isFinite(v);
	for (const s of series ?? []) {
		const { px, py } = s;
		const n = Math.min(px?.length ?? 0, py?.length ?? 0);
		const r = Math.max(0, s.radius ?? 0);
		let prevX = null;
		let prevY = null;
		for (let i = 0; i < n; i++) {
			const x = px[i];
			const y = py[i];
			if (!ok(x) || !ok(y)) {
				prevX = prevY = null;
				continue;
			}
			mark(x, y, r);
			if (s.line && prevX !== null) {
				// Walk the segment in half-cell steps so a long, sparse line still marks
				// every cell it crosses.
				const dx = x - prevX;
				const dy = y - prevY;
				const steps = Math.ceil(Math.hypot(dx, dy) / (cell / 2));
				for (let k = 1; k < steps; k++) {
					mark(prevX + (dx * k) / steps, prevY + (dy * k) / steps, 0);
				}
			}
			prevX = x;
			prevY = y;
		}
	}
	return { cols, rows, cell, grid };
}

/** Fraction of the grid cells under a box that hold data. */
export function coveredFraction(occ, x, y, w, h) {
	const { cols, rows, cell, grid } = occ;
	const c0 = Math.max(0, Math.floor(x / cell));
	const c1 = Math.min(cols - 1, Math.floor((x + w) / cell));
	const r0 = Math.max(0, Math.floor(y / cell));
	const r1 = Math.min(rows - 1, Math.floor((y + h) / cell));
	if (c1 < c0 || r1 < r0) return 0;
	let hit = 0;
	for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) hit += grid[r * cols + c];
	return hit / ((c1 - c0 + 1) * (r1 - r0 + 1));
}

/**
 * Candidate positions inside the plot area, in preference order: corners first (top right
 * is the convention), then edge midpoints. Same inset as the fixed presets.
 */
export function insideCandidates(plotW, plotH, boxW, boxH, margin) {
	const L = margin;
	const R = plotW - boxW - margin;
	const T = margin;
	const B = plotH - boxH - margin;
	const CX = (plotW - boxW) / 2;
	const CY = (plotH - boxH) / 2;
	return [
		{ name: 'topright', x: R, y: T },
		{ name: 'topleft', x: L, y: T },
		{ name: 'bottomright', x: R, y: B },
		{ name: 'bottomleft', x: L, y: B },
		{ name: 'top', x: CX, y: T },
		{ name: 'bottom', x: CX, y: B },
		{ name: 'right', x: R, y: CY },
		{ name: 'left', x: L, y: CY }
	];
}

/**
 * Covering less than this fraction of a box's cells counts as clear. Not zero: one stray
 * point grazing a corner of the box should not push the legend off the plot.
 */
export const CLEAR_FRACTION = 0.01;

/**
 * Choose the legend's position.
 *
 * @param {object} o
 * @param {{cols:number, rows:number, cell:number, grid:Uint8Array}} o.occupancy over the plot area
 *   as it would be drawn WITHOUT an outside reservation
 * @param {number} o.plotW
 * @param {number} o.plotH
 * @param {number} o.boxW
 * @param {number} o.boxH
 * @param {number} o.margin
 * @param {boolean} [o.allowOutside] whether the plot can reserve room on its right
 * @returns {{outside: boolean, name: string, x: number, y: number, covered: number}}
 *   x, y relative to the plot area (ignored when outside)
 */
export function chooseLegendPlacement({
	occupancy,
	plotW,
	plotH,
	boxW,
	boxH,
	margin,
	allowOutside = false
}) {
	// A legend bigger than the plot area cannot sit inside it without covering data.
	const fits = boxW + 2 * margin <= plotW && boxH + 2 * margin <= plotH;
	const candidates = fits ? insideCandidates(plotW, plotH, boxW, boxH, margin) : [];
	let best = null;
	for (const c of candidates) {
		const covered = coveredFraction(occupancy, c.x, c.y, boxW, boxH);
		if (covered <= CLEAR_FRACTION) return { outside: false, ...c, covered };
		if (!best || covered < best.covered) best = { outside: false, ...c, covered };
	}
	if (allowOutside) return { outside: true, name: 'outsideright', x: 0, y: 0, covered: 0 };
	return (
		best ?? { outside: false, name: 'topright', x: plotW - boxW - margin, y: margin, covered: 1 }
	);
}
