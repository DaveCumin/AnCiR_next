<script>
	import { onMount } from 'svelte';
	import { core } from '$lib/core/theCore.svelte.js';

	//This is just a quick and dirty, using visjs. TODO: consider custm code or making vis (oro ther) a module. ?size.

	// Initialize nodes and edges
	let nodes = $state([]);
	let edges = $state([]);
	let nodeMap = $state(new Map());
	let network = $state();
	let error = $state();

	// Function to add nodes if they don't exist
	function addNode(id, label, group, level = 0) {
		if (!nodeMap.has(id)) {
			nodes.push({ id, label, group, level });
			nodeMap.set(id, true);
		}
	}

	let lastCoreHash = $state(''); // Track core's contents to detect changes
	// Map to store the last process node for each column
	const columnLastProcess = {};

	function doThebusiness() {
		//reset
		nodes = [];
		edges = [];
		nodeMap = new Map();

		// Track the maximum level for column processes
		let maxColumnProcessLevel = 1;

		// Process tables and their columns
		core?.tables?.forEach((table) => {
			const tableId = `table_${table.tableid}`;
			addNode(tableId, `Table ${table.tableid}: ${table.name}`, 'table', 0);

			table.columnRefs.forEach((columnID) => {
				const data = core?.data?.find((d) => d.id === columnID);
				if (data) {
					const columnId = `column_${columnID}`;
					addNode(columnId, `Column ${columnID}: ${data.name}`, 'column', 1);
					edges.push({ from: tableId, to: columnId });

					// Handle column processes
					let currentLevel = 2; // Start processes at level 2
					let previous = columnId;
					data.processes.forEach((process) => {
						const processId = `process_${process.id}`;
						addNode(processId, `Process ${process.id}: ${process.name}`, 'process', currentLevel);
						edges.push({ from: previous, to: processId });
						previous = processId;
						currentLevel += 0.5;
					});
					maxColumnProcessLevel = Math.max(maxColumnProcessLevel, currentLevel - 0.5);
					columnLastProcess[columnID] = data.processes.length > 0 ? previous : columnId;
				}
			});
		});

		// Levels for plot.data and their processes
		const plotDataLevelstart = maxColumnProcessLevel + 1; // Plot data after column processes
		const plotProcessLevelstart = plotDataLevelstart + 1; // Plot processes after plot data
		// Track the maximum level for plot processes
		let maxPlotProcessLevel = plotProcessLevelstart;

		// Process plots - just the data and processes at the moment
		core?.plots?.forEach((plot, plotIndex) => {
			const plotId = `plot_${plotIndex}`;

			plot.plot.data.forEach((dataPoint, dpIndex) => {
				let xNodeId = null;
				let yNodeId = null;

				['x', 'y'].forEach((axis) => {
					const refDataID = dataPoint[axis].refId;
					const columnLast = columnLastProcess[refDataID];
					if (columnLast) {
						const plotDataId = `${axis}_dp${dpIndex}_plot${plotIndex}`;
						const columnName = core?.data?.find((d) => d.id === refDataID).name;
						addNode(
							plotDataId,
							`${axis.toUpperCase()} dp${dpIndex}: ${columnName}`,
							'plotdata',
							plotDataLevelstart
						);
						edges.push({ from: columnLast, to: plotDataId });

						// Store x and y node IDs for undirected edge
						if (axis === 'x') xNodeId = plotDataId;
						if (axis === 'y') yNodeId = plotDataId;

						let previous = plotDataId;
						const plotProcesses = dataPoint[axis].processes || [];
						let plotProcessLevelcurrent = plotProcessLevelstart;
						plotProcesses.forEach((process) => {
							const processId = `process_${process.id}`;
							addNode(
								processId,
								`Process ${process.id}: ${process.name}`,
								'process',
								plotProcessLevelcurrent
							);
							edges.push({ from: previous, to: processId });
							previous = processId;
							plotProcessLevelcurrent += 0.5;
						});
						maxPlotProcessLevel = Math.max(maxPlotProcessLevel, plotProcessLevelcurrent + 0.5);
						edges.push({ from: previous, to: plotId });
					}
				});

				// Add undirected edge between x and y nodes
				if (xNodeId && yNodeId) {
					edges.push({
						from: xNodeId,
						to: yNodeId,
						dashes: true, // Dashed line for visual distinction
						arrows: { to: { enabled: false }, from: { enabled: false } } // Undirected
					});
				}
			});
		});

		//now the plot
		core?.plots?.forEach((plot, plotIndex) => {
			const plotId = `plot_${plotIndex}`;
			addNode(plotId, `Plot ${plotIndex}: ${plot.type}`, 'plot', maxPlotProcessLevel);
		});
	}

	async function refresh() {
		doThebusiness();
		// Ensure vis is available (loaded from <svelte:head>)
		if (!window.vis) {
			console.error('Vis.js not loaded');
			return;
		}

		// Set up Vis.js network
		const container = document.getElementById('network');
		const data = {
			nodes: new window.vis.DataSet(nodes),
			edges: new window.vis.DataSet(edges)
		};
		const options = {
			nodes: {
				shape: 'dot',
				size: 20,
				font: { size: 14 },
				borderWidth: 2
			},
			edges: {
				width: 2,
				arrows: { to: { enabled: true, scaleFactor: 0.5 } }
			},
			groups: {
				table: { color: { background: 'lightblue' } },
				column: { color: { background: 'lightgreen' } },
				process: { color: { background: 'yellow' } },
				plotdata: { color: { background: 'orange' } },
				plot: { color: { background: 'red' } }
			},
			layout: {
				hierarchical: {
					direction: 'UD',
					sortMethod: 'directed',
					levelSeparation: 150
				}
			},
			physics: { enabled: false }
		};
		network = new window.vis.Network(container, data, options);
	}

	$effect(() => {
		// Create a hash of core to detect actual changes
		const currentCoreHash = JSON.stringify(core);
		if (currentCoreHash === lastCoreHash) {
			//console.log('core unchanged, skipping refresh');
			return;
		}
		lastCoreHash = currentCoreHash;
		doThebusiness();
		refresh();
	});
</script>

<svelte:head>
	<script src="https://visjs.github.io/vis-network/standalone/umd/vis-network.min.js"></script>
</svelte:head>
<div id="network"></div>

<style>
	#network {
		width: 100%;
		height: 500px;
		border: 1px solid #ccc;
		background: white;
	}
</style>
