<script>
	// @ts-nocheck
	import {
		core,
		appState,
		appConsts,
		getProcessNodeGraph
	} from '$lib/core/core.svelte.js';
	import { mutationService } from '$lib/core/mutationService.js';
	import { deleteTableProcess } from '$lib/core/TableProcess.svelte';
	import { selectPlot, deselectAllPlots } from '$lib/core/Plot.svelte';
	import WorkflowNode from './WorkflowNode.svelte';
	import GroupNode from './GroupNode.svelte';
	import WorkflowEdges from './WorkflowEdges.svelte';
	import EmbeddedPlot from './EmbeddedPlot.svelte';
	import Icon from '$lib/icons/Icon.svelte';
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

	// Persistent positions — preserves layout when topology changes AND survives
	// view switches / page reloads via localStorage. Keyed by node id (strings like
	// `data_<colId>`, `process_<procId>`, `plot_<plotId>`, etc.) which stay stable
	// across reloads because the underlying col/process/plot ids are persisted in
	// core too.
	const NODE_POSITIONS_STORAGE_KEY = 'ancir.workflow.nodePositions';

	function loadNodePositions() {
		try {
			const raw = typeof localStorage !== 'undefined' && localStorage.getItem(NODE_POSITIONS_STORAGE_KEY);
			if (!raw) return {};
			const parsed = JSON.parse(raw);
			if (!parsed || typeof parsed !== 'object') return {};
			// Strip non-{x,y} entries defensively.
			const out = {};
			for (const [id, pos] of Object.entries(parsed)) {
				const x = Number(pos?.x);
				const y = Number(pos?.y);
				if (Number.isFinite(x) && Number.isFinite(y)) out[id] = { x, y };
			}
			return out;
		} catch {
			return {};
		}
	}

	let stablePositions = $state(loadNodePositions());
	let _knownNodeIds = new Set(Object.keys(stablePositions));

	$effect(() => {
		const currentNodes = allNodes;
		const currentIds = new Set(currentNodes.map((n) => n.id));
		const defaults = defaultPositions.positions;
		const prev = _knownNodeIds;

		// Assign default positions to newly appeared nodes only. Groups carry
		// their own x/y in core.groups (the user picked them via createGroup),
		// so prefer those over the topo-layered default.
		for (const node of currentNodes) {
			if (prev.has(node.id)) continue;
			if (node.type === 'group' && node.groupObj) {
				stablePositions[node.id] = { x: node.groupObj.x, y: node.groupObj.y };
			} else if (defaults[node.id]) {
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

	// Mirror stablePositions[group.id] → group.x/y so that resize / drag of a
	// group survives serialisation via outputCoreAsJson (which only walks
	// core.groups, not stablePositions). This keeps the canvas-runtime
	// position and the persisted position in sync.
	$effect(() => {
		for (const g of core.groups) {
			const p = stablePositions[g.id];
			if (!p) continue;
			if (g.x !== p.x) g.x = p.x;
			if (g.y !== p.y) g.y = p.y;
		}
	});

	// Mirror stablePositions to localStorage. Reads every entry to register the
	// $derived dep, so dragging a node (which mutates one entry) triggers a save.
	$effect(() => {
		const snapshot = {};
		for (const [id, pos] of Object.entries(stablePositions)) {
			snapshot[id] = { x: pos.x, y: pos.y };
		}
		try {
			if (typeof localStorage !== 'undefined') {
				localStorage.setItem(NODE_POSITIONS_STORAGE_KEY, JSON.stringify(snapshot));
			}
		} catch {
			/* private mode / quota — ignore */
		}
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

	/** Reset pan + zoom so the user can always recover when the persisted viewport
	 *  has stranded the visible area away from any nodes. */
	function resetCanvasView() {
		panX = 0;
		panY = 0;
		zoom = 1;
	}

	// One-shot guard: after the canvas mounts and the first non-empty node set is
	// laid out, sanity-check that AT LEAST ONE node falls inside the viewport. If
	// not (e.g. the persisted pan/zoom from a previous session leaves the user on
	// blank canvas), snap the viewport back to the origin. Without this, the user
	// has no UI affordance to recover.
	let _viewportSanityChecked = false;
	$effect(() => {
		if (_viewportSanityChecked) return;
		if (!canvasViewportEl) return;
		const nodes = allNodes;
		if (!nodes || nodes.length === 0) return;
		const rect = canvasViewportEl.getBoundingClientRect();
		if (!(rect.width > 0 && rect.height > 0)) return;
		const positions = stablePositions;
		const defaults = defaultPositions.positions;
		const margin = NODE_WIDTH; // half-node grace either side
		const anyVisible = nodes.some((n) => {
			const p = positions[n.id] ?? defaults[n.id];
			if (!p) return false;
			const sx = panX + p.x * zoom;
			const sy = panY + p.y * zoom;
			return (
				sx > -margin &&
				sx < rect.width + margin &&
				sy > -margin &&
				sy < rect.height + margin
			);
		});
		if (!anyVisible) resetCanvasView();
		_viewportSanityChecked = true;
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
	// Edge-key of the wire the user is currently dragging a node toward.
	// When non-null on drop AND the dragged node has exactly one input and one
	// output, stopAll() splices the node onto that edge (flowtest-style).
	let dropTargetEdgeKey = $state(null);

	// --- Plot resize state ---
	// { nodeId, plotObj, startMouse:{x,y}, startW, startH, startPlotW, startPlotH }
	let resizeInfo = $state(null);
	let pendingConnection = $state(null); // { fromNodeId, fromPort }
	let mouseCanvas = $state({ x: 0, y: 0 });

	// --- Expanded process editor ---
	let expandedNodeId = $state(null);

	// --- Focus / connected-node highlight ---
	let focusedNodeId = $state(null);

	// Path-focus dim mode (flowtest-style). When true AND a node is selected,
	// non-connected nodes dim out. Toggled via the FloatingActions button.
	// Persisted to localStorage so the user's preference sticks across reloads.
	const PATH_FOCUS_KEY = 'ancir.canvas.pathFocus';
	let pathFocusEnabled = $state(
		(() => {
			try {
				return localStorage?.getItem(PATH_FOCUS_KEY) === 'true';
			} catch {
				return false;
			}
		})()
	);
	$effect(() => {
		try {
			localStorage?.setItem(PATH_FOCUS_KEY, String(pathFocusEnabled));
		} catch {
			/* private mode / quota — ignore */
		}
	});

	// --- Click-selection (drives Delete/Backspace) ---
	// Either a node id OR an edge key (see edgeKeyFor below). At most one is set.
	let selectedEdgeKey = $state(null);

	function edgeKeyFor(edge) {
		return `${edge.fromId}|${edge.fromPort}|${edge.toId}|${edge.toPort}|${edge.type}`;
	}

	function selectEdge(edge) {
		selectedEdgeKey = edgeKeyFor(edge);
		focusedNodeId = null;
		expandedNodeId = null;
	}

	// BFS both directions in the edge graph to find the full connected subgraph.
	// Only computed when the user has enabled path-focus mode (flowtest behaviour).
	const connectedNodeIds = $derived.by(() => {
		if (!pathFocusEnabled) return null;
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
		// Don't hijack wheel events that originate inside floating overlays —
		// modal bodies, the palette popover, expanded process-editor panels,
		// node note popovers, plot resize handles, embedded plots' own scrollers.
		// Without this, scrolling inside any of those moves the canvas instead.
		if (e.target?.closest?.(
			'dialog, .backdrop, .np-menu, .palette-menu, .modal, .modal-content, ' +
			'.modal-overlay, .dropdown, .dropdown-menu, .submenu, .process-editor-panel, ' +
			'.node-note-popover, .plot-preview-panel, .plot-preview-inner, textarea'
		)) {
			return;
		}
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
		// Group header/body has its own resize-handle and delete-X which stop
		// propagation themselves. We only need to swallow events landing on the
		// resize handle so a drag from there doesn't start a node-move.
		if (e.target.closest('.group-resize-handle')) return;

		const { x: canvasX, y: canvasY } = toCanvasCoords(e.clientX, e.clientY);
		const pos = stablePositions[node.id] ?? defaultPositions.positions[node.id];
		if (!pos) return;

		// When dragging a group, snapshot every child's starting position so
		// the mousemove handler can apply the same delta to each child.
		let groupChildren = [];
		if (node.type === 'group') {
			const g = core.groups.find((gg) => gg.id === node.id);
			if (g) {
				for (const childId of g.childIds ?? []) {
					const cp = stablePositions[childId] ?? defaultPositions.positions[childId];
					if (cp) groupChildren.push({ id: childId, startPos: { x: cp.x, y: cp.y } });
				}
			}
		}

		dragInfo = {
			nodeId: node.id,
			startMouseCanvas: { x: canvasX, y: canvasY },
			startPos: { x: pos.x, y: pos.y },
			moved: false,
			groupChildren
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

				// If this is a group, drag every child by the same delta so the
				// container visually carries its members. Uses the per-child
				// startPos snapshot captured at mousedown to avoid drift.
				if (dragInfo.groupChildren?.length) {
					for (const child of dragInfo.groupChildren) {
						const nxC = child.startPos.x + dx;
						const nyC = child.startPos.y + dy;
						if (stablePositions[child.id]) {
							stablePositions[child.id].x = nxC;
							stablePositions[child.id].y = nyC;
						} else {
							stablePositions[child.id] = { x: nxC, y: nyC };
						}
					}
				}

				// Splice-on-edge detection: only relevant if the dragged node has
				// exactly one input and one output (any other shape doesn't fit
				// cleanly into a 1:1 wire). Uses elementFromPoint to find an
				// .edge-hit path under the cursor.
				const draggedNode = allNodes.find((n) => n.id === dragInfo.nodeId);
				if (
					draggedNode &&
					(draggedNode.ports?.inputs?.length ?? 0) === 1 &&
					(draggedNode.ports?.outputs?.length ?? 0) === 1
				) {
					const el = document.elementFromPoint(e.clientX, e.clientY);
					const edgeEl = el?.closest?.('.edge-hit');
					const key = edgeEl?.getAttribute?.('data-edge-key') ?? null;
					// Don't splice a node onto an edge it's already part of.
					if (key) {
						const candidate = edgeTopology.find((edge) => edgeKeyFor(edge) === key);
						if (
							candidate &&
							candidate.fromId !== draggedNode.id &&
							candidate.toId !== draggedNode.id
						) {
							dropTargetEdgeKey = key;
						} else {
							dropTargetEdgeKey = null;
						}
					} else {
						dropTargetEdgeKey = null;
					}
				} else {
					dropTargetEdgeKey = null;
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

	/** Mirrors groupPlotData in ProcessNode.svelte.js. Keep in sync. */
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

		// Non-tableplot plots: per-set {xN, ysN} ports. Existing sets reuse the
		// pair; the trailing empty pair (one past the last group) appends a new
		// set when a wire drops on it.
		if (target.type === 'plot' && target.plotObj && target.plotObj.type !== 'tableplot') {
			const plot = target.plotObj.plot;
			if (!plot) return;
			plot.data = plot.data ?? [];

			const xMatch = toPort?.match(/^x(\d+)$/);
			const ysMatch = toPort?.match(/^ys(\d+)$/);
			if (!xMatch && !ysMatch) return;

			const groups = groupPlotData(plot.data);
			const setIdx = Number((xMatch ?? ysMatch)[1]) - 1;

			if (xMatch) {
				if (setIdx < groups.length) {
					// Update every data point in this set: new shared x.
					for (const dp of groups[setIdx].dataPoints) {
						dp.x = { ...(dp.x ?? {}), refId: colId };
					}
				} else {
					// Trailing empty pair — seed a new set with x but no y yet.
					const dataIn = { x: { refId: colId }, y: { refId: -1 } };
					if (typeof plot.addData === 'function') plot.addData(dataIn);
					else plot.data = [...plot.data, dataIn];
				}
				return;
			}

			// ysMatch: append a new series to (or seed) the chosen set.
			const setX = setIdx < groups.length ? groups[setIdx].xRefId : -1;
			const dataIn = { x: { refId: setX }, y: { refId: colId } };
			if (typeof plot.addData === 'function') plot.addData(dataIn);
			else plot.data = [...plot.data, dataIn];
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
			const xMatch = portName?.match(/^x(\d+)$/);
			const ysMatch = portName?.match(/^ys(\d+)$/);
			if (!xMatch && !ysMatch) return;

			const groups = groupPlotData(plot.data);
			const setIdx = Number((xMatch ?? ysMatch)[1]) - 1;
			if (setIdx >= groups.length) return; // trailing empty pair — nothing to disconnect

			const g = groups[setIdx];
			if (xMatch) {
				// Orphan the set: clear x.refId on every data point in this group.
				for (const dp of g.dataPoints) {
					if (dp?.x) dp.x = { ...dp.x, refId: -1 };
				}
			} else {
				// Drop every data point in the set (matches the tableplot
				// "clear all wires on this port" semantic).
				const toRemove = new Set(g.dataPoints);
				plot.data = plot.data.filter((dp) => !toRemove.has(dp));
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

	/**
	 * After a non-group node finishes a drag, decide whether the node lands
	 * inside any group's rect (centre-point hit-test) and update the relevant
	 * group's childIds list. Only one group claims the node at a time.
	 */
	function reconcileGroupMembership(nodeId) {
		const draggedNode = allNodes.find((n) => n.id === nodeId);
		if (!draggedNode || draggedNode.type === 'group') return;
		const pos = stablePositions[nodeId] ?? defaultPositions.positions[nodeId];
		if (!pos) return;
		const cx = pos.x + NODE_WIDTH / 2;
		const cy = pos.y + NODE_HEIGHT / 2;
		let landedGroup = null;
		for (const g of core.groups) {
			const gpos = stablePositions[g.id] ?? { x: g.x, y: g.y };
			if (
				cx >= gpos.x &&
				cx <= gpos.x + g.width &&
				cy >= gpos.y &&
				cy <= gpos.y + g.height
			) {
				landedGroup = g;
				break;
			}
		}
		for (const g of core.groups) {
			const inThisGroup = (g.childIds ?? []).includes(nodeId);
			if (g === landedGroup && !inThisGroup) {
				g.childIds = [...(g.childIds ?? []), nodeId];
			} else if (g !== landedGroup && inThisGroup) {
				g.childIds = (g.childIds ?? []).filter((id) => id !== nodeId);
			}
		}
	}

	function stopAll() {
		// Splice-on-edge: if the user dropped a 1-in/1-out node onto an edge,
		// move the underlying entity so the data chain flows through it.
		if (dragInfo?.moved && dropTargetEdgeKey) {
			const draggedNode = allNodes.find((n) => n.id === dragInfo.nodeId);
			const targetEdge = edgeTopology.find((edge) => edgeKeyFor(edge) === dropTargetEdgeKey);
			if (draggedNode && targetEdge) spliceNodeOntoEdge(draggedNode, targetEdge);
		}
		// Group-membership reconciliation runs AFTER the splice check so a
		// node that just spliced onto a wire can still wind up inside a group.
		if (dragInfo?.moved && dragInfo.nodeId) {
			reconcileGroupMembership(dragInfo.nodeId);
		}
		dropTargetEdgeKey = null;
		dragInfo = null;
		resizeInfo = null;
		isPanning = false;
	}

	/**
	 * Splice a 1-in/1-out node into a wire. For AnCiR's column-process model the
	 * actual operation is "move the process to the source column's chain", since
	 * processes are bound to their parent column and the graph connections are
	 * derived from column ordering rather than stored as discrete edges.
	 */
	function spliceNodeOntoEdge(draggedNode, edge) {
		if (draggedNode.type !== 'process' || !draggedNode.processObj) return;
		const sourceColId = resolveOutputColumnId(edge.fromId, edge.fromPort);
		if (sourceColId == null || sourceColId < 0) return;
		const targetCol = core.data.find((c) => c.id === sourceColId);
		if (!targetCol) return;
		const proc = draggedNode.processObj;
		const oldParent = proc.parentCol;
		if (oldParent === targetCol) return; // already on this column
		if (oldParent && Array.isArray(oldParent.processes)) {
			oldParent.processes = oldParent.processes.filter((p) => p.id !== proc.id);
		}
		proc.parentCol = targetCol;
		targetCol.processes = [...(targetCol.processes ?? []), proc];
	}

	function handleNodeAction(node) {
		// Toggle focus: click same node again to deselect
		focusedNodeId = focusedNodeId === node.id ? null : node.id;
		// Selecting a node clears any edge selection.
		selectedEdgeKey = null;

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
		selectedEdgeKey = null;
		pendingConnection = null;
	}

	function clearSelection() {
		deselectAllPlots();
		expandedNodeId = null;
		focusedNodeId = null;
		selectedEdgeKey = null;
		pendingConnection = null;
	}

	/**
	 * Granular per-wire delete. Removes only the (fromId → toPort) connection,
	 * not every wire on the port. For chain-implied connections (data→firstProcess,
	 * tp→its-output-column) we no-op rather than tear out the surrounding node.
	 */
	function removeEdge(edge) {
		const target = allNodes.find((n) => n.id === edge.toId);
		const colId = resolveOutputColumnId(edge.fromId, edge.fromPort);
		if (!target || colId == null || colId < 0) return;

		if (target.type === 'tableprocess' && target.tpObj) {
			const tp = target.tpObj;
			const port = edge.toPort;
			if (!port?.endsWith('IN')) return;
			if (isManyInputPort(target, port)) {
				const arr = Array.isArray(tp.args[port]) ? tp.args[port] : [];
				tp.args[port] = arr.filter((id) => id !== colId);
			} else if (tp.args[port] === colId) {
				tp.args[port] = -1;
			}
			return;
		}

		if (target.type === 'plot' && target.plotObj?.type === 'tableplot' && edge.toPort === 'series') {
			target.plotObj.plot.columnRefs = (target.plotObj.plot.columnRefs ?? []).filter(
				(id) => id !== colId
			);
			return;
		}

		if (target.type === 'plot' && target.plotObj && target.plotObj.type !== 'tableplot') {
			const plot = target.plotObj.plot;
			if (!plot?.data) return;
			const xMatch = edge.toPort?.match(/^x(\d+)$/);
			const ysMatch = edge.toPort?.match(/^ys(\d+)$/);
			if (!xMatch && !ysMatch) return;

			const groups = groupPlotData(plot.data);
			const setIdx = Number((xMatch ?? ysMatch)[1]) - 1;
			if (setIdx >= groups.length) return;
			const g = groups[setIdx];

			if (xMatch) {
				// Edge for the set's shared x: clear x.refId on every data point
				// in this group so the set becomes "orphaned" (next derive groups
				// them under xRefId = -1).
				if (g.xRefId === colId) {
					for (const dp of g.dataPoints) {
						if (dp?.x) dp.x = { ...dp.x, refId: -1 };
					}
				}
				return;
			}

			// ysMatch: drop the first data point in this set whose y matches.
			const idx = g.dataPoints.findIndex((dp) => dp?.y?.refId === colId);
			if (idx < 0) return;
			const removedDp = g.dataPoints[idx];
			plot.data = plot.data.filter((dp) => dp !== removedDp);
		}
	}

	function removeNode(node) {
		if (!node) return;
		if (node.type === 'data') {
			mutationService.removeColumn(node.refId);
			return;
		}
		if (node.type === 'process') {
			const parent = core.data.find((c) => (c.processes ?? []).some((p) => p.id === node.refId));
			if (parent) mutationService.removeProcess(parent.id, node.refId);
			return;
		}
		if (node.type === 'tableprocess' && node.tpObj) {
			// Goes through the existing "Are you sure?" modal flow.
			deleteTableProcess(node.tpObj);
			return;
		}
		if (node.type === 'plot' && node.refId != null) {
			mutationService.removePlot(node.refId);
		}
	}

	function deleteSelection() {
		if (selectedEdgeKey) {
			const edge = edgeTopology.find((e) => edgeKeyFor(e) === selectedEdgeKey);
			if (edge) removeEdge(edge);
			selectedEdgeKey = null;
			return;
		}
		if (focusedNodeId) {
			const node = allNodes.find((n) => n.id === focusedNodeId);
			removeNode(node);
			focusedNodeId = null;
			expandedNodeId = null;
		}
	}

	function handleKeyDown(e) {
		if (e.key === 'Escape') {
			clearSelection();
			return;
		}
		if (e.key === 'Delete' || e.key === 'Backspace') {
			// Ignore if focus is in an editable text control inside an expanded node panel.
			const tag = e.target?.tagName;
			if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
			if (selectedEdgeKey || focusedNodeId) {
				e.preventDefault();
				deleteSelection();
			}
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
		<FloatingActions
			onResetView={resetCanvasView}
			pathFocus={pathFocusEnabled}
			onTogglePathFocus={() => (pathFocusEnabled = !pathFocusEnabled)}
		/>
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
				{selectedEdgeKey}
				{dropTargetEdgeKey}
				onEdgeClick={selectEdge}
			/>

			{#each allNodes as node (node.id)}
				{@const pos = stablePositions[node.id] ?? defaultPositions.positions[node.id]}
				{@const isExpanded = expandedNodeId === node.id}
				{@const isDragging = dragInfo?.nodeId === node.id && dragInfo?.moved}
				{@const isDimmed = connectedNodeIds !== null && !connectedNodeIds.has(node.id)}
				{@const isRecentlyChanged = changedNodeIds.has(node.id)}
				{@const isGroup = node.type === 'group'}
				{@const nodeZIndex = isDragging ? 30 : isExpanded ? 20 : isGroup ? 0 : 1}
				{#if pos}
					<div
						class="workflow-node-wrapper"
						class:dragging={isDragging}
						class:dimmed={isDimmed}
						class:changed={isRecentlyChanged}
						class:group-wrapper={isGroup}
						style="position: absolute; left: {pos.x}px; top: {pos.y}px; z-index: {nodeZIndex};"
						aria-label={node.label}
						onmousedown={(e) => handleNodeWrapperMouseDown(e, node)}
						onmouseup={(e) => handleNodeWrapperMouseUp(e, node)}
						onclick={(e) => e.stopPropagation()}
						role="presentation"
					>
						{#if isGroup}
							<GroupNode
								{node}
								selected={focusedNodeId === node.id || selectedPlotNodeId === node.id}
							/>
						{:else}
							<WorkflowNode
								{node}
								selected={focusedNodeId === node.id || selectedPlotNodeId === node.id}
								expanded={isExpanded}
								isDropTarget={false}
								on:portstart={handlePortStart}
								on:portend={handlePortEnd}
								on:portdisconnect={handlePortDisconnect}
							/>
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

	.icon {
		transition: right 0.6s ease;
	}
</style>
