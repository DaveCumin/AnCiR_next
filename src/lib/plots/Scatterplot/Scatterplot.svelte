<!-- src/lib/plots/scatter/Scatterplot.svelte -->
<script module>
	import { Column as ColumnClass } from '$lib/core/Column.svelte';
	import Column from '$lib/core/Column.svelte';
	import Axis from '$lib/plots/base/Axis.svelte';
	import { scaleLinear } from 'd3-scale';

	import { core } from '$lib/core/theCore.svelte.js';
	import Line from '../base/Line.svelte';

	function getRandomColor() {
		const letters = '0123456789ABCDEF';
		let color = '#';
		for (let i = 0; i < 6; i++) {
			color += letters[Math.floor(Math.random() * 16)];
		}
		return color;
	}

	class ScatterDataclass {
		parent = $state();
		x = $state();
		y = $state();
		colour = $state(getRandomColor());

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
		padding = $state({ top: 15, right: 20, bottom: 30, left: 30 });
		plotheight = $derived(this.parent.height - this.padding.top - this.padding.bottom);
		plotwidth = $derived(this.parent.width - this.padding.left - this.padding.right);
		xlimsIN = $state([null, null]);
		ylimsIN = $state([null, null]);
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
			return [this.ylimsIN[0] ? this.ylimsIN[0] : ymin, this.ylimsIN[1] ? this.ylimsIN[1] : ymax];
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
			return [this.xlimsIN[0] ? this.xlimsIN[0] : xmin, this.xlimsIN[1] ? this.xlimsIN[1] : xmax];
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

		<p>
			Padding: <input type="number" bind:value={theData.padding.top} />
			<input type="number" bind:value={theData.padding.right} />
			<input type="number" bind:value={theData.padding.bottom} />
			<input type="number" bind:value={theData.padding.left} />
		</p>

		<p>
			ylims: <button onclick={() => (theData.ylimsIN = [null, null])}>R</button>
			<input
				type="number"
				value={theData.ylimsIN[0] ? theData.ylimsIN[0] : theData.ylims[0]}
				oninput={(e) => {
					theData.ylimsIN[0] = [parseFloat(e.target.value)];
				}}
			/>
			<input
				type="number"
				value={theData.ylimsIN[1] ? theData.ylimsIN[1] : theData.ylims[1]}
				oninput={(e) => {
					theData.ylimsIN[1] = [parseFloat(e.target.value)];
				}}
			/>
		</p>
		<p>
			xlims: <button onclick={() => (theData.xlimsIN = [null, null])}>R</button>
			<input
				type="number"
				value={theData.xlimsIN[0] ? theData.xlimsIN[0] : theData.xlims[0]}
				oninput={(e) => {
					theData.xlimsIN[0] = [parseFloat(e.target.value)];
				}}
			/>
			<input
				type="number"
				value={theData.xlimsIN[1] ? theData.xlimsIN[1] : theData.xlims[1]}
				oninput={(e) => {
					theData.xlimsIN[1] = [parseFloat(e.target.value)];
				}}
			/>
		</p>
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
			<Column col={datum.x} canChange={true} />

			y: {datum.y.name} ({datum.y.getData()?.join(', ')})
			<Column col={datum.y} canChange={true} />

			<input type="color" bind:value={datum.colour} />
		{/each}
	</div>
{/snippet}

{#snippet plot(theData)}
	<svg
		width={theData.plot.parent.width}
		height={theData.plot.parent.height}
		style={`background: grey;`}
	>
		<!-- Draw the lines for each data set -->
		{#each theData.plot.data as datum}
			<Line
				height={theData.plot.plotheight}
				width={theData.plot.plotwidth}
				x={datum.x.getData()}
				y={datum.y.getData()}
				xlims={theData.plot.xlims}
				ylims={theData.plot.ylims}
				strokeCol={datum.colour}
				strokeWidth="3"
				style={`transform: translate(	${theData.plot.padding.left}px, 
													${theData.plot.padding.top}px);`}
			/>
		{/each}
		<!-- The Y-axis -->
		<Axis
			bind:height={theData.plot.plotheight}
			bind:width={theData.plot.plotwidth}
			scale={scaleLinear()
				.domain([theData.plot.ylims[0], theData.plot.ylims[1]])
				.range([theData.plot.plotheight, 0])}
			position="left"
			yoffset={theData.plot.padding.top}
			xoffset={theData.plot.padding.left}
			nticks={5}
		/>
		<!-- The X-axis -->
		<Axis
			bind:height={theData.plot.plotheight}
			bind:width={theData.plot.plotwidth}
			scale={scaleLinear()
				.domain([theData.plot.xlims[0], theData.plot.xlims[1]])
				.range([0, theData.plot.plotwidth])}
			position="bottom"
			yoffset={theData.plot.padding.top}
			xoffset={theData.plot.padding.left}
			nticks={5}
		/>
	</svg>
{/snippet}

{#if which === 'plot'}
	{@render plot(theData)}
{:else if which === 'controls'}
	{@render controls(theData)}
{/if}
