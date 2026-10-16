// An actogram with more rows than its plot has pixels, drawn as one image.
//
// When a record has more periods than the plot is tall in px (thousands of days, or a short
// period over a long record) each row is under 1 px. Drawing every row as SVG then costs one
// component per row (about 1.7 s for 20,000 rows) for rows nobody can see one at a time, and
// before rowGeometry() the gaps alone left the plot blank. A heatmap with more cells than
// SVG handles well is drawn the same way. Here every row is still drawn, into a pixel grid, by the area each bar (or heatmap cell) covers in each pixel: exactly
// what the browser's anti-aliasing does when it rasterises all the rows at that size. So the
// picture is the one drawing every row would give, at the cost of one pass over the bins.
//
// Bars: a row's bar of value y covers the bottom yFrac(y) of the row, as Hist draws it; the
// pixel's opacity is the covered fraction of its area, in the series colour. Heatmap: each
// bin's cell covers the whole row height; the pixel's colour is the area-weighted mean of
// the cells' colours and its opacity the covered fraction (empty bins show the background,
// as in the SVG).

/**
 * Accumulate the coverage of every row's bars or cells in a widthPx x heightPx grid.
 *
 * Row `day` occupies [gap + day * (rowH + gap), that + rowH) px from the top, the plot
 * snippet's layout (rows under 1 px have no gap, see rowGeometry). Defaults: no gap and
 * rowH = heightPx / nRows. A bin spans [xStart, xEnd] hours of the row's `span` hours.
 *
 * @param {object} o
 * @param {number} o.nRows
 * @param {number} o.widthPx integer
 * @param {number} o.heightPx integer
 * @param {number} o.span hours across a row (period x double plot)
 * @param {number} [o.rowH] row height in px of this grid
 * @param {number} [o.gap] gap between rows in px of this grid
 * @param {(day: number) => {xStart: number[], xEnd: number[], y: number[]}} o.rowBins
 * @param {'bars'|'heatmap'} o.mode
 * @param {(day: number, y: number) => number} [o.yFrac] bars: bar height as a fraction of the row
 * @param {(y: number) => [number, number, number]} [o.colour] heatmap: a cell's RGB (0 to 255)
 * @returns {{ cover: Float32Array, rgb: Float32Array | null }} cover per pixel (0 to 1, area
 *   fraction) and, for a heatmap, the cover-weighted RGB sums (3 per pixel)
 */
export function rasterizeRows({
	nRows,
	widthPx,
	heightPx,
	span,
	rowBins,
	mode,
	yFrac,
	colour,
	rowH: rowHIn,
	gap = 0
}) {
	const W = Math.max(0, Math.floor(widthPx));
	const H = Math.max(0, Math.floor(heightPx));
	const cover = new Float32Array(W * H);
	const heat = mode === 'heatmap';
	const rgb = heat ? new Float32Array(W * H * 3) : null;
	if (!(nRows > 0) || W === 0 || H === 0 || !(span > 0)) return { cover, rgb };
	const rowH = rowHIn ?? H / nRows;
	const xs = W / span;

	for (let day = 0; day < nRows; day++) {
		const bins = rowBins(day);
		if (!bins || bins.xStart.length === 0) continue;
		const rowTop = gap + day * (rowH + gap);
		const rowBottom = rowTop + rowH;
		for (let i = 0; i < bins.xStart.length; i++) {
			const y = bins.y[i];
			if (y == null || Number.isNaN(y)) continue;
			let top = rowTop;
			let c = null;
			if (heat) {
				c = colour(y);
			} else {
				const f = Math.min(1, Math.max(0, yFrac(day, y)));
				if (!(f > 0)) continue;
				top = rowBottom - f * rowH;
			}
			const x0 = Math.max(0, bins.xStart[i] * xs);
			const x1 = Math.min(W, bins.xEnd[i] * xs);
			if (!(x1 > x0)) continue;
			addRect(cover, rgb, c, W, H, x0, x1, top, rowBottom);
		}
	}
	return { cover, rgb };
}

/** Add the area a rectangle covers in each pixel (and its colour, weighted by that area). */
function addRect(cover, rgb, c, W, H, x0, x1, y0, y1) {
	const c0 = Math.floor(x0);
	const c1 = Math.min(W - 1, Math.ceil(x1) - 1);
	const r0 = Math.max(0, Math.floor(y0));
	const r1 = Math.min(H - 1, Math.ceil(y1) - 1);
	for (let r = r0; r <= r1; r++) {
		const cy = Math.min(y1, r + 1) - Math.max(y0, r);
		if (!(cy > 0)) continue;
		for (let col = c0; col <= c1; col++) {
			const a = cy * (Math.min(x1, col + 1) - Math.max(x0, col));
			if (!(a > 0)) continue;
			const k = r * W + col;
			cover[k] += a;
			if (rgb) {
				rgb[3 * k] += a * c[0];
				rgb[3 * k + 1] += a * c[1];
				rgb[3 * k + 2] += a * c[2];
			}
		}
	}
}

/**
 * RGBA pixels for an ImageData: bars in `barRGB` at the covered fraction's opacity; a
 * heatmap in the cover-weighted mean colour.
 * @returns {Uint8ClampedArray}
 */
export function rasterToRGBA({ cover, rgb }, barRGB = [0, 0, 0]) {
	const out = new Uint8ClampedArray(cover.length * 4);
	for (let k = 0; k < cover.length; k++) {
		const a = cover[k];
		if (!(a > 0)) continue;
		const o = 4 * k;
		if (rgb) {
			out[o] = rgb[3 * k] / a;
			out[o + 1] = rgb[3 * k + 1] / a;
			out[o + 2] = rgb[3 * k + 2] / a;
		} else {
			out[o] = barRGB[0];
			out[o + 1] = barRGB[1];
			out[o + 2] = barRGB[2];
		}
		out[o + 3] = Math.round(Math.min(1, a) * 255);
	}
	return out;
}

/** 'rgb(r, g, b)', '#rgb' or '#rrggbb' as [r, g, b]; null if it is neither. */
export function parseColour(s) {
	const str = String(s ?? '').trim();
	const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(str);
	if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
	const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(str);
	if (!h) return null;
	const hex = h[1].length === 3 ? [...h[1]].map((ch) => ch + ch).join('') : h[1];
	return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

/**
 * The raster as a PNG data URI (browser only; '' elsewhere). `build(W, H)` returns the
 * rasterizeRows result for a W x H grid. The caller passes the size in DEVICE pixels (CSS
 * size x devicePixelRatio) and draws the image at its CSS size, so it stays sharp.
 */
export function rasterImageURI(build, widthPx, heightPx, barColour) {
	if (typeof document === 'undefined') return '';
	const W = Math.max(0, Math.floor(widthPx));
	const H = Math.max(0, Math.floor(heightPx));
	if (W === 0 || H === 0) return '';
	const canvas = document.createElement('canvas');
	canvas.width = W;
	canvas.height = H;
	const ctx = canvas.getContext('2d');
	if (!ctx) return '';
	// The series colour may be any CSS colour; the canvas normalises it to #rrggbb.
	let barRGB = parseColour(barColour);
	if (!barRGB) {
		ctx.fillStyle = '#000000';
		ctx.fillStyle = String(barColour ?? '#000000');
		barRGB = parseColour(ctx.fillStyle) ?? [0, 0, 0];
	}
	const img = ctx.createImageData(W, H);
	img.data.set(rasterToRGBA(build(W, H), barRGB));
	ctx.putImageData(img, 0, 0);
	return canvas.toDataURL('image/png');
}
