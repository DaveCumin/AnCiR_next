<script module>
	import { Column as ColumnClass } from '$lib/core/Column.svelte';
	import Column from '$lib/core/Column.svelte';
	import Axis from '$lib/components/plotbits/Axis.svelte';
	import { scaleLinear } from 'd3-scale';
	import { getRandomColor } from '$lib/components/inputs/ColourPicker.svelte';
	import { core } from '$lib/core/theCore.svelte.js';
	import { binData, mean, makeSeqArray } from '$lib/components/plotbits/helpers/wrangleData.js';
	import { pchisq, qchisq } from '$lib/data/CDFs';

	import Line from '$lib/components/plotbits/Line.svelte';
	import Points from '$lib/components/plotbits/Points.svelte';

	function calculatePower(data, binSize, period) {
		const colNum = Math.round(period / binSize);
		const rowNum = Math.ceil(data.length / colNum);

		const avgP = Array.from({ length: colNum }, (_, colIndex) => {
			const colStart = colIndex;
			const colValues = Array.from(
				{ length: rowNum },
				(_, rowIndex) => data[colStart + rowIndex * colNum]
			).filter((value) => value !== undefined && !isNaN(value)); // only keep the true values

			//return the mean
			return mean(colValues);
		});

		const avgAll = mean(data);

		const numerator =
			avgP.reduce((sum, avgPValue) => sum + Math.pow(avgPValue - avgAll, 2), 0) *
			(data.length * rowNum);
		const denominator = data.reduce((sum, value) => sum + Math.pow(value - avgAll, 2), 0);
		return numerator / denominator;
	}

	class PeriodogramDataclass {
		parent = $state();
		x = $state();
		y = $state();
		binSize = $state(0.15);
		binnedData = $derived(binData(this.x.getData(), this.y.getData(), this.binSize, 0));
		periodData = $state({ x: [], y: [], threshold: [], pvalue: [] });
		linecolour = $state();
		linestrokeWidth = $state(3);
		pointcolour = $state();
		pointradius = $state(5);
		alpha = $state(0.05);

		// Compute periodogram data - this is faster than the $derived. Could also consider debouncing, if updates are slow.
		updatePeriodData() {
			const periods = makeSeqArray(
				this.parent.periodlimsIN[0],
				this.parent.periodlimsIN[1],
				this.parent.periodSteps
			);

			const correctedAlpha = Math.pow(1 - this.alpha, 1 / periods.length);
			const power = new Array(periods.length);
			const threshold = new Array(periods.length);
			const pvalue = new Array(periods.length);

			for (let p = 0; p < periods.length; p++) {
				power[p] = calculatePower(this.binnedData.y_out, this.binSize, periods[p]);
				threshold[p] = qchisq(1 - correctedAlpha, Math.round(periods[p] / this.binSize));
				pvalue[p] = 1 - pchisq(power[p], Math.round(periods[p] / this.binSize));
			}

			this.periodData = { x: periods, y: power, threshold, pvalue };
		}

		constructor(parent, dataIN) {
			this.parent = parent;

			if (dataIN && dataIN.x) {
				this.x = ColumnClass.fromJSON(dataIN.x);
			} else {
				this.x = new ColumnClass({ refDataID: -1 });
			}
			if (dataIN && dataIN.y) {
				this.y = ColumnClass.fromJSON(dataIN.y);
			} else {
				this.y = new ColumnClass({ refDataID: -1 });
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
		parent = $state();
		data = $state([]);
		padding = $state({ top: 15, right: 20, bottom: 30, left: 30 });
		plotheight = $derived(this.parent.height - this.padding.top - this.padding.bottom);
		plotwidth = $derived(this.parent.width - this.padding.left - this.padding.right);
		periodlimsIN = $state([1, 30]);
		periodSteps = $state(0.15);
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
			return [this.ylimsIN[0] ? this.ylimsIN[0] : ymin, this.ylimsIN[1] ? this.ylimsIN[1] : ymax];
		});
		xgridlines = $state(true);
		ygridlines = $state(true);

		constructor(parent, dataIN) {
			this.parent = parent;
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

			const periodogram = newPeriodogramclass(parent, null);
			periodogram.padding = json.padding;
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

	let axisDimensions = { bottom: 0, left: 0, top: 0, right: 0 };
	function handleAxisDimensions(event) {
		const { width, height } = event.detail;
		// Update temporary storage instead of padding directly
		axisDimensions[event.detail.position] =
			event.detailposition === 'bottom' || event.detailposition === 'top' ? height : width;

		// Update padding only when necessary (e.g., after all axes are measured)
		const newPadding = { ...theData.plot.padding };
		let needsUpdate = false;
		for (const pos of ['bottom', 'left', 'top', 'right']) {
			if (axisDimensions[pos] > 0 && newPadding[pos] < axisDimensions[pos] + 10) {
				newPadding[pos] = axisDimensions[pos] + 10; // Add buffer
				needsUpdate = true;
			}
		}
		if (needsUpdate) {
			theData.plot.padding = newPadding; // Single update to avoid loop
		}
	}
</script>

{#snippet controls(theData)}
	<div>
		<button onclick={() => convertToImage('plot' + theData.parent.plotid, 'svg')}>Save </button>
		Name: <input type="text" bind:value={theData.parent.name} />
		Width: <input type="number" bind:value={theData.parent.width} />
		height: <input type="number" bind:value={theData.parent.height} />

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
			period grid:<input type="checkbox" bind:checked={theData.xgridlines} />
			<input
				type="number"
				min="0.1"
				step="0.1"
				value={theData.periodlimsIN[0] ? theData.periodlimsIN[0] : theData.periodlims[0]}
				oninput={(e) => {
					theData.periodlimsIN[0] = parseFloat(e.target.value);
				}}
			/>
			<input
				type="number"
				step="0.1"
				value={theData.periodlimsIN[1] ? theData.periodlimsIN[1] : theData.periodlims[1]}
				oninput={(e) => {
					theData.periodlimsIN[1] = parseFloat(e.target.value);
				}}
			/>
			step:
			<input type="number" min="0.1" step="0.01" bind:value={theData.periodSteps} />
		</p>
		<p>Data:</p>
		<button
			onclick={() =>
				theData.addData({
					x: { refDataID: pickRandomData() },
					y: { refDataID: pickRandomData() }
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
		id={'plot' + theData.plot.parent.plotid}
		width={theData.plot.parent.width}
		height={theData.plot.parent.height}
		viewBox="0 0 {theData.plot.parent.width} {theData.plot.parent.height}"
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
			on:dimensions={handleAxisDimensions}
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
			on:dimensions={handleAxisDimensions}
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
