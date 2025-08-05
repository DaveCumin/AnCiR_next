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

		plotwidth = $derived(
			this.parentBox.width - this.padding.left - this.axisLeftWidth - this.padding.right
		);

		//TODO: this isn't wokring quite right... ???
		lastaxisLeftWidth = $state(0);
		axisLeftWidth = $derived.by(() => {
			//$inspect.trace('in axisLeftWidth');
			let out = -Infinity;
			this.ylims;
			this.xlims;
			this.ylabel;
			let plot = document.getElementById('plot' + this.parentBox.id);
			if (plot) {
				let plotRect = plot?.getBoundingClientRect();
				let intendedAxisLeft = plotRect.left + this.padding.left;
				let axesLeft = plot?.querySelectorAll('.axis-left');

				for (let i = 0; i < axesLeft.length; i++) {
					let axisRect = axesLeft[i].getBoundingClientRect();
					let actualAxisLeft = axisRect.left;
					console.log('intended ', intendedAxisLeft, ', actual ', actualAxisLeft);
					// If axis extends to the left of intended position, that's overhang
					if (actualAxisLeft != intendedAxisLeft) {
						out = Math.max(out, intendedAxisLeft - actualAxisLeft);
					}
				}
			}
			if (out > this.padding.left) {
				this.lastaxisLeftWidth = out;
			}
			console.log('returnning ', this.lastaxisLeftWidth);
			return this.lastaxisLeftWidth;
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
				console.log(this.data[i].y);
				let tempy = this.data[i].y.getData() ?? [];
				console.log(tempy);
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
				let tempx = this.data[i].x.getData() ?? [];

				tempx = tempx.map((x) => Number(x)); // Ensure all values are numbers
				xmin = min([xmin, ...tempx]);
				xmax = max([xmax, ...tempx]);
			});
			return [
				this.xlimsIN[0] != null ? this.xlimsIN[0] : xmin,
				this.xlimsIN[1] != null ? this.xlimsIN[1] : xmax
			];
		});
		xlabel = $state('');
		ylabel = $state(null);
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
	import Icon from '$lib/icons/Icon.svelte';

	let { theData, which } = $props();

	let currentControlTab = $state('properties');

	//Tooltip
	let tooltip = $state({ visible: false, x: 0, y: 0, content: '' });
	function handleTooltip(event) {
		tooltip = event.detail;
	}
</script>

{#snippet controls(theData)}
	<div class="control-tag">
		<button
			class={currentControlTab === 'properties' ? 'active' : ''}
			onclick={() => (currentControlTab = 'properties')}>Properties</button
		>
		<button
			class={currentControlTab === 'data' ? 'active' : ''}
			onclick={() => (currentControlTab = 'data')}>Data</button
		>
	</div>

	<div class="div-line"></div>

	{#if currentControlTab === 'properties'}
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
				<p>Y-Axis</p>
			</div>
			<div class="control-input-vertical">
				<div class="control-input">
					<p>Label</p>
					<input bind:value={theData.ylabel} />
				</div>
			</div>

			<div class="control-input-horizontal">
				<div class="control-input">
					<p>Min</p>
					<input
						type="number"
						step="0.1"
						value={theData.ylimsIN[0] ? theData.ylimsIN[0] : theData.ylims[0]}
						oninput={(e) => {
							theData.ylimsIN[0] = parseFloat(e.target.value);
						}}
					/>
				</div>

				<div class="control-input">
					<p>Max</p>
					<input
						type="number"
						step="0.1"
						value={theData.ylimsIN[1] ? theData.ylimsIN[1] : theData.ylims[1]}
						oninput={(e) => {
							theData.ylimsIN[1] = parseFloat(e.target.value);
						}}
					/>
				</div>

				{#if theData.ylimsIN[0] != null || theData.ylimsIN[1] != null}
					<div class="control-component-input-icons">
						<button class="icon" onclick={() => (theData.ylimsIN = [null, null])}>
							<Icon name="reset" width={14} height={14} className="control-component-input-icon" />
						</button>
					</div>
				{/if}
			</div>
			<div class="control-input-vertical">
				<div class="control-input-checkbox">
					<input type="checkbox" bind:checked={theData.ygridlines} />
					<p>Grid</p>
				</div>
			</div>

			<div class="control-component-title">
				<p>X-Axis</p>
			</div>
			<div class="control-input-vertical">
				<div class="control-input">
					<p>Label</p>
					<input bind:value={theData.xlabel} />
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
							oninput={(e) => {
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
							oninput={(e) => {
								theData.xlimsIN[1] = parseFloat(e.target.value);
							}}
						/>
					</div>
				{/if}
				{#if theData.xlimsIN[0] != null || theData.xlimsIN[1] != null}
					<div class="control-component-input-icons">
						<button class="icon" onclick={() => (theData.xlimsIN = [null, null])}>
							<Icon name="reset" width={14} height={14} className="control-component-input-icon" />
						</button>
					</div>
				{/if}
			</div>
			<div class="control-input-vertical">
				<div class="control-input-checkbox">
					<input type="checkbox" bind:checked={theData.xgridlines} />
					<p>Grid</p>
				</div>
			</div>
		</div>
	{:else if currentControlTab === 'data'}
		<div>
			<div class="heading">
				<p>Data</p>
				<div class="add">
					<button
						class="icon"
						onclick={() =>
							theData.addData({
								x: { refId: -1 },
								y: { refId: -1 }
							})}
					>
						<Icon name="add" width={16} height={16} />
					</button>
				</div>
			</div>

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
				line width: <input type="number" step="0.2" min="0.1" bind:value={datum.linestrokeWidth} />
				point col: <ColourPicker bind:value={datum.pointcolour} />
				point radius: <input type="number" step="0.2" min="0.1" bind:value={datum.pointradius} />
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
			plotPadding={theData.plot.padding}
			axisLeftWidth={theData.plot.axisLeftWidth}
			nticks={5}
			gridlines={theData.plot.ygridlines}
			label={theData.plot.ylabel}
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
			plotPadding={theData.plot.padding}
			axisLeftWidth={theData.plot.axisLeftWidth}
			nticks={5}
			gridlines={theData.plot.xgridlines}
			label={theData.plot.xlabel}
		/>
		<!-- EXTRA FOR TESTING-->
		<!-- <Axis
			height={theData.plot.plotheight}
			width={theData.plot.plotwidth}
			scale={scaleLinear()
				.domain([theData.plot.ylims[0], theData.plot.ylims[1]])
				.range([theData.plot.plotheight, 0])}
			position="right"
			plotPadding={theData.plot.padding}
			axisLeftWidth={theData.plot.axisLeftWidth}
			nticks={5}
			gridlines={theData.plot.ygridlines}
			label={theData.plot.ylabel}
		/>

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
			position="top"
			plotPadding={theData.plot.padding}
			axisLeftWidth={theData.plot.axisLeftWidth}
			nticks={5}
			gridlines={theData.plot.xgridlines}
			label={theData.plot.xlabel}
		/> -->

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
					xoffset={theData.plot.padding.left + theData.plot.axisLeftWidth}
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
					xoffset={theData.plot.padding.left + theData.plot.axisLeftWidth}
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
	.heading {
		position: sticky;
		top: 0;

		width: 100%;
		height: 4vh;
		display: flex;
		flex-direction: row;
		justify-content: space-between;
		align-items: center;
	}

	.heading p {
		margin-left: 0.75rem;
	}

	.heading button {
		margin-right: 0.65rem;
	}
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
