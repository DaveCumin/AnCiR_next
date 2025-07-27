<script module>
	import { Column as ColumnClass } from '$lib/core/Column.svelte';
	import Column from '$lib/core/Column.svelte';
	import Axis from '$lib/components/plotbits/Axis.svelte';
	import { scaleLinear, scaleTime } from 'd3-scale';
	import { getPaletteColor } from '$lib/components/inputs/ColourPicker.svelte';
	import { core } from '$lib/core/core.svelte.js';
	import Line from '$lib/components/plotbits/Line.svelte';
	import Points from '$lib/components/plotbits/Points.svelte';
	import { min, max } from '$lib/components/plotbits/helpers/wrangleData.js';

	export const Scatterplot_defaultDataInputs = ['x', 'y'];

	class ScatterDataclass {
		parentPlot = $state();
		x = $state();
		y = $state();
		linecolour = $state();
		linestrokeWidth = $state(3);
		pointcolour = $state();
		pointradius = $state(5);

		constructor(parent, dataIN) {
			this.parentPlot = parent;

			if (dataIN?.x) {
				this.x = ColumnClass.fromJSON(dataIN.x);
			} else {
				this.x = new ColumnClass({ refDataId: -1 });
			}
			if (dataIN?.y) {
				this.y = ColumnClass.fromJSON(dataIN.y);
			} else {
				this.y = new ColumnClass({ refDataId: -1 });
			}
			this.linecolour = dataIN?.linecolour ?? getPaletteColor(this.parentPlot.data.length);
			this.pointcolour = dataIN?.pointcolour ?? getPaletteColor(this.parentPlot.data.length);
		}

		toJSON() {
			return {
				x: this.x,
				y: this.y,
				linecolour: this.linecolour,
				linestrokeWidth: this.linestrokeWidth,
				pointcolour: this.pointcolour,
				pointradius: this.pointradius
			};
		}

		static fromJSON(json, parent) {
			return new ScatterDataclass(parent, {
				x: json.x,
				y: json.y,
				linecolour: json.linecolour,
				linestrokeWidth: json.linestrokeWidth,
				pointcolour: json.pointcolour,
				pointradius: json.pointradius
			});
		}
	}

	export class Scatterplotclass {
		parentBox = $state();
		data = $state([]);
		padding = $state({ top: 15, right: 20, bottom: 30, left: 30 });
		plotheight = $derived(this.parentBox.height - this.padding.top - this.padding.bottom);

		plotwidth = $derived(this.parentBox.width - this.padding.left - this.padding.right);
		// //TODO: make this happen from the start (or when axis/axes update)
		// plotwidth = $derived.by(() => {
		// 	console.log(this.parentBox.width);

		// 	let plot = document.getElementById('plot' + this.parentBox.id);
		// 	let axisLeftRectOffset = 0;
		// 	if (plot) {
		// 		let plotRect = plot?.getBoundingClientRect();
		// 		let axesLeft = plot?.querySelectorAll('.axis-left');

		// 		for (let i = 0; i < axesLeft.length; i++) {
		// 			let axisRect = axesLeft[i].getBoundingClientRect();
		// 			console.log(axisRect);
		// 			console.log(axisRect.left, plotRect.left);
		// 			if (plotRect.left - axisRect.left > 0) {
		// 				axisLeftRectOffset = Math.max(axisLeftRectOffset, plotRect.left - axisRect.left);
		// 			}
		// 		}
		// 	}
		// 	this.padding.left += axisLeftRectOffset;
		// 	return this.parentBox.width - this.padding.left - this.padding.right;
		// });

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
				ymin = min([ymin, ...tempy]);
				ymax = max([ymax, ...tempy]);
			});
			return [
				this.ylimsIN[0] != null ? this.ylimsIN[0] : ymin,
				this.ylimsIN[1] != null ? this.ylimsIN[1] : ymax
			];
		});
		xlims = $derived.by(() => {
			if (this.data.length === 0) {
				return [0, 0];
			}

			let xmin = Infinity;
			let xmax = -Infinity;
			this.data.forEach((d, i) => {
				let tempx = this.data[i].x.getData();

				tempx = tempx.map((x) => Number(x)); // Ensure all values are numbers
				xmin = min([xmin, ...tempx]);
				xmax = max([xmax, ...tempx]);
			});
			return [
				this.xlimsIN[0] != null ? this.xlimsIN[0] : xmin,
				this.xlimsIN[1] != null ? this.xlimsIN[1] : xmax
			];
		});
		xgridlines = $state(true);
		ygridlines = $state(true);
		anyXdataTime = $derived.by(() => {
			if (this.data.length === 0) {
				return false;
			}
			return this.data.some((d) => d.x.type === 'time');
		});

		constructor(parent, dataIN) {
			this.parentBox = parent;
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
				xlimsIN: this.xlimsIN,
				ylimsIN: this.ylimsIN,
				padding: this.padding,
				ygridlines: this.ygridlines,
				xgridlines: this.xgridlines,
				data: this.data
			};
		}
		static fromJSON(parent, json) {
			if (!json) {
				return new Scatterplotclass(parent, null);
			}

			const scatter = new Scatterplotclass(parent, null);
			scatter.padding = json.padding;
			scatter.xlimsIN = json.xlimsIN;
			scatter.ylimsIN = json.ylimsIN;
			scatter.padding = json.padding;
			scatter.ygridlines = json.ygridlines;
			scatter.xgridlines = json.xgridlines;

			if (json.data) {
				scatter.data = json.data.map((d) => ScatterDataclass.fromJSON(d, scatter));
			}
			return scatter;
		}
	}
</script>

<script>
	import SavePlot from '$lib/components/iconActions/SavePlot.svelte';
	let { theData, which } = $props();

	function pickRandomData() {
		const options = Array.from(core.data.keys());
		return options.length > 0 ? options[Math.floor(Math.random() * options.length)] : -1;
	}
	let addBtnRef;
	let showSavePlot = $state(false);
	let dropdownTop = $state(0);
	let dropdownLeft = $state(0);

	function recalculateDropdownPosition() {
		if (!addBtnRef) return;
		const rect = addBtnRef.getBoundingClientRect();

		dropdownTop = rect.top + window.scrollY;
		dropdownLeft = rect.right + window.scrollX + 12;
	}

	function openDropdown() {
		recalculateDropdownPosition();
		requestAnimationFrame(() => {
			showSavePlot = true;
		});
		window.addEventListener('resize', recalculateDropdownPosition);
	}
</script>

{#snippet controls(theData)}
	<div><button bind:this={addBtnRef} onclick={openDropdown}>Save</button></div>
	<div>
		Name: <input type="text" bind:value={theData.parentBox.name} />
		Width: <input type="number" bind:value={theData.parentBox.width} />
		height: <input type="number" bind:value={theData.parentBox.height} />

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
				step="0.1"
				value={theData.ylimsIN[0] ? theData.ylimsIN[0] : theData.ylims[0]}
				oninput={(e) => {
					theData.ylimsIN[0] = [parseFloat(e.target.value)];
				}}
			/>
			<input
				type="number"
				step="0.1"
				value={theData.ylimsIN[1] ? theData.ylimsIN[1] : theData.ylims[1]}
				oninput={(e) => {
					theData.ylimsIN[1] = [parseFloat(e.target.value)];
				}}
			/>
		</p>
		<p>
			xlims: <button onclick={() => (theData.xlimsIN = [null, null])}>R</button>
			grid:<input type="checkbox" bind:checked={theData.xgridlines} />
			{#if theData.anyXdataTime}
				<input
					type="datetime-local"
					value={theData.xlimsIN[0]
						? new Date(theData.xlimsIN[0]).toISOString().substring(0, 16)
						: new Date(theData.xlims[0]).toISOString().substring(0, 16)}
					oninput={(e) => {
						console.log('xlimsIN[0]', e.target.value);
						theData.xlimsIN[0] = Number(new Date(e.target.value));
					}}
				/>
				<input
					type="datetime-local"
					value={theData.xlimsIN[1]
						? new Date(theData.xlimsIN[1]).toISOString().substring(0, 16)
						: new Date(theData.xlims[1]).toISOString().substring(0, 16)}
					oninput={(e) => {
						theData.xlimsIN[1] = Number(new Date(e.target.value));
					}}
				/>
			{:else}
				<input
					type="number"
					step="0.1"
					value={theData.xlimsIN[0] ? theData.xlimsIN[0] : theData.xlims[0]}
					oninput={(e) => {
						theData.xlimsIN[0] = parseFloat(e.target.value);
					}}
				/>
				<input
					type="number"
					step="0.1"
					value={theData.xlimsIN[1] ? theData.xlimsIN[1] : theData.xlims[1]}
					oninput={(e) => {
						theData.xlimsIN[1] = parseFloat(e.target.value);
					}}
				/>
			{/if}
		</p>
		<p>Data:</p>
		<button
			onclick={() =>
				theData.addData({
					x: { refDataId: -1 },
					y: { refDataId: -1 }
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

			line col: <input type="color" bind:value={datum.linecolour} />
			line width: <input type="number" step="0.1" min="0.1" bind:value={datum.linestrokeWidth} />
			point col: <input type="color" bind:value={datum.pointcolour} />
			point radius: <input type="number" step="0.1" min="0.1" bind:value={datum.pointradius} />
		{/each}
	</div>

	{#if showSavePlot}
		<SavePlot
			bind:showDropdown={showSavePlot}
			{dropdownTop}
			{dropdownLeft}
			Id={'plot' + theData.parentBox.id}
		/>
	{/if}
{/snippet}

{#snippet plot(theData)}
	<svg
		id={'plot' + theData.plot.parentBox.id}
		width={theData.plot.parentBox.width}
		height={theData.plot.parentBox.height}
		viewBox="0 0 {theData.plot.parentBox.width} {theData.plot.parentBox.height}"
		style={`background: white; position: absolute;`}
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
		/>
		<!-- The X-axis -->
		<Axis
			height={theData.plot.plotheight}
			width={theData.plot.plotwidth}
			scale={theData.plot.anyXdataTime
				? scaleTime()
						.domain([theData.plot.xlims[0], theData.plot.xlims[1]])
						.range([0, theData.plot.plotwidth])
				: scaleLinear()
						.domain([theData.plot.xlims[0], theData.plot.xlims[1]])
						.range([0, theData.plot.plotwidth])}
			position="bottom"
			yoffset={theData.plot.padding.top}
			xoffset={theData.plot.padding.left}
			nticks={5}
			gridlines={theData.plot.xgridlines}
		/>

		{#each theData.plot.data as datum}
			{#if datum.x.getData()?.length > 0 && datum.y.getData()?.length > 0}
				<Line
					x={datum.x.getData()}
					y={datum.y.getData()}
					xscale={scaleLinear()
						.domain([theData.plot.xlims[0], theData.plot.xlims[1]])
						.range([0, theData.plot.plotwidth])}
					yscale={scaleLinear()
						.domain([theData.plot.ylims[0], theData.plot.ylims[1]])
						.range([theData.plot.plotheight, 0])}
					strokeCol={datum.linecolour}
					strokeWidth={datum.linestrokeWidth}
					yoffset={theData.plot.padding.top}
					xoffset={theData.plot.padding.left}
				/>
				<Points
					x={datum.x.getData()}
					y={datum.y.getData()}
					xscale={scaleLinear()
						.domain([theData.plot.xlims[0], theData.plot.xlims[1]])
						.range([0, theData.plot.plotwidth])}
					yscale={scaleLinear()
						.domain([theData.plot.ylims[0], theData.plot.ylims[1]])
						.range([theData.plot.plotheight, 0])}
					radius={datum.pointradius}
					fillCol={datum.pointcolour}
					yoffset={theData.plot.padding.top}
					xoffset={theData.plot.padding.left}
				/>
			{/if}
		{/each}
	</svg>
{/snippet}

{#if which === 'plot'}
	{@render plot(theData)}
{:else if which === 'controls'}
	{@render controls(theData)}
{/if}
