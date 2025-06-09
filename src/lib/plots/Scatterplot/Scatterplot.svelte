<!-- src/lib/plots/scatter/Scatterplot.svelte -->
<script module>
	import { Column as ColumnClass } from '$lib/core/Column.svelte';
	import Column from '$lib/core/Column.svelte';
	import Axis from '$lib/components/plotbits/Axis.svelte';
	import { scaleLinear } from 'd3-scale';

	import { core } from '$lib/core/theCore.svelte.js';
	import Line from '$lib/components/plotbits/Line.svelte';
	import Points from '$lib/components/plotbits/Points.svelte';

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
		strokeWidth = $state(3);

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
		useCanvas = $state(true);
		container = $state();
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
		xgridlines = $state(true);
		ygridlines = $state(true);

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
	import Container from '$lib/components/plotbits/Container.svelte';

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

		Use Canvas: <input type="checkbox" bind:checked={theData.useCanvas} />

		<p>
			Padding: <input type="number" bind:value={theData.padding.top} />
			<input type="number" bind:value={theData.padding.right} />
			<input type="number" bind:value={theData.padding.bottom} />
			<input type="number" bind:value={theData.padding.left} />
		</p>

		<p>
			ylims: <button onclick={() => (theData.ylimsIN = [null, null])}>R</button>
			grid:<input type="checkbox" bind:checked={theData.ygridlines} />
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
			grid:<input type="checkbox" bind:checked={theData.xgridlines} />
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

			x: {datum.x.name}
			<Column col={datum.x} canChange={true} />

			y: {datum.y.name}
			<Column col={datum.y} canChange={true} />

			<input type="color" bind:value={datum.colour} />
			<input type="number" step="0.1" min="0.1" bind:value={datum.strokeWidth} />
		{/each}
	</div>
{/snippet}

{#snippet plot(theData)}
	<Container
		width={theData.plot.parent.width}
		height={theData.plot.parent.height}
		usecanvas={theData.plot.useCanvas}
		bind:container={theData.plot.container}
	>
		<!-- The Y-axis -->
		<Axis
			height={theData.plot.plotheight}
			width={theData.plot.plotwidth}
			scale={scaleLinear()
				.domain([theData.plot.ylims[0], theData.plot.ylims[1]])
				.range([theData.plot.plotheight, 0])}
			position="left"
			yoffset={theData.plot.padding.top}
			xoffset={theData.plot.padding.left}
			nticks={5}
			gridlines={theData.plot.ygridlines}
			usecanvas={theData.plot.useCanvas}
			container={theData.plot.container}
		/>
		<!-- The X-axis -->
		<Axis
			height={theData.plot.plotheight}
			width={theData.plot.plotwidth}
			scale={scaleLinear()
				.domain([theData.plot.xlims[0], theData.plot.xlims[1]])
				.range([0, theData.plot.plotwidth])}
			position="bottom"
			yoffset={theData.plot.padding.top}
			xoffset={theData.plot.padding.left}
			nticks={5}
			gridlines={theData.plot.xgridlines}
			usecanvas={theData.plot.useCanvas}
			container={theData.plot.container}
		/>

		{#each theData.plot.data as datum}
			<Line
				x={datum.x}
				y={datum.y}
				xscale={scaleLinear()
					.domain([theData.plot.xlims[0], theData.plot.xlims[1]])
					.range([0, theData.plot.plotwidth])}
				yscale={scaleLinear()
					.domain([theData.plot.ylims[0], theData.plot.ylims[1]])
					.range([theData.plot.plotheight, 0])}
				strokeCol={datum.colour}
				strokeWidth={datum.strokeWidth}
				yoffset={theData.plot.padding.top}
				xoffset={theData.plot.padding.left}
				usecanvas={theData.plot.useCanvas}
				container={theData.plot.container}
			/>
			<Points
				x={datum.x}
				y={datum.y}
				xscale={scaleLinear()
					.domain([theData.plot.xlims[0], theData.plot.xlims[1]])
					.range([0, theData.plot.plotwidth])}
				yscale={scaleLinear()
					.domain([theData.plot.ylims[0], theData.plot.ylims[1]])
					.range([theData.plot.plotheight, 0])}
				radius={4}
				fillCol={datum.colour}
				yoffset={theData.plot.padding.top}
				xoffset={theData.plot.padding.left}
				usecanvas={theData.plot.useCanvas}
				container={theData.plot.container}
			/>
		{/each}
	</Container>
{/snippet}

{#if which === 'plot'}
	{@render plot(theData)}
{:else if which === 'controls'}
	{@render controls(theData)}
{/if}
