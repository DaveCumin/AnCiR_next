<script module>
	// @ts-nocheck

	import Column from '$lib/core/Column.svelte';
	import Hist from '$lib/components/plotBits/Hist.svelte';
	import Axis from '$lib/components/plotBits/Axis.svelte';

	import { Column as ColumnClass } from '$lib/core/Column.svelte';
	import ColourPicker, { getPaletteColor } from '$lib/components/inputs/ColourPicker.svelte';
	import PhaseMarker, { PhaseMarkerClass } from './PhaseMarker.svelte';
	import LightBand, { LightBandClass } from './LightBand.svelte';

	import { scaleLinear } from 'd3-scale';
	import { makeSeqArray, max, min } from '$lib/components/plotBits/helpers/wrangleData';

	export const Actogram_defaultDataInputs = ['time', 'values'];

	function getNdataByPeriods(dataIN, from, to, period) {
		const byPeriod = [];

		for (let p = from; p < to; p++) {
			if (dataIN[p]) {
				const offset = from * period;
				byPeriod.push(...dataIN[p].map((d) => d - offset));
			}
		}
		return byPeriod;
	}

	class ActogramDataclass {
		parentPlot = $state();

		x = $state();
		y = $state();
		binSize = $derived.by(() => {
			//the average time between x values
			return (
				(this.x.hoursSinceStart[this.x.hoursSinceStart.length - 1] - this.x.hoursSinceStart[0]) /
				this.x.hoursSinceStart.length
			);
		});
		colour = $state();
		offset = $derived(
			(Number(new Date(this.parentPlot.startTime)) - Number(this.x.getData()[0])) / 3600000
		);
		dataByDays = $derived.by(() => {
			const tempx = this.x.hoursSinceStart ?? [];
			const tempy = this.y.getData() ?? [];
			const xByPeriod = {};
			const yByPeriod = {};

			//TODO: compute the min and max for the y-axis (overall v by periods)
			for (let i = 0; i < tempx.length; i++) {
				const period = Math.floor((tempx[i] - this.offset) / this.parentPlot.periodHrs);

				if (period >= 0) {
					if (!xByPeriod[period]) {
						xByPeriod[period] = [];
						yByPeriod[period] = [];
					}
					if (xByPeriod[period]) {
						xByPeriod[period].push(tempx[i] - this.offset);
						yByPeriod[period].push(tempy[i]);
					}
				}
			}
			return { xByPeriod, yByPeriod };
		});
		phaseMarkers = $state([]);

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
			this.colour = dataIN?.colour ?? getPaletteColor(this.parentPlot.data.length);
		}

		addMarker() {
			this.phaseMarkers.push(new PhaseMarkerClass(this, { type: 'manual' }));
		}

		toJSON() {
			return {
				x: this.x,
				y: this.y,
				colour: this.colour,
				phaseMarkers: this.phaseMarkers
			};
		}

		static fromJSON(json, parent) {
			const actClass = new ActogramDataclass(parent, {
				x: json.x,
				y: json.y,
				colour: json.colour
			});
			if (json.phaseMarkers) {
				actClass.phaseMarkers = json.phaseMarkers.map((d) =>
					PhaseMarkerClass.fromJSON(d, actClass)
				);
			}
			return actClass;
		}
	}

	export class Actogramclass {
		parentBox = $state();
		data = $state([]);
		isAddingMarkerTo = $state(-1);
		paddingIN = $state({ top: 30, right: 20, bottom: 10, left: 20 });
		padding = $derived.by(() => {
			if (this.lightBands.length > 0) {
				return {
					top: this.paddingIN.top + this.lightBands.height * 2,
					right: this.paddingIN.right,
					bottom: this.paddingIN.bottom,
					left: this.paddingIN.left
				};
			} else {
				return {
					top: this.paddingIN.top,
					right: this.paddingIN.right,
					bottom: this.paddingIN.bottom,
					left: this.paddingIN.left
				};
			}
		});
		plotheight = $derived(this.parentBox.height - this.padding.top - this.padding.bottom);
		plotwidth = $derived(this.parentBox.width - this.padding.left - this.padding.right);
		eachplotheight = $derived.by(() => {
			return (this.plotheight - (this.Ndays - 1) * this.spaceBetween) / this.Ndays;
		});
		startTime = $derived.by(() => {
			let minTime = Infinity;
			this.data.forEach((datum) => {
				const thefirst = datum.x.getData() ? datum.x.getData()[0] : minTime;
				minTime = Math.min(minTime, Number(thefirst));
			});
			//TODO: fix here for data with timeformat that doesn't work
			return minTime !== Infinity && (minTime >= 0)
				? new Date(minTime).toISOString().substring(0, 10)
				: undefined;
		});
		spaceBetween = $state(2);
		doublePlot = $state(2);
		periodHrs = $state(24);
		lightBands = $state(new LightBandClass(this, { lightBands: [] }));
		Ndays = $derived.by(() => {
			if (this.data.length === 0) {
				return 0;
			}
			let Ndays = 0;
			this.data.forEach((d, i) => {
				Ndays = Math.max(Ndays, Object.keys(d.dataByDays.xByPeriod).length);
			});

			return Ndays;
		});

		ylimsIN = $state([null, null]);
		ylims = $derived.by(() => {
			if (this.data.length === 0) {
				return [0, 0];
			}

			let ymin = Infinity;
			let ymax = -Infinity;
			this.data.forEach((d, i) => {
				let tempy = this.data[i].y.getData() ?? [];
				ymin = Math.min(ymin, min(tempy));
				ymax = Math.max(ymax, max(tempy));
			});
			return [this.ylimsIN[0] ? this.ylimsIN[0] : ymin, this.ylimsIN[1] ? this.ylimsIN[1] : ymax];
		});

		constructor(parent, dataIN) {
			this.parentBox = parent;
			if (dataIN) {
				this.addData(dataIN);
			}
		}

		addData(dataIN) {
			if (Object.keys(dataIN).includes('time')) {
				const temp = { x: { refId: dataIN.time.refId }, y: { refId: dataIN.values.refId } };
				dataIN = structuredClone(temp);
			}
			this.data.push(new ActogramDataclass(this, dataIN));
		}
		removeData(idx) {
			this.data.splice(idx, 1);
		}

		addPhaseMarkerTo(markerId, clickedDay, clickedTime) {
			//find the marker with the id
			for (let i = 0; i < this.data.length; i++) {
				for (let j = 0; j < this.data[i].phaseMarkers.length; j++) {
					if (this.data[i].phaseMarkers[j].id == markerId) {
						this.data[i].phaseMarkers[j].addTime(clickedDay, clickedTime);
					}
				}
			}
		}

		toJSON() {
			return {
				ylimsIN: this.ylimsIN,
				paddingIN: this.paddingIN,
				doublePlot: this.doublePlot,
				periodHrs: this.periodHrs,
				lightBands: this.lightBands,
				data: this.data
			};
		}
		static fromJSON(parent, json) {
			if (!json) {
				return new Actogramclass(parent, null);
			}
			const actogram = new Actogramclass(parent, null);
			actogram.paddingIN = json.paddingIN;
			actogram.ylimsIN = json.ylimsIN;
			actogram.doublePlot = json.doublePlot;
			actogram.periodHrs = json.periodHrs;

			actogram.lightBands = LightBandClass.fromJSON(
				json.lightBands ?? { lightBands: [] },
				actogram
			);

			if (json.data) {
				actogram.data = json.data.map((d) => ActogramDataclass.fromJSON(d, actogram));
			}
			return actogram;
		}
	}
</script>

<script>
	import { appState } from '$lib/core/core.svelte';

	import Icon from '$lib/icons/Icon.svelte';

	let { theData, which } = $props();

	function handleClick(e) {
		if (theData.plot.isAddingMarkerTo >= 0) {
			const [clickedDay, clickedHrs] = getClickedTime(e);
			theData.plot.addPhaseMarkerTo(theData.plot.isAddingMarkerTo, clickedDay, clickedHrs);
		}
		theData.plot.isAddingMarkerTo = -1;
	}

	function getClickedTime(e) {
		if (
			e.offsetX < theData.plot.padding.left ||
			e.offsetX > theData.plot.padding.left + theData.plot.plotwidth ||
			e.offsetY < theData.plot.padding.top ||
			e.offsetY > theData.plot.padding.top + theData.plot.plotheight
		) {
			return null;
		}

		const clickedDay = Math.floor(
			(e.offsetY - theData.plot.padding.top) /
				(theData.plot.eachplotheight + theData.plot.spaceBetween)
		);
		const clickedHrs =
			((e.offsetX - theData.plot.padding.left) / theData.plot.plotwidth) *
			theData.plot.periodHrs *
			theData.plot.doublePlot;

		return [clickedDay, clickedHrs];
	}
</script>

{#snippet controls(theData)}
	{#if appState.currentControlTab === 'properties'}

		<div class="control-component">
			<!-- <div class="control-component-title">
				<p>Dimension</p>
			</div> -->
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
					<input type="number" bind:value={theData.paddingIN.top} />
				</div>

				<div class="control-input">
					<p>Bottom</p>
					<input type="number" bind:value={theData.paddingIN.bottom} />
				</div>

				<div class="control-input">
					<p>Left</p>
					<input type="number" bind:value={theData.paddingIN.left} />
				</div>

				<div class="control-input">
					<p>Right</p>
					<input type="number" bind:value={theData.paddingIN.right} />
				</div>
			</div>

			<div class="control-input-vertical">
				<div class="control-input">
					<p>Space Between</p>
					<input type="number" bind:value={theData.spaceBetween} />
				</div>
			</div>
		</div>

		<div class="div-line"></div>

		<div class="control-component">
			<LightBand bind:bands={theData.lightBands} which="controls" />
		</div>

		<div class="div-line"></div>

		<div class="control-component">
			<div class="control-component-title">
				<p>Time</p>
			</div>

			<div class="control-input-vertical">
				<div class="control-input">
					<p>Start time</p>
					<input type="date" bind:value={theData.startTime} />
				</div>
			</div>

			<div class="control-input-horizontal">
				<div class="control-input">
					<p>Period</p>
					<input type="number" step="0.1" bind:value={theData.periodHrs} />
				</div>

				<div class="control-input">
					<p>Repeat</p>
					<input type="number" bind:value={theData.doublePlot} />
				</div>
			</div>
		</div>

		<div class="div-line"></div>

		<div class="control-component">
			<div class="control-component-title">
				<p>Y-lims</p>
				<div class="control-component-title-icons">
					<button class="icon" onclick={() => (theData.ylimsIN = [null, null])}>
						<Icon name="reset" width={14} height={14} className="control-component-title-icon" />
					</button>
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

				colour: <ColourPicker bind:value={datum.colour} />

				<p>Markers:<button onclick={() => datum.addMarker()}>+</button></p>
				{#each datum.phaseMarkers as marker}
					<PhaseMarker {which} {marker} />
				{/each}
			{/each}
		</div>
	{/if}
{/snippet}

{#snippet plot(theData)}
	<svg
		id={'plot' + theData.plot.parentBox.id}
		width={theData.plot.parentBox.width}
		height={theData.plot.parentBox.height}
		style={`background: white; position: absolute;`}
		onclick={(e) => handleClick(e)}
	>
		<LightBand bind:bands={theData.plot.lightBands} which="plot" />
		<!-- The X-axis -->
		<Axis
			height={theData.plot.plotheight}
			width={theData.plot.plotwidth}
			scale={scaleLinear()
				.domain([0, theData.plot.periodHrs * theData.plot.doublePlot])
				.range([0, theData.plot.plotwidth])}
			position="top"
			yoffset={theData.plot.padding.top}
			xoffset={theData.plot.padding.left}
			nticks={theData.plot.plotwidth > 600
				? theData.plot.periodHrs
				: Math.max(2, theData.plot.plotwidth / 150)}
			gridlines={false}
		/>

		{#each theData.plot.data as datum}
			<g
				class="actogram"
				style="transform: translate({theData.plot.padding.left}px, {theData.plot.padding.top}px);"
			>
				<!-- Make the histogram for each period -->
				{#each makeSeqArray(0, theData.plot.Ndays - 1, 1) as day}
					<Hist
						x={getNdataByPeriods(
							datum.dataByDays.xByPeriod,
							day,
							day + theData.plot.doublePlot,
							theData.plot.periodHrs
						)}
						y={getNdataByPeriods(datum.dataByDays.yByPeriod, day, day + theData.plot.doublePlot, 0)}
						xscale={scaleLinear()
							.domain([0, theData.plot.periodHrs * theData.plot.doublePlot])
							.range([0, theData.plot.plotwidth])}
						yscale={scaleLinear()
							.domain([theData.plot.ylims[0], theData.plot.ylims[1]])
							.range([theData.plot.eachplotheight, 0])}
						colour={datum.colour}
						yoffset={day * theData.plot.spaceBetween + day * theData.plot.eachplotheight}
					/>
				{/each}
			</g>
			<!-- THE MARKERS -->
			{#each datum.phaseMarkers as marker}
				<PhaseMarker {which} {marker} />
			{/each}
		{/each}
	</svg>
{/snippet}

{#if which === 'plot'}
	{@render plot(theData)}
{:else if which === 'controls'}
	{@render controls(theData)}
{/if}
