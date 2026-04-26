<script module>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import ColourPicker from '$lib/components/inputs/ColourPicker.svelte';
	import Editable from '$lib/components/inputs/Editable.svelte';
	import {
		linearRegression,
		removeNullsFromXY
	} from '$lib/components/plotbits/helpers/wrangleData';
	import { scaleLinear } from 'd3-scale';
	import { runPeriodogramCalculation } from '$lib/utils/periodogram.js';

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
		name = $state('');
		type = $state(); //{onset, offset, manual}
		centileThreshold = $state();
		templateHrsBefore = $state();
		templateHrsAfter = $state();
		colour = $state();
		showLine = $state();
		showMarkers = $state();
		lineWidth = $state(3);
		markerSize = $state(5);
		// Optional clip range for the regression line (1-indexed day numbers
		// matching the period checkbox list). null = unbounded on that side.
		lineMinDay = $state(null);
		lineMaxDay = $state(null);
		selectedPeriods = $state([]);
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

				return Array.from({ length: maxDay + 1 }, (_, i) => markersByDay[i] ?? NaN);
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
			// For each period, find the threshold and match the template
			// Only calculate for periods that have data
			//-------------------------------
			const xByPeriod = this.parentData.dataByDays.xByPeriod;
			const yByPeriod = this.parentData.dataByDays.yByPeriod;
			const periodKeys = Object.keys(xByPeriod).map(Number);
			if (periodKeys.length === 0) return [];
			const maxPeriod = Math.max(...periodKeys);

			let bestMatchx = [];

			for (let i = 0; i <= maxPeriod; i++) {
				// Skip periods without data
				if (!yByPeriod[i] || yByPeriod[i].length === 0) {
					bestMatchx.push(NaN);
					continue;
				}

				let periodsData, xData;
				// Use double-period matching if next period has data
				if (yByPeriod[i + 1] && yByPeriod[i + 1].length > 0) {
					periodsData = [...yByPeriod[i], ...yByPeriod[i + 1]];
					xData = [...xByPeriod[i], ...xByPeriod[i + 1]];
				} else {
					periodsData = [...yByPeriod[i]];
					xData = [...xByPeriod[i]];
				}

				const centileValue = findCentileValue(periodsData, this.centileThreshold);
				const aboveBelow = periodsData.map((value) =>
					value <= centileValue || isNaN(value) ? -1 : 1
				);

				let bestMatchIndex = findBestMatchIndex(aboveBelow, template) + Math.round((N + M) / 2);

				if (bestMatchIndex >= 0 && bestMatchIndex < xData.length) {
					let rawHour = xData[bestMatchIndex] - i * periodHrs;
					rawHour = ((rawHour % periodHrs) + periodHrs) % periodHrs;

					bestMatchx.push(rawHour);
				} else {
					bestMatchx.push(NaN);
				}
			}

			//Return the markers
			return bestMatchx;
		});

		markerPoints = $derived.by(() => {
			let out = '';
			const xscale = scaleLinear()
				.domain([0, this.parentData.parentPlot.periodHrs * this.parentData.parentPlot.doublePlot])
				.range([0, this.parentData.parentPlot.plotwidth]);
			const radius = this.markerSize;
			for (let m = 0; m < this.markers.length; m++) {
				if (!(this.selectedPeriods[m] ?? true)) continue;
				if (isNaN(this.markers[m]) || this.markers[m] == null) continue;
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
			//get the selected markers
			let xs = [];
			let ys = [];
			for (let i = 0; i < this.markers.length; i++) {
				if (this.selectedPeriods[i] ?? true) {
					xs.push(i + 1);
					ys.push(this.markers[i] + (i + 1) * this.parentData.parentPlot.periodHrs);
				}
			}
			//remove any NaNs
			[xs, ys] = removeNullsFromXY(xs, ys);
			//return an NaN if there are no values
			if (xs.length == 0) return NaN;
			return linearRegression(xs, ys);
		});

		// Predicted phase (marker time within periodHrs) at the line's start
		// day. Uses the regression line directly so it matches the drawn line.
		// Reports a 1-indexed reference day so the user can see where the
		// phase is anchored.
		estimatedPhase = $derived.by(() => {
			const reg = this.linearRegression;
			if (!reg || typeof reg !== 'object' || !reg.slope) return null;
			const periodHrs = this.parentData.parentPlot.periodHrs;
			const Ndays = this.parentData.parentPlot.Ndays;
			const lo = Math.max(1, this.lineMinDay ?? 1);
			const refDay = Math.min(lo, Math.max(1, Ndays));
			const yPred = reg.slope * refDay + reg.intercept;
			const markerHourPred = yPred - refDay * periodHrs;
			const wrapped = ((markerHourPred % periodHrs) + periodHrs) % periodHrs;
			return { phase: wrapped, refDay };
		});

		// Check harmonics of the estimated tau against the periodogram
		harmonicCheck = $derived.by(() => {
			if (!this.linearRegression?.slope) return null;
			const tau = this.linearRegression.slope;
			const xData = this.parentData.x?.hoursSinceStart;
			const yData = this.parentData.y?.getData();
			if (!xData?.length || !yData?.length) return null;

			const binSize = this.parentData.binSize || 0.25;
			const dataSpan = xData[xData.length - 1] - xData[0];

			// Candidate periods: tau, tau/2, 2*tau
			const candidates = [
				{ label: 'τ', period: tau },
				{ label: 'τ/2', period: tau / 2 },
				{ label: '2τ', period: tau * 2 }
			].filter((c) => c.period > binSize * 2 && c.period < dataSpan / 2);

			if (candidates.length === 0) return null;

			// Run a single narrow periodogram covering all candidate windows
			const margin = 0; // ±x hours around each candidate
			const step = 0.001;
			const results = candidates.map((c) => {
				const pMin = c.period - margin;
				const pMax = c.period + margin;
				const result = runPeriodogramCalculation({
					xData,
					yData,
					binSize,
					method: 'Lomb-Scargle',
					chiSquaredAlpha: 0.05,
					periodMin: pMin,
					periodMax: pMax,
					periodSteps: step
				});
				if (!result.y.length) return { ...c, peakPeriod: c.period, power: 0 };
				const peakIdx = result.y.indexOf(Math.max(...result.y));
				return {
					...c,
					peakPeriod: result.x[peakIdx],
					power: result.y[peakIdx]
				};
			});

			// Find strongest
			const strongest = results.reduce((a, b) => (b.power > a.power ? b : a));
			return { candidates: results, strongest };
		});

		//Edit a marker value. If onset/offset, convert to manual first.
		editMarker(periodIndex, newHourValue) {
			const periodHrs = this.parentData.parentPlot.periodHrs;
			if (this.type !== 'manual') {
				// Convert all current computed markers to manual markers
				const newManualMarkers = [];
				for (let i = 0; i < this.markers.length; i++) {
					if (!isNaN(this.markers[i]) && this.markers[i] != null) {
						const hour = i === periodIndex ? newHourValue : this.markers[i];
						// Wrap to [0, periodHrs) to ensure correct period assignment
						const wrappedHour = ((hour % periodHrs) + periodHrs) % periodHrs;
						newManualMarkers.push(i * periodHrs + wrappedHour);
					}
				}
				this.manualMarkers = newManualMarkers;
				this.type = 'manual';
			} else {
				// Already manual - update the specific marker
				const absoluteTime = periodIndex * periodHrs + newHourValue;
				this.manualMarkers = [
					...this.manualMarkers.filter((t) => Math.floor(t / periodHrs) !== periodIndex),
					absoluteTime
				];
			}
		}

		constructor(parent, dataIN) {
			this.parentData = parent;

			this.id = _phaseMarkerCounter;
			_phaseMarkerCounter++;
			if (dataIN) {
				this.name = dataIN.name || 'marker_' + this.id;
				this.type = dataIN.type || 'onset';
				this.centileThreshold = dataIN.centileThreshold || 50;
				this.templateHrsBefore = dataIN.templateHrsBefore || 3;
				this.templateHrsAfter = dataIN.templateHrsAfter || 3;
				this.colour = dataIN.colour || 'black';
				this.showLine = dataIN.showLine || true;
				this.showMarkers = dataIN.showMarkers || true;
				this.lineWidth = dataIN.lineWidth || 1;
				this.markerSize = dataIN.markerSize || 5;
				this.lineMinDay = dataIN.lineMinDay ?? null;
				this.lineMaxDay = dataIN.lineMaxDay ?? null;
				const periodKeys = Object.keys(parent.dataByDays.xByPeriod).map(Number);
				const numPeriods = periodKeys.length > 0 ? Math.max(...periodKeys) + 1 : 0;
				if (dataIN.selectedPeriods) {
					this.selectedPeriods = dataIN.selectedPeriods;
				} else if (dataIN.periodRangeMin != null && dataIN.periodRangeMax != null) {
					// Backward compatibility: convert old min/max range to selectedPeriods array
					this.selectedPeriods = Array.from({ length: numPeriods }, (_, i) => {
						const period = i + 1;
						return period >= dataIN.periodRangeMin && period <= dataIN.periodRangeMax;
					});
				} else {
					this.selectedPeriods = Array.from({ length: numPeriods }, () => true);
				}
				this.manualMarkers = dataIN.manualMarkers || [];
			}
		}

		toJSON() {
			return {
				name: this.name,
				type: this.type,
				centileThreshold: this.centileThreshold,
				templateHrsBefore: this.templateHrsBefore,
				templateHrsAfter: this.templateHrsAfter,
				colour: this.colour,
				showLine: this.showLine,
				showMarkers: this.showMarkers,
				lineWidth: this.lineWidth,
				markerSize: this.markerSize,
				lineMinDay: this.lineMinDay,
				lineMaxDay: this.lineMaxDay,
				selectedPeriods: this.selectedPeriods,
				manualMarkers: this.manualMarkers
			};
		}

		static fromJSON(json, parent) {
			return new PhaseMarkerClass(parent, {
				name: json.name,
				type: json.type,
				centileThreshold: json.centileThreshold,
				templateHrsBefore: json.templateHrsBefore,
				templateHrsAfter: json.templateHrsAfter,
				colour: json.colour,
				showLine: json.showLine,
				showMarkers: json.showMarkers,
				lineWidth: json.lineWidth,
				markerSize: json.markerSize,
				lineMinDay: json.lineMinDay,
				lineMaxDay: json.lineMaxDay,
				selectedPeriods: json.selectedPeriods,
				periodRangeMin: json.periodRangeMin,
				periodRangeMax: json.periodRangeMax,
				manualMarkers: json.manualMarkers
			});
		}
	}
</script>

<script>
	import StoreValueButton from '$lib/components/inputs/StoreValueButton.svelte';

	let { marker, which } = $props();
	const xscale = $derived(
		scaleLinear()
			.domain([0, marker.parentData.parentPlot.periodHrs * marker.parentData.parentPlot.doublePlot])
			.range([0, marker.parentData.parentPlot.plotwidth])
	);
	let addMarkerButtonText = $state('Add markers');
</script>

{#snippet controls(marker)}
	<div class="tableProcess-container">
		<div class="control-component-title">
			<div class="control-component-title-colour">
				<p><Editable bind:value={marker.name} /></p>
			</div>
			<div class="control-component-title-icons">
				<button
					class="icon"
					onclick={() => {
						marker.parentData.phaseMarkers = marker.parentData.phaseMarkers.filter(
							(m) => m.id !== marker.id
						);
					}}
				>
					<Icon name="minus" width={16} height={16} className="control-component-title-icon" />
				</button>
			</div>
		</div>
		<div class="control-input">
			<p>Type</p>
			<select bind:value={marker.type}>
				<option value="onset">Onset</option>
				<option value="offset">Offset</option>
				<option value="manual">Manual</option>
			</select>
		</div>

		<div class="control-input-color">
			<div class="control-color">
				<ColourPicker bind:value={marker.colour} />
			</div>

			<div class="control-input">
				<p>Marker size</p>
				<NumberWithUnits min="1" step="0.2" bind:value={marker.markerSize} />
			</div>
			<div class="control-input">
				<p>Line width:</p>
				<NumberWithUnits min="1" step="0.2" bind:value={marker.lineWidth} />
			</div>
		</div>

		{#if marker.type === 'manual'}
			<div class="control-input">
				<button
					onclick={() => {
						console.log(addMarkerButtonText);
						if (addMarkerButtonText == 'Add markers') {
							marker.parentData.parentPlot.isAddingMarkerTo = marker.id;
							addMarkerButtonText = 'Stop adding';
						} else {
							marker.parentData.parentPlot.isAddingMarkerTo = -1;
							addMarkerButtonText = 'Add markers';
						}
					}}>{addMarkerButtonText}</button
				>
			</div>
		{:else}
			<div class="control-input-horizontal">
				<div class="control-input">
					<p>N</p>
					<NumberWithUnits min="0" max="100" bind:value={marker.templateHrsBefore} />
				</div>

				<div class="control-input">
					<p>M</p>
					<NumberWithUnits min="0" max="100" bind:value={marker.templateHrsAfter} />
				</div>

				<div class="control-input">
					<p>%</p>
					<NumberWithUnits min="0" max="100" bind:value={marker.centileThreshold} />
				</div>
			</div>
		{/if}
		<div>
			<div class="period-selection-header">
				<p>Periods</p>
				<div class="period-selection-actions">
					<button
						class="period-select-btn"
						onclick={() => {
							const newSelected = [...marker.selectedPeriods];
							for (let i = 0; i < marker.markers.length; i++) {
								if (!isNaN(marker.markers[i]) && marker.markers[i] != null) {
									while (newSelected.length <= i) newSelected.push(true);
									newSelected[i] = true;
								}
							}
							marker.selectedPeriods = newSelected;
						}}>All</button
					>
					<button
						class="period-select-btn"
						onclick={() => {
							const newSelected = [...marker.selectedPeriods];
							for (let i = 0; i < marker.markers.length; i++) {
								if (!isNaN(marker.markers[i]) && marker.markers[i] != null) {
									while (newSelected.length <= i) newSelected.push(true);
									newSelected[i] = false;
								}
							}
							marker.selectedPeriods = newSelected;
						}}>None</button
					>
				</div>
			</div>
			<div class="period-marker-list">
				{#each marker.markers as markerValue, i (i)}
					{#if !isNaN(markerValue) && markerValue != null}
						{@const periodHrs = marker.parentData.parentPlot.periodHrs}
						{@const displayValue = parseFloat(
							(((markerValue % periodHrs) + periodHrs) % periodHrs).toFixed(2)
						)}
						<div class="period-marker-row">
							<input
								type="checkbox"
								checked={marker.selectedPeriods[i] ?? true}
								onchange={() => {
									const newSelected = [...marker.selectedPeriods];
									while (newSelected.length <= i) newSelected.push(true);
									newSelected[i] = !newSelected[i];
									marker.selectedPeriods = newSelected;
								}}
							/>
							<span class="period-number">{i + 1}:</span>
							<input
								type="number"
								class="marker-value-input"
								value={displayValue}
								step="0.01"
								min="0"
								max={periodHrs}
								onchange={(e) => {
									const newVal = parseFloat(e.target.value);
									if (!isNaN(newVal)) {
										marker.editMarker(i, newVal);
									} else {
										e.target.value = displayValue;
									}
								}}
							/>
						</div>
					{/if}
				{/each}
			</div>
		</div>

		{#if marker.linearRegression?.slope}
			<!-- <p>Drawn τ: {marker.linearRegression.slope.toFixed(2)} hrs</p> -->
			{#if marker.harmonicCheck}
				<p>
					<strong>Est τ: {marker.harmonicCheck.strongest.peakPeriod.toFixed(2)} hrs</strong>
					<StoreValueButton
						label="τ"
						getter={() => marker.harmonicCheck.strongest.peakPeriod}
						defaultName={'tau_' + marker.name}
						source={'Actogram phase marker (' + marker.name + ')'}
					/>
				</p>
			{/if}

			{#if marker.estimatedPhase}
				<p>
					<strong
						>Est φ (day {marker.estimatedPhase.refDay}): {marker.estimatedPhase.phase.toFixed(
							2
						)} hrs</strong
					>
					<StoreValueButton
						label="φ"
						getter={() => marker.estimatedPhase.phase}
						defaultName={'phi_' + marker.name}
						source={'Actogram phase marker (' + marker.name + ')'}
					/>
				</p>
			{/if}

			<p>
				R²: {marker.linearRegression.rSquared.toFixed(3)}
				<StoreValueButton
					label="R²"
					getter={() => marker.linearRegression.rSquared}
					defaultName={'marker_r_squared_' + marker.name}
					source={'Actogram phase marker (' + marker.name + ')'}
				/>
				&ensp;Error: {marker.linearRegression.rmse.toFixed(3)}
				<StoreValueButton
					label="RMSE"
					getter={() => marker.linearRegression.rmse}
					defaultName={'marker_rmse_' + marker.name}
					source={'Actogram phase marker (' + marker.name + ')'}
				/>
			</p>

			<div class="control-input-checkbox">
				<input type="checkbox" bind:checked={marker.showLine} />
				<p>Show Line</p>
			</div>
			{#if marker.showLine}
				<div class="control-input-horizontal">
					<div class="control-input">
						<p>Line min day</p>
						<input
							type="number"
							min="1"
							max={marker.parentData.parentPlot.Ndays}
							step="1"
							placeholder="1"
							value={marker.lineMinDay ?? ''}
							onchange={(e) => {
								const v = /** @type {HTMLInputElement} */ (e.currentTarget).value;
								marker.lineMinDay = v === '' ? null : parseInt(v, 10);
							}}
						/>
					</div>
					<div class="control-input">
						<p>Line max day</p>
						<input
							type="number"
							min="1"
							max={marker.parentData.parentPlot.Ndays}
							step="1"
							placeholder={String(marker.parentData.parentPlot.Ndays)}
							value={marker.lineMaxDay ?? ''}
							onchange={(e) => {
								const v = /** @type {HTMLInputElement} */ (e.currentTarget).value;
								marker.lineMaxDay = v === '' ? null : parseInt(v, 10);
							}}
						/>
					</div>
				</div>
			{/if}
		{/if}
	</div>
{/snippet}

{#snippet plot(marker)}
	{#if marker.showLine && marker.linearRegression?.slope}
		{@const Ndays = marker.parentData.parentPlot.Ndays}
		{@const eph = marker.parentData.parentPlot.eachplotheight}
		{@const sb = marker.parentData.parentPlot.spaceBetween}
		{@const periodHrs = marker.parentData.parentPlot.periodHrs}
		{@const padTop = marker.parentData.parentPlot.padding.top}
		{@const padLeft = marker.parentData.parentPlot.padding.left}
		<!-- 1-indexed day range from UI (null = unbounded). Clamp to plot. -->
		{@const lo = Math.max(1, marker.lineMinDay ?? 1)}
		{@const hi = Math.min(Ndays, marker.lineMaxDay ?? Ndays)}
		{#if hi >= lo}
			{@const dx = marker.linearRegression.slope - periodHrs}
			<!-- y at top of day d (0-indexed) = padTop + d*(eph+sb).
			     y at bottom of day d         = padTop + d*(eph+sb) + eph.
			     x at top of day d            = intercept + d*dx. -->
			<line
				x1={xscale(marker.linearRegression.intercept + (lo - 1) * dx) + padLeft}
				y1={padTop + (lo - 1) * (eph + sb)}
				x2={xscale(marker.linearRegression.intercept + hi * dx) + padLeft}
				y2={padTop + (hi - 1) * (eph + sb) + eph}
				stroke={marker.colour}
				stroke-width={marker.lineWidth}
			/>
		{/if}
	{/if}
	<path d={marker.markerPoints} fill={marker.colour} stroke="none" />
{/snippet}

{#if which === 'plot'}
	{@render plot(marker)}
{:else if which === 'controls'}
	{@render controls(marker)}
{/if}

<style>
	.period-selection-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 4px;
	}

	.period-selection-header p {
		font-size: 12px;
		color: var(--color-lightness-35);
		margin: 0;
	}

	.period-selection-actions {
		display: flex;
		gap: 4px;
	}

	.period-select-btn {
		font-size: 11px;
		padding: 1px 6px;
		cursor: pointer;
		border: 1px solid #ccc;
		border-radius: 3px;
		background: #f5f5f5;
	}

	.period-select-btn:hover {
		background: #e0e0e0;
	}

	.period-marker-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-height: 150px;
		overflow-y: auto;
		border: 1px solid #e1e9f6;
		border-radius: 4px;
		padding: 4px;
	}

	.period-marker-row {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
	}

	.period-marker-row input[type='checkbox'] {
		margin: 0;
		width: 14px;
		height: 14px;
		cursor: pointer;
		flex-shrink: 0;
	}

	.period-number {
		color: var(--color-lightness-35);
		min-width: 24px;
		flex-shrink: 0;
	}

	.marker-value-input {
		width: 70px;
		font-size: 11px;
		padding: 1px 4px;
		border: 1px solid #ddd;
		border-radius: 2px;
		box-sizing: border-box;
	}

	.marker-value-input:focus {
		outline: none;
		border-color: #007bff;
	}
</style>
