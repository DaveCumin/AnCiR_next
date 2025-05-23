<script module>
	import { appConsts } from '$lib/core/theCore.svelte';

	let plotidCounter = 0;

	export class Plot {
		plotid;
		name = '';
		x = $state(0);
		y = $state(0);
		width = $state(200);
		height = $state(150);
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
</script>

<p>{JSON.stringify(plot)}</p>
<Box {plot}>
	<p><input type="text" bind:value={plot.name} /></p>
	<Plot theData={plot} which="plot" />
</Box>

<div style="margin-left:40vw">
	<Plot theData={plot.plot} which="controls" />
</div>
