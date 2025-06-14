<script module>
	import DoubleRange from '$lib/components/inputs/DoubleRange.svelte';
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

	export class PhaseMarkerClass {
		parent = $state();
		type = $state(); //{onset, offset, manual}
		centileThreshold = $state();
		templateHrsBefore = $state();
		templateHrsAfter = $state();
		MADThreshold = $state();
		colour = $state();
		showLine = $state();
		showMarkers = $state();
		periodRangeMin = $state();
		periodRangeMax = $state();
		manualMarkers = $state([]);

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
			for (let i = 0; i < Object.keys(this.parent.dataByDays.xByPeriod).length; i++) {
				let periodsData = this.parent.dataByDays.yByPeriod[i]; // get the y data for the day
				//get the threshold value
				const centileValue = findCentileValue(periodsData, this.centileThreshold);
				//convert to 1,-1
				const aboveBelow = periodsData.map((value) =>
					value <= centileValue || isNaN(value) ? -1 : 1
				);
				//pad the data for the template
				periodsData = Array.from({ length: N }, () => (this.type === 'onset' ? 1 : -1))
					.concat(periodsData)
					.concat(Array.from({ length: M }, () => (this.type === 'onset' ? -1 : 1)));

				//find the best match to the template and centre the template on the match
				let bestMatchIndex = findBestMatchIndex(aboveBelow, template) + Math.round((N + M) / 2);
				//find the x-value in the period that corresponds to that index
				bestMatchx.push(
					this.parent.dataByDays.xByPeriod[i][bestMatchIndex] - i * this.parent.parent.period
				);
			}

			let markers = bestMatchx;
			return markers;
		});

		markerPoints = $derived.by(() => {
			let out = '';
			const xscale = scaleLinear()
				.domain([0, this.parent.parent.period * this.parent.parent.doublePlot])
				.range([0, this.parent.parent.plotwidth]);
			const radius = Math.max(4, this.parent.parent.eachplotheight / 10);
			for (let m = this.periodRangeMin - 1; m <= this.periodRangeMax - 1; m++) {
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

		constructor(parent, dataIN) {
			this.parent = parent;
			if (dataIN) {
				this.type = dataIN.type || 'onset';
				this.centileThreshold = dataIN.centileThreshold || 50;
				this.templateHrsBefore = dataIN.templateHrsBefore || 3;
				this.templateHrsAfter = dataIN.templateHrsAfter || 3;
				this.MADThreshold = dataIN.MADThreshold || 2;
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
				MADThreshold: this.MADThreshold,
				colour: this.colour,
				showLine: this.showLine,
				showMarkers: this.showMarkers,
				periodRange: this.periodRange
			};
		}

		static fromJSON(json, parent) {
			return new PhaseMarkerClass(parent, {
				type: json.type,
				centileThreshold: json.centileThreshold,
				templateHrsBefore: json.templateHrsBefore,
				templateHrsAfter: json.templateHrsAfter,
				MADThreshold: json.MADThreshold,
				colour: json.colour,
				showLine: json.showLine,
				showMarkers: json.showMarkers,
				periodRange: json.periodRange
			});
		}
	}
</script>

<script>
	let { marker, which } = $props();
</script>

{#snippet controls(marker)}
	Type: <input type="text" bind:value={marker.type} />
	N: <input type="number" min="0" max="100" bind:value={marker.templateHrsBefore} />
	M: <input type="number" min="0" max="100" bind:value={marker.templateHrsAfter} />
	%: <input type="number" min="0" max="100" bind:value={marker.centileThreshold} />
	periods: <DoubleRange
		min="1"
		max={Object.keys(marker.parent.dataByDays.xByPeriod).length}
		bind:minVal={marker.periodRangeMin}
		bind:maxVal={marker.periodRangeMax}
	/>
	<p>{marker.markers}</p>
{/snippet}

{#snippet plot(marker)}
	<path d={marker.markerPoints} fill={'lime'} stroke="none" />
{/snippet}

{#if which === 'plot'}
	{@render plot(marker)}
{:else if which === 'controls'}
	{@render controls(marker)}
{/if}
