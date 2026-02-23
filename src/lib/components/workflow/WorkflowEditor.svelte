<script>
	// @ts-nocheck
	import { core, appState, appConsts, replaceColumnRefs } from '$lib/core/core.svelte.js';
	import { selectPlot, deselectAllPlots } from '$lib/core/Plot.svelte';
	import WorkflowNode from './WorkflowNode.svelte';
	import WorkflowEdges from './WorkflowEdges.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import MakeNewPlot from '$lib/components/views/modals/MakeNewPlot.svelte';
	import MakeNewColumn from '$lib/components/views/modals/MakeNewColumn.svelte';
	import AddProcess from '$lib/components/iconActions/AddProcess.svelte';

	const NODE_WIDTH = 160;
	const NODE_HEIGHT = 48;
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

	// Pastel colour palette for data nodes grouped by source table (cycles when > 6 tables)
	const TABLE_COLOURS = ['#c8d8f0', '#f0c8d8', '#c8f0d8', '#d8c8f0', '#f0d8c8', '#d8f0c8'];

	// Derive the natural preview height from a plot's aspect ratio (no cropping by default)
	function getDefaultPreviewH(plotObj) {
		if (!plotObj?.width) return PLOT_PREVIEW_DEFAULT_W; // fallback: square if no width info
		return plotObj.height * (PLOT_PREVIEW_DEFAULT_W / plotObj.width);
	}

	// Per-plot preview size overrides keyed by node id
	const plotPreviewSizes = $state({});

	// --- Insert modals ---
	let showAddPlotModal = $state(false);
	let showAddColumnModal = $state(false);
	let addColumnTableId = $state(null);
	let showAddProcessDropdown = $state(false);
	let addProcessColumn = $state(null);
	let addProcessDropX = $state(0);
	let addProcessDropY = $state(0);

	// Derive all nodes from core — include live process/tp object references
	const allNodes = $derived.by(() => {
		const result = [];

		// Build set of TP output column IDs (these go in col 3, not col 0)
		const tpOutputColIds = new Set();
		core.tables.forEach((table) => {
			table.processes.forEach((tp) => {
				if (tp.args.out) {
					Object.values(tp.args.out).forEach((id) => {
						if (id != null && id >= 0) tpOutputColIds.add(id);
					});
				}
			});
		});

		// Build colId → table colour (stable by table index)
		const colToColor = new Map();
		core.tables.forEach((table, idx) => {
			const color = TABLE_COLOURS[idx % TABLE_COLOURS.length];
			table.columnRefs.forEach((colId) => colToColor.set(colId, color));
			table.processes.forEach((tp) => {
				if (tp.args.out) {
					Object.values(tp.args.out).forEach((colId) => {
						if (colId != null && colId >= 0) colToColor.set(colId, color);
					});
				}
			});
		});

		// Col 0: regular input data nodes (not TP outputs)
		core.data.forEach((col) => {
			if (tpOutputColIds.has(col.id)) return;
			result.push({
				id: `data_${col.id}`,
				label: col.name,
				sublabel: col.type,
				type: 'data',
				col: 0,
				refId: col.id,
				tableColor: colToColor.get(col.id)
			});
		});

		// Col 1: column process nodes (only on input columns)
		core.data.forEach((col) => {
			if (tpOutputColIds.has(col.id)) return;
			col.processes.forEach((p) => {
				result.push({
					id: `process_${p.id}`,
					label: p.displayName || p.name,
					type: 'process',
					col: 1,
					refId: p.id,
					processObj: p,
					processName: p.name
				});
			});
		});

		// Col 2: table process nodes
		core.tables.forEach((table) => {
			table.processes.forEach((tp) => {
				result.push({
					id: `tableprocess_${tp.id}`,
					label: tp.displayName || tp.name,
					sublabel: table.name,
					type: 'tableprocess',
					col: 2,
					refId: tp.id,
					tpObj: tp,
					tpName: tp.name
				});
			});
		});

		// Col 3: TP output data nodes, ordered by TP so they appear near their parent TP
		core.tables.forEach((table, tableIdx) => {
			const color = TABLE_COLOURS[tableIdx % TABLE_COLOURS.length];
			table.processes.forEach((tp) => {
				if (!tp.args.out) return;
				Object.values(tp.args.out).forEach((colId) => {
					if (colId == null || colId < 0) return;
					const col = core.data.find((d) => d.id === colId);
					if (!col) return;
					result.push({
						id: `data_${col.id}`,
						label: col.name,
						sublabel: col.type,
						type: 'data',
						col: 3,
						refId: col.id,
						tableColor: color,
						isTPOutput: true
					});
				});
			});
		});

		// Col 4: plot nodes (was col 3)
		core.plots.forEach((plot) => {
			result.push({
				id: `plot_${plot.id}`,
				label: plot.name,
				sublabel: plot.type,
				type: 'plot',
				col: 4,
				refId: plot.id,
				plotObj: plot
			});
		});

		return result;
	});

	// Assign default column-layout positions (plot column uses aspect-ratio-derived row height)
	const nodePositions = $derived.by(() => {
		const colOffsets = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
		const positions = {};

		for (const node of allNodes) {
			const col = node.col;
			positions[node.id] = {
				x: col * COL_WIDTH + PADDING,
				y: colOffsets[col] + PADDING
			};
			if (col === 4) {
				const ps = plotPreviewSizes[node.id];
				const h = ps ? ps.h : getDefaultPreviewH(node.plotObj);
				colOffsets[col] += NODE_HEIGHT + h + 24;
			} else {
				colOffsets[col] += ROW_HEIGHT;
			}
		}
		return positions;
	});

	// User-drag position overrides keyed by node id
	const customPositions = $state({});

	// Canvas dimensions
	const canvasWidth = $derived(5 * COL_WIDTH + 2 * PADDING);
	const canvasHeight = $derived.by(() => {
		const colHeights = [0, 1, 2, 3, 4].map((col) => {
			let total = 0;
			allNodes
				.filter((n) => n.col === col)
				.forEach((n) => {
					if (col === 4) {
						const ps = plotPreviewSizes[n.id];
						total += NODE_HEIGHT + (ps ? ps.h : getDefaultPreviewH(n.plotObj)) + 24;
					} else {
						total += ROW_HEIGHT;
					}
				});
			return total;
		});
		return Math.max(...colHeights, 5 * ROW_HEIGHT) + 2 * PADDING;
	});

	// --- Edge derivation split into topology + positioned ---

	function isValidRef(id) {
		return id != null && id >= 0;
	}

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

	// Step 1: edge connectivity only (re-derives when core changes, NOT when positions change)
	const edgeTopology = $derived.by(() => {
		const edges = [];
		const seen = new Set();

		function addEdge(fromId, toId, type) {
			const key = `${fromId}|${toId}|${type}`;
			if (seen.has(key)) return;
			seen.add(key);
			edges.push({ fromId, toId, type });
		}

		// data → process chains
		core.data.forEach((col) => {
			let prevId = `data_${col.id}`;
			col.processes.forEach((p) => {
				const processId = `process_${p.id}`;
				addEdge(prevId, processId, 'data-process');
				prevId = processId;
			});
		});

		// tableprocess input/output edges
		core.tables.forEach((table) => {
			table.processes.forEach((tp) => {
				const tpNodeId = `tableprocess_${tp.id}`;

				function addInputEdge(colId) {
					if (!isValidRef(colId)) return;
					const col = core.data.find((d) => d.id === colId);
					if (!col) return;
					const lastId =
						col.processes.length > 0
							? `process_${col.processes[col.processes.length - 1].id}`
							: `data_${colId}`;
					addEdge(lastId, tpNodeId, 'data-tp');
				}

				addInputEdge(tp.args.xIN);
				addInputEdge(tp.args.yIN);
				if (Array.isArray(tp.args.xsIN)) tp.args.xsIN.forEach(addInputEdge);

				if (tp.args.out) {
					Object.values(tp.args.out).forEach((colId) => {
						if (!isValidRef(colId)) return;
						addEdge(tpNodeId, `data_${colId}`, 'tp-data');
					});
				}
			});
		});

		// data → plot edges
		core.plots.forEach((plot) => {
			const plotNodeId = `plot_${plot.id}`;

			function addPlotEdge(colId) {
				if (!isValidRef(colId)) return;
				const col = core.data.find((d) => d.id === colId);
				if (!col) return;
				const lastId =
					col.processes.length > 0
						? `process_${col.processes[col.processes.length - 1].id}`
						: `data_${colId}`;
				addEdge(lastId, plotNodeId, 'data-plot');
			}

			if (plot.type === 'tableplot') {
				plot.plot.columnRefs?.forEach(addPlotEdge);
			} else {
				plot.plot.data?.forEach((dataPoint) => {
					['x', 'y', 'z'].forEach((axis) => {
						if (dataPoint[axis]?.refId != null) addPlotEdge(dataPoint[axis].refId);
					});
				});
			}
		});

		return edges;
	});

	// Step 2: attach positions (re-derives when topology OR any position changes)
	const allEdges = $derived.by(() => {
		return edgeTopology.flatMap((edge) => {
			const fromPos = customPositions[edge.fromId] ?? nodePositions[edge.fromId];
			const toPos = customPositions[edge.toId] ?? nodePositions[edge.toId];
			if (!fromPos || !toPos) return [];
			return [
				{
					...edge,
					from: { x: fromPos.x + NODE_WIDTH, y: fromPos.y + NODE_HEIGHT / 2 },
					to: { x: toPos.x, y: toPos.y + NODE_HEIGHT / 2 }
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
	let panX = $state(0);
	let panY = $state(0);
	let zoom = $state(1);
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
		const pos = customPositions[node.id] ?? nodePositions[node.id];
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

	function openAddTableProcess(e, tableId) {
		e.stopPropagation();
		addColumnTableId = tableId;
		showAddColumnModal = true;
	}

	function handleMouseMove(e) {
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
				const prev = customPositions[dragInfo.nodeId];
				if (prev) {
					prev.x = nx;
					prev.y = ny;
				} else {
					customPositions[dragInfo.nodeId] = { x: nx, y: ny };
				}

				// Drop-target detection: compare dragged node's bbox against each data node's bbox.
				// Both positions are in canvas space, so no viewport-offset error.
				const draggedNode = allNodes.find((n) => n.id === dragInfo.nodeId);
				if (draggedNode?.type === 'data') {
					const draggedBox = { x: nx, y: ny };
					let found = null;
					for (const node of allNodes) {
						if (node.type !== 'data' || node.id === dragInfo.nodeId) continue;
						const pos = customPositions[node.id] ?? nodePositions[node.id];
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
				replaceColumnRefs(sourceNode.refId, targetNode.refId);
				// Snap the dragged node back to its default layout position
				delete customPositions[dragInfo.nodeId];
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
	}

	function handleKeyDown(e) {
		if (e.key === 'Escape') {
			deselectAllPlots();
			expandedNodeId = null;
			focusedNodeId = null;
		}
	}
</script>

<div
	class="workflow-editor"
	style="left: {leftPx}px;"
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
	<div class="workflow-header">
		<span class="workflow-title">Workflow</span>
		<div class="header-legend">
			{#each core.tables as table, idx (table.id)}
				<span class="legend-item" style="background:{TABLE_COLOURS[idx % TABLE_COLOURS.length]};"
					>{table.name}</span
				>
			{/each}
			<span class="legend-item" style="background:#fffacc;">process</span>
			<span class="legend-item" style="background:#ffe0b3;">table process</span>
			<span class="legend-item" style="background:#b3f2cc;">plot</span>
		</div>
		<div class="header-add-actions">
			<button class="header-add-btn" onclick={() => (showAddPlotModal = true)} title="Add new plot"
				>+ Plot</button
			>
			{#each core.tables as table (table.id)}
				<button
					class="header-add-btn header-add-tp"
					onclick={(e) => openAddTableProcess(e, table.id)}
					title="Add table process to {table.name}"
				>
					+ TP: {table.name}
				</button>
			{/each}
		</div>
		<button class="close-btn" onclick={() => (appState.showWorkflow = false)}>✕</button>
	</div>

	<div class="canvas-viewport" bind:this={canvasViewportEl} class:panning={isPanning && !dragInfo}>
		<div
			class="canvas-inner"
			style="transform: translate({panX}px, {panY}px) scale({zoom}); transform-origin: 0 0; width: {canvasWidth}px; height: {canvasHeight}px; position: relative;"
		>
			<WorkflowEdges
				edges={allEdges}
				width={canvasWidth}
				height={canvasHeight}
				highlightedIds={connectedNodeIds}
			/>

			{#each allNodes as node (node.id)}
				{@const pos = customPositions[node.id] ?? nodePositions[node.id]}
				{@const isExpanded = expandedNodeId === node.id}
				{@const isDragging = dragInfo?.nodeId === node.id && dragInfo?.moved}
				{@const isDimmed = connectedNodeIds !== null && !connectedNodeIds.has(node.id)}
				{@const isDropTarget = dropTargetNodeId === node.id}
				{@const nodeZIndex = isDragging ? 30 : isExpanded ? 20 : 1}
				{#if pos}
					<div
						class="workflow-node-wrapper"
						class:dragging={isDragging}
						class:dimmed={isDimmed}
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
							{@const PlotComp = appConsts.plotMap.get(node.plotObj.type)?.plot}
							{@const pSize = plotPreviewSizes[node.id] ?? {
								w: PLOT_PREVIEW_DEFAULT_W,
								h: getDefaultPreviewH(node.plotObj)
							}}
							{@const previewScale = pSize.w / node.plotObj.width}
							{#if PlotComp}
								<div class="plot-preview-panel" style="width:{pSize.w}px; height:{pSize.h}px;">
									<div
										class="plot-preview-inner"
										style="transform:scale({previewScale}); transform-origin:top left; width:{node
											.plotObj.width}px; height:{node.plotObj.height}px;"
									>
										<PlotComp theData={node.plotObj} which="plot" />
									</div>
									<div
										class="plot-resize-handle"
										onmousedown={(e) => handleResizeMouseDown(e, node)}
										title="Drag to resize"
									>
										⤡
									</div>
								</div>
							{/if}
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
<MakeNewPlot bind:showModal={showAddPlotModal} />
{#if showAddColumnModal}
	<MakeNewColumn bind:show={showAddColumnModal} tableId={addColumnTableId} />
{/if}
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

	.workflow-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 16px;
		border-bottom: 1px solid var(--color-lightness-85);
		background: var(--color-lightness-98);
		flex-shrink: 0;
		gap: 12px;
	}

	.workflow-title {
		font-weight: bold;
		color: var(--color-lightness-35);
		white-space: nowrap;
	}

	.header-legend {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}

	.legend-item {
		font-size: 10px;
		padding: 2px 6px;
		border-radius: 4px;
		border: 1px solid rgba(0, 0, 0, 0.1);
		color: #333;
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
		background-color: #fafafa;
		background-image: radial-gradient(circle, #d0d0d0 1px, transparent 1px);
		background-size: 20px 20px;
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

	.zoom-btn {
		width: 28px;
		height: 28px;
		background: white;
		border: 1px solid var(--color-lightness-85);
		border-radius: 4px;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
	}

	.zoom-btn:hover {
		background: var(--color-lightness-95);
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

	/* Header insert buttons */
	.header-add-actions {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
		align-items: center;
	}

	.header-add-btn {
		font-size: 10px;
		padding: 2px 7px;
		background: transparent;
		border: 1px solid var(--color-lightness-85);
		border-radius: 3px;
		cursor: pointer;
		color: var(--color-lightness-35);
		white-space: nowrap;
	}

	.header-add-btn:hover {
		background: var(--color-lightness-95);
	}

	.header-add-tp {
		border-color: #ffe0b3;
	}
	.icon {
		transition: right 0.6s ease;
	}
</style>
