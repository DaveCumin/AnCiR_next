// histPoints.js: the polyline point string Hist.svelte draws its bars with.
//
// Kept out of the component so the hot loop only ever touches plain locals. Inside a Svelte 5
// component every prop read goes through a getter (and, when the parent passed an expression
// such as an `{@const}`, through a signal read as well). Reading `xStart[i]`, `y[i]`, `xscale`
// and `yscale` through those getters for every bar was the main cost of loading many series
// into an actogram (review ROB-9: 46 s in signal `get` and 34 s on the loop line for 50 series
// of 20k rows). Callers read each prop once and pass the values here.
//
// The string is also the actogram's main memory cost: a dense actogram holds millions of bars,
// and every point is two numbers in an attribute (50 series of 100k rows crashed the tab).
// `compact` keeps it small without changing what is drawn (measured: 5.4x fewer characters,
// 93 of 228,800 pixels differing by at most 10/255, i.e. anti-aliasing):
//   - coordinates are written to 3 decimal places (1/1000 of a pixel; SVG optimisers use the
//     same precision, and the browser keeps them as 32-bit floats anyway);
//   - two touching bars do not drop to the baseline and climb back up between them (that
//     excursion encloses no area); the outline just steps from one top to the next. Not for
//     outlined bars (`outlined`): an outline WOULD show the dropped verticals.
// Without `compact` the string is exactly the four-corner form every other caller (and the
// pinned histogram snapshots in tests/e2e) relies on.

/**
 * Round to 3 decimals; -0 prints as 0.
 * @param {number} v
 */
function r3(v) {
	const out = Math.round(v * 1000) / 1000;
	return out === 0 ? 0 : out;
}

/**
 * Bars as one polyline.
 *
 * By default: for each bar, bottom-left, top-left, top-right, bottom-right, at full precision.
 * With `compact`: coordinates to 3 decimals, and (unless `outlined`) a run of touching bars (each bar's right edge written at the same pixel
 * position as the next bar's left edge) is one stepped outline: bottom-left, then each bar's
 * top-left and top-right, then bottom-right.
 * Only the first min(xStart, xEnd, y) bars are drawn.
 *
 * @param {ArrayLike<number>} xStart left edge of each bar (data units)
 * @param {ArrayLike<number>} xEnd right edge of each bar (data units)
 * @param {ArrayLike<number>} y height of each bar (data units)
 * @param {(v: number) => number} xscale data to pixels, x
 * @param {((v: number) => number) & { range: () => number[] }} yscale data to pixels, y
 * @param {{ compact?: boolean, outlined?: boolean }} [opts]
 * @returns {string}
 */
export function histPoints(xStart, xEnd, y, xscale, yscale, opts = {}) {
	if (!xStart || !xEnd || !y || !xscale || !yscale) return '';
	const n = Math.min(xStart.length, xEnd.length, y.length);
	if (n === 0) return '';
	const compact = opts.compact === true;
	const merge = compact && opts.outlined !== true;
	const px = compact ? r3 : (v) => v;
	const base = px(yscale.range()[0]); // bottom of the plot area
	const parts = [];
	let prevRight = NaN;
	for (let i = 0; i < n; i++) {
		const left = px(xscale(xStart[i]));
		const right = px(xscale(xEnd[i]));
		const top = px(yscale(y[i]));
		if (!merge) {
			parts.push(`${left},${base} ${left},${top} ${right},${top} ${right},${base}`);
			continue;
		}
		// Touching is decided on the WRITTEN pixel coordinates: data edges built as
		// start + width rarely equal the next start exactly in floating point, but once
		// rounded they land on the same pixel position, so the dropped excursion is exactly
		// zero-width in what is drawn.
		const joinsPrev = left === prevRight;
		const joinsNext = i + 1 < n && right === r3(xscale(xStart[i + 1]));
		prevRight = right;
		parts.push(
			(joinsPrev ? '' : `${left},${base} `) +
				`${left},${top} ${right},${top}` +
				(joinsNext ? '' : ` ${right},${base}`)
		);
	}
	return parts.join(' ');
}
