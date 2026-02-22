<script>
	// @ts-nocheck
	import { core, appState } from '$lib/core/core.svelte.js';
	import { selectPlot, deselectAllPlots } from '$lib/core/Plot.svelte';
	import WorkflowNode from './WorkflowNode.svelte';
	import WorkflowEdges from './WorkflowEdges.svelte';

	const NODE_WIDTH = 160;
	const NODE_HEIGHT = 48;
	const COL_WIDTH = 220;
	const ROW_HEIGHT = 80;
	const PADDING = 40;

	// Derive all nodes from core
	const allNodes = $derived.by(() => {
		const result = [];

		// Col 0: data nodes (one per Column)
		core.data.forEach((col) => {
			result.push({
				id: `data_${col.id}`,
				label: col.name,
				sublabel: col.type,
				type: 'data',
				col: 0,
				refId: col.id
			});
		});

		// Col 1: process nodes (one per Process on a column)
		core.data.forEach((col) => {
			col.processes.forEach((p) => {
				result.push({
					id: `process_${p.id}`,
					label: p.displayName || p.name,
					type: 'process',
					col: 1,
					refId: p.id
				});
			});
		});

		// Col 2: tableprocess nodes (one per TableProcess on a table)
		core.tables.forEach((table) => {
			table.processes.forEach((tp) => {
				result.push({
					id: `tableprocess_${tp.id}`,
					label: tp.displayName || tp.name,
					sublabel: table.name,
					type: 'tableprocess',
					col: 2,
					refId: tp.id
				});
			});
		});

		// Col 3: plot nodes (one per plot)
		core.plots.forEach((plot) => {
			result.push({
				id: `plot_${plot.id}`,
				label: plot.name,
				sublabel: plot.type,
				type: 'plot',
				col: 3,
				refId: plot.id
			});
		});

		return result;
	});

	// Assign row positions within each column
	const nodePositions = $derived.by(() => {
		const colCounts = { 0: 0, 1: 0, 2: 0, 3: 0 };
		const positions = {};

		for (const node of allNodes) {
			const col = node.col;
			const row = colCounts[col] ?? 0;
			colCounts[col] = row + 1;
			positions[node.id] = {
				x: col * COL_WIDTH + PADDING,
				y: row * ROW_HEIGHT + PADDING
			};
		}

		return positions;
	});

	// Canvas dimensions
	const canvasWidth = $derived(4 * COL_WIDTH + 2 * PADDING);

	const canvasHeight = $derived.by(() => {
		const colCounts = [0, 1, 2, 3].map((col) => allNodes.filter((n) => n.col === col).length);
		const maxRows = Math.max(...colCounts, 5);
		return maxRows * ROW_HEIGHT + 2 * PADDING;
	});

	// Helper to check that a column reference id is valid
	function isValidRef(id) {
		return id != null && id >= 0;
	}

	// Derive edges with computed x,y positions
	const allEdges = $derived.by(() => {
		const edges = [];
		const seen = new Set();

		function nodeRight(id) {
			const pos = nodePositions[id];
			if (!pos) return null;
			return { x: pos.x + NODE_WIDTH, y: pos.y + NODE_HEIGHT / 2 };
		}

		function nodeLeft(id) {
			const pos = nodePositions[id];
			if (!pos) return null;
			return { x: pos.x, y: pos.y + NODE_HEIGHT / 2 };
		}

		function addEdge(fromId, toId, type) {
			const key = `${fromId}|${toId}|${type}`;
			if (seen.has(key)) return;
			seen.add(key);
			const from = nodeRight(fromId);
			const to = nodeLeft(toId);
			if (from && to) {
				edges.push({ fromId, toId, from, to, type });
			}
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
				if (Array.isArray(tp.args.xsIN)) {
					tp.args.xsIN.forEach(addInputEdge);
				}

				// tableprocess → data (output columns)
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
						if (dataPoint[axis]?.refId != null) {
							addPlotEdge(dataPoint[axis].refId);
						}
					});
				});
			}
		});

		return edges;
	});

	// Currently selected plot node id
	const selectedPlotNodeId = $derived.by(() => {
		const p = core.plots.find((p) => p.selected);
		return p ? `plot_${p.id}` : null;
	});

	// Pan / zoom state
	let panX = $state(0);
	let panY = $state(0);
	let zoom = $state(1);
	let isPanning = $state(false);
	let panStartX = $state(0);
	let panStartY = $state(0);

	// Left offset mirrors PlotDisplay positioning
	const leftPx = $derived.by(() => {
		return appState.showDisplayPanel
			? appState.widthDisplayPanel + appState.widthNavBar
			: appState.widthNavBar;
	});

	function handleWheel(e) {
		// Allow native browser zoom when modifier key is held
		if (e.ctrlKey || e.metaKey) return;
		e.preventDefault();
		const factor = e.deltaY > 0 ? 0.9 : 1.1;
		zoom = Math.min(Math.max(zoom * factor, 0.15), 4);
	}

	function handleMouseDown(e) {
		if (e.target.closest('.workflow-node-wrapper')) return;
		isPanning = true;
		panStartX = e.clientX - panX;
		panStartY = e.clientY - panY;
	}

	function handleMouseMove(e) {
		if (!isPanning) return;
		panX = e.clientX - panStartX;
		panY = e.clientY - panStartY;
	}

	function stopPan() {
		isPanning = false;
	}

	function handleNodeClick(e, node) {
		e.stopPropagation();
		if (node.type === 'plot') {
			selectPlot(e, node.refId);
		} else if (node.type === 'data') {
			appState.currentTab = 'data';
			appState.showDisplayPanel = true;
		}
	}

	function handleBackgroundClick() {
		deselectAllPlots();
	}

	function handleKeyDown(e) {
		if (e.key === 'Escape') deselectAllPlots();
	}
</script>

<div
	class="workflow-editor"
	style="left: {leftPx}px;"
	onwheel={handleWheel}
	onmousedown={handleMouseDown}
	onmousemove={handleMouseMove}
	onmouseup={stopPan}
	onmouseleave={stopPan}
	onclick={handleBackgroundClick}
	onkeydown={handleKeyDown}
	role="presentation"
	tabindex="-1"
>
	<div class="workflow-header">
		<span class="workflow-title">Workflow</span>
		<div class="header-legend">
			<span class="legend-item" style="background:#b3d9f2;">data</span>
			<span class="legend-item" style="background:#fffacc;">process</span>
			<span class="legend-item" style="background:#ffe0b3;">table process</span>
			<span class="legend-item" style="background:#b3f2cc;">plot</span>
		</div>
		<button class="close-btn" onclick={() => (appState.showWorkflow = false)}>✕</button>
	</div>

	<div class="canvas-viewport" class:panning={isPanning}>
		<div
			class="canvas-inner"
			style="transform: translate({panX}px, {panY}px) scale({zoom}); transform-origin: 0 0; width: {canvasWidth}px; height: {canvasHeight}px; position: relative;"
		>
			<WorkflowEdges edges={allEdges} width={canvasWidth} height={canvasHeight} />

			{#each allNodes as node (node.id)}
				{@const pos = nodePositions[node.id]}
				{#if pos}
					<div
						class="workflow-node-wrapper"
						style="position: absolute; left: {pos.x}px; top: {pos.y}px;"
					>
						<WorkflowNode
							{node}
							selected={selectedPlotNodeId === node.id}
							onclick={(e) => handleNodeClick(e, node)}
						/>
					</div>
				{/if}
			{/each}
		</div>
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
</style>
