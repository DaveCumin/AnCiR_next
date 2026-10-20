// @ts-nocheck
/**
 * Coloured lines, the pure rules (colour-by plan 2026-10-20, section 3.6; phase 1c): which
 * rows a segment joins (the plain line's gap rule, with and without "Join gaps") and which
 * colour it takes (its STARTING row's bucket; "no value" when that row has none).
 */
import { describe, it, expect } from 'vitest';
import { line } from 'd3-shape';
import { colouredLineSegments, colouredLinePaths, isValidXY } from './colouredLine.js';
import { colourBuckets, encodingDomain, NO_VALUE } from './encodings.js';

const K = 64;
/** The segments as [[start, end, group], ...] in row order. */
function segs(xs, ys, idx, joinGaps = false) {
	const { groups, segments } = colouredLineSegments(xs, ys, idx, { K, joinGaps });
	const out = [];
	groups.forEach((g, gi) => {
		for (let k = 0; k < g.length; k += 2) out.push([g[k], g[k + 1], gi]);
	});
	out.sort((a, b) => a[0] - b[0]);
	expect(out.length).toBe(segments);
	return out;
}
/** The row pairs the PLAIN line (d3 line with Line.svelte's rule) joins. */
function plainPairs(xs, ys, joinGaps) {
	const pts = xs.map((x, i) => ({ x, y: ys[i], i }));
	const isValid = (d) => isValidXY(d.x, d.y);
	const pairs = [];
	// Read the pairs off d3's own output: each "L" continues from the previous point.
	const gen = line()
		.x((d) => d.i)
		.y(() => 0);
	const d = joinGaps ? gen(pts.filter(isValid)) : gen.defined(isValid)(pts);
	for (const sub of (d ?? '').split('M').filter(Boolean)) {
		const rows = sub.split('L').map((p) => Number(p.split(',')[0]));
		for (let k = 1; k < rows.length; k++) pairs.push([rows[k - 1], rows[k]]);
	}
	return pairs;
}

describe('segments follow the plain line exactly', () => {
	const cases = {
		'no gaps': [
			[0, 1, 2, 3, 4],
			[1, 2, 3, 4, 5]
		],
		'missing y at row 2': [
			[0, 1, 2, 3, 4],
			[1, 2, null, 4, 5]
		],
		'missing x at row 2 (NaN)': [
			[0, 1, NaN, 3, 4],
			[1, 2, 3, 4, 5]
		],
		'leading and trailing gaps': [
			[0, 1, 2, 3, 4, 5],
			[null, 2, 3, 4, NaN, undefined]
		],
		'an isolated point between gaps': [
			[0, 1, 2, 3, 4, 5, 6],
			[1, 2, null, 4, null, 6, 7]
		],
		'a text cell': [
			[0, 1, 2, 3],
			[1, 'x', 3, 4]
		],
		'two adjacent gaps': [
			[0, 1, 2, 3, 4, 5],
			[1, 2, null, null, 5, 6]
		]
	};
	for (const [name, [xs, ys]] of Object.entries(cases)) {
		for (const joinGaps of [false, true]) {
			it(`${name}, join gaps ${joinGaps ? 'on' : 'off'}`, () => {
				const idx = xs.map(() => 0);
				const got = segs(xs, ys, idx, joinGaps).map(([a, b]) => [a, b]);
				expect(got).toEqual(plainPairs(xs, ys, joinGaps));
			});
		}
	}

	it('a missing y at row 5 leaves no segment 4-5 or 5-6; join gaps bridges 4-6 in row 4’s colour', () => {
		const xs = Array.from({ length: 9 }, (_, i) => i);
		const ys = xs.map((i) => (i === 5 ? null : i));
		const idx = xs.map((i) => i); // bucket = row
		const off = segs(xs, ys, idx, false);
		expect(off.map(([a, b]) => `${a}-${b}`)).toEqual(['0-1', '1-2', '2-3', '3-4', '6-7', '7-8']);
		const on = segs(xs, ys, idx, true);
		expect(on.find(([a]) => a === 4)).toEqual([4, 6, 4 + 1]); // group = bucket 4 + 1
		expect(on.some(([a, b]) => a === 5 || b === 5)).toBe(false);
	});

	it('valid rows three days apart are joined (no time-gap rule)', () => {
		const day = 86400000;
		expect(segs([0, 3 * day], [1, 2], [0, 0])).toEqual([[0, 1, 1]]);
	});

	it('one valid point, or none, draws nothing', () => {
		expect(segs([0], [1], [0])).toEqual([]);
		expect(segs([0, 1, 2], [null, 1, null], [0, 0, 0])).toEqual([]);
		expect(segs([0, 1, 2], [null, 1, null], [0, 0, 0], true)).toEqual([]);
		expect(segs([], [], [])).toEqual([]);
	});
});

describe('a segment takes its STARTING row’s colour', () => {
	it('bucket of the start, never the end', () => {
		const idx = [3, 10, 63, 0];
		expect(segs([0, 1, 2, 3], [0, 0, 0, 0], idx)).toEqual([
			[0, 1, 4],
			[1, 2, 11],
			[2, 3, 64]
		]);
	});

	it('hour of day across midnight: 23:30 to 00:30 is the 23:30 colour (top bucket)', () => {
		const hours = [22.5, 23.5, 0.5, 1.5];
		const dom = encodingDomain([hours], { mode: 'hourOfDay' });
		const idx = colourBuckets(hours, dom);
		expect([...idx]).toEqual([60, 62, 1, 4]);
		const s = segs([0, 1, 2, 3], [0, 1, 2, 3], idx);
		expect(s[1]).toEqual([1, 2, 62 + 1]); // the midnight segment: 23:30's bucket
		expect(s[2]).toEqual([2, 3, 1 + 1]);
	});

	it('bucket boundaries: values either side of a boundary start segments in adjacent groups', () => {
		// Range [0, 64]: bucket b is [b, b + 1).
		const vals = [0.999999, 1, 31.999999, 32, 63, 64, 0];
		const dom = encodingDomain([vals], { mode: 'value' });
		const idx = colourBuckets(vals, dom);
		const s = segs(
			vals.map((_, i) => i),
			vals.map(() => 0),
			idx
		);
		expect(s.map((r) => r[2] - 1)).toEqual([0, 1, 31, 32, 63, 63]);
	});

	it('a starting row with no colour value (or past the colour column’s end) is "no value"', () => {
		const idx = Int16Array.from([2, NO_VALUE, 5]);
		const s = segs([0, 1, 2, 3, 4], [0, 0, 0, 0, 0], idx);
		expect(s).toEqual([
			[0, 1, 3],
			[1, 2, 0],
			[2, 3, 6],
			[3, 4, 0]
		]);
	});
});

describe('paths', () => {
	it('one path per non-empty group, "no value" first, each segment its own M/L pair', () => {
		const xs = [0, 1, 2, 3];
		const ys = [0, 1, 2, 3];
		const { groups } = colouredLineSegments(xs, ys, [5, -1, 5], { K });
		const paths = colouredLinePaths(
			groups,
			xs,
			ys,
			(v) => v * 10,
			(v) => 100 - v * 10
		);
		expect(paths).toEqual([
			// Row 1 has no value; row 2 is bucket 5 (group 6).
			{ group: 0, d: 'M10 90L20 80' },
			{ group: 6, d: 'M0 100L10 90M20 80L30 70' }
		]);
	});

	it('rounds to 0.01 px and skips a segment a scale cannot place', () => {
		const { groups } = colouredLineSegments([1, 2, 3], [1, 2, 3], [0, 0, 0], { K });
		const paths = colouredLinePaths(
			groups,
			[1, 2, 3],
			[1, 2, 3],
			(v) => (v === 3 ? NaN : v / 3),
			(v) => v
		);
		expect(paths).toEqual([{ group: 1, d: 'M0.33 1L0.67 2' }]);
	});
});
