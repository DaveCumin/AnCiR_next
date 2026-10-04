// @ts-nocheck
// Pushing apart workflow nodes that overlap, for WorkflowEditor's post-import pass.
//
// A saved layout cannot know how tall a node will draw (an expanded data node's value
// preview, an expanded table process's settings), and the automatic layout stacks by
// port rows only, so a session could load with nodes on top of one another. This moves
// each overlapping node DOWN, only as far as it must, so the arrangement is otherwise
// kept: a node that overlaps nothing never moves.

/**
 * @param {{id: string, x: number, y: number, w: number, h: number}[]} boxes nodes to settle
 * @param {{x: number, y: number, w: number, h: number}[]} [frames] group frames: a node
 *   whose top-left lies inside one is a group member and is left where it is (not moved
 *   and not an obstacle), since a group is meant to contain nodes
 * @param {number} [gap] clear space left below a node another one is moved under
 * @returns {Map<string, number>} new y for each node that has to move
 */
export function settleBoxes(boxes, frames = [], gap = 24) {
	const inFrame = (b) =>
		frames.some((f) => b.x >= f.x && b.y >= f.y && b.x < f.x + f.w && b.y < f.y + f.h);
	const free = boxes.filter((b) => !inFrame(b)).map((b) => ({ ...b, y0: b.y }));
	// Top to bottom, so a node is only ever pushed below ones that sit above it, and a
	// push cascades down its column in order.
	free.sort((a, b) => a.y - b.y || a.x - b.x);
	const placed = [];
	const moves = new Map();
	for (const b of free) {
		let moved = true;
		while (moved) {
			moved = false;
			for (const p of placed) {
				const overlapX = Math.min(b.x + b.w, p.x + p.w) - Math.max(b.x, p.x);
				const overlapY = Math.min(b.y + b.h, p.y + p.h) - Math.max(b.y, p.y);
				if (overlapX > 0 && overlapY > 0) {
					b.y = p.y + p.h + gap;
					moved = true;
				}
			}
		}
		placed.push(b);
		if (b.y !== b.y0) moves.set(b.id, b.y);
	}
	return moves;
}

/**
 * Where a newly added node can sit without covering another: its own y, or, if it
 * overlaps anything there, just below what it overlaps (repeated until it is clear).
 * Used for a node the topological default places after the session is laid out (an
 * Edit value process a table edit creates, say), which knows nothing of note cards or
 * of where the user has dragged things, and so can land on top of them.
 *
 * @param {{x: number, y: number, w: number, h: number}} box the new node
 * @param {{x: number, y: number, w: number, h: number}[]} obstacles every other node
 * @param {number} [gap] clear space left below the node it is moved under
 * @returns {number} the y to give the new node
 */
export function clearPlacementY(box, obstacles, gap = 24) {
	let y = box.y;
	let moved = true;
	while (moved) {
		moved = false;
		for (const o of obstacles) {
			const overlapX = Math.min(box.x + box.w, o.x + o.w) - Math.max(box.x, o.x);
			const overlapY = Math.min(y + box.h, o.y + o.h) - Math.max(y, o.y);
			if (overlapX > 0 && overlapY > 0) {
				y = o.y + o.h + gap;
				moved = true;
			}
		}
	}
	return y;
}
