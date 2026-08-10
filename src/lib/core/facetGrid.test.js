import { describe, it, expect } from 'vitest';
import { facetGridDims, facetGridCells, facetRowSizes } from './facetGrid.js';

// Facets per row, read back off the cells — the shape a user actually sees.
const rowSizesOf = (cells) =>
	cells.reduce((acc, c) => {
		acc[c.row] = (acc[c.row] ?? 0) + 1;
		return acc;
	}, []);

// The grid maths behind small multiples. Three views compute their layout from this one
// module (the worksheet's real child positions, the workspace packer's reserved footprint,
// and the node-canvas thumbnail), so a change here is a change everywhere — which is the
// point, and the reason it is pinned this hard.
describe('facetGridDims — automatic (rows = 0)', () => {
	// The original rule, from before the row count was settable. It must be preserved
	// EXACTLY, because every saved session loads with facetRows = 0 and must look identical.
	it('uses ceil(sqrt(n)) columns, matching the pre-option behaviour', () => {
		for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 16, 17]) {
			expect(facetGridDims(n, 0).cols, `n=${n}`).toBe(Math.max(1, Math.ceil(Math.sqrt(n))));
		}
	});

	it('derives rows from those columns, with no empty trailing row', () => {
		expect(facetGridDims(4, 0)).toEqual({ rows: 2, cols: 2 });
		expect(facetGridDims(5, 0)).toEqual({ rows: 2, cols: 3 });
		expect(facetGridDims(6, 0)).toEqual({ rows: 2, cols: 3 });
		expect(facetGridDims(7, 0)).toEqual({ rows: 3, cols: 3 });
	});

	// A session saved before the field existed has no facetRows at all; `?? 0` upstream and
	// these fall-throughs must both land on automatic rather than on "1 row".
	it('treats null / undefined / NaN as automatic', () => {
		for (const r of [null, undefined, NaN, 'nonsense']) {
			expect(facetGridDims(9, r), String(r)).toEqual({ rows: 3, cols: 3 });
		}
	});

	it('never returns a zero dimension, even for an empty or negative count', () => {
		expect(facetGridDims(0, 0)).toEqual({ rows: 1, cols: 1 });
		expect(facetGridDims(-3, 0)).toEqual({ rows: 1, cols: 1 });
	});
});

describe('facetRowSizes — user-chosen rows are a promise, not a ceiling', () => {
	// The bug this rule replaced: the row count used to be an UPPER BOUND (cols = ceil(n/rows),
	// then rows = ceil(n/cols)), so asking for 3 rows of 4 facets silently gave a 2x2 grid. The
	// select offers 3, so 3 must mean 3. The facets spread as evenly as possible, remainder on
	// the earliest rows.
	it('honours the requested row count exactly, spreading facets evenly', () => {
		expect(facetRowSizes(4, 3)).toEqual([2, 1, 1]);
		expect(facetRowSizes(5, 3)).toEqual([2, 2, 1]);
		expect(facetRowSizes(7, 3)).toEqual([3, 2, 2]);
		expect(facetRowSizes(5, 4)).toEqual([2, 1, 1, 1]);
	});

	it('divides exactly when it can', () => {
		expect(facetRowSizes(6, 3)).toEqual([2, 2, 2]);
		expect(facetRowSizes(6, 2)).toEqual([3, 3]);
	});

	it('puts everything on one row for rows = 1, and one per row for rows = n', () => {
		expect(facetRowSizes(5, 1)).toEqual([5]);
		expect(facetRowSizes(5, 5)).toEqual([1, 1, 1, 1, 1]);
	});

	// More rows than facets cannot mean empty rows: one facet per row is the limit.
	it('clamps a request larger than the facet count to one facet per row', () => {
		expect(facetRowSizes(3, 10)).toEqual([1, 1, 1]);
		expect(facetRowSizes(1, 4)).toEqual([1]);
	});

	it('keeps the automatic near-square fill for rows = 0', () => {
		expect(facetRowSizes(4, 0)).toEqual([2, 2]);
		expect(facetRowSizes(5, 0)).toEqual([3, 2]);
		// Automatic fills row-major by ceil(sqrt(n)) columns — it does NOT even out, so the
		// trailing row can be much shorter. Unchanged on purpose: saved sessions look the same.
		expect(facetRowSizes(7, 0)).toEqual([3, 3, 1]);
	});

	it('accounts for every facet, whatever the request', () => {
		for (let n = 1; n <= 12; n++) {
			for (const r of [0, 1, 2, 3, 4, 5, 12, 30]) {
				const sizes = facetRowSizes(n, r);
				expect(
					sizes.reduce((a, b) => a + b, 0),
					`n=${n} rows=${r}`
				).toBe(n);
				expect(Math.min(...sizes), `n=${n} rows=${r}`).toBeGreaterThan(0);
				if (r > 0) expect(sizes.length, `n=${n} rows=${r}`).toBe(Math.min(r, n));
				// Evenly spread: no two rows differ by more than one facet.
				if (r > 0) expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
			}
		}
	});

	it('returns no rows for an empty or negative count', () => {
		expect(facetRowSizes(0, 3)).toEqual([]);
		expect(facetRowSizes(-2, 3)).toEqual([]);
	});
});

describe('facetGridDims — user-chosen rows', () => {
	it('derives the columns from the requested rows', () => {
		expect(facetGridDims(6, 1)).toEqual({ rows: 1, cols: 6 });
		expect(facetGridDims(6, 2)).toEqual({ rows: 2, cols: 3 });
		expect(facetGridDims(6, 3)).toEqual({ rows: 3, cols: 2 });
		expect(facetGridDims(6, 6)).toEqual({ rows: 6, cols: 1 });
	});

	it('lays a single row out horizontally when rows = 1', () => {
		expect(facetGridDims(5, 1)).toEqual({ rows: 1, cols: 5 });
	});

	// More rows than facets cannot mean empty rows: one facet per row is the limit.
	it('clamps a row count larger than the facet count', () => {
		expect(facetGridDims(3, 10)).toEqual({ rows: 3, cols: 1 });
		expect(facetGridDims(1, 4)).toEqual({ rows: 1, cols: 1 });
	});

	// The requested count is a promise. 5 facets over 4 rows is [2, 1, 1, 1]: four rows, and the
	// column PITCH comes from the widest row, so the footprint reserves — and the thumbnail
	// draws — exactly the shape the worksheet lays out, trailing cells empty.
	it('reports the requested row count and the widest row as the column pitch', () => {
		expect(facetGridDims(4, 3)).toEqual({ rows: 3, cols: 2 });
		expect(facetGridDims(5, 4)).toEqual({ rows: 4, cols: 2 });
		expect(facetGridDims(7, 5)).toEqual({ rows: 5, cols: 2 });
		expect(facetGridDims(7, 3)).toEqual({ rows: 3, cols: 3 });
	});

	it('ignores a negative or fractional-to-zero request and falls back to automatic', () => {
		expect(facetGridDims(9, -2)).toEqual({ rows: 3, cols: 3 });
	});
});

describe('facetGridCells', () => {
	const step = { stepX: 100, stepY: 50 };

	it('fills row-major and offsets by a single step per axis', () => {
		const { cells, rows, cols } = facetGridCells(4, { rows: 2, ...step });
		expect({ rows, cols }).toEqual({ rows: 2, cols: 2 });
		expect(cells.map((c) => [c.row, c.col])).toEqual([
			[0, 0],
			[0, 1],
			[1, 0],
			[1, 1]
		]);
		expect(cells.map((c) => [c.dx, c.dy])).toEqual([
			[0, 0],
			[100, 0],
			[0, 50],
			[100, 50]
		]);
	});

	// Alignment is the whole feature: a partial last row must sit under the SAME column
	// positions as the full rows above it, not be recentred or respaced.
	it('aligns a partial last row to the column positions of the full rows', () => {
		const { cells, cols } = facetGridCells(5, { rows: 2, ...step });
		expect(cols).toBe(3);
		const xsByRow = new Map();
		for (const c of cells) {
			if (!xsByRow.has(c.row)) xsByRow.set(c.row, []);
			xsByRow.get(c.row).push(c.dx);
		}
		expect(xsByRow.get(0)).toEqual([0, 100, 200]);
		// Last row has two of the three cells, at the first two column positions.
		expect(xsByRow.get(1)).toEqual([0, 100]);
	});

	it('gives every row the same y and every column the same x', () => {
		const { cells } = facetGridCells(7, { rows: 3, ...step });
		for (const c of cells) {
			expect(c.dx).toBe(c.col * 100);
			expect(c.dy).toBe(c.row * 50);
		}
	});

	// The reported user bug: 4 facets, Rows = 3, and the layout came back 2x2.
	it('lays 4 facets on 3 rows as [2, 1, 1], left-aligned', () => {
		const { cells, rows, cols } = facetGridCells(4, { rows: 3, ...step });
		expect({ rows, cols }).toEqual({ rows: 3, cols: 2 });
		expect(rowSizesOf(cells)).toEqual([2, 1, 1]);
		expect(cells.map((c) => [c.dx, c.dy])).toEqual([
			[0, 0],
			[100, 0],
			[0, 50],
			[0, 100]
		]);
	});

	it('lays 5 on 3 rows as [2, 2, 1] and 7 on 3 as [3, 2, 2]', () => {
		expect(rowSizesOf(facetGridCells(5, { rows: 3, ...step }).cells)).toEqual([2, 2, 1]);
		expect(rowSizesOf(facetGridCells(7, { rows: 3, ...step }).cells)).toEqual([3, 2, 2]);
	});

	it('gives every row the same column x positions with one constant pitch', () => {
		for (const [n, r] of [
			[4, 3],
			[5, 3],
			[7, 3],
			[10, 4],
			[6, 0]
		]) {
			const { cells, cols } = facetGridCells(n, { rows: r, ...step });
			const byRow = new Map();
			for (const c of cells) byRow.set(c.row, [...(byRow.get(c.row) ?? []), c.dx]);
			const widest = [...byRow.values()].reduce((a, b) => (b.length > a.length ? b : a));
			expect(widest).toEqual(Array.from({ length: cols }, (_, i) => i * 100));
			// Every other row is a left-aligned PREFIX of the widest one — no centring, no respacing.
			for (const xs of byRow.values()) expect(xs).toEqual(widest.slice(0, xs.length));
		}
	});

	it('emits exactly one cell per facet, in wired order', () => {
		const { cells } = facetGridCells(6, { rows: 0, ...step });
		expect(cells.map((c) => c.index)).toEqual([0, 1, 2, 3, 4, 5]);
	});

	it('returns no cells for no facets', () => {
		expect(facetGridCells(0, { rows: 2, ...step }).cells).toEqual([]);
	});
});
