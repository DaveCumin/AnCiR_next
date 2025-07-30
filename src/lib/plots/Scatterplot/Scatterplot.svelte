<script module>
	import { Column as ColumnClass } from '$lib/core/Column.svelte';
	import Column from '$lib/core/Column.svelte';
	import Axis from '$lib/components/plotBits/Axis.svelte';
	import { scaleLinear, scaleTime } from 'd3-scale';
	import ColourPicker, { getPaletteColor } from '$lib/components/inputs/ColourPicker.svelte';
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
				this.x = new ColumnClass({ refId: -1 });
			}
			if (dataIN?.y) {
				this.y = ColumnClass.fromJSON(dataIN.y);
			} else {
				this.y = new ColumnClass({ refId: -1 });
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

		plotwidth = $derived.by(() => {
			this.ylims;
			this.xlims;
			let plot = document.getElementById('plot' + this.parentBox.id);
			let axisLeftRectOffset = 0;
			if (plot) {
				let plotRect = plot?.getBoundingClientRect();
				let axesLeft = plot?.querySelectorAll('.axis-left');

				for (let i = 0; i < axesLeft.length; i++) {
					let axisRect = axesLeft[i].getBoundingClientRect();
					axisLeftRectOffset = plotRect.left - axisRect.left;
				}
			}
			this.padding.left += Math.ceil(axisLeftRectOffset);
			return this.parentBox.width - this.padding.left - this.padding.right;
		});

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
	import { appState } from '$lib/core/core.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import { onMount } from 'svelte';

	let { theData, which } = $props();

	//Tooltip
	let tooltip = $state({ visible: false, x: 0, y: 0, content: '' });
	function handleTooltip(event) {
		tooltip = event.detail;
	}

	onMount(() => {
		if (which == 'plot') {
			let plot = document.getElementById('plot' + theData.id);
			let axisLeftRectOffset = 0;
			if (plot) {
				let plotRect = plot?.getBoundingClientRect();
				let axesLeft = plot?.querySelectorAll('.axis-left');

				for (let i = 0; i < axesLeft.length; i++) {
					let axisRect = axesLeft[i].getBoundingClientRect();
					console.log(axisRect);
					console.log(axisRect.left, plotRect.left);
					axisLeftRectOffset = Math.max(axisLeftRectOffset, plotRect.left - axisRect.left);
				}
			}
			console.log(theData);
			theData.plot.padding.left += Math.ceil(axisLeftRectOffset);
			return theData.plot.parentBox.width - theData.plot.padding.left - theData.plot.padding.right;
		}
	});
</script>

{#snippet controls(theData)}
	{#if appState.currentControlTab === 'properties'}
		<div class="control-component">
			<div class="control-input-vertical">
				<div class="control-input">
					<p>Name</p>
					<input type="text" bind:value={theData.parentBox.name} />
				</div>
			</div>
		</div>

		<div class="control-component">
			<div class="control-input-horizontal">
				<div class="control-input">
					<p>Width</p>
					<input type="number" bind:value={theData.parentBox.width} />
				</div>

				<div class="control-input">
					<p>Height</p>
					<input type="number" bind:value={theData.parentBox.height} />
				</div>
			</div>
		</div>

		<div class="div-line"></div>

		<div class="control-component">
			<div class="control-component-title">
				<p>Padding</p>
			</div>

			<div class="control-input-square">
				<div class="control-input">
					<p>Top</p>
					<input type="number" bind:value={theData.padding.top} />
				</div>

				<div class="control-input">
					<p>Bottom</p>
					<input type="number" bind:value={theData.padding.bottom} />
				</div>

				<div class="control-input">
					<p>Left</p>
					<input type="number" bind:value={theData.padding.left} />
				</div>

				<div class="control-input">
					<p>Right</p>
					<input type="number" bind:value={theData.padding.right} />
				</div>
			</div>
		</div>

		<div class="div-line"></div>

		<div class="control-component">
			<div class="control-component-title">
				<p>X-lims</p>
				<div class="control-component-title-icons">
					<button class="icon" onclick={() => (theData.xlimsIN = [null, null])}>
						<Icon name="reset" width={14} height={14} className="control-component-title-icon" />
					</button>
				</div>
			</div>

			<div class="control-input-vertical">
				<div class="control-input-checkbox">
					<input type="checkbox" bind:checked={theData.xgridlines} />
					<p>Grid</p>
				</div>
			</div>

			<div class="control-input-horizontal">
				{#if theData.anyXdataTime}
					<div class="control-input">
						<p>Min</p>
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
					</div>

					<div class="control-input">
						<p>Max</p>
						<input
							type="datetime-local"
							value={theData.xlimsIN[1]
								? new Date(theData.xlimsIN[1]).toISOString().substring(0, 16)
								: new Date(theData.xlims[1]).toISOString().substring(0, 16)}
							oninput={(e) => {
								theData.xlimsIN[1] = Number(new Date(e.target.value));
							}}
						/>
					</div>
				{:else}
					<div class="control-input">
						<p>Min</p>
						<input
							type="number"
							step="0.1"
							value={theData.xlimsIN[0] ? theData.xlimsIN[0] : theData.xlims[0]}
							onchange={(e) => {
								theData.xlimsIN[0] = parseFloat(e.target.value);
							}}
						/>
					</div>

					<div class="control-input">
						<p>Max</p>
						<input
							type="number"
							step="0.1"
							value={theData.xlimsIN[1] ? theData.xlimsIN[1] : theData.xlims[1]}
							onchange={(e) => {
								theData.xlimsIN[1] = parseFloat(e.target.value);
							}}
						/>
					</div>
				{/if}
			</div>
		</div>
	{:else if appState.currentControlTab === 'data'}
		<div>
			<p>Data:</p>
			<button
				onclick={() =>
					theData.addData({
						x: { refId: -1 },
						y: { refId: -1 }
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

				line col: <ColourPicker bind:value={datum.linecolour} />
				line width: <input type="number" step="0.1" min="0.1" bind:value={datum.linestrokeWidth} />
				point col: <ColourPicker bind:value={datum.pointcolour} />
				point radius: <input type="number" step="0.1" min="0.1" bind:value={datum.pointradius} />
			{/each}
		</div>
	{/if}
{/snippet}

{#snippet plot(theData)}
	<svg
		id={'plot' + theData.plot.parentBox.id}
		width={theData.plot.parentBox.width}
		height={theData.plot.parentBox.height}
		viewBox="0 0 {theData.plot.parentBox.width} {theData.plot.parentBox.height}"
		style={`background: white; position: absolute;`}
		ontooltip={handleTooltip}
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
					xtype={datum.x.type}
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
					tooltip={true}
				/>
			{/if}
		{/each}
	</svg>
	{#if tooltip.visible}
		<div class="tooltip" style={`left: ${tooltip.x}px; top: ${tooltip.y}px;`}>
			{tooltip.content}
		</div>
	{/if}
{/snippet}

{#if which === 'plot'}
	{@render plot(theData)}
{:else if which === 'controls'}
	{@render controls(theData)}
{/if}

<style>
	.tooltip {
		position: absolute;
		background-color: rgba(0, 0, 0, 0.7);
		color: white;
		padding: 0.5rem 0.8rem;
		border-radius: 4px;
		pointer-events: none;
		font-size: 0.8rem;
		z-index: 9999;
	}
</style>
