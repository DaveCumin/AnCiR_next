<script module>
	import { Column as ColumnClass } from '$lib/core/Column.svelte';
	import Column from '$lib/core/Column.svelte';
	import Axis from '$lib/components/plotBits/Axis.svelte';
	import { scaleLinear } from 'd3-scale';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';

	import { mean } from '$lib/components/plotBits/helpers/wrangleData.js';

	import Line, { LineClass } from '$lib/components/plotBits/Line.svelte';
	import Points, { PointsClass } from '$lib/components/plotBits/Points.svelte';
	import { dataSettingsScrollTo } from '$lib/components/views/ControlDisplay.svelte';

	export const Correlogram_defaultDataInputs = ['time', 'values'];

	// Compute autocorrelation function
	function computeAutocorrelation(times, values, maxLag = null) {
		if (
			!times ||
			!values ||
			times.length < 2 ||
			values.length < 2 ||
			times.length !== values.length
		) {
			return { lags: [], correlations: [], dt: 1 };
		}

		// Remove NaN values
		const validIndices = times
			.map((t, i) => (isNaN(t) || isNaN(values[i]) ? -1 : i))
			.filter((i) => i !== -1);

		if (validIndices.length < 2) {
			return { lags: [], correlations: [], dt: 1 };
		}

		const t = validIndices.map((i) => times[i]);
		const y = validIndices.map((i) => values[i]);

		const n = y.length;

		// Calculate time step (assuming uniform sampling)
		const dt = t.length > 1 ? (t[t.length - 1] - t[0]) / (t.length - 1) : 1;

		// Determine maximum lag
		const nLags = maxLag ? Math.min(Math.floor(maxLag / dt), n - 1) : Math.floor(n / 2);

		// Calculate mean and variance
		const yMean = mean(y);
		const yVariance = y.reduce((sum, val) => sum + (val - yMean) ** 2, 0) / n;

		if (yVariance === 0) {
			return { lags: [], correlations: [], dt };
		}

		const lags = [];
		const correlations = [];

		// Compute autocorrelation for each lag
		for (let lag = 0; lag <= nLags; lag++) {
			let sum = 0;
			let count = 0;

			for (let i = 0; i < n - lag; i++) {
				sum += (y[i] - yMean) * (y[i + lag] - yMean);
				count++;
			}

			const correlation = count > 0 ? sum / (count * yVariance) : 0;
			lags.push(lag * dt);
			correlations.push(correlation);
		}

		return { lags, correlations, dt };
	}

	class CorrelogramDataclass {
		parentPlot = $state();
		x = $state();
		y = $state();
		maxLag = $state(null); // null = auto (n/2), otherwise max lag in hours

		line = $state();
		points = $state();
		confidenceLine = $state(); // For confidence bounds

		showConfidenceBounds = $state(true);
		confidenceLevel = $state(0.95); // 95% confidence interval

		acfData = $derived.by(() => {
			const times = this.x.hoursSinceStart;
			const values = this.y.getData();
			return computeAutocorrelation(times, values, this.maxLag);
		});

		confidenceBounds = $derived.by(() => {
			// Calculate confidence bounds based on sample size
			const n = this.y.getData().filter((v) => !isNaN(v)).length;
			if (n < 2) return { upper: 0, lower: 0 };

			// For large samples, approximate 95% CI is ±1.96/sqrt(n)
			const z = this.confidenceLevel === 0.95 ? 1.96 : 2.576; // 95% or 99%
			const bound = z / Math.sqrt(n);
			return { upper: bound, lower: -bound };
		});

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
			if (dataIN && dataIN.y) {
				this.y = ColumnClass.fromJSON(dataIN.y);
			} else {
				this.y = new ColumnClass({ refId: -1 });
			}
			this.line = new LineClass(dataIN?.line, this);
			this.confidenceLine = new LineClass(dataIN?.confidenceLine, this);
			this.confidenceLine.stroke = dataIN?.confidenceLine?.stroke ?? '5,5';
			this.confidenceLine.strokeWidth = dataIN?.confidenceLine?.strokeWidth ?? 1;
			this.points = new PointsClass(dataIN?.points, this);
			this.maxLag = dataIN?.maxLag ?? null;
			this.showConfidenceBounds = dataIN?.showConfidenceBounds ?? true;
			this.confidenceLevel = dataIN?.confidenceLevel ?? 0.95;
		}

		toJSON() {
			return {
				x: this.x,
				y: this.y,
				line: this.line.toJSON(),
				confidenceLine: this.confidenceLine.toJSON(),
				points: this.points.toJSON(),
				maxLag: this.maxLag,
				showConfidenceBounds: this.showConfidenceBounds,
				confidenceLevel: this.confidenceLevel
			};
		}

		static fromJSON(json, parent) {
			return new CorrelogramDataclass(parent, {
				x: json.x,
				y: json.y,
				line: LineClass.fromJSON(json.line),
				confidenceLine: LineClass.fromJSON(json.confidenceLine),
				points: PointsClass.fromJSON(json.points),
				maxLag: json.maxLag,
				showConfidenceBounds: json.showConfidenceBounds,
				confidenceLevel: json.confidenceLevel
			});
		}
	}

	export class Correlogramclass {
		parentBox = $state();
		data = $state([]);
		padding = $state({ top: 15, right: 20, bottom: 30, left: 50 });
		plotheight = $derived(this.parentBox.height - this.padding.top - this.padding.bottom);
		plotwidth = $derived(this.parentBox.width - this.padding.left - this.padding.right);

		laglimsIN = $state([null, null]);
		laglims = $derived.by(() => {
			if (this.data.length === 0) return [0, 10];

			let maxLag = 0;
			this.data.forEach((d) => {
				if (d.acfData.lags.length > 0) {
					maxLag = Math.max(maxLag, Math.max(...d.acfData.lags));
				}
			});

			return [
				this.laglimsIN[0] != null ? this.laglimsIN[0] : 0,
				this.laglimsIN[1] != null ? this.laglimsIN[1] : maxLag
			];
		});

		ylimsIN = $state([null, null]);
		ylims = $derived.by(() => {
			if (this.data.length === 0) {
				return [-1, 1];
			}

			let ymin = Infinity;
			let ymax = -Infinity;
			this.data.forEach((d) => {
				if (d.acfData.correlations.length > 0) {
					ymin = Math.min(ymin, Math.min(...d.acfData.correlations));
					ymax = Math.max(ymax, Math.max(...d.acfData.correlations));
				}
			});

			// Add padding
			const range = ymax - ymin;
			ymin = Math.max(ymin - range * 0.1, -1);
			ymax = Math.min(ymax + range * 0.1, 1);

			return [
				this.ylimsIN[0] != null ? this.ylimsIN[0] : ymin,
				this.ylimsIN[1] != null ? this.ylimsIN[1] : ymax
			];
		});

		xgridlines = $state(true);
		ygridlines = $state(true);

		constructor(parent, dataIN) {
			this.parentBox = parent;
			if (dataIN) {
				this.addData(dataIN);
			}
		}

		getAutoScaleValues() {
			let axisWidths = { left: null, right: null, top: null, bottom: null };

			const plotElem = document.getElementById('plot' + this.parentBox.id);
			if (!plotElem) return axisWidths;

			const allLeftAxes = plotElem.getElementsByClassName('axis-left');
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

			const allRightAxes = plotElem.getElementsByClassName('axis-right');
			if (allRightAxes && allRightAxes.length > 0) {
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

			const allTopAxes = plotElem.getElementsByClassName('axis-top');
			if (allTopAxes && allTopAxes.length > 0) {
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

			const allBottomAxes = plotElem.getElementsByClassName('axis-bottom');
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
			if (Object.keys(dataIN).includes('time')) {
				const temp = { x: { refId: dataIN.time.refId }, y: { refId: dataIN.values.refId } };
				dataIN = structuredClone(temp);
			}
			const datum = new CorrelogramDataclass(this, dataIN);
			this.data.push(datum);
		}

		removeData(idx) {
			this.data.splice(idx, 1);
		}

		toJSON() {
			return {
				laglimsIN: this.laglimsIN,
				ylimsIN: this.ylimsIN,
				padding: this.padding,
				ygridlines: this.ygridlines,
				xgridlines: this.xgridlines,
				data: this.data
			};
		}

		static fromJSON(parent, json) {
			if (!json) {
				return new Correlogramclass(parent, null);
			}

			const correlogram = new Correlogramclass(parent, null);
			correlogram.padding = json.padding ?? json.paddingIN;
			correlogram.laglimsIN = json.laglimsIN || [null, null];
			correlogram.ylimsIN = json.ylimsIN;
			correlogram.ygridlines = json.ygridlines;
			correlogram.xgridlines = json.xgridlines;

			if (json.data) {
				correlogram.data = json.data.map((d) => CorrelogramDataclass.fromJSON(d, correlogram));
			}
			return correlogram;
		}
	}
</script>

<script>
	import { appState } from '$lib/core/core.svelte';
	import { onMount } from 'svelte';
	import { flip } from 'svelte/animate';
	import { slide } from 'svelte/transition';
	import { tick } from 'svelte';

	import Icon from '$lib/icons/Icon.svelte';

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
					<div style="display: flex; justify-content: flex-start; align-items: center; gap: 8px;">
						<NumberWithUnits
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
					<div style="display: flex; justify-content: flex-start; align-items: center; gap: 8px;">
						<NumberWithUnits
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
					<div style="display: flex; justify-content: flex-start; align-items: center; gap: 8px;">
						<NumberWithUnits
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
					<div style="display: flex; justify-content: flex-start; align-items: center; gap: 8px;">
						<NumberWithUnits
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
				<p>Y-Axis (Correlation)</p>
				<div class="control-component-title-icons">
					<button class="icon" onclick={() => (theData.ylimsIN = [null, null])}>
						<Icon name="reset" width={14} height={14} className="control-component-title-icon" />
					</button>
				</div>
			</div>

			<div class="control-input-vertical">
				<div class="control-input-checkbox">
					<input type="checkbox" bind:checked={theData.ygridlines} />
					<p>Grid</p>
				</div>
			</div>

			<div class="control-input-horizontal">
				<div class="control-input">
					<p>Min</p>
					<NumberWithUnits
						min="-1"
						max="1"
						step="0.1"
						value={theData.ylimsIN[0] != null ? theData.ylimsIN[0] : theData.ylims[0]}
						onInput={(val) => {
							theData.ylimsIN[0] = parseFloat(val);
						}}
					/>
				</div>

				<div class="control-input">
					<p>Max</p>
					<NumberWithUnits
						min="-1"
						max="1"
						step="0.1"
						value={theData.ylimsIN[1] != null ? theData.ylimsIN[1] : theData.ylims[1]}
						onInput={(val) => {
							theData.ylimsIN[1] = parseFloat(val);
						}}
					/>
				</div>
			</div>
		</div>

		<div class="control-component">
			<div class="control-component-title">
				<p>X-Axis (Lag)</p>
				<div class="control-component-title-icons">
					<button class="icon" onclick={() => (theData.laglimsIN = [null, null])}>
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
				<div class="control-input">
					<p>Min</p>
					<NumberWithUnits
						min="0"
						step="1"
						value={theData.laglimsIN[0] != null ? theData.laglimsIN[0] : theData.laglims[0]}
						onInput={(val) => {
							theData.laglimsIN[0] = parseFloat(val);
						}}
					/>
				</div>

				<div class="control-input">
					<p>Max</p>
					<NumberWithUnits
						step="1"
						value={theData.laglimsIN[1] != null ? theData.laglimsIN[1] : theData.laglims[1]}
						onInput={(val) => {
							theData.laglimsIN[1] = parseFloat(val);
						}}
					/>
				</div>
			</div>
		</div>
	{:else if appState.currentControlTab === 'data'}
		<div id="dataSettings">
			<div class="control-data-add">
				<button
					class="icon"
					onclick={async () => {
						theData.addData({
							x: null,
							y: { refId: -1 }
						});
						await tick();
						dataSettingsScrollTo('bottom');
					}}
				>
					<Icon name="add" width={16} height={16} />
				</button>
			</div>

			<div class="control-data-container">
				{#each theData.data as datum, i (datum.x.id + '-' + datum.y.id)}
					<div
						class="dataBlock"
						animate:flip={{ duration: 500 }}
						in:slide={{ duration: 500, axis: 'y' }}
						out:slide={{ duration: 500, axis: 'y' }}
					>
						<div class="control-component-title">
							<p>Data {i}</p>
							<button class="icon" onclick={() => theData.removeData(i)}>
								<Icon
									name="minus"
									width={16}
									height={16}
									className="control-component-title-icon"
								/>
							</button>
						</div>

						<div class="control-data">
							<div class="control-data-title">
								<strong>x (time)</strong>
								<p
									style="cursor: default;"
									contenteditable="false"
									ondblclick={(e) => {
										e.target.setAttribute('contenteditable', 'true');
										e.target.focus();
									}}
									onfocusout={(e) => e.target.setAttribute('contenteditable', 'false')}
									bind:innerHTML={datum.x.name}
								></p>
							</div>
							<Column col={datum.x} canChange={true} />
						</div>

						<div class="control-data">
							<div class="control-data-title">
								<strong>y (values)</strong>
								<p
									style="cursor: default;"
									contenteditable="false"
									ondblclick={(e) => {
										e.target.setAttribute('contenteditable', 'true');
										e.target.focus();
									}}
									onfocusout={(e) => e.target.setAttribute('contenteditable', 'false')}
									bind:innerHTML={datum.y.name}
								></p>
							</div>
							<Column col={datum.y} canChange={true} />
						</div>

						<!--
						<div class="control-input">
							<p>Max Lag (hours)</p>
							<div style="display: flex; align-items: center; gap: 8px;">
								<NumberWithUnits
									min="1"
									step="1"
									placeholder="Auto (n/2)"
									value={datum.maxLag}
									onInput={(val) => {
										datum.maxLag = val ? parseFloat(val) : null;
									}}
									style="flex: 1;"
								/>
								{#if datum.maxLag != null}
									<button class="icon" onclick={() => (datum.maxLag = null)} title="Reset to auto">
										<Icon name="reset" width={14} height={14} />
									</button>
								{/if}
							</div>
							<p style="font-size: 0.8em; opacity: 0.7; margin-top: 4px;">
								{datum.acfData.lags.length} lag points
							</p>
						</div>
						-->

						<Line lineData={datum.line} which="controls" title="Line" />
						<Points pointsData={datum.points} which="controls" />

						<Line lineData={datum.confidenceLine} which="controls" title="Confidence Bounds" />
						{#if datum.confidenceLine.draw}
							<div class="control-input">
								<p>Confidence Level</p>
								<select bind:value={datum.confidenceLevel}>
									<option value={0.95}>95%</option>
									<option value={0.99}>99%</option>
								</select>
							</div>
						{/if}

						<div class="div-line"></div>
					</div>
				{/each}
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
		style="background: white; position: absolute;"
		ontooltip={handleTooltip}
	>
		<!-- Y Axis -->
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
			label="Autocorrelation"
		/>

		<!-- X Axis -->
		<Axis
			height={theData.plot.plotheight}
			width={theData.plot.plotwidth}
			scale={scaleLinear()
				.domain([theData.plot.laglims[0], theData.plot.laglims[1]])
				.range([0, theData.plot.plotwidth])}
			position="bottom"
			plotPadding={theData.plot.padding}
			nticks={5}
			gridlines={theData.plot.xgridlines}
			label="Lag (hours)"
		/>

		<!-- Zero line -->
		<line
			x1={theData.plot.padding.left}
			y1={scaleLinear()
				.domain([theData.plot.ylims[0], theData.plot.ylims[1]])
				.range([theData.plot.plotheight, 0])(0) + theData.plot.padding.top}
			x2={theData.plot.padding.left + theData.plot.plotwidth}
			y2={scaleLinear()
				.domain([theData.plot.ylims[0], theData.plot.ylims[1]])
				.range([theData.plot.plotheight, 0])(0) + theData.plot.padding.top}
			stroke="#666"
			stroke-width="1"
			stroke-dasharray="4 2"
			opacity="0.5"
		/>

		<!-- Plot data -->
		{#each theData.plot.data as datum}
			<!-- Autocorrelation line and points -->
			<Line
				lineData={datum.line}
				x={datum.acfData.lags}
				y={datum.acfData.correlations}
				xscale={scaleLinear()
					.domain([theData.plot.laglims[0], theData.plot.laglims[1]])
					.range([0, theData.plot.plotwidth])}
				yscale={scaleLinear()
					.domain([theData.plot.ylims[0], theData.plot.ylims[1]])
					.range([theData.plot.plotheight, 0])}
				yoffset={theData.plot.padding.top}
				xoffset={theData.plot.padding.left}
				which="plot"
			/>
			<Points
				pointsData={datum.points}
				x={datum.acfData.lags}
				y={datum.acfData.correlations}
				xscale={scaleLinear()
					.domain([theData.plot.laglims[0], theData.plot.laglims[1]])
					.range([0, theData.plot.plotwidth])}
				yscale={scaleLinear()
					.domain([theData.plot.ylims[0], theData.plot.ylims[1]])
					.range([theData.plot.plotheight, 0])}
				yoffset={theData.plot.padding.top}
				xoffset={theData.plot.padding.left}
				tooltip={true}
				which="plot"
			/>

			<!-- Confidence bounds -->
			{#if datum.showConfidenceBounds && datum.confidenceBounds}
				{@const upperBound = new Array(datum.acfData.lags.length).fill(
					datum.confidenceBounds.upper
				)}
				{@const lowerBound = new Array(datum.acfData.lags.length).fill(
					datum.confidenceBounds.lower
				)}

				<!-- Upper confidence bound -->
				<Line
					lineData={datum.confidenceLine}
					x={datum.acfData.lags}
					y={upperBound}
					xscale={scaleLinear()
						.domain([theData.plot.laglims[0], theData.plot.laglims[1]])
						.range([0, theData.plot.plotwidth])}
					yscale={scaleLinear()
						.domain([theData.plot.ylims[0], theData.plot.ylims[1]])
						.range([theData.plot.plotheight, 0])}
					yoffset={theData.plot.padding.top}
					xoffset={theData.plot.padding.left}
					which="plot"
				/>

				<!-- Lower confidence bound -->
				<Line
					lineData={datum.confidenceLine}
					x={datum.acfData.lags}
					y={lowerBound}
					xscale={scaleLinear()
						.domain([theData.plot.laglims[0], theData.plot.laglims[1]])
						.range([0, theData.plot.plotwidth])}
					yscale={scaleLinear()
						.domain([theData.plot.ylims[0], theData.plot.ylims[1]])
						.range([theData.plot.plotheight, 0])}
					yoffset={theData.plot.padding.top}
					xoffset={theData.plot.padding.left}
					which="plot"
				/>
			{/if}
		{/each}
	</svg>

	{#if tooltip.visible}
		<div class="tooltip" style="left: {tooltip.x}px; top: {tooltip.y}px;">
			{tooltip.content}
		</div>
	{/if}
{/snippet}

{#if which === 'plot'}
	{@render plot(theData)}
{:else if which === 'controls'}
	{@render controls(theData)}
{/if}
