<script module>
	import { Column as ColumnClass } from '$lib/core/Column.svelte';
	import Column from '$lib/core/Column.svelte';
	import Axis, { AxisClass } from '$lib/components/plotbits/Axis.svelte';
	import { scaleLinear } from 'd3-scale';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';

	import Line, { LineClass } from '$lib/components/plotbits/Line.svelte';
	import Points, { PointsClass } from '$lib/components/plotbits/Points.svelte';
	import {
		findNearestY,
		bindAltTooltipToggle
	} from '$lib/components/plotbits/helpers/tooltipHelpers.js';
	import { dataSettingsScrollTo } from '$lib/components/views/ControlDisplay.svelte';
	import { computeAutocorrelation } from '$lib/utils/correlogram.js';
	import { minMaxAcross, max as arrMax } from '$lib/utils/stats.js';

	export const Correlogram_defaultDataInputs = ['time', 'values'];
	export const Correlogram_controlHeaders = ['Properties', 'Data'];

	class CorrelogramDataclass {
		parentPlot = $state();
		x = $state();
		y = $state();
		maxLag = $state(null); // null = auto (n/2), otherwise max lag in hours

		line = $state();
		points = $state();
		confidenceLine = $state(); // For confidence bounds

		showConfidenceBounds = $state(true);
		confidenceLevel = $state(0.95); // 95% confidence interval

		acfData = $derived.by(() => {
			const times = this.x?.hoursSinceStart ?? [];
			const values = this.y?.getData() ?? [];

			// Get binSize from the x column if it's available (from actogram data)
			let binSize = null;
			if (this.x?.binWidth) {
				binSize = this.x.binWidth;
			} else if (times.length > 1) {
				// Calculate from data
				binSize = (times[times.length - 1] - times[0]) / (times.length - 1);
			}

			return computeAutocorrelation(times, values, binSize, this.maxLag);
		});

		confidenceBounds = $derived.by(() => {
			// Calculate confidence bounds based on sample size
			const n = this.y?.getData()?.filter((v) => !isNaN(v) && v != null).length ?? 0;

			if (n < 2) return { upper: 0, lower: 0 };

			// For large samples, approximate 95% CI is ±1.96/sqrt(n)
			const z = this.confidenceLevel === 0.95 ? 1.96 : 2.576; // 95% or 99%
			const bound = z / Math.sqrt(n);
			return { upper: bound, lower: -bound };
		});

		// Peak detection - find the highest correlation after lag 0 (across ALL data)
		peak = $derived.by(() => {
			const { lags, correlations } = this.acfData;
			if (!lags || !correlations || lags.length < 2) return null;
			// Skip index 0 (lag=0 always has correlation=1.0)
			let maxIdx = 1;
			for (let i = 2; i < correlations.length; i++) {
				if (correlations[i] > correlations[maxIdx]) maxIdx = i;
			}
			return { lag: lags[maxIdx], correlation: correlations[maxIdx] };
		});

		// Peak within the visible x-axis range
		visiblePeak = $derived.by(() => {
			const { lags, correlations } = this.acfData;
			if (!lags || !correlations || lags.length < 2) return null;
			const [xMin, xMax] = this.parentPlot?.laglims ?? [0, Infinity];
			const visibleIndices = [];
			for (let i = 0; i < lags.length; i++) {
				// Skip lag=0 (index 0 when lags[0] === 0)
				if (i === 0 && lags[i] === 0) continue;
				if (lags[i] >= xMin && lags[i] <= xMax) visibleIndices.push(i);
			}
			if (visibleIndices.length === 0) return null;
			let maxIdx = visibleIndices[0];
			for (let i = 1; i < visibleIndices.length; i++) {
				if (correlations[visibleIndices[i]] > correlations[maxIdx]) maxIdx = visibleIndices[i];
			}
			return { lag: lags[maxIdx], correlation: correlations[maxIdx] };
		});

		dataWarnings = $derived.by(() => {
			const times = this.x?.hoursSinceStart ?? [];

			if (!times || times.length < 2) return [];

			const warnings = [];

			const validT = times
				.filter((v) => v !== null && v !== undefined && !isNaN(v))
				.sort((a, b) => a - b);

			const nanXCount = times.length - validT.length;
			if (nanXCount > 0) {
				warnings.push(
					`${nanXCount} missing time value${nanXCount > 1 ? 's' : ''} — excluded from the autocorrelation.`
				);
			}

			// Check for large gaps — lags coinciding with gaps have few pairs,
			// but the confidence bounds use total n and do not reflect this.
			if (validT.length > 1) {
				const diffs = [];
				for (let i = 1; i < validT.length; i++) diffs.push(validT[i] - validT[i - 1]);
				diffs.sort((a, b) => a - b);
				const medianDt = diffs[Math.floor(diffs.length / 2)];
				const maxGap = diffs[diffs.length - 1];
				if (maxGap > medianDt * 2) {
					warnings.push(
						`Data has gaps up to ${maxGap.toFixed(1)} h (typical interval: ${medianDt.toFixed(2)} h) — lags coinciding with gaps are estimated from few pairs, and the confidence bounds shown assume complete, evenly-spaced data.`
					);
				}
			}

			return warnings;
		});

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
			this.confidenceLine = new LineClass(dataIN?.confidenceLine, this);
			this.confidenceLine.stroke = dataIN?.confidenceLine?.stroke ?? '5,5';
			this.confidenceLine.strokeWidth = dataIN?.confidenceLine?.strokeWidth ?? 1;
			this.points = new PointsClass(dataIN?.points, this);
			this.maxLag = dataIN?.maxLag ?? null;
			this.showConfidenceBounds = dataIN?.showConfidenceBounds ?? true;
			this.confidenceLevel = dataIN?.confidenceLevel ?? 0.95;
		}

		toJSON() {
			return {
				x: this.x,
				y: this.y,
				line: this.line.toJSON(),
				confidenceLine: this.confidenceLine.toJSON(),
				points: this.points.toJSON(),
				maxLag: this.maxLag,
				showConfidenceBounds: this.showConfidenceBounds,
				confidenceLevel: this.confidenceLevel
			};
		}

		static fromJSON(json, parent) {
			return new CorrelogramDataclass(parent, {
				x: json.x,
				y: json.y,
				line: LineClass.fromJSON(json.line),
				confidenceLine: LineClass.fromJSON(json.confidenceLine),
				points: PointsClass.fromJSON(json.points),
				maxLag: json.maxLag,
				showConfidenceBounds: json.showConfidenceBounds,
				confidenceLevel: json.confidenceLevel
			});
		}
	}

	export class Correlogramclass {
		parentBox = $state();
		data = $state([]);
		padding = $state({ top: 15, right: 20, bottom: 30, left: 50 });
		plotheight = $derived(this.parentBox.height - this.padding.top - this.padding.bottom);
		plotwidth = $derived(this.parentBox.width - this.padding.left - this.padding.right);

		laglimsIN = $state([null, null]);
		laglims = $derived.by(() => {
			if (this.data.length === 0) return [0, 10];

			let maxLag = 0;
			for (const d of this.data) {
				const m = arrMax(d.acfData.lags);
				if (m != null && m > maxLag) maxLag = m;
			}

			return [
				this.laglimsIN[0] != null ? this.laglimsIN[0] : 0,
				this.laglimsIN[1] != null ? this.laglimsIN[1] : maxLag
			];
		});

		ylimsIN = $state([null, null]);
		ylims = $derived.by(() => {
			if (this.data.length === 0) {
				return [-1, 1];
			}

			const { min: mnRaw, max: mxRaw } = minMaxAcross(
				this.data.map((d) => d.acfData.correlations)
			);
			if (mnRaw == null || mxRaw == null) return [-1, 1];

			const range = mxRaw - mnRaw;
			const ymin = Math.max(mnRaw - range * 0.1, -1);
			const ymax = Math.min(mxRaw + range * 0.1, 1);

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
				label: dataIN?.xAxis?.label ?? 'Lag (hours)',
				gridlines: dataIN?.xAxis?.gridlines ?? true,
				nticks: dataIN?.xAxis?.nticks ?? 5
			});
			this.yAxis = new AxisClass({
				label: dataIN?.yAxis?.label ?? 'Autocorrelation',
				gridlines: dataIN?.yAxis?.gridlines ?? true,
				nticks: dataIN?.yAxis?.nticks ?? 5
			});
			if (dataIN) {
				this.addData(dataIN);
			}
		}

		getAutoScaleValues() {
			let axisWidths = { left: null, right: null, top: null, bottom: null };

			const plotElem = document.getElementById('plot' + this.parentBox.id);
			if (!plotElem) return axisWidths;

			const allLeftAxes = plotElem.getElementsByClassName('axis-left');
			if (allLeftAxes && allLeftAxes.length > 0) {
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

			const allRightAxes = plotElem.getElementsByClassName('axis-right');
			if (allRightAxes && allRightAxes.length > 0) {
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

			const allTopAxes = plotElem.getElementsByClassName('axis-top');
			if (allTopAxes && allTopAxes.length > 0) {
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

			const allBottomAxes = plotElem.getElementsByClassName('axis-bottom');
			if (allBottomAxes && allBottomAxes.length > 0) {
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
			const datum = new CorrelogramDataclass(this, dataIN);
			this.data.push(datum);
		}

		removeData(idx) {
			this.data.splice(idx, 1);
		}

		getDownloadData() {
			const headers = ['DataSeries', 'Lag (hours)', 'Autocorrelation'];
			const rows = [];
			this.data.forEach((datum, d) => {
				const acf = datum.acfData;
				for (let i = 0; i < acf.lags.length; i++) {
					rows.push([d, acf.lags[i], acf.correlations[i]]);
				}
			});
			return { headers, rows };
		}

		toJSON() {
			return {
				laglimsIN: this.laglimsIN,
				ylimsIN: this.ylimsIN,
				padding: this.padding,
				xAxis: this.xAxis.toJSON(),
				yAxis: this.yAxis.toJSON(),
				data: this.data
			};
		}

		static fromJSON(parent, json) {
			if (!json) {
				return new Correlogramclass(parent, null);
			}

			const correlogram = new Correlogramclass(parent, null);
			correlogram.padding = json.padding ?? json.paddingIN;
			correlogram.laglimsIN = json.laglimsIN || [null, null];
			correlogram.ylimsIN = json.ylimsIN;

			// Support both new AxisClass format and old individual properties
			if (json.xAxis) {
				correlogram.xAxis = AxisClass.fromJSON(json.xAxis);
			} else {
				correlogram.xAxis = new AxisClass({
					label: 'Lag (hours)',
					gridlines: json.xgridlines ?? true
				});
			}
			if (json.yAxis) {
				correlogram.yAxis = AxisClass.fromJSON(json.yAxis);
			} else {
				correlogram.yAxis = new AxisClass({
					label: 'Autocorrelation',
					gridlines: json.ygridlines ?? true
				});
			}

			if (json.data) {
				correlogram.data = json.data.map((d) => CorrelogramDataclass.fromJSON(d, correlogram));
			}
			return correlogram;
		}
	}

	export const definition = {
		defaultDataInputs: Correlogram_defaultDataInputs,
		controlHeaders: Correlogram_controlHeaders,
		plotClass: Correlogramclass
	};
</script>

<script>
	import { appState } from '$lib/core/core.svelte';
	import { onMount } from 'svelte';
	import { flip } from 'svelte/animate';
	import { slide } from 'svelte/transition';
	import { tick } from 'svelte';

	import Icon from '$lib/icons/Icon.svelte';
	import StoreValueButton from '$lib/components/inputs/StoreValueButton.svelte';

	let { theData, which } = $props();

	let tooltip = $state({ visible: false, x: 0, y: 0, content: '' });
	const handleTooltip = bindAltTooltipToggle(
		() => tooltip,
		(v) => {
			tooltip = v;
		}
	);

	let correlogramSiblings = $derived.by(() => {
		if (which !== 'plot' || !theData?.plot?.data) return [];
		return theData.plot.data
			.filter((d) => d.acfData?.lags?.length > 0 && d.acfData?.correlations?.length > 0)
			.map((d) => ({
				label: d.y?.name || '',
				colour: d.line?.colour || d.points?.colour || 'black',
				findYAt: (x) => findNearestY(d.acfData.lags, d.acfData.correlations, x)
			}));
	});

	onMount(() => {
		if (which == 'plot') {
			theData.plot.autoScalePadding('all');
		}
	});

	$effect(() => {
		if (which == 'controls') {
			theData.yAxis.label;
			theData.xAxis.label;
			theData.ylims;
			theData.laglims;
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
					<div style="display: flex; justify-content: flex-start; align-items: center; gap: 8px;">
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
					<div style="display: flex; justify-content: flex-start; align-items: center; gap: 8px;">
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
					<div style="display: flex; justify-content: flex-start; align-items: center; gap: 8px;">
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
					<div style="display: flex; justify-content: flex-start; align-items: center; gap: 8px;">
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
				<p>Y-Axis (Correlation)</p>
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
						min="-1"
						max="1"
						step="0.1"
						value={theData.ylimsIN[0] != null ? theData.ylimsIN[0] : theData.ylims[0]}
						onInput={(val) => {
							theData.ylimsIN[0] = parseFloat(val);
						}}
					/>
				</div>

				<div class="control-input">
					<p>Max</p>
					<NumberWithUnits
						min="-1"
						max="1"
						step="0.1"
						value={theData.ylimsIN[1] != null ? theData.ylimsIN[1] : theData.ylims[1]}
						onInput={(val) => {
							theData.ylimsIN[1] = parseFloat(val);
						}}
					/>
				</div>
			</div>
		</div>

		<Axis axisData={theData.yAxis} which="controls" title="Y-Axis Controls" />

		<div class="control-component">
			<div class="control-component-title">
				<p>X-Axis (Lag)</p>
				<div class="control-component-title-icons">
					<button class="icon" onclick={() => (theData.laglimsIN = [null, null])}>
						<Icon name="reset" width={14} height={14} className="control-component-title-icon" />
					</button>
				</div>
			</div>

			<div class="control-input-horizontal">
				<div class="control-input">
					<p>Min</p>
					<NumberWithUnits
						min="0"
						step="1"
						value={theData.laglimsIN[0] != null ? theData.laglimsIN[0] : theData.laglims[0]}
						onInput={(val) => {
							theData.laglimsIN[0] = parseFloat(val);
						}}
					/>
				</div>

				<div class="control-input">
					<p>Max</p>
					<NumberWithUnits
						step="1"
						value={theData.laglimsIN[1] != null ? theData.laglimsIN[1] : theData.laglims[1]}
						onInput={(val) => {
							theData.laglimsIN[1] = parseFloat(val);
						}}
					/>
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
							<p>Data {i}</p>
							<button class="icon" onclick={() => theData.removeData(i)}>
								<Icon
									name="minus"
									width={16}
									height={16}
									className="control-component-title-icon"
								/>
							</button>
						</div>

						<div class="control-data">
							<div class="control-input">
								<p>x (time)</p>
							</div>
							<Column col={datum.x} canChange={true} />
						</div>

						<div class="control-data">
							<div class="control-input">
								<p>y (values)</p>
							</div>
							<Column col={datum.y} canChange={true} />
						</div>

						<!--
						<div class="control-input">
							<p>Max Lag (hours)</p>
							<div style="display: flex; align-items: center; gap: 8px;">
								<NumberWithUnits
									min="1"
									step="1"
									placeholder="Auto (n/2)"
									value={datum.maxLag}
									onInput={(val) => {
										datum.maxLag = val ? parseFloat(val) : null;
									}}
									style="flex: 1;"
								/>
								{#if datum.maxLag != null}
									<button class="icon" onclick={() => (datum.maxLag = null)} title="Reset to auto">
										<Icon name="reset" width={14} height={14} />
									</button>
								{/if}
							</div>
							<p style="font-size: 0.8em; opacity: 0.7; margin-top: 4px;">
								{datum.acfData.lags.length} lag points
							</p>
						</div>
						-->

						{#if datum.dataWarnings && datum.dataWarnings.length > 0}
							<div class="data-warning">
								{#each datum.dataWarnings as warning}
									<p>⚠ {warning}</p>
								{/each}
							</div>
						{/if}

						{#if datum.visiblePeak}
							<p>
								<strong>Peak Lag: {datum.visiblePeak.lag.toFixed(2)} hrs</strong>
								<StoreValueButton
									label="Peak Lag"
									getter={() => datum.visiblePeak?.lag}
									defaultName={`correlogram_peak_lag_${datum.y?.name || 'data' + i}`}
									source="Correlogram"
								/>
							</p>
							<p>
								<strong>Peak Correlation: {datum.visiblePeak.correlation.toFixed(3)}</strong>
								<StoreValueButton
									label="Peak Correlation"
									getter={() => datum.visiblePeak?.correlation}
									defaultName={`correlogram_peak_correlation_${datum.y?.name || 'data' + i}`}
									source="Correlogram"
								/>
							</p>
							{#if datum.peak && Math.abs(datum.visiblePeak.lag - datum.peak.lag) > 0.001}
								<div class="data-warning">
									<p>
										⚠ Overall peak at {datum.peak.lag.toFixed(2)} hrs is outside the displayed range
									</p>
								</div>
							{/if}
						{:else if datum.peak}
							<p>
								<strong>Peak Lag: {datum.peak.lag.toFixed(2)} hrs</strong>
								<StoreValueButton
									label="Peak Lag"
									getter={() => datum.peak?.lag}
									defaultName={`correlogram_peak_lag_${datum.y?.name || 'data' + i}`}
									source="Correlogram"
								/>
							</p>
							<p>
								<strong>Peak Correlation: {datum.peak.correlation.toFixed(3)}</strong>
								<StoreValueButton
									label="Peak Correlation"
									getter={() => datum.peak?.correlation}
									defaultName={`correlogram_peak_correlation_${datum.y?.name || 'data' + i}`}
									source="Correlogram"
								/>
							</p>
						{/if}

						<Line lineData={datum.line} which="controls" title="Line" />
						<Points pointsData={datum.points} which="controls" />

						<Line lineData={datum.confidenceLine} which="controls" title="Confidence Bounds" />
						{#if datum.confidenceLine.draw}
							<div class="control-input">
								<p>Confidence Level</p>
								<select bind:value={datum.confidenceLevel}>
									<option value={0.95}>95%</option>
									<option value={0.99}>99%</option>
								</select>
							</div>
						{/if}

						<div class="div-line"></div>
					</div>
				{/each}
			</div>
		</div>
	{/if}
{/snippet}

{#snippet plot(theData)}
	<svg
		id={'plot' + theData.plot.parentBox.id}
		width={theData.plot.parentBox.width}
		height={theData.plot.parentBox.height}
		viewBox="0 0 {theData.plot.parentBox.width} {theData.plot.parentBox.height}"
		style="background: white; position: absolute;"
		ontooltip={handleTooltip}
	>
		<!-- Y Axis -->
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

		<!-- X Axis -->
		<Axis
			height={theData.plot.plotheight}
			width={theData.plot.plotwidth}
			scale={scaleLinear()
				.domain([theData.plot.laglims[0], theData.plot.laglims[1]])
				.range([0, theData.plot.plotwidth])}
			position="bottom"
			plotPadding={theData.plot.padding}
			axisData={theData.plot.xAxis}
			which="plot"
		/>

		<!-- Zero line -->
		{#if theData.plot.data.length > 0 && theData.plot.ylims[0] <= 0 && theData.plot.ylims[1] >= 0}
			<line
				x1={theData.plot.padding.left}
				y1={scaleLinear()
					.domain([theData.plot.ylims[0], theData.plot.ylims[1]])
					.range([theData.plot.plotheight, 0])(0) + theData.plot.padding.top}
				x2={theData.plot.padding.left + theData.plot.plotwidth}
				y2={scaleLinear()
					.domain([theData.plot.ylims[0], theData.plot.ylims[1]])
					.range([theData.plot.plotheight, 0])(0) + theData.plot.padding.top}
				stroke="#666"
				stroke-width="1"
				stroke-dasharray="4 2"
				opacity="0.5"
			/>
		{/if}

		<!-- Plot data -->
		{#each theData.plot.data as datum}
			<!-- Autocorrelation line and points -->
			<Line
				lineData={datum.line}
				x={datum.acfData.lags}
				y={datum.acfData.correlations}
				xscale={scaleLinear()
					.domain([theData.plot.laglims[0], theData.plot.laglims[1]])
					.range([0, theData.plot.plotwidth])}
				yscale={scaleLinear()
					.domain([theData.plot.ylims[0], theData.plot.ylims[1]])
					.range([theData.plot.plotheight, 0])}
				yoffset={theData.plot.padding.top}
				xoffset={theData.plot.padding.left}
				tooltip={true}
				dataLabel={datum.y.name || ''}
				dataColour={datum.line.colour}
				xLabel={theData.plot.xAxis.label || 'Lag (hours)'}
				yLabel={theData.plot.yAxis.label || 'Autocorrelation'}
				siblings={correlogramSiblings}
				which="plot"
			/>
			<Points
				pointsData={datum.points}
				x={datum.acfData.lags}
				y={datum.acfData.correlations}
				xscale={scaleLinear()
					.domain([theData.plot.laglims[0], theData.plot.laglims[1]])
					.range([0, theData.plot.plotwidth])}
				yscale={scaleLinear()
					.domain([theData.plot.ylims[0], theData.plot.ylims[1]])
					.range([theData.plot.plotheight, 0])}
				yoffset={theData.plot.padding.top}
				xoffset={theData.plot.padding.left}
				tooltip={true}
				dataLabel={datum.y.name || ''}
				dataColour={datum.points.colour}
				xLabel={theData.plot.xAxis.label || 'Lag (hours)'}
				yLabel={theData.plot.yAxis.label || 'Autocorrelation'}
				siblings={correlogramSiblings}
				which="plot"
			/>

			<!-- Confidence bounds -->
			{#if datum.showConfidenceBounds && datum.confidenceBounds}
				{@const upperBound = new Array(datum.acfData.lags.length).fill(
					datum.confidenceBounds.upper
				)}
				{@const lowerBound = new Array(datum.acfData.lags.length).fill(
					datum.confidenceBounds.lower
				)}

				<!-- Upper confidence bound -->
				<Line
					lineData={datum.confidenceLine}
					x={datum.acfData.lags}
					y={upperBound}
					xscale={scaleLinear()
						.domain([theData.plot.laglims[0], theData.plot.laglims[1]])
						.range([0, theData.plot.plotwidth])}
					yscale={scaleLinear()
						.domain([theData.plot.ylims[0], theData.plot.ylims[1]])
						.range([theData.plot.plotheight, 0])}
					yoffset={theData.plot.padding.top}
					xoffset={theData.plot.padding.left}
					which="plot"
				/>

				<!-- Lower confidence bound -->
				<Line
					lineData={datum.confidenceLine}
					x={datum.acfData.lags}
					y={lowerBound}
					xscale={scaleLinear()
						.domain([theData.plot.laglims[0], theData.plot.laglims[1]])
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
		<div class="tooltip" style="left: {tooltip.x}px; top: {tooltip.y}px;">
			{@html tooltip.content}
		</div>
	{/if}
{/snippet}

{#if which === 'plot'}
	{@render plot(theData)}
{:else if which === 'controls'}
	{@render controls(theData)}
{/if}
