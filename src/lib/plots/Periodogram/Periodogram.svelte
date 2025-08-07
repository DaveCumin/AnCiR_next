<script module>
	import { Column as ColumnClass } from '$lib/core/Column.svelte';
	import Column from '$lib/core/Column.svelte';
	import Axis from '$lib/components/plotBits/Axis.svelte';
	import { scaleLinear } from 'd3-scale';
	import ColourPicker, { getPaletteColor } from '$lib/components/inputs/ColourPicker.svelte';
	import { binData, mean, makeSeqArray } from '$lib/components/plotBits/helpers/wrangleData.js';
	import { pchisq, qchisq } from '$lib/data/CDFs';

	import Line from '$lib/components/plotBits/Line.svelte';
	import Points from '$lib/components/plotBits/Points.svelte';

	export const Periodogram_defaultDataInputs = ['time', 'values'];

	// Lomb-Scargle implementation
	function calculateLombScarglePower(times, values, frequencies) {
		if (
			!times ||
			!values ||
			times.length < 2 ||
			values.length < 2 ||
			times.length !== values.length
		) {
			return new Array(frequencies.length).fill(0);
		}
		// Remove NaN values
		const validIndices = times
			.map((t, i) => (isNaN(t) || isNaN(values[i]) ? -1 : i))
			.filter((i) => i !== -1);
		const t = validIndices.map((i) => times[i]);
		const y = validIndices.map((i) => values[i]);

		if (t.length === 0) return new Array(frequencies.length).fill(0);

		// Compute mean and variance
		const yMean = mean(y);
		const yVariance = y.reduce((sum, val) => sum + (val - yMean) ** 2, 0) / (y.length - 1);

		const powers = frequencies.map((f) => {
			const omega = 2 * Math.PI * f;

			// Compute time shift (tau) for phase adjustment
			const cosSum = t.reduce((sum, ti) => sum + Math.cos(omega * ti), 0);
			const sinSum = t.reduce((sum, ti) => sum + Math.sin(omega * ti), 0);
			const tau = Math.atan2(sinSum, cosSum) / (2 * omega);

			// Compute sine and cosine components
			const cosTerm = y.reduce((sum, yi, i) => {
				return sum + (yi - yMean) * Math.cos(omega * (t[i] - tau));
			}, 0);
			const sinTerm = y.reduce((sum, yi, i) => {
				return sum + (yi - yMean) * Math.sin(omega * (t[i] - tau));
			}, 0);

			const cosDenom = t.reduce((sum, ti) => sum + Math.cos(omega * (ti - tau)) ** 2, 0);
			const sinDenom = t.reduce((sum, ti) => sum + Math.sin(omega * (ti - tau)) ** 2, 0);

			// Lomb-Scargle power
			const power = (cosTerm ** 2 / cosDenom + sinTerm ** 2 / sinDenom) / (2 * yVariance);
			return power;
		});
		return powers;
	}

	function calculateChiSquaredPower(data, binSize, period, avgAll, denominator) {
		const colNum = Math.round(period / binSize);
		if (colNum < 1) return 0;

		const rowNum = Math.ceil(data.length / colNum);

		let colSums = new Array(colNum).fill(0);
		let colCounts = new Array(colNum).fill(0);

		for (let i = 0; i < data.length; i++) {
			const col = i % colNum;
			const val = data[i];
			if (!isNaN(val)) {
				colSums[col] += val;
				colCounts[col]++;
			}
		}

		const avgP = colSums.map((sum, i) => (colCounts[i] > 0 ? sum / colCounts[i] : avgAll));

		let numSum = 0;
		for (let i = 0; i < colNum; i++) {
			numSum += (avgP[i] - avgAll) ** 2;
		}
		const numerator = numSum * data.length * rowNum;

		return numerator / denominator;
	}

	class PeriodogramDataclass {
		parentPlot = $state();
		x = $state();
		y = $state();
		binSize = $state(0.25);
		method = $state('Chi-squared'); // New: method selector

		periodData = $state({ x: [], y: [], threshold: [], pvalue: [] });
		linecolour = $state();
		linestrokeWidth = $state(3);
		pointcolour = $state();
		pointradius = $state(5);
		alpha = $state(0.05);

		updatePeriodData() {
			let binnedData = { bins: [], y_out: [] }; // No binning for Lomb-Scargle
			if (this.method === 'Chi-squared') {
				binnedData = binData(this.x.hoursSinceStart, this.y.getData(), this.binSize, 0);

				if (this.binnedData.bins.length === 0) {
					this.periodData = { x: [], y: [], threshold: [], pvalue: [] };
					return;
				}
			}

			const periods = makeSeqArray(
				this.parentPlot.periodlimsIN[0],
				this.parentPlot.periodlimsIN[1],
				this.parentPlot.periodSteps
			);
			const frequencies = periods.map((p) => 1 / p); // For Lomb-Scargle

			const correctedAlpha = Math.pow(1 - this.alpha, 1 / periods.length);
			const power = new Array(periods.length);
			const threshold = new Array(periods.length);
			const pvalue = new Array(periods.length);

			if (this.method === 'Chi-squared') {
				const data = this.binnedData.y_out;
				const avgAll = mean(data);
				let denominator = 0;
				for (let i = 0; i < data.length; i++) {
					const val = data[i];
					if (!isNaN(val)) {
						denominator += (val - avgAll) ** 2;
					}
				}

				for (let p = 0; p < periods.length; p++) {
					power[p] = calculateChiSquaredPower(data, this.binSize, periods[p], avgAll, denominator);
					threshold[p] = qchisq(1 - correctedAlpha, Math.round(periods[p] / this.binSize));
					pvalue[p] = 1 - pchisq(power[p], Math.round(periods[p] / this.binSize));
				}
			} else if (this.method === 'Lomb-Scargle') {
				const times = this.x.hoursSinceStart;
				const values = this.y.getData();
				const powers = calculateLombScarglePower(times, values, frequencies);

				for (let p = 0; p < periods.length; p++) {
					power[p] = powers[p];
					// For Lomb-Scargle, significance thresholds are more complex; use a simplified approach
					threshold[p] = -Math.log(correctedAlpha) / 2; // Approximate threshold
					pvalue[p] = Math.exp(-2 * power[p]); // Approximate p-value
				}
			}

			this.periodData = { x: periods, y: power, threshold, pvalue };
		}

		constructor(parent, dataIN) {
			this.parentPlot = parent;

			if (dataIN && dataIN.x) {
				this.x = ColumnClass.fromJSON(dataIN.x);
			} else {
				this.x = new ColumnClass({ refId: -1 });
			}
			if (dataIN && dataIN.y) {
				this.y = ColumnClass.fromJSON(dataIN.y);
			} else {
				this.y = new ColumnClass({ refId: -1 });
			}
			this.linecolour = dataIN?.linecolour ?? getPaletteColor(this.parentPlot.data.length);
			this.pointcolour = dataIN?.pointcolour ?? getPaletteColor(this.parentPlot.data.length);
			this.method = dataIN?.method ?? 'Lomb-Scargle'; // Initialize method
		}

		toJSON() {
			return {
				x: this.x,
				y: this.y,
				linecolour: this.linecolour,
				linestrokeWidth: this.linestrokeWidth,
				pointcolour: this.pointcolour,
				pointradius: this.pointradius,
				binSize: this.binSize,
				method: this.method,
				alpha: this.alpha
			};
		}

		static fromJSON(json, parent) {
			return new PeriodogramDataclass(parent, {
				x: json.x,
				y: json.y,
				linecolour: json.linecolour,
				linestrokeWidth: json.linestrokeWidth,
				pointcolour: json.pointcolour,
				pointradius: json.pointradius,
				binSize: json.binSize,
				method: json.method,
				alpha: json.alpha
			});
		}
	}

	export class Periodogramclass {
		parentBox = $state();
		data = $state([]);
		padding = $state({ top: 15, right: 20, bottom: 30, left: 30 });
		plotheight = $derived(this.parentBox.height - this.padding.top - this.padding.bottom);
		plotwidth = $derived(this.parentBox.width - this.padding.left - this.padding.right);

		periodlimsIN = $state([1, 30]);
		periodSteps = $state(0.25);
		ylimsIN = $state([null, null]);
		ylims = $derived.by(() => {
			if (this.data.length === 0) {
				return [0, 0];
			}

			let ymin = Infinity;
			let ymax = -Infinity;
			this.data.forEach((d, i) => {
				let tempy = this.data[i].periodData.y;
				ymin = Math.min(ymin, Math.min(...tempy));
				ymax = Math.max(ymax, Math.max(...tempy));
			});
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
			if (Object.keys(dataIN).includes('time')) {
				const temp = { x: { refId: dataIN.time.refId }, y: { refId: dataIN.values.refId } };
				dataIN = structuredClone(temp);
			}
			const datum = new PeriodogramDataclass(this, dataIN);
			datum.updatePeriodData();
			this.data.push(datum);
		}
		removeData(idx) {
			this.data.splice(idx, 1);
		}
		updateAllPeriodData() {
			this.data.forEach((datum) => datum.updatePeriodData());
		}

		toJSON() {
			return {
				periodlimsIN: this.periodlimsIN,
				periodSteps: this.periodSteps,
				ylimsIN: this.ylimsIN,
				padding: this.padding,
				ygridlines: this.ygridlines,
				xgridlines: this.xgridlines,
				data: this.data
			};
		}
		static fromJSON(parent, json) {
			if (!json) {
				return new Periodogramclass(parent, null);
			}

			const periodogram = new Periodogramclass(parent, null);
			periodogram.padding = json.padding ?? json.paddingIN;
			periodogram.periodlimsIN = json.periodlimsIN;
			periodogram.periodSteps = json.periodSteps;
			periodogram.ylimsIN = json.ylimsIN;
			periodogram.ygridlines = json.ygridlines;
			periodogram.xgridlines = json.xgridlines;

			if (json.data) {
				periodogram.data = json.data.map((d) => PeriodogramDataclass.fromJSON(d, periodogram));
				periodogram.updateAllPeriodData();
			}
			return periodogram;
		}
	}
</script>

<script>
	import { onMount } from 'svelte';
	import Icon from '$lib/icons/Icon.svelte';

	let { theData, which } = $props();

	let currentControlTab = $state('properties');

	$effect(() => {
		if (theData.periodlimsIN || theData.periodSteps) {
			theData.updateAllPeriodData();
		}
	});

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
				<div class="control-component-title-icons">
					<button class="icon" onclick={() => (theData.ylimsIN = [null, null])}>
						<Icon name="reset" width={14} height={14} className="control-component-title-icon" />
					</button>
				</div>
			</div>

			<!-- TODO: fix checkbox input style -->
			<div class="control-input-vertical">
				<div class="control-input-checkbox">
					<input type="checkbox" bind:checked={theData.ygridlines} />
					<p>Grid</p>
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
							theData.ylimsIN[0] = [parseFloat(e.target.value)];
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
							theData.ylimsIN[1] = [parseFloat(e.target.value)];
						}}
					/>
				</div>
			</div>
		</div>

		<div class="control-component">
			<div class="control-component-title">
				<p>X-Axis</p>
			</div>

			<div class="control-input-vertical">
				<div class="control-input-checkbox">
					<input type="checkbox" bind:checked={theData.xgridlines} />
					<p>Period Grid</p>
				</div>
			</div>

			<div class="control-input-horizontal">
				<div class="control-input">
					<p>Min</p>
					<input
						type="number"
						min="0.1"
						step="0.1"
						value={theData.periodlimsIN[0] ? theData.periodlimsIN[0] : theData.periodlims[0]}
						oninput={(e) => {
							theData.periodlimsIN[0] = parseFloat(e.target.value);
						}}
					/>
				</div>

				<div class="control-input">
					<p>Max</p>
					<input
						type="number"
						step="0.1"
						value={theData.periodlimsIN[1] ? theData.periodlimsIN[1] : theData.periodlimsIN[1]}
						oninput={(e) => {
							theData.periodlimsIN[1] = parseFloat(e.target.value);
						}}
					/>
				</div>
			</div>

			<div class="control-input-vertical">
				<div class="control-input">
					<p>Period Step</p>
					<input type="number" min="0.1" step="0.01" bind:value={theData.periodSteps} />
				</div>
			</div>
		</div>
	{:else if currentControlTab === 'data'}
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

				<!-- New: Method selector -->
				<p>
					Method:
					<select bind:value={datum.method} onchange={() => datum.updatePeriodData()}>
						<option value="Chi-squared">Chi-squared</option>
						<option value="Lomb-Scargle">Lomb-Scargle</option>
					</select>
				</p>

				<!-- binSize only relevant for Chi-squared -->
				{#if datum.method === 'Chi-squared'}
					binSize: <input type="number" step="0.01" min="0.01" bind:value={datum.binSize} />
					alpha:
					<input
						type="number"
						min="0.0001"
						max="0.9999"
						step="0.01"
						bind:value={datum.alpha}
						oninput={() => datum.updatePeriodData()}
					/>
				{/if}

				line col: <ColourPicker bind:value={datum.linecolour} />
				line width: <input type="number" step="0.1" min="0.1" bind:value={datum.linestrokeWidth} />
				point col: <ColourPicker bind:value={datum.pointcolour} />
				point radius: <input type="number" step="0.1" min="0.1" bind:value={datum.pointradius} />
			{/each}
		</div>
	{/if}
{/snippet}

{#snippet plot(theData)}
	<!-- Unchanged plot rendering -->
	<svg
		id={'plot' + theData.plot.parentBox.id}
		width={theData.plot.parentBox.width}
		height={theData.plot.parentBox.height}
		viewBox="0 0 {theData.plot.parentBox.width} {theData.plot.parentBox.height}"
		style={`background: white; position: absolute;`}
		ontooltip={handleTooltip}
	>
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
		/>
		<Axis
			height={theData.plot.plotheight}
			width={theData.plot.plotwidth}
			scale={scaleLinear()
				.domain([theData.plot.periodlimsIN[0], theData.plot.periodlimsIN[1]])
				.range([0, theData.plot.plotwidth])}
			position="bottom"
			plotPadding={theData.plot.padding}
			nticks={5}
			gridlines={theData.plot.xgridlines}
		/>

		{#each theData.plot.data as datum}
			<Line
				x={datum.periodData.x}
				y={datum.periodData.y}
				xscale={scaleLinear()
					.domain([theData.plot.periodlimsIN[0], theData.plot.periodlimsIN[1]])
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
				x={datum.periodData.x}
				y={datum.periodData.y}
				xscale={scaleLinear()
					.domain([theData.plot.periodlimsIN[0], theData.plot.periodlimsIN[1]])
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
			{#if datum.method === 'Chi-squared'}
				<Line
					x={datum.periodData.x}
					y={datum.periodData.threshold}
					xscale={scaleLinear()
						.domain([theData.plot.periodlimsIN[0], theData.plot.periodlimsIN[1]])
						.range([0, theData.plot.plotwidth])}
					yscale={scaleLinear()
						.domain([theData.plot.ylims[0], theData.plot.ylims[1]])
						.range([theData.plot.plotheight, 0])}
					strokeCol={datum.linecolour}
					strokeWidth={datum.linestrokeWidth}
					yoffset={theData.plot.padding.top}
					xoffset={theData.plot.padding.left}
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
