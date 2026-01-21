<script module>
	import { Column as ColumnClass } from '$lib/core/Column.svelte';
	import Column from '$lib/core/Column.svelte';
	import Axis from '$lib/components/plotBits/Axis.svelte';
	import { scaleLinear } from 'd3-scale';
	import Box, { BoxClass } from '$lib/components/plotBits/Box.svelte';
	import { min, max } from '$lib/components/plotbits/helpers/wrangleData.js';
	import { dataSettingsScrollTo } from '$lib/components/views/ControlDisplay.svelte';

	export const Boxplot_defaultDataInputs = ['x', 'y'];
	export const Boxplot_controlHeaders = ['Properties', 'Data'];

	class BoxPlotDataClass {
		parentPlot = $state();
		x = $state();
		y = $state();
		label = $state('Box Plot');
		boxPlot = $state();

		constructor(parent, dataIN) {
			this.parentPlot = parent;

			if (dataIN?.x) {
				this.x = ColumnClass.fromJSON(dataIN.x);
			} else {
				if (parent.data.length > 0) {
					this.x = new ColumnClass({ refId: parent.data[parent.data.length - 1].x.refId });
				} else {
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
				this.label = 'Box Plot ' + (parent.data.length + 1);
			}

			this.boxPlot = new BoxClass(dataIN?.boxPlot, this);
		}

		getLegendItem() {
			if (!this.boxPlot.draw) return null;

			return {
				label: this.label,
				elements: [
					{
						type: 'boxplot',
						color: this.boxPlot.colour,
						fillColor: this.boxPlot.fillColour,
						fillOpacity: this.boxPlot.fillOpacity
					}
				]
			};
		}

		toJSON() {
			return {
				x: this.x,
				y: this.y,
				label: this.label,
				boxPlot: this.boxPlot.toJSON()
			};
		}

		static fromJSON(json, parent) {
			return new BoxPlotDataClass(parent, {
				x: json.x,
				y: json.y,
				label: json.label,
				boxPlot: BoxClass.fromJSON(json.boxPlot)
			});
		}
	}

	export class Boxplotclass {
		parentBox = $state();
		data = $state([]);
		legend = $state();

		padding = $state({ top: 15, right: 30, bottom: 30, left: 50 });
		plotheight = $derived(this.parentBox.height - this.padding.top - this.padding.bottom);
		plotwidth = $derived(this.parentBox.width - this.padding.left - this.padding.right);

		xlimsIN = $state([null, null]);
		ylimsIN = $state([null, null]);

		yTicks = $state(5);

		// Get all unique x values across all data series
		uniqueXValues = $derived.by(() => {
			const allXValues = new Set();
			this.data.forEach((d) => {
				const xData = d.x.getData() ?? [];
				xData.forEach((val) => {
					if (val != null && !isNaN(val)) {
						allXValues.add(val);
					}
				});
			});
			return Array.from(allXValues).sort((a, b) => a - b);
		});

		ylims = $derived.by(() => {
			if (this.data.length === 0) {
				return [0, 10];
			}

			let ymin = Infinity;
			let ymax = -Infinity;

			this.data.forEach((d) => {
				let tempy = d.y.getData() ?? [];
				const validData = tempy.filter((val) => val != null && !isNaN(val));
				if (validData.length > 0) {
					ymin = min([ymin, ...validData]);
					ymax = max([ymax, ...validData]);
				}
			});

			if (ymin === Infinity || ymax === -Infinity) {
				return [0, 10];
			}

			return [
				this.ylimsIN[0] != null ? this.ylimsIN[0] : ymin,
				this.ylimsIN[1] != null ? this.ylimsIN[1] : ymax
			];
		});

		// X-axis is categorical (0 to n-1 for n unique values)
		xlims = $derived.by(() => {
			const numCategories = this.uniqueXValues.length;
			if (numCategories === 0) {
				return [0, 1];
			}

			return [
				this.xlimsIN[0] != null ? this.xlimsIN[0] : -0.5,
				this.xlimsIN[1] != null ? this.xlimsIN[1] : numCategories - 0.5
			];
		});

		xlabel = $state('');
		ylabel = $state('');
		xgridlines = $state(false);
		ygridlines = $state(true);

		constructor(parent, dataIN) {
			this.parentBox = parent;
			this.legend = new LegendClass(dataIN?.legend);
			if (dataIN) {
				this.addData(dataIN);
			}
		}

		getAutoScaleValues() {
			let axisWidths = { left: null, right: null, top: null, bottom: null };
			if (!document.getElementById('plot' + this.parentBox.id)) {
				return axisWidths;
			}

			const allLeftAxes = document
				.getElementById('plot' + this.parentBox.id)
				?.getElementsByClassName('axis-left');

			if (allLeftAxes && allLeftAxes.length > 0) {
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

			const allBottomAxes = document
				.getElementById('plot' + this.parentBox.id)
				.getElementsByClassName('axis-bottom');

			if (allBottomAxes && allBottomAxes.length > 0) {
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
			this.data.push(new BoxPlotDataClass(this, dataIN));
		}

		removeData(idx) {
			this.data.splice(idx, 1);
		}

		getLegendItems = $derived.by(() => {
			const items = [];
			this.data.forEach((datum) => {
				const legendItem = datum.getLegendItem();
				if (legendItem) {
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
				ylabel: this.ylabel,
				xlabel: this.xlabel,
				data: this.data,
				legend: this.legend.toJSON()
			};
		}

		static fromJSON(parent, json) {
			if (!json) {
				return new Boxplotclass(parent, null);
			}

			const chart = new Boxplotclass(parent, null);
			chart.padding = json.padding;
			chart.xlimsIN = json.xlimsIN;
			chart.ylimsIN = json.ylimsIN;
			chart.ygridlines = json.ygridlines ?? true;
			chart.xgridlines = json.xgridlines ?? false;
			chart.ylabel = json.ylabel;
			chart.xlabel = json.xlabel;

			if (json.data) {
				chart.data = json.data.map((d) => BoxPlotDataClass.fromJSON(d, chart));
			}

			chart.legend = LegendClass.fromJSON(json.legend);
			return chart;
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
	import Editable from '$lib/components/inputs/Editable.svelte';

	let { theData, which } = $props();

	let tooltip = $state({ visible: false, x: 0, y: 0, content: '' });
	function handleTooltip(event) {
		tooltip = event.detail;
	}

	onMount(() => {
		if (which == 'plot') {
			theData.plot.autoScalePadding('all');
		}
	});

	$effect(() => {
		if (which == 'controls') {
			theData.ylabel;
			theData.xlabel;
			theData.ylims;
			theData.xlims;

			theData.autoScalePadding('all');
		}
	});

	// Custom tick values for x-axis to show actual unique x values
	function getXAxisTickValues(uniqueXValues) {
		return uniqueXValues.map((val, i) => ({ position: i, label: String(val) }));
	}
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
					<NumberWithUnits bind:value={theData.padding.top} />
				</div>

				<div class="control-input">
					<p>Bottom</p>
					<NumberWithUnits bind:value={theData.padding.bottom} />
				</div>

				<div class="control-input">
					<p>Left</p>
					<NumberWithUnits bind:value={theData.padding.left} />
				</div>

				<div class="control-input">
					<p>Right</p>
					<NumberWithUnits bind:value={theData.padding.right} />
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
		</div>

		<div class="div-line"></div>

		<div class="control-component">
			<div class="control-component-title">
				<p>X-Axis</p>
			</div>
			<div class="control-input-vertical">
				<div class="control-input">
					<p>Label</p>
					<input bind:value={theData.xlabel} />
				</div>
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
							dataSettingsScrollTo('bottom');
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
						<p><Editable bind:value={datum.label} /></p>

						<button class="icon" onclick={() => theData.removeData(i)}>
							<Icon name="minus" width={16} height={16} className="control-component-title-icon" />
						</button>
					</div>

					<div class="data-wrapper">
						<div class="y-select">
							<div class="control-input">
								<p>x (categories)</p>
							</div>
							<Column col={datum.x} canChange={true} />
						</div>
						<div class="y-select">
							<div class="control-input">
								<p>y (values)</p>
							</div>
							<Column col={datum.y} canChange={true} />
						</div>

						<Box
							boxPlotData={datum.boxPlot}
							x={datum.x.getData()}
							y={datum.y.getData()}
							uniqueXValues={theData.uniqueXValues}
							seriesIndex={i}
							totalSeries={theData.data.length}
							xscale={scaleLinear()
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
		<!-- Y-axis -->
		<Axis
			height={theData.plot.plotheight}
			width={theData.plot.plotwidth}
			scale={scaleLinear()
				.domain([theData.plot.ylims[0], theData.plot.ylims[1]])
				.range([theData.plot.plotheight, 0])}
			position="left"
			plotPadding={theData.plot.padding}
			nticks={theData.plot.yTicks}
			gridlines={theData.plot.ygridlines}
			label={theData.plot.ylabel}
		/>

		<!-- X-axis with custom categorical labels -->
		<Axis
			height={theData.plot.plotheight}
			width={theData.plot.plotwidth}
			scale={scaleLinear()
				.domain([theData.plot.xlims[0], theData.plot.xlims[1]])
				.range([0, theData.plot.plotwidth])}
			position="bottom"
			plotPadding={theData.plot.padding}
			nticks={theData.plot.uniqueXValues.length}
			gridlines={theData.plot.xgridlines}
			label={theData.plot.xlabel}
			tickValues={theData.plot.uniqueXValues.map((val, i) => i)}
			tickFormat={(d, i) => String(theData.plot.uniqueXValues[i])}
		/>

		<!-- Box plots -->
		{#each theData.plot.data as datum, i}
			{#if datum.x.getData()?.length > 0 && datum.y.getData()?.length > 0}
				{@const xScale = scaleLinear()
					.domain([theData.plot.xlims[0], theData.plot.xlims[1]])
					.range([0, theData.plot.plotwidth])}
				{@const yScale = scaleLinear()
					.domain([theData.plot.ylims[0], theData.plot.ylims[1]])
					.range([theData.plot.plotheight, 0])}

				<Box
					boxPlotData={datum.boxPlot}
					x={datum.x.getData()}
					y={datum.y.getData()}
					uniqueXValues={theData.plot.uniqueXValues}
					seriesIndex={i}
					totalSeries={theData.plot.data.length}
					xscale={xScale}
					yscale={yScale}
					xoffset={theData.plot.padding.left}
					yoffset={theData.plot.padding.top}
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
