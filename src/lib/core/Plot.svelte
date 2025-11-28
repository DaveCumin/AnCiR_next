<script module>
	// @ts-nocheck
	import { Column } from '$lib/core/Column.svelte';

	let selectedPlotIds = $state();

	import { appConsts, appState, core } from '$lib/core/core.svelte';
	let _counter = 0;
	function getNextId() {
		return _counter++;
	}
	export function removePlots(ids) {
		//make selectedPLotIds an array if not already
		if (!Array.isArray(ids)) ids = [ids];
		selectedPlotIds = ids;
		appState.AYStext =
			ids.length == 1
				? `Are you sure you want to remove ${core.plots[core.plots.findIndex((p) => p.id === ids[0])].name}?`
				: `Are you sure you want to remove these ${ids.length} plots?`;
		appState.AYScallback = handleAYS;
		appState.showAYSModal = true;
	}
	function handleAYS(option) {
		console.log('SELECTED: ', option);
		if (option === 'Yes') {
			for (const id of selectedPlotIds) {
				const index = core.plots.findIndex((p) => p.id === id);
				if (index !== -1) {
					core.plots.splice(index, 1);
				}
			}
		}
	}

	export function selectPlot(e, id) {
		// //look for alt held at the same time
		if (e.altKey) {
			//simply toggle selection
			core.plots.forEach((p) => {
				p.id == id ? (p.selected = !p.selected) : null;
			});
		} else {
			//de-select all others and only select this one
			core.plots.forEach((p) => {
				p.id == id ? (p.selected = true) : (p.selected = false);
			});
		}
	}
	export function selectAllPlots() {
		core.plots.forEach((p) => (p.selected = true));
	}
	export function deselectAllPlots() {
		core.plots.forEach((p) => (p.selected = false));
	}

	export function removeColumnFromPlots(c_id) {
		core.plots.forEach((p, pi) => {
			//for the table
			if (p.type == 'tableplot') {
				p.plot.columnRefs = p.plot.columnRefs.filter((cr) => cr != c_id);
			} else {
				// for each plot
				p.plot.data.forEach((d, di) => {
					// console.log('data:');
					// console.log($state.snapshot(d));
					//for each data
					Object.keys($state.snapshot(d)).forEach((k) => {
						if (d[k]?.refId == c_id) {
							//if it's a match, then remove the reference
							//console.log('removing col ', k, ' from plot ', pi, '(', p.name, '), data ', di);
							core.plots[pi].plot.data[di][k] = new Column({ refId: -1 });
						}
					});
				});
			}
		});
	}

	export class Plot {
		id;
		name = 'plot' + this.id;
		x = $state(350);
		y = $state(150);
		width = 500;
		height = 250;
		type;
		selected = false;
		plot = $state();
		position = { x: this.x, y: this.y };
		data = { plot: this };

		constructor(plotData = {}, id = null) {
			// console.log('new plot: ', plotData);
			// console.log('plotdata.width: ', plotData.width);
			if (id === null) {
				this.id = getNextId();
			} else {
				this.id = id;
				_counter = Math.max(id + 1, _counter + 1);
			}
			//set things
			this.name = plotData.name ?? `Plot_${this.id}`;
			this.x = plotData.x ?? 350;
			this.y = plotData.y ?? 150;
			this.width = plotData.width ?? 500;
			this.height = plotData.height ?? 250;
			//need to make the plot
			this.type = plotData.type;

			if (!this.type) {
				throw new Error('Plot type is required');
			}

			const plotTypeEntry = appConsts.plotMap.get(this.type);
			if (!plotTypeEntry) {
				throw new Error(`Unknown plot type: ${this.type}`);
			}

			if (typeof plotTypeEntry.data.fromJSON !== 'function') {
				throw new Error(`plotTypeEntry.data.fromJSON is not a function`);
			}

			this.plot = plotTypeEntry.data.fromJSON(this, plotData.plot);

			this.data = {
				data: this
			};
		}

		toJSON() {
			return {
				id: this.id,
				name: this.name,
				x: this.x,
				y: this.y,
				width: this.width,
				height: this.height,
				type: this.type,
				selected: this.selected,
				plot: this.plot
			};
		}
		static fromJSON(json) {
			const id = json.id ?? json.plotid;
			const name = json.name ?? 'Untitled Plot';

			const { x, y, width, height, type, selected, plot } = json;
			return new Plot({ name, x, y, width, height, type, selected, plot }, id);
		}
	}
</script>

<script>
	let { plot } = $props();
	const Plot = appConsts.plotMap.get(plot.type).plot ?? null;
</script>

<div style="width: {width}px; height: {height}px;">
	<Plot bind:theData={plot} which="plot" />
</div>

<div>
	<Plot theData={plot.plot} which="controls" />
</div>
