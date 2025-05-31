<script module>
	import { appConsts } from '$lib/core/theCore.svelte';

	let plotidCounter = 0;

	export class Plot {
		plotid;
		name = $state('plot' + this.plotid);
		x = $state(350);
		y = $state(150);
		width = $state(500);
		height = $state(250);
		type;
		plot;

		constructor({ ...dataIN }, id = null) {
			if (id === null) {
				this.plotid = id ?? plotidCounter;
				plotidCounter++;
			} else {
				this.plotid = id;
				plotidCounter = Math.max(id + 1, plotidCounter + 1);
			}
			//set the name
			this.name = dataIN.name;
			//need to make the plot
			this.type = dataIN.type;
			this.plot = appConsts.plotMap.get(dataIN.type).data.fromJSON(this, dataIN.plot);
		}

		toJSON() {
			return {
				plotid: this.plotid,
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
			const { plotid, name, x, y, width, height, type, plot } = json;
			return new Plot({ name, x, y, width, height, type, plot }, plotid);
		}
	}
</script>

<script>
	import Box from '$lib/components/Box.svelte';
	let { plot } = $props();
	const Plot = appConsts.plotMap.get(plot.type).plot ?? null;
	let options = $state({ x: 900, y: 0, width: 200, height: 550 });
</script>

<Box bind:plot overflow="none">
	<a style="position:absolute; top:-1.5em;">{plot.name}</a>
	<Plot bind:theData={plot} which="plot" />
</Box>

<Box bind:plot={options} overflow="auto">
	<div>
		<Plot theData={plot.plot} which="controls" />
	</div>
</Box>
