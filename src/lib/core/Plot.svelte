<script module>
	// @ts-nocheck
	import { appConsts, core } from '$lib/core/core.svelte';

	let _counter = 0;
	function getNextId() {
		return _counter++;
	}
	export function removePlot(id) {
		const index = core.plots.findIndex((p) => p.id === id);
		if (index !== -1) {
			core.plots.splice(index, 1);
		}
	}

	export class Plot {
		id;
		name = $state('plot' + this.id); // TODO: possible fix?
		x = $state(350);
		y = $state(150);
		width = $state(500);
		height = $state(250);
		type;
		plot;

		constructor(plotData = {}, id = null) {
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
				plot: this.plot
			};
		}
		static fromJSON(json) {
			//TODO
			const id = json.id ?? json.plotid;
			const name = json.name ?? 'Untitled Plot';

			const { x, y, width, height, type, plot } = json;
			return new Plot({ name, x, y, width, height, type, plot }, id);
		}
	}
</script>

<script>
	let { plot } = $props();
	const Plot = appConsts.plotMap.get(plot.type).plot ?? null;
</script>

<div>
	<Plot bind:theData={plot} which="plot" />
</div>

<div>
	<Plot theData={plot.plot} which="controls" />
</div>
