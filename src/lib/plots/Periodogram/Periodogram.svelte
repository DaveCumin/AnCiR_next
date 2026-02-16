<script module>
	import { Column as ColumnClass } from '$lib/core/Column.svelte';
	import Column from '$lib/core/Column.svelte';
	import Axis from '$lib/components/plotBits/Axis.svelte';
	import { scaleLinear } from 'd3-scale';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';

	import { binData, mean, makeSeqArray } from '$lib/components/plotBits/helpers/wrangleData.js';
	import { pchisq, qchisq } from '$lib/data/CDFs';

	import Line, { LineClass } from '$lib/components/plotbits/Line.svelte';
	import Points, { PointsClass } from '$lib/components/plotBits/Points.svelte';
	import { dataSettingsScrollTo } from '$lib/components/views/ControlDisplay.svelte';

	export const Periodogram_defaultDataInputs = ['time', 'values'];
	export const Periodogram_controlHeaders = ['Properties', 'Data'];

	// Buffer factor: calculate this much extra beyond the display range
	// e.g. 0.25 means 25% extra on each side
	const CALC_RANGE_BUFFER = 0.25;

	// Lomb-Scargle implementation
	function calculateLombScarglePower(times, values, frequencies) {
		if (
			!times ||
			!values ||
			times.length < 2 ||
			values.length < 2 ||
			times.length !== values.length
		) {
			return new Array(frequencies.length).fill(NaN);
		}
		const validIndices = times
			.map((t, i) => (isNaN(t) || isNaN(values[i]) ? -1 : i))
			.filter((i) => i !== -1);
		const t = validIndices.map((i) => times[i]);
		const y = validIndices.map((i) => values[i]);

		if (t.length === 0) return new Array(frequencies.length).fill(0);

		const yMean = mean(y);
		const yVariance = y.reduce((sum, val) => sum + (val - yMean) ** 2, 0) / (y.length - 1);

		const powers = frequencies.map((f) => {
			const omega = 2 * Math.PI * f;

			const cosSum = t.reduce((sum, ti) => sum + Math.cos(omega * ti), 0);
			const sinSum = t.reduce((sum, ti) => sum + Math.sin(omega * ti), 0);
			const tau = Math.atan2(sinSum, cosSum) / (2 * omega);

			const cosTerm = y.reduce((sum, yi, i) => {
				return sum + (yi - yMean) * Math.cos(omega * (t[i] - tau));
			}, 0);
			const sinTerm = y.reduce((sum, yi, i) => {
				return sum + (yi - yMean) * Math.sin(omega * (t[i] - tau));
			}, 0);

			const cosDenom = t.reduce((sum, ti) => sum + Math.cos(omega * (ti - tau)) ** 2, 0);
			const sinDenom = t.reduce((sum, ti) => sum + Math.sin(omega * (ti - tau)) ** 2, 0);

			const power = (cosTerm ** 2 / cosDenom + sinTerm ** 2 / sinDenom) / (2 * yVariance);
			return power;
		});
		return powers;
	}

	// Enright periodogram implementation
	function calculateEnrightPower(times, values, periods, binSize) {
		if (!times || !values || times.length < 2 || values.length < 2) {
			return new Array(periods.length).fill(NaN);
		}

		const binnedData = binData(times, values, binSize, 0);
		if (binnedData.bins.length === 0) {
			return new Array(periods.length).fill(0);
		}

		const data = binnedData.y_out;
		const n = data.length;

		const dataMean = mean(data.filter((v) => !isNaN(v)));

		const centeredData = data.map((v) => (isNaN(v) ? 0 : v - dataMean));

		const powers = periods.map((period) => {
			const binsPerPeriod = Math.round(period / binSize);
			if (binsPerPeriod < 1 || binsPerPeriod > n) return 0;

			let qp = 0;
			let count = 0;

			for (let k = 1; k * binsPerPeriod < n; k++) {
				const lag = k * binsPerPeriod;

				let correlation = 0;
				let validPairs = 0;

				for (let i = 0; i < n - lag; i++) {
					if (!isNaN(centeredData[i]) && !isNaN(centeredData[i + lag])) {
						correlation += centeredData[i] * centeredData[i + lag];
						validPairs++;
					}
				}

				if (validPairs > 0) {
					qp += correlation / validPairs;
					count++;
				}
			}

			if (count > 0) {
				qp /= count;
			}

			const variance =
				centeredData.reduce((sum, val) => {
					return sum + (isNaN(val) ? 0 : val * val);
				}, 0) / n;

			return variance > 0 ? qp / variance : 0;
		});

		console.log(powers);
		return powers;
	}

	//Chi Squared periodogram implementation
	function calculateChiSquaredPower(data, binSize, period, avgAll, denominator) {
		const colNum = Math.round(period / binSize);
		if (colNum < 1) return NaN;

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

		const result = numerator / denominator;
		return isFinite(result) ? result : NaN;
	}

	/**
	 * Run the full periodogram calculation for the given parameters.
	 * Pure function — no side effects, no reactivity.
	 */
	function runPeriodogramCalculation(params) {
		let out = { x: [], y: [], threshold: [], pvalue: [] };
		let binnedData = { bins: [], y_out: [] };

		if (params.method === 'Chi-squared') {
			if (!params.yData) {
				return { x: [], y: [], threshold: [], pvalue: [] };
			}
			binnedData = binData(params.xData, params.yData, params.binSize, 0);
			if (binnedData.bins.length === 0) {
				return { x: [], y: [], threshold: [], pvalue: [] };
			}
		}

		const periods = makeSeqArray(params.periodMin, params.periodMax, params.periodSteps);
		const frequencies = periods.map((p) => 1 / p);

		const correctedAlpha = Math.pow(1 - params.chiSquaredAlpha, 1 / periods.length);
		const power = new Array(periods.length);
		const threshold = new Array(periods.length);
		const pvalue = new Array(periods.length);

		if (params.method === 'Chi-squared') {
			const data = binnedData.y_out;
			const avgAll = mean(data);
			let denominator = 0;
			for (let i = 0; i < data.length; i++) {
				const val = data[i];
				if (!isNaN(val)) {
					denominator += (val - avgAll) ** 2;
				}
			}

			for (let p = 0; p < periods.length; p++) {
				power[p] = calculateChiSquaredPower(data, params.binSize, periods[p], avgAll, denominator);
				threshold[p] = qchisq(1 - correctedAlpha, Math.round(periods[p] / params.binSize));
				pvalue[p] = 1 - pchisq(power[p], Math.round(periods[p] / params.binSize));
			}
		} else if (params.method === 'Lomb-Scargle') {
			const times = params.xData;
			const values = params.yData;
			const powers = calculateLombScarglePower(times, values, frequencies);

			for (let p = 0; p < periods.length; p++) {
				power[p] = powers[p];
			}
		} else if (params.method === 'Enright') {
			const times = params.xData;
			const values = params.yData;
			const powers = calculateEnrightPower(times, values, periods, params.binSize);

			for (let p = 0; p < periods.length; p++) {
				power[p] = powers[p];
			}
		}

		var idxsToRemove = [];
		for (let i = 0; i < power.length; i++) {
			if (isNaN(power[i]) || isNaN(periods[i])) {
				idxsToRemove.push(i);
			}
		}

		out = {
			x: periods.filter((v, i) => !idxsToRemove.includes(i)),
			y: power.filter((v, i) => !idxsToRemove.includes(i)),
			threshold: threshold.filter((v, i) => !idxsToRemove.includes(i)),
			pvalue: pvalue.filter((v, i) => !idxsToRemove.includes(i))
		};

		return out;
	}

	/**
	 * Build a fingerprint string from the data-related params (everything
	 * EXCEPT period range). When this changes, we must always recalculate.
	 */
	function buildDataFingerprint(xData, yData, binSize, method, chiSquaredAlpha, periodSteps) {
		return JSON.stringify({
			xLen: xData?.length ?? 0,
			xFirst: xData?.[0] ?? null,
			xLast: xData?.[xData?.length - 1] ?? null,
			yLen: yData?.length ?? 0,
			yFirst: yData?.[0] ?? null,
			yLast: yData?.[yData?.length - 1] ?? null,
			binSize,
			method,
			chiSquaredAlpha,
			periodSteps
		});
	}

	class PeriodogramDataclass {
		parentPlot = $state();
		x = $state();
		y = $state();
		binSize = $state(0.25);
		method = $state('Chi-squared');

		line = $state();
		points = $state();
		thresholdline = $state();
		chiSquaredAlpha = $state(0.05);

		// ── Cache: intentionally a plain JS object, NOT $state. ──
		// Svelte's reactivity system does NOT track reads/writes to this,
		// which is exactly what we want — it lets us short-circuit inside
		// $derived.by without creating new reactive dependencies.
		_cache;

		// ── The single derived that the rest of the component reads. ──
		// It reads all reactive inputs (data, method, binSize, periodlims…)
		// so Svelte re-evaluates it whenever any of those change.  But
		// internally it checks the plain-JS cache and returns early when
		// the expensive calculation can be skipped.
		periodData = $derived.by(() => {
			// 1. Read every reactive dependency up front so Svelte tracks them.
			const xData = this.x.hoursSinceStart;
			const yData = this.y.getData();
			const binSize = this.binSize;
			const method = this.method;
			const chiSquaredAlpha = this.chiSquaredAlpha;
			const periodSteps = this.parentPlot.periodSteps;
			const displayMin = this.parentPlot.periodlimsIN[0];
			const displayMax = this.parentPlot.periodlimsIN[1];

			// 2. Build a fingerprint of everything that ISN'T the period range.
			const fp = buildDataFingerprint(xData, yData, binSize, method, chiSquaredAlpha, periodSteps);

			// 3. Check the plain-JS cache.
			const c = this._cache;
			const dataChanged = fp !== c.dataFingerprint;
			const rangeCovered =
				c.calcMin !== null &&
				c.calcMax !== null &&
				c.calcMin <= displayMin &&
				c.calcMax >= displayMax;

			// 4. If data hasn't changed AND cached range covers display → skip calc.
			if (!dataChanged && rangeCovered) {
				return c.result;
			}

			// 5. Calculate with a buffered range so small future adjustments
			//    will also be covered without recalculating.
			const span = displayMax - displayMin;
			const buffer = span * CALC_RANGE_BUFFER;
			const calcMin = Math.max(0.01, displayMin - buffer);
			const calcMax = displayMax + buffer;

			const result = runPeriodogramCalculation({
				xData,
				yData,
				binSize,
				method,
				chiSquaredAlpha,
				periodMin: calcMin,
				periodMax: calcMax,
				periodSteps
			});

			// 6. Write back to the plain-JS cache (no reactivity triggered).
			c.calcMin = calcMin;
			c.calcMax = calcMax;
			c.dataFingerprint = fp;
			c.result = result;

			return result;
		});

		constructor(parent, dataIN) {
			this.parentPlot = parent;

			// Initialise the plain-JS cache BEFORE any $derived runs.
			this._cache = {
				calcMin: null,
				calcMax: null,
				dataFingerprint: null,
				result: { x: [], y: [], threshold: [], pvalue: [] }
			};

			if (dataIN?.x) {
				this.x = ColumnClass.fromJSON(dataIN.x);
			} else {
				if (parent.data.length > 0) {
					this.x = new ColumnClass({ refId: parent.data[parent.data.length - 1].x.refId });
				} else {
					this.x = new ColumnClass({ refId: -1 });
				}
			}
			if (dataIN && dataIN.y) {
				this.y = ColumnClass.fromJSON(dataIN.y);
			} else {
				this.y = new ColumnClass({ refId: -1 });
			}
			this.line = new LineClass(dataIN?.line, this);
			this.thresholdline = new LineClass(dataIN?.thresholdline, this);
			this.points = new PointsClass(dataIN?.points, this);
			this.method = dataIN?.method ?? 'Lomb-Scargle';
		}

		toJSON() {
			return {
				x: this.x,
				y: this.y,
				line: this.line.toJSON(),
				thresholdline: this.thresholdline.toJSON(),
				points: this.points.toJSON(),
				binSize: this.binSize,
				method: this.method,
				chiSquaredAlpha: this.chiSquaredAlpha
			};
		}

		static fromJSON(json, parent) {
			return new PeriodogramDataclass(parent, {
				x: json.x,
				y: json.y,
				line: LineClass.fromJSON(json.line),
				thresholdline: LineClass.fromJSON(json.thresholdline),
				points: PointsClass.fromJSON(json.points),
				binSize: json.binSize,
				method: json.method,
				chiSquaredAlpha: json.chiSquaredAlpha
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
				ymin = Math.floor(Math.min(ymin, Math.min(...tempy)));
				ymax = Math.ceil(Math.max(ymax, Math.max(...tempy)));
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
			let axisWidths = { left: null, right: null, top: null, bottom: null };

			const leftSVG = document.getElementById('plot' + this.parentBox.id)?.getBoundingClientRect();

			//LEFT
			const allLeftAxes = document
				.getElementById('plot' + this.parentBox.id)
				?.getElementsByClassName('axis-left');
			if (allLeftAxes.length == 0) {
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
			const allRightAxes = document
				.getElementById('plot' + this.parentBox.id)
				.getElementsByClassName('axis-right');
			if (allRightAxes.length == 0) {
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
			const allTopAxes = document
				.getElementById('plot' + this.parentBox.id)
				.getElementsByClassName('axis-top');
			if (allTopAxes.length == 0) {
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
			const allBottomAxes = document
				.getElementById('plot' + this.parentBox.id)
				.getElementsByClassName('axis-bottom');
			if (allBottomAxes.length == 0) {
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
					axisWidths.bottom = Math.round(bottomAxisWhole - bottomAxisLine + 12);
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

			this.data.push(datum);
		}
		removeData(idx) {
			this.data.splice(idx, 1);
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
			}
			return periodogram;
		}
	}
</script>

<script>
	import { appState } from '$lib/core/core.svelte';
	import { onMount } from 'svelte';
	import { flip } from 'svelte/animate';
	import { slide } from 'svelte/transition';
	import { tick } from 'svelte';

	import Icon from '$lib/icons/Icon.svelte';

	let { theData, which } = $props();

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
			theData.ylims;
			theData.xlims;

			theData.autoScalePadding('all');
		}
	});
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
						<NumberWithUnits
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
						<NumberWithUnits
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
					<div style="display: flex;  justify-content: flex-start; align-items: center; gap: 8px;">
						<NumberWithUnits
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
						<NumberWithUnits
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

			<div class="control-input-vertical">
				<div class="control-input-checkbox">
					<input type="checkbox" bind:checked={theData.ygridlines} />
					<p>Grid</p>
				</div>
			</div>

			<div class="control-input-horizontal">
				<div class="control-input">
					<p>Min</p>
					<NumberWithUnits
						step="0.1"
						value={theData.ylimsIN[0] ? theData.ylimsIN[0] : theData.ylims[0]}
						onInput={(val) => {
							theData.ylimsIN[0] = [parseFloat(val)];
						}}
					/>
				</div>

				<div class="control-input">
					<p>Max</p>
					<NumberWithUnits
						step="0.1"
						value={theData.ylimsIN[1] ? theData.ylimsIN[1] : theData.ylims[1]}
						onInput={(val) => {
							theData.ylimsIN[1] = [parseFloat(val)];
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
					<p>Grid</p>
				</div>
			</div>

			<div class="control-input-horizontal">
				<div class="control-input">
					<p>Min</p>
					<NumberWithUnits
						min="0.1"
						step="0.1"
						value={theData.periodlimsIN[0] ? theData.periodlimsIN[0] : theData.periodlims[0]}
						onInput={(val) => {
							theData.periodlimsIN[0] = parseFloat(val);
						}}
					/>
				</div>

				<div class="control-input">
					<p>Max</p>
					<NumberWithUnits
						step="0.1"
						value={theData.periodlimsIN[1] ? theData.periodlimsIN[1] : theData.periodlimsIN[1]}
						onInput={(val) => {
							theData.periodlimsIN[1] = parseFloat(val);
						}}
					/>
				</div>
			</div>

			<div class="control-input-vertical">
				<div class="control-input">
					<p>Period Step</p>
					<NumberWithUnits min="0.01" step="0.01" bind:value={theData.periodSteps} />
				</div>
			</div>
		</div>
	{:else if appState.currentControlTab === 'data'}
		<div id="dataSettings">
			<div class="control-data-add">
				<button
					class="icon"
					onclick={async () => {
						theData.addData({
							x: null,
							y: { refId: -1 }
						});
						await tick();

						//Scroll to the bottom of dataSettings
						dataSettingsScrollTo('bottom');
					}}
				>
					<Icon name="add" width={16} height={16} />
				</button>
			</div>

			<div class="control-data-container">
				{#each theData.data as datum, i (datum.x.id + '-' + datum.y.id)}
					<div
						class="dataBlock"
						animate:flip={{ duration: 500 }}
						in:slide={{ duration: 500, axis: 'y' }}
						out:slide={{ duration: 500, axis: 'y' }}
					>
						<div class="control-component-title">
							<p>
								Data {i}
							</p>
							<button class="icon" onclick={() => theData.removeData(i)}
								><Icon
									name="minus"
									width={16}
									height={16}
									className="control-component-title-icon"
								/></button
							>
						</div>

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

						<div class="control-input">
							<p>Method</p>
							<select bind:value={datum.method}>
								<option value="Lomb-Scargle">Lomb-Scargle</option>
								<option value="Chi-squared">Chi-squared</option>
								<option value="Enright">Enright</option>
							</select>
						</div>

						<!-- New: Method selector -->
						<div class="control-input-horizontal">
							<!-- binSize only relevant for Chi-squared -->
							{#if datum.method === 'Chi-squared'}
								<div class="control-input">
									<p>Bin Size</p>
									<input type="number" step="0.01" min="0.01" bind:value={datum.binSize} />
								</div>

								<div class="control-input">
									<p>Alpha</p>
									<input
										type="number"
										min="0.0001"
										max="0.9999"
										step="0.01"
										bind:value={datum.chiSquaredAlpha}
									/>
								</div>
							{/if}
						</div>

						<Line lineData={datum.line} which="controls" />
						<Points pointsData={datum.points} which="controls" />
						{#if datum.method === 'Chi-squared'}
							<Line lineData={datum.thresholdline} which="controls" title="Threshold" />
						{/if}

						<div class="div-line"></div>
					</div>
				{/each}
			</div>
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
			label="Power"
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
			label="Period (hours)"
		/>

		{#each theData.plot.data as datum}
			<Line
				lineData={datum.line}
				x={datum.periodData.x}
				y={datum.periodData.y}
				xscale={scaleLinear()
					.domain([theData.plot.periodlimsIN[0], theData.plot.periodlimsIN[1]])
					.range([0, theData.plot.plotwidth])}
				yscale={scaleLinear()
					.domain([theData.plot.ylims[0], theData.plot.ylims[1]])
					.range([theData.plot.plotheight, 0])}
				yoffset={theData.plot.padding.top}
				xoffset={theData.plot.padding.left}
				which="plot"
			/>
			<Points
				pointsData={datum.points}
				x={datum.periodData.x}
				y={datum.periodData.y}
				xscale={scaleLinear()
					.domain([theData.plot.periodlimsIN[0], theData.plot.periodlimsIN[1]])
					.range([0, theData.plot.plotwidth])}
				yscale={scaleLinear()
					.domain([theData.plot.ylims[0], theData.plot.ylims[1]])
					.range([theData.plot.plotheight, 0])}
				yoffset={theData.plot.padding.top}
				xoffset={theData.plot.padding.left}
				tooltip={true}
				which="plot"
			/>
			{#if datum.method === 'Chi-squared'}
				<Line
					lineData={datum.thresholdline}
					x={datum.periodData.x}
					y={datum.periodData.threshold}
					xscale={scaleLinear()
						.domain([theData.plot.periodlimsIN[0], theData.plot.periodlimsIN[1]])
						.range([0, theData.plot.plotwidth])}
					yscale={scaleLinear()
						.domain([theData.plot.ylims[0], theData.plot.ylims[1]])
						.range([theData.plot.plotheight, 0])}
					yoffset={theData.plot.padding.top}
					xoffset={theData.plot.padding.left}
					which="plot"
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
