// The SVG path of a canvas wire (WorkflowEdges.svelte). Pure, so the shapes can be tested.

/** Horizontal reach of a self-loop beyond the node's sides, and its clearance above the node. */
const LOOP_REACH = 40;
const LOOP_CLEARANCE = 24;

/**
 * A cubic bezier from an output port to an input port (ported from flowtest's NodeCanvas):
 * dx = max(40, |tx - sx| / 2) on each side.
 *
 * With `loopTop` (the y of the node's top edge), the wire is a SELF-edge: a node's output
 * wired back into one of its own inputs (a Periodogram's peak_period driving its own
 * reference line; overlays plan 2026-10-15, Q4). The input port is then to the LEFT of the
 * output port, and the bezier would run straight through the node's body. Instead the loop
 * leaves the output to the right, rises above the node, crosses over it and comes down into
 * the input from the left.
 *
 * @param {{x:number, y:number}} from
 * @param {{x:number, y:number}} to
 * @param {{loopTop?: number}} [opts]
 * @returns {string}
 */
export function edgePath(from, to, { loopTop = null } = {}) {
	const { x: sx, y: sy } = from;
	const { x: tx, y: ty } = to;
	if (Number.isFinite(loopTop)) {
		const ly = Math.min(loopTop, sy, ty) - LOOP_CLEARANCE;
		const r = LOOP_REACH;
		return (
			`M ${sx},${sy} C ${sx + r},${sy} ${sx + r},${ly} ${sx},${ly} ` +
			`L ${tx},${ly} C ${tx - r},${ly} ${tx - r},${ty} ${tx},${ty}`
		);
	}
	const dx = Math.max(40, Math.abs(tx - sx) / 2);
	return `M ${sx},${sy} C ${sx + dx},${sy} ${tx - dx},${ty} ${tx},${ty}`;
}
