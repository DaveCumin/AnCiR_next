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

// Plots whose data-point shape isn't `{x, y, ...}` (Histogram has `column`;
// Periodogram/Correlogram/FFT/Actogram use `time` + `values`) need their own
// canvas wires. Walks each data point's *declared* input fields (from the plot
// type's defaultDataInputs) and yields one entry per (datum × field) with a
// port name of `${field}${datumIdx + 1}` so multiple datums get distinct ports.
// Iterating declared names instead of `Object.keys(dp)` avoids depending on
// Svelte 5 $state field enumerability.
function collectAuxPlotInputs(data, fieldNames) {
	const entries = [];
	const fields = (fieldNames ?? []).filter((f) => f !== 'x' && f !== 'y');
	if (fields.length === 0) return entries;
	const list = data ?? [];
	for (let i = 0; i < list.length; i++) {
		const dp = list[i];
		if (!dp || typeof dp !== 'object') continue;
		for (const f of fields) {
			const v = dp[f];
			if (v && typeof v === 'object' && typeof v.refId === 'number') {
				entries.push({ datumIdx: i, field: f, refId: v.refId });
			}
		}
	}
	return entries;
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
		// `refUpToProcessId` is included so that creating, breaking, or moving
		// a tap point re-derives the graph (tap columns are hidden, and their
		// downstream wires reroute through process_<refUpToProcessId>.output).
		out += `c:${col.id}:${col.name ?? ''}:${col.refId ?? ''}:${col.refUpToProcessId ?? ''}:${col.isTap ? 't' : ''}:${col.tableProcessGUId ?? ''}:${col.getDataHash ?? ''}|`;
		for (const p of col.processes ?? []) {
			out += `p:${p.id}:${p.name}:${JSON.stringify(p.args ?? {})}|`;
		}
	}
	for (const tp of core.tableProcesses ?? []) {
		out += `tp:${tp.id}:${tp.name}:${tp.refTPId ?? ''}:${JSON.stringify(tp.args ?? {})}|`;
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
		const srcIds = (group.sourceColumnIds ?? []).join(',');
		const allIds = Array.isArray(group.allColumnIds) ? group.allColumnIds.join(',') : 'null';
		const collapsed = group.collapsed === true ? 'c' : 'e';
		out += `g:${group.id}:${group.name}:${group.width}:${group.height}:${srcIds}:${allIds}:${collapsed}|`;
	}
	// Orphan processes invalidate the graph when added, removed, or re-named.
	for (const p of core.orphanProcesses ?? []) {
		out += `op:${p.id}:${p.name}:${JSON.stringify(p.args ?? {})}|`;
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
	// colId → { nodeId, port } pointing at the producing TP node's inline
	// output-column row. TP output columns render as rows INSIDE the TP node
	// (flowtest Group-style), not as standalone data_<colId> nodes, so every
	// downstream consumer anchors its wire on the TP node's `col_<colId>` port.
	const tpOutputColToTP = new Map();
	const collectTPOutputs = (tp) => {
		const tpNodeId = `tableprocess_${tp.id}`;
		for (const colId of Object.values(tp.args?.out ?? {})) {
			if (colId != null && colId >= 0) {
				tpOutputColIds.add(colId);
				tpOutputColToTP.set(colId, { nodeId: tpNodeId, port: `col_${colId}` });
			}
		}
		for (const nestedTp of tp.args?.tableProcesses ?? []) {
			const nestedNodeId = `tableprocess_nested_${nestedTp.id}`;
			for (const colId of Object.values(nestedTp.args?.out ?? {})) {
				if (colId != null && colId >= 0) {
					tpOutputColIds.add(colId);
					tpOutputColToTP.set(colId, { nodeId: nestedNodeId, port: `col_${colId}` });
				}
			}
		}
	};
	for (const tp of core.tableProcesses ?? []) collectTPOutputs(tp);

	// Map colId → owning groupId for any column absorbed as a Source-group row.
	// Standalone `data_${col.id}` nodes are suppressed for absorbed columns; edges
	// that previously emitted from those data nodes get re-routed to a per-row
	// output port on the owning group (`col_${colId}`). Table-process output
	// columns are never absorbable here (they have no standalone data node to
	// drag from), so we just ignore those entries.
	const absorbedColToGroup = new Map();
	for (const group of core.groups ?? []) {
		for (const colId of group.sourceColumnIds ?? []) {
			if (typeof colId !== 'number') continue;
			if (tpOutputColIds.has(colId)) continue;
			absorbedColToGroup.set(colId, group.id);
		}
	}

	// Tap columns: hidden from the canvas, used as an internal carrier so a
	// process inserted by single-edge splice doesn't have to physically join
	// the source column's process chain (which would re-route every other
	// consumer of that source). Two ways a column qualifies:
	//   - `refUpToProcessId` set & non-broken: tap exposes refColumn's state
	//     truncated AFTER that process id.
	//   - `isTap === true`: synthetic tap (the only way to mark a tap whose
	//     source has no processes — refUpToProcessId is null in that case).
	// Broken taps (refUpToProcessId === -1) are skipped so their consumers
	// fall back to the normal data_X path (where getData() returns []).
	const tapColMeta = new Map(); // colId → { refId, refUpToProcessId }
	for (const col of core.data ?? []) {
		const hasUpTo = col.refUpToProcessId != null && col.refUpToProcessId !== -1;
		if (hasUpTo || (col.isTap === true && col.refId != null)) {
			tapColMeta.set(col.id, {
				refId: col.refId,
				refUpToProcessId: hasUpTo ? col.refUpToProcessId : null
			});
		}
	}

	// Resolve a column's "starting" canvas node + port. For absorbed columns
	// this is the owning group's per-row output port; for tap columns we
	// route to the source's pipeline end (either a specific process for
	// truncated taps, or the source's own last process / data node for
	// synthetic full-pass taps); otherwise it's the standalone
	// `data_${col.id}` node's `column` port.
	function columnSourceRef(colId) {
		const tap = tapColMeta.get(colId);
		if (tap) {
			if (tap.refUpToProcessId != null) {
				return { nodeId: `process_${tap.refUpToProcessId}`, port: 'output' };
			}
			// Synthetic raw-data tap: chain wire comes from the source's
			// last-process output, OR from the source's own data node if
			// the source has no processes. Recurse so absorbed/tap chains
			// of taps still resolve.
			const refCol = (core.data ?? []).find((c) => c.id === tap.refId);
			if (refCol && (refCol.processes ?? []).length > 0) {
				const last = refCol.processes[refCol.processes.length - 1];
				return { nodeId: `process_${last.id}`, port: 'output' };
			}
			return columnSourceRef(tap.refId);
		}
		const gid = absorbedColToGroup.get(colId);
		if (gid) return { nodeId: gid, port: `col_${colId}` };
		// TP-output column: route to the producing TP node's inline row port.
		const tpRef = tpOutputColToTP.get(colId);
		if (tpRef) return { nodeId: tpRef.nodeId, port: tpRef.port };
		return { nodeId: `data_${colId}`, port: 'column' };
	}

	for (const col of core.data ?? []) {
		if (tpOutputColIds.has(col.id)) continue;
		// Columns absorbed by a group render as inline rows on that group, not
		// as standalone canvas nodes.
		if (absorbedColToGroup.has(col.id)) continue;
		// Tap columns are model-only: hidden on the canvas, with their consumer
		// wires re-routed via columnSourceRef to come from process_<...>.output.
		if (tapColMeta.has(col.id)) continue;
		nodes.push(
			new ProcessNode({
				id: `data_${col.id}`,
				kind: 'data',
				label: col.name,
				ports: {
					inputs: [],
					outputs: [makeNodePort('column', 'output', 'column')]
				},
				refId: col.id,
				meta: {
					type: 'data',
					refId: col.id
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

	// Orphan column-processes: spawned via palette / paste, not yet wired to a
	// parent column. They render with the same ports as attached processes but
	// emit no chain edges; wiring a column output to their `input` port moves
	// them out of orphans into that column's processes[] (see
	// attachOrphanProcessToColumn).
	for (const p of core.orphanProcesses ?? []) {
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
					processName: p.name,
					isOrphan: true
				}
			})
		);
	}

	// Ordered list of a TP's output columns ({ key, colId }) from args.out, and
	// the matching output ports: an `all` fan-out port (flowtest Group-style)
	// plus one `col_<colId>` port per output column. Output columns render as
	// inline rows INSIDE the TP node, so there are no abstract xOut/yOut_* ports.
	const buildTPOutputs = (args) => {
		const outputColumns = [];
		for (const [key, colId] of Object.entries(args?.out ?? {})) {
			if (typeof colId !== 'number' || colId < 0) continue;
			outputColumns.push({ key, colId });
		}
		const outputPorts = [makeNodePort('all', 'output', 'column', true)];
		for (const { colId } of outputColumns) {
			outputPorts.push(makeNodePort(`col_${colId}`, 'output', 'column'));
		}
		return { outputColumns, outputPorts };
	};

	const emitTableProcessNode = (tp, parentLabel = '') => {
		const entry = appConsts.tableProcessMap.get(tp.name);
		const nodeSpec = entry?.nodeSpec;
		const { inputs } = makePortsFromNodeSpec(entry?.nodeSpec, {
			inputs: [
				{ name: 'xIN', kind: 'column', cardinality: 'one' },
				{ name: 'yIN', kind: 'column', cardinality: 'many' }
			]
		});
		const { outputColumns, outputPorts } = buildTPOutputs(tp.args);

		nodes.push(
			new ProcessNode({
				id: `tableprocess_${tp.id}`,
				kind: 'tableprocess',
				label: tp.displayName || tp.name,
				sublabel: parentLabel,
				ports: { inputs, outputs: outputPorts },
				refId: tp.id,
				meta: {
					type: 'tableprocess',
					refId: tp.id,
					tpObj: tp,
					tpName: tp.name,
					nodeSpec,
					outputColumns
				}
			})
		);

		for (const nestedTp of tp.args?.tableProcesses ?? []) {
			const nestedEntry = [...appConsts.tableProcessMap.values()].find(
				(e) => e.defaults?.get?.('collectedType')?.val === nestedTp.type
			);
			const nestedNodeSpec = nestedEntry?.nodeSpec;
			const { inputs: nestedInputs } = makePortsFromNodeSpec(nestedNodeSpec, {
				inputs: [
					{ name: 'xIN', kind: 'column', cardinality: 'one' },
					{ name: 'yIN', kind: 'column', cardinality: 'many' }
				]
			});
			const { outputColumns: nestedOutCols, outputPorts: nestedOutPorts } = buildTPOutputs(
				nestedTp.args
			);
			nodes.push(
				new ProcessNode({
					id: `tableprocess_nested_${nestedTp.id}`,
					kind: 'tableprocess',
					label: nestedEntry?.displayName || nestedTp.type,
					sublabel: parentLabel ? `${parentLabel} › ${tp.displayName || tp.name}` : tp.displayName || tp.name,
					ports: { inputs: nestedInputs, outputs: nestedOutPorts },
					refId: nestedTp.id,
					meta: {
						type: 'tableprocess',
						refId: nestedTp.id,
						tpObj: nestedTp,
						tpName: nestedTp.type,
						nodeSpec: nestedNodeSpec,
						isNested: true,
						parentTpId: tp.id,
						outputColumns: nestedOutCols
					}
				})
			);
		}
	};

	for (const tp of core.tableProcesses ?? []) emitTableProcessNode(tp, '');

	for (const plot of core.plots ?? []) {
		// Tableplots have a flat `columnRefs` list — keep them as a single `series`
		// port. Every other plot type carries `data: [{x: {refId}, y: {refId}, z?:
		// {refId}}, ...]`, so expose flowtest-style {x, ys[, zs]} ports.
		const inputs = [];
		if (plot.type === 'tableplot') {
			inputs.push(makeNodePort('series', 'input', 'column', true));
		} else {
			const defaultInputs = appConsts?.plotMap?.get(plot.type)?.defaultInputs ?? [];
			const usesXY = defaultInputs.includes('x') || defaultInputs.includes('y');

			if (usesXY) {
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
			} else if (defaultInputs.length === 1) {
				// Single-input plots (Histogram). One dynamic `data` port: each wire
				// becomes its own series with independent binning/colour. Mirrors the
				// tableplot `series` pattern.
				inputs.push(makeNodePort('data', 'input', 'column', true));
			} else {
				// Multi-input plots (Periodogram/Correlogram/FFT/Actogram use
				// `time` + `values`). One port per (datum × field) plus a trailing
				// empty per-field set so the user can drop a wire to add a new series.
				const datumCount = (plot.plot?.data ?? []).length;
				for (let i = 0; i < datumCount; i++) {
					for (const field of defaultInputs) {
						inputs.push(makeNodePort(`${field}${i + 1}`, 'input', 'column', false));
					}
				}
				for (const field of defaultInputs) {
					inputs.push(makeNodePort(`${field}${datumCount + 1}`, 'input', 'column', false));
				}
			}
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

	// Group nodes — flowtest-style Source group. One output port per absorbed
	// column (`col_${colId}`) plus an `all` port that fans out to every source
	// (filtered by group.allColumnIds when non-null). The standalone `data_X`
	// nodes for absorbed columns are suppressed above, and downstream edges get
	// re-routed via `columnSourceRef` below.
	for (const group of core.groups ?? []) {
		const sourceIds = (group.sourceColumnIds ?? []).filter((id) => typeof id === 'number');
		const outputs = [];
		outputs.push(makeNodePort('all', 'output', 'column', true));
		for (const colId of sourceIds) {
			outputs.push(makeNodePort(`col_${colId}`, 'output', 'column'));
		}
		nodes.push(
			new ProcessNode({
				id: group.id,
				kind: 'group',
				label: group.name,
				sublabel: '',
				ports: { inputs: [], outputs },
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
		const initial = columnSourceRef(col.id);
		let prevId = initial.nodeId;
		let prevPort = initial.port;
		for (const p of col.processes ?? []) {
			const pid = `process_${p.id}`;
			addConnection(prevId, pid, 'data-process', prevPort, 'input');
			prevId = pid;
			prevPort = 'column';
		}
	}

	const emitTPConnections = (tp) => {
		const tpNodeId = `tableprocess_${tp.id}`;
		const entry = appConsts.tableProcessMap.get(tp.name);
		const tpInputs = collectTableProcessInputRefs(tp.args, entry?.nodeSpec);

		for (const { colId, port } of tpInputs) {
			if (colId == null || colId < 0) continue;
			const col = core.data.find((d) => d.id === colId);
			if (!col) continue;
			let fromId, fromPort;
			if ((col.processes ?? []).length > 0) {
				fromId = `process_${col.processes[col.processes.length - 1].id}`;
				fromPort = 'output';
			} else {
				const src = columnSourceRef(colId);
				fromId = src.nodeId;
				fromPort = src.port;
			}
			addConnection(fromId, tpNodeId, 'data-tp', fromPort, port);
		}

		// No tp→data output edges: TP output columns are inline rows on the TP
		// node itself, and downstream consumers anchor on `col_<colId>` ports
		// (resolved via columnSourceRef → tpOutputColToTP).

		for (const nestedTp of tp.args?.tableProcesses ?? []) {
			const nestedNodeId = `tableprocess_nested_${nestedTp.id}`;
			const nestedEntry = [...appConsts.tableProcessMap.values()].find(
				(e) => e.defaults?.get?.('collectedType')?.val === nestedTp.type
			);
			const nestedInputRefs = collectTableProcessInputRefs(nestedTp.args, nestedEntry?.nodeSpec);
			for (const { colId, port } of nestedInputRefs) {
				if (colId == null || colId < 0) continue;
				const src = columnSourceRef(colId);
				addConnection(src.nodeId, nestedNodeId, 'data-tp', src.port, port);
			}
		}
	};

	for (const tp of core.tableProcesses ?? []) emitTPConnections(tp);

	for (const plot of core.plots ?? []) {
		const plotNodeId = `plot_${plot.id}`;
		function addPlotCol(colId, port) {
			if (colId == null || colId < 0) return;
			const col = core.data.find((d) => d.id === colId);
			if (!col) return;
			let fromId, fromPort;
			if ((col.processes ?? []).length > 0) {
				fromId = `process_${col.processes[col.processes.length - 1].id}`;
				fromPort = 'output';
			} else {
				const src = columnSourceRef(colId);
				fromId = src.nodeId;
				fromPort = src.port;
			}
			addConnection(fromId, plotNodeId, 'data-plot', fromPort, port);
		}

		if (plot.type === 'tableplot') {
			(plot.plot?.columnRefs ?? []).forEach((colId) => addPlotCol(colId, 'series'));
		} else {
			const defaultInputs = appConsts?.plotMap?.get(plot.type)?.defaultInputs ?? [];
			const usesXY = defaultInputs.includes('x') || defaultInputs.includes('y');

			if (usesXY) {
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
			} else if (defaultInputs.length === 1) {
				// Single-input plots: every datum's input column wires into the same
				// dynamic `data` port (one wire per series).
				const field = defaultInputs[0];
				for (const dp of plot.plot?.data ?? []) {
					const refId = dp?.[field]?.refId;
					if (refId != null && refId >= 0) addPlotCol(refId, 'data');
				}
			} else {
				// Per-field wires for multi-input non-x/y plots.
				for (const { datumIdx, field, refId } of collectAuxPlotInputs(plot.plot?.data, defaultInputs)) {
					addPlotCol(refId, `${field}${datumIdx + 1}`);
				}
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
