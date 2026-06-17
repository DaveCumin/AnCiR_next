// Pure composite-node helpers. No Svelte state here — unit-testable.

/**
 * Boundary inputs/outputs of a member set, given the workflow connection list
 * (shaped like getProcessNodeGraph().connections: { fromId, fromPort, toId, toPort }).
 *
 * Inputs  = edges entering the set from outside (one per member input port).
 * Outputs = edges leaving the set to outside (one per member output port).
 * Internal member<->member edges are ignored. Results are deduped by
 * member+port, so multiple external consumers of one output collapse to a
 * single output port.
 *
 * @param {Set<string>|string[]} memberIds
 * @param {{fromId:string,fromPort:string,toId:string,toPort:string}[]} connections
 * @returns {{ inputs: Port[], outputs: Port[] }}  Port = { id, name, member, port }
 */
export function computeInterface(memberIds, connections) {
	const members = memberIds instanceof Set ? memberIds : new Set(memberIds);
	const inMap = new Map(); // `${member}|${toPort}` -> Port
	const outMap = new Map(); // `${member}|${fromPort}` -> Port
	for (const c of connections ?? []) {
		const fromIn = members.has(c.fromId);
		const toIn = members.has(c.toId);
		if (toIn && !fromIn) {
			const key = `${c.toId}|${c.toPort}`;
			if (!inMap.has(key)) {
				inMap.set(key, { id: `in:${key}`, name: c.toPort, member: c.toId, port: c.toPort });
			}
		} else if (fromIn && !toIn) {
			const key = `${c.fromId}|${c.fromPort}`;
			if (!outMap.has(key)) {
				outMap.set(key, { id: `out:${key}`, name: c.fromPort, member: c.fromId, port: c.fromPort });
			}
		}
	}
	return { inputs: [...inMap.values()], outputs: [...outMap.values()] };
}
