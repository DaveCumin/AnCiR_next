// @ts-nocheck
// Per-port Y publishing for Group nodes.
//
// Group rows can expand to show a MiniDataTable preview, which shifts the Y of
// every row below the expanded one. The static formula
// `HEADER_H + idx * PORT_H + PORT_H/2` used by WorkflowEditor.getPortAnchorY
// can't see that shift, so it would land wires on the wrong rows. To solve
// this without growing the formula, GroupNode measures its rendered DOM
// (after every layout-relevant change) and publishes each port's node-local
// Y here. WorkflowEditor's getPortAnchorY consults this map first for group
// nodes, falling back to the formula only when no measurement exists yet.

const positions = $state({});

export function setGroupPortY(nodeId, portName, y) {
	const existing = positions[nodeId];
	if (!existing) {
		positions[nodeId] = { [portName]: y };
		return;
	}
	if (existing[portName] !== y) existing[portName] = y;
}

export function getGroupPortY(nodeId, portName) {
	return positions[nodeId]?.[portName];
}

export function clearGroupPortPositions(nodeId) {
	delete positions[nodeId];
}
