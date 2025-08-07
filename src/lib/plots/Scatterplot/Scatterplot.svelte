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

		plotwidth = $derived(this.parentBox.width - this.padding.left - this.padding.right);

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

		getAutoScaleValues() {
			//set up outputs
			let axisWidths = { left: null, right: null, top: null, bottom: null };

			//get the svg position
			const leftSVG = document.getElementById('plot' + this.parentBox.id)?.getBoundingClientRect();

			//LEFT
			//find the left-most axis
			const allLeftAxes = document
				.getElementById('plot' + this.parentBox.id)
				?.getElementsByClassName('axis-left');
			if (allLeftAxes.length == 0) {
				//do nothing if there aren't any axes
			} else {
				if (allLeftAxes) {
					let leftMost = 0;
					let leftAxisWhole = allLeftAxes[0].getBoundingClientRect().left;
					for (let i = 1; i < allLeftAxes.length; i++) {
						if (allLeftAxes[i].getBoundingClientRect().left < leftAxisWhole) {
							leftMost = i;
							leftAxisWhole = allLeftAxes[i].getBoundingClientRect().left;
						}
					}
					const leftAxisLine = allLeftAxes[leftMost]
						.getElementsByClassName('domain')[0]
						.getBoundingClientRect().left;
					axisWidths.left = Math.round(leftAxisLine - leftAxisWhole + 6);
				}
			}

			//RIGHT
			//find the left-most axis
			const allRightAxes = document
				.getElementById('plot' + this.parentBox.id)
				.getElementsByClassName('axis-right');
			if (allRightAxes.length == 0) {
				//do nothing if there aren't any axes
			} else {
				if (allRightAxes) {
					let rightMost = 0;
					let rightAxisWhole = allRightAxes[0].getBoundingClientRect().right;
					for (let i = 1; i < allRightAxes.length; i++) {
						if (allRightAxes[i].getBoundingClientRect().right > rightAxisWhole) {
							rightMost = i;
							rightAxisWhole = allRightAxes[i].getBoundingClientRect().right;
						}
					}
					const rightAxisLine = allRightAxes[rightMost]
						.getElementsByClassName('domain')[0]
						.getBoundingClientRect().right;
					axisWidths.right = Math.round(rightAxisWhole - rightAxisLine + 6);
				}
			}

			//TOP
			//find the top-most axis
			const allTopAxes = document
				.getElementById('plot' + this.parentBox.id)
				.getElementsByClassName('axis-top');
			if (allTopAxes.length == 0) {
				//do nothing if there aren't any axes
			} else {
				if (allTopAxes) {
					let topMost = 0;
					let topAxisWhole = allTopAxes[0].getBoundingClientRect().top;
					for (let i = 1; i < allTopAxes.length; i++) {
						if (allTopAxes[i].getBoundingClientRect().top < topAxisWhole) {
							topMost = i;
							topAxisWhole = allTopAxes[i].getBoundingClientRect().top;
						}
					}
					const topAxisLine = allTopAxes[topMost]
						.getElementsByClassName('domain')[0]
						.getBoundingClientRect().top;
					axisWidths.top = Math.round(topAxisLine - topAxisWhole + 6);
				}
			}

			//BOTTOM
			//find the left-most axis
			const allBottomAxes = document
				.getElementById('plot' + this.parentBox.id)
				.getElementsByClassName('axis-bottom');
			if (allBottomAxes.length == 0) {
				//do nothing if there aren't any axes
			} else {
				if (allBottomAxes) {
					let bottomMost = 0;
					let bottomAxisWhole = allBottomAxes[0].getBoundingClientRect().bottom;
					for (let i = 1; i < allBottomAxes.length; i++) {
						if (allBottomAxes[i].getBoundingClientRect().bottom > bottomAxisWhole) {
							bottomMost = i;
							bottomAxisWhole = allBottomAxes[i].getBoundingClientRect().bottom;
						}
					}
					const bottomAxisLine = allBottomAxes[bottomMost]
						.getElementsByClassName('domain')[0]
						.getBoundingClientRect().bottom;
					axisWidths.bottom = Math.round(bottomAxisWhole - bottomAxisLine + 6);
				}
			}

			return axisWidths;
		}

		autoScalePadding(side) {
			if (side == 'all') {
				['top', 'left', 'right', 'bottom'].forEach((theSide) => {
					this.padding[theSide] = this.getAutoScaleValues()[theSide] || this.padding[theSide];
				});
			} else {
				this.padding[side] = this.getAutoScaleValues()[side];
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
	import { onMount } from 'svelte';

	let { theData, which } = $props();

	let currentControlTab = $state('properties');

	//Tooltip
	let tooltip = $state({ visible: false, x: 0, y: 0, content: '' });
	function handleTooltip(event) {
		tooltip = event.detail;
	}

	onMount(() => {
		if (which == 'plot') {
			theData.plot.autoScalePadding('all');
		}
	});
	//check for axes if the labels change
	$effect(() => {
		if (which == 'controls') {
			theData.ylabel;
			theData.xlabel;

			theData.autoScalePadding('all');
		}
	});
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
				{#if theData.getAutoScaleValues()?.top != theData.padding.top || theData.getAutoScaleValues()?.bottom != theData.padding.bottom || theData.getAutoScaleValues()?.left != theData.padding.left || theData.getAutoScaleValues()?.right != theData.padding.right}
					<button class="icon" onclick={() => theData.autoScalePadding('all')}>
						<Icon name="reset" width={14} height={14} className="control-component-input-icon" />
					</button>
				{/if}
			</div>
			<div class="control-input-square">
				<div class="control-input">
					<p>Top</p>
					<div style="display: flex;  justify-content: flex-start; align-items: center; gap: 8px;">
						<input
							type="number"
							bind:value={theData.padding.top}
							style="width: calc(100% - {theData.getAutoScaleValues()?.top != null &&
							theData.getAutoScaleValues().top != theData.padding.top
								? 24
								: 0}px)"
						/>
						{#if theData.getAutoScaleValues()?.top != null && theData.getAutoScaleValues()?.top != theData.padding.top}
							<button class="icon" onclick={() => theData.autoScalePadding('top')}>
								<Icon
									name="reset"
									width={14}
									height={14}
									className="control-component-input-icon"
								/>
							</button>
						{/if}
					</div>
				</div>

				<div class="control-input">
					<p>Bottom</p>
					<div
						style="    display: flex;  justify-content: flex-start; align-items: center; gap: 8px;"
					>
						<input
							type="number"
							bind:value={theData.padding.bottom}
							style="width: calc(100% - {theData.getAutoScaleValues()?.bottom != null &&
							theData.getAutoScaleValues().bottom != theData.padding.bottom
								? 24
								: 0}px)"
						/>
						{#if theData.getAutoScaleValues()?.bottom != null && theData.getAutoScaleValues()?.bottom != theData.padding.bottom}
							<button class="icon" onclick={() => theData.autoScalePadding('bottom')}>
								<Icon
									name="reset"
									width={14}
									height={14}
									className="control-component-input-icon"
								/>
							</button>
						{/if}
					</div>
				</div>

				<div class="control-input">
					<p>Left</p>
					<div
						style="    display: flex;  justify-content: flex-start; align-items: center; gap: 8px;"
					>
						<input
							type="number"
							bind:value={theData.padding.left}
							style="width: calc(100% - {theData.getAutoScaleValues()?.left != null &&
							theData.getAutoScaleValues().left != theData.padding.left
								? 24
								: 0}px)"
						/>
						{#if theData.getAutoScaleValues()?.left != null && theData.getAutoScaleValues()?.left != theData.padding.left}
							<button class="icon" onclick={() => theData.autoScalePadding('left')}>
								<Icon
									name="reset"
									width={14}
									height={14}
									className="control-component-input-icon"
								/>
							</button>
						{/if}
					</div>
				</div>

				<div class="control-input">
					<p>Right</p>
					<div
						style="    display: flex;  justify-content: flex-start; align-items: center; gap: 8px;"
					>
						<input
							type="number"
							bind:value={theData.padding.right}
							style="width: calc(100% - {theData.getAutoScaleValues()?.right != null &&
							theData.getAutoScaleValues().right != theData.padding.right
								? 24
								: 0}px)"
						/>
						{#if theData.getAutoScaleValues()?.right != null && theData.getAutoScaleValues()?.right != theData.padding.right}
							<button class="icon" onclick={() => theData.autoScalePadding('right')}>
								<Icon
									name="reset"
									width={14}
									height={14}
									className="control-component-input-icon"
								/>
							</button>
						{/if}
					</div>
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
