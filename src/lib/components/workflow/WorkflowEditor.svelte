<script>
	// @ts-nocheck
	import {
		core,
		appState,
		appConsts,
		getProcessNodeGraph
	} from '$lib/core/core.svelte.js';
	import { mutationService } from '$lib/core/mutationService.js';
	import { selectPlot, deselectAllPlots } from '$lib/core/Plot.svelte';
	import WorkflowNode from './WorkflowNode.svelte';
	import WorkflowEdges from './WorkflowEdges.svelte';
	import EmbeddedPlot from './EmbeddedPlot.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import AddProcess from '$lib/components/iconActions/AddProcess.svelte';
	import FloatingActions from './FloatingActions.svelte';
	import NodePalette from './NodePalette.svelte';

	let { inline = false } = $props();

	const NODE_WIDTH = 160;
	const NODE_HEIGHT = 48;
	const HEADER_H = 26; // px, header strip height (matches flowtest's --header-h)
	const PORT_H = 22; // px, height of each port row
	const COL_WIDTH = 220;
	const ROW_HEIGHT = 80;
	const PADDING = 40;
	const EDITOR_PANEL_WIDTH = 220;
	const EDITOR_PANEL_MAX_HEIGHT = 320;

	// Pan / zoom constants
	const MIN_ZOOM = 0.15;
	const MAX_ZOOM = 4;
	const ZOOM_STEP = 0.1;

	// Plot preview thumbnail constants
	const PLOT_PREVIEW_DEFAULT_W = 240; // px — default preview width (wider than node header)
	const MIN_PREVIEW_W = 80; // px — minimum preview panel width when resizing
	const MIN_PREVIEW_H = 60; // px — minimum preview panel height when resizing
	const MIN_PLOT_W = 100; // px — minimum actual plot width
	const MIN_PLOT_H = 80; // px — minimum actual plot height

	// Derive the natural preview height from a plot's aspect ratio (no cropping by default)
	function getDefaultPreviewH(plotObj) {
		if (!plotObj?.width) return PLOT_PREVIEW_DEFAULT_W; // fallback: square if no width info
		return plotObj.height * (PLOT_PREVIEW_DEFAULT_W / plotObj.width);
	}

	// Per-plot preview size overrides keyed by node id
	const plotPreviewSizes = $state({});

	// --- Insert modals ---
	let showAddProcessDropdown = $state(false);
	let addProcessColumn = $state(null);
	let addProcessDropX = $state(0);
	let addProcessDropY = $state(0);

	const processGraph = $derived.by(() => getProcessNodeGraph());

	// Derive workflow nodes from the cached ProcessNode graph adapter.
	const allNodes = $derived.by(() => processGraph.nodes ?? []);

	const changedNodeIds = $derived.by(() => new Set(processGraph.changedNodeIds ?? []));

	// --- Edge derivation split into topology + positioned ---

	/**
	 * Returns true if two NODE_WIDTH×NODE_HEIGHT boxes (each described by top-left {x,y})
	 * overlap. Used for drag-to-replace drop detection in canvas coordinate space.
	 */
	function boxesOverlap(a, b) {
		return (
			a.x < b.x + NODE_WIDTH &&
			a.x + NODE_WIDTH > b.x &&
			a.y < b.y + NODE_HEIGHT &&
			a.y + NODE_HEIGHT > b.y
		);
	}

	function getPortAnchorY(node, portName, direction) {
		const ports = direction === 'out' ? (node.ports?.outputs ?? []) : (node.ports?.inputs ?? []);
		if (ports.length === 0) return HEADER_H + PORT_H / 2;
		let idx = ports.findIndex((p) => p.name === portName);
		if (idx < 0) {
			idx = ports.findIndex((p) => {
				if (!p?.name?.includes('*')) return false;
				const prefix = p.name.replace('*', '');
				return portName?.startsWith(prefix);
			});
		}
		idx = Math.max(0, idx);
		return HEADER_H + idx * PORT_H + PORT_H / 2;
	}

	/** Visual height of a node EXCLUDING any plot-preview/MiniDataTable body. */
	function getNodePortAreaHeight(node) {
		const ins = node?.ports?.inputs?.length ?? 0;
		const outs = node?.ports?.outputs?.length ?? 0;
		const rows = Math.max(1, ins, outs);
		return HEADER_H + rows * PORT_H;
	}

	// Step 1: edge connectivity only (re-derives when core changes, NOT when positions change)
	const edgeTopology = $derived.by(() => {
		return (processGraph.connections ?? []).map((e) => ({
			fromId: e.fromId,
			toId: e.toId,
			type: e.type,
			fromPort: e.fromPort,
			toPort: e.toPort
		}));
	});

	/**
	 * Topological layer assignment via longest-path in the DAG.
	 * Ensures every edge flows from a lower layer to a higher layer (left → right).
	 */
	function computeNodeLayers(nodes, edges) {
		const nodeIds = new Set(nodes.map((n) => n.id));
		const adj = new Map();
		const inDeg = new Map();

		for (const id of nodeIds) {
			adj.set(id, []);
			inDeg.set(id, 0);
		}

		for (const edge of edges) {
			if (!nodeIds.has(edge.fromId) || !nodeIds.has(edge.toId)) continue;
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

	// Compute default positions based on topological layers (all edges flow left → right)
	const defaultPositions = $derived.by(() => {
		const layers = computeNodeLayers(allNodes, edgeTopology);
		const layerOffsets = {};
		const positions = {};
		let maxLayer = 0;

		for (const node of allNodes) {
			const layer = layers.get(node.id) ?? 0;
			maxLayer = Math.max(maxLayer, layer);
			if (layerOffsets[layer] == null) layerOffsets[layer] = 0;

			positions[node.id] = {
				x: layer * COL_WIDTH + PADDING,
				y: layerOffsets[layer] + PADDING
			};

			if (node.type === 'plot') {
				const ps = plotPreviewSizes[node.id];
				const h = ps ? ps.h : getDefaultPreviewH(node.plotObj);
				layerOffsets[layer] += getNodePortAreaHeight(node) + h + 24;
			} else {
				layerOffsets[layer] += getNodePortAreaHeight(node) + 24; // 24px vertical gap
			}
		}

		return { positions, maxLayer, layerOffsets };
	});

	// Persistent positions — preserves layout when topology changes
	let stablePositions = $state({});
	let _knownNodeIds = new Set();

	$effect(() => {
		const currentNodes = allNodes;
		const currentIds = new Set(currentNodes.map((n) => n.id));
		const defaults = defaultPositions.positions;
		const prev = _knownNodeIds;

		// Assign default positions to newly appeared nodes only
		for (const node of currentNodes) {
			if (!prev.has(node.id) && defaults[node.id]) {
				stablePositions[node.id] = { ...defaults[node.id] };
			}
		}

		// Clean up positions for removed nodes
		for (const id of prev) {
			if (!currentIds.has(id)) {
				delete stablePositions[id];
			}
		}

		_knownNodeIds = currentIds;
	});

	// Canvas dimensions
	const canvasWidth = $derived((defaultPositions.maxLayer + 1) * COL_WIDTH + 2 * PADDING + 200);
	const canvasHeight = $derived.by(() => {
		const heights = Object.values(defaultPositions.layerOffsets);
		return Math.max(...heights, 5 * ROW_HEIGHT) + 2 * PADDING;
	});

	// Step 2: attach positions (re-derives when topology OR any position changes)
	const allEdges = $derived.by(() => {
		const nodeById = new Map(allNodes.map((n) => [n.id, n]));
		return edgeTopology.flatMap((edge) => {
			const fromPos = stablePositions[edge.fromId] ?? defaultPositions.positions[edge.fromId];
			const toPos = stablePositions[edge.toId] ?? defaultPositions.positions[edge.toId];
			const fromNode = nodeById.get(edge.fromId);
			const toNode = nodeById.get(edge.toId);
			if (!fromPos || !toPos) return [];
			return [
				{
					...edge,
					from: {
						x: fromPos.x + NODE_WIDTH,
						y: fromPos.y + getPortAnchorY(fromNode, edge.fromPort, 'out')
					},
					to: {
						x: toPos.x,
						y: toPos.y + getPortAnchorY(toNode, edge.toPort, 'in')
					}
				}
			];
		});
	});

	// --- Selected plot highlight ---
	const selectedPlotNodeId = $derived.by(() => {
		const p = core.plots.find((p) => p.selected);
		return p ? `plot_${p.id}` : null;
	});

	// --- Pan / zoom ---
	// Restore the user's last viewport position so reopening the canvas keeps the
	// same in-flight layout instead of snapping back to the origin every time.
	const VIEWPORT_STORAGE_KEY = 'ancir.canvas.viewport';

	function loadViewport() {
		try {
			const raw = typeof localStorage !== 'undefined' && localStorage.getItem(VIEWPORT_STORAGE_KEY);
			if (!raw) return { x: 0, y: 0, z: 1 };
			const parsed = JSON.parse(raw);
			const x = Number(parsed?.x);
			const y = Number(parsed?.y);
			const z = Number(parsed?.z);
			return {
				x: Number.isFinite(x) ? x : 0,
				y: Number.isFinite(y) ? y : 0,
				z: Number.isFinite(z) && z > 0 ? z : 1
			};
		} catch {
			return { x: 0, y: 0, z: 1 };
		}
	}

	const initialViewport = loadViewport();
	let panX = $state(initialViewport.x);
	let panY = $state(initialViewport.y);
	let zoom = $state(initialViewport.z);

	// Persist viewport whenever the user pans or zooms. Cheap: a small object every
	// state change. No throttling needed — these only fire during user gestures.
	$effect(() => {
		const payload = JSON.stringify({ x: panX, y: panY, z: zoom });
		try {
			if (typeof localStorage !== 'undefined') localStorage.setItem(VIEWPORT_STORAGE_KEY, payload);
		} catch {
			/* ignore quota / private-mode errors */
		}
	});
	let isPanning = $state(false);
	/** Bound to the .canvas-viewport element for precise coordinate conversion. */
	let canvasViewportEl = $state(null);
	let panStartX = $state(0);
	let panStartY = $state(0);

	// --- Node drag state ---
	// { nodeId, startMouseCanvas: {x,y}, startPos: {x,y}, moved: boolean }
	let dragInfo = $state(null);

	// --- Column drag-to-replace drop target ---
	let dropTargetNodeId = $state(null);

	// --- Plot resize state ---
	// { nodeId, plotObj, startMouse:{x,y}, startW, startH, startPlotW, startPlotH }
	let resizeInfo = $state(null);
	let pendingConnection = $state(null); // { fromNodeId, fromPort }
	let mouseCanvas = $state({ x: 0, y: 0 });

	// --- Expanded process editor ---
	let expandedNodeId = $state(null);

	// --- Focus / connected-node highlight ---
	let focusedNodeId = $state(null);

	// BFS both directions in the edge graph to find the full connected subgraph
	const connectedNodeIds = $derived.by(() => {
		if (!focusedNodeId) return null;
		const connected = new Set([focusedNodeId]);
		const queue = [focusedNodeId];
		let head = 0; // O(1) dequeue with index pointer
		while (head < queue.length) {
			const current = queue[head++];
			for (const edge of edgeTopology) {
				if (edge.fromId === current && !connected.has(edge.toId)) {
					connected.add(edge.toId);
					queue.push(edge.toId);
				}
				if (edge.toId === current && !connected.has(edge.fromId)) {
					connected.add(edge.fromId);
					queue.push(edge.fromId);
				}
			}
		}
		return connected;
	});

	// Auto-clear expandedNodeId if the node is removed from core
	$effect(() => {
		if (expandedNodeId && !allNodes.find((n) => n.id === expandedNodeId)) {
			expandedNodeId = null;
		}
	});

	// Left offset to avoid the nav + display panels
	const leftPx = $derived.by(() => {
		return appState.showDisplayPanel
			? appState.widthDisplayPanel + appState.widthNavBar
			: appState.widthNavBar;
	});

	// Right offset to avoid the ControlPanel when present (only relevant for inline mode).
	const rightPx = $derived.by(() => (appState.showControlPanel ? appState.widthControlPanel : 0));

	// --- Event handlers ---

	/** Convert a mouse event's client coords to canvas-inner coordinates. */
	function toCanvasCoords(clientX, clientY) {
		const rect = canvasViewportEl?.getBoundingClientRect() ?? { left: 0, top: 0 };
		return {
			x: (clientX - rect.left - panX) / zoom,
			y: (clientY - rect.top - panY) / zoom
		};
	}

	function handleWheel(e) {
		e.preventDefault();
		if (e.ctrlKey || e.metaKey) {
			// Pinch-to-zoom: ctrl/meta + wheel zooms
			const factor = e.deltaY > 0 ? 0.9 : 1.1;
			const newZoom = Math.min(Math.max(zoom * factor, MIN_ZOOM), MAX_ZOOM);
			// Keep the canvas point under the cursor fixed while zooming
			const rect = canvasViewportEl?.getBoundingClientRect() ?? { left: 0, top: 0 };
			const relX = e.clientX - rect.left;
			const relY = e.clientY - rect.top;
			const canvasX = (relX - panX) / zoom;
			const canvasY = (relY - panY) / zoom;
			panX = relX - canvasX * newZoom;
			panY = relY - canvasY * newZoom;
			zoom = newZoom;
		} else {
			// Regular scroll: pan the canvas
			panX -= e.deltaX;
			panY -= e.deltaY;
		}
	}

	function handleCanvasMouseDown(e) {
		if (e.button !== 0) return;
		isPanning = true;
		panStartX = e.clientX - panX;
		panStartY = e.clientY - panY;
	}

	function handleNodeWrapperMouseDown(e, node) {
		// Always prevent the canvas pan handler from firing
		e.stopPropagation();
		if (e.button !== 0) return;
		// Skip if the click is inside panels or action buttons that handle their own events
		if (e.target.closest('.process-editor-panel')) return;
		if (e.target.closest('.plot-resize-handle')) return;
		if (e.target.closest('.node-add-btn')) return;

		const { x: canvasX, y: canvasY } = toCanvasCoords(e.clientX, e.clientY);
		const pos = stablePositions[node.id] ?? defaultPositions.positions[node.id];
		if (!pos) return;

		dragInfo = {
			nodeId: node.id,
			startMouseCanvas: { x: canvasX, y: canvasY },
			startPos: { x: pos.x, y: pos.y },
			moved: false
		};
	}

	function handleResizeMouseDown(e, node) {
		e.stopPropagation();
		const id = node.id;
		const cur = plotPreviewSizes[id] ?? {
			w: PLOT_PREVIEW_DEFAULT_W,
			h: getDefaultPreviewH(node.plotObj)
		};
		resizeInfo = {
			nodeId: id,
			plotObj: node.plotObj,
			startMouse: { x: e.clientX, y: e.clientY },
			startW: cur.w,
			startH: cur.h,
			startPlotW: node.plotObj.width,
			startPlotH: node.plotObj.height
		};
	}

	function openAddProcess(e, col) {
		e.stopPropagation();
		addProcessColumn = col;
		const rect = e.currentTarget.getBoundingClientRect();
		addProcessDropX = rect.right + 4;
		addProcessDropY = rect.top;
		showAddProcessDropdown = true;
	}

	function handleMouseMove(e) {
		mouseCanvas = toCanvasCoords(e.clientX, e.clientY);

		if (resizeInfo) {
			const dx = (e.clientX - resizeInfo.startMouse.x) / zoom;
			const dy = (e.clientY - resizeInfo.startMouse.y) / zoom;
			const nw = Math.max(MIN_PREVIEW_W, resizeInfo.startW + dx);
			const nh = Math.max(MIN_PREVIEW_H, resizeInfo.startH + dy);
			plotPreviewSizes[resizeInfo.nodeId] = { w: nw, h: nh };
			// Scale the actual plot proportionally so detail level is consistent
			resizeInfo.plotObj.width = Math.max(
				MIN_PLOT_W,
				Math.round(resizeInfo.startPlotW * (nw / resizeInfo.startW))
			);
			resizeInfo.plotObj.height = Math.max(
				MIN_PLOT_H,
				Math.round(resizeInfo.startPlotH * (nh / resizeInfo.startH))
			);
			return;
		}
		if (dragInfo) {
			const { x: canvasX, y: canvasY } = toCanvasCoords(e.clientX, e.clientY);
			const dx = canvasX - dragInfo.startMouseCanvas.x;
			const dy = canvasY - dragInfo.startMouseCanvas.y;

			if (!dragInfo.moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
				dragInfo.moved = true;
			}
			if (dragInfo.moved) {
				// Update dragged node position in canvas space
				const nx = dragInfo.startPos.x + dx;
				const ny = dragInfo.startPos.y + dy;
				if (stablePositions[dragInfo.nodeId]) {
					stablePositions[dragInfo.nodeId].x = nx;
					stablePositions[dragInfo.nodeId].y = ny;
				} else {
					stablePositions[dragInfo.nodeId] = { x: nx, y: ny };
				}

				// Drop-target detection: compare dragged node's bbox against each data node's bbox.
				// Both positions are in canvas space, so no viewport-offset error.
				const draggedNode = allNodes.find((n) => n.id === dragInfo.nodeId);
				if (draggedNode?.type === 'data') {
					const draggedBox = { x: nx, y: ny };
					let found = null;
					for (const node of allNodes) {
						if (node.type !== 'data' || node.id === dragInfo.nodeId) continue;
						const pos = stablePositions[node.id] ?? defaultPositions.positions[node.id];
						if (!pos) continue;
						if (boxesOverlap(draggedBox, pos)) {
							found = node.id;
							break;
						}
					}
					dropTargetNodeId = found;
				} else {
					dropTargetNodeId = null;
				}
			}
			return;
		}
		if (!isPanning) return;
		panX = e.clientX - panStartX;
		panY = e.clientY - panStartY;
	}

	function findPortDef(node, direction, portName) {
		const ports = direction === 'in' ? (node.ports?.inputs ?? []) : (node.ports?.outputs ?? []);
		let port = ports.find((p) => p.name === portName);
		if (port) return port;
		port = ports.find((p) => {
			if (!p?.name?.includes('*')) return false;
			const prefix = p.name.replace('*', '');
			return portName?.startsWith(prefix);
		});
		return port;
	}

	function isManyInputPort(node, portName) {
		const port = findPortDef(node, 'in', portName);
		return !!port?.dynamic;
	}

	function resolveOutputColumnId(nodeId, portName) {
		const node = allNodes.find((n) => n.id === nodeId);
		if (!node) return -1;
		if (node.type === 'data') return node.refId ?? -1;
		if (node.type === 'process') {
			const parent = core.data.find((c) => (c.processes ?? []).some((p) => p.id === node.refId));
			return parent?.id ?? -1;
		}
		if (node.type === 'tableprocess' && node.tpObj) {
			const out = node.tpObj.args?.out ?? {};
			if (typeof out[portName] === 'number') return out[portName];
			if (portName?.includes('*')) {
				const prefix = portName.replace('*', '');
				for (const [k, v] of Object.entries(out)) {
					if (k.startsWith(prefix) && typeof v === 'number' && v >= 0) return v;
				}
			}
			for (const v of Object.values(out)) {
				if (typeof v === 'number' && v >= 0) return v;
			}
		}
		return -1;
	}

	function applyConnection(fromNodeId, fromPort, toNodeId, toPort) {
		const colId = resolveOutputColumnId(fromNodeId, fromPort);
		if (colId < 0) return;
		const target = allNodes.find((n) => n.id === toNodeId);
		if (!target) return;

		if (target.type === 'tableprocess' && target.tpObj) {
			const tp = target.tpObj;
			if (!toPort?.endsWith('IN')) return;
			if (isManyInputPort(target, toPort)) {
				const next = Array.isArray(tp.args[toPort]) ? tp.args[toPort] : [];
				if (!next.includes(colId)) tp.args[toPort] = [...next, colId];
			} else {
				tp.args[toPort] = colId;
			}
			return;
		}

		if (target.type === 'plot' && target.plotObj?.type === 'tableplot' && toPort === 'series') {
			const refs = target.plotObj.plot.columnRefs ?? [];
			if (!refs.includes(colId)) target.plotObj.plot.columnRefs = [...refs, colId];
			return;
		}

		// Non-tableplot plots use the flowtest-style {x, ys[, zs]} ports.
		// `x` is treated as one shared column across all data points; dropping on
		// `ys` (or `zs`) appends a new series that inherits the current shared x.
		if (target.type === 'plot' && target.plotObj && target.plotObj.type !== 'tableplot') {
			const plot = target.plotObj.plot;
			if (!plot) return;
			plot.data = plot.data ?? [];

			if (toPort === 'x') {
				if (plot.data.length === 0) {
					const dataIn = { x: { refId: colId }, y: { refId: -1 } };
					if (typeof plot.addData === 'function') plot.addData(dataIn);
					else plot.data = [dataIn];
				} else {
					for (const dp of plot.data) {
						dp.x = { ...(dp.x ?? {}), refId: colId };
					}
				}
			} else if (toPort === 'ys') {
				const sharedX = plot.data[0]?.x?.refId ?? -1;
				const dataIn = { x: { refId: sharedX }, y: { refId: colId } };
				if (typeof plot.addData === 'function') plot.addData(dataIn);
				else plot.data = [...plot.data, dataIn];
			} else if (toPort === 'zs') {
				const sharedX = plot.data[0]?.x?.refId ?? -1;
				const dataIn = { x: { refId: sharedX }, y: { refId: -1 }, z: { refId: colId } };
				if (typeof plot.addData === 'function') plot.addData(dataIn);
				else plot.data = [...plot.data, dataIn];
			}
		}
	}

	function disconnectInputPort(nodeId, portName) {
		const target = allNodes.find((n) => n.id === nodeId);
		if (!target) return;

		if (target.type === 'tableprocess' && target.tpObj) {
			const tp = target.tpObj;
			if (!portName?.endsWith('IN')) return;
			tp.args[portName] = isManyInputPort(target, portName) ? [] : -1;
			return;
		}

		if (target.type === 'plot' && target.plotObj?.type === 'tableplot' && portName === 'series') {
			target.plotObj.plot.columnRefs = [];
			return;
		}

		if (target.type === 'plot' && target.plotObj && target.plotObj.type !== 'tableplot') {
			const plot = target.plotObj.plot;
			if (!plot?.data) return;
			if (portName === 'x') {
				for (const dp of plot.data) {
					if (dp?.x) dp.x = { ...dp.x, refId: -1 };
				}
			} else if (portName === 'ys') {
				// Drop every series that has a wired y. Matches the tableplot
				// "clear all wires on this port" semantic.
				plot.data = plot.data.filter((dp) => !(dp?.y?.refId >= 0));
			} else if (portName === 'zs') {
				for (const dp of plot.data) {
					if (dp?.z) dp.z = { ...dp.z, refId: -1 };
				}
			}
		}
	}

	function handlePortStart(e) {
		e.stopPropagation();
		pendingConnection = { fromNodeId: e.detail.nodeId, fromPort: e.detail.port };
	}

	function handlePortEnd(e) {
		e.stopPropagation();
		if (!pendingConnection) return;
		applyConnection(
			pendingConnection.fromNodeId,
			pendingConnection.fromPort,
			e.detail.nodeId,
			e.detail.port
		);
		pendingConnection = null;
	}

	function handlePortDisconnect(e) {
		e.stopPropagation();
		disconnectInputPort(e.detail.nodeId, e.detail.port);
		if (pendingConnection) pendingConnection = null;
	}

	function handleNodeWrapperMouseUp(e, node) {
		if (dragInfo && !dragInfo.moved) {
			// Short press with no movement → treat as a click
			handleNodeAction(node);
		}
		// Don't clear dragInfo here — stopAll (which always fires) handles the drop and cleanup
	}

	function stopAll() {
		// Perform column-replace drop if applicable.
		// dropTargetNodeId is only non-null when cursor is over a *different* data node,
		// so no guard against accidental same-node drops is needed.
		if (dragInfo?.moved && dropTargetNodeId) {
			const sourceNode = allNodes.find((n) => n.id === dragInfo.nodeId);
			const targetNode = allNodes.find((n) => n.id === dropTargetNodeId);
			if (sourceNode?.type === 'data' && targetNode?.type === 'data') {
				mutationService.replaceColumnRefs(sourceNode.refId, targetNode.refId);
				// Snap the dragged node back to its default layout position
				const dp = defaultPositions.positions[dragInfo.nodeId];
				if (dp) stablePositions[dragInfo.nodeId] = { ...dp };
			}
		}
		dropTargetNodeId = null;
		dragInfo = null;
		resizeInfo = null;
		isPanning = false;
	}

	function handleNodeAction(node) {
		// Toggle focus: click same node again to deselect
		focusedNodeId = focusedNodeId === node.id ? null : node.id;

		if (node.type === 'plot') {
			// Synthesise a minimal event-like object for selectPlot (needs altKey)
			selectPlot({ altKey: false }, node.refId);
		} else if (node.type === 'data') {
			appState.currentTab = 'data';
			appState.showDisplayPanel = true;
		} else if (node.type === 'process' || node.type === 'tableprocess') {
			expandedNodeId = expandedNodeId === node.id ? null : node.id;
		}
	}

	function handleBackgroundClick() {
		deselectAllPlots();
		expandedNodeId = null;
		focusedNodeId = null;
		pendingConnection = null;
	}

	function handleKeyDown(e) {
		if (e.key === 'Escape') {
			deselectAllPlots();
			expandedNodeId = null;
			focusedNodeId = null;
			pendingConnection = null;
		}
	}

	const provisionalEdge = $derived.by(() => {
		if (!pendingConnection) return null;
		const fromNode = allNodes.find((n) => n.id === pendingConnection.fromNodeId);
		const fromPos =
			stablePositions[pendingConnection.fromNodeId] ??
			defaultPositions.positions[pendingConnection.fromNodeId];
		if (!fromNode || !fromPos) return null;
		return {
			from: {
				x: fromPos.x + NODE_WIDTH,
				y: fromPos.y + getPortAnchorY(fromNode, pendingConnection.fromPort, 'out')
			},
			to: { x: mouseCanvas.x, y: mouseCanvas.y }
		};
	});
</script>

<div
	class="workflow-editor"
	class:inline
	style="left: {leftPx}px; right: {rightPx}px;"
	onwheel={handleWheel}
	onmousedown={handleCanvasMouseDown}
	onmousemove={handleMouseMove}
	onmouseup={stopAll}
	onmouseleave={stopAll}
	onclick={handleBackgroundClick}
	onkeydown={handleKeyDown}
	role="presentation"
	tabindex="-1"
>
	{#if !inline}
		<!-- Legacy fullscreen-modal mode keeps the close-X only. The "+ Plot" / "+ TP"
		     header buttons moved into NodePalette so canvas mode is chrome-free. -->
		<button class="close-btn legacy-only" onclick={() => (appState.showWorkflow = false)}>✕</button>
	{/if}

	<div class="canvas-viewport" bind:this={canvasViewportEl} class:panning={isPanning && !dragInfo}>
		<FloatingActions />
		<NodePalette />
		<div
			class="canvas-inner"
			style="transform: translate({panX}px, {panY}px) scale({zoom}); transform-origin: 0 0; width: {canvasWidth}px; height: {canvasHeight}px; position: relative;"
		>
			<WorkflowEdges
				edges={allEdges}
				width={canvasWidth}
				height={canvasHeight}
				highlightedIds={connectedNodeIds}
				{provisionalEdge}
			/>

			{#each allNodes as node (node.id)}
				{@const pos = stablePositions[node.id] ?? defaultPositions.positions[node.id]}
				{@const isExpanded = expandedNodeId === node.id}
				{@const isDragging = dragInfo?.nodeId === node.id && dragInfo?.moved}
				{@const isDimmed = connectedNodeIds !== null && !connectedNodeIds.has(node.id)}
				{@const isRecentlyChanged = changedNodeIds.has(node.id)}
				{@const isDropTarget = dropTargetNodeId === node.id}
				{@const nodeZIndex = isDragging ? 30 : isExpanded ? 20 : 1}
				{#if pos}
					<div
						class="workflow-node-wrapper"
						class:dragging={isDragging}
						class:dimmed={isDimmed}
						class:changed={isRecentlyChanged}
						style="position: absolute; left: {pos.x}px; top: {pos.y}px; z-index: {nodeZIndex};"
						title={node.type === 'data'
							? 'Drag onto another data node to replace all its downstream references'
							: undefined}
						aria-label={node.type === 'data'
							? `${node.label} data node — drag onto another data node to replace all downstream references`
							: node.label}
						onmousedown={(e) => handleNodeWrapperMouseDown(e, node)}
						onmouseup={(e) => handleNodeWrapperMouseUp(e, node)}
						onclick={(e) => e.stopPropagation()}
						role="presentation"
					>
						<WorkflowNode
							{node}
							selected={selectedPlotNodeId === node.id}
							expanded={isExpanded}
							{isDropTarget}
							on:portstart={handlePortStart}
							on:portend={handlePortEnd}
							on:portdisconnect={handlePortDisconnect}
						/>

						{#if node.type === 'data'}
							{@const col = core.data.find((d) => d.id === node.refId)}
							{#if col}
								<button
									class="node-add-btn"
									onmousedown={(e) => e.stopPropagation()}
									onclick={(e) => openAddProcess(e, col)}
									title="Add process to {col.name}">+ Process</button
								>
							{/if}
						{/if}

						{#if isExpanded && node.type === 'process' && node.processObj}
							{@const PComp = appConsts.processMap.get(node.processName)?.component}
							{#if PComp}
								<div
									class="process-editor-panel"
									style="width:{EDITOR_PANEL_WIDTH}px; max-height:{EDITOR_PANEL_MAX_HEIGHT}px;"
								>
									<PComp p={node.processObj} />
								</div>
							{/if}
						{:else if isExpanded && node.type === 'tableprocess' && node.tpObj}
							{@const TPComp = appConsts.tableProcessMap.get(node.tpName)?.component}
							{#if TPComp}
								<div
									class="process-editor-panel"
									style="width:{EDITOR_PANEL_WIDTH}px; max-height:{EDITOR_PANEL_MAX_HEIGHT}px;"
								>
									<TPComp p={node.tpObj} />
								</div>
							{/if}
						{/if}

						{#if node.type === 'plot' && node.plotObj}
							{@const pSize = plotPreviewSizes[node.id] ?? {
								w: PLOT_PREVIEW_DEFAULT_W,
								h: getDefaultPreviewH(node.plotObj)
							}}
							<EmbeddedPlot
								plot={node.plotObj}
								size={pSize}
								onResizeMouseDown={(e) => handleResizeMouseDown(e, node)}
							/>
						{/if}
					</div>
				{/if}
			{/each}
		</div>
	</div>

	<div class="zoom-controls">
		<button
			class="icon zoomout"
			style="z-index: 999; position: fixed; right: calc({appState.showControlPanel
				? appState.widthControlPanel
				: 0}px + 5px); bottom: 35px;"
			onclick={(e) => {
				e.stopPropagation();
				zoom = Math.max(zoom - ZOOM_STEP, MIN_ZOOM);
			}}
			title="Zoom out"
		>
			<Icon name="zoom-out" width={24} height={24} />
		</button>
		<button
			class="icon zoomin"
			style="z-index: 999; position: fixed; right: calc({appState.showControlPanel
				? appState.widthControlPanel
				: 0}px + 5px); bottom: 10px;"
			onclick={(e) => {
				e.stopPropagation();
				zoom = Math.min(zoom + ZOOM_STEP, MAX_ZOOM);
			}}
			title="Zoom in"
		>
			<Icon name="zoom-in" width={24} height={24} />
		</button>
	</div>
</div>

<!-- Insert modals / dropdowns rendered outside the transformed canvas -->
<AddProcess
	bind:showDropdown={showAddProcessDropdown}
	columnSelected={addProcessColumn}
	dropdownTop={addProcessDropY}
	dropdownLeft={addProcessDropX}
/>

<style>
	.workflow-editor {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		background: white;
		z-index: 800;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border-left: 1px solid var(--color-lightness-85);
	}

	.workflow-editor.inline {
		/* Inline mode keeps the same fixed-pane positioning model as PlotDisplay,
		   but drops the modal overlay z-index and the close-X chrome. */
		z-index: 1;
		border-left: none;
	}

	/* Legacy fullscreen-modal mode only: the close-X overlay button. */
	.close-btn.legacy-only {
		position: absolute;
		top: 8px;
		right: 12px;
		z-index: 40;
	}

	.close-btn {
		background: transparent;
		border: none;
		cursor: pointer;
		color: var(--color-lightness-35);
		font-size: 16px;
		padding: 0 4px;
		flex-shrink: 0;
	}

	.close-btn:hover {
		color: #333;
	}

	.canvas-viewport {
		flex: 1;
		overflow: hidden;
		cursor: grab;
		/* flowtest-style line grid: subtle 20px x 20px squares. */
		background-color: #f7f8fa;
		background-image:
			repeating-linear-gradient(
				to right,
				rgba(0, 0, 0, 0.05) 0,
				rgba(0, 0, 0, 0.05) 1px,
				transparent 1px,
				transparent 20px
			),
			repeating-linear-gradient(
				to bottom,
				rgba(0, 0, 0, 0.05) 0,
				rgba(0, 0, 0, 0.05) 1px,
				transparent 1px,
				transparent 20px
			);
	}

	.canvas-viewport.panning {
		cursor: grabbing;
	}

	.workflow-node-wrapper {
		cursor: grab;
		transition: opacity 0.15s;
	}

	.workflow-node-wrapper.dragging {
		cursor: grabbing;
		opacity: 0.85;
	}

	.workflow-node-wrapper.dimmed {
		opacity: 0.2;
		pointer-events: none;
	}

	.workflow-node-wrapper.changed {
		animation: wfPulse 500ms ease-out;
	}

	@keyframes wfPulse {
		0% {
			filter: drop-shadow(0 0 0 rgba(2, 117, 255, 0));
		}
		50% {
			filter: drop-shadow(0 0 6px rgba(2, 117, 255, 0.45));
		}
		100% {
			filter: drop-shadow(0 0 0 rgba(2, 117, 255, 0));
		}
	}

	.process-editor-panel {
		overflow-y: auto;
		background: white;
		border: 1.5px solid rgba(0, 0, 0, 0.15);
		border-top: none;
		border-bottom-left-radius: 6px;
		border-bottom-right-radius: 6px;
		padding: 6px 8px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
		cursor: default;
		box-sizing: border-box;
	}

	.plot-preview-panel {
		overflow: hidden;
		border: 1.5px solid rgba(0, 0, 0, 0.15);
		border-top: none;
		border-bottom-left-radius: 6px;
		border-bottom-right-radius: 6px;
		background: white;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
		box-sizing: border-box;
		position: relative;
	}

	.plot-preview-inner {
		pointer-events: none;
	}

	.plot-resize-handle {
		position: absolute;
		bottom: 2px;
		right: 2px;
		width: 16px;
		height: 16px;
		font-size: 11px;
		line-height: 16px;
		text-align: center;
		cursor: nwse-resize;
		color: #888;
		background: rgba(255, 255, 255, 0.8);
		border-radius: 2px;
		user-select: none;
	}

	.plot-resize-handle:hover {
		color: #333;
		background: rgba(255, 255, 255, 1);
	}

	.zoom-controls {
		position: absolute;
		bottom: 10px;
		right: 10px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		z-index: 10;
	}

	/* "+ Process" button on data nodes */
	.node-add-btn {
		display: none;
		font-size: 10px;
		padding: 2px 6px;
		background: rgba(0, 0, 0, 0.07);
		border: 1px solid rgba(0, 0, 0, 0.15);
		border-radius: 3px;
		cursor: pointer;
		color: #444;
		width: 100%;
		box-sizing: border-box;
		text-align: left;
		margin-top: 2px;
	}

	.workflow-node-wrapper:hover .node-add-btn {
		display: block;
	}

	.node-add-btn:hover {
		background: rgba(0, 0, 0, 0.13);
	}

	.icon {
		transition: right 0.6s ease;
	}
</style>
