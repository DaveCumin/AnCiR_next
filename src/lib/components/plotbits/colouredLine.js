// @ts-check
/**
 * Coloured lines: a series' line coloured by its colour-by column (colour-by plan 2026-10-20,
 * section 3.6; phase 1c). Pure, so the rules are tested on numbers and the Python export
 * (tools/ancir_runtime.py, matplotlib LineCollection) ports them one for one.
 *
 *   1. SEGMENTS. Rows are walked in order. A row is VALID when its x and y are both present
 *      and numbers (`isValidXY`, the test Line.svelte's plain line uses).
 *      - joinGaps false (the default): a segment joins row i to row i + 1 only when BOTH are
 *        valid, so a missing x or y breaks the line exactly where the plain line breaks.
 *      - joinGaps true: a segment joins each valid row to the NEXT valid row, bridging the
 *        gap exactly as the plain line does.
 *      No time-gap rule (none exists for plain lines either).
 *   2. COLOUR. A segment takes the colour bucket of its STARTING row (for hour of day this is
 *      right across midnight: 23:30 to 00:30 is drawn in the 23:30 colour, not interpolated
 *      through noon). A bridged segment (joinGaps) likewise takes the colour of the valid row
 *      it starts from. A starting row with no colour value (NO_VALUE, or past the end of the
 *      colour column) puts the segment in the "no value" group, drawn in the series line
 *      colour and named on the colour bar.
 *   3. PATHS. Group 0 is "no value", group b + 1 is bucket b. Each non-empty group is ONE
 *      path of separate `M x0 y0 L x1 y1` subpaths; drawn "no value" first, then bucket order
 *      (decision 9), with round caps and joins so a thick line shows no notch where the colour
 *      changes, and solid (decided 2026-10-20, Q1: a dash would restart at every segment).
 */

/** x and y present and numbers: the plain line's `isValid` (Line.svelte). */
export function isValidXY(x, y) {
	return x != null && y != null && !isNaN(x) && !isNaN(y);
}

/**
 * The line's segments as row pairs, grouped by the colour of their starting row.
 *
 * @param {ArrayLike<any>} xs
 * @param {ArrayLike<any>} ys
 * @param {ArrayLike<number>} idx colour bucket per row (negative: no value); rows past its end
 *   have no value
 * @param {{K: number, joinGaps?: boolean}} o K = number of colour buckets
 * @returns {{groups: number[][], segments: number}} groups[0] is "no value", groups[b + 1]
 *   bucket b; each a flat list [start0, end0, start1, end1, ...] of row indices
 */
export function colouredLineSegments(xs, ys, idx, { K, joinGaps = false }) {
	/** @type {number[][]} */
	const groups = Array.from({ length: K + 1 }, () => []);
	const n = Math.min(xs?.length ?? 0, ys?.length ?? 0);
	const nIdx = idx?.length ?? 0;
	let segments = 0;
	const groupOf = (/** @type {number} */ i) => {
		const b = i < nIdx ? idx[i] : -1;
		return b >= 0 && b < K ? b + 1 : 0;
	};
	if (joinGaps) {
		let prev = -1;
		for (let i = 0; i < n; i++) {
			if (!isValidXY(xs[i], ys[i])) continue;
			if (prev >= 0) {
				groups[groupOf(prev)].push(prev, i);
				segments++;
			}
			prev = i;
		}
	} else {
		let prevValid = n > 0 && isValidXY(xs[0], ys[0]);
		for (let i = 1; i < n; i++) {
			const valid = isValidXY(xs[i], ys[i]);
			if (valid && prevValid) {
				groups[groupOf(i - 1)].push(i - 1, i);
				segments++;
			}
			prevValid = valid;
		}
	}
	return { groups, segments };
}

const round2 = (/** @type {number} */ v) => Math.round(v * 100) / 100;

/**
 * Path data for each non-empty group: `[{ group, d }]` in draw order ("no value" first, then
 * bucket order). Pixel positions are rounded to 0.01 px (a 200k-row line is about half the
 * text). A segment with an end the scales cannot place (e.g. 0 on a log axis) is skipped.
 *
 * @param {number[][]} groups from colouredLineSegments
 * @param {ArrayLike<any>} xs
 * @param {ArrayLike<any>} ys
 * @param {(v: any) => number} sx
 * @param {(v: any) => number} sy
 * @returns {{group: number, d: string}[]}
 */
export function colouredLinePaths(groups, xs, ys, sx, sy) {
	const out = [];
	for (let g = 0; g < groups.length; g++) {
		const seg = groups[g];
		if (seg.length === 0) continue;
		const parts = [];
		for (let k = 0; k < seg.length; k += 2) {
			const a = seg[k];
			const b = seg[k + 1];
			const x0 = sx(xs[a]);
			const y0 = sy(ys[a]);
			const x1 = sx(xs[b]);
			const y1 = sy(ys[b]);
			if (
				!Number.isFinite(x0) ||
				!Number.isFinite(y0) ||
				!Number.isFinite(x1) ||
				!Number.isFinite(y1)
			)
				continue;
			parts.push(`M${round2(x0)} ${round2(y0)}L${round2(x1)} ${round2(y1)}`);
		}
		if (parts.length > 0) out.push({ group: g, d: parts.join('') });
	}
	return out;
}
