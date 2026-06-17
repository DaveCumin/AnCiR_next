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

/**
 * Flatten a member list to leaf operation-node ids, expanding any nested
 * composite members recursively. `members` is a memberIds array (may contain
 * `composite_*` ids); `composites` is the full core.composites list.
 * @returns {string[]} leaf node ids (process_/tableprocess_), de-duplicated, order-preserving.
 */
export function flattenMembers(members, composites) {
	const byId = new Map((composites ?? []).map((c) => [c.id, c]));
	const out = [];
	const seenComposite = new Set();
	const seenLeaf = new Set();
	const walk = (ids) => {
		for (const id of ids ?? []) {
			if (typeof id === 'string' && id.startsWith('composite_')) {
				if (seenComposite.has(id)) continue;
				seenComposite.add(id);
				walk(byId.get(id)?.memberIds);
			} else if (!seenLeaf.has(id)) {
				seenLeaf.add(id);
				out.push(id);
			}
		}
	};
	walk(members);
	return out;
}

/**
 * All composite ids nested (transitively) inside a member list. Used to hide
 * child-composite nodes when an ancestor is collapsed.
 * @returns {string[]} composite ids
 */
export function nestedCompositeIds(members, composites) {
	const byId = new Map((composites ?? []).map((c) => [c.id, c]));
	const out = [];
	const seen = new Set();
	const walk = (ids) => {
		for (const id of ids ?? []) {
			if (typeof id === 'string' && id.startsWith('composite_') && !seen.has(id)) {
				seen.add(id);
				out.push(id);
				walk(byId.get(id)?.memberIds);
			}
		}
	};
	walk(members);
	return out;
}
