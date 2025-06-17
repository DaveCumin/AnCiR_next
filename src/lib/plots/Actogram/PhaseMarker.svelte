<script module>
	import ColourPicker from '$lib/components/ColourPicker.svelte';
	import DoubleRange from '$lib/components/inputs/DoubleRange.svelte';
	import {
		linearRegression,
		makeSeqArray,
		removeNullsFromXY
	} from '$lib/components/plotbits/helpers/wrangleData';
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
		parent = $state();
		id;
		type = $state(); //{onset, offset, manual}
		centileThreshold = $state();
		templateHrsBefore = $state();
		templateHrsAfter = $state();
		colour = $state();
		showLine = $state();
		showMarkers = $state();
		periodRangeMin = $state(0);
		periodRangeMax = $state(0);
		manualMarkers = $state([]);

		//Add a manual marker
		addTime(clickedDay, clickedHrs) {
			this.manualMarkers[clickedDay] = clickedHrs;
		}

		//Calculate the markers for the actogram
		markers = $derived.by(() => {
			if (this.type == 'manual') {
				return this.manualMarkers;
			}
			//-------------------------------
			//Generate the template
			//-------------------------------
			//Calculate the number of before and after bins that are needed
			const N = Math.round(this.templateHrsBefore / this.parent.binSize);
			const M = Math.round(this.templateHrsAfter / this.parent.binSize);

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

			for (let i = 0; i < Object.keys(this.parent.dataByDays.xByPeriod).length - 1; i++) {
				let periodsData = [
					...this.parent.dataByDays.yByPeriod[i],
					...this.parent.dataByDays.yByPeriod[i + 1]
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
					...this.parent.dataByDays.xByPeriod[i],
					...this.parent.dataByDays.xByPeriod[i + 1]
				];
				bestMatchx.push(xData[bestMatchIndex] - i * this.parent.parent.periodHrs);
			}
			//--------------
			//Do the last day on its own
			let i = Object.keys(this.parent.dataByDays.xByPeriod).length - 1;
			let periodsData = this.parent.dataByDays.yByPeriod[i];
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
			let xData = this.parent.dataByDays.xByPeriod[i];

			bestMatchx.push(xData[bestMatchIndex] - i * this.parent.parent.periodHrs);
			//--------------
			//Update periodRangeMax if it's more than the number of periods
			this.periodRangeMax = Math.min(
				this.periodRangeMax,
				Object.keys(this.parent.dataByDays.xByPeriod).length
			);

			//Return the markers
			return bestMatchx;
		});

		markerPoints = $derived.by(() => {
			let out = '';
			const xscale = scaleLinear()
				.domain([0, this.parent.parent.periodHrs * this.parent.parent.doublePlot])
				.range([0, this.parent.parent.plotwidth]);
			const radius = Math.max(4, this.parent.parent.eachplotheight / 10);
			for (let m = this.periodRangeMin - 1; m <= this.periodRangeMax - 1; m++) {
				if (!this.markers[m]) continue;
				out += `M${xscale(this.markers[m]) + this.parent.parent.padding.left} ${
					this.parent.parent.padding.top +
					this.parent.parent.eachplotheight -
					radius / 2 +
					m * this.parent.parent.spaceBetween +
					m * this.parent.parent.eachplotheight
				} m-${radius} 0 a${radius} ${radius} 0 1 0 ${2 * radius} 0 a${radius} ${radius} 0 1 0 -${2 * radius} 0 `;
			}

			return out;
		});

		linearRegression = $derived.by(() => {
			//get the markers of interest
			let xs = makeSeqArray(this.periodRangeMin - 1, this.periodRangeMax - 1, 1);
			let ys = this.markers.slice(this.periodRangeMin - 1, this.periodRangeMax);
			console.log('before: ', xs, ys);
			for (let i = 0; i < ys.length; i++) {
				ys[i] = ys[i] + xs[i] * this.parent.parent.periodHrs;
			}
			//remove any NaNs
			[xs, ys] = removeNullsFromXY(xs, ys);
			console.log(xs, ys);
			//return an NaN if there are no values
			if (xs.length == 0) return NaN;
			return linearRegression(xs, ys);
		});

		constructor(parent, dataIN) {
			this.parent = parent;

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
				periodRangeMin: json.periodRangeMin,
				periodRangeMax: json.periodRangeMax,
				manualMarkers: json.manualMarkers
			});
		}
	}
</script>

<script>
	let { marker, which } = $props();
	const xscale = scaleLinear()
		.domain([0, marker.parent.parent.periodHrs * marker.parent.parent.doublePlot])
		.range([0, marker.parent.parent.plotwidth]);
</script>

{#snippet controls(marker)}
	<p>{marker.id}</p>
	Type:<input type="text" bind:value={marker.type} />
	{#if marker.type === 'manual'}
		<button onclick={() => (marker.parent.parent.isAddingMarkerTo = marker.id)}>Add Marker</button>
	{/if}
	N: <input type="number" min="0" max="100" bind:value={marker.templateHrsBefore} />
	M: <input type="number" min="0" max="100" bind:value={marker.templateHrsAfter} />
	%: <input type="number" min="0" max="100" bind:value={marker.centileThreshold} />
	periods: <DoubleRange
		min="1"
		max={Object.keys(marker.parent.dataByDays.xByPeriod).length}
		bind:minVal={marker.periodRangeMin}
		bind:maxVal={marker.periodRangeMax}
	/>
	<ColourPicker bind:value={marker.colour} />
	<p>{marker.markers}</p>
	{#if marker.linearRegression?.slope}
		<p>linearRegression: {JSON.stringify(marker.linearRegression)}</p>
		Show Line:<input type="checkbox" bind:checked={marker.showLine} />
	{/if}
	<p>
		{marker.parent.parent.Ndays *
			(marker.parent.parent.eachplotheight + marker.parent.parent.spaceBetween) +
			marker.parent.parent.eachplotheight +
			marker.parent.parent.padding.top}
	</p>
{/snippet}

{#snippet plot(marker)}
	<path d={marker.markerPoints} fill={marker.colour} stroke="none" />
	{#if marker.showLine && marker.linearRegression}
		<line
			x1={xscale(marker.linearRegression.intercept) + marker.parent.parent.padding.left}
			y1={marker.parent.parent.padding.top}
			x2={xscale(
				marker.linearRegression.intercept +
					marker.parent.parent.Ndays *
						(marker.linearRegression.slope - marker.parent.parent.periodHrs)
			) + marker.parent.parent.padding.left}
			y2={(marker.parent.parent.Ndays - 1) *
				(marker.parent.parent.eachplotheight + marker.parent.parent.spaceBetween) +
				marker.parent.parent.eachplotheight +
				marker.parent.parent.padding.top}
			stroke={marker.colour}
		/>
	{/if}
{/snippet}

{#if which === 'plot'}
	{@render plot(marker)}
{:else if which === 'controls'}
	{@render controls(marker)}
{/if}
