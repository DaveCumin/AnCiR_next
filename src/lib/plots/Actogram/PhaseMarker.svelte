<script module>
	import ColourPicker from '$lib/components/inputs/ColourPicker.svelte';
	import DoubleRange from '$lib/components/inputs/DoubleRange.svelte';
	import {
		linearRegression,
		makeSeqArray,
		removeNullsFromXY
	} from '$lib/components/plotBits/helpers/wrangleData';
	import { scaleLinear } from 'd3-scale';

	function findCentileValue(data, centile) {
		const filteredData = data.filter((value) => !isNaN(value) && value !== 0);
		// Sort the filtered data in ascending order
		const sortedData = filteredData.slice().sort((a, b) => a - b);
		// Calculate the index for the percentile
		const indexPercentile = Math.ceil((centile / 100) * sortedData.length) - 1;
		// Retrieve the value at the calculated index
		const percentileValue = sortedData[indexPercentile];

		return percentileValue;
	}

	//Find the start index of the test data that best matches the template
	function findBestMatchIndex(test, template) {
		let bestMatchIndex = -1;
		let bestCorrelation = -Infinity;
		//cycle over the test data
		for (let i = 0; i <= test.length - template.length; i++) {
			let correlation = 0;

			// Calculate the cross-correlation at the current index
			for (let j = 0; j < template.length; j++) {
				correlation += test[i + j] * template[j];
			}

			// Update best match if the correlation is higher
			if (correlation > bestCorrelation) {
				bestCorrelation = correlation;
				bestMatchIndex = i;
			}
		}

		return bestMatchIndex;
	}

	let _phaseMarkerCounter = 0;

	export class PhaseMarkerClass {
		parentData = $state();
		id;
		type = $state(); //{onset, offset, manual}
		centileThreshold = $state();
		templateHrsBefore = $state();
		templateHrsAfter = $state();
		colour = $state();
		showLine = $state();
		showMarkers = $state();
		lineWidth = $state(3);
		markerSize = $state(5);
		periodRangeMin = $state(0);
		periodRangeMax = $state(0);
		manualMarkers = $state([]);

		//Add a manual marker - the raw time clicked on
		addTime(clickedDay, clickedHrs) {
			// Calculate absolute time using the current periodHrs
			const periodHrs = this.parentData.parentPlot.periodHrs;
			const absoluteTime = clickedDay * periodHrs + clickedHrs;
			this.manualMarkers = [...this.manualMarkers, absoluteTime];
		}

		//Calculate the markers for the actogram
		markers = $derived.by(() => {
			const periodHrs = this.parentData.parentPlot.periodHrs;
			if (this.type === 'manual') {
				// Group manual markers by day based on current periodHrs
				const markersByDay = {};
				for (const absoluteTime of this.manualMarkers) {
					const day = Math.floor(absoluteTime / periodHrs);
					const hour = absoluteTime % periodHrs;
					if (!markersByDay[day]) markersByDay[day] = [];
					markersByDay[day] = hour;
				}
				// Convert to array of arrays, filling gaps with empty arrays
				const maxDay = Math.max(-1, ...Object.keys(markersByDay).map(Number));
				return Array.from({ length: maxDay + 1 }, (_, i) => markersByDay[i] || NaN);
			}

			//-------------------------------
			//Generate the template
			//-------------------------------
			//Calculate the number of before and after bins that are needed
			const N = Math.round(this.templateHrsBefore / this.parentData.binSize);
			const M = Math.round(this.templateHrsAfter / this.parentData.binSize);

			//Fill the N and M with 1s and -1s (if onset; or -1s and 1s if offset)
			const template = [];
			for (let i = 0; i < N; i++) {
				template.push(this.type === 'onset' ? -1 : 1);
			}
			for (let i = 0; i < M; i++) {
				template.push(this.type === 'onset' ? 1 : -1);
			}

			//-------------------------------
			// For each double period, find the threshold and match the template (do this for all periods, rather than only selected to reduce computation if changes made to periodRange: only display)
			//-------------------------------
			let bestMatchx = [];

			for (let i = 0; i < Object.keys(this.parentData.dataByDays.xByPeriod).length - 1; i++) {
				let periodsData = [
					...this.parentData.dataByDays.yByPeriod[i],
					...this.parentData.dataByDays.yByPeriod[i + 1]
				]; // get the y data for the day
				//get the threshold value
				const centileValue = findCentileValue(periodsData, this.centileThreshold);

				//convert to 1,-1
				const aboveBelow = periodsData.map((value) =>
					value <= centileValue || isNaN(value) ? -1 : 1
				);

				//pad the data for the template
				periodsData = Array.from({ length: N }, () => (this.type === 'onset' ? -1 : 1))
					.concat(periodsData)
					.concat(Array.from({ length: M }, () => (this.type === 'onset' ? 1 : -1)));

				//find the best match to the template and centre the template on the match
				let bestMatchIndex = findBestMatchIndex(aboveBelow, template) + Math.round((N + M) / 2);
				//find the x-value in the period that corresponds to that index
				let xData = [
					...this.parentData.dataByDays.xByPeriod[i],
					...this.parentData.dataByDays.xByPeriod[i + 1]
				];
				bestMatchx.push(xData[bestMatchIndex] - i * this.parentData.parentPlot.periodHrs);
			}
			//--------------
			//Do the last day on its own
			let i = Object.keys(this.parentData.dataByDays.xByPeriod).length - 1;
			let periodsData = this.parentData.dataByDays.yByPeriod[i];
			// get the y data for the day
			//get the threshold value
			const centileValue = findCentileValue(periodsData, this.centileThreshold);
			//convert to 1,-1
			const aboveBelow = periodsData.map((value) =>
				value <= centileValue || isNaN(value) ? -1 : 1
			);
			//pad the data for the template
			periodsData = Array.from({ length: N }, () => (this.type === 'onset' ? -1 : 1))
				.concat(periodsData)
				.concat(Array.from({ length: M }, () => (this.type === 'onset' ? 1 : -1)));

			//find the best match to the template and centre the template on the match
			let bestMatchIndex = findBestMatchIndex(aboveBelow, template) + Math.round((N + M) / 2);
			//find the x-value in the period that corresponds to that index
			let xData = this.parentData.dataByDays.xByPeriod[i];

			bestMatchx.push(xData[bestMatchIndex] - i * this.parentData.parentPlot.periodHrs);
			//--------------
			//Update periodRangeMax if it's more than the number of periods
			this.periodRangeMax = Math.min(
				this.periodRangeMax,
				Object.keys(this.parentData.dataByDays.xByPeriod).length
			);

			//Return the markers
			return bestMatchx;
		});

		markerPoints = $derived.by(() => {
			let out = '';
			const xscale = scaleLinear()
				.domain([0, this.parentData.parentPlot.periodHrs * this.parentData.parentPlot.doublePlot])
				.range([0, this.parentData.parentPlot.plotwidth]);
			const radius = this.markerSize;
			for (let m = this.periodRangeMin - 1; m <= this.periodRangeMax - 1; m++) {
				if (!this.markers[m]) continue;
				out += `M${xscale(this.markers[m]) + this.parentData.parentPlot.padding.left} ${
					this.parentData.parentPlot.padding.top +
					this.parentData.parentPlot.eachplotheight -
					radius / 2 +
					m * this.parentData.parentPlot.spaceBetween +
					m * this.parentData.parentPlot.eachplotheight
				} m-${radius} 0 a${radius} ${radius} 0 1 0 ${2 * radius} 0 a${radius} ${radius} 0 1 0 -${2 * radius} 0 `;
			}

			return out;
		});

		linearRegression = $derived.by(() => {
			//get the markers of interest
			let xs = makeSeqArray(this.periodRangeMin, this.periodRangeMax, 1);
			let ys = this.markers.slice(this.periodRangeMin - 1, this.periodRangeMax);
			for (let i = 0; i < ys.length; i++) {
				ys[i] = ys[i] + xs[i] * this.parentData.parentPlot.periodHrs;
			}
			//remove any NaNs
			[xs, ys] = removeNullsFromXY(xs, ys);
			//return an NaN if there are no values
			if (xs.length == 0) return NaN;
			return linearRegression(xs, ys);
		});

		constructor(parent, dataIN) {
			this.parentData = parent;

			this.id = _phaseMarkerCounter;
			_phaseMarkerCounter++;
			if (dataIN) {
				this.type = dataIN.type || 'onset';
				this.centileThreshold = dataIN.centileThreshold || 50;
				this.templateHrsBefore = dataIN.templateHrsBefore || 3;
				this.templateHrsAfter = dataIN.templateHrsAfter || 3;
				this.colour = dataIN.colour || 'black';
				this.showLine = dataIN.showLine || true;
				this.showMarkers = dataIN.showMarkers || true;
				this.periodRangeMin = dataIN.periodRangeMin || 1;
				this.periodRangeMax =
					dataIN.periodRangeMax || Object.keys(parent.dataByDays.xByPeriod).length;
				this.manualMarkers = dataIN.manualMarkers || [];
			}
		}

		toJSON() {
			return {
				type: this.type,
				centileThreshold: this.centileThreshold,
				templateHrsBefore: this.templateHrsBefore,
				templateHrsAfter: this.templateHrsAfter,
				colour: this.colour,
				showLine: this.showLine,
				showMarkers: this.showMarkers,
				lineWidth: this.lineWidth,
				markerSize: this.markerSize,
				periodRangeMin: this.periodRangeMin,
				periodRangeMax: this.periodRangeMax,
				manualMarkers: this.manualMarkers
			};
		}

		static fromJSON(json, parent) {
			return new PhaseMarkerClass(parent, {
				type: json.type,
				centileThreshold: json.centileThreshold,
				templateHrsBefore: json.templateHrsBefore,
				templateHrsAfter: json.templateHrsAfter,
				colour: json.colour,
				showLine: json.showLine,
				showMarkers: json.showMarkers,
				lineWidth: json.lineWidth,
				markerSize: json.markerSize,
				periodRangeMin: json.periodRangeMin,
				periodRangeMax: json.periodRangeMax,
				manualMarkers: json.manualMarkers
			});
		}
	}
</script>

<script>
	let { marker, which } = $props();
	const xscale = $derived(
		scaleLinear()
			.domain([0, marker.parentData.parentPlot.periodHrs * marker.parentData.parentPlot.doublePlot])
			.range([0, marker.parentData.parentPlot.plotwidth])
	);
</script>

{#snippet controls(marker)}
	Type:<select bind:value={marker.type}>
		<option value="onset">onset</option>
		<option value="offset">offset</option>
		<option value="manual">manual</option>
	</select>

	<p>
		Marker size: <input type="number" min="1" max="100" step="0.2" bind:value={marker.markerSize} />
	</p>
	{#if marker.linearRegression?.slope}
		<p>
			Line width: <input type="number" min="1" max="100" step="0.2" bind:value={marker.lineWidth} />
		</p>
	{/if}
	{#if marker.type === 'manual'}
		<button onclick={() => (marker.parentData.parentPlot.isAddingMarkerTo = marker.id)}
			>Add Marker</button
		>
	{:else}
		<div>
			N: <input type="number" min="0" max="100" bind:value={marker.templateHrsBefore} />
			M: <input type="number" min="0" max="100" bind:value={marker.templateHrsAfter} />
			%: <input type="number" min="0" max="100" bind:value={marker.centileThreshold} />
		</div>
	{/if}
	periods: <DoubleRange
		min="1"
		max={Object.keys(marker.parentData.dataByDays.xByPeriod).length}
		bind:minVal={marker.periodRangeMin}
		bind:maxVal={marker.periodRangeMax}
	/>
	<ColourPicker bind:value={marker.colour} />

	{#if marker.linearRegression?.slope}
		<p>Est τ: {marker.linearRegression.slope.toFixed(2)} hrs</p>
		<p>
			R-squared: {marker.linearRegression.rSquared.toFixed(3)}, Error: {marker.linearRegression.rmse.toFixed(
				3
			)}
		</p>
		Show Line:<input type="checkbox" bind:checked={marker.showLine} />
	{/if}
{/snippet}

{#snippet plot(marker)}
	{#if marker.showLine && marker.linearRegression?.slope}
		<line
			x1={xscale(marker.linearRegression.intercept) + marker.parentData.parentPlot.padding.left}
			y1={marker.parentData.parentPlot.padding.top}
			x2={xscale(
				marker.linearRegression.intercept +
					marker.parentData.parentPlot.Ndays *
						(marker.linearRegression.slope - marker.parentData.parentPlot.periodHrs)
			) + marker.parentData.parentPlot.padding.left}
			y2={(marker.parentData.parentPlot.Ndays - 1) *
				(marker.parentData.parentPlot.eachplotheight + marker.parentData.parentPlot.spaceBetween) +
				marker.parentData.parentPlot.eachplotheight +
				marker.parentData.parentPlot.padding.top}
			stroke={marker.colour}
			stroke-width={marker.lineWidth}
		/>
	{/if}
	<path d={marker.markerPoints} fill={marker.colour} stroke="none" />
{/snippet}

{#if which === 'plot'}
	{@render plot(marker)}
{:else if which === 'controls'}
	{@render controls(marker)}
{/if}
