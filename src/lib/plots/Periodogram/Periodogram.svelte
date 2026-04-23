<script module>
	// @ts-nocheck
	import { Column as ColumnClass } from '$lib/core/Column.svelte';
	import Column from '$lib/core/Column.svelte';
	import Axis, { AxisClass } from '$lib/components/plotbits/Axis.svelte';
	import { scaleLinear } from 'd3-scale';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';

	import Line, { LineClass } from '$lib/components/plotbits/Line.svelte';
	import Points, { PointsClass } from '$lib/components/plotbits/Points.svelte';
	import { findNearestY } from '$lib/components/plotbits/helpers/tooltipHelpers.js';
	import { dataSettingsScrollTo } from '$lib/components/views/ControlDisplay.svelte';

	import { runPeriodogramCalculation } from '$lib/utils/periodogram.js';

	export const Periodogram_defaultDataInputs = ['time', 'values'];
	export const Periodogram_controlHeaders = ['Properties', 'Data'];

	// Buffer factor: calculate this much extra beyond the display range
	// e.g. 0.25 means 25% extra on each side
	const CALC_RANGE_BUFFER = 0.25;

	/**
	 * Build a fingerprint string from the data-related params (everything
	 * EXCEPT period range). When this changes, we must always recalculate.
	 */
	function buildDataFingerprint(
		xData,
		yData,
		binSize,
		method,
		chiSquaredAlpha,
		periodSteps,
		xDataHash,
		yDataHash
	) {
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
			periodSteps,
			xDataHash,
			yDataHash
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

		// Calculation state
		calculating = $state(false);
		progress = $state({ current: 0, total: 0 });
		dataWarnings = $state([]);

		// Period data - now $state instead of $derived
		periodData = $state({ x: [], y: [], threshold: [], pvalue: [] });

		// Peak detection - find the highest power value across ALL calculated data
		peak = $derived.by(() => {
			const { x, y } = this.periodData;
			if (!x || !y || x.length === 0 || y.length === 0) return null;
			let maxIdx = 0;
			for (let i = 1; i < y.length; i++) {
				if (y[i] > y[maxIdx]) maxIdx = i;
			}
			return { period: x[maxIdx], power: y[maxIdx] };
		});

		// Peak within the visible x-axis range
		visiblePeak = $derived.by(() => {
			const { x, y } = this.periodData;
			if (!x || !y || x.length === 0 || y.length === 0) return null;
			const [xMin, xMax] = this.parentPlot?.periodlimsIN ?? [0, Infinity];
			const visibleIndices = [];
			for (let i = 0; i < x.length; i++) {
				if (x[i] >= xMin && x[i] <= xMax) visibleIndices.push(i);
			}
			if (visibleIndices.length === 0) return null;
			let maxIdx = visibleIndices[0];
			for (let i = 1; i < visibleIndices.length; i++) {
				if (y[visibleIndices[i]] > y[maxIdx]) maxIdx = visibleIndices[i];
			}
			return { period: x[maxIdx], power: y[maxIdx] };
		});

		// Cache for smart recalculation
		_cache = {
			calcMin: null,
			calcMax: null,
			dataFingerprint: null
		};

		// Debounce timer for calculations
		_debounceTimer = null;
		_debounceDelay = 250; // ms

		constructor(parent, dataIN) {
			this.parentPlot = parent;

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
			this.binSize = dataIN?.binSize ?? 0.25;
			this.chiSquaredAlpha = dataIN?.chiSquaredAlpha ?? 0.05;
		}

		cleanup() {
			if (this._debounceTimer) {
				clearTimeout(this._debounceTimer);
				this._debounceTimer = null;
			}
		}

		// Called by the component's $effect to trigger calculation.
		// Reactive values must be read by the caller ($effect) and passed in.
		triggerCalculation(
			xData,
			yData,
			binSize,
			method,
			chiSquaredAlpha,
			periodSteps,
			displayMin,
			displayMax,
			xDataHash,
			yDataHash
		) {
			// Skip if data is invalid — also clear any stale cached result
			if (!xData || !yData || xData.length === 0 || yData.length === 0) {
				this.periodData = { x: [], y: [], threshold: [], pvalue: [] };
				this._cache.dataFingerprint = null;
				return;
			}

			// Check data quality for binning-based methods (warnings only — calculation still runs)
			if (method === 'Chi-squared' || method === 'Enright') {
				const warnings = [];

				const nanXCount = xData.filter((v) => v === null || v === undefined || isNaN(v)).length;
				if (nanXCount > 0) {
					warnings.push(
						`${nanXCount} missing time value${nanXCount > 1 ? 's' : ''} — excluded from binning, but may indicate irregular data collection.`
					);
				}

				const nanYCount = yData.filter((v) => v === null || v === undefined || isNaN(v)).length;
				if (nanYCount > 0) {
					const yMsg =
						method === 'Chi-squared'
							? 'empty bins distort the chi-squared statistic'
							: 'empty bins are treated as zero and bias the Enright autocorrelation';
					warnings.push(`${nanYCount} missing y value${nanYCount > 1 ? 's' : ''} — ${yMsg}.`);
				}

				// Check for time gaps larger than the bin size
				const validX = xData
					.filter((v) => v !== null && v !== undefined && !isNaN(v))
					.sort((a, b) => a - b);
				if (validX.length > 1) {
					let maxGap = 0;
					for (let i = 1; i < validX.length; i++) {
						const gap = validX[i] - validX[i - 1];
						if (gap > maxGap) maxGap = gap;
					}
					if (maxGap > binSize * 1.5) {
						const gapMsg =
							method === 'Chi-squared'
								? 'inflate the chi-squared statistic and may produce false peaks'
								: 'are treated as zero and bias the Enright autocorrelation';
						warnings.push(
							`Data has gaps up to ${maxGap.toFixed(1)} h (bin size: ${binSize} h) — empty bins ${gapMsg}.`
						);
					}
				}

				this.dataWarnings = warnings;
			} else {
				this.dataWarnings = [];
			}

			// Build fingerprint for data-related params
			const fp = buildDataFingerprint(
				xData,
				yData,
				binSize,
				method,
				chiSquaredAlpha,
				periodSteps,
				xDataHash,
				yDataHash
			);

			// Check cache
			const dataChanged = fp !== this._cache.dataFingerprint;
			const rangeCovered =
				this._cache.calcMin !== null &&
				this._cache.calcMax !== null &&
				this._cache.calcMin <= displayMin &&
				this._cache.calcMax >= displayMax;

			// Skip calculation if cache is valid
			if (!dataChanged && rangeCovered) {
				return;
			}

			// Calculate with buffered range
			const span = displayMax - displayMin;
			const buffer = span * CALC_RANGE_BUFFER;
			const calcMin = Math.max(0.01, displayMin - buffer);
			const calcMax = displayMax + buffer;

			// Update cache
			this._cache.calcMin = calcMin;
			this._cache.calcMax = calcMax;
			this._cache.dataFingerprint = fp;

			// Clear any pending debounced calculation
			if (this._debounceTimer) {
				clearTimeout(this._debounceTimer);
			}

			// Debounce the actual worker call
			this._debounceTimer = setTimeout(() => {
				this.startCalculation({
					xData,
					yData,
					binSize,
					method,
					chiSquaredAlpha,
					periodMin: calcMin,
					periodMax: calcMax,
					periodSteps
				});
			}, this._debounceDelay);
		}

		startCalculation(params) {
			this.calculating = true;
			this.progress = { current: 0, total: 0 };

			setTimeout(() => {
				try {
					this.periodData = runPeriodogramCalculation(params, (current, total) => {
						this.progress = { current, total };
					});
				} catch (e) {
					console.error('Periodogram calculation error:', e);
				} finally {
					this.calculating = false;
					this.progress = { current: 0, total: 0 };
				}
			}, 0);
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
		xAxis = $state();
		yAxis = $state();

		constructor(parent, dataIN) {
			this.parentBox = parent;
			this.xAxis = new AxisClass({
				label: dataIN?.xAxis?.label ?? 'Period (hours)',
				gridlines: dataIN?.xAxis?.gridlines ?? true,
				nticks: dataIN?.xAxis?.nticks ?? 5
			});
			this.yAxis = new AxisClass({
				label: dataIN?.yAxis?.label ?? 'Power',
				gridlines: dataIN?.yAxis?.gridlines ?? true,
				nticks: dataIN?.yAxis?.nticks ?? 5
			});
			if (dataIN) {
				this.addData(dataIN);
			}
		}

		getAutoScaleValues() {
			let axisWidths = { left: null, right: null, top: null, bottom: null };

			const plotEl = document.getElementById('plot' + this.parentBox.id);
			if (!plotEl) return axisWidths;

			//LEFT
			const allLeftAxes = plotEl.getElementsByClassName('axis-left');
			if (allLeftAxes.length > 0) {
				let leftMost = 0;
				let leftAxisWhole = allLeftAxes[0].getBoundingClientRect().left;
				for (let i = 1; i < allLeftAxes.length; i++) {
					if (allLeftAxes[i].getBoundingClientRect().left < leftAxisWhole) {
						leftMost = i;
						leftAxisWhole = allLeftAxes[i].getBoundingClientRect().left;
					}
				}
				// Domain line may be absent during axis re-mount (see #key in Axis.svelte)
				const domain = allLeftAxes[leftMost].getElementsByClassName('domain')[0];
				if (domain) {
					const leftAxisLine = domain.getBoundingClientRect().left;
					axisWidths.left = Math.round(leftAxisLine - leftAxisWhole + 6);
				}
			}

			//RIGHT
			const allRightAxes = plotEl.getElementsByClassName('axis-right');
			if (allRightAxes.length > 0) {
				let rightMost = 0;
				let rightAxisWhole = allRightAxes[0].getBoundingClientRect().right;
				for (let i = 1; i < allRightAxes.length; i++) {
					if (allRightAxes[i].getBoundingClientRect().right > rightAxisWhole) {
						rightMost = i;
						rightAxisWhole = allRightAxes[i].getBoundingClientRect().right;
					}
				}
				const domain = allRightAxes[rightMost].getElementsByClassName('domain')[0];
				if (domain) {
					const rightAxisLine = domain.getBoundingClientRect().right;
					axisWidths.right = Math.round(rightAxisWhole - rightAxisLine + 6);
				}
			}

			//TOP
			const allTopAxes = plotEl.getElementsByClassName('axis-top');
			if (allTopAxes.length > 0) {
				let topMost = 0;
				let topAxisWhole = allTopAxes[0].getBoundingClientRect().top;
				for (let i = 1; i < allTopAxes.length; i++) {
					if (allTopAxes[i].getBoundingClientRect().top < topAxisWhole) {
						topMost = i;
						topAxisWhole = allTopAxes[i].getBoundingClientRect().top;
					}
				}
				const domain = allTopAxes[topMost].getElementsByClassName('domain')[0];
				if (domain) {
					const topAxisLine = domain.getBoundingClientRect().top;
					axisWidths.top = Math.round(topAxisLine - topAxisWhole + 6);
				}
			}

			//BOTTOM
			const allBottomAxes = plotEl.getElementsByClassName('axis-bottom');
			if (allBottomAxes.length > 0) {
				let bottomMost = 0;
				let bottomAxisWhole = allBottomAxes[0].getBoundingClientRect().bottom;
				for (let i = 1; i < allBottomAxes.length; i++) {
					if (allBottomAxes[i].getBoundingClientRect().bottom > bottomAxisWhole) {
						bottomMost = i;
						bottomAxisWhole = allBottomAxes[i].getBoundingClientRect().bottom;
					}
				}
				const domain = allBottomAxes[bottomMost].getElementsByClassName('domain')[0];
				if (domain) {
					const bottomAxisLine = domain.getBoundingClientRect().bottom;
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
			// Clean up the worker before removing
			if (this.data[idx]) {
				this.data[idx].cleanup();
			}
			this.data.splice(idx, 1);
		}

		getDownloadData() {
			const hasThreshold = this.data.some((d) => d.method === 'Chi-squared');
			const headers = ['DataSeries', 'Period (hours)', 'Power'];
			if (hasThreshold) headers.push('Threshold', 'P-value');
			const rows = [];
			this.data.forEach((datum, d) => {
				const pd = datum.periodData;
				for (let i = 0; i < pd.x.length; i++) {
					const row = [d, pd.x[i], pd.y[i]];
					if (hasThreshold) {
						row.push(pd.threshold?.[i] ?? '', pd.pvalue?.[i] ?? '');
					}
					rows.push(row);
				}
			});
			return { headers, rows };
		}

		toJSON() {
			return {
				periodlimsIN: this.periodlimsIN,
				periodSteps: this.periodSteps,
				ylimsIN: this.ylimsIN,
				padding: this.padding,
				xAxis: this.xAxis.toJSON(),
				yAxis: this.yAxis.toJSON(),
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

			// Support both new AxisClass format and old individual properties
			if (json.xAxis) {
				periodogram.xAxis = AxisClass.fromJSON(json.xAxis);
			} else {
				periodogram.xAxis = new AxisClass({
					label: 'Period (hours)',
					gridlines: json.xgridlines ?? true
				});
			}
			if (json.yAxis) {
				periodogram.yAxis = AxisClass.fromJSON(json.yAxis);
			} else {
				periodogram.yAxis = new AxisClass({ label: 'Power', gridlines: json.ygridlines ?? true });
			}

			if (json.data) {
				periodogram.data = json.data.map((d) => PeriodogramDataclass.fromJSON(d, periodogram));
			}
			return periodogram;
		}
	}
</script>

<script>
	import { appState } from '$lib/core/core.svelte';
	import { onMount, onDestroy } from 'svelte';
	import { flip } from 'svelte/animate';
	import { slide } from 'svelte/transition';
	import { tick } from 'svelte';

	import Icon from '$lib/icons/Icon.svelte';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';

	let { theData, which } = $props();

	//Tooltip
	let tooltip = $state({ visible: false, x: 0, y: 0, content: '' });
	function handleTooltip(event) {
		tooltip = event.detail;
	}

	// Siblings for aggregated tooltips — show every series' y at the hovered period.
	let periodogramSiblings = $derived.by(() => {
		if (which !== 'plot' || !theData?.plot?.data) return [];
		return theData.plot.data
			.filter((d) => d.periodData?.x?.length > 0 && d.periodData?.y?.length > 0)
			.map((d) => ({
				label: d.y?.name || '',
				colour: d.points?.colour || d.line?.colour || 'black',
				findYAt: (x) => findNearestY(d.periodData.x, d.periodData.y, x)
			}));
	});

	onMount(() => {
		if (which == 'plot') {
			theData.plot.autoScalePadding('all');
		}
	});

	onDestroy(() => {
		// Clean up debounce timers
		if (which === 'plot' && theData.plot?.data) {
			theData.plot.data.forEach((datum) => {
				datum.cleanup();
			});
		}
	});

	// Set up calculation triggers for all periodogram data.
	// We read all reactive dependencies HERE so Svelte tracks them,
	// then pass the values into the debounced triggerCalculation.
	$effect(() => {
		if (which === 'plot' && theData.plot?.data) {
			theData.plot.data.forEach((datum) => {
				const xData = datum.x.hoursSinceStart;
				const yData = datum.y.getData();
				const xDataHash = datum.x.getDataHash ?? '';
				const yDataHash = datum.y.getDataHash ?? '';
				const binSize = datum.binSize;
				const method = datum.method;
				const chiSquaredAlpha = datum.chiSquaredAlpha;
				const periodSteps = datum.parentPlot.periodSteps;
				const displayMin = datum.parentPlot.periodlimsIN[0];
				const displayMax = datum.parentPlot.periodlimsIN[1];

				datum.triggerCalculation(
					xData,
					yData,
					binSize,
					method,
					chiSquaredAlpha,
					periodSteps,
					displayMin,
					displayMax,
					xDataHash,
					yDataHash
				);
			});
		}
	});

	//check for axes if the labels change
	$effect(() => {
		if (which == 'controls') {
			theData.yAxis.label;
			theData.xAxis.label;
			theData.ylims;

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

		<Axis axisData={theData.yAxis} which="controls" title="Y-Axis Controls" />

		<div class="control-component">
			<div class="control-component-title">
				<p>X-Axis</p>
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

		<Axis axisData={theData.xAxis} which="controls" title="X-Axis Controls" />
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

						{#if (datum.method === 'Chi-squared' || datum.method === 'Enright') && datum.dataWarnings && datum.dataWarnings.length > 0}
							<div class="data-warning">
								{#each datum.dataWarnings as warning}
									<p>⚠ {warning}</p>
								{/each}
							</div>
						{/if}

						{#if datum.visiblePeak}
							<p><strong>Peak Period: {datum.visiblePeak.period.toFixed(2)} hrs</strong></p>
							<p><strong>Peak Power: {datum.visiblePeak.power.toFixed(2)}</strong></p>
							{#if datum.peak && Math.abs(datum.visiblePeak.period - datum.peak.period) > 0.001}
								<div class="data-warning">
									<p>
										⚠ Overall peak at {datum.peak.period.toFixed(2)} hrs is outside the displayed range
									</p>
								</div>
							{/if}
						{:else if datum.peak}
							<p><strong>Peak Period: {datum.peak.period.toFixed(2)} hrs</strong></p>
							<p><strong>Peak Power: {datum.peak.power.toFixed(2)}</strong></p>
						{/if}

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
	<!-- Check if any data is calculating -->
	{@const isCalculating = theData.plot.data.some((d) => d.calculating)}
	{@const calculatingData = theData.plot.data.find((d) => d.calculating)}

	<!-- Calculating overlay -->
	{#if isCalculating && calculatingData}
		<div
			style="
				position: absolute;
				inset: 0;
				background: rgba(255, 255, 255, 0.9);
				backdrop-filter: blur(3px);
				display: flex;
				align-items: center;
				justify-content: center;
				flex-direction: column;
				gap: 16px;
				z-index: 10;
			"
		>
			<LoadingSpinner
				message="Calculating periodogram..."
				detail={calculatingData.progress.total > 0
					? `${Math.round((calculatingData.progress.current / calculatingData.progress.total) * 100)}%`
					: ''}
			/>
		</div>
	{/if}

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
			axisData={theData.plot.yAxis}
			which="plot"
		/>
		<Axis
			height={theData.plot.plotheight}
			width={theData.plot.plotwidth}
			scale={scaleLinear()
				.domain([theData.plot.periodlimsIN[0], theData.plot.periodlimsIN[1]])
				.range([0, theData.plot.plotwidth])}
			position="bottom"
			plotPadding={theData.plot.padding}
			axisData={theData.plot.xAxis}
			which="plot"
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
				tooltip={true}
				dataLabel={datum.y.name || ''}
				dataColour={datum.line.colour}
				xLabel={theData.plot.xAxis.label || 'Period (hours)'}
				yLabel={theData.plot.yAxis.label || 'Power'}
				siblings={periodogramSiblings}
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
				dataLabel={datum.y.name || ''}
				dataColour={datum.points.colour}
				xLabel={theData.plot.xAxis.label || 'Period (hours)'}
				yLabel={theData.plot.yAxis.label || 'Power'}
				siblings={periodogramSiblings}
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
			{@html tooltip.content}
		</div>
	{/if}
{/snippet}

{#if which === 'plot'}
	{@render plot(theData)}
{:else if which === 'controls'}
	{@render controls(theData)}
{/if}
