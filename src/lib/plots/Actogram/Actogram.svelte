<script module>
	// @ts-nocheck

	import Column from '$lib/core/Column.svelte';
	import Hist, { createHistogramBins } from '$lib/components/plotBits/Hist.svelte';
	import Axis from '$lib/components/plotBits/Axis.svelte';

	import { Column as ColumnClass } from '$lib/core/Column.svelte';
	import ColourPicker, { getPaletteColor } from '$lib/components/inputs/ColourPicker.svelte';
	import PhaseMarker, { PhaseMarkerClass } from './PhaseMarker.svelte';
	import LightBand, { LightBandClass } from './LightBand.svelte';
	import Annotation, { AnnotationClass } from './Annotation.svelte';

	import { scaleLinear } from 'd3-scale';
	import { makeSeqArray, max, min } from '$lib/components/plotBits/helpers/wrangleData';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import { dataSettingsScrollTo } from '$lib/components/views/ControlDisplay.svelte';

	import Icon from '$lib/icons/Icon.svelte';

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
		draw = $state();
		binSize = $derived.by(() => {
			//the average time between x values
			return (
				(this.x.hoursSinceStart[this.x.hoursSinceStart.length - 1] - this.x.hoursSinceStart[0]) /
				this.x.hoursSinceStart.length
			);
		});
		colour = $state();
		offset = $derived.by(() => {
			if (this.x?.getData()) {
				if (this.x.type == 'time') {
					return (this.parentPlot?.startTime - Number(this.x?.getData()[0])) / 3600000; //get the hours
				} else {
					return -Number(this.x?.getData()[0]); //always just the value from the start
				}
			} else {
				return 0;
			}
		});

		dataByDays = $derived.by(() => {
			const tempx = this.x.hoursSinceStart ?? [];
			const tempy = this.y.getData() ?? [];
			const xByPeriod = {};
			const yByPeriod = {};
			const offset = this.offset ?? 0;
			const period = this.parentPlot?.periodHrs ?? 24;

			for (let i = 0; i < tempx.length; i++) {
				const p = Math.floor((tempx[i] - offset) / period);
				if (
					p >= 0 &&
					!isNaN(tempx[i]) &&
					!isNaN(tempy[i]) &&
					tempy[i] != null &&
					tempx[i] != null
				) {
					xByPeriod[p] ||= [];
					yByPeriod[p] ||= [];
					xByPeriod[p].push(tempx[i] - offset);
					yByPeriod[p].push(tempy[i]);
				}
			}

			return { xByPeriod, yByPeriod };
		});

		// New derived property to create histogram bins for each day
		histogramBinsByDays = $derived.by(() => {
			const { xByPeriod, yByPeriod } = this.dataByDays;
			const binsByPeriod = {};

			Object.keys(xByPeriod).forEach((period) => {
				const xData = xByPeriod[period];
				const yData = yByPeriod[period];

				if (xData && xData.length > 0) {
					const { xStart, xEnd } = createHistogramBins(xData, this.binSize);
					binsByPeriod[period] = {
						xStart,
						xEnd,
						y: yData
					};
				}
			});

			return binsByPeriod;
		});

		phaseMarkers = $state([]);

		constructor(parent, dataIN) {
			this.parentPlot = parent;

			if (dataIN && dataIN.x) {
				this.x = ColumnClass.fromJSON(dataIN.x);
			} else {
				if (parent.data.length > 0) {
					this.x = new ColumnClass({ refId: parent.data[parent.data.length - 1].x.refId });
				} else {
					//blank one
					this.x = new ColumnClass({ refId: -1 });
				}
			}
			if (dataIN && dataIN.y) {
				this.y = ColumnClass.fromJSON(dataIN.y);
			} else {
				this.y = new ColumnClass({ refId: -1 });
			}
			if (dataIN?.draw) {
				this.draw = dataIN.draw;
			} else {
				this.draw = true;
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
				draw: this.draw,
				phaseMarkers: this.phaseMarkers
			};
		}

		static fromJSON(json, parent) {
			const actClass = new ActogramDataclass(parent, {
				x: json.x,
				y: json.y,
				draw: json.draw,
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

	// Helper function to get histogram bins for specific periods
	function getHistogramBinsForPeriods(histogramBinsByDays, from, to, periodHrs) {
		const allXStart = [];
		const allXEnd = [];
		const allY = [];

		for (let p = from; p < to; p++) {
			if (histogramBinsByDays[p]) {
				const offset = from * periodHrs;
				const { xStart, xEnd, y } = histogramBinsByDays[p];

				// Apply period offset to x positions
				allXStart.push(...xStart.map((x) => x - offset));
				allXEnd.push(...xEnd.map((x) => x - offset));
				allY.push(...y);
			}
		}
		//console.log(allXStart, allXEnd);
		return { xStart: allXStart, xEnd: allXEnd, y: allY };
	}

	export class Actogramclass {
		parentBox = $state();
		data = $state([]);
		annotations = $state([]);
		isAddingMarkerTo = $state(-1);
		paddingIN = $state({ top: 30, right: 20, bottom: 10, left: 20 });
		padding = $derived.by(() => {
			const allTopPadding =
				this.lightBands.length > 0
					? this.paddingIN.top + this.lightBands.height * 2
					: this.paddingIN.top;

			return {
				top: allTopPadding,
				right: this.paddingIN.right,
				bottom: this.paddingIN.bottom,
				left: this.paddingIN.left
			};
		});
		plotheight = $derived(this.parentBox.height - this.padding.top - this.padding.bottom);
		plotwidth = $derived(this.parentBox.width - this.padding.left - this.padding.right);
		eachplotheight = $derived.by(() => {
			return (this.plotheight - (this.Ndays - 1) * this.spaceBetween) / this.Ndays;
		});
		startTime = $derived.by(() => {
			let minTime = Infinity;

			//Only update the startTime (minTime) if there is time data
			this.data.forEach((datum) => {
				if (datum.x.type == 'time' && datum.x.getData()?.length > 0) {
					const thefirst = datum.x.getData() ? datum.x.getData()[0] : minTime;
					minTime = Math.min(minTime, Number(thefirst));
				}
			});
			//if no time data then make the startTime 0 (to start with)
			if (minTime === Infinity) {
				minTime = 0;
			}

			//Keep the timezone as UTC to avoid daylight savings issues; and set to the start of the day (at least to start)
			return DateTime.fromMillis(minTime, { zone: 'utc' })
				.set({
					hour: 0,
					minute: 0,
					second: 0,
					millisecond: 0
				})
				.toMillis();
		});

		spaceBetween = $state(2);
		doublePlot = $state(2);
		periodHrs = $state(24);
		lightBands = $state(new LightBandClass(this, { lightBands: [] }));
		Ndays = $derived.by(() => {
			//TODO: this should caluclate the number of days from the start - so look at the max x data in each data and compare with the starttime
			if (this.data.length === 0) {
				return 0;
			}
			let Ndays = 0;
			this.data.forEach((d, i) => {
				Ndays = Math.max(Ndays, Object.keys(d.dataByDays.xByPeriod).length);
			});

			return Ndays;
		});

		ylimsOption = $state('overall');
		ylimsIN = $state([0, 100]);
		// make ylims and array of arrays (each period of each data)
		ylims = $derived.by(() => {
			if (this.data.length === 0) {
				return [0, 0];
			}

			let ylims_out = Array.from({ length: this.data.length }, () =>
				Array.from({ length: this.Ndays }, () => Array.from({ length: 2 }, () => 0))
			);
			// Calculate the lims for each period
			if (this.ylimsOption == 'byperiod') {
				this.data.forEach((d, i) => {
					for (let k = 0; k < this.Ndays; k++) {
						ylims_out[i][k] = [
							min(getNdataByPeriods(d.dataByDays.yByPeriod, k, k + this.doublePlot, 0)),
							max(getNdataByPeriods(d.dataByDays.yByPeriod, k, k + this.doublePlot, 0))
						];
					}
				});
			}
			//caluclate the lims for the data, each to their own
			else if (this.ylimsOption == 'overall') {
				this.data.forEach((d, i) => {
					if (d.y.getData()?.length > 0 && d.x.getData()?.length > 0) {
						const minmax = [min(d.y?.getData()), max(d.y?.getData())];
						for (let k = 0; k < this.Ndays; k++) {
							ylims_out[i][k] = minmax;
						}
					}
				});
			}
			//else, just use the ylimsIN
			else if (this.ylimsOption == 'manual') {
				this.data.forEach((d, i) => {
					for (let k = 0; k < this.Ndays; k++) {
						ylims_out[i][k] = [Number(this.ylimsIN[0]), this.ylimsIN[1]];
					}
				});
			}
			// console.log('ylims_out: ', ylims_out);
			return ylims_out;
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

			const datum = new ActogramDataclass(this, dataIN);
			this.data.push(datum);
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

		addAnnotation() {
			this.annotations.push(new AnnotationClass(this));
		}

		toJSON() {
			return {
				ylimsOption: this.ylimsOption,
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
			actogram.ylimsOption = json.ylimsOption;
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
	import { flip } from 'svelte/animate';
	import { slide } from 'svelte/transition';
	import { tick } from 'svelte';
	import { appState } from '$lib/core/core.svelte';
	import DateTimeHrs from '$lib/components/inputs/DateTimeHrs.svelte';
	import { DateTime } from 'luxon';

	let { theData, which } = $props();

	let isAltKeyDown = $state(false);
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Alt') {
			isAltKeyDown = true;
		}
	});

	document.addEventListener('keyup', (e) => {
		if (e.key === 'Alt') {
			isAltKeyDown = false;
			tooltip.visible = false;
		}
	});

	function handleHover(e) {
		if (isAltKeyDown && which === 'plot') {
			//tooltip for time and values if control-click
			const mouseX = e.offsetX;
			const mouseY = e.offsetY;

			//make sure the tooltip stays 'in bounds'
			const srcRect = e.srcElement.getBoundingClientRect();
			const xPos = mouseX + 110 > srcRect.width ? mouseX - 120 : mouseX + 10;
			const yPos = mouseY < 20 ? mouseY + 40 : mouseY + 10;

			tooltip = {
				visible: true,
				x: xPos, // Offset to avoid cursor overlap
				y: yPos,
				content: getTimeFromMouse(mouseX, mouseY)
			};
		}
	}

	//take in a mouse position and return the day from the y value
	function getTimeFromMouse(x, y) {
		const allTopPadding =
			theData.plot.lightBands.length > 0
				? theData.plot.paddingIN.top + theData.plot.lightBands.height * 2
				: theData.plot.paddingIN.top;

		const xscale = scaleLinear()
			.domain([0, theData.plot.periodHrs * theData.plot.doublePlot])
			.range([0, theData.plot.plotwidth]);

		const yscale = scaleLinear().domain([0, 100]).range([theData.plot.eachplotheight, 0]);

		return `day
			${Math.floor((y - allTopPadding) / (theData.plot.eachplotheight + theData.plot.spaceBetween))}, hour ${xscale.invert(x - theData.plot.padding.left).toFixed(2)}`;
	}

	function handleClick(e) {
		// add markers if selected
		if (theData.plot.isAddingMarkerTo >= 0) {
			const [clickedDay, clickedHrs] = getClickedTime(e);
			theData.plot.addPhaseMarkerTo(theData.plot.isAddingMarkerTo, clickedDay, clickedHrs);
		}
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

	async function addData() {
		theData.addData({
			x: null,
			y: null
		});

		await tick();

		//Scroll to the bottom of dataSettings
		dataSettingsScrollTo('bottom');
	}

	//Tooltip
	let tooltip = $state({ visible: false, x: 0, y: 0, content: '' });
	function handleTooltip(event) {
		tooltip = event.detail;
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

		<div class="control-component">
			<div class="control-component-title">
				<p>Padding</p>
			</div>

			<div class="control-input-square">
				<div class="control-input">
					<p>Top</p>
					<NumberWithUnits bind:value={theData.paddingIN.top} />
				</div>

				<div class="control-input">
					<p>Bottom</p>
					<NumberWithUnits bind:value={theData.paddingIN.bottom} />
				</div>

				<div class="control-input">
					<p>Left</p>
					<NumberWithUnits bind:value={theData.paddingIN.left} />
				</div>

				<div class="control-input">
					<p>Right</p>
					<NumberWithUnits bind:value={theData.paddingIN.right} />
				</div>
			</div>

			<div class="control-input-vertical">
				<div class="control-input">
					<p>Space Between</p>
					<NumberWithUnits bind:value={theData.spaceBetween} />
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
					<!-- <input type="date" bind:value={theData.startTime} /> -->
					<DateTimeHrs bind:value={theData.startTime} />
				</div>
			</div>

			<div class="control-input-horizontal">
				<div class="control-input">
					<p>Period</p>
					<NumberWithUnits step="0.1" bind:value={theData.periodHrs} />
				</div>

				<div class="control-input">
					<p>Repeat</p>
					<NumberWithUnits bind:value={theData.doublePlot} />
				</div>
			</div>
		</div>

		<div class="div-line"></div>

		<div class="control-component">
			<div class="control-component-title">
				<p>Y-lims</p>
			</div>
			<div class="control-input-vertical">
				<div class="control-input">
					<p>Scale Y-axis:</p>
					<select bind:value={theData.ylimsOption}>
						<option value="overall">Overall</option>
						<option value="byperiod">By Periods</option>
						<option value="manual">Manual</option>
					</select>
				</div>
			</div>
		</div>

		{#if theData.ylimsOption == 'manual'}
			<div class="control-input-horizontal">
				<div class="control-input">
					<p>Min</p>
					<NumberWithUnits
						step="0.1"
						value={theData.ylimsIN[0] == null ? theData.ylims[0] : theData.ylimsIN[0]}
						onInput={(val) => {
							theData.ylimsIN[0] = [parseFloat(val)];
						}}
					/>
				</div>

				<div class="control-input">
					<p>Max</p>
					<NumberWithUnits
						step="0.1"
						value={theData.ylimsIN[1] == null ? theData.ylims[1] : theData.ylimsIN[1]}
						onInput={(val) => {
							theData.ylimsIN[1] = [parseFloat(val)];
						}}
					/>
				</div>
			</div>
		{/if}
	{:else if appState.currentControlTab === 'data'}
		<div class="control-data-add">
			<button class="icon" onclick={async () => await addData()}>
				<Icon name="add" width={16} height={16} />
			</button>
		</div>

		<div class="control-component">
			{#each theData.data as datum, i (datum.x.id + '-' + datum.y.id)}
				<div
					class="dataBlock"
					animate:flip={{ duration: 500 }}
					in:slide={{ duration: 500, axis: 'y' }}
					out:slide={{ duration: 500, axis: 'y' }}
				>
					<div class="control-component-title">
						<div class="control-component-title-colour">
							<ColourPicker bind:value={datum.colour} />
							<p>Data {i}</p>
						</div>
						<div class="control-component-title-icons">
							<button class="icon" onclick={() => theData.removeData(i)}>
								<Icon
									name="minus"
									width={16}
									height={16}
									className="control-component-title-icon"
								/>
							</button>
							<button
								class="icon"
								onclick={(e) => {
									e.stopPropagation();
									datum.draw = !datum.draw;
								}}
							>
								{#if !datum.draw}
									<Icon name="eye-slash" width={16} height={16} />
								{:else}
									<Icon name="eye" width={16} height={16} className="visible" />
								{/if}
							</button>
						</div>
					</div>

					<div class="control-data-container">
						<div class="control-data">
							<div class="control-data-title">
								<p>x:</p>
								<p
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
								<p>y:</p>
								<p
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

						<div class="control-data-title with-icon">
							<div
								style="display: flex; align-items: center; justify-content: flex-start; margin: 0;"
							>
								<button class="icon">
									<Icon
										name="pin"
										width={18}
										height={18}
										className="control-component-title-icon"
									/>
								</button>
								<p>Markers</p>
							</div>

							<div class="control-component-title-icons">
								<button class="icon" onclick={() => datum.addMarker()}>
									<Icon
										name="plus"
										width={16}
										height={16}
										className="control-component-title-icon"
									/>
								</button>
							</div>
						</div>

						{#each datum.phaseMarkers as marker}
							<PhaseMarker {which} {marker} />
						{/each}
					</div>

					<div class="div-line"></div>
				</div>
			{/each}
		</div>

		<div>
			<button class="icon control-block-add" onclick={async () => await addData()}>
				<Icon name="plus" width={16} height={16} className="static-icon" />
			</button>
		</div>
	{:else if appState.currentControlTab === 'annotations'}
		{#each theData.annotations as annotation}
			<Annotation {which} {annotation} />

			<div class="div-line"></div>
		{/each}

		<div>
			<button class="icon control-block-add" onclick={() => theData.addAnnotation()}>
				<Icon name="plus" width={16} height={16} className="static-icon" />
			</button>
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
		onmousemove={(e) => handleHover(e)}
		ontooltip={handleTooltip}
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
			plotPadding={theData.plot.padding}
			axisLeftWidth={theData.plot.axisLeftWidth}
			nticks={theData.plot.plotwidth > 600
				? theData.plot.periodHrs
				: Math.max(2, theData.plot.plotwidth / 150)}
			gridlines={false}
		/>

		{#each theData.plot.data as datum, d}
			<g
				class="actogram"
				transform="translate({theData.plot.padding.left}, {theData.plot.padding.top})"
			>
				{#if datum.draw}
					<!-- Make the histogram for each period using new xStart/xEnd format -->
					{#each makeSeqArray(0, theData.plot.Ndays - 1, 1) as day}
						{@const thisScale = scaleLinear()
							.domain([theData.plot.ylims[d][day][0], theData.plot.ylims[d][day][1]])
							.range([theData.plot.eachplotheight, 0])}

						{@const histBins = getHistogramBinsForPeriods(
							datum.histogramBinsByDays,
							day,
							day + theData.plot.doublePlot,
							theData.plot.periodHrs
						)}

						{#if histBins.xStart.length > 0}
							<Hist
								xStart={histBins.xStart}
								xEnd={histBins.xEnd}
								y={histBins.y}
								xscale={scaleLinear()
									.domain([0, theData.plot.periodHrs * theData.plot.doublePlot])
									.range([0, theData.plot.plotwidth])}
								yscale={thisScale}
								colour={datum.colour}
								yoffset={day * (theData.plot.spaceBetween + theData.plot.eachplotheight) +
									theData.plot.spaceBetween}
							/>
						{/if}
					{/each}
				{/if}
			</g>
			<!-- THE MARKERS -->
			{#each datum.phaseMarkers as marker}
				<PhaseMarker {which} {marker} />
			{/each}
		{/each}
		<!-- THE ANNOTATIONS -->
		{#each theData.plot.annotations as annotation}
			<Annotation {which} {annotation} />
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
		width: 100px;
	}
</style>
