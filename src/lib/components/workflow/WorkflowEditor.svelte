<script>
	// @ts-nocheck
	import {
		core,
		appState,
		appConsts,
		getProcessNodeGraph,
		absorbColumnIntoGroup,
		extractColumnFromAnyGroup,
		createNote,
		removeNote,
		createGroup,
		removeGroup,
		createComposite,
		removeComposite,
		createOrphanProcess,
		removeOrphanProcess,
		replaceColumnRefs,
		deleteOperationNode,
		pushObj
	} from '$lib/core/core.svelte.js';
	import { untrack, tick } from 'svelte';
	import { computeInterface, flattenMembers } from '$lib/core/composite.js';
	import { addNotification } from '$lib/core/notifications.svelte.js';
	import { Column, getColumnById, removeColumn } from '$lib/core/Column.svelte';
	import { mutationService } from '$lib/core/mutationService.js';
	import { history } from '$lib/core/opHistory.svelte.js';
	import { deleteTableProcess } from '$lib/core/TableProcess.svelte';
	import { selectPlot, deselectAllPlots } from '$lib/core/Plot.svelte';
	import { plotPortRows, plotPortSlotIndex } from '$lib/core/ProcessNode.svelte.js';
	import WorkflowNode from './WorkflowNode.svelte';
	import GroupNode from './GroupNode.svelte';
	import TableProcessNode from './TableProcessNode.svelte';
	import { getGroupPortY } from './groupPortPositions.svelte.js';
	import WorkflowEdges from './WorkflowEdges.svelte';
	import EmbeddedPlot from './EmbeddedPlot.svelte';
	import MiniDataTable from './MiniDataTable.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import NodePalette from './NodePalette.svelte';
	import AddDataPrompt from '$lib/components/views/AddDataPrompt.svelte';
	import { tooltip } from '$lib/utils/tooltip.js';
	import { canvasFileDrop } from '$lib/core/canvasFileDrop.js';
	import { handleCanvasFileDrop } from '$lib/core/dataSourceActions.js';
	import SelectionLayoutToolbar from '$lib/components/reusables/SelectionLayoutToolbar.svelte';
	import { alignBoxes, distributeBoxes, rectsIntersect } from '$lib/core/layoutHelpers.js';
	import { startEdgePan, noteEdgePanMouse, stopEdgePan } from '$lib/core/edgePan.svelte.js';
	import CompactNode from './CompactNode.svelte';
	import NodeActions from './NodeActions.svelte';
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import { tourState } from '$lib/core/tourRunner.svelte.js';
	import {
		COMPACT_W,
		SQUARED_KINDS,
		compactNodeHeight,
		compactPortAnchorY
	} from './nodeGeometry.js';

	let { inline = false } = $props();

	const NODE_WIDTH = 160;
	const TP_NODE_WIDTH = 230; // mirrors TableProcessNode .tp-card width
	const NODE_HEIGHT = 48;
	const HEADER_H = 26; // px, header strip height (matches flowtest's --header-h)
	const PORT_H = 22; // px, height of each port row
	// Per-layer horizontal step for the topological (Tidy) layout. Nodes are
	// 160–240px wide, so this needs generous headroom to leave a clear gap and
	// room for the connecting wires between columns.
	const COL_WIDTH = 320;
	const ROW_HEIGHT = 280;
	const PADDING = 50;
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
	const MIN_NOTE_W = 140; // px — minimum note node width when resizing
	const MIN_NOTE_H = 70; // px — minimum note body height when resizing
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

	// Whether a node renders as a compact square. Groups/composites track their own
	// persisted `collapsed` flag; data/process/tableprocess use collapsedNodeIds
	// (default expanded — a node is compact only if explicitly collapsed).
	// Plots and notes are never compact.
	function isCompact(node) {
		if (node?.type === 'group') return node?.groupObj?.collapsed === true;
		if (node?.type === 'composite') return node?.compositeObj?.collapsed === true;
		return SQUARED_KINDS.has(node?.type) && collapsedNodeIds.has(node?.id);
	}

	// Nodes that offer a compact/detailed toggle (the hover button on the card).
	function canToggleCompact(node) {
		return SQUARED_KINDS.has(node?.type) || node?.type === 'group' || node?.type === 'composite';
	}

	function getPortAnchorY(node, portName, direction) {
		// Compact nodes distribute their ports as a centered stack over the square
		// body (no header), so the anchor is purely formula-based here.
		if (isCompact(node)) {
			const ports = direction === 'out' ? (node.ports?.outputs ?? []) : (node.ports?.inputs ?? []);
			const h = compactNodeHeight(
				node.ports?.inputs?.length ?? 0,
				node.ports?.outputs?.length ?? 0
			);
			let idx = ports.findIndex((p) => p.name === portName);
			if (idx < 0) idx = 0;
			return compactPortAnchorY(idx, ports.length, h);
		}
		// Group rows can expand to show MiniDataTable previews, which makes
		// the simple index-based formula wrong. GroupNode publishes per-port Y
		// after layout — use that when available, otherwise fall through to
		// the formula (covers initial paint and non-group nodes).
		if (node?.type === 'group' || node?.type === 'tableprocess' || node?.type === 'process') {
			const published = getGroupPortY(node.id, portName);
			if (typeof published === 'number') return published;
		}
		// Grouped plot inputs include "Series N" header rows, so a port's slot index
		// differs from its array index. plotPortRows() is shared with WorkflowNode's
		// renderer so the anchor lines up exactly with the rendered dot.
		if (node?.type === 'plot' && direction !== 'out') {
			const ins = node.ports?.inputs ?? [];
			if (ins.some((p) => p?.axis)) {
				const slot = plotPortSlotIndex(ins, portName);
				if (slot >= 0) return HEADER_H + slot * PORT_H + PORT_H / 2;
			}
		}
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

	/**
	 * Width of a node's card, used to compute the right-edge anchor X for
	 * outgoing edges. Group cards can be wider than the default NODE_WIDTH and
	 * are user-resizable, so we look up the live width on the group object.
	 */
	function getNodeWidth(node) {
		if (isCompact(node)) return COMPACT_W;
		if (node?.type === 'group') return node?.groupObj?.width ?? NODE_WIDTH;
		// Plot nodes match their (resizable) preview width. Process / table-process
		// nodes widen to the editor-panel width when expanded so the header and the
		// expanded panel form one clean column. This is the single source of truth
		// for the node's rendered width AND its output-port anchor X, so edges stay
		// attached when a node grows on expand.
		if (node?.type === 'plot') return plotPreviewSizes[node.id]?.w ?? PLOT_PREVIEW_DEFAULT_W;
		// Notes carry their own resizable width on the note object.
		if (node?.type === 'note') return node?.noteObj?.width ?? 200;
		const expanded = !collapsedNodeIds.has(node?.id);
		if (node?.type === 'tableprocess' || node?.type === 'process')
			return expanded ? EDITOR_PANEL_WIDTH : TP_NODE_WIDTH;
		return NODE_WIDTH;
	}

	/** Visual height of a node EXCLUDING any plot-preview/MiniDataTable body. */
	function getNodePortAreaHeight(node) {
		if (isCompact(node)) {
			return compactNodeHeight(node?.ports?.inputs?.length ?? 0, node?.ports?.outputs?.length ?? 0);
		}
		if (node?.type === 'tableprocess' || node?.type === 'process') {
			// Side-by-side: inputs left, output-column rows right. The `all` port
			// sits in the header, so output rows = outputColumns count. (Free process
			// nodes render via TableProcessNode too.)
			const ins = node?.ports?.inputs?.length ?? 0;
			const outs = node?.outputColumns?.length ?? 0;
			const rows = Math.max(1, ins, outs);
			return HEADER_H + rows * PORT_H;
		}
		// Grouped plot inputs add a "Series N" header row per series, so count the
		// rendered rows (headers + ports) rather than just the port count.
		if (node?.type === 'plot') {
			const ins = node?.ports?.inputs ?? [];
			const rows = ins.some((p) => p?.axis) ? plotPortRows(ins).length : ins.length;
			return HEADER_H + Math.max(1, rows) * PORT_H;
		}
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
			const raw =
				typeof localStorage !== 'undefined' && localStorage.getItem(NODE_POSITIONS_STORAGE_KEY);
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
	// Last layout object WorkflowEditor itself wrote into core.nodeLayout, so the
	// adopt-on-import effect can tell its own writes apart from an external (import)
	// replacement and avoid a feedback loop.
	let _mirroredLayout = null;
	// The layout object adopted from the last session import. The mirror effect
	// REPLACES core.nodeLayout (dropping entries for nodes not yet on the canvas),
	// so this retained snapshot is the authority for positioning a node that loads
	// AFTER its layout was adopted (plots / free processes appear last).
	let _importedLayout = null;

	// Queue of canvas-coord {x, y} positions to assign to the NEXT N newly-
	// appeared nodes (one position consumed per node). Pushed by NodePalette
	// before each user-initiated spawn so the new node lands at the centre of
	// the current viewport instead of wherever the topo layout placed it.
	let _spawnPositionQueue = [];

	$effect(() => {
		const currentNodes = allNodes;
		const currentIds = new Set(currentNodes.map((n) => n.id));
		const defaults = defaultPositions.positions;
		const prev = _knownNodeIds;

		// Assign positions to newly appeared nodes only. Priority order:
		//   1. Already pinned in stablePositions before the effect ran (e.g.
		//      paste writes the position directly so the user sees the new
		//      node at the intended +40,+40 offset, not at whatever stale
		//      entry the palette queue happens to hold).
		//   2. Group nodes use their own persisted x/y (createGroup sets it).
		//   3. Palette-spawned queue (viewport-centred) — consumed FIFO.
		//   4. Fall back to the topo-layered default.
		for (const node of currentNodes) {
			if (prev.has(node.id)) continue;
			const saved = _importedLayout?.[node.id] ?? core.nodeLayout?.[node.id];
			if (stablePositions[node.id]) {
				// Already pinned by the caller — leave it untouched.
			} else if (node.type === 'group' && node.groupObj) {
				stablePositions[node.id] = { x: node.groupObj.x, y: node.groupObj.y };
			} else if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) {
				// A persisted session layout pins this node — honour it even if the
				// node appeared AFTER the adopt-layout effect ran. Without this, a
				// late-arriving plot / free-process node (loaded after its layout was
				// adopted) loses its saved position and gets re-flowed by the topo
				// default, which can land it on top of another node.
				stablePositions[node.id] = { x: saved.x, y: saved.y };
			} else if (_spawnPositionQueue.length > 0) {
				stablePositions[node.id] = _spawnPositionQueue.shift();
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

	// Adopt an externally-supplied layout (a session import replaces core.nodeLayout
	// with a fresh, non-empty object). Declared BEFORE the mirror effect so on mount
	// it wins over the mirror's first localStorage-seeded write. Skips its own mirror
	// writes (identity guard) and empty layouts (so a fresh canvas keeps localStorage).
	$effect(() => {
		const cl = core.nodeLayout;
		if (cl === _mirroredLayout) return; // our own write
		if (!cl || Object.keys(cl).length === 0) return; // nothing to adopt
		untrack(() => {
			const pos = {};
			const collapsed = new Set();
			for (const [id, v] of Object.entries(cl)) {
				if (Number.isFinite(v?.x) && Number.isFinite(v?.y)) pos[id] = { x: +v.x, y: +v.y };
				if (v?.collapsed === true) collapsed.add(id);
			}
			stablePositions = pos;
			collapsedNodeIds = collapsed;
			_knownNodeIds = new Set(Object.keys(pos));
			// Retain the full imported layout (incl. nodes not yet on the canvas) so
			// a late-arriving node can still adopt its saved position.
			_importedLayout = cl;
		});
	});

	// The localStorage write is debounced: the persistence effect below re-runs on
	// every position mutation (many times per frame during a drag), and JSON-encoding
	// the whole layout plus a synchronous localStorage.setItem on each run is the
	// single hottest path when dragging on a large canvas. core.nodeLayout stays
	// updated immediately (session export and the adopt effect rely on it); only the
	// localStorage cache trails by the debounce, and it is flushed on unmount.
	const LAYOUT_SAVE_DEBOUNCE_MS = 400;
	let _layoutSaveTimer = null;
	let _pendingLayoutSnapshot = null;
	function flushLayoutSave() {
		clearTimeout(_layoutSaveTimer);
		_layoutSaveTimer = null;
		if (_pendingLayoutSnapshot == null) return;
		try {
			if (typeof localStorage !== 'undefined') {
				localStorage.setItem(NODE_POSITIONS_STORAGE_KEY, JSON.stringify(_pendingLayoutSnapshot));
			}
		} catch {
			/* private mode / quota — ignore */
		}
		_pendingLayoutSnapshot = null;
	}
	$effect(() => flushLayoutSave); // flush any pending save on unmount

	// Mirror stablePositions + collapsed state to localStorage AND core.nodeLayout
	// (the latter is serialised with the session). Reads every entry to register the
	// $derived dep, so dragging a node (mutating one entry) or collapsing triggers a
	// save.
	$effect(() => {
		const snapshot = {};
		for (const [id, pos] of Object.entries(stablePositions)) {
			snapshot[id] = { x: pos.x, y: pos.y };
		}
		// Layout snapshot for the session = positions + collapsed flags.
		const layout = {};
		for (const id in snapshot) layout[id] = { x: snapshot[id].x, y: snapshot[id].y };
		for (const id of collapsedNodeIds) layout[id] = { ...(layout[id] ?? {}), collapsed: true };
		core.nodeLayout = layout;
		// Capture the PROXY identity Svelte wrapped `layout` in (not the raw object),
		// read untracked so this effect doesn't depend on core.nodeLayout. The adopt
		// effect compares against this to ignore our own writes (avoids a feedback loop).
		_mirroredLayout = untrack(() => core.nodeLayout);
		_pendingLayoutSnapshot = snapshot;
		clearTimeout(_layoutSaveTimer);
		_layoutSaveTimer = setTimeout(flushLayoutSave, LAYOUT_SAVE_DEBOUNCE_MS);
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
						x: fromPos.x + getNodeWidth(fromNode),
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

	/** Pan (without changing zoom) so the given node is centred in the viewport.
	 *  Used by the Data panel's find/select button via appState.focusNodeRequest. */
	function panToNode(nodeId) {
		const node = allNodes.find((n) => n.id === nodeId);
		const pos = stablePositions[nodeId] ?? defaultPositions.positions?.[nodeId];
		const rect = canvasViewportEl?.getBoundingClientRect();
		if (!node || !pos || !rect) return;
		const w = getNodeWidth(node);
		const h = getNodeRenderHeight(node);
		panX = rect.width / 2 - (pos.x + w / 2) * zoom;
		panY = rect.height / 2 - (pos.y + h / 2) * zoom;
	}

	// Find/select from the Data Sources panel: when a focus request comes in,
	// select the node and pan to it (after layout settles).
	$effect(() => {
		const req = appState.focusNodeRequest;
		if (!req?.id) return;
		untrack(() => {
			appState.canvasSelectedNodeId = req.id;
			multiSelectedNodeIds = new Set([req.id]);
			tick().then(() => panToNode(req.id));
		});
	});

	// Tidy-layout request (e.g. after the demo seed on cmd-shift-s): re-run the
	// layered layout once the freshly-spawned nodes have settled. The demo adds
	// nodes asynchronously (plots finish rendering after their workers), so poll
	// until the node count stops changing, then tidy after a paint so the wrappers
	// have measurable heights.
	let _tidyWindowReq = -1;
	let _tidyWindowUntil = 0;
	let _tidyDebounceTimer = null;
	$effect(() => {
		const req = appState.tidyLayoutRequest;
		const count = allNodes.length; // track so the effect re-runs as nodes appear
		if (!req || count === 0) return;
		untrack(() => {
			// The demo adds nodes asynchronously (plots finish after their workers). A
			// new request opens a window; every node-set change within it re-arms a
			// debounced tidy, so the final tidy fires once the nodes stop changing —
			// reading the live set + measuring rendered heights for a clean layout.
			// (setTimeout, not requestAnimationFrame, which is paused for hidden tabs.)
			const now = performance.now();
			if (req !== _tidyWindowReq) {
				_tidyWindowReq = req;
				_tidyWindowUntil = now + 4000;
			}
			if (now > _tidyWindowUntil) return;
			clearTimeout(_tidyDebounceTimer);
			_tidyDebounceTimer = setTimeout(() => tidyLayout(), 350);
		});
	});

	/**
	 * Compute the canvas-coord of the current viewport centre, minus half a
	 * default node so the spawn lands centred under the cursor's mental model.
	 * Small random jitter so consecutive spawns don't stack pixel-perfect.
	 */
	function getViewportSpawnPoint() {
		const rect = canvasViewportEl?.getBoundingClientRect();
		if (!rect) return { x: 80, y: 80 };
		const cx = (rect.width / 2 - panX) / zoom - NODE_WIDTH / 2;
		const cy = (rect.height / 2 - panY) / zoom - NODE_HEIGHT;
		const jitter = () => Math.round((Math.random() - 0.5) * 60);
		return { x: Math.round(cx + jitter()), y: Math.round(cy + jitter()) };
	}

	// Place a new node just to the right of the current right-most node, aligned to
	// its row. Returns null when there are no positioned nodes yet.
	function getRightmostSpawnPoint() {
		let maxRight = -Infinity;
		let yAtMax = null;
		for (const node of allNodes) {
			const pos = stablePositions[node.id] ?? defaultPositions.positions[node.id];
			if (!pos) continue;
			const right = pos.x + getNodeWidth(node);
			if (right > maxRight) {
				maxRight = right;
				yAtMax = pos.y;
			}
		}
		if (maxRight === -Infinity) return null;
		return { x: Math.round(maxRight + 70), y: Math.round(yAtMax ?? 80) };
	}

	// During a guided tour, spawn nodes to the right of the right-most node so the
	// growing pipeline stays readable and easy to wire (rather than stacking at the
	// viewport centre). Falls back to the viewport point otherwise.
	function getSpawnPoint() {
		if (tourState.activeTour) {
			const p = getRightmostSpawnPoint();
			if (p) return p;
		}
		return getViewportSpawnPoint();
	}

	function queueSpawnPositionAtViewport() {
		_spawnPositionQueue.push(getSpawnPoint());
	}

	/**
	 * Palette entry point for column processes. Spawns the process as an
	 * orphan (no parent column) so it appears disconnected; the user then
	 * wires it to a data column's output to attach it. Uses the queued
	 * viewport-spawn position so the node lands under the cursor's mental
	 * model rather than at a topo-derived default.
	 */
	function spawnColumnProcessFromPalette(processType) {
		const proc = createOrphanProcess(processType, {});
		if (!proc) return { ok: false, reason: 'create-failed' };
		const newId = `process_${proc.id}`;
		const queued = _spawnPositionQueue.shift();
		const pos = queued ?? getSpawnPoint();
		stablePositions[newId] = { x: pos.x, y: pos.y };
		appState.canvasSelectedNodeId = newId;
		multiSelectedNodeIds = new Set([newId]);
		// New nodes are expanded by default (collapsedNodeIds tracks the exceptions),
		// so no action needed to open it inline.
		return { ok: true, orphanProcessId: proc.id };
	}

	// Build a table process's default args from its registry `defaults` map (same
	// shape MakeNewColumn used). `out` is a nested {key:{val}} structure.
	function buildTableProcessDefaults(entry) {
		const fromNested = (obj) => {
			const r = {};
			for (const [k, v] of Object.entries(obj)) {
				r[k] = v && v.val !== undefined ? v.val : fromNested(v ?? {});
			}
			return r;
		};
		return Object.fromEntries(
			Array.from(entry.defaults?.entries() ?? []).map(([key, value]) =>
				key === 'out' ? ['out', fromNested(value)] : [key, value?.val]
			)
		);
	}

	// Workflow-canvas adds skip the modal: spawn the node with defaults at the
	// viewport centre and (for editable nodes) open it inline, so the user
	// configures in place. Returns { ok }.
	function spawnTableProcessFromPalette(tpType) {
		const entry = appConsts.tableProcessMap.get(tpType);
		if (!entry) return { ok: false, reason: 'unknown-type' };
		queueSpawnPositionAtViewport();
		const tp = mutationService.addFreeTableProcess(tpType, buildTableProcessDefaults(entry));
		if (!tp) return { ok: false };
		const nodeId = `tableprocess_${tp.id}`;
		appState.canvasSelectedNodeId = nodeId;
		multiSelectedNodeIds = new Set([nodeId]);
		// Expanded by default (collapsedNodeIds tracks exceptions).
		return { ok: true };
	}

	function spawnPlotFromPalette(plotType) {
		queueSpawnPositionAtViewport();
		const displayName = appConsts.plotMap.get(plotType)?.displayName ?? plotType;
		const plot = mutationService.addPlot({ name: displayName, type: plotType });
		if (!plot) return { ok: false };
		const nodeId = `plot_${plot.id}`;
		appState.canvasSelectedNodeId = nodeId;
		multiSelectedNodeIds = new Set([nodeId]);
		return { ok: true };
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
			return sx > -margin && sx < rect.width + margin && sy > -margin && sy < rect.height + margin;
		});
		if (!anyVisible) resetCanvasView();
		_viewportSanityChecked = true;
	});
	let isPanning = $state(false);
	/** Bound to the .canvas-viewport element for precise coordinate conversion. */
	let canvasViewportEl = $state(null);
	let panStartX = $state(0);
	let panStartY = $state(0);

	// --- Alt-drag marquee selection ---
	// null when idle; otherwise the live rubber-band in CANVAS coords:
	//   { startX, startY, curX, curY, additive, base }
	// Plain background drag still pans (handleCanvasMouseDown); holding Alt starts
	// a marquee instead, and Alt+Shift adds to the existing selection rather than
	// replacing it. `base` snapshots the selection at drag-start so the live
	// intersect result is (base ∪ nodes-in-box) rather than compounding. Selection
	// updates live on every move; stopAll() just finalises the focused node.
	let marquee = $state(null);
	// The marquee's mouseup also produces a background `click`; without this guard
	// handleBackgroundClick would immediately wipe the selection we just made.
	let suppressBackgroundClick = false;
	// Rendered rect (canvas coords), normalised so width/height are non-negative.
	const marqueeRect = $derived.by(() => {
		if (!marquee) return null;
		return {
			x: Math.min(marquee.startX, marquee.curX),
			y: Math.min(marquee.startY, marquee.curY),
			w: Math.abs(marquee.curX - marquee.startX),
			h: Math.abs(marquee.curY - marquee.startY)
		};
	});

	// --- Node drag state ---
	// { nodeId, startMouseCanvas: {x,y}, startPos: {x,y}, moved: boolean }
	// Lifecycle: set on pointerdown on a node; `moved` flips true once the pointer
	// travels past the click threshold (so a drop with moved===false is treated as
	// a plain click/selection in handleNodeWrapperMouseUp). While dragging it feeds
	// the drop-target detection below (edge splice / port insert / group absorb);
	// stopAll() consumes the pending drop and clears this back to null.
	let dragInfo = $state(null);

	// --- Column drag-to-replace drop target ---
	// Edge-key of the wire the user is currently dragging a node toward.
	// When non-null on drop AND the dragged node has exactly one input and one
	// output, stopAll() splices the node onto that edge (flowtest-style).
	let dropTargetEdgeKey = $state(null);

	// Port the user is currently dragging a node toward, formatted as
	// `${nodeId}|${portName}`. Takes priority over dropTargetEdgeKey because it
	// expresses a more specific intent: insert the dragged node into EVERY edge at
	// that port. An OUTPUT port inserts the node after the source (between it and
	// all its consumers); an INPUT port inserts the node before the target (between
	// all its sources and it). Cleared in stopAll.
	let dropTargetPortKey = $state(null);
	// 'out' | 'in' — which side the detected port is on (drives the splice).
	let dropTargetPortDir = $state(null);

	// Set during drag whenever the dragged node's bbox overlaps a group's bbox.
	// Drives the .drop-target highlight on GroupNode so the user can see the
	// drop will be captured. Cleared in stopAll.
	let dragHoverGroupId = $state(null);

	// --- Plot resize state ---
	// { nodeId, plotObj, startMouse:{x,y}, startW, startH, startPlotW, startPlotH }
	let resizeInfo = $state(null);
	let pendingConnection = $state(null); // { fromNodeId, fromPort }

	// Right-click column picker for an input port: { nodeId, port, x, y } while
	// open. `portPickerOpen` is bound to the ColumnSelector popover so an
	// outside-click close clears the picker.
	let portPicker = $state(null);
	let portPickerOpen = $state(false);
	// Bound to the picker's ColumnSelector: a colId array (multi ports) or a
	// single colId (single ports). Seeded from the port's current wiring on open.
	let portPickerValue = $state(-1);
	$effect(() => {
		// When the popover closes (outside click or selection), drop the picker.
		if (!portPickerOpen && portPicker) portPicker = null;
	});
	let mouseCanvas = $state({ x: 0, y: 0 });

	// Extract-a-source-from-group gesture state. Mirrors flowtest's
	// `uiState.extractGesture`: pointerdown on a row's grip → window-level
	// pointermove tracks whether the pointer has left the group's bbox →
	// pointerup decides between cancel (still inside) and extract (outside).
	// Extract removes the column from its group, which makes ProcessNode re-
	// derive a standalone `data_${colId}` node. We seed `_spawnPositionQueue`
	// so the new node lands where the user dropped instead of at the topo-
	// derived default.
	let extractGesture = $state(null);

	// --- Collapsed (compact) nodes. We track the COLLAPSED set so the default is
	// EXPANDED (a node not listed is shown in full). Persisted per-session via
	// core.nodeLayout, so collapsing survives save/load. ---
	let collapsedNodeIds = $state(new Set());

	// --- Focus / connected-node highlight ---
	// The focused ("primary" selected) node id is appState.canvasSelectedNodeId,
	// used directly rather than kept in a mirrored local copy: the side panels
	// (DataDisplay, NodeSourceItem, Navbar, CanvasNodeControls) also write it to
	// drive selection from outside the canvas, and a local mirror would clobber
	// those writes. The panel is NOT auto-opened on selection — single-click only
	// selects. The panel opens explicitly via double-click (handleNodeDblClick)
	// or the header arrow, and its open/closed state otherwise persists: an open
	// panel just re-renders for the newly selected node; a closed one stays closed.

	// Multi-select set. Holds every node id currently part of the marquee-style
	// selection (built up via alt/meta/shift-click on additional nodes). The
	// focused id is always inside the set when at least one node is selected;
	// it is the "primary" one whose editor shows in the panel for size === 1.
	// For size > 1 the panel shows a count message instead.
	let multiSelectedNodeIds = $state(new Set());

	// Mirror the multi-selection to appState so the ControlPanel can render a
	// count/editor for it. One-way (canvas → appState) — unlike the focused id,
	// external writes to these fields are not adopted back into the local Set.
	$effect(() => {
		appState.canvasMultiSelectedCount = multiSelectedNodeIds.size;
		appState.canvasMultiSelectedNodeIds = Array.from(multiSelectedNodeIds);
	});

	// Path-focus dim mode (flowtest-style). When true AND a node is selected,
	// non-connected nodes dim out. Toggled via the viewport toolbar button.
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

	// Canvas code maintains the node-XOR-edge invariant at each write site, but
	// external writers of appState.canvasSelectedNodeId (side panels) can't reach
	// selectedEdgeKey — enforce it here for those writes.
	$effect(() => {
		if (appState.canvasSelectedNodeId != null) selectedEdgeKey = null;
	});

	function edgeKeyFor(edge) {
		return `${edge.fromId}|${edge.fromPort}|${edge.toId}|${edge.toPort}|${edge.type}`;
	}

	function selectEdge(edge) {
		selectedEdgeKey = edgeKeyFor(edge);
		appState.canvasSelectedNodeId = null;
		// Expansion is a separate, explicit gesture (double-click) — leave it
		// alone when the user selects an edge so already-expanded nodes stay open.
	}

	// Node currently under the cursor — drives path-focus highlighting on hover
	// (flowtest behaviour), in addition to the selected node.
	let hoveredNodeId = $state(null);

	// Separate hover state for the action-button overlay, with a short grace
	// period on leave so the floating toolbar (which sits just outside the node)
	// stays visible AND clickable while the cursor travels to it. Kept apart from
	// hoveredNodeId so edge-highlighting still clears immediately.
	let actionsHoverId = $state(null);
	let actionsHoverTimer = null;
	function showNodeActions(id) {
		clearTimeout(actionsHoverTimer);
		actionsHoverId = id;
	}
	function hideNodeActionsSoon() {
		clearTimeout(actionsHoverTimer);
		actionsHoverTimer = setTimeout(() => {
			actionsHoverId = null;
		}, 500);
	}
	// Don't let a pending hide-timer fire (and touch state) after unmount.
	$effect(() => () => clearTimeout(actionsHoverTimer));

	// True while an OS file is dragged over the canvas (drop-to-import).
	let fileDragOver = $state(false);

	// --- Multi-node align / distribute + auto-tidy ---
	function getNodeRenderHeight(node) {
		const base = getNodePortAreaHeight(node);
		if (node.type === 'plot') {
			const ps = plotPreviewSizes[node.id];
			return base + (ps ? ps.h : getDefaultPreviewH(node.plotObj));
		}
		// Note nodes are a header + a resizable body of the stored height.
		if (node.type === 'note') return HEADER_H + (node.noteObj?.height ?? 120);
		return base;
	}
	function selectedNodeBoxes() {
		const out = [];
		for (const id of multiSelectedNodeIds) {
			const node = allNodes.find((n) => n.id === id);
			if (!node) continue;
			const pos = stablePositions[id] ?? defaultPositions.positions[id];
			if (!pos) continue;
			out.push({ id, x: pos.x, y: pos.y, w: getNodeWidth(node), h: getNodeRenderHeight(node) });
		}
		return out;
	}
	function applyNodePositions(map) {
		for (const [id, pos] of map) {
			if (stablePositions[id]) {
				stablePositions[id].x = pos.x;
				stablePositions[id].y = pos.y;
			} else {
				stablePositions[id] = { x: pos.x, y: pos.y };
			}
		}
	}
	function alignSelectedNodes(mode) {
		applyNodePositions(alignBoxes(selectedNodeBoxes(), mode));
	}
	function distributeSelectedNodes(axis) {
		applyNodePositions(distributeBoxes(selectedNodeBoxes(), axis));
	}
	// Measure a node's actual rendered height (canvas coordinates). offsetHeight is
	// the untransformed layout height, so it's unaffected by the canvas zoom and
	// already includes the expanded editor panel / plot preview / note body — which
	// the cheap port-area estimate used for initial placement does not. Falls back
	// to the estimate when the element isn't in the DOM (e.g. expanded composites).
	function measureNodeHeight(node) {
		if (typeof document !== 'undefined') {
			const el = document.querySelector(`[data-node-id="${CSS.escape(node.id)}"]`);
			if (el?.offsetHeight) return el.offsetHeight;
		}
		return getNodeRenderHeight(node);
	}

	// Re-run the topological layered layout for every node, restoring the clean
	// left-to-right DAG arrangement. Same column (layer) assignment as the initial
	// engine, but each column is re-stacked using measured node heights so expanded
	// nodes no longer overlap the node below them.
	function tidyLayout() {
		const layers = computeNodeLayers(allNodes, edgeTopology);
		const layerOffsets = {};
		const GAP = 24;
		for (const node of allNodes) {
			const layer = layers.get(node.id) ?? 0;
			if (layerOffsets[layer] == null) layerOffsets[layer] = 0;
			const x = layer * COL_WIDTH + PADDING;
			const y = layerOffsets[layer] + PADDING;
			if (stablePositions[node.id]) {
				stablePositions[node.id].x = x;
				stablePositions[node.id].y = y;
			} else {
				stablePositions[node.id] = { x, y };
			}
			layerOffsets[layer] += measureNodeHeight(node) + GAP;
		}
	}

	// Path-focus: when enabled, highlight the active node (hovered, else selected)
	// plus its IMMEDIATE (1-hop) neighbours and lowlight everything else — matching
	// flowtest. Hovering a node previews its direct connections without selecting.
	const connectedNodeIds = $derived.by(() => {
		if (!pathFocusEnabled) return null;
		const active = hoveredNodeId ?? appState.canvasSelectedNodeId;
		if (!active) return null;
		const connected = new Set([active]);
		for (const edge of edgeTopology) {
			if (edge.fromId === active) connected.add(edge.toId);
			if (edge.toId === active) connected.add(edge.fromId);
		}
		return connected;
	});

	// Auto-prune collapsedNodeIds when a referenced node is genuinely deleted, so a
	// reused node id (e.g. a new tableprocess_0 after the old one was deleted)
	// defaults to expanded rather than inheriting a stale collapsed flag.
	//
	// Checked against `core` (the source of truth) rather than the derived
	// `allNodes` graph, which can be transiently stale right after an undo/redo
	// restore. The set built below is a superset of every compactable (data /
	// process / tableprocess) node id the projection can emit, so a live node is
	// never pruned — only truly-removed ones are.
	$effect(() => {
		if (collapsedNodeIds.size === 0) return;
		const liveIds = new Set();
		for (const col of core.data ?? []) {
			liveIds.add(`data_${col.id}`);
			for (const p of col.processes ?? []) liveIds.add(`process_${p.id}`);
		}
		for (const p of core.orphanProcesses ?? []) liveIds.add(`process_${p.id}`);
		for (const tp of core.tableProcesses ?? []) {
			liveIds.add(`tableprocess_${tp.id}`);
			for (const nested of tp.args?.tableProcesses ?? []) {
				liveIds.add(`tableprocess_nested_${nested.id}`);
			}
		}
		let changed = false;
		const next = new Set();
		for (const id of collapsedNodeIds) {
			if (liveIds.has(id)) next.add(id);
			else changed = true;
		}
		if (changed) collapsedNodeIds = next;
	});

	// Hook canvas selection into the undo/redo stack so that undoing a delete
	// restores the prior selection, and redoing re-applies the post-op state.
	// uiBefore is captured at the moment the op is recorded (selection updates
	// from the same gesture run synchronously after applyOp, so this is pre-
	// gesture state); uiAfter is captured via a microtask after the gesture
	// completes.
	//
	// NOTE: node collapse (`collapsedNodeIds`) is deliberately NOT part of this
	// snapshot. Collapse is an explicit per-node UI gesture and must stay put across
	// undo/redo. Deleted nodes are cleaned out of `collapsedNodeIds` by the
	// auto-prune effect above instead.
	$effect(() => {
		return history.registerUiHandlers(
			() => ({
				focusedNodeId: appState.canvasSelectedNodeId,
				multiSelectedNodeIds: Array.from(multiSelectedNodeIds),
				selectedEdgeKey
			}),
			(snap) => {
				appState.canvasSelectedNodeId = snap.focusedNodeId ?? null;
				multiSelectedNodeIds = new Set(snap.multiSelectedNodeIds ?? []);
				selectedEdgeKey = snap.selectedEdgeKey ?? null;
			}
		);
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
		// Exception: ctrl/meta + wheel is always a zoom gesture, so let it through.
		//
		// NEW overlays should just add the `.no-canvas-wheel` marker class rather
		// than extending this list; the explicit selectors below are retained for
		// the existing overlays that predate the marker.
		if (
			!e.ctrlKey &&
			!e.metaKey &&
			e.target?.closest?.(
				'.no-canvas-wheel, dialog, .backdrop, .np-menu, .palette-menu, .modal, .modal-content, ' +
					'.modal-overlay, .dropdown, .dropdown-menu, .submenu, .process-editor-panel, ' +
					'.node-note-popover, .plot-preview-panel, .plot-preview-inner, textarea'
			)
		) {
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
		// Alt+drag on empty canvas = marquee select (Alt+Shift adds to selection).
		// Plain drag keeps panning. The marquee only starts here, on the canvas
		// background — node wrappers stopPropagation, so an Alt-drag that begins on
		// a node still moves the node rather than starting a marquee.
		if (e.altKey) {
			const { x, y } = toCanvasCoords(e.clientX, e.clientY);
			marquee = {
				startX: x,
				startY: y,
				curX: x,
				curY: y,
				additive: e.shiftKey,
				base: e.shiftKey ? new Set(multiSelectedNodeIds) : new Set()
			};
			// Track on the window so the drag survives the cursor passing over nodes
			// and releasing anywhere (over an expanded node panel, off-canvas, etc.).
			window.addEventListener('mousemove', onMarqueeMove);
			window.addEventListener('mouseup', onMarqueeUp);
			return;
		}
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
		if (e.target.closest('.note-resize-handle')) return;
		// Group header/body has its own resize-handle and delete-X which stop
		// propagation themselves. We only need to swallow events landing on the
		// resize handle so a drag from there doesn't start a node-move.
		if (e.target.closest('.group-resize-handle')) return;

		const { x: canvasX, y: canvasY } = toCanvasCoords(e.clientX, e.clientY);
		const pos = stablePositions[node.id] ?? defaultPositions.positions[node.id];
		if (!pos) return;

		// Source-groups carry their absorbed columns inline (as rows inside
		// the card), so dragging the group moves them automatically. No
		// separate per-child position bookkeeping is needed any more.
		//
		// Multi-select drag: if the node being dragged is in the multi-select
		// set, snapshot every other selected node's starting position so the
		// move handler can apply the same delta to all of them in lockstep.
		const companions = [];
		const addCompanion = (otherId) => {
			if (otherId === node.id || companions.some((c) => c.id === otherId)) return;
			const op = stablePositions[otherId] ?? defaultPositions.positions[otherId];
			if (op) companions.push({ id: otherId, startPos: { x: op.x, y: op.y } });
		};
		if (multiSelectedNodeIds.has(node.id) && multiSelectedNodeIds.size > 1) {
			for (const otherId of multiSelectedNodeIds) addCompanion(otherId);
		}
		// Dragging a composite drags all its member nodes with it (collapsed or
		// expanded), so the bundle moves as one body.
		if (node.type === 'composite') {
			const comp = core.composites.find((c) => c.id === node.id);
			for (const mid of comp?.memberIds ?? []) addCompanion(mid);
		}
		dragInfo = {
			nodeId: node.id,
			startMouseCanvas: { x: canvasX, y: canvasY },
			startPos: { x: pos.x, y: pos.y },
			moved: false,
			companions
		};
		if (canvasViewportEl) {
			startEdgePan({
				getViewportRect: () => canvasViewportEl.getBoundingClientRect(),
				applyPan: (dx, dy) => {
					panX += dx;
					panY += dy;
				}
			});
			noteEdgePanMouse(e.clientX, e.clientY);
		}
	}

	// Note resize: same "drag the bottom-right handle, position stays put" model as
	// plots, but writes width/height straight onto the note object.
	function handleNoteResizeMouseDown(e, node) {
		e.stopPropagation();
		const n = node.noteObj;
		if (!n) return;
		resizeInfo = {
			nodeId: node.id,
			noteObj: n,
			startMouse: { x: e.clientX, y: e.clientY },
			startW: n.width ?? 200,
			startH: n.height ?? 120
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

		// Feed the edge-pan engine so it nudges the canvas toward the cursor
		// while a node drag is in progress.
		if (dragInfo) noteEdgePanMouse(e.clientX, e.clientY);

		if (resizeInfo) {
			const dx = (e.clientX - resizeInfo.startMouse.x) / zoom;
			const dy = (e.clientY - resizeInfo.startMouse.y) / zoom;
			// Notes resize their own width/height in place (position fixed), like a plot.
			if (resizeInfo.noteObj) {
				resizeInfo.noteObj.width = Math.max(MIN_NOTE_W, Math.round(resizeInfo.startW + dx));
				resizeInfo.noteObj.height = Math.max(MIN_NOTE_H, Math.round(resizeInfo.startH + dy));
				return;
			}
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

				// Apply the same delta to every co-selected node so the whole
				// multi-selection moves as one body.
				if (dragInfo.companions?.length) {
					for (const c of dragInfo.companions) {
						const cx = c.startPos.x + dx;
						const cy = c.startPos.y + dy;
						if (stablePositions[c.id]) {
							stablePositions[c.id].x = cx;
							stablePositions[c.id].y = cy;
						} else {
							stablePositions[c.id] = { x: cx, y: cy };
						}
					}
				}

				// Splice / insert detection. Bbox-overlap based (instead of the
				// old elementFromPoint approach, which fails because the dragged
				// node is rendered AT the cursor and blocks hit-testing of the
				// edge or port underneath). Gated to ORPHAN column-processes
				// only: once a process is already wired into a chain, dragging
				// it shouldn't yank it out and splice it elsewhere — the user
				// has to first detach it (delete its chain edge) to move it.
				const draggedNode = allNodes.find((n) => n.id === dragInfo.nodeId);
				// Only a FRESH, unconnected 1:1 node may be inserted onto an edge or
				// port. If it already has any wired input or output, dragging it must
				// not yank it out and splice it elsewhere — detach it first.
				const draggedHasConnections =
					!!draggedNode &&
					allEdges.some((e) => e.fromId === draggedNode.id || e.toId === draggedNode.id);
				const draggedFits =
					draggedNode &&
					draggedNode.type === 'process' &&
					draggedNode.processObj &&
					!draggedNode.processObj.parentCol &&
					(draggedNode.ports?.inputs?.length ?? 0) === 1 &&
					(draggedNode.ports?.outputs?.length ?? 0) === 1 &&
					!draggedHasConnections;
				if (draggedFits) {
					const dw = getNodeWidth(draggedNode);
					const dh = getNodePortAreaHeight(draggedNode);
					const cx = nx + dw / 2;
					const cy = ny + dh / 2;
					const draggedBox = { x1: nx, y1: ny, x2: nx + dw, y2: ny + dh };

					// 1) Port hit — preferred. Picks the closest overlapping port
					//    (output on the right edge, input on the left edge) to the
					//    dragged node's centre. Output → insert after the source;
					//    input → insert before the target.
					let bestPort = null;
					let bestPortDir = null;
					let bestPortDist = Infinity;
					for (const node of allNodes) {
						if (node.id === draggedNode.id) continue;
						const pos = stablePositions[node.id] ?? defaultPositions.positions[node.id];
						if (!pos) continue;
						const nw = getNodeWidth(node);
						const consider = (portName, portX, portY, dir) => {
							if (
								portX < draggedBox.x1 ||
								portX > draggedBox.x2 ||
								portY < draggedBox.y1 ||
								portY > draggedBox.y2
							)
								return;
							const d = (portX - cx) ** 2 + (portY - cy) ** 2;
							if (d < bestPortDist) {
								bestPortDist = d;
								bestPort = `${node.id}|${portName}`;
								bestPortDir = dir;
							}
						};
						for (const port of node.ports?.outputs ?? []) {
							consider(
								port.name,
								pos.x + nw,
								pos.y + getPortAnchorY(node, port.name, 'out'),
								'out'
							);
						}
						for (const port of node.ports?.inputs ?? []) {
							consider(port.name, pos.x, pos.y + getPortAnchorY(node, port.name, 'in'), 'in');
						}
					}

					// 2) Edge bbox overlap — fallback when no port is in range.
					let bestEdge = null;
					let bestEdgeDist = Infinity;
					if (!bestPort) {
						const pad = 6;
						for (const edge of allEdges) {
							if (
								!edge.from ||
								!edge.to ||
								edge.fromId === draggedNode.id ||
								edge.toId === draggedNode.id
							)
								continue;
							const ex1 = Math.min(edge.from.x, edge.to.x) - pad;
							const ey1 = Math.min(edge.from.y, edge.to.y) - pad;
							const ex2 = Math.max(edge.from.x, edge.to.x) + pad;
							const ey2 = Math.max(edge.from.y, edge.to.y) + pad;
							if (
								ex2 < draggedBox.x1 ||
								ex1 > draggedBox.x2 ||
								ey2 < draggedBox.y1 ||
								ey1 > draggedBox.y2
							)
								continue;
							const mx = (edge.from.x + edge.to.x) / 2;
							const my = (edge.from.y + edge.to.y) / 2;
							const d = (mx - cx) ** 2 + (my - cy) ** 2;
							if (d < bestEdgeDist) {
								bestEdgeDist = d;
								bestEdge = edgeKeyFor(edge);
							}
						}
					}

					dropTargetPortKey = bestPort;
					dropTargetPortDir = bestPort ? bestPortDir : null;
					dropTargetEdgeKey = bestEdge;
				} else {
					dropTargetPortKey = null;
					dropTargetPortDir = null;
					dropTargetEdgeKey = null;
				}

				// Live drop-target highlight on the Group being hovered. Only
				// data nodes can be absorbed, so other drags never highlight.
				const draggedNodeForGroup = allNodes.find((n) => n.id === dragInfo.nodeId);
				if (draggedNodeForGroup?.type === 'data') {
					let hover = null;
					for (const g of core.groups) {
						const gpos = stablePositions[g.id] ?? { x: g.x, y: g.y };
						const ax1 = nx;
						const ay1 = ny;
						const ax2 = nx + NODE_WIDTH;
						const ay2 = ny + NODE_HEIGHT;
						const bx1 = gpos.x;
						const by1 = gpos.y;
						const bx2 = gpos.x + g.width;
						const by2 = gpos.y + g.height;
						if (ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1) {
							hover = g.id;
							break;
						}
					}
					dragHoverGroupId = hover;
				} else {
					dragHoverGroupId = null;
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
		if (node.type === 'group') {
			// `col_${colId}` is the per-source port; `all` is handled separately
			// by callers that want fan-out (see applyConnection).
			if (typeof portName === 'string' && portName.startsWith('col_')) {
				const id = Number(portName.slice(4));
				return Number.isFinite(id) ? id : -1;
			}
			return -1;
		}
		if (node.type === 'process') {
			// Free (orphan) process: each output is a producer column keyed by its
			// producerPort (out_<inputColId>). Resolve via the node's outputColumns
			// so removeEdge/splice can find the column behind an out_ / all edge.
			const oc = (node.outputColumns ?? []).find((o) => o.port === portName);
			if (oc) return oc.colId;
			const parent = core.data.find((c) => (c.processes ?? []).some((p) => p.id === node.refId));
			if (!parent) return -1;
			// If a tap exists at this process step, downstream wires reference the
			// tap column (not the parent's full-chain output). Prefer the tap so
			// removeEdge/splice can find it; fall back to parent for intra-chain
			// edges (which the existing branch-less consumers harmlessly ignore).
			const tap = findExistingTap(parent.id, node.refId);
			return tap ? tap.id : parent.id;
		}
		if (node.type === 'tableprocess' && node.tpObj) {
			// Inline output-column rows expose `col_<colId>` ports directly.
			if (typeof portName === 'string' && portName.startsWith('col_')) {
				const id = Number(portName.slice(4));
				return Number.isFinite(id) ? id : -1;
			}
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

	// Look up an existing tap column for (parentCol, processId). Returns null if
	// none yet exists. Pure lookup — never creates.
	function findExistingTap(parentColId, processId) {
		return core.data.find((c) => c.refId === parentColId && c.refUpToProcessId === processId);
	}

	// Find an existing tap for this (parent, process) or create one. The tap is
	// a normal Column with refUpToProcessId set; ProcessNode graph hides its
	// data_X node and routes consumers' wires from process_<process.id>.output.
	function findOrCreateTapColumn(parent, process) {
		const existing = findExistingTap(parent.id, process.id);
		if (existing) return existing;
		const tap = new Column({
			refId: parent.id,
			refUpToProcessId: process.id
		});
		tap.customName = `${parent.name}@${process.displayName || process.name}`;
		core.data.push(tap);
		return tap;
	}

	// Column types a free process refuses on its input, declared as `disallowTypes`
	// on the process definition's nodeSpec input (e.g. Substitute blocks 'time').
	function disallowedInputTypes(proc) {
		if (!proc) return [];
		const entry = appConsts.processMap.get(proc.name);
		return (
			entry?.definition?.nodeSpec?.inputs?.[0]?.disallowTypes ??
			entry?.nodeSpec?.inputs?.[0]?.disallowTypes ??
			[]
		);
	}

	function applyConnection(fromNodeId, fromPort, toNodeId, toPort) {
		// Process output → non-process target: this is a tap. Reuse or create a
		// tap column for (parent, process) so consumers can ref it like any col.
		const fromNode = allNodes.find((n) => n.id === fromNodeId);
		let colId;
		if (fromNode?.type === 'process') {
			// Free process (dataflow): each output port maps to one producer column.
			const producer = core.data.find(
				(c) =>
					c.producerNodeId === `process_${fromNode.refId}` &&
					(c.producerPort || 'output') === fromPort
			);
			if (producer) {
				colId = producer.id;
			} else {
				// Legacy: a process living in a column's processes[] chain — tap it.
				const parent = core.data.find((c) =>
					(c.processes ?? []).some((p) => p.id === fromNode.refId)
				);
				const proc = parent?.processes.find((p) => p.id === fromNode.refId);
				if (!parent || !proc) return;
				colId = findOrCreateTapColumn(parent, proc).id;
			}
		} else {
			colId = resolveOutputColumnId(fromNodeId, fromPort);
		}
		if (colId < 0) return;
		connectColumnToInput(colId, toNodeId, toPort);
	}

	// Wrap a direct, in-place edit to a plot's inner data object (plot.plot —
	// series data, columnRefs, dp.x.refId, …) so it lands on the undo stack.
	// Plot wiring mutates plot.plot directly (deliberately, to preserve the live
	// ColumnClass instances and their reactive derivations). Those writes don't
	// go through the op layer and the paramDiffWatcher only watches process /
	// table-process args, so without this they were invisible to history. Here we
	// snapshot before, run the mutation, snapshot after, revert, then replay the
	// after-state through the setPlotInner op — one undoable step per wire.
	function recordPlotEdit(plotObj, mutate) {
		const entry = plotObj && appConsts.plotMap.get(plotObj.type);
		const inner = plotObj?.plot;
		if (typeof entry?.data?.fromJSON !== 'function' || !inner) {
			mutate();
			return;
		}
		const serialize = (o) =>
			JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'function' ? undefined : v)));
		const before = serialize(inner);
		mutate();
		const after = serialize(plotObj.plot);
		if (JSON.stringify(before) === JSON.stringify(after)) return; // no-op wire
		// Revert the direct mutation, then route the after-state through the op so
		// it's recorded. fromJSON rebuilds plot.plot (now $state → reactive swap).
		plotObj.plot = entry.data.fromJSON(plotObj, before);
		mutationService.setPlotInner(plotObj.id, after);
	}

	// Target-side of a connection: wire an already-resolved source column (colId)
	// into a node's input port. Shared by the drag-connect path (applyConnection)
	// and the right-click column picker (handlePortPick).
	function connectColumnToInput(colId, toNodeId, toPort) {
		if (colId < 0) return;
		const target = allNodes.find((n) => n.id === toNodeId);
		if (!target) return;

		// Column process input (dataflow model): only free (orphan) process nodes
		// accept user-drawn input wires. Wiring a column into a free process input
		// records the process's input column (args.inIN) and, the first time,
		// creates a PRODUCER output column that represents the node's result. The
		// process stays free in core.orphanProcesses — it is no longer shoved onto
		// a column's processes[] chain. Both steps go through the op layer (batched)
		// so the wire is a single undo. The producer column is hidden on the canvas;
		// the node's output port is its handle (see ProcessNode columnSourceRef).
		if (target.type === 'process' && target.processObj && toPort === 'input') {
			const proc = target.processObj;
			if (!proc.parentCol) {
				const procNodeId = `process_${proc.id}`;
				// inIN is a list of input columns (fan-out). Append this one.
				const cur = Array.isArray(proc.args?.inIN)
					? proc.args.inIN
					: proc.args?.inIN != null && proc.args.inIN >= 0
						? [proc.args.inIN]
						: [];
				// Same-type inputs only: a free process fans one shared operation out
				// over every input, so mixing column types (e.g. number + time, which
				// take different value units) isn't meaningful. Reject a mismatch.
				const newType = core.data.find((c) => c.id === colId)?.type;
				const banned = disallowedInputTypes(proc);
				if (newType != null && banned.includes(newType)) {
					addNotification(`${proc.displayName || proc.name} doesn't support ${newType} columns yet.`);
					return;
				}
				const existingType = cur.length ? getColumnById(cur[0])?.type : null;
				if (existingType != null && newType != null && existingType !== newType) {
					addNotification(
						`${proc.displayName || proc.name} inputs must all be the same type (already ${existingType}).`
					);
					return;
				}
				const ops = [];
				if (!cur.includes(colId)) {
					ops.push({
						kind: 'setOrphanProcessArg',
						processId: proc.id,
						key: 'inIN',
						value: [...cur, colId]
					});
				}
				// One paired producer output column per input, keyed by the input id.
				const port = `out_${colId}`;
				const hasProducer = core.data.some(
					(c) => c.producerNodeId === procNodeId && (c.producerPort || 'output') === port
				);
				if (!hasProducer) {
					const srcType = core.data.find((c) => c.id === colId)?.type ?? 'number';
					ops.push({
						kind: 'addColumn',
						columnData: {
							type: srcType,
							producerNodeId: procNodeId,
							producerPort: port,
							producerArtifactKind: 'column'
						}
					});
				}
				if (ops.length) mutationService.batch(ops);
			}
			return;
		}

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
			recordPlotEdit(target.plotObj, () => {
				const refs = target.plotObj.plot.columnRefs ?? [];
				if (!refs.includes(colId)) target.plotObj.plot.columnRefs = [...refs, colId];
			});
			return;
		}

		// Single-input non-x/y plots (e.g. Histogram) expose a single dynamic `data`
		// port. Dropping a wire appends a new series with that column.
		if (
			target.type === 'plot' &&
			target.plotObj &&
			target.plotObj.type !== 'tableplot' &&
			toPort === 'data'
		) {
			recordPlotEdit(target.plotObj, () => {
				const plot = target.plotObj.plot;
				const defaultInputs = appConsts.plotMap.get(target.plotObj.type)?.defaultInputs ?? [];
				if (!plot || defaultInputs.length !== 1) return;
				const field = defaultInputs[0];
				const dataIn = { [field]: { refId: colId } };
				if (typeof plot.addData === 'function') plot.addData(dataIn);
				else plot.data = [...(plot.data ?? []), dataIn];
			});
			return;
		}

		// Non-tableplot plots: per-set {xN, ysN} ports. Existing sets reuse the
		// pair; the trailing empty pair (one past the last group) appends a new
		// set when a wire drops on it.
		if (target.type === 'plot' && target.plotObj && target.plotObj.type !== 'tableplot') {
			recordPlotEdit(target.plotObj, () => {
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
						// Mutate refId in place so the ColumnClass instance (and its
						// getData() prototype) survives. Replacing dp.x with a plain
						// object spread silently breaks the reactive plot derivations.
						for (const dp of groups[setIdx].dataPoints) {
							if (dp?.x) dp.x.refId = colId;
						}
					} else {
						// Trailing empty pair — seed a new set with x but no y yet.
						const dataIn = { x: { refId: colId }, y: { refId: -1 } };
						if (typeof plot.addData === 'function') plot.addData(dataIn);
						else plot.data = [...plot.data, dataIn];
					}
					return;
				}

				// ysMatch: re-use a freed/orphan y-slot in the set if one exists (so
				// removing a y then adding a new one doesn't leave a duplicate orphan
				// series); otherwise append a new series to (or seed) the chosen set.
				const grp = setIdx < groups.length ? groups[setIdx] : null;
				const setX = grp ? grp.xRefId : -1;
				const orphanDp = grp?.dataPoints.find(
					(dp) => (dp?.y?.refId ?? -1) < 0 || !getColumnById(dp?.y?.refId)
				);
				if (orphanDp) {
					if (orphanDp.y) orphanDp.y.refId = colId;
					else orphanDp.y = { refId: colId };
				} else {
					const dataIn = { x: { refId: setX }, y: { refId: colId } };
					if (typeof plot.addData === 'function') plot.addData(dataIn);
					else plot.data = [...plot.data, dataIn];
				}
			});
		}
	}

	function disconnectInputPort(nodeId, portName) {
		const target = allNodes.find((n) => n.id === nodeId);
		if (!target) return;

		// Free process node: clear every input (and its paired producer column).
		if (target.type === 'process' && target.processObj) {
			for (const c of _procInputIds(target.processObj)) _removeProcInput(target.processObj, c);
			return;
		}

		if (target.type === 'tableprocess' && target.tpObj) {
			const tp = target.tpObj;
			if (!portName?.endsWith('IN')) return;
			tp.args[portName] = isManyInputPort(target, portName) ? [] : -1;
			return;
		}

		if (target.type === 'plot' && target.plotObj?.type === 'tableplot' && portName === 'series') {
			recordPlotEdit(target.plotObj, () => {
				target.plotObj.plot.columnRefs = [];
			});
			return;
		}

		// Single-input non-x/y plots: clearing the `data` port drops every series.
		if (
			target.type === 'plot' &&
			target.plotObj &&
			target.plotObj.type !== 'tableplot' &&
			portName === 'data'
		) {
			recordPlotEdit(target.plotObj, () => {
				const plot = target.plotObj.plot;
				if (plot) plot.data = [];
			});
			return;
		}

		if (target.type === 'plot' && target.plotObj && target.plotObj.type !== 'tableplot') {
			recordPlotEdit(target.plotObj, () => {
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
					// Mutate in place; see the note at the connect path above.
					for (const dp of g.dataPoints) {
						if (dp?.x) dp.x.refId = -1;
					}
				} else {
					// Clear every series in the set. If the set's x is still wired, keep
					// one data point as an x-seed (y = -1) so the x survives; otherwise
					// drop them all.
					if ((g.xRefId ?? -1) >= 0 && g.dataPoints[0]?.y) {
						const [seed, ...rest] = g.dataPoints;
						seed.y.refId = -1;
						const drop = new Set(rest);
						plot.data = plot.data.filter((dp) => !drop.has(dp));
					} else {
						const toRemove = new Set(g.dataPoints);
						plot.data = plot.data.filter((dp) => !toRemove.has(dp));
					}
				}
			});
		}
	}

	function handlePortStart(e) {
		e.stopPropagation();
		pendingConnection = { fromNodeId: e.detail.nodeId, fromPort: e.detail.port };
	}

	function pointerOutsideGroupRect(groupId, clientX, clientY) {
		const el = document.querySelector(`[data-group-id="${CSS.escape(groupId)}"]`);
		if (!el) return true;
		const r = el.getBoundingClientRect();
		return clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom;
	}

	function onExtractMove(e) {
		if (!extractGesture) return;
		// Small dead-zone so a stray click on the grip doesn't immediately
		// register as "outside" if the user happens to click near the card edge.
		const dx = e.clientX - extractGesture.startClientX;
		const dy = e.clientY - extractGesture.startClientY;
		const moved = Math.hypot(dx, dy) > 6;
		extractGesture.outside =
			moved && pointerOutsideGroupRect(extractGesture.groupId, e.clientX, e.clientY);
	}

	function onExtractUp(e) {
		window.removeEventListener('pointermove', onExtractMove);
		const g = extractGesture;
		extractGesture = null;
		if (!g) return;
		if (!g.outside) return;
		// Land the resurfaced data_X node at the drop pointer (top-left of card).
		const c = toCanvasCoords(e.clientX - NODE_WIDTH / 2, e.clientY - HEADER_H / 2);
		_spawnPositionQueue.push({ x: c.x, y: c.y });
		extractColumnFromAnyGroup(g.colId);
	}

	function handleExtractStart(e) {
		const { groupId, colId, clientX, clientY } = e.detail ?? {};
		if (groupId == null || colId == null) return;
		extractGesture = {
			groupId,
			colId,
			startClientX: clientX,
			startClientY: clientY,
			outside: false
		};
		window.addEventListener('pointermove', onExtractMove);
		window.addEventListener('pointerup', onExtractUp, { once: true });
	}

	// If the editor unmounts mid-gesture (view switch, session load) the pointerup
	// that normally detaches these window listeners never reaches us — detach here.
	$effect(() => {
		return () => {
			window.removeEventListener('pointermove', onExtractMove);
			window.removeEventListener('pointerup', onExtractUp);
		};
	});

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

	// The column(s) currently wired into an input port, and whether the port
	// accepts more than one (so the picker can pre-check them and allow
	// multi-select). Mirrors the per-type shapes used by connect/disconnect.
	function getInputPortSelection(nodeId, portName) {
		const target = allNodes.find((n) => n.id === nodeId);
		if (!target) return { many: false, ids: [] };

		if (target.type === 'process' && target.processObj) {
			return { many: true, ids: _procInputIds(target.processObj) };
		}
		if (target.type === 'tableprocess' && target.tpObj) {
			const raw = target.tpObj.args?.[portName];
			const ids = Array.isArray(raw)
				? raw.filter((n) => typeof n === 'number' && n >= 0)
				: typeof raw === 'number' && raw >= 0
					? [raw]
					: [];
			return { many: isManyInputPort(target, portName), ids };
		}
		if (target.type === 'plot' && target.plotObj?.type === 'tableplot' && portName === 'series') {
			return { many: true, ids: (target.plotObj.plot.columnRefs ?? []).filter((n) => n >= 0) };
		}
		if (target.type === 'plot' && target.plotObj && target.plotObj.type !== 'tableplot') {
			const plot = target.plotObj.plot;
			if (portName === 'data') {
				const field = (appConsts.plotMap.get(target.plotObj.type)?.defaultInputs ?? [])[0];
				const ids = (plot?.data ?? [])
					.map((dp) => dp?.[field]?.refId)
					.filter((n) => typeof n === 'number' && n >= 0);
				return { many: true, ids };
			}
			const setMatch = portName?.match(/^x(\d+)$/) ?? portName?.match(/^ys(\d+)$/);
			if (setMatch) {
				const groups = groupPlotData(plot?.data ?? []);
				const g = groups[Number(setMatch[1]) - 1];
				// x is a single shared column for the set; y* holds one-or-more series.
				if (portName.startsWith('x')) {
					return { many: false, ids: g && (g.xRefId ?? -1) >= 0 ? [g.xRefId] : [] };
				}
				const yids = g
					? g.dataPoints.map((dp) => dp?.y?.refId).filter((n) => typeof n === 'number' && n >= 0)
					: [];
				return { many: true, ids: yids };
			}
		}
		return { many: false, ids: [] };
	}

	// Remove a single source column from a multi-input port (per node type).
	function removeInputColumn(target, portName, colId) {
		if (!target) return;
		if (target.type === 'process' && target.processObj) {
			_removeProcInput(target.processObj, colId);
			return;
		}
		if (target.type === 'tableprocess' && target.tpObj) {
			const raw = target.tpObj.args?.[portName];
			if (Array.isArray(raw)) target.tpObj.args[portName] = raw.filter((id) => id !== colId);
			else if (raw === colId) target.tpObj.args[portName] = -1;
			return;
		}
		if (target.type === 'plot' && target.plotObj?.type === 'tableplot' && portName === 'series') {
			const refs = target.plotObj.plot.columnRefs ?? [];
			target.plotObj.plot.columnRefs = refs.filter((id) => id !== colId);
			return;
		}
		if (target.type === 'plot' && target.plotObj && portName === 'data') {
			const plot = target.plotObj.plot;
			const field = (appConsts.plotMap.get(target.plotObj.type)?.defaultInputs ?? [])[0];
			if (plot?.data) plot.data = plot.data.filter((dp) => dp?.[field]?.refId !== colId);
			return;
		}
		// Per-series removal from a plot set's y* port: drop the data point carrying
		// this y column. If it is the set's last series and the x is still wired,
		// keep it as an x-seed (y = -1) so the set/x survives (mirrors disconnect).
		const ysMatch = portName?.match(/^ys(\d+)$/);
		if (target.type === 'plot' && target.plotObj && target.plotObj.type !== 'tableplot' && ysMatch) {
			const plot = target.plotObj.plot;
			const groups = groupPlotData(plot?.data ?? []);
			const g = groups[Number(ysMatch[1]) - 1];
			if (!g) return;
			const dp = g.dataPoints.find((d) => d?.y?.refId === colId);
			if (!dp) return;
			const ysInSet = g.dataPoints.filter((d) => (d?.y?.refId ?? -1) >= 0);
			if (ysInSet.length <= 1 && (g.xRefId ?? -1) >= 0) {
				if (dp.y) dp.y.refId = -1;
			} else {
				plot.data = plot.data.filter((d) => d !== dp);
			}
		}
	}

	// Replace a multi-input port's columns with exactly `nextIds` (diff → add the
	// new ones via the shared connect path, remove the dropped ones per-type).
	function setInputPortColumns(target, portName, nextIds) {
		const cur = getInputPortSelection(target.id, portName).ids;
		const next = nextIds.filter((n) => typeof n === 'number' && n >= 0);
		for (const id of next) if (!cur.includes(id)) connectColumnToInput(id, target.id, portName);
		for (const id of cur) if (!next.includes(id)) removeInputColumn(target, portName, id);
	}

	// Right-click an input port: open a column picker anchored at the cursor,
	// pre-selecting the currently-wired column(s). Multi-input ports get a
	// multi-select list; single-input ports pick one and close.
	function handlePortPick(e) {
		e.stopPropagation();
		if (pendingConnection) pendingConnection = null;
		const sel = getInputPortSelection(e.detail.nodeId, e.detail.port);
		portPicker = {
			nodeId: e.detail.nodeId,
			port: e.detail.port,
			x: e.detail.x,
			y: e.detail.y,
			many: sel.many
		};
		portPickerValue = sel.many ? [...sel.ids] : (sel.ids[0] ?? -1);
		portPickerOpen = true;
	}

	// The picker's selection changed. Multi ports stay open so several columns can
	// be toggled; single ports wire the choice and close.
	function handlePortPickChoice(val) {
		if (!portPicker) return;
		const target = allNodes.find((n) => n.id === portPicker.nodeId);
		if (portPicker.many) {
			const arr = Array.isArray(val) ? val : typeof val === 'number' && val >= 0 ? [val] : [];
			if (target) setInputPortColumns(target, portPicker.port, arr);
			return; // keep the popover open for more toggles
		}
		if (typeof val === 'number' && val >= 0) {
			connectColumnToInput(val, portPicker.nodeId, portPicker.port);
		}
		portPickerOpen = false;
		portPicker = null;
	}

	function handleNodeWrapperMouseUp(e, node) {
		if (dragInfo && !dragInfo.moved) {
			// Short press with no movement → treat as a click. Pass the event
			// so handleNodeAction can read alt/meta/ctrl/shift for additive
			// multi-select.
			handleNodeAction(node, e);
		}
		// Don't clear dragInfo here — stopAll (which always fires) handles the drop and cleanup
	}

	/**
	 * After a data node finishes a drag, if it landed inside a Group's bbox,
	 * absorb its column into that group as a Source row. The standalone
	 * `data_${colId}` canvas node disappears on the next derive (suppressed in
	 * ProcessNode.svelte.js) and reappears as a row inside the group card.
	 * Non-data nodes are ignored — Source groups only accept columns.
	 */
	function reconcileGroupMembership(nodeId) {
		const draggedNode = allNodes.find((n) => n.id === nodeId);
		if (!draggedNode) return;
		const pos = stablePositions[nodeId] ?? defaultPositions.positions[nodeId];
		if (!pos) return;
		const ax1 = pos.x;
		const ay1 = pos.y;
		const ax2 = pos.x + NODE_WIDTH;
		const ay2 = pos.y + NODE_HEIGHT;
		let landedGroup = null;
		for (const g of core.groups) {
			const gpos = stablePositions[g.id] ?? { x: g.x, y: g.y };
			const bx1 = gpos.x;
			const by1 = gpos.y;
			const bx2 = gpos.x + g.width;
			const by2 = gpos.y + g.height;
			if (ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1) {
				landedGroup = g;
				break;
			}
		}
		if (!landedGroup) return;
		// Only standalone column (data) nodes are absorbed into a group. A source /
		// analysis node (process / tableprocess) owns its output columns, so it can't
		// be dropped in — surface a toast so the user understands what groups accept.
		if (draggedNode.type === 'data') {
			const colId = draggedNode.refId;
			if (typeof colId === 'number') absorbColumnIntoGroup(colId, landedGroup.id);
		} else if (draggedNode.type === 'process' || draggedNode.type === 'tableprocess') {
			addNotification(
				'Groups hold individual data columns — a source or analysis node can’t be dropped into one.',
				'info'
			);
		}
	}

	// Window-level marquee tracking (added on drag-start in handleCanvasMouseDown).
	function onMarqueeMove(e) {
		if (!marquee) return;
		const { x, y } = toCanvasCoords(e.clientX, e.clientY);
		marquee.curX = x;
		marquee.curY = y;
		updateMarqueeSelection();
	}
	function onMarqueeUp() {
		removeMarqueeListeners();
		finishMarquee();
	}
	function removeMarqueeListeners() {
		window.removeEventListener('mousemove', onMarqueeMove);
		window.removeEventListener('mouseup', onMarqueeUp);
	}
	// Drop any dangling marquee listeners if the canvas unmounts mid-drag.
	$effect(() => removeMarqueeListeners);

	// Recompute the marquee selection = base ∪ (every node whose box intersects the
	// rubber-band). Called live on each move and once more on release.
	function updateMarqueeSelection() {
		const rect = marqueeRect;
		if (!marquee || !rect) return;
		const next = new Set(marquee.base);
		for (const node of allNodes) {
			const pos = stablePositions[node.id] ?? defaultPositions.positions[node.id];
			if (!pos) continue;
			const nodeBox = {
				x: pos.x,
				y: pos.y,
				w: getNodeWidth(node),
				h: getNodeRenderHeight(node)
			};
			if (rectsIntersect(rect, nodeBox)) next.add(node.id);
		}
		multiSelectedNodeIds = next;
	}

	// Finalise an in-progress Alt-drag marquee. Selection is already live from the
	// moves; here we just pick a focused/primary node and suppress the trailing
	// background click so it doesn't wipe the selection. A zero-drag alt-click that
	// selected nothing falls through to the normal deselect.
	function finishMarquee() {
		if (!marquee) return;
		updateMarqueeSelection();
		const selected = multiSelectedNodeIds;
		marquee = null;
		if (selected.size === 0) return;
		suppressBackgroundClick = true;
		const primary = Array.from(selected)[selected.size - 1];
		appState.canvasSelectedNodeId = primary;
		selectedEdgeKey = null;
	}

	function stopAll() {
		// Marquee is driven by its own window-level listeners (onMarqueeUp), not by
		// this canvas mouseup — a release over a node/panel never reaches here.
		// Splice-on-port takes priority over splice-on-edge — it expresses a
		// more specific intent ("between this source and ALL its consumers").
		if (dragInfo?.moved && dropTargetPortKey) {
			const draggedNode = allNodes.find((n) => n.id === dragInfo.nodeId);
			const [portNodeId, portName] = dropTargetPortKey.split('|');
			if (draggedNode && portNodeId && portName) {
				if (dropTargetPortDir === 'in') {
					spliceNodeOntoTargetInput(draggedNode, portNodeId, portName);
				} else {
					spliceNodeOntoSourceOutput(draggedNode, portNodeId, portName);
				}
			}
		} else if (dragInfo?.moved && dropTargetEdgeKey) {
			// Splice-on-edge: dropped onto a wire (edge bbox-overlap).
			const draggedNode = allNodes.find((n) => n.id === dragInfo.nodeId);
			const targetEdge = edgeTopology.find((edge) => edgeKeyFor(edge) === dropTargetEdgeKey);
			if (draggedNode && targetEdge) spliceNodeOntoEdge(draggedNode, targetEdge);
		}
		// Group-membership reconciliation runs AFTER the splice check so a
		// node that just spliced onto a wire can still wind up inside a group.
		if (dragInfo?.moved && dragInfo.nodeId) {
			reconcileGroupMembership(dragInfo.nodeId);
			reconcileCompositeMembership(dragInfo.nodeId);
		}
		// Commit a plot preview resize (model width/height) as one undo step:
		// capture the end size, revert to the start size, then replay through the op
		// so the reverse is recorded. Notes resize their own model directly and are
		// out of the plot history scope.
		if (resizeInfo?.plotObj) {
			const p = resizeInfo.plotObj;
			if (p.width !== resizeInfo.startPlotW || p.height !== resizeInfo.startPlotH) {
				const endW = p.width;
				const endH = p.height;
				p.width = resizeInfo.startPlotW;
				p.height = resizeInfo.startPlotH;
				mutationService.setPlotPosition(p.id, { width: endW, height: endH });
			}
		}
		dropTargetEdgeKey = null;
		dropTargetPortKey = null;
		dropTargetPortDir = null;
		dragHoverGroupId = null;
		dragInfo = null;
		resizeInfo = null;
		isPanning = false;
		stopEdgePan();
	}

	/**
	 * Splice a 1-in/1-out node into a wire. For AnCiR's column-process model the
	 * actual operation is "move the process to the source column's chain", since
	 * processes are bound to their parent column and the graph connections are
	 * derived from column ordering rather than stored as discrete edges.
	 */
	// --- Dataflow splice helpers (a free process node stays free; we set its
	// input column(s) and create paired producer columns, then reroute the
	// relevant consumers to read through the node). ---
	function _procInputIds(proc) {
		const raw = proc?.args?.inIN;
		if (Array.isArray(raw)) return raw.filter((id) => typeof id === 'number' && id >= 0);
		return typeof raw === 'number' && raw >= 0 ? [raw] : [];
	}
	function _addProcInput(proc, inputColId) {
		const cur = _procInputIds(proc);
		if (!cur.includes(inputColId)) proc.args = { ...proc.args, inIN: [...cur, inputColId] };
	}
	// Remove input column c from a free process + delete its paired producer column.
	// Mirrors the connect path (setOrphanProcessArg + addColumn), so the removal is
	// recorded on history as ONE undoable step. Orphan-process arg writes aren't
	// seen by the paramDiffWatcher (it only watches column / table-process args),
	// so a bare `proc.args = …` here would be invisible to undo — route it through
	// the op layer instead. Falls back to a direct write for a non-orphan process.
	function _removeProcInput(proc, c) {
		if (!proc) return;
		const newInIN = _procInputIds(proc).filter((id) => id !== c);
		const pc = core.data.find(
			(col) =>
				col.producerNodeId === `process_${proc.id}` && (col.producerPort || '') === `out_${c}`
		);
		const isOrphan = (core.orphanProcesses ?? []).some((p) => p.id === proc.id);
		if (isOrphan) {
			const ops = [{ kind: 'setOrphanProcessArg', processId: proc.id, key: 'inIN', value: newInIN }];
			if (pc) ops.push({ kind: 'removeColumn', id: pc.id });
			mutationService.atomicBatch(ops);
		} else {
			proc.args = { ...proc.args, inIN: newInIN };
			if (pc) removeColumn(pc.id);
		}
	}
	function _ensureProducerColumn(proc, inputColId) {
		const procNodeId = `process_${proc.id}`;
		const port = `out_${inputColId}`;
		let D = core.data.find(
			(c) => c.producerNodeId === procNodeId && (c.producerPort || '') === port
		);
		if (!D) {
			D = new Column({
				type: getColumnById(inputColId)?.type ?? 'number',
				producerNodeId: procNodeId,
				producerPort: port,
				producerArtifactKind: 'column'
			});
			pushObj(D);
		}
		return D;
	}
	// Reroute a downstream process node's input from oldColId → newColId, and
	// re-key its paired producer column (out_old → out_new) so its output stays.
	function _rerouteProcessInput(targetNodeId, oldColId, newColId) {
		const pid = Number(targetNodeId.slice('process_'.length));
		const tproc = (core.orphanProcesses ?? []).find((p) => p.id === pid);
		if (!tproc) return;
		const cur = _procInputIds(tproc);
		const idx = cur.indexOf(oldColId);
		if (idx < 0) return;
		const next = [...cur];
		next[idx] = newColId;
		tproc.args = { ...tproc.args, inIN: next };
		const pc = core.data.find(
			(c) => c.producerNodeId === targetNodeId && (c.producerPort || '') === `out_${oldColId}`
		);
		if (pc) pc.producerPort = `out_${newColId}`;
	}

	// Dataflow splice onto ONE edge: insert the dragged node between the edge's
	// source column and JUST this edge's consumer (other consumers untouched).
	function spliceNodeOntoEdge(draggedNode, edge) {
		if (draggedNode.type !== 'process' || !draggedNode.processObj) return;
		const proc = draggedNode.processObj;
		const sourceColId = resolveOutputColumnId(edge.fromId, edge.fromPort);
		if (sourceColId == null || sourceColId < 0) return;
		_addProcInput(proc, sourceColId);
		const D = _ensureProducerColumn(proc, sourceColId);
		if (
			typeof edge.toId === 'string' &&
			edge.toId.startsWith('process_') &&
			edge.toId !== draggedNode.id
		) {
			_rerouteProcessInput(edge.toId, sourceColId, D.id);
		} else {
			rerouteEdgeConsumer(edge, sourceColId, D.id);
		}
	}

	/**
	 * Swap a single column reference on the edge's consumer (TP arg / plot
	 * data point) from oldColId → newColId, scoped to the specific edge's
	 * port. Other consumers of oldColId — and other refs on the same node
	 * but different ports — are untouched.
	 */
	function rerouteEdgeConsumer(edge, oldColId, newColId) {
		const target = allNodes.find((n) => n.id === edge.toId);
		if (!target) return;

		if (target.type === 'tableprocess' && target.tpObj) {
			const tp = target.tpObj;
			const port = edge.toPort;
			if (!port?.endsWith('IN')) return;
			if (isManyInputPort(target, port)) {
				const arr = Array.isArray(tp.args[port]) ? tp.args[port] : [];
				const idx = arr.indexOf(oldColId);
				if (idx < 0) return;
				const next = [...arr];
				next[idx] = newColId;
				tp.args[port] = next;
			} else if (tp.args[port] === oldColId) {
				tp.args[port] = newColId;
			}
			return;
		}

		if (
			target.type === 'plot' &&
			target.plotObj?.type === 'tableplot' &&
			edge.toPort === 'series'
		) {
			const refs = target.plotObj.plot.columnRefs ?? [];
			const idx = refs.indexOf(oldColId);
			if (idx < 0) return;
			const next = [...refs];
			next[idx] = newColId;
			target.plotObj.plot.columnRefs = next;
			return;
		}

		// Single-input non-x/y plots: swap the column ref on the matching series.
		if (
			target.type === 'plot' &&
			target.plotObj &&
			target.plotObj.type !== 'tableplot' &&
			edge.toPort === 'data'
		) {
			const plot = target.plotObj.plot;
			const defaultInputs = appConsts.plotMap.get(target.plotObj.type)?.defaultInputs ?? [];
			if (!plot?.data || defaultInputs.length !== 1) return;
			const field = defaultInputs[0];
			for (const dp of plot.data) {
				if (dp?.[field]?.refId === oldColId) {
					dp[field].refId = newColId;
					return;
				}
			}
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
				// Update every data point in this set whose x matches the edge.
				for (const dp of g.dataPoints) {
					if (dp?.x && dp.x.refId === oldColId) dp.x.refId = newColId;
				}
			} else {
				// ys: re-route every data point in this set whose y matches.
				for (const dp of g.dataPoints) {
					if (dp?.y && dp.y.refId === oldColId) dp.y.refId = newColId;
				}
			}
		}
	}

	/**
	 * Drop the dragged node onto a source's OUTPUT port: insert it between that
	 * source column and EVERY consumer of the port (tweak #4). The node reads the
	 * source column and produces a paired output column; all the port's consumers
	 * — ref-based (plots / table-processes / ref columns) AND downstream process
	 * nodes — are rerouted to read through the node. The dragged node stays a free
	 * (orphan) process; nothing moves into a column.
	 */
	function spliceNodeOntoSourceOutput(draggedNode, sourceNodeId, sourcePort) {
		if (draggedNode.type !== 'process' || !draggedNode.processObj) return;
		const proc = draggedNode.processObj;
		const colId = resolveOutputColumnId(sourceNodeId, sourcePort);
		if (colId == null || colId < 0) return;

		_addProcInput(proc, colId);
		const D = _ensureProducerColumn(proc, colId);
		// Reroute ref-based consumers (plots, table-process args, ref columns) of
		// colId → D. The node's own inIN is orphan-process args, untouched, so no
		// cycle.
		replaceColumnRefs(D.id, colId);
		// Reroute downstream process-node consumers (inIN) of colId → D too, so the
		// node truly sits on every edge leaving the port. Skip the dragged node.
		for (const op of [...(core.orphanProcesses ?? [])]) {
			if (op.id === proc.id) continue;
			if (_procInputIds(op).includes(colId)) {
				_rerouteProcessInput(`process_${op.id}`, colId, D.id);
			}
		}
	}

	/**
	 * Drop the dragged node onto a target's INPUT port: insert it between EVERY
	 * source feeding that port and the target (tweak #4, the "enter the node"
	 * case). For each incoming edge at the port, route its source column through
	 * the node and re-point the target's reference to the node's output.
	 */
	function spliceNodeOntoTargetInput(draggedNode, targetNodeId, targetPort) {
		if (draggedNode.type !== 'process' || !draggedNode.processObj) return;
		const proc = draggedNode.processObj;
		const isProcTarget = typeof targetNodeId === 'string' && targetNodeId.startsWith('process_');
		const edges = (edgeTopology ?? []).filter(
			(e) => e.toId === targetNodeId && e.toPort === targetPort && e.fromId !== draggedNode.id
		);
		for (const edge of edges) {
			const c = resolveOutputColumnId(edge.fromId, edge.fromPort);
			if (c == null || c < 0) continue;
			_addProcInput(proc, c);
			const D = _ensureProducerColumn(proc, c);
			if (isProcTarget) {
				_rerouteProcessInput(targetNodeId, c, D.id);
			} else {
				rerouteEdgeConsumer(edge, c, D.id);
			}
		}
	}

	function handleNodeAction(node, e = null) {
		const additive = !!(e && (e.altKey || e.metaKey || e.ctrlKey || e.shiftKey));

		// Selecting a node clears any edge selection regardless of mode.
		selectedEdgeKey = null;

		if (additive) {
			// Additive: toggle this node in the multi-select set without
			// touching focus on the others. The focused id moves to whichever
			// node was just acted on so the ControlPanel reflects it.
			toggleMultiSelect(node.id);
			appState.canvasSelectedNodeId = node.id;
		} else {
			// Plain click: replace selection with just this node. We do NOT
			// toggle off on a second click on the same node — that interferes
			// with double-click expansion (the second click would deselect
			// before dblclick fires, leaving an expanded-but-unselected node).
			// To deselect, click the background or press Escape.
			appState.canvasSelectedNodeId = node.id;
			multiSelectedNodeIds = new Set([node.id]);
		}

		// Inline expansion is now decoupled from selection — toggle it only on
		// double-click (see handleNodeDblClick). Single-click never expands.

		if (node.type === 'plot') {
			// Synthesise a minimal event-like object for selectPlot (needs altKey)
			selectPlot({ altKey: additive }, node.refId);
		} else if (node.type === 'data' && !additive) {
			appState.currentTab = 'data';
			appState.showDisplayPanel = true;
		}
	}

	/** Double-click opens the side Control Panel for the node (consistent with the
	 *  worksheet's double-click behaviour). Single-click only selects; the in-node
	 *  inline editor is toggled separately by the header arrow. */
	function handleNodeDblClick(node) {
		appState.canvasSelectedNodeId = node.id;
		multiSelectedNodeIds = new Set([node.id]);
		appState.showControlPanel = true;
	}

	/** Toggle a node between Compact (square) and Detailed (full view: table /
	 *  editor / group rows). Driven by the hover toggle button on the card.
	 *  Groups persist this on their own `collapsed` flag; other squared kinds use
	 *  collapsedNodeIds (default expanded), persisted via core.nodeLayout. */
	function handleNodeToggleExpand(node) {
		if (node.type === 'group') {
			if (node.groupObj) node.groupObj.collapsed = !node.groupObj.collapsed;
			return;
		}
		if (node.type === 'composite') {
			if (node.compositeObj) node.compositeObj.collapsed = !node.compositeObj.collapsed;
			return;
		}
		if (!SQUARED_KINDS.has(node.type)) return;
		const next = new Set(collapsedNodeIds);
		if (next.has(node.id))
			next.delete(node.id); // currently collapsed → expand
		else next.add(node.id); // currently expanded → collapse
		collapsedNodeIds = next;
	}

	function toggleMultiSelect(id) {
		const next = new Set(multiSelectedNodeIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		multiSelectedNodeIds = next;
	}

	function handleBackgroundClick() {
		// A marquee drag ends with a background click; don't let it wipe the
		// selection the marquee just made.
		if (suppressBackgroundClick) {
			suppressBackgroundClick = false;
			return;
		}
		deselectAllPlots();
		appState.canvasSelectedNodeId = null;
		multiSelectedNodeIds = new Set();
		selectedEdgeKey = null;
		pendingConnection = null;
	}

	function clearSelection() {
		deselectAllPlots();
		// Note: collapse state is intentionally NOT reset here — it's a persistent,
		// per-node property now (saved with the session), not tied to selection.
		appState.canvasSelectedNodeId = null;
		multiSelectedNodeIds = new Set();
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
		if (!target) return;

		// Edge into a free process node's input: drop just that one input column
		// (and its paired producer column). The process stays free.
		if (target.type === 'process' && target.processObj) {
			const c = resolveOutputColumnId(edge.fromId, edge.fromPort);
			if (c != null && c >= 0) _removeProcInput(target.processObj, c);
			return;
		}

		const colId = resolveOutputColumnId(edge.fromId, edge.fromPort);
		if (colId == null || colId < 0) return;

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

		if (
			target.type === 'plot' &&
			target.plotObj?.type === 'tableplot' &&
			edge.toPort === 'series'
		) {
			target.plotObj.plot.columnRefs = (target.plotObj.plot.columnRefs ?? []).filter(
				(id) => id !== colId
			);
			return;
		}

		// Single-input non-x/y plots: removing one wire on `data` drops the
		// matching series (the datum whose input column refs this colId).
		if (
			target.type === 'plot' &&
			target.plotObj &&
			target.plotObj.type !== 'tableplot' &&
			edge.toPort === 'data'
		) {
			const plot = target.plotObj.plot;
			const defaultInputs = appConsts.plotMap.get(target.plotObj.type)?.defaultInputs ?? [];
			if (!plot?.data || defaultInputs.length !== 1) return;
			const field = defaultInputs[0];
			const idx = plot.data.findIndex((dp) => dp?.[field]?.refId === colId);
			if (idx < 0) return;
			plot.data = plot.data.filter((_, i) => i !== idx);
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
				// them under xRefId = -1). Mutate in place to preserve the
				// ColumnClass prototype (see connect path).
				if (g.xRefId === colId) {
					for (const dp of g.dataPoints) {
						if (dp?.x) dp.x.refId = -1;
					}
				}
				return;
			}

			// ysMatch: drop the data point whose y matches. If it's the last y
			// sharing this set's x, keep the data point as an x-seed (y = -1) so the
			// set's x wire survives and a re-added y re-uses the slot; otherwise
			// remove the data point outright.
			const idx = g.dataPoints.findIndex((dp) => dp?.y?.refId === colId);
			if (idx < 0) return;
			const removedDp = g.dataPoints[idx];
			const otherValidY = g.dataPoints.some((dp) => dp !== removedDp && (dp?.y?.refId ?? -1) >= 0);
			if (!otherValidY && (g.xRefId ?? -1) >= 0 && removedDp.y) {
				removedDp.y.refId = -1;
			} else {
				plot.data = plot.data.filter((dp) => dp !== removedDp);
			}
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
			if (parent) {
				mutationService.removeProcess(parent.id, node.refId);
			} else if (core.orphanProcesses.some((p) => p.id === node.refId)) {
				// Free process: bridge + remove (shared with the Data panel's delete).
				deleteOperationNode(node);
			}
			return;
		}
		if (node.type === 'tableprocess' && node.tpObj) {
			deleteOperationNode(node);
			return;
		}
		if (node.type === 'plot' && node.refId != null) {
			mutationService.removePlot(node.refId);
			return;
		}
		if (node.type === 'note' && node.refId != null) {
			removeNote(node.refId);
			return;
		}
		if (node.type === 'group' && node.refId != null) {
			removeGroup(node.refId);
		}
	}

	// Per-node delete button (canvas). Shows the shared "Are you sure?" modal, then
	// removes via the same removeNode() the Delete key uses. Mirrors the worksheet's
	// delete-plot button (which also confirms before removing).
	function confirmDeleteNode(node) {
		if (!node) return;
		const name = node.label?.trim() || 'this node';
		appState.AYStext = `Are you sure you want to remove ${name}?`;
		appState.AYSoptions = ['Yes', 'No'];
		appState.AYScallback = (option) => {
			if (option !== 'Yes') return;
			removeNode(node);
			if (appState.canvasSelectedNodeId === node.id) appState.canvasSelectedNodeId = null;
			if (multiSelectedNodeIds.has(node.id)) {
				const next = new Set(multiSelectedNodeIds);
				next.delete(node.id);
				multiSelectedNodeIds = next;
			}
		};
		appState.showAYSModal = true;
	}

	function deleteSelection() {
		if (selectedEdgeKey) {
			const edge = edgeTopology.find((e) => edgeKeyFor(e) === selectedEdgeKey);
			if (edge) removeEdge(edge);
			selectedEdgeKey = null;
			return;
		}
		const targets =
			multiSelectedNodeIds.size > 1
				? Array.from(multiSelectedNodeIds)
				: appState.canvasSelectedNodeId
					? [appState.canvasSelectedNodeId]
					: [];
		if (targets.length === 0) return;
		for (const id of targets) {
			const node = allNodes.find((n) => n.id === id);
			if (node) removeNode(node);
		}
		appState.canvasSelectedNodeId = null;
		multiSelectedNodeIds = new Set();
		// Deleted nodes auto-prune from collapsedNodeIds via the effect above;
		// surviving nodes keep their collapse state.
	}

	// --- Clipboard for copy/paste ---
	// Each entry: { type, payload } where payload is whatever the corresponding
	// paste branch needs to recreate the node. Module-scoped (per workflow
	// instance) so it survives ControlPanel re-renders.
	let _clipboard = [];

	// Dev-only diagnostic. Vite statically replaces import.meta.env.DEV with
	// `false` in production builds, so this whole helper is dropped from the
	// shipped bundle. Use for copy/paste/keydown tracing.
	const DEV = !!import.meta.env?.DEV;
	function _dbg(...args) {
		if (DEV) console.log('[canvas]', ...args);
	}

	function isEditableTarget(target) {
		if (!target) return false;
		const tag = target?.tagName;
		return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable;
	}

	/** Wipe every user-drawable column-ref input from a TP args object so the
	 *  pasted node lands without any of its previous incoming wires. Also
	 *  resets args.out values to -1 so the TP constructor allocates fresh
	 *  output columns (otherwise the new TP would alias the original's
	 *  output column ids — instant collision). */
	function clearTPInputsAndOutputs(args, nodeSpec) {
		const out = { ...(args ?? {}) };
		for (const inp of nodeSpec?.inputs ?? []) {
			if (!inp?.name) continue;
			out[inp.name] = inp.cardinality === 'many' ? [] : -1;
		}
		// Defensive fallback: any remaining key ending in 'IN' is also an
		// input port (matches the existing disconnectInputPort heuristic).
		for (const key of Object.keys(out)) {
			if (key.endsWith('IN')) {
				out[key] = Array.isArray(out[key]) ? [] : -1;
			}
		}
		if (out.out && typeof out.out === 'object') {
			const freshOut = {};
			for (const key of Object.keys(out.out)) freshOut[key] = -1;
			out.out = freshOut;
		}
		return out;
	}

	/** Strip every incoming column-ref from a cloned plot payload so the
	 *  pasted plot lands with no wires. For non-tableplot plots we drop the
	 *  data array entirely (each entry is a wire pair); tableplots clear
	 *  columnRefs. */
	function clearPlotInputs(plotData) {
		if (!plotData) return plotData;
		const out = { ...plotData };
		if (out.type === 'tableplot') {
			out.plot = { ...(out.plot ?? {}), columnRefs: [] };
		} else {
			out.plot = { ...(out.plot ?? {}), data: [] };
		}
		return out;
	}

	/** Safely deep-clone Svelte $state-backed values via JSON, dropping any
	 *  functions. structuredClone can throw on $state proxies in some Svelte 5
	 *  versions, which would silently abort copy and leave the clipboard
	 *  empty. JSON cloning matches what operations.js uses internally. */
	function jsonClone(value) {
		try {
			return JSON.parse(
				JSON.stringify(value ?? null, (_k, v) => (typeof v === 'function' ? undefined : v))
			);
		} catch (err) {
			console.warn('[canvas copy] failed to clone value:', err);
			return null;
		}
	}

	/** Build a clipboard entry from one canvas node. Returns null when the
	 *  node type can't be sensibly copied (e.g. TP-output data columns). */
	function snapshotNode(node) {
		const pos = stablePositions[node.id] ?? defaultPositions.positions[node.id] ?? { x: 80, y: 80 };
		const base = { id: node.id, pos: { x: pos.x, y: pos.y } };
		if (node.type === 'process' && node.processObj) {
			// Snapshot only the process type + args. Pasting always spawns an
			// orphan (unconnected) so we don't need the original parent column
			// id; the user wires the pasted node to whichever column they like.
			return {
				...base,
				type: 'process',
				processType: node.processObj.name,
				args: jsonClone(node.processObj.args ?? {}) ?? {}
			};
		}
		if (node.type === 'tableprocess' && node.tpObj) {
			const cloned = jsonClone(node.tpObj.args ?? {}) ?? {};
			return {
				...base,
				type: 'tableprocess',
				tpType: node.tpObj.name ?? node.tpName,
				args: clearTPInputsAndOutputs(cloned, node.nodeSpec)
			};
		}
		if (node.type === 'plot' && node.plotObj) {
			const snapshot =
				typeof node.plotObj.toJSON === 'function' ? node.plotObj.toJSON() : { ...node.plotObj };
			const cloned = jsonClone(snapshot);
			if (!cloned) return null;
			delete cloned.id;
			delete cloned.selected;
			return { ...base, type: 'plot', plotData: clearPlotInputs(cloned) };
		}
		if (node.type === 'note' && node.noteObj) {
			return { ...base, type: 'note', text: node.noteObj.text ?? '' };
		}
		if (node.type === 'group' && node.groupObj) {
			return {
				...base,
				type: 'group',
				name: node.groupObj.name,
				width: node.groupObj.width,
				height: node.groupObj.height
			};
		}
		if (node.type === 'data' && node.refId != null) {
			// Skip TP-output columns — those are derived; copying them as
			// standalone columns would orphan the data from its producer.
			const col = core.data.find((c) => c.id === node.refId);
			if (!col || typeof col.toJSON !== 'function') return null;
			const isTPOutput = (core.tableProcesses ?? []).some((tp) =>
				Object.values(tp.args?.out ?? {}).some((cid) => cid === col.id)
			);
			if (isTPOutput) return null;
			const cloned = jsonClone(col.toJSON());
			if (!cloned) return null;
			delete cloned.id;
			// Strip processes so the cloned column starts as a plain data
			// carrier; the source column's processes carry stale ids that
			// would collide on import.
			cloned.processes = [];
			cloned.name = `${cloned.name ?? 'column'} copy`;
			return { ...base, type: 'data', columnData: cloned };
		}
		return null;
	}

	function copySelection() {
		const ids =
			multiSelectedNodeIds.size > 0
				? Array.from(multiSelectedNodeIds)
				: appState.canvasSelectedNodeId
					? [appState.canvasSelectedNodeId]
					: [];
		_dbg('copy: selection ids =', ids);
		if (ids.length === 0) {
			_dbg('copy: nothing selected — aborting');
			return;
		}
		const snapshots = [];
		const skipped = [];
		for (const id of ids) {
			const node = allNodes.find((n) => n.id === id);
			if (!node) {
				_dbg('copy: id not in allNodes —', id);
				continue;
			}
			const snap = snapshotNode(node);
			if (snap) {
				_dbg('copy: snapshot for', id, '→', snap);
				snapshots.push(snap);
			} else {
				_dbg('copy: snapshotNode returned null for', id, '(type:', node.type + ')');
				skipped.push(`${node.id} (${node.type})`);
			}
		}
		if (snapshots.length > 0) {
			_clipboard = snapshots;
			_dbg('copy: clipboard now holds', _clipboard.length, 'entries');
			if (skipped.length > 0) {
				console.warn('[canvas copy] some nodes skipped (not copyable):', skipped);
			}
		} else {
			console.warn(
				'[canvas copy] nothing copyable in selection (TP-output data columns are skipped)'
			);
		}
	}

	function pasteClipboard() {
		_dbg('paste: invoked. clipboard length =', _clipboard.length);
		if (!_clipboard.length) {
			console.warn('[canvas paste] clipboard is empty — nothing to paste');
			return;
		}
		const PASTE_OFFSET = 40;
		const newIds = new Set();
		for (const entry of _clipboard) {
			const newPos = {
				x: (entry.pos?.x ?? 80) + PASTE_OFFSET,
				y: (entry.pos?.y ?? 80) + PASTE_OFFSET
			};
			let newCanvasId = null;
			_dbg('paste: entry', entry.type, 'target pos', newPos, 'entry =', entry);
			try {
				if (entry.type === 'process') {
					// Spawn as orphan so the pasted process lands with no
					// chain edges. The user wires it to a column afterwards.
					const proc = createOrphanProcess(entry.processType, entry.args ?? {});
					_dbg('paste: createOrphanProcess →', proc?.id ?? null);
					if (proc) newCanvasId = `process_${proc.id}`;
				} else if (entry.type === 'tableprocess') {
					const tp = mutationService.addFreeTableProcess(entry.tpType, entry.args);
					_dbg('paste: addFreeTableProcess →', tp?.id ?? null);
					if (tp) newCanvasId = `tableprocess_${tp.id}`;
				} else if (entry.type === 'plot') {
					const seed = { ...entry.plotData, x: newPos.x, y: newPos.y };
					const plot = mutationService.addPlot(seed);
					_dbg('paste: addPlot →', plot?.id ?? null);
					if (plot) newCanvasId = `plot_${plot.id}`;
				} else if (entry.type === 'note') {
					const id = createNote({ x: newPos.x, y: newPos.y, text: entry.text });
					_dbg('paste: createNote →', id);
					newCanvasId = id;
				} else if (entry.type === 'group') {
					const id = createGroup({ x: newPos.x, y: newPos.y, name: `${entry.name} copy` });
					const g = core.groups.find((gg) => gg.id === id);
					if (g) {
						if (entry.width) g.width = entry.width;
						if (entry.height) g.height = entry.height;
					}
					_dbg('paste: createGroup →', id);
					newCanvasId = id;
				} else if (entry.type === 'data') {
					const col = mutationService.addColumn(entry.columnData);
					_dbg('paste: addColumn →', col?.id ?? null);
					if (col) newCanvasId = `data_${col.id}`;
				} else {
					_dbg('paste: unknown entry type', entry.type);
				}
			} catch (err) {
				console.warn('[canvas paste] entry failed:', entry?.type, err);
			}
			if (newCanvasId) {
				newIds.add(newCanvasId);
				// Pin the position synchronously so it doesn't depend on the
				// $effect that consumes _spawnPositionQueue. Belt-and-braces.
				stablePositions[newCanvasId] = { x: newPos.x, y: newPos.y };
				_dbg('paste: pinned position for', newCanvasId, '@', newPos);
			}
		}
		if (newIds.size === 0) {
			console.warn(
				'[canvas paste] nothing created. Clipboard entries:',
				_clipboard.map((e) => e.type)
			);
			return;
		}
		// Focus the newly pasted set so the user sees what landed.
		multiSelectedNodeIds = newIds;
		appState.canvasSelectedNodeId = newIds.values().next().value;
		_dbg('paste: done. created', newIds.size, 'nodes, focused', appState.canvasSelectedNodeId);
	}

	// --- Composite (combine / uncombine) ---
	const COMPOSABLE = (id) => id?.startsWith('process_') || id?.startsWith('tableprocess_');

	// Selection-shape info that drives the toolbar combine/uncombine buttons.
	const compositeSelection = $derived.by(() => {
		const sel = [...multiSelectedNodeIds];
		const ops = sel.filter(COMPOSABLE);
		const comps = sel.filter((id) => id?.startsWith('composite_'));
		return {
			// Combine when there are >=2 composable items total: >=2 ops (new
			// composite), 1 composite + ops (add to it), or >=2 composites
			// (nest into a parent). A lone composite (1 comp, 0 ops) can't combine.
			canCombine: ops.length + comps.length >= 2,
			canUncombine: comps.length >= 1 || !!appState.canvasSelectedNodeId?.startsWith('composite_')
		};
	});

	function combineSelection() {
		const sel = [...multiSelectedNodeIds];
		const ops = sel.filter(COMPOSABLE);
		const comps = sel.filter((id) => id?.startsWith('composite_'));
		// Add to an existing composite: exactly one composite + one or more ops.
		if (comps.length === 1 && ops.length >= 1) {
			addToComposite(comps[0], ops);
			return;
		}
		// New composite. Members may include other composites (→ nesting).
		const members = [...ops, ...comps];
		if (members.length < 2) {
			addNotification('Select at least two nodes (analyses or composites) to combine.');
			return;
		}
		// Interface is over the flattened LEAF operation nodes (nested composites
		// expanded). Persist leaf + child-composite positions before they hide.
		const leaves = flattenMembers(members, core.composites);
		persistPositions([...leaves, ...comps]);
		const iface = computeInterface(new Set(leaves), processGraph.rawConnections ?? []);
		const ps = members
			.map((id) => stablePositions[id] ?? defaultPositions.positions[id])
			.filter(Boolean);
		const cx = ps.length ? Math.round(ps.reduce((s, p) => s + p.x, 0) / ps.length) : 80;
		const cy = ps.length ? Math.round(ps.reduce((s, p) => s + p.y, 0) / ps.length) : 80;
		const cid = createComposite({
			memberIds: members,
			interface: iface,
			x: cx,
			y: cy,
			name: 'Composite'
		});
		stablePositions[cid] = { x: cx, y: cy };
		appState.canvasSelectedNodeId = cid;
		multiSelectedNodeIds = new Set([cid]);
	}

	// Add operation nodes to an existing composite and recompute its interface
	// from the true (un-rerouted) member edges. Only operation nodes can join.
	// Give each node an explicit stablePositions entry so it persists even while
	// hidden inside a composite (and can be dragged with it). Reads the live
	// rendered position from the DOM (offsetLeft/Top are canvas coords, since
	// wrappers are absolutely positioned within canvas-inner) — reliable while
	// the member is still visible at combine time, where defaultPositions can lag.
	function persistPositions(ids) {
		for (const id of ids) {
			if (stablePositions[id]) continue;
			const el = document.querySelector(`[data-node-id="${CSS.escape(id)}"]`);
			if (el) {
				stablePositions[id] = { x: el.offsetLeft, y: el.offsetTop };
			} else {
				const p = defaultPositions.positions[id];
				if (p) stablePositions[id] = { x: p.x, y: p.y };
			}
		}
	}

	function addToComposite(compositeId, opIds, { select = true } = {}) {
		const comp = core.composites.find((c) => c.id === compositeId);
		if (!comp) return;
		const toAdd = opIds.filter((id) => COMPOSABLE(id) && !comp.memberIds.includes(id));
		if (!toAdd.length) return;
		persistPositions(toAdd);
		comp.memberIds = [...comp.memberIds, ...toAdd];
		comp.interface = computeInterface(
			new Set(flattenMembers(comp.memberIds, core.composites)),
			processGraph.rawConnections ?? []
		);
		if (select) {
			appState.canvasSelectedNodeId = compositeId;
			multiSelectedNodeIds = new Set([compositeId]);
		}
	}

	// After an explicit splice, absorb the spliced operation node into a composite
	// IFF it is now fully internal to one composite (every neighbour is a member of
	// the same composite). Touching anything external / a 2nd composite → skip.
	function reconcileCompositeMembership(nodeId) {
		if (!COMPOSABLE(nodeId)) return;
		if (core.composites.some((c) => c.memberIds.includes(nodeId))) return;
		const conns = processGraph.rawConnections ?? [];
		const neighbours = new Set();
		for (const c of conns) {
			if (c.fromId === nodeId) neighbours.add(c.toId);
			else if (c.toId === nodeId) neighbours.add(c.fromId);
		}
		if (!neighbours.size) return;
		const memberToComp = new Map();
		for (const comp of core.composites)
			for (const m of comp.memberIds) memberToComp.set(m, comp.id);
		let target = null;
		for (const nb of neighbours) {
			const cid = memberToComp.get(nb);
			if (!cid) return; // external neighbour — not fully internal
			if (target && target !== cid) return; // bridges two composites
			target = cid;
		}
		if (target) addToComposite(target, [nodeId], { select: false });
	}

	function uncombineSelection() {
		const composites = [...multiSelectedNodeIds].filter((id) => id?.startsWith('composite_'));
		const target =
			composites[0] ?? (appState.canvasSelectedNodeId?.startsWith('composite_') ? appState.canvasSelectedNodeId : null);
		if (!target) {
			addNotification('Select a composite to uncombine.');
			return;
		}
		removeComposite(target);
		appState.canvasSelectedNodeId = null;
		multiSelectedNodeIds = new Set();
	}

	function handleKeyDown(e) {
		if (e.key === 'Escape') {
			// Cancel an in-progress marquee, restoring the selection it started from.
			if (marquee) {
				removeMarqueeListeners();
				multiSelectedNodeIds = new Set(marquee.base);
				marquee = null;
				return;
			}
			clearSelection();
			return;
		}
		const mod = e.metaKey || e.ctrlKey;
		// Cmd/Ctrl+G — combine selection; Cmd/Ctrl+Shift+G — uncombine.
		if (mod && (e.key === 'g' || e.key === 'G')) {
			if (isEditableTarget(e.target)) return;
			e.preventDefault();
			if (e.shiftKey) uncombineSelection();
			else combineSelection();
			return;
		}
		if (mod && (e.key === 'c' || e.key === 'C')) {
			_dbg('keydown: Cmd/Ctrl+C', {
				editable: isEditableTarget(e.target),
				focusedNodeId: appState.canvasSelectedNodeId,
				multiSize: multiSelectedNodeIds.size,
				target: e.target?.tagName
			});
			if (isEditableTarget(e.target)) return;
			if (appState.canvasSelectedNodeId || multiSelectedNodeIds.size > 0) {
				e.preventDefault();
				copySelection();
			} else {
				_dbg('keydown: Cmd/Ctrl+C ignored — no canvas selection');
			}
			return;
		}
		if (mod && (e.key === 'v' || e.key === 'V')) {
			_dbg('keydown: Cmd/Ctrl+V', {
				editable: isEditableTarget(e.target),
				clipboardLen: _clipboard.length,
				target: e.target?.tagName
			});
			if (isEditableTarget(e.target)) return;
			if (_clipboard.length > 0) {
				e.preventDefault();
				pasteClipboard();
			} else {
				_dbg('keydown: Cmd/Ctrl+V ignored — clipboard empty');
			}
			return;
		}
		if (e.key === 'Delete' || e.key === 'Backspace') {
			// Ignore if focus is in an editable text control inside an expanded node panel.
			if (isEditableTarget(e.target)) return;
			if (selectedEdgeKey || appState.canvasSelectedNodeId || multiSelectedNodeIds.size > 0) {
				e.preventDefault();
				deleteSelection();
			}
		}
	}

	// Expanded composites render as an auto-sized bordered frame behind their
	// member nodes (bounding box of the members + padding, with room for a title).
	const COMPOSITE_FRAME = { padX: 22, padTop: 30, padBottom: 22 };
	const expandedComposites = $derived.by(() => {
		const out = [];
		for (const comp of core.composites ?? []) {
			if (comp.collapsed) continue;
			let x0 = Infinity,
				y0 = Infinity,
				x1 = -Infinity,
				y1 = -Infinity;
			let found = 0;
			for (const mid of comp.memberIds ?? []) {
				const n = allNodes.find((nn) => nn.id === mid);
				const p = stablePositions[mid] ?? defaultPositions.positions[mid];
				if (!n || !p) continue;
				found++;
				const w = getNodeWidth(n);
				// Include the editor panel when a member node is individually expanded,
				// since it renders below the node body and getNodeRenderHeight omits it.
				const editorH =
					!collapsedNodeIds.has(n.id) && (n.type === 'process' || n.type === 'tableprocess')
						? EDITOR_PANEL_MAX_HEIGHT
						: 0;
				const h = getNodeRenderHeight(n) + editorH;
				x0 = Math.min(x0, p.x);
				y0 = Math.min(y0, p.y);
				x1 = Math.max(x1, p.x + w);
				y1 = Math.max(y1, p.y + h);
			}
			if (!found || !isFinite(x0)) continue;
			out.push({
				id: comp.id,
				name: comp.name,
				comp,
				x: x0 - COMPOSITE_FRAME.padX,
				y: y0 - COMPOSITE_FRAME.padTop,
				w: x1 - x0 + COMPOSITE_FRAME.padX * 2,
				h: y1 - y0 + COMPOSITE_FRAME.padTop + COMPOSITE_FRAME.padBottom
			});
		}
		return out;
	});

	const provisionalEdge = $derived.by(() => {
		if (!pendingConnection) return null;
		const fromNode = allNodes.find((n) => n.id === pendingConnection.fromNodeId);
		const fromPos =
			stablePositions[pendingConnection.fromNodeId] ??
			defaultPositions.positions[pendingConnection.fromNodeId];
		if (!fromNode || !fromPos) return null;
		return {
			from: {
				x: fromPos.x + getNodeWidth(fromNode),
				y: fromPos.y + getPortAnchorY(fromNode, pendingConnection.fromPort, 'out')
			},
			to: { x: mouseCanvas.x, y: mouseCanvas.y }
		};
	});
</script>

<!-- Window-level keydown so Cmd/Ctrl+C/V, Delete, Backspace, and Escape work
     without first clicking inside the canvas. handleKeyDown already guards
     against typing into inputs/textareas via isEditableTarget. -->
<svelte:window onkeydown={handleKeyDown} />

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
	use:canvasFileDrop={{ onActive: (v) => (fileDragOver = v), onDrop: handleCanvasFileDrop }}
	role="presentation"
	tabindex="-1"
>
	{#if !inline}
		<!-- Legacy fullscreen-modal mode keeps the close-X only. The "+ Plot" / "+ TP"
		     header buttons moved into NodePalette so canvas mode is chrome-free. -->
		<button
			class="close-btn legacy-only"
			onclick={() => (appState.showWorkflow = false)}
			aria-label="Close workflow"
			{@attach tooltip('Close workflow')}>✕</button
		>
	{/if}

	{#if multiSelectedNodeIds.size >= 2 || compositeSelection.canUncombine}
		<div class="selection-toolbar-host">
			<SelectionLayoutToolbar
				onAlign={alignSelectedNodes}
				onDistribute={distributeSelectedNodes}
				canDistribute={multiSelectedNodeIds.size >= 3}
				showAlign={multiSelectedNodeIds.size >= 2}
				onCombine={combineSelection}
				canCombine={compositeSelection.canCombine}
				onUncombine={uncombineSelection}
				canUncombine={compositeSelection.canUncombine}
			/>
		</div>
	{/if}

	<div class="canvas-viewport" bind:this={canvasViewportEl} class:panning={isPanning && !dragInfo}>
		<NodePalette
			queueSpawnPosition={queueSpawnPositionAtViewport}
			onSpawnColumnProcess={spawnColumnProcessFromPalette}
			onSpawnTableProcess={spawnTableProcessFromPalette}
			onSpawnPlot={spawnPlotFromPalette}
		/>
		<div
			class="canvas-inner"
			style="transform: translate({panX}px, {panY}px) scale({zoom}); transform-origin: 0 0; width: {canvasWidth}px; height: {canvasHeight}px; position: relative;"
		>
			{#if marqueeRect}
				<div
					class="marquee-rect"
					style="left:{marqueeRect.x}px; top:{marqueeRect.y}px; width:{marqueeRect.w}px; height:{marqueeRect.h}px; border-width:{1 /
						zoom}px;"
				></div>
			{/if}
			{#each expandedComposites as cc (cc.id)}
				<div
					class="composite-frame"
					style="left:{cc.x}px; top:{cc.y}px; width:{cc.w}px; height:{cc.h}px;"
				>
					<div
						class="composite-frame-title"
						role="presentation"
						onmousedown={(e) => handleNodeWrapperMouseDown(e, { id: cc.id, type: 'composite' })}
						onmouseup={(e) => handleNodeWrapperMouseUp(e, { id: cc.id, type: 'composite' })}
						ondblclick={(e) => {
							e.stopPropagation();
							handleNodeDblClick({ id: cc.id, type: 'composite', compositeObj: cc.comp });
						}}
					>
						<span class="composite-frame-name">{cc.name}</span>
						<button
							type="button"
							class="composite-frame-collapse"
							title="Collapse composite"
							onmousedown={(e) => e.stopPropagation()}
							onpointerdown={(e) => e.stopPropagation()}
							onclick={(e) => {
								e.stopPropagation();
								handleNodeToggleExpand({ type: 'composite', id: cc.id, compositeObj: cc.comp });
							}}
							{@attach tooltip('Collapse')}>⤡</button
						>
					</div>
				</div>
			{/each}

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
				{@const isExpanded = SQUARED_KINDS.has(node.type) && !collapsedNodeIds.has(node.id)}
				{@const compact = isCompact(node)}
				{@const isDragging = dragInfo?.nodeId === node.id && dragInfo?.moved}
				{@const isDimmed = connectedNodeIds !== null && !connectedNodeIds.has(node.id)}
				{@const isRecentlyChanged = changedNodeIds.has(node.id)}
				{@const isGroup = node.type === 'group'}
				{@const isMultiSelected = multiSelectedNodeIds.has(node.id)}
				{@const isSelected = appState.canvasSelectedNodeId === node.id || isMultiSelected}
				{@const nodeZIndex = isDragging ? 30 : isExpanded ? 20 : 1}
				{@const actionsRevealed = isSelected || actionsHoverId === node.id}
				{@const clusterNoteId = node.type !== 'group' && node.type !== 'composite' ? node.id : null}
				{@const clusterHasNote = !!(clusterNoteId && core.nodeNotes[clusterNoteId]?.trim())}
				<!-- Expanded composites render as the bordered frame backdrop above,
				     not as a node wrapper, so skip them here. -->
				{#if pos && !(node.type === 'composite' && !compact)}
					<div
						class="workflow-node-wrapper"
						class:dragging={isDragging}
						class:dimmed={isDimmed}
						class:changed={isRecentlyChanged}
						class:group-wrapper={isGroup}
						class:multi-selected={isMultiSelected && (multiSelectedNodeIds.size > 1 || !!marquee)}
						data-node-id={node.id}
						data-group-id={isGroup ? node.id : null}
						style="position: absolute; left: {pos.x}px; top: {pos.y}px; z-index: {nodeZIndex};"
						aria-label={node.label}
						onmousedown={(e) => handleNodeWrapperMouseDown(e, node)}
						onmouseup={(e) => handleNodeWrapperMouseUp(e, node)}
						onmouseenter={() => {
							hoveredNodeId = node.id;
							showNodeActions(node.id);
						}}
						onmouseleave={() => {
							if (hoveredNodeId === node.id) hoveredNodeId = null;
							hideNodeActionsSoon();
						}}
						ondblclick={(e) => {
							e.stopPropagation();
							handleNodeDblClick(node);
						}}
						onclick={(e) => e.stopPropagation()}
						role="presentation"
					>
						{#if compact}
							<CompactNode
								{node}
								selected={isSelected}
								spliceTargetPort={dropTargetPortKey?.startsWith(`${node.id}|`)
									? dropTargetPortKey.slice(node.id.length + 1)
									: null}
								on:portstart={handlePortStart}
								on:portend={handlePortEnd}
								on:portdisconnect={handlePortDisconnect}
								on:portpick={handlePortPick}
							/>
						{:else if isGroup}
							<GroupNode
								{node}
								selected={isSelected}
								isDropTarget={dragHoverGroupId === node.id}
								spliceTargetPort={dropTargetPortKey?.startsWith(`${node.id}|`)
									? dropTargetPortKey.slice(node.id.length + 1)
									: null}
								on:portstart={handlePortStart}
								on:portend={handlePortEnd}
								on:portdisconnect={handlePortDisconnect}
								on:portpick={handlePortPick}
								on:extractstart={handleExtractStart}
								on:cardmousedown={(ev) => handleNodeWrapperMouseDown(ev.detail, node)}
							/>
						{:else if node.type === 'tableprocess' || node.type === 'process'}
							<TableProcessNode
								{node}
								selected={isSelected}
								expanded={isExpanded}
								width={getNodeWidth(node)}
								spliceTargetPort={dropTargetPortKey?.startsWith(`${node.id}|`)
									? dropTargetPortKey.slice(node.id.length + 1)
									: null}
								on:portstart={handlePortStart}
								on:portend={handlePortEnd}
								on:portdisconnect={handlePortDisconnect}
								on:portpick={handlePortPick}
								on:toggleexpand={() => handleNodeToggleExpand(node)}
								on:cardmousedown={(ev) => handleNodeWrapperMouseDown(ev.detail, node)}
							/>
						{:else}
							<WorkflowNode
								{node}
								selected={isSelected}
								expanded={isExpanded}
								width={getNodeWidth(node)}
								isDropTarget={false}
								spliceTargetPort={dropTargetPortKey?.startsWith(`${node.id}|`)
									? dropTargetPortKey.slice(node.id.length + 1)
									: null}
								on:portstart={handlePortStart}
								on:portend={handlePortEnd}
								on:portdisconnect={handlePortDisconnect}
								on:portpick={handlePortPick}
								on:toggleexpand={() => handleNodeToggleExpand(node)}
								on:resizestart={(ev) => handleNoteResizeMouseDown(ev.detail, node)}
							/>
						{/if}

						<!-- Grouped action cluster: note · collapse/expand · delete. Sits at
						     the header's top-right when expanded, and floats as an overlay just
						     above the square when collapsed (no header to sit in). Action buttons
						     reveal on hover OR selection (with a grace period so the overlay is
						     easy to reach); the note button also stays visible whenever a note
						     exists. Delete routes through the same removeNode() the Delete key
						     uses (AYS modal for table-processes). Groups carry their own
						     delete/note/collapse in their header, and composites use uncombine,
						     so the floating overlay is only for the other node kinds — rendering
						     it for a group would stack a (no-op) compact toggle on top of the
						     group header's own close/note buttons. -->
						{#if node.type !== 'group' && node.type !== 'composite'}
							<div
								class="node-actions-host"
								class:compact
								class:visible={actionsRevealed || (compact && clusterHasNote)}
								onmouseenter={() => showNodeActions(node.id)}
								onmouseleave={hideNodeActionsSoon}
								role="presentation"
							>
								<NodeActions
									revealed={actionsRevealed}
									noteNodeId={compact ? clusterNoteId : null}
									hasNote={clusterHasNote}
									showCollapse={canToggleCompact(node)}
									expanded={!compact}
									onToggleCollapse={() => handleNodeToggleExpand(node)}
									showDelete={node.type !== 'group' && node.type !== 'composite'}
									onDelete={() => confirmDeleteNode(node)}
									deleteTooltip="Delete node"
								/>
							</div>
						{/if}

						{#if isExpanded && node.type === 'process' && node.processObj}
							{@const PComp = appConsts.processMap.get(node.processName)?.component}
							{#if PComp}
								<!-- The node card (TableProcessNode) shows inputs + per-output mini
								     tables; this panel below it holds the operation's settings
								     (e.g. Add's constant). -->
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

		{#if core.data.length === 0}
			<!-- On the canvas, "Simulate data" spawns the node directly (expanded,
			     no modal) like every other workflow add. -->
			<AddDataPrompt onSimulate={() => spawnTableProcessFromPalette('SimulatedData')} />
		{/if}

		{#if fileDragOver}
			<div class="canvas-file-drop-overlay"><span>Drop a data file to import</span></div>
		{/if}
	</div>

	<div
		class="zoom-controls"
		style="right: calc({appState.showControlPanel ? appState.widthControlPanel : 0}px + 5px);"
	>
		<button
			type="button"
			class="icon viewport-btn"
			onclick={(e) => {
				e.stopPropagation();
				tidyLayout();
			}}
			aria-label="Tidy layout"
			{@attach tooltip('Tidy layout — arrange nodes left-to-right')}
		>
			<Icon name="distribute-vertical" width={22} height={22} />
		</button>
		<button
			type="button"
			class="icon viewport-btn"
			onclick={(e) => {
				e.stopPropagation();
				pathFocusEnabled = !pathFocusEnabled;
			}}
			aria-pressed={pathFocusEnabled}
			aria-label={pathFocusEnabled ? 'Show all paths' : 'Show connected paths'}
			{@attach tooltip(pathFocusEnabled ? 'Show all paths' : 'Show connected paths')}
		>
			<Icon
				name={pathFocusEnabled ? 'showconnectedpaths' : 'showallpaths'}
				width={22}
				height={22}
			/>
		</button>
		<button
			type="button"
			class="icon viewport-btn"
			onclick={(e) => {
				e.stopPropagation();
				resetCanvasView();
			}}
			aria-label="Reset viewport"
			{@attach tooltip('Reset viewport (snap pan + zoom to origin)')}
		>
			<Icon name="center" width={22} height={22} />
		</button>
		<div class="zc-sep"></div>
		<button
			class="icon zoomout"
			onclick={(e) => {
				e.stopPropagation();
				zoom = Math.max(zoom - ZOOM_STEP, MIN_ZOOM);
			}}
			aria-label="Zoom out"
			{@attach tooltip('Zoom out')}
		>
			<Icon name="zoom-out" width={24} height={24} />
		</button>
		<button
			class="icon zoomin"
			onclick={(e) => {
				e.stopPropagation();
				zoom = Math.min(zoom + ZOOM_STEP, MAX_ZOOM);
			}}
			aria-label="Zoom in"
			{@attach tooltip('Zoom in')}
		>
			<Icon name="zoom-in" width={24} height={24} />
		</button>
	</div>
</div>

{#if portPicker}
	<!-- Right-click column picker for an input port. Renders nothing until open;
	     the ColumnSelector portals its list to <body>, positioned at the cursor. -->
	<ColumnSelector
		hideTrigger
		multiple={portPicker.many}
		bind:open={portPickerOpen}
		bind:value={portPickerValue}
		anchor={{ x: portPicker.x, y: portPicker.y }}
		placeholder="Connect a column…"
		onChange={handlePortPickChoice}
	/>
{/if}

<style>
	.workflow-editor {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		background: var(--surface-card);
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
		color: var(--color-lightness-25);
	}

	.canvas-viewport {
		flex: 1;
		overflow: hidden;
		cursor: grab;
		/* No grid here — the workflow canvas is a free layout (nodes don't snap),
		   so a flat surface distinguishes it from the snap-grid workspace. */
		background-color: var(--surface-canvas);
	}

	.canvas-viewport.panning {
		cursor: grabbing;
	}

	/* Alt-drag marquee rubber-band. Lives inside the scaled .canvas-inner, so the
	   border-width is divided by the zoom inline to keep a crisp ~1px edge. */
	.marquee-rect {
		position: absolute;
		z-index: 25;
		pointer-events: none;
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
		border: 1px dashed var(--color-accent);
	}

	.workflow-node-wrapper {
		cursor: grab;
		transition: opacity 0.15s;
	}

	/* Grouped action cluster (NodeActions). Expanded nodes: sits IN the header at
	   the top-right (transparent, blends in) like the worksheet plot header.
	   Compact nodes: floats as a small toolbar (with a card background) just above
	   the square — top-right aligned, clear of the right-edge ports. Visibility is
	   driven by `.visible` = revealed (hover-with-grace OR selection) OR has-note;
	   the note button inside stays put while collapse/delete fade in. */
	.node-actions-host {
		position: absolute;
		top: 3px;
		right: 6px;
		z-index: 6;
		display: flex;
		align-items: center;
		opacity: 0;
		pointer-events: none;
	}
	.node-actions-host.compact {
		top: auto;
		bottom: calc(100% + 3px);
		right: 0;
		padding: 1px 2px;
		background: var(--surface-card);
		border: 1px solid var(--color-lightness-80);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-1);
	}
	.node-actions-host.visible {
		opacity: 1;
		pointer-events: auto;
	}

	/* Expanded-composite frame: auto-sized backdrop behind member nodes. The
	   body is click-through (pointer-events:none) so panning + member interaction
	   pass through; only the title bar/button are interactive. */
	.composite-frame {
		position: absolute;
		z-index: 0;
		box-sizing: border-box;
		border: 1.5px dashed var(--color-accent);
		border-radius: 10px;
		background: rgba(77, 159, 227, 0.06);
		pointer-events: none;
	}
	.composite-frame-title {
		position: absolute;
		top: -11px;
		left: 10px;
		display: flex;
		align-items: center;
		gap: 6px;
		height: 20px;
		padding: 0 8px;
		background: var(--surface-card);
		border: 1px solid var(--color-accent);
		border-radius: 10px;
		font-size: var(--font-xs);
		font-weight: 600;
		color: var(--color-lightness-25);
		pointer-events: auto;
		cursor: grab;
		user-select: none;
	}
	.composite-frame-collapse {
		border: none;
		background: transparent;
		cursor: pointer;
		font-size: var(--font-xs);
		line-height: 1;
		padding: 0;
		color: var(--color-text-muted);
	}
	.composite-frame-collapse:hover {
		color: var(--color-accent);
	}

	/* When a node's note popover is open, lift the whole wrapper above its
	   neighbours so the popover paints on top of any adjacent node. Without
	   this, the popover sits inside a stacking context capped by the
	   wrapper's own z-index (typically 1) and gets covered by other nearby
	   nodes painted later in DOM order. `.node-note-popover` is declared in
	   NodeNoteButton.svelte; mark it :global so Svelte's scoped CSS still
	   matches it. */
	.workflow-node-wrapper:has(:global(.node-note-popover)) {
		z-index: 50 !important;
	}

	.workflow-node-wrapper.dragging {
		cursor: grabbing;
		opacity: 0.85;
	}

	/* Extra ring around every node in a >1 multi-selection so the user can see
	   which nodes will move together / be deleted / be copied. The primary
	   focused node still gets its own per-component "selected" border. */
	.workflow-node-wrapper.multi-selected {
		outline: 2px dashed rgba(77, 159, 227, 0.7);
		outline-offset: 2px;
		border-radius: var(--radius-lg);
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
		background: var(--surface-card);
		border: 1.5px solid rgba(0, 0, 0, 0.15);
		border-top: none;
		border-bottom-left-radius: 6px;
		border-bottom-right-radius: 6px;
		padding: 6px 8px;
		box-shadow: var(--shadow-2);
		cursor: default;
		box-sizing: border-box;
	}

	.process-intermediate-preview {
		margin-top: 6px;
		padding-top: 6px;
		border-top: 1px dashed rgba(0, 0, 0, 0.15);
	}

	.plot-preview-panel {
		overflow: hidden;
		border: 1.5px solid rgba(0, 0, 0, 0.15);
		border-top: none;
		border-bottom-left-radius: 6px;
		border-bottom-right-radius: 6px;
		background: var(--surface-card);
		box-shadow: var(--shadow-1);
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
		font-size: var(--font-xs);
		line-height: 16px;
		text-align: center;
		cursor: nwse-resize;
		color: #888;
		background: rgba(255, 255, 255, 0.8);
		border-radius: 2px;
		user-select: none;
	}

	.plot-resize-handle:hover {
		color: var(--color-lightness-25);
		background: rgba(255, 255, 255, 1);
	}

	/* Grouped viewport toolbar — a card matching the selection layout toolbar. */
	.zoom-controls {
		position: fixed;
		bottom: 10px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		z-index: 999;
		transition: right 0.6s ease;
		background: var(--surface-card);
		border: 1px solid var(--color-lightness-85);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-card);
		padding: 4px;
	}
	.zoom-controls button {
		width: 28px;
		height: 26px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: none;
		border-radius: 5px;
		background: transparent;
		cursor: pointer;
		transition: background 0.15s ease;
	}
	.zoom-controls button:hover {
		background: var(--color-lightness-95);
	}
	.zc-sep {
		width: 22px;
		height: 1px;
		background: var(--color-lightness-90);
		margin: 2px 0;
	}

	.selection-toolbar-host {
		position: absolute;
		top: 12px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 40;
		pointer-events: none;
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.selection-action-btn {
		pointer-events: auto;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 30px;
		padding: 0 10px;
		font-size: var(--font-sm);
		font-weight: 600;
		color: var(--color-lightness-25);
		background: var(--surface-card);
		border: 1px solid var(--color-lightness-80);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-1);
		cursor: pointer;
	}
	.selection-action-btn:hover {
		border-color: var(--color-accent);
		color: var(--color-accent);
	}

	/* Most viewport icons (zoom, reset, paths) inherit their fill from the global
	   .icon rule (var(--color-icon-unselected)). The Tidy icon's SVG uses
	   fill="currentColor", so it follows `color` instead — match the two palettes
	   here so all the buttons render the same shade idle and on hover. */
	.viewport-btn {
		color: var(--color-icon-unselected, var(--color-lightness-85));
		transition:
			color 0.18s ease,
			transform 0.32s ease;
	}

	.viewport-btn:hover,
	.viewport-btn[aria-pressed='true'] {
		color: var(--color-hover);
	}

	.viewport-btn:active {
		transform: scale(0.95);
	}
</style>
