<script module>
	import { Column as ColumnClass } from '$lib/core/Column.svelte';
	import Column from '$lib/core/Column.svelte';
	import Axis, { AxisClass } from '$lib/components/plotbits/Axis.svelte';
	import { scaleLinear, scaleTime, scaleUtc, scaleLog } from 'd3-scale';
	import Line, { LineClass } from '$lib/components/plotbits/Line.svelte';
	import Points, { PointsClass } from '$lib/components/plotbits/Points.svelte';
	import { min, max } from '$lib/components/plotbits/helpers/wrangleData.js';
	import { dataSettingsScrollTo } from '$lib/components/views/ControlDisplay.svelte';
	import NightBand, { NightBandClass } from './NightBand.svelte';

	export const Scatterplot_defaultDataInputs = ['x', 'y'];
	export const Scatterplot_controlHeaders = ['Properties', 'Data', 'Bands'];
	export const Scatterplot_displayName = 'Scatterplot';

	class ScatterDataclass {
		parentPlot = $state();
		x = $state();
		y = $state();
		label = $state('test');
		line = $state();
		points = $state();
		yAxis = $state('left'); // 'left' or 'right'

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
			this.yAxis = dataIN?.yAxis || 'left';
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
			return item;
		}

		toJSON() {
			return {
				x: this.x,
				y: this.y,
				label: this.label,
				yAxis: this.yAxis,
				line: this.line.toJSON(),
				points: this.points.toJSON()
			};
		}

		static fromJSON(json, parent) {
			return new ScatterDataclass(parent, {
				x: json.x,
				y: json.y,
				label: json.label,
				yAxis: json.yAxis,
				line: LineClass.fromJSON(json.line),
				points: PointsClass.fromJSON(json.points)
			});
		}
	}

	export class Scatterplotclass {
		parentBox = $state();
		data = $state([]);
		legend = $state();

		padding = $state({ top: 15, right: 30, bottom: 30, left: 30 });
		plotheight = $derived(this.parentBox.height - this.padding.top - this.padding.bottom);

		plotwidth = $derived(this.parentBox.width - this.padding.left - this.padding.right);

		xlimsIN = $state([null, null]);
		xLogScale = $state(false);
		XScale = $derived.by(() => {
			if (this.anyXdataTime) {
				return scaleUtc().domain([this.xlims[0], this.xlims[1]]).range([0, this.plotwidth]);
			}
			if (this.xLogScale && this.xlims[0] > 0 && this.xlims[1] > 0) {
				return scaleLog().domain([this.xlims[0], this.xlims[1]]).range([0, this.plotwidth]);
			}
			return scaleLinear().domain([this.xlims[0], this.xlims[1]]).range([0, this.plotwidth]);
		});

		ylimsLeftIN = $state([null, null]);
		ylimsRightIN = $state([null, null]);

		yLogScaleLeft = $state(false);
		yLogScaleRight = $state(false);

		ylimsLeft = $derived.by(() => {
			const leftData = this.data.filter((d) => d.yAxis === 'left');
			if (leftData.length === 0) {
				return [0, 0];
			}

			let ymin = Infinity;
			let ymax = -Infinity;
			leftData.forEach((d) => {
				let tempy = d.y.getData() ?? [];
				ymin = min([ymin, ...tempy]);
				ymax = max([ymax, ...tempy]);
			});
			return [
				this.ylimsLeftIN[0] != null ? this.ylimsLeftIN[0] : ymin,
				this.ylimsLeftIN[1] != null ? this.ylimsLeftIN[1] : ymax
			];
		});

		// Right Y-axis limits
		ylimsRight = $derived.by(() => {
			const rightData = this.data.filter((d) => d.yAxis === 'right');
			if (rightData.length === 0) {
				return [0, 0];
			}

			let ymin = Infinity;
			let ymax = -Infinity;
			rightData.forEach((d) => {
				let tempy = d.y.getData() ?? [];
				ymin = min([ymin, ...tempy]);
				ymax = max([ymax, ...tempy]);
			});
			return [
				this.ylimsRightIN[0] != null ? this.ylimsRightIN[0] : ymin,
				this.ylimsRightIN[1] != null ? this.ylimsRightIN[1] : ymax
			];
		});

		xlims = $derived.by(() => {
			if (this.data.length === 0) {
				return [0, 0];
			}

			let xmin = Infinity;
			let xmax = -Infinity;

			this.data.forEach((d, i) => {
				const xCol = this.data[i].x;
				if (this.anyXdataTime && xCol.type !== 'time' && xCol.originTime_ms == null) {
					// skip pure-number columns that have no time origin
					return;
				}
				let tempx = xCol.getData() ?? [];
				let tempy = this.data[i].y.getData() ?? [];

				tempx = tempx.filter(
					(x, i) => x != null && !isNaN(x) && tempy[i] != null && !isNaN(tempy[i])
				); // Ensure all values are valid (not null or NaN) — do NOT exclude zeros
				// Convert origin-aware hour columns to ms for limit calculation
				if (this.anyXdataTime && xCol.type !== 'time' && xCol.originTime_ms != null) {
					tempx = tempx.map((h) => xCol.originTime_ms + h * 3600000);
				}
				xmin = Math.floor(min([xmin, ...tempx]));
				xmax = Math.ceil(max([xmax, ...tempx]));
			});

			return [
				this.xlimsIN[0] != null ? this.xlimsIN[0] : xmin,
				this.xlimsIN[1] != null ? this.xlimsIN[1] : xmax
			];
		});
		xAxis = $state();
		yAxisLeft = $state();
		yAxisRight = $state();

		YScaleLeft = $derived.by(() => {
			if (this.yLogScaleLeft && this.ylimsLeft[0] > 0 && this.ylimsLeft[1] > 0) {
				return scaleLog()
					.domain([this.ylimsLeft[0], this.ylimsLeft[1]])
					.range([this.plotheight, 0]);
			}
			return scaleLinear()
				.domain([this.ylimsLeft[0], this.ylimsLeft[1]])
				.range([this.plotheight, 0]);
		});

		YScaleRight = $derived.by(() => {
			if (this.yLogScaleRight && this.ylimsRight[0] > 0 && this.ylimsRight[1] > 0) {
				return scaleLog()
					.domain([this.ylimsRight[0], this.ylimsRight[1]])
					.range([this.plotheight, 0]);
			}
			return scaleLinear()
				.domain([this.ylimsRight[0], this.ylimsRight[1]])
				.range([this.plotheight, 0]);
		});

		nightBands = $state([]);

		hasRightAxisData = $derived.by(() => {
			return this.data.some((d) => d.yAxis === 'right');
		});
		hasLeftAxisData = $derived.by(() => {
			return this.data.some((d) => d.yAxis === 'left');
		});

		anyXdataTime = $derived.by(() => {
			if (this.data.length === 0) {
				return false;
			}
			return this.data.some((d) => d.x.type === 'time' || d.x.originTime_ms != null);
		});

		anyXCategoryData = $derived.by(() => {
			if (this.data.length === 0) return false;
			return this.data.some((d) => d.x.type === 'category');
		});

		constructor(parent, dataIN) {
			this.parentBox = parent;
			this.legend = new LegendClass(dataIN?.legend);
			this.xAxis = new AxisClass({
				label: dataIN?.xAxis?.label ?? '',
				gridlines: dataIN?.xAxis?.gridlines ?? true,
				nticks: dataIN?.xAxis?.nticks ?? 5
			});
			this.yAxisLeft = new AxisClass({
				label: dataIN?.yAxisLeft?.label ?? '',
				gridlines: dataIN?.yAxisLeft?.gridlines ?? true,
				nticks: dataIN?.yAxisLeft?.nticks ?? 5
			});
			this.yAxisRight = new AxisClass({
				label: dataIN?.yAxisRight?.label ?? '',
				gridlines: dataIN?.yAxisRight?.gridlines ?? false,
				nticks: dataIN?.yAxisRight?.nticks ?? 5
			});
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
					axisWidths.bottom = Math.round(bottomAxisWhole - bottomAxisLine + 12);
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

		addNightBand(bandIN) {
			this.nightBands.push(new NightBandClass(this, bandIN));
		}

		removeNightBand(idx) {
			this.nightBands.splice(idx, 1);
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

		getDownloadData() {
			const headers = [];
			const columns = [];
			this.data.forEach((datum, d) => {
				const label = datum.label || `Data ${d}`;
				const xData = datum.x.getData() ?? [];
				const yData = datum.y.getData() ?? [];
				headers.push(`x_${label}`, `y_${label}`);
				columns.push(xData, yData);
			});
			const maxLen = Math.max(...columns.map((c) => c.length), 0);
			const rows = [];
			for (let i = 0; i < maxLen; i++) {
				rows.push(columns.map((col) => (i < col.length ? col[i] : '')));
			}
			return { headers, rows };
		}

		toJSON() {
			return {
				xlimsIN: this.xlimsIN,
				xLogScale: this.xLogScale,
				ylimsLeftIN: this.ylimsLeftIN,
				ylimsRightIN: this.ylimsRightIN,
				yLogScaleLeft: this.yLogScaleLeft,
				yLogScaleRight: this.yLogScaleRight,
				padding: this.padding,
				xAxis: this.xAxis.toJSON(),
				yAxisLeft: this.yAxisLeft.toJSON(),
				yAxisRight: this.yAxisRight.toJSON(),
				data: this.data,
				legend: this.legend.toJSON(),
				nightBands: this.nightBands.map((band) => band.toJSON())
			};
		}
		static fromJSON(parent, json) {
			if (!json) {
				return new Scatterplotclass(parent, null);
			}

			const scatter = new Scatterplotclass(parent, null);
			scatter.padding = json.padding;
			scatter.xlimsIN = json.xlimsIN;
			scatter.xLogScale = json.xLogScale ?? false;
			scatter.ylimsLeftIN = json.ylimsLeftIN || [null, null];
			scatter.ylimsRightIN = json.ylimsRightIN || [null, null];
			scatter.yLogScaleLeft = json.yLogScaleLeft ?? false;
			scatter.yLogScaleRight = json.yLogScaleRight ?? false;

			// Support both new AxisClass format and old individual properties
			if (json.xAxis) {
				scatter.xAxis = AxisClass.fromJSON(json.xAxis);
			} else {
				scatter.xAxis = new AxisClass({
					label: json.xlabel ?? '',
					gridlines: json.xgridlines ?? true
				});
			}
			if (json.yAxisLeft) {
				scatter.yAxisLeft = AxisClass.fromJSON(json.yAxisLeft);
			} else {
				scatter.yAxisLeft = new AxisClass({
					label: json.ylabelLeft ?? '',
					gridlines: json.ygridlinesLeft ?? true
				});
			}
			if (json.yAxisRight) {
				scatter.yAxisRight = AxisClass.fromJSON(json.yAxisRight);
			} else {
				scatter.yAxisRight = new AxisClass({
					label: json.ylabelRight ?? '',
					gridlines: json.ygridlinesRight ?? false
				});
			}

			if (json.data) {
				console.log('json.data', $state.snapshot(json.data));

				scatter.data = json.data.map((d) => ScatterDataclass.fromJSON(d, scatter));
			}
			if (json.nightBands) {
				json.nightBands.forEach((band) => {
					scatter.nightBands.push(NightBandClass.fromJSON(scatter, band));
				});
			}
			scatter.legend = LegendClass.fromJSON(json.legend);
			return scatter;
		}
	}
</script>

<script>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import Toggle from '$lib/components/inputs/Toggle.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import { appState } from '$lib/core/core.svelte';
	import { onMount } from 'svelte';
	import { flip } from 'svelte/animate';
	import { slide } from 'svelte/transition';
	import { tick } from 'svelte';
	import Legend, { LegendClass } from '$lib/components/plotbits/Legend.svelte';
	import Editable from '$lib/components/inputs/Editable.svelte';
	import DateTimeHrs from '$lib/components/inputs/DateTimeHrs.svelte';

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
			theData.yAxisLeft.label;
			theData.yAxisRight.label;
			theData.xAxis.label;
			theData.xlims;
			theData.ylimsLeft;
			theData.ylimsRight;

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

		{#if theData.hasLeftAxisData}
			<div class="div-line"></div>

			<Axis axisData={theData.yAxisLeft} which="controls" title="Left Y-Axis" />

			<div class="control-component">
				<div class="control-input-horizontal">
					<div class="control-input">
						<p>Min</p>
						<NumberWithUnits
							step="0.1"
							value={theData.ylimsLeftIN[0] ? theData.ylimsLeftIN[0] : theData.ylimsLeft[0]}
							onInput={(val) => {
								theData.ylimsLeftIN[0] = parseFloat(val);
							}}
						/>
					</div>

					<div class="control-input">
						<p>Max</p>
						<NumberWithUnits
							step="0.1"
							value={theData.ylimsLeftIN[1] ? theData.ylimsLeftIN[1] : theData.ylimsLeft[1]}
							onInput={(val) => {
								theData.ylimsLeftIN[1] = parseFloat(val);
							}}
						/>
					</div>

					{#if theData.ylimsLeftIN[0] != null || theData.ylimsLeftIN[1] != null}
						<div class="control-component-input-icons">
							<button class="icon" onclick={() => (theData.ylimsLeftIN = [null, null])}>
								<Icon
									name="reset"
									width={14}
									height={14}
									className="control-component-input-icon"
								/>
							</button>
						</div>
					{/if}
				</div>

				<div class="control-input-vertical">
					<div class="control-input-checkbox">
						<input type="checkbox" bind:checked={theData.yLogScaleLeft} />
						<p>Log Scale</p>
					</div>
				</div>
			</div>
		{/if}

		{#if theData.hasRightAxisData}
			<div class="div-line"></div>

			<Axis axisData={theData.yAxisRight} which="controls" title="Right Y-Axis" />

			<div class="control-component">
				<div class="control-input-horizontal">
					<div class="control-input">
						<p>Min</p>
						<NumberWithUnits
							step="0.1"
							value={theData.ylimsRightIN[0] ? theData.ylimsRightIN[0] : theData.ylimsRight[0]}
							onInput={(val) => {
								theData.ylimsRightIN[0] = parseFloat(val);
							}}
						/>
					</div>

					<div class="control-input">
						<p>Max</p>
						<NumberWithUnits
							step="0.1"
							value={theData.ylimsRightIN[1] ? theData.ylimsRightIN[1] : theData.ylimsRight[1]}
							onInput={(val) => {
								theData.ylimsRightIN[1] = parseFloat(val);
							}}
						/>
					</div>

					{#if theData.ylimsRightIN[0] != null || theData.ylimsRightIN[1] != null}
						<div class="control-component-input-icons">
							<button class="icon" onclick={() => (theData.ylimsRightIN = [null, null])}>
								<Icon
									name="reset"
									width={14}
									height={14}
									className="control-component-input-icon"
								/>
							</button>
						</div>
					{/if}
				</div>

				<div class="control-input-vertical">
					<div class="control-input-checkbox">
						<input type="checkbox" bind:checked={theData.yLogScaleRight} />
						<p>Log Scale</p>
					</div>
				</div>
			</div>
		{/if}

		<div class="div-line"></div>

		<Axis axisData={theData.xAxis} which="controls" title="X-Axis" />

		<div class="control-component">
			<div class="control-input-horizontal">
				{#if theData.anyXdataTime}
					<div class="control-input">
						<p>Min</p>
						<DateTimeHrs
							value={(() => {
								const v = theData.xlimsIN[0] ?? theData.xlims[0];
								return v;
							})()}
							onChange={(val) => {
								theData.xlimsIN[0] = val ? Number(new Date(new Date(val).toUTCString())) : null;
							}}
						/>
					</div>

					<div class="control-input">
						<p>Max</p>
						<DateTimeHrs
							value={(() => {
								const v = theData.xlimsIN[1] ?? theData.xlims[1];
								return v;
							})()}
							onChange={(val) => {
								theData.xlimsIN[1] = val ? Number(new Date(new Date(val).toUTCString())) : null;
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
				{#if !theData.anyXdataTime}
					<div class="control-input-checkbox">
						<input type="checkbox" bind:checked={theData.xLogScale} />
						<p>Log Scale</p>
					</div>
				{/if}
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
							<div class="control-input">
								<p>x</p>
							</div>

							<Column col={datum.x} canChange={true} />
						</div>
						<div class="y-select">
							<div class="control-input">
								<p>y</p>
							</div>
							<Column col={datum.y} canChange={true} />
						</div>

						<div class="control-input-vertical">
							<div class="control-input">
								<p>Y-Axis</p>
								<Toggle
									Labels={['Left', 'Right']}
									onChange={(v) => (datum.yAxis = v ? 'right' : 'left')}
								/>
							</div>
						</div>

						<Points pointsData={datum.points} which="controls" />
						<Line
							lineData={datum.line}
							x={datum.x.getData()}
							y={datum.y.getData()}
							xscale={theData.XScale}
							yscale={datum.yAxis === 'left' ? theData.YScaleLeft : theData.YScaleRight}
							which="controls"
						/>
					</div>
					<div class="div-line"></div>
				</div>
			{/each}
		</div>
	{:else if appState.currentControlTab === 'bands'}
		<div class="control-component">
			{#each theData.nightBands as nightBand (nightBand.id)}
				<div
					class="night-band-container"
					animate:flip={{ duration: 500 }}
					in:slide={{ duration: 500, axis: 'y' }}
					out:slide={{ duration: 500, axis: 'y' }}
				>
					<NightBand which="controls" {nightBand} plotId={theData.parentBox.id} />
					<div class="div-line"></div>
				</div>
			{/each}

			<div>
				<button class="icon control-block-add" onclick={() => theData.addNightBand()}>
					<Icon name="plus" width={16} height={16} className="static-icon" />
				</button>
			</div>
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
		<!-- The Left Y-axis -->
		{#if theData.plot.hasLeftAxisData}
			<Axis
				height={theData.plot.plotheight}
				width={theData.plot.plotwidth}
				scale={theData.plot.YScaleLeft}
				position="left"
				plotPadding={theData.plot.padding}
				axisData={theData.plot.yAxisLeft}
				which="plot"
			/>
		{/if}

		<!-- The Right Y-axis (only if there's data on right axis) -->
		{#if theData.plot.hasRightAxisData}
			<Axis
				height={theData.plot.plotheight}
				width={theData.plot.plotwidth}
				scale={theData.plot.YScaleRight}
				position="right"
				plotPadding={theData.plot.padding}
				axisData={theData.plot.yAxisRight}
				which="plot"
			/>
		{/if}

		<!-- The X-axis -->
		<Axis
			height={theData.plot.plotheight}
			width={theData.plot.plotwidth}
			scale={theData.plot.XScale}
			position="bottom"
			plotPadding={theData.plot.padding}
			axisData={theData.plot.xAxis}
			tickFormat={theData.plot.anyXCategoryData ? (/** @type {any} */ d) => String(d) : null}
			which="plot"
		/>

		<!-- Night bands background -->
		<g
			class="night-bands-layer"
			style="transform: translate({theData.plot.padding.left}px, {theData.plot.padding.top}px);"
		>
			{#each theData.plot.nightBands as nightBand (nightBand.id)}
				{@const xScale = scaleLinear()
					.domain(theData.plot.xlims)
					.range([0, theData.plot.plotwidth])}

				{#if nightBand.enabled && nightBand.bands.length > 0}
					{#each nightBand.bands as band (band.label)}
						<rect
							class="night-band-rect"
							x={xScale(band.startTime)}
							y="0"
							width={Math.max(0, xScale(band.endTime) - xScale(band.startTime))}
							height={theData.plot.plotheight}
							fill={nightBand.colour}
							opacity={nightBand.opacity}
							style="pointer-events: none;"
						/>
					{/each}
				{/if}
			{/each}
		</g>

		{#each theData.plot.data as datum}
			{#if datum.x.getData()?.length > 0 && datum.y.getData()?.length > 0}
				{@const xDATA =
					theData.plot.anyXdataTime && datum.x.type !== 'time'
						? datum.x
								.getData()
								.map((d) => (datum.x.originTime_ms ?? theData.plot.xlims[0]) + d * 3600000)
						: datum.x.getData()}
				{@const yScale =
					datum.yAxis === 'left' ? theData.plot.YScaleLeft : theData.plot.YScaleRight}
				<Line
					lineData={datum.line}
					x={xDATA}
					y={datum.y.getData()}
					xscale={theData.plot.XScale}
					yscale={yScale}
					xoffset={theData.plot.padding.left}
					yoffset={theData.plot.padding.top}
					which="plot"
				/>
				<Points
					pointsData={datum.points}
					x={xDATA}
					xtype={datum.x.type}
					y={datum.y.getData()}
					xscale={theData.plot.XScale}
					yscale={yScale}
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
