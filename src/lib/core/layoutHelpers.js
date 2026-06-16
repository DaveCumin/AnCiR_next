// layoutHelpers.js
//
// Pure geometry helpers for aligning, distributing, and grid-arranging a set of
// boxes. Shared by the workflow canvas (node positions) and the worksheet (plot
// positions). Each box is { id, x, y, w, h }; every function returns a Map of
// id -> { x, y } with the NEW top-left positions (only for boxes that move),
// leaving the caller to write them back into its own state.

/** @typedef {{ id: any, x: number, y: number, w: number, h: number }} Box */

function bounds(boxes) {
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const b of boxes) {
		minX = Math.min(minX, b.x);
		minY = Math.min(minY, b.y);
		maxX = Math.max(maxX, b.x + b.w);
		maxY = Math.max(maxY, b.y + b.h);
	}
	return { minX, minY, maxX, maxY };
}

/**
 * Align boxes along one edge or centre.
 * @param {Box[]} boxes
 * @param {'left'|'right'|'hcenter'|'top'|'bottom'|'vcenter'} mode
 * @returns {Map<any,{x:number,y:number}>}
 */
export function alignBoxes(boxes, mode) {
	const out = new Map();
	if (!boxes || boxes.length < 2) return out;
	const { minX, minY, maxX, maxY } = bounds(boxes);
	const cx = (minX + maxX) / 2;
	const cy = (minY + maxY) / 2;
	for (const b of boxes) {
		let { x, y } = b;
		switch (mode) {
			case 'left': x = minX; break;
			case 'right': x = maxX - b.w; break;
			case 'hcenter': x = cx - b.w / 2; break;
			case 'top': y = minY; break;
			case 'bottom': y = maxY - b.h; break;
			case 'vcenter': y = cy - b.h / 2; break;
		}
		out.set(b.id, { x, y });
	}
	return out;
}

/**
 * Distribute boxes so the GAPS between them are equal along an axis. The two
 * extreme boxes stay put; the inner ones are evenly spaced between them.
 * @param {Box[]} boxes
 * @param {'h'|'v'} axis
 * @returns {Map<any,{x:number,y:number}>}
 */
export function distributeBoxes(boxes, axis) {
	const out = new Map();
	if (!boxes || boxes.length < 3) return out; // <3 has no inner box to move
	const horizontal = axis === 'h';
	const sorted = [...boxes].sort((a, b) =>
		horizontal ? a.x + a.w / 2 - (b.x + b.w / 2) : a.y + a.h / 2 - (b.y + b.h / 2)
	);
	const first = sorted[0];
	const last = sorted[sorted.length - 1];
	const startEdge = horizontal ? first.x : first.y;
	const endEdge = horizontal ? last.x + last.w : last.y + last.h;
	const span = endEdge - startEdge;
	let sizeSum = 0;
	for (const b of sorted) sizeSum += horizontal ? b.w : b.h;
	const gap = (span - sizeSum) / (sorted.length - 1);
	let cursor = startEdge;
	for (const b of sorted) {
		if (horizontal) out.set(b.id, { x: cursor, y: b.y });
		else out.set(b.id, { x: b.x, y: cursor });
		cursor += (horizontal ? b.w : b.h) + gap;
	}
	return out;
}

/**
 * Arrange boxes into a tidy grid. Cells are uniform (max width/height of the
 * set) so rows and columns line up. The grid's top-left anchors at the current
 * bounding-box top-left so the arrangement appears where the items already are.
 * @param {Box[]} boxes
 * @param {{ cols?: number, gapX?: number, gapY?: number, snap?: (n:number)=>number }} [opts]
 * @returns {Map<any,{x:number,y:number}>}
 */
export function arrangeGrid(boxes, opts = {}) {
	const out = new Map();
	if (!boxes || boxes.length === 0) return out;
	const { minX, minY } = bounds(boxes);
	const gapX = opts.gapX ?? 24;
	const gapY = opts.gapY ?? 24;
	const cols = Math.max(1, opts.cols ?? Math.ceil(Math.sqrt(boxes.length)));
	const cellW = Math.max(...boxes.map((b) => b.w));
	const cellH = Math.max(...boxes.map((b) => b.h));
	const snap = typeof opts.snap === 'function' ? opts.snap : (n) => n;
	// Order row-major by current position so the arrangement roughly preserves
	// the user's existing reading order.
	const ordered = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x);
	ordered.forEach((b, i) => {
		const col = i % cols;
		const row = Math.floor(i / cols);
		out.set(b.id, {
			x: snap(minX + col * (cellW + gapX)),
			y: snap(minY + row * (cellH + gapY))
		});
	});
	return out;
}
