<!-- src/lib/plots/scatter/Scatterplot.svelte -->
<script module>
	import { Column as ColumnClass } from '$lib/core/Column.svelte';
	import Column from '$lib/core/Column.svelte';
	import { core } from '$lib/core/theCore.svelte.js';

	function getRandomColor() {
		const letters = '0123456789ABCDEF';
		let color = '#';
		for (let i = 0; i < 6; i++) {
			color += letters[Math.floor(Math.random() * 16)];
		}
		return color;
	}

	function normalise(values, min, max) {
		return values.map((value) => (value - min) / (max - min));
	}

	class ScatterDataclass {
		parent = $state();
		x = $state();
		y = $state();
		colour = $state(getRandomColor());
		polyline = $derived.by(() => {
			let out = '';
			let tempx = this.x.getData() ?? [];
			let tempy = this.y.getData() ?? [];

			//normalise to the parent width and height
			tempx = normalise(tempx, this.parent.xlims[0], this.parent.xlims[1]);
			tempy = normalise(tempy, this.parent.ylims[0], this.parent.ylims[1]);

			for (let p = 0; p < tempx.length; p++) {
				out +=
					this.parent.parent.width * tempx[p] +
					',' +
					(this.parent.parent.height - this.parent.parent.height * tempy[p]) +
					' ';
			}

			return out;
		});

		constructor(parent, dataIN) {
			this.parent = parent;

			if (dataIN && dataIN.x) {
				this.x = ColumnClass.fromJSON(dataIN.x);
			} else {
				this.x = new ColumnClass({ refDataID: -1 });
			}
			if (dataIN && dataIN.y) {
				this.y = ColumnClass.fromJSON(dataIN.y);
			} else {
				this.y = new ColumnClass({ refDataID: -1 });
			}
		}

		toJSON() {
			return {
				x: this.x,
				y: this.y,
				colour: this.colour
			};
		}

		static fromJSON(json, parent) {
			return new ScatterDataclass(parent, {
				x: json.x,
				y: json.y
			});
		}
	}

	export class Scatterplotclass {
		parent = $state();
		data = $state([]);
		ylims = $derived.by(() => {
			if (this.data.length === 0) {
				return [0, 0];
			}

			let ymin = Infinity;
			let ymax = -Infinity;
			this.data.forEach((d, i) => {
				let tempy = this.data[i].y.getData() ?? [];
				ymin = Math.min(ymin, Math.min(...tempy));
				ymax = Math.max(ymax, Math.max(...tempy));
			});
			return [ymin, ymax];
		});
		xlims = $derived.by(() => {
			if (this.data.length === 0) {
				return [0, 0];
			}

			let xmin = Infinity;
			let xmax = -Infinity;
			this.data.forEach((d, i) => {
				let tempx = this.data[i].x.getData() ?? [];
				xmin = Math.min(xmin, Math.min(...tempx));
				xmax = Math.max(xmax, Math.max(...tempx));
			});
			return [xmin, xmax];
		});

		constructor(parent, dataIN) {
			this.parent = parent;
			if (dataIN) {
				this.addData(dataIN);
			}
		}

		addData(dataIN) {
			this.data.push(new ScatterDataclass(this, dataIN));
		}
		removeData(idx) {
			this.data.splice(idx, 1);
		}

		toJSON() {
			return {
				data: this.data
			};
		}
		static fromJSON(parent, json) {
			if (!json) {
				return new Scatterplotclass(parent, null);
			}
			//TODO: fix this.
			const { data } = json;
			const scatter = new Scatterplotclass(parent, json);
			if (data) {
				scatter.data = data.map((d) => ScatterDataclass.fromJSON(scatter, d));
			}
			return scatter;
		}
	}
</script>

<script>
	let { theData, which } = $props();

	function pickRandomData() {
		const options = Array.from(core.data.keys());
		return options.length > 0 ? options[Math.floor(Math.random() * options.length)] : -1;
	}
</script>

{#snippet controls(theData)}
	<div>
		Name: <input type="text" bind:value={theData.parent.name} />
		Width: <input type="number" bind:value={theData.parent.width} />
		height: <input type="number" bind:value={theData.parent.height} />
		<p>ylims: {theData.ylims}</p>
		<p>xlims: {theData.xlims}</p>
		<p>Data:</p>
		<button
			onclick={() =>
				theData.addData({
					x: { refDataID: pickRandomData() },
					y: { refDataID: pickRandomData() }
				})}
		>
			+
		</button>

		{#each theData.data as datum, i}
			<p>
				Data {i}
				<button onclick={() => theData.removeData(i)}>-</button>
			</p>

			x: {datum.x.name} ({datum.x.getData()?.join(', ')})
			<Column col={datum.x} />

			y: {datum.y.name} ({datum.y.getData()?.join(', ')})
			<Column col={datum.y} />

			<input type="color" bind:value={datum.colour} />
		{/each}
	</div>
{/snippet}

{#snippet plot(theData)}
	<svg width={theData.width} height={theData.height} style="background: grey;">
		{#each theData.plot.data as datum}
			{#if datum.polyline}
				<polyline fill="none" stroke={datum.colour} stroke-width="3" points={datum.polyline} />
			{/if}
		{/each}
	</svg>
{/snippet}

{#if which === 'plot'}
	{@render plot(theData)}
{:else if which === 'controls'}
	{@render controls(theData)}
{/if}
