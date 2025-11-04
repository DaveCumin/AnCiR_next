<script module>
	import { Column as ColumnClass } from '$lib/core/Column.svelte';
	import Column from '$lib/core/Column.svelte';
	import Axis from '$lib/components/plotBits/Axis.svelte';
	import { scaleLinear, scaleTime } from 'd3-scale';
	import Line, { LineClass } from '$lib/components/plotbits/Line.svelte';
	import Points, { PointsClass } from '$lib/components/plotBits/Points.svelte';
	import { min, max } from '$lib/components/plotbits/helpers/wrangleData.js';
	import { dataSettingsScrollTo } from '$lib/components/views/ControlDisplay.svelte';

	export const Scatterplot_defaultDataInputs = ['x', 'y'];

	class ScatterDataclass {
		parentPlot = $state();
		x = $state();
		y = $state();
		label = $state('test');
		line = $state();
		points = $state();

		constructor(parent, dataIN) {
			this.parentPlot = parent;
			if (dataIN?.x) {
				//if there's data, use it!
				this.x = ColumnClass.fromJSON(dataIN.x);
			} else {
				if (parent.data.length > 0) {
					this.x = new ColumnClass({ refId: parent.data[parent.data.length - 1].x.refId });
				} else {
					//blank one
					this.x = new ColumnClass({ refId: -1 });
				}
			}
			if (dataIN?.y) {
				this.y = ColumnClass.fromJSON(dataIN.y);
			} else {
				this.y = new ColumnClass({ refId: -1 });
			}
			if (dataIN?.label) {
				this.label = dataIN.label;
			} else {
				this.label = 'Data ' + (parent.data.length + 1);
			}
			this.line = new LineClass(dataIN?.line, this);
			if (!dataIN?.line) {
				this.line.draw = false;
			}
			this.points = new PointsClass(dataIN?.points, this);
		}

		getLegendItem() {
			// Return a single legend item that represents this data series
			const item = {
				label: this.label,
				elements: []
			};

			// Add line representation if line is visible
			if (this.line.draw) {
				item.elements.push({
					type: 'line',
					color: this.line.colour,
					strokeWidth: this.line.strokeWidth,
					stroke: this.line.stroke,
					smoother: this.line.showSmoother
						? {
								color: this.line.smootherColour,
								strokeWidth: this.line.smootherStrokeWidth,
								stroke: this.line.smootherStroke
							}
						: null
				});
			}

			// Add points representation if points are visible
			if (this.points.draw) {
				item.elements.push({
					type: 'points',
					color: this.points.colour,
					size: this.points.radius,
					shape: this.points.shape
				});
			}

			// If neither line nor points are visible, don't show in legend
			if (item.elements.length === 0) return null;
			console.log(item);
			return item;
		}

		toJSON() {
			return {
				x: this.x,
				y: this.y,
				label: this.label,
				line: this.line.toJSON(),
				points: this.points.toJSON()
			};
		}

		static fromJSON(json, parent) {
			return new ScatterDataclass(parent, {
				x: json.x,
				y: json.y,
				label: json.label,
				line: LineClass.fromJSON(json.line),
				points: PointsClass.fromJSON(json.points)
			});
		}
	}

	export class Scatterplotclass {
		parentBox = $state();
		data = $state([]);
		legend = $state();

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
				if (this.anyXdataTime && this.data[i].x.type !== 'time') {
					//skip time data here
					return;
				}
				let tempx = this.data[i].x.getData() ?? [];

				tempx = tempx.map((x) => Number(x)); // Ensure all values are numbers
				xmin = Math.floor(min([xmin, ...tempx]));
				xmax = Math.ceil(max([xmax, ...tempx]));
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
			this.legend = new LegendClass(dataIN?.legend);
			if (dataIN) {
				this.addData(dataIN);
			}
		}

		getAutoScaleValues() {
			//set up outputs
			let axisWidths = { left: null, right: null, top: null, bottom: null };
			if (!document.getElementById('plot' + this.parentBox.id)) {
				return axisWidths;
			}
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

		// Collect all legend items
		getLegendItems = $derived.by(() => {
			const items = [];
			this.data.forEach((datum) => {
				const legendItem = datum.getLegendItem();
				if (legendItem) {
					// Only add if the data series has visible elements
					items.push(legendItem);
				}
			});
			return items;
		});

		toJSON() {
			return {
				xlimsIN: this.xlimsIN,
				ylimsIN: this.ylimsIN,
				padding: this.padding,
				ygridlines: this.ygridlines,
				xgridlines: this.xgridlines,
				data: this.data,
				legend: this.legend.toJSON()
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
			scatter.legend = LegendClass.fromJSON(json.legend);
			return scatter;
		}
	}
</script>

<script>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import { appState } from '$lib/core/core.svelte';
	import { onMount } from 'svelte';
	import { flip } from 'svelte/animate';
	import { slide } from 'svelte/transition';
	import { tick } from 'svelte';
	import Legend, { LegendClass } from '$lib/components/plotbits/Legend.svelte';

	let { theData, which } = $props();

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
			theData.xlims;
			theData.ylims;

			theData.autoScalePadding('all');
		}
	});
</script>

{#snippet controls(theData)}
	{#if appState.currentControlTab === 'properties'}
		<div class="control-component">
			<div class="control-component-title">
				<p>Dimension</p>
			</div>
			<div class="control-input-horizontal">
				<div class="control-input">
					<p>Width</p>
					<NumberWithUnits bind:value={theData.parentBox.width} />
				</div>

				<div class="control-input">
					<p>Height</p>
					<NumberWithUnits bind:value={theData.parentBox.height} />
				</div>
			</div>
		</div>

		<div class="div-line"></div>

		<Legend legendData={theData.legend} which="controls" />

		<div class="control-component">
			<div class="control-component-title">
				<p>Padding</p>
			</div>
			<div class="control-input-square">
				<div class="control-input">
					<p>Top</p>
					<div style="display: flex;  justify-content: flex-start; align-items: center; gap: 8px;">
						<NumberWithUnits bind:value={theData.padding.top} />
					</div>
				</div>

				<div class="control-input">
					<p>Bottom</p>
					<div
						style="    display: flex;  justify-content: flex-start; align-items: center; gap: 8px;"
					>
						<NumberWithUnits bind:value={theData.padding.bottom} />
					</div>
				</div>

				<div class="control-input">
					<p>Left</p>
					<div
						style="    display: flex;  justify-content: flex-start; align-items: center; gap: 8px;"
					>
						<NumberWithUnits bind:value={theData.padding.left} />
					</div>
				</div>

				<div class="control-input">
					<p>Right</p>
					<div
						style="    display: flex;  justify-content: flex-start; align-items: center; gap: 8px;"
					>
						<NumberWithUnits bind:value={theData.padding.right} />
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
					<NumberWithUnits
						step="0.1"
						value={theData.ylimsIN[0] ? theData.ylimsIN[0] : theData.ylims[0]}
						onInput={(val) => {
							theData.ylimsIN[0] = parseFloat(val);
						}}
					/>
				</div>

				<div class="control-input">
					<p>Max</p>
					<NumberWithUnits
						step="0.1"
						value={theData.ylimsIN[1] ? theData.ylimsIN[1] : theData.ylims[1]}
						onInput={(val) => {
							theData.ylimsIN[1] = parseFloat(val);
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
								const val = e.target.value;
								theData.xlimsIN[0] = Number(new Date(val));
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
								const val = e.target.value;
								theData.xlimsIN[1] = Number(new Date(val));
							}}
						/>
					</div>
				{:else}
					<div class="control-input">
						<p>Min</p>
						<NumberWithUnits
							step="0.1"
							value={theData.xlimsIN[0] ? theData.xlimsIN[0] : theData.xlims[0]}
							onInput={(val) => {
								theData.xlimsIN[0] = parseFloat(val);
							}}
						/>
					</div>

					<div class="control-input">
						<p>Max</p>
						<NumberWithUnits
							step="0.1"
							value={theData.xlimsIN[1] ? theData.xlimsIN[1] : theData.xlims[1]}
							onInput={(val) => {
								theData.xlimsIN[1] = parseFloat(val);
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
	{:else if appState.currentControlTab === 'data'}
		<div id="dataSettings">
			<div class="control-data-add">
				<div class="add">
					<button
						class="icon"
						onclick={async () => {
							theData.addData({
								x: null,
								y: null
							});

							await tick();

							//Scroll to the bottom of dataSettings
							dataSettingsScrollTo('bottom');

							//TODO: consider focuus on the next y
							//focus on the next y value

							// // Get the last element with class 'y-select'
							// const ySelectElements = document.getElementsByClassName('y-select');
							// const lastYSelect = ySelectElements[ySelectElements.length - 1];

							// // Get the <select> element within the last y-select
							// const selectElement = lastYSelect.querySelector('select');

							// // Check if the select element exists
							// if (selectElement) {
							// 	// Simulate a click on the select element
							// 	selectElement.click();
							// } else {
							// 	console.error('No <select> element found within the last y-select element');
							// }
						}}
					>
						<Icon name="add" width={16} height={16} />
					</button>
				</div>
			</div>

			{#each theData.data as datum, i (datum.x.id + '-' + datum.y.id)}
				<div
					class="dataBlock"
					animate:flip={{ duration: 500 }}
					in:slide={{ duration: 500, axis: 'y' }}
					out:slide={{ duration: 500, axis: 'y' }}
				>
					<div class="control-component-title">
						<p
							style="cursor: default;"
							contenteditable="false"
							ondblclick={(e) => {
								e.target.setAttribute('contenteditable', 'true');
								e.target.focus();
							}}
							onfocusout={(e) => e.target.setAttribute('contenteditable', 'false')}
							bind:innerHTML={datum.label}
						></p>
						<button class="icon" onclick={() => theData.removeData(i)}
							><Icon
								name="minus"
								width={16}
								height={16}
								className="control-component-title-icon"
							/></button
						>
					</div>

					<div class="data-wrapper">
						<div class="x-select">
							x: {datum.x.name}

							<Column col={datum.x} canChange={true} />
						</div>
						<div class="y-select">
							y: {datum.y.name}
							<Column col={datum.y} canChange={true} />
						</div>

						<Points pointsData={datum.points} which="controls" />
						<Line
							lineData={datum.line}
							x={datum.x.getData()}
							y={datum.y.getData()}
							xscale={theData.anyXdataTime
								? scaleTime()
										.domain([theData.xlims[0], theData.xlims[1]])
										.range([0, theData.plotwidth])
								: scaleLinear()
										.domain([theData.xlims[0], theData.xlims[1]])
										.range([0, theData.plotwidth])}
							yscale={scaleLinear()
								.domain([theData.ylims[0], theData.ylims[1]])
								.range([theData.plotheight, 0])}
							which="controls"
						/>
					</div>
					<div class="div-line"></div>
				</div>
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
				{@const xDATA =
					theData.plot.anyXdataTime && datum.x.type !== 'time'
						? datum.x.getData().map((d) => theData.plot.xlims[0] + d * 3600000)
						: datum.x.getData()}
				<Line
					lineData={datum.line}
					x={xDATA}
					y={datum.y.getData()}
					xscale={theData.plot.anyXdataTime
						? scaleTime()
								.domain([theData.plot.xlims[0], theData.plot.xlims[1]])
								.range([0, theData.plot.plotwidth])
						: scaleLinear()
								.domain([theData.plot.xlims[0], theData.plot.xlims[1]])
								.range([0, theData.plot.plotwidth])}
					yscale={scaleLinear()
						.domain([theData.plot.ylims[0], theData.plot.ylims[1]])
						.range([theData.plot.plotheight, 0])}
					xoffset={theData.plot.padding.left}
					yoffset={theData.plot.padding.top}
					which="plot"
				/>
				<Points
					pointsData={datum.points}
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
					which="plot"
				/>
			{/if}
		{/each}
		<Legend
			legendData={theData.plot.legend}
			items={theData.plot.getLegendItems}
			plotWidth={theData.plot.plotwidth}
			plotHeight={theData.plot.plotheight}
			padding={theData.plot.padding}
			which="plot"
		/>
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
