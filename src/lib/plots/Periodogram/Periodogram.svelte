<script module>
	import { Column as ColumnClass } from '$lib/core/Column.svelte';
	import Column from '$lib/core/Column.svelte';
	import Axis from '$lib/components/plotbits/Axis.svelte';
	import { scaleLinear } from 'd3-scale';
	import { getRandomColor } from '$lib/components/inputs/ColourPicker.svelte';
	import { core } from '$lib/core/core.svelte.js';
	import { binData, mean, makeSeqArray } from '$lib/components/plotbits/helpers/wrangleData.js';
	import { pchisq, qchisq } from '$lib/data/CDFs';

	import Line from '$lib/components/plotbits/Line.svelte';
	import Points from '$lib/components/plotbits/Points.svelte';

	function calculatePower(data, binSize, period, avgAll, denominator) {
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
		binnedData = $derived.by(() => {
			return binData(this.x.hoursSinceStart, this.y.getData(), this.binSize, 0);
		});
		periodData = $state({ x: [], y: [], threshold: [], pvalue: [] });
		linecolour = $state();
		linestrokeWidth = $state(3);
		pointcolour = $state();
		pointradius = $state(5);
		alpha = $state(0.05);

		// Compute periodogram data - this is faster than the $derived. Could also consider debouncing, if updates are slow.
		updatePeriodData() {
			if (this.binnedData.bins.length == 0) {
				this.periodData = { x: [], y: [], threshold: [], pvalue: [] };
			} else {
				const periods = makeSeqArray(
					this.parentPlot.periodlimsIN[0],
					this.parentPlot.periodlimsIN[1],
					this.parentPlot.periodSteps
				);

				const correctedAlpha = Math.pow(1 - this.alpha, 1 / periods.length);
				const power = new Array(periods.length);
				const threshold = new Array(periods.length);
				const pvalue = new Array(periods.length);

				// Compute the average one
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
					power[p] = calculatePower(data, this.binSize, periods[p], avgAll, denominator);
					threshold[p] = qchisq(1 - correctedAlpha, Math.round(periods[p] / this.binSize));
					pvalue[p] = 1 - pchisq(power[p], Math.round(periods[p] / this.binSize));
				}

				this.periodData = { x: periods, y: power, threshold, pvalue };
			}
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
			this.linecolour = dataIN?.linecolour ?? getRandomColor();
			this.pointcolour = dataIN?.pointcolour ?? getRandomColor();
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
			return new PeriodogramDataclass(parent, {
				x: json.x,
				y: json.y,
				linecolour: json.linecolour,
				linestrokeWidth: json.linestrokeWidth,
				pointcolour: json.pointcolour,
				pointradius: json.pointradius
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

		addData(dataIN) {
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
			periodogram.padding = json.padding;
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
	import { convertToImage } from '$lib/components/plotbits/helpers/save.js';
	let { theData, which } = $props();

	function pickRandomData() {
		const options = Array.from(core.data.keys());
		return options.length > 0 ? options[Math.floor(Math.random() * options.length)] : -1;
	}

	$effect(() => {
		if (theData.periodlimsIN || theData.periodSteps) {
			theData.updateAllPeriodData();
		}
	});
</script>

{#snippet controls(theData)}
	<button onclick={() => convertToImage('plot' + theData.parentBox.id, 'svg')}>Save </button>
	
	<div class="control-component">
		<div class="control-input">
			<p>Name: </p>
			<input type="text" bind:value={theData.parentBox.name} />
		</div>

		<div class="control-input">
			<p>Width: </p>
			<input type="number" bind:value={theData.parentBox.width} />
		</div>

		<div class="control-input">
			<p>Height: </p>
			<input type="number" bind:value={theData.parentBox.height} />
		</div>
	</div>

	<div class="control-component">
		<p class="control-component-title">Padding: </p>
		
		<p>Top: </p>
		<input type="number" bind:value={theData.padding.top} />
		
		<p>Bottom: </p>
		<input type="number" bind:value={theData.padding.bottom} />

		<p>Left: </p>
		<input type="number" bind:value={theData.padding.left} />

		<p>Right: </p>
		<input type="number" bind:value={theData.padding.right} />
		
		<p>{JSON.stringify(theData.padding)}</p>
	</div>

	<div class="control-component">
		<button onclick={() => (theData.ylimsIN = [null, null])}>Re-centre</button>

		<p class="control-component-title">ylims: </p>
		<p>Grid:<input type="checkbox" bind:checked={theData.ygridlines} /></p>

		<p>Min: </p>
		<input
			type="number"
			step="0.1"
			value={theData.ylimsIN[0] ? theData.ylimsIN[0] : theData.ylims[0]}
			oninput={(e) => {
				theData.ylimsIN[0] = [parseFloat(e.target.value)];
			}}
		/>
		
		<p>Max: </p>
		<input
			type="number"
			step="0.1"
			value={theData.ylimsIN[1] ? theData.ylimsIN[1] : theData.ylims[1]}
			oninput={(e) => {
				theData.ylimsIN[1] = [parseFloat(e.target.value)];
			}}
		/>
	</div>

	<div class="control-component">
		<button onclick={() => (theData.xlimsIN = [null, null])}>Re-centre</button>

		<p class="control-component-title">xlims: </p>
		<p>Period Grid: <input type="checkbox" bind:checked={theData.xgridlines} /></p>

		<p>Min: </p>
		<input
			type="number"
			min="0.1"
			step="0.1"
			value={theData.periodlimsIN[0] ? theData.periodlimsIN[0] : theData.periodlims[0]}
			oninput={(e) => {
				theData.periodlimsIN[0] = parseFloat(e.target.value);
			}}
		/>

		<p>Max: </p>
		<input
			type="number"
			step="0.1"
			value={theData.periodlimsIN[1] ? theData.periodlimsIN[1] : theData.periodlims[1]}
			oninput={(e) => {
				theData.periodlimsIN[1] = parseFloat(e.target.value);
			}}
		/>
		<p>Step: </p>
		<input type="number" min="0.1" step="0.01" bind:value={theData.periodSteps} />
	</div>

	<div>
		<p>Data:</p>
		<button
			onclick={() =>
				theData.addData({
					x: { refId: pickRandomData() },
					y: { refId: pickRandomData() }
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

			line col: <input type="color" bind:value={datum.linecolour} />
			line width: <input type="number" step="0.1" min="0.1" bind:value={datum.linestrokeWidth} />
			point col: <input type="color" bind:value={datum.pointcolour} />
			point radius: <input type="number" step="0.1" min="0.1" bind:value={datum.pointradius} />
		{/each}
	</div>
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
			scale={scaleLinear()
				.domain([theData.plot.periodlimsIN[0], theData.plot.periodlimsIN[1]])
				.range([0, theData.plot.plotwidth])}
			position="bottom"
			yoffset={theData.plot.padding.top}
			xoffset={theData.plot.padding.left}
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
			/>
			<!-- the threshold -->
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
		{/each}
	</svg>
{/snippet}

{#if which === 'plot'}
	{@render plot(theData)}
{:else if which === 'controls'}
	{@render controls(theData)}
{/if}
