// @ts-nocheck

/**
 * ProcessNode: a normalized node model used by the workflow layer.
 * This is intentionally independent from Column/Process/TableProcess classes
 * so workflow logic can reason about typed inputs/outputs without duplicating
 * edge-derivation code inside UI components.
 */
export class ProcessNode {
	constructor({
		id,
		kind,
		label,
		sublabel = '',
		ports = { inputs: [], outputs: [] },
		refId = null,
		meta = {}
	}) {
		this.id = id;
		this.kind = kind;
		this.label = label;
		this.sublabel = sublabel;
		this.ports = {
			inputs: ports.inputs ?? [],
			outputs: ports.outputs ?? []
		};
		this.refId = refId;
		this.meta = meta;
	}
}

function makeNodePort(name, direction, artifactKind = 'column', dynamic = false) {
	return { name, direction, artifactKind, dynamic };
}

/**
 * Group plot data points by x.refId so each unique x forms a "set" with its
 * own `xN`/`ysN` port pair. Preserves the order in which xRefIds first appear
 * in the data array. Data points with no x ref (refId === -1 or null) form
 * their own "orphan" set keyed by -1, so the user can wire an x to them later.
 *
 * Shared by ProcessNode (port emission + connection routing) and WorkflowEditor
 * (apply/disconnect/edge-delete routing). Re-declared locally there to avoid
 * an extra import cycle.
 */
function groupPlotData(data) {
	const groups = [];
	for (const dp of data ?? []) {
		const xRef = dp?.x?.refId ?? -1;
		let g = groups.find((gg) => gg.xRefId === xRef);
		if (!g) {
			g = { xRefId: xRef, dataPoints: [] };
			groups.push(g);
		}
		g.dataPoints.push(dp);
	}
	return groups;
}

function makePortsFromNodeSpec(nodeSpec = {}, fallback = { inputs: [], outputs: [] }) {
	const inputs = (nodeSpec.inputs ?? fallback.inputs ?? []).map((p) =>
		makeNodePort(p.name, 'input', p.kind ?? 'column', p.cardinality === 'many')
	);
	const outputs = (nodeSpec.outputs ?? fallback.outputs ?? []).map((p) =>
		makeNodePort(
			p.name,
			'output',
			p.kind ?? 'column',
			p.cardinality === 'many' || !!p.dynamicPrefix
		)
	);
	return { inputs, outputs };
}

function collectTableProcessInputRefs(tpArgs, nodeSpec) {
	const refs = [];
	const inputs = nodeSpec?.inputs ?? [];

	if (inputs.length === 0) {
		if (typeof tpArgs?.xIN === 'number') refs.push({ colId: tpArgs.xIN, port: 'xIN' });
		if (typeof tpArgs?.yIN === 'number') refs.push({ colId: tpArgs.yIN, port: 'yIN' });
		if (Array.isArray(tpArgs?.yIN)) {
			for (const colId of tpArgs.yIN) refs.push({ colId, port: 'yIN' });
		}
		if (Array.isArray(tpArgs?.xsIN)) {
			for (const colId of tpArgs.xsIN) refs.push({ colId, port: 'xsIN' });
		}
		return refs;
	}

	for (const input of inputs) {
		const port = input?.name;
		if (!port) continue;
		const value = tpArgs?.[port];
		if (Array.isArray(value)) {
			for (const colId of value) refs.push({ colId, port });
		} else {
			refs.push({ colId: value, port });
		}
	}

	return refs;
}

function makeProcessNodeHash(core) {
	let out = '';
	for (const col of core.data ?? []) {
		// `col.name` is included so renaming a data node invalidates the graph
		// cache and the node re-renders with the new label. customName mutates
		// col.name via Column's $derived; name flows through here.
		out += `c:${col.id}:${col.name ?? ''}:${col.refId ?? ''}:${col.tableProcessGUId ?? ''}:${col.getDataHash ?? ''}|`;
		for (const p of col.processes ?? []) {
			out += `p:${p.id}:${p.name}:${JSON.stringify(p.args ?? {})}|`;
		}
	}
	for (const table of core.tables ?? []) {
		out += `t:${table.id}:${table.name}:${(table.columnRefs ?? []).join(',')}|`;
		for (const tp of table.processes ?? []) {
			out += `tp:${tp.id}:${tp.name}:${tp.refTPId ?? ''}:${JSON.stringify(tp.args ?? {})}|`;
		}
	}
	for (const plot of core.plots ?? []) {
		out += `pl:${plot.id}:${plot.type}:${JSON.stringify(plot.plot ?? {})}|`;
	}
	// Notes and groups don't drive data flow but their presence/identity must
	// invalidate the graph cache so they appear / disappear as canvas nodes.
	for (const note of core.notes ?? []) {
		out += `n:${note.id}|`;
	}
	for (const group of core.groups ?? []) {
		out += `g:${group.id}:${group.name}:${group.width}:${group.height}:${(group.childIds ?? []).join(',')}|`;
	}
	return out;
}

let _cachedHash = '';
let _cachedGraph = { nodes: [], connections: [] };
let _cachedNodeExecutionKeys = new Map();

function _safeJson(value) {
	try {
		return JSON.stringify(value ?? {});
	} catch {
		return String(value);
	}
}

function _colDataHash(core, colId) {
	const col = core.data.find((d) => d.id === colId);
	if (!col) return 'missing';
	return String(col.getDataHash ?? col.rawDataVersion ?? '0');
}

function buildNodeExecutionKey(core, node) {
	if (node.meta.type === 'data') {
		const col = core.data.find((d) => d.id === node.refId);
		if (!col) return `data:${node.id}:missing`;
		return [
			`data:${node.id}`,
			String(col.getDataHash ?? ''),
			String(col.refId ?? ''),
			String(col.tableProcessGUId ?? ''),
			_safeJson(col.processes?.map((p) => ({ id: p.id, name: p.name, args: p.args })))
		].join('|');
	}

	if (node.meta.type === 'process') {
		const p = node.meta.processObj;
		if (!p) return `process:${node.id}:missing`;
		const parentCol = core.data.find((d) => (d.processes ?? []).some((x) => x.id === p.id));
		return [
			`process:${node.id}`,
			String(parentCol?.getDataHash ?? 'missing'),
			String(p.name ?? ''),
			_safeJson(p.args)
		].join('|');
	}

	if (node.meta.type === 'tableprocess') {
		const tp = node.meta.tpObj;
		if (!tp) return `tp:${node.id}:missing`;
		const inHashes = collectTableProcessInputRefs(tp.args, node.meta.nodeSpec)
			.filter(({ colId }) => typeof colId === 'number' && colId >= 0)
			.map(({ colId }) => _colDataHash(core, colId));
		return [
			`tp:${node.id}`,
			String(tp.name ?? ''),
			String(tp.refTPId ?? ''),
			_safeJson(tp.args),
			inHashes.join(',')
		].join('|');
	}

	if (node.meta.type === 'plot') {
		const plot = node.meta.plotObj;
		if (!plot) return `plot:${node.id}:missing`;
		const refs = [];
		if (plot.type === 'tableplot') {
			for (const colId of plot.plot?.columnRefs ?? []) refs.push(_colDataHash(core, colId));
		} else {
			for (const d of plot.plot?.data ?? []) {
				for (const axis of ['x', 'y', 'z']) {
					if (d?.[axis]?.refId != null) refs.push(_colDataHash(core, d[axis].refId));
				}
			}
		}
		return [
			`plot:${node.id}`,
			String(plot.type ?? ''),
			_safeJson(plot.plot ?? {}),
			refs.join(',')
		].join('|');
	}

	return `node:${node.id}`;
}

/**
 * Build a normalized process-node graph from existing core classes.
 * Kept backward-compatible by preserving node IDs used by WorkflowEditor.
 */
export function getCachedProcessNodeGraph(core, appConsts) {
	const nextHash = makeProcessNodeHash(core);
	if (_cachedHash === nextHash) return _cachedGraph;

	const nodes = [];
	const connections = [];
	const seenConnections = new Set();

	const tpOutputColIds = new Set();
	for (const table of core.tables ?? []) {
		for (const tp of table.processes ?? []) {
			for (const colId of Object.values(tp.args?.out ?? {})) {
				if (colId != null && colId >= 0) tpOutputColIds.add(colId);
			}
			for (const nestedTp of tp.args?.tableProcesses ?? []) {
				for (const colId of Object.values(nestedTp.args?.out ?? {})) {
					if (colId != null && colId >= 0) tpOutputColIds.add(colId);
				}
			}
		}
	}

	const tableColours = ['#c8d8f0', '#f0c8d8', '#c8f0d8', '#d8c8f0', '#f0d8c8', '#d8f0c8'];
	const colToColor = new Map();
	(core.tables ?? []).forEach((table, idx) => {
		const color = tableColours[idx % tableColours.length];
		(table.columnRefs ?? []).forEach((colId) => colToColor.set(colId, color));
		(table.processes ?? []).forEach((tp) => {
			Object.values(tp.args?.out ?? {}).forEach((colId) => {
				if (colId != null && colId >= 0) colToColor.set(colId, color);
			});
			for (const nestedTp of tp.args?.tableProcesses ?? []) {
				Object.values(nestedTp.args?.out ?? {}).forEach((colId) => {
					if (colId != null && colId >= 0) colToColor.set(colId, color);
				});
			}
		});
	});

	for (const col of core.data ?? []) {
		if (tpOutputColIds.has(col.id)) continue;
		nodes.push(
			new ProcessNode({
				id: `data_${col.id}`,
				kind: 'data',
				label: col.name,
				sublabel: col.type,
				ports: {
					inputs: [],
					outputs: [makeNodePort('column', 'output', 'column')]
				},
				refId: col.id,
				meta: {
					type: 'data',
					refId: col.id,
					tableColor: colToColor.get(col.id)
				}
			})
		);
	}

	for (const col of core.data ?? []) {
		for (const p of col.processes ?? []) {
			const entry = appConsts.processMap.get(p.name);
			const ports = makePortsFromNodeSpec(entry?.nodeSpec, {
				inputs: [{ name: 'input', kind: 'column', cardinality: 'one' }],
				outputs: [{ name: 'output', kind: 'column', cardinality: 'one' }]
			});
			nodes.push(
				new ProcessNode({
					id: `process_${p.id}`,
					kind: 'process',
					label: p.displayName || p.name,
					ports,
					refId: p.id,
					meta: {
						type: 'process',
						refId: p.id,
						processObj: p,
						processName: p.name
					}
				})
			);
		}
	}

	for (const table of core.tables ?? []) {
		for (const tp of table.processes ?? []) {
			const entry = appConsts.tableProcessMap.get(tp.name);
			const nodeSpec = entry?.nodeSpec;
			const ports = makePortsFromNodeSpec(entry?.nodeSpec, {
				inputs: [
					{ name: 'xIN', kind: 'column', cardinality: 'one' },
					{ name: 'yIN', kind: 'column', cardinality: 'many' }
				],
				outputs: [
					{ name: entry?.xOutKey ?? 'xOut', kind: 'column', cardinality: 'one' },
					{ name: (entry?.yOutKeyPrefix ?? 'yOut_') + '*', kind: 'column', cardinality: 'many' }
				]
			});

			nodes.push(
				new ProcessNode({
					id: `tableprocess_${tp.id}`,
					kind: 'tableprocess',
					label: tp.displayName || tp.name,
					sublabel: table.name,
					ports,
					refId: tp.id,
					meta: {
						type: 'tableprocess',
						refId: tp.id,
						tpObj: tp,
						tpName: tp.name,
						nodeSpec
					}
				})
			);

			for (const nestedTp of tp.args?.tableProcesses ?? []) {
				const nestedEntry = [...appConsts.tableProcessMap.values()].find(
					(e) => e.defaults?.get?.('collectedType')?.val === nestedTp.type
				);
				const nestedNodeSpec = nestedEntry?.nodeSpec;
				const nestedPorts = makePortsFromNodeSpec(nestedNodeSpec, {
					inputs: [
						{ name: 'xIN', kind: 'column', cardinality: 'one' },
						{ name: 'yIN', kind: 'column', cardinality: 'many' }
					],
					outputs: [
						{ name: nestedEntry?.xOutKey ?? 'xOut', kind: 'column', cardinality: 'one' },
						{
							name: (nestedEntry?.yOutKeyPrefix ?? 'yOut_') + '*',
							kind: 'column',
							cardinality: 'many'
						}
					]
				});
				nodes.push(
					new ProcessNode({
						id: `tableprocess_nested_${nestedTp.id}`,
						kind: 'tableprocess',
						label: nestedEntry?.displayName || nestedTp.type,
						sublabel: `${table.name} › ${tp.displayName || tp.name}`,
						ports: nestedPorts,
						refId: nestedTp.id,
						meta: {
							type: 'tableprocess',
							refId: nestedTp.id,
							tpObj: nestedTp,
							tpName: nestedTp.type,
							nodeSpec: nestedNodeSpec,
							isNested: true,
							parentTpId: tp.id
						}
					})
				);
			}
		}
	}

	(core.tables ?? []).forEach((table, tableIdx) => {
		const color = tableColours[tableIdx % tableColours.length];
		(table.processes ?? []).forEach((tp) => {
			Object.values(tp.args?.out ?? {}).forEach((colId) => {
				if (colId == null || colId < 0) return;
				const col = core.data.find((d) => d.id === colId);
				if (!col) return;
				nodes.push(
					new ProcessNode({
						id: `data_${col.id}`,
						kind: 'data',
						label: col.name,
						sublabel: col.type,
						ports: {
							inputs: [],
							outputs: [makeNodePort('column', 'output', 'column')]
						},
						refId: col.id,
						meta: {
							type: 'data',
							refId: col.id,
							tableColor: color,
							isTPOutput: true
						}
					})
				);
			});

			for (const nestedTp of tp.args?.tableProcesses ?? []) {
				Object.values(nestedTp.args?.out ?? {}).forEach((colId) => {
					if (colId == null || colId < 0) return;
					const col = core.data.find((d) => d.id === colId);
					if (!col) return;
					nodes.push(
						new ProcessNode({
							id: `data_${col.id}`,
							kind: 'data',
							label: col.name,
							sublabel: col.type,
							ports: {
								inputs: [],
								outputs: [makeNodePort('column', 'output', 'column')]
							},
							refId: col.id,
							meta: {
								type: 'data',
								refId: col.id,
								tableColor: color,
								isTPOutput: true
							}
						})
					);
				});
			}
		});
	});

	for (const plot of core.plots ?? []) {
		// Tableplots have a flat `columnRefs` list — keep them as a single `series`
		// port. Every other plot type carries `data: [{x: {refId}, y: {refId}, z?:
		// {refId}}, ...]`, so expose flowtest-style {x, ys[, zs]} ports.
		const inputs = [];
		if (plot.type === 'tableplot') {
			inputs.push(makeNodePort('series', 'input', 'column', true));
		} else {
			// Per-x "set" ports: each unique x.refId in plot.plot.data becomes an
			// (xN, ysN) pair, and a trailing empty pair is always appended so the
			// user can drop a wire to begin a new set.
			const groups = groupPlotData(plot.plot?.data);
			groups.forEach((_, i) => {
				inputs.push(makeNodePort(`x${i + 1}`, 'input', 'column', false));
				inputs.push(makeNodePort(`ys${i + 1}`, 'input', 'column', true));
			});
			const next = groups.length + 1;
			inputs.push(makeNodePort(`x${next}`, 'input', 'column', false));
			inputs.push(makeNodePort(`ys${next}`, 'input', 'column', true));
		}

		nodes.push(
			new ProcessNode({
				id: `plot_${plot.id}`,
				kind: 'plot',
				label: plot.name,
				sublabel: plot.type,
				ports: { inputs, outputs: [] },
				refId: plot.id,
				meta: {
					type: 'plot',
					refId: plot.id,
					plotObj: plot
				}
			})
		);
	}

	// Standalone Note nodes — pure annotation, no ports, no edges.
	for (const note of core.notes ?? []) {
		nodes.push(
			new ProcessNode({
				id: note.id,
				kind: 'note',
				label: 'Note',
				sublabel: '',
				ports: { inputs: [], outputs: [] },
				refId: note.id,
				meta: {
					type: 'note',
					refId: note.id,
					noteObj: note
				}
			})
		);
	}

	// Group nodes — visual containers, no ports, no edges. Membership is
	// reconciled in WorkflowEditor.stopAll based on drop position.
	for (const group of core.groups ?? []) {
		nodes.push(
			new ProcessNode({
				id: group.id,
				kind: 'group',
				label: group.name,
				sublabel: '',
				ports: { inputs: [], outputs: [] },
				refId: group.id,
				meta: {
					type: 'group',
					refId: group.id,
					groupObj: group
				}
			})
		);
	}

	const nodeMap = new Map(nodes.map((n) => [n.id, n]));

	function addConnection(fromId, toId, type, fromPort = 'output', toPort = 'input') {
		if (!nodeMap.has(fromId) || !nodeMap.has(toId)) return;
		const key = `${fromId}|${fromPort}|${toId}|${toPort}|${type}`;
		if (seenConnections.has(key)) return;
		seenConnections.add(key);
		connections.push({ fromId, fromPort, toId, toPort, type });
	}

	for (const col of core.data ?? []) {
		let prevId = `data_${col.id}`;
		for (const p of col.processes ?? []) {
			const pid = `process_${p.id}`;
			addConnection(prevId, pid, 'data-process', 'column', 'input');
			prevId = pid;
		}
	}

	for (const table of core.tables ?? []) {
		for (const tp of table.processes ?? []) {
			const tpNodeId = `tableprocess_${tp.id}`;
			const entry = appConsts.tableProcessMap.get(tp.name);
			const tpInputs = collectTableProcessInputRefs(tp.args, entry?.nodeSpec);

			for (const { colId, port } of tpInputs) {
				if (colId == null || colId < 0) continue;
				const col = core.data.find((d) => d.id === colId);
				if (!col) continue;
				const lastId =
					(col.processes ?? []).length > 0
						? `process_${col.processes[col.processes.length - 1].id}`
						: `data_${colId}`;
				addConnection(lastId, tpNodeId, 'data-tp', 'output', port);
			}

			for (const [outKey, colId] of Object.entries(tp.args?.out ?? {})) {
				if (colId == null || colId < 0) continue;
				addConnection(tpNodeId, `data_${colId}`, 'tp-data', outKey, 'column');
			}

			for (const nestedTp of tp.args?.tableProcesses ?? []) {
				const nestedNodeId = `tableprocess_nested_${nestedTp.id}`;
				const nestedEntry = [...appConsts.tableProcessMap.values()].find(
					(e) => e.defaults?.get?.('collectedType')?.val === nestedTp.type
				);
				const nestedInputRefs = collectTableProcessInputRefs(nestedTp.args, nestedEntry?.nodeSpec);
				for (const { colId, port } of nestedInputRefs) {
					if (colId == null || colId < 0) continue;
					addConnection(`data_${colId}`, nestedNodeId, 'data-tp', 'output', port);
				}
				for (const [outKey, colId] of Object.entries(nestedTp.args?.out ?? {})) {
					if (colId == null || colId < 0) continue;
					addConnection(nestedNodeId, `data_${colId}`, 'tp-data', outKey, 'column');
				}
			}
		}
	}

	for (const plot of core.plots ?? []) {
		const plotNodeId = `plot_${plot.id}`;
		function addPlotCol(colId, port) {
			if (colId == null || colId < 0) return;
			const col = core.data.find((d) => d.id === colId);
			if (!col) return;
			const lastId =
				(col.processes ?? []).length > 0
					? `process_${col.processes[col.processes.length - 1].id}`
					: `data_${colId}`;
			addConnection(lastId, plotNodeId, 'data-plot', 'output', port);
		}

		if (plot.type === 'tableplot') {
			(plot.plot?.columnRefs ?? []).forEach((colId) => addPlotCol(colId, 'series'));
		} else {
			// Per-set wires: each group contributes ONE x wire (since all data
			// points in the set share x) and one ys wire per data point.
			const groups = groupPlotData(plot.plot?.data);
			groups.forEach((g, i) => {
				const portX = `x${i + 1}`;
				const portYs = `ys${i + 1}`;
				if (g.xRefId != null && g.xRefId >= 0) addPlotCol(g.xRefId, portX);
				for (const dp of g.dataPoints) {
					if (dp?.y?.refId != null && dp.y.refId >= 0) addPlotCol(dp.y.refId, portYs);
				}
			});
		}
	}

	const changedNodeIds = [];
	const nextKeys = new Map();

	const workflowNodes = nodes.map((n) => {
		const executionKey = buildNodeExecutionKey(core, n);
		nextKeys.set(n.id, executionKey);
		if (_cachedNodeExecutionKeys.get(n.id) !== executionKey) changedNodeIds.push(n.id);
		return {
			id: n.id,
			label: n.label,
			sublabel: n.sublabel,
			type: n.meta.type,
			refId: n.refId,
			ports: n.ports,
			executionKey,
			...n.meta
		};
	});

	_cachedHash = nextHash;
	_cachedNodeExecutionKeys = nextKeys;
	_cachedGraph = {
		nodes: workflowNodes,
		connections,
		changedNodeIds
	};
	return _cachedGraph;
}

export function clearProcessNodeGraphCache() {
	_cachedHash = '';
	_cachedNodeExecutionKeys = new Map();
	_cachedGraph = { nodes: [], connections: [] };
}
