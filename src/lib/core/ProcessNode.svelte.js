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
			// All three axes are many-cardinality. Each data point in plot.plot.data
			// emits its own wire so users can mix x columns across series, exactly
			// like flowtest's dynamic ports.
			const hasZ = (plot.plot?.data ?? []).some((dp) => dp?.z?.refId != null);
			inputs.push(makeNodePort('xs', 'input', 'column', true));
			inputs.push(makeNodePort('ys', 'input', 'column', true));
			if (hasZ) inputs.push(makeNodePort('zs', 'input', 'column', true));
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
			// One wire per (data point, axis). No de-dup on x — multiple series with
			// different x columns each get their own wire to the `xs` port.
			for (const dp of plot.plot?.data ?? []) {
				if (dp?.x?.refId != null) addPlotCol(dp.x.refId, 'xs');
				if (dp?.y?.refId != null) addPlotCol(dp.y.refId, 'ys');
				if (dp?.z?.refId != null) addPlotCol(dp.z.refId, 'zs');
			}
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
