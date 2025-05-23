<script module>
	import { plotMap } from '$lib/plots/plotMap';

	let plotidCounter = 0;

	export class Plot {
		plotid;
		name = '';
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
			this.plot = plotMap.get(dataIN.type).data.fromJSON(dataIN.plot);
		}

		toJSON() {
			return {
				plotid: this.plotid,
				name: this.name,
				type: this.type,
				plot: this.plot
			};
		}
		static fromJSON(json) {
			//TODO
			const { plotid, name, type, plot } = json;
			return new Plot({ name, type, plot }, plotid);
		}
	}
</script>

<script>
	let { plot } = $props();
</script>

<p>{JSON.stringify(plot)}</p>
