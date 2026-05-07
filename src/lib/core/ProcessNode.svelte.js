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

function makeProcessNodeHash(core) {
	let out = '';
	for (const col of core.data ?? []) {
		out += `c:${col.id}:${col.refId ?? ''}:${col.tableProcessGUId ?? ''}:${col.getDataHash ?? ''}|`;
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
	return out;
}

let _cachedHash = '';
let _cachedGraph = { nodes: [], connections: [] };

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
			nodes.push(
				new ProcessNode({
					id: `process_${p.id}`,
					kind: 'process',
					label: p.displayName || p.name,
					ports: {
						inputs: [makeNodePort('input', 'input', 'column')],
						outputs: [makeNodePort('output', 'output', 'column')]
					},
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
			const inputPorts = [];
			if ('xIN' in (tp.args ?? {})) inputPorts.push(makeNodePort('xIN', 'input', 'column'));
			if ('yIN' in (tp.args ?? {})) inputPorts.push(makeNodePort('yIN', 'input', 'column', Array.isArray(tp.args?.yIN)));
			if (Array.isArray(tp.args?.xsIN)) inputPorts.push(makeNodePort('xsIN', 'input', 'column', true));

			const outputPorts = [];
			for (const [outKey] of Object.entries(tp.args?.out ?? {})) {
				const isDynamicY = Boolean(entry?.yOutKeyPrefix) && outKey.startsWith(entry.yOutKeyPrefix);
				outputPorts.push(makeNodePort(outKey, 'output', 'column', isDynamicY));
			}

			nodes.push(
				new ProcessNode({
					id: `tableprocess_${tp.id}`,
					kind: 'tableprocess',
					label: tp.displayName || tp.name,
					sublabel: table.name,
					ports: { inputs: inputPorts, outputs: outputPorts },
					refId: tp.id,
					meta: {
						type: 'tableprocess',
						refId: tp.id,
						tpObj: tp,
						tpName: tp.name
					}
				})
			);
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
		});
	});

	for (const plot of core.plots ?? []) {
		nodes.push(
			new ProcessNode({
				id: `plot_${plot.id}`,
				kind: 'plot',
				label: plot.name,
				sublabel: plot.type,
				ports: {
					inputs: [makeNodePort('series', 'input', 'column', true)],
					outputs: []
				},
				refId: plot.id,
				meta: {
					type: 'plot',
					refId: plot.id,
					plotObj: plot
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
			const tpInputs = [];
			if (typeof tp.args?.xIN === 'number') tpInputs.push({ colId: tp.args.xIN, port: 'xIN' });
			if (typeof tp.args?.yIN === 'number') tpInputs.push({ colId: tp.args.yIN, port: 'yIN' });
			if (Array.isArray(tp.args?.yIN)) {
				for (const colId of tp.args.yIN) tpInputs.push({ colId, port: 'yIN' });
			}
			if (Array.isArray(tp.args?.xsIN)) {
				for (const colId of tp.args.xsIN) tpInputs.push({ colId, port: 'xsIN' });
			}

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
		}
	}

	for (const plot of core.plots ?? []) {
		const plotNodeId = `plot_${plot.id}`;
		function addPlotCol(colId) {
			if (colId == null || colId < 0) return;
			const col = core.data.find((d) => d.id === colId);
			if (!col) return;
			const lastId =
				(col.processes ?? []).length > 0
					? `process_${col.processes[col.processes.length - 1].id}`
					: `data_${colId}`;
			addConnection(lastId, plotNodeId, 'data-plot', 'output', 'series');
		}

		if (plot.type === 'tableplot') {
			(plot.plot?.columnRefs ?? []).forEach(addPlotCol);
		} else {
			(plot.plot?.data ?? []).forEach((dataPoint) => {
				for (const axis of ['x', 'y', 'z']) {
					if (dataPoint?.[axis]?.refId != null) addPlotCol(dataPoint[axis].refId);
				}
			});
		}
	}

	const workflowNodes = nodes.map((n) => ({
		id: n.id,
		label: n.label,
		sublabel: n.sublabel,
		type: n.meta.type,
		refId: n.refId,
		ports: n.ports,
		...n.meta
	}));

	_cachedHash = nextHash;
	_cachedGraph = {
		nodes: workflowNodes,
		connections
	};
	return _cachedGraph;
}

export function clearProcessNodeGraphCache() {
	_cachedHash = '';
	_cachedGraph = { nodes: [], connections: [] };
}
