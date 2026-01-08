<script module>
	// @ts-nocheck

	import Column from '$lib/core/Column.svelte';
	import Hist, { createHistogramBins } from '$lib/components/plotbits/Hist.svelte';
	import Axis from '$lib/components/plotbits/Axis.svelte';

	import { Column as ColumnClass } from '$lib/core/Column.svelte';
	import { ColumnReference } from '$lib/core/ColumnReference.svelte';
	import ColourPicker, { getPaletteColor } from '$lib/components/inputs/ColourPicker.svelte';
	import PhaseMarker, { PhaseMarkerClass } from './PhaseMarker.svelte';
	import LightBand, { LightBandClass } from './LightBand.svelte';
	import Annotation, { AnnotationClass } from './Annotation.svelte';

	import { scaleLinear } from 'd3-scale';
	import { makeSeqArray, max, min } from '$lib/components/plotbits/helpers/wrangleData';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import { dataSettingsScrollTo } from '$lib/components/views/ControlDisplay.svelte';
	import { formatTimeFromUNIX } from '$lib/utils/time/TimeUtils.js';

	import Icon from '$lib/icons/Icon.svelte';

	export const Actogram_defaultDataInputs = ['time', 'values'];
	export const Actogram_controlHeaders = ['Properties', 'Data', 'Annotations'];

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
					return (this.parentPlot?.startTime - Number(this.x?.getData()[0])) / 3600000;
				} else {
					return -Number(this.x?.getData()[0]);
				}
			} else {
				return 0;
			}
		});

		// Keep dataByDays for compatibility (used by phase markers and y-limits)
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

		// New: Calculate bins with their actual boundaries
		allBins = $derived.by(() => {
			const tempx = this.x.hoursSinceStart ?? [];
			const tempy = this.y.getData() ?? [];
			const bins = [];
			const offset = this.offset ?? 0;

			for (let i = 0; i < tempx.length; i++) {
				if (isNaN(tempx[i]) || isNaN(tempy[i]) || tempy[i] == null || tempx[i] == null) {
					continue;
				}

				// Calculate bin boundaries
				let binStart, binEnd;

				if (this.x.type === 'bin' && this.x.binWidth) {
					binStart = tempx[i] - this.x.binWidth / 2;
					binEnd = tempx[i] + this.x.binWidth / 2;
				} else {
					binStart = tempx[i] - this.binSize / 2;
					binEnd = tempx[i] + this.binSize / 2;
				}

				bins.push({
					start: binStart - offset,
					end: binEnd - offset,
					y: tempy[i]
				});
			}

			return bins;
		});

		// New: Split bins by period, creating segments where bins cross period boundaries
		binsByPeriod = $derived.by(() => {
			const period = this.parentPlot?.periodHrs ?? 24;
			const periodBins = {};

			for (const bin of this.allBins) {
				const startPeriod = Math.floor(bin.start / period);
				const endPeriod = Math.floor(bin.end / period);

				// Skip bins that end before period 0
				if (endPeriod < 0) continue;

				if (startPeriod === endPeriod && startPeriod >= 0) {
					// Bin is entirely within one period
					periodBins[startPeriod] ||= [];
					periodBins[startPeriod].push({
						xStart: bin.start,
						xEnd: bin.end,
						y: bin.y
					});
				} else {
					// Bin spans multiple periods - create a segment for each
					for (let p = Math.max(0, startPeriod); p <= endPeriod; p++) {
						const periodStart = p * period;
						const periodEnd = (p + 1) * period;

						// Calculate segment boundaries (clipped to period)
						const segmentStart = Math.max(bin.start, periodStart);
						const segmentEnd = Math.min(bin.end, periodEnd);

						if (segmentEnd > segmentStart) {
							periodBins[p] ||= [];
							periodBins[p].push({
								xStart: segmentStart,
								xEnd: segmentEnd,
								y: bin.y // Full y value, not proportional
							});
						}
					}
				}
			}

			return periodBins;
		});

		phaseMarkers = $state([]);

		constructor(parent, dataIN) {
			this.parentPlot = parent;
			const isLoadingFromJSON = dataIN?._loadingFromJSON;

			if (dataIN && dataIN.x) {
				this.x = ColumnReference.createOrLoad(dataIN.x, isLoadingFromJSON);
			} else {
				if (parent.data.length > 0) {
					const prevColumn = parent.data[parent.data.length - 1].x.column;
					const sourceRefId = prevColumn?.refId ?? prevColumn?.id ?? -1;
					this.x = ColumnReference.createPlotColumn(sourceRefId);
				} else {
					this.x = new ColumnReference(-1);
				}
			}
			if (dataIN && dataIN.y) {
				this.y = ColumnReference.createOrLoad(dataIN.y, isLoadingFromJSON);
			} else {
				this.y = new ColumnReference(-1);
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
				x: this.x.toJSON(),
				y: this.y.toJSON(),
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
				colour: json.colour,
				_loadingFromJSON: true
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
	function getBinsForPeriods(binsByPeriod, from, to, periodHrs) {
		const allXStart = [];
		const allXEnd = [];
		const allY = [];

		for (let p = from; p < to; p++) {
			if (binsByPeriod[p]) {
				const offset = from * periodHrs;

				for (const bin of binsByPeriod[p]) {
					// Adjust x positions relative to the display offset
					allXStart.push(bin.xStart - offset);
					allXEnd.push(bin.xEnd - offset);
					allY.push(bin.y);
				}
			}
		}

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

		const unixTime =
			theData.plot.startTime +
			3600000 *
				24 *
				Math.floor(
					(y - allTopPadding) / (theData.plot.eachplotheight + theData.plot.spaceBetween)
				) +
			3600000 * xscale.invert(x - theData.plot.padding.left);

		return `${formatTimeFromUNIX(unixTime)}`;
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
							<div class="control-input">
								<p>x</p>
							</div>

							<Column col={datum.x} canChange={true} />
						</div>

						<div class="control-data">
							<div class="control-input">
								<p>y</p>
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

		<!-- <div>
			<button class="icon control-block-add" onclick={async () => await addData()}>
				<Icon name="plus" width={16} height={16} className="static-icon" />
			</button>
		</div> -->
	{:else if appState.currentControlTab === 'annotations'}
		{#each theData.annotations as annotation (annotation.id)}
			<div
				class="annotation-container"
				animate:flip={{ duration: 500 }}
				in:slide={{ duration: 500, axis: 'y' }}
				out:slide={{ duration: 500, axis: 'y' }}
			>
				<Annotation {which} {annotation} />
				<div class="div-line"></div>
			</div>
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

						{@const bins = getBinsForPeriods(
							datum.binsByPeriod,
							day,
							day + theData.plot.doublePlot,
							theData.plot.periodHrs
						)}

						{#if bins.xStart.length > 0}
							<Hist
								xStart={bins.xStart}
								xEnd={bins.xEnd}
								y={bins.y}
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
		width: 100px;
	}
</style>
