// Topological layer assignment for the workflow canvas's default and "Tidy" layouts: the
// longest path in the DAG, so every edge flows from a lower layer to a higher one (left to
// right). Pure; extracted from WorkflowEditor.svelte so it can be tested.
//
// A SELF-edge (a node wired to itself, e.g. a Periodogram's peak_period output driving its
// own reference line; overlays plan 2026-10-15, Q4) carries no ordering and is ignored. Left
// in, it gave the node an in-degree that never reached zero, so Kahn's sort never visited it
// or anything downstream of it, and those nodes were laid out in arbitrary order.

/**
 * @param {Array<{id: string}>} nodes
 * @param {Array<{fromId: string, toId: string}>} edges
 * @returns {Map<string, number>} node id -> layer (0 for sources and unconnected nodes)
 */
export function computeNodeLayers(nodes, edges) {
	const nodeIds = new Set(nodes.map((n) => n.id));
	const adj = new Map();
	const inDeg = new Map();

	for (const id of nodeIds) {
		adj.set(id, []);
		inDeg.set(id, 0);
	}

	for (const edge of edges) {
		if (!nodeIds.has(edge.fromId) || !nodeIds.has(edge.toId)) continue;
		if (edge.fromId === edge.toId) continue; // a self-edge orders nothing
		adj.get(edge.fromId).push(edge.toId);
		inDeg.set(edge.toId, inDeg.get(edge.toId) + 1);
	}

	// Kahn's topological sort
	const topoOrder = [];
	const queue = [];
	const tempInDeg = new Map(inDeg);

	for (const [id, deg] of tempInDeg) {
		if (deg === 0) queue.push(id);
	}

	while (queue.length > 0) {
		const current = queue.shift();
		topoOrder.push(current);
		for (const next of adj.get(current) || []) {
			tempInDeg.set(next, tempInDeg.get(next) - 1);
			if (tempInDeg.get(next) === 0) queue.push(next);
		}
	}

	// Handle any nodes not reached (cycles / disconnected)
	const processed = new Set(topoOrder);
	for (const id of nodeIds) {
		if (!processed.has(id)) topoOrder.push(id);
	}

	// Longest-path layer assignment
	const layer = new Map();
	for (const id of topoOrder) {
		if (!layer.has(id)) layer.set(id, 0);
		for (const next of adj.get(id) || []) {
			const newLayer = layer.get(id) + 1;
			if (!layer.has(next) || newLayer > layer.get(next)) {
				layer.set(next, newLayer);
			}
		}
	}

	for (const id of nodeIds) {
		if (!layer.has(id)) layer.set(id, 0);
	}

	return layer;
}
