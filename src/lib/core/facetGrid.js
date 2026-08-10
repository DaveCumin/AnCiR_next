/**
 * Grid maths for facet (small-multiples) sets.
 *
 * Faceting spawns one CHILD PLOT per series, and those children are laid out in a grid in three
 * places: the worksheet (real x/y positions written by syncFacetChildren in Plot.svelte), the
 * workspace packer (workspaceLayout.js, which must reserve the footprint the grid will occupy),
 * and the node-canvas thumbnail (EmbeddedPlot.svelte, a CSS grid). All three used to compute
 * `ceil(sqrt(n))` columns independently; they now share this module so a user-chosen row count
 * cannot mean one thing in one view and something else in another.
 *
 * Pure: no Svelte, no `core`. That is deliberate — the demo generator runs the packer headlessly
 * and the unit tests exercise the maths directly.
 */

/**
 * How many facets sit on each row, in order.
 *
 * Two rules, because the two modes promise different things:
 *
 * - AUTOMATIC (`rows` 0/null/undefined — including every session saved before the field existed):
 *   the original near-square rule, `ceil(sqrt(n))` columns filled row-major, so the last row is
 *   the only partial one. Preserved exactly; those sessions must load looking identical.
 *
 * - A CHOSEN ROW COUNT: the user gets exactly that many rows. It is a promise, not an upper
 *   bound — the select offers 3, so picking 3 must produce three rows. The only clamp is the
 *   facet count itself (n rows of one is as far as it can spread), and the facets are spread as
 *   evenly as possible with the remainder on the earliest rows: `base = floor(n / rows)`,
 *   `rem = n % rows`, first `rem` rows get `base + 1`. So 4 facets on 3 rows is [2, 1, 1],
 *   5 on 3 is [2, 2, 1], 7 on 3 is [3, 2, 2].
 *
 * @param {number} count number of facets
 * @param {number|null|undefined} rows requested rows; 0/null = automatic
 * @returns {number[]} facets per row, all >= 1
 */
export function facetRowSizes(count, rows = 0) {
	const n = Math.max(0, Math.floor(Number(count) || 0));
	if (n <= 0) return [];

	const requested = Math.floor(Number(rows) || 0);
	const sizes = [];

	if (requested > 0) {
		const r = Math.min(requested, n);
		const base = Math.floor(n / r);
		const rem = n % r;
		for (let i = 0; i < r; i++) sizes.push(base + (i < rem ? 1 : 0));
		return sizes;
	}

	// Automatic: near-square, row-major, only the last row partial.
	const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
	for (let left = n; left > 0; left -= cols) sizes.push(Math.min(cols, left));
	return sizes;
}

/**
 * Rows and columns for `count` facets.
 *
 * `rows` is the row count the layout actually uses (see facetRowSizes — honoured exactly when
 * chosen, clamped only by the facet count). `cols` is the COLUMN PITCH: the width of the widest
 * row. Rows are left-aligned against that pitch, so a short row's panels sit under the panels
 * above them and a row with fewer facets simply leaves its trailing cells empty.
 *
 * @param {number} count number of facets
 * @param {number|null|undefined} rows requested rows; 0/null = automatic
 * @returns {{rows: number, cols: number}} grid dimensions (both >= 1)
 */
export function facetGridDims(count, rows = 0) {
	const sizes = facetRowSizes(count, rows);
	if (sizes.length === 0) return { rows: 1, cols: 1 };
	return { rows: sizes.length, cols: Math.max(...sizes) };
}

/**
 * Row/column indices and offsets for every facet in the grid.
 *
 * Row-major fill with a single step size per axis: every cell is the same size and sits at
 * `col * stepX` / `row * stepY` from the origin, so columns line up down the whole grid and a
 * partial row keeps the column positions of the fuller rows (rather than centring or re-spacing
 * itself, which would make the axes drift).
 *
 * Offsets are relative — the caller adds its own origin (worksheet coordinates, CSS, …).
 *
 * @param {number} count number of facets
 * @param {object} opts
 * @param {number} [opts.rows] requested rows; 0 = automatic
 * @param {number} [opts.stepX] horizontal pitch between cell origins
 * @param {number} [opts.stepY] vertical pitch between cell origins
 * @returns {{rows:number, cols:number, cells:{index:number,row:number,col:number,dx:number,dy:number}[]}}
 */
export function facetGridCells(count, { rows = 0, stepX = 0, stepY = 0 } = {}) {
	const sizes = facetRowSizes(count, rows);
	const dims = facetGridDims(count, rows);
	const cells = [];
	let index = 0;
	for (let row = 0; row < sizes.length; row++) {
		for (let col = 0; col < sizes[row]; col++) {
			cells.push({ index, row, col, dx: col * stepX, dy: row * stepY });
			index++;
		}
	}
	return { ...dims, cells };
}
