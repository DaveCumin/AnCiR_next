<script module>
	import { Column as ColumnClass } from '$lib/core/Column.svelte';
	import Column from '$lib/core/Column.svelte';
	import Axis, { AxisClass } from '$lib/components/plotbits/Axis.svelte';
	import { scaleLinear, scaleLog } from 'd3-scale';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';

	import Line, { LineClass } from '$lib/components/plotbits/Line.svelte';
	import Points, { PointsClass } from '$lib/components/plotbits/Points.svelte';
	import { dataSettingsScrollTo } from '$lib/components/views/ControlDisplay.svelte';
	import { computeFFT } from '$lib/utils/fft.js';
	import { minMax, minMaxAcross, max as arrMax } from '$lib/utils/stats.js';
	import {
		findNearestY,
		bindAltTooltipToggle
	} from '$lib/components/plotbits/helpers/tooltipHelpers.js';

	export const FFT_defaultDataInputs = ['time', 'values'];
	export const FFT_controlHeaders = ['Properties', 'Data'];
	export const FFT_displayName = 'Fourier analysis';

	class FFTDataclass {
		parentPlot = $state();
		x = $state();
		y = $state();
		showPhase = $state(false);
		freqStep = $state(null); // null = auto, otherwise custom step size in cycles/hr

		line = $state();
		points = $state();
		phaseLine = $state();

		fftData = $derived.by(() => {
			const times = this.x.hoursSinceStart;
			const values = this.y.getData();
			return computeFFT(times, values, this.freqStep);
		});

		// Peak detection - find the highest magnitude across ALL calculated data
		peak = $derived.by(() => {
			const { frequencies, magnitudes } = this.fftData;
			if (!frequencies || !magnitudes || frequencies.length === 0) return null;
			let maxIdx = 0;
			for (let i = 1; i < magnitudes.length; i++) {
				if (magnitudes[i] > magnitudes[maxIdx]) maxIdx = i;
			}
			const freq = frequencies[maxIdx];
			return {
				frequency: freq,
				period: freq !== 0 ? 1 / freq : null,
				magnitude: magnitudes[maxIdx]
			};
		});

		// Peak within the visible x-axis range
		visiblePeak = $derived.by(() => {
			const { frequencies, magnitudes } = this.fftData;
			if (!frequencies || !magnitudes || frequencies.length === 0) return null;
			const showPeriod = this.parentPlot?.showPeriod ?? false;
			const [xMin, xMax] = this.parentPlot?.xlims ?? [0, Infinity];
			const visibleIndices = [];
			for (let i = 0; i < frequencies.length; i++) {
				const xVal = showPeriod
					? frequencies[i] !== 0
						? 1 / frequencies[i]
						: null
					: frequencies[i];
				if (xVal != null && xVal >= xMin && xVal <= xMax) visibleIndices.push(i);
			}
			if (visibleIndices.length === 0) return null;
			let maxIdx = visibleIndices[0];
			for (let i = 1; i < visibleIndices.length; i++) {
				if (magnitudes[visibleIndices[i]] > magnitudes[maxIdx]) maxIdx = visibleIndices[i];
			}
			const freq = frequencies[maxIdx];
			return {
				frequency: freq,
				period: freq !== 0 ? 1 / freq : null,
				magnitude: magnitudes[maxIdx]
			};
		});

		dataWarnings = $derived.by(() => {
			const times = this.x?.hoursSinceStart ?? [];
			const values = this.y?.getData() ?? [];

			if (!times || times.length < 2) return [];

			const warnings = [];

			const nanXCount = times.filter((v) => v === null || v === undefined || isNaN(v)).length;
			if (nanXCount > 0) {
				warnings.push(
					`${nanXCount} missing time value${nanXCount > 1 ? 's' : ''} — excluded before the FFT; the sampling rate is recalculated from the remaining span and may be inaccurate.`
				);
			}

			const nanYCount = values.filter((v) => v === null || v === undefined || isNaN(v)).length;
			if (nanYCount > 0) {
				warnings.push(
					`${nanYCount} missing y value${nanYCount > 1 ? 's' : ''} — excluded before the FFT; these are not zero-padded at their original positions, which may introduce spectral artefacts.`
				);
			}

			// Check for irregular spacing — FFT assumes uniform sampling
			const validT = times
				.filter((v) => v !== null && v !== undefined && !isNaN(v))
				.sort((a, b) => a - b);
			if (validT.length > 1) {
				const diffs = [];
				for (let i = 1; i < validT.length; i++) diffs.push(validT[i] - validT[i - 1]);
				diffs.sort((a, b) => a - b);
				const medianDt = diffs[Math.floor(diffs.length / 2)];
				const maxGap = diffs[diffs.length - 1];
				if (maxGap > medianDt * 1.5) {
					warnings.push(
						`Data has gaps up to ${maxGap.toFixed(1)} h (typical interval: ${medianDt.toFixed(2)} h) — the FFT assumes uniform sampling; the frequency axis and Nyquist frequency will be incorrect.`
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
			this.phaseLine = new LineClass(dataIN?.phaseLine, this);
			this.points = new PointsClass(dataIN?.points, this);
			this.phasePoints = new PointsClass(dataIN?.phasePoints, this);
			this.showPhase = dataIN?.showPhase ?? false;
			this.freqStep = dataIN?.freqStep ?? 0.001;
		}

		toJSON() {
			return {
				x: this.x,
				y: this.y,
				line: this.line.toJSON(),
				phaseLine: this.phaseLine.toJSON(),
				phasePoints: this.phasePoints.toJSON(),
				points: this.points.toJSON(),
				showPhase: this.showPhase,
				freqStep: this.freqStep
			};
		}

		static fromJSON(json, parent) {
			return new FFTDataclass(parent, {
				x: json.x,
				y: json.y,
				line: LineClass.fromJSON(json.line),
				phaseLine: LineClass.fromJSON(json.phaseLine),
				phasePoints: PointsClass.fromJSON(json.phasePoints),
				points: PointsClass.fromJSON(json.points),
				showPhase: json.showPhase,
				freqStep: json.freqStep
			});
		}
	}

	export class FFTclass {
		parentBox = $state();
		data = $state([]);
		padding = $state({ top: 15, right: 20, bottom: 30, left: 50 });
		plotheight = $derived(this.parentBox.height - this.padding.top - this.padding.bottom);
		plotwidth = $derived(this.parentBox.width - this.padding.left - this.padding.right);

		showPeriod = $state(false); // Toggle between frequency and period
		xlimsIN = $state([null, null]);

		// Get max frequency and min period from data
		nyquistFreqs = $derived.by(() => this.data.map((d) => d.fftData.nyquistFreq || 0));
		validFreqs = $derived.by(() =>
			this.data.flatMap((d) => d.fftData.frequencies.filter((f) => f > 0))
		);

		maxFrequency = $derived.by(() => {
			if (this.data.length === 0) return 1; // sane default for empty plot
			return arrMax(this.nyquistFreqs) ?? 1;
		});

		minPeriod = $derived.by(() => {
			if (this.data.length === 0) return 0.1;
			return arrMax(this.data.map((d) => d.fftData.minPeriod || 0.1)) ?? 0.1;
		});

		xlims = $derived.by(() => {
			const showPeriod = this.showPeriod;

			const data = this.data;
			const validFreqs = this.validFreqs;
			const minPeriod = this.minPeriod;
			const maxFrequency = this.maxFrequency;

			//console.log('showPeriod:', $state.snapshot(this.showPeriod));
			//console.log('xlimsIN:', $state.snapshot(this.xlimsIN));

			if (data.length === 0) {
				return showPeriod ? [0.1, 100] : [0, 1];
			}

			let defMin, defMax;

			if (showPeriod) {
				const freqs = validFreqs;
				if (freqs.length === 0) {
					defMin = minPeriod;
					defMax = 100;
				} else {
					const { min: minF, max: maxF } = minMax(freqs);
					if (minF == null || maxF == null) {
						defMin = minPeriod;
						defMax = 100;
					} else {
						defMin = Math.max(1 / maxF, minPeriod);
						defMax = 1 / minF;
					}
				}
			} else {
				defMin = 0;
				defMax = maxFrequency;
			}

			const [userMin, userMax] = this.xlimsIN;

			return [
				userMin != null
					? showPeriod
						? Math.max(userMin, minPeriod)
						: Math.max(userMin, 0)
					: defMin,

				userMax != null ? (showPeriod ? userMax : Math.min(userMax, maxFrequency)) : defMax
			];
		});

		ylimsIN = $state([null, null]);
		ylims = $derived.by(() => {
			if (this.data.length === 0) {
				return [0, 1];
			}

			const { min: mnRaw, max: mxRaw } = minMaxAcross(
				this.data.map((d) => d.fftData.magnitudes)
			);
			if (mnRaw == null || mxRaw == null) return [0, 1];
			const range = mxRaw - mnRaw;
			const ymin = Math.max(mnRaw - range * 0.1, 0);
			const ymax = mxRaw + range * 0.1;

			return [
				this.ylimsIN[0] != null ? this.ylimsIN[0] : ymin,
				this.ylimsIN[1] != null ? this.ylimsIN[1] : ymax
			];
		});

		phaseYlimsIN = $state([null, null]);
		phaseYlims = $derived.by(() => {
			// Check if any data has showPhase enabled
			const hasPhase = this.data.some((d) => d.showPhase);
			if (!hasPhase) return [-Math.PI, Math.PI];

			const { min: mnRaw, max: mxRaw } = minMaxAcross(
				this.data.filter((d) => d.showPhase).map((d) => d.fftData.phases)
			);

			// Default to -π to π if no valid data
			if (mnRaw == null || mxRaw == null) return [-Math.PI, Math.PI];

			const range = mxRaw - mnRaw;
			let ymin = mnRaw - range * 0.1;
			let ymax = mxRaw + range * 0.1;

			return [
				this.phaseYlimsIN[0] != null ? this.phaseYlimsIN[0] : ymin,
				this.phaseYlimsIN[1] != null ? this.phaseYlimsIN[1] : ymax
			];
		});

		logScale = $state(false);
		xAxis = $state();
		yAxisMag = $state();
		yAxisPhase = $state();

		constructor(parent, dataIN) {
			this.parentBox = parent;
			this.xAxis = new AxisClass({
				label: dataIN?.xAxis?.label ?? 'Frequency',
				gridlines: dataIN?.xAxis?.gridlines ?? true,
				nticks: dataIN?.xAxis?.nticks ?? 5
			});
			this.yAxisMag = new AxisClass({
				label: dataIN?.yAxisMag?.label ?? 'Magnitude',
				gridlines: dataIN?.yAxisMag?.gridlines ?? true,
				nticks: dataIN?.yAxisMag?.nticks ?? 5
			});
			this.yAxisPhase = new AxisClass({
				label: dataIN?.yAxisPhase?.label ?? 'Phase (radians)',
				gridlines: dataIN?.yAxisPhase?.gridlines ?? false,
				nticks: dataIN?.yAxisPhase?.nticks ?? 5
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
			const datum = new FFTDataclass(this, dataIN);
			this.data.push(datum);
		}

		removeData(idx) {
			this.data.splice(idx, 1);
		}

		getDownloadData() {
			const hasPhase = this.data.some((d) => d.showPhase);
			const headers = ['DataSeries', 'Frequency (cycles/hr)', 'Period (hours)', 'Magnitude'];
			if (hasPhase) headers.push('Phase (radians)');
			const rows = [];
			this.data.forEach((datum, d) => {
				const fft = datum.fftData;
				for (let i = 0; i < fft.frequencies.length; i++) {
					const freq = fft.frequencies[i];
					const row = [d, freq, freq !== 0 ? 1 / freq : '', fft.magnitudes[i]];
					if (hasPhase) {
						row.push(fft.phases?.[i] ?? '');
					}
					rows.push(row);
				}
			});
			return { headers, rows };
		}

		toJSON() {
			return {
				xlimsIN: this.xlimsIN,
				ylimsIN: this.ylimsIN,
				padding: this.padding,
				xAxis: this.xAxis.toJSON(),
				yAxisMag: this.yAxisMag.toJSON(),
				yAxisPhase: this.yAxisPhase.toJSON(),
				logScale: this.logScale,
				showPeriod: this.showPeriod,
				data: this.data
			};
		}

		static fromJSON(parent, json) {
			if (!json) {
				return new FFTclass(parent, null);
			}

			const fft = new FFTclass(parent, null);
			fft.padding = json.padding ?? json.paddingIN;
			fft.freqlimsIN = json.freqlimsIN;
			fft.xlimsIN = json.xlimsIN || [null, null];
			fft.ylimsIN = json.ylimsIN;
			fft.logScale = json.logScale ?? false;
			fft.showPeriod = json.showPeriod ?? false;

			// Support both new AxisClass format and old individual properties
			if (json.xAxis) {
				fft.xAxis = AxisClass.fromJSON(json.xAxis);
			} else {
				fft.xAxis = new AxisClass({ label: 'Frequency', gridlines: json.xgridlines ?? true });
			}
			if (json.yAxisMag) {
				fft.yAxisMag = AxisClass.fromJSON(json.yAxisMag);
			} else {
				fft.yAxisMag = new AxisClass({ label: 'Magnitude', gridlines: json.ygridlines ?? true });
			}
			if (json.yAxisPhase) {
				fft.yAxisPhase = AxisClass.fromJSON(json.yAxisPhase);
			} else {
				fft.yAxisPhase = new AxisClass({ label: 'Phase (radians)', gridlines: false });
			}

			if (json.data) {
				fft.data = json.data.map((d) => FFTDataclass.fromJSON(d, fft));
			}
			return fft;
		}
	}

	export const definition = {
		displayName: FFT_displayName,
		defaultDataInputs: FFT_defaultDataInputs,
		controlHeaders: FFT_controlHeaders,
		plotClass: FFTclass
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

	// Helpers to build the x/y arrays used for tooltip lookups (accounts for
	// showPeriod filtering so the hovered x matches the drawn data).
	function buildFFTxy(datum, showPeriod, which) {
		const freqs = datum.fftData.frequencies;
		const vals =
			which === 'phase' ? datum.fftData.phases : datum.fftData.magnitudes;
		if (!freqs || !vals) return { x: [], y: [] };
		if (showPeriod) {
			const x = [];
			const y = [];
			for (let i = 0; i < freqs.length; i++) {
				if (freqs[i] > 0) {
					x.push(1 / freqs[i]);
					y.push(vals[i]);
				}
			}
			return { x, y };
		}
		return { x: freqs, y: vals };
	}

	let fftMagnitudeSiblings = $derived.by(() => {
		if (which !== 'plot' || !theData?.plot?.data) return [];
		const showPeriod = theData.plot.showPeriod;
		return theData.plot.data
			.filter((d) => d.fftData?.frequencies?.length > 0)
			.map((d) => {
				const { x, y } = buildFFTxy(d, showPeriod, 'mag');
				return {
					label: d.y?.name || '',
					colour: d.line?.colour || d.points?.colour || 'black',
					findYAt: (xVal) => findNearestY(x, y, xVal)
				};
			});
	});

	let fftPhaseSiblings = $derived.by(() => {
		if (which !== 'plot' || !theData?.plot?.data) return [];
		const showPeriod = theData.plot.showPeriod;
		return theData.plot.data
			.filter((d) => d.showPhase && d.fftData?.frequencies?.length > 0)
			.map((d) => {
				const { x, y } = buildFFTxy(d, showPeriod, 'phase');
				return {
					label: d.y?.name ? d.y.name + ' (phase)' : 'Phase',
					colour: d.phaseLine?.colour || d.phasePoints?.colour || 'black',
					findYAt: (xVal) => findNearestY(x, y, xVal)
				};
			});
	});

	onMount(() => {
		if (which == 'plot') {
			theData.plot.autoScalePadding('all');
		}
	});

	$effect(() => {
		if (which == 'controls') {
			theData.yAxisMag.label;
			theData.xAxis.label;
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
				<p>Y-Axis (Magnitude)</p>
				<div class="control-component-title-icons">
					<button class="icon" onclick={() => (theData.ylimsIN = [null, null])}>
						<Icon name="reset" width={14} height={14} className="control-component-title-icon" />
					</button>
				</div>
			</div>

			<div class="control-input-vertical">
				<div class="control-input-checkbox">
					<input type="checkbox" bind:checked={theData.logScale} />
					<p>Log Scale</p>
				</div>
			</div>

			<div class="control-input-horizontal">
				<div class="control-input">
					<p>Min</p>
					<NumberWithUnits
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
						step="0.1"
						value={theData.ylimsIN[1] != null ? theData.ylimsIN[1] : theData.ylims[1]}
						onInput={(val) => {
							theData.ylimsIN[1] = parseFloat(val);
						}}
					/>
				</div>
			</div>
		</div>

		<Axis axisData={theData.yAxisMag} which="controls" title="Y-Axis (Magnitude) Controls" />

		{#if theData.data.some((d) => d.showPhase)}
			<div class="control-component">
				<div class="control-component-title">
					<p>Y-Axis (Phase)</p>
					<div class="control-component-title-icons">
						<button class="icon" onclick={() => (theData.phaseYlimsIN = [null, null])}>
							<Icon name="reset" width={14} height={14} className="control-component-title-icon" />
						</button>
					</div>
				</div>

				<div class="control-input-horizontal">
					<div class="control-input">
						<p>Min</p>
						<NumberWithUnits
							step="0.1"
							value={theData.phaseYlimsIN[0] != null
								? theData.phaseYlimsIN[0]
								: theData.phaseYlims[0]}
							onInput={(val) => {
								theData.phaseYlimsIN[0] = parseFloat(val);
							}}
						/>
					</div>

					<div class="control-input">
						<p>Max</p>
						<NumberWithUnits
							step="0.1"
							value={theData.phaseYlimsIN[1] != null
								? theData.phaseYlimsIN[1]
								: theData.phaseYlims[1]}
							onInput={(val) => {
								theData.phaseYlimsIN[1] = parseFloat(val);
							}}
						/>
					</div>
				</div>
			</div>

			<Axis axisData={theData.yAxisPhase} which="controls" title="Y-Axis (Phase) Controls" />
		{/if}

		<div class="control-component">
			<div class="control-component-title">
				<p>X-Axis</p>
				<div class="control-component-title-icons">
					<button class="icon" onclick={() => (theData.xlimsIN = [null, null])}>
						<Icon name="reset" width={14} height={14} className="control-component-title-icon" />
					</button>
				</div>
			</div>

			<div class="control-input-vertical">
				<div class="control-input-checkbox">
					<input
						type="checkbox"
						bind:checked={theData.showPeriod}
						onchange={(e) =>
							(theData.xlimsIN = [
								theData.xlimsIN[0] > 0 ? 1 / theData.xlimsIN[0] : this.minPeriod,
								1 / theData.xlimsIN[1]
							])}
					/>
					<p>Show as Period (hours)</p>
				</div>
			</div>

			<div class="control-input-horizontal">
				<div class="control-input">
					<p>
						Min {#if theData.showPeriod}
							( {theData.minPeriod.toFixed(3)}){/if}
					</p>

					<NumberWithUnits
						min={theData.showPeriod ? theData.minPeriod : 0}
						step="0.1"
						value={theData.xlimsIN[0]}
						onInput={(val) => {
							theData.xlimsIN[0] = parseFloat(val);
						}}
					/>
				</div>

				<div class="control-input">
					<p>
						Max {#if !theData.showPeriod}({theData.maxFrequency.toFixed(3)}){/if}
					</p>

					<NumberWithUnits
						max={theData.showPeriod ? 1000 : theData.maxFrequency}
						step={theData.showPeriod ? '1' : '0.01'}
						value={theData.xlimsIN[1]}
						onInput={(val) => {
							theData.xlimsIN[1] = parseFloat(val);
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
								<p>y (Values)</p>
							</div>
							<Column col={datum.y} canChange={true} />
						</div>

						<div class="control-input-vertical">
							<div class="control-input-checkbox">
								<input type="checkbox" bind:checked={datum.showPhase} />
								<p>Show Phase</p>
							</div>
						</div>

						<div class="control-input">
							<p>Frequency Step</p>
							<div style="display: flex; align-items: center; gap: 8px;">
								<NumberWithUnits
									min="0.0001"
									step="0.0001"
									placeholder="Auto"
									value={datum.freqStep}
									onInput={(val) => {
										datum.freqStep = val ? parseFloat(val) : null;
									}}
									style="flex: 1;"
								/>
								{#if datum.freqStep != null}
									<button
										class="icon"
										onclick={() => (datum.freqStep = null)}
										title="Reset to auto"
									>
										<Icon name="reset" width={14} height={14} />
									</button>
								{/if}
							</div>
							<p style="font-size: 0.8em; opacity: 0.7; margin-top: 4px;">
								{#if datum.freqStep}
									≈{Math.floor((datum.fftData.nyquistFreq || 1) / datum.freqStep)} points
								{:else}
									Auto: {datum.fftData.frequencies.length} points
								{/if}
							</p>
						</div>

						{#if datum.dataWarnings && datum.dataWarnings.length > 0}
							<div class="data-warning">
								{#each datum.dataWarnings as warning}
									<p>⚠ {warning}</p>
								{/each}
							</div>
						{/if}

						{#if datum.visiblePeak}
							{#if datum.visiblePeak.period != null}
								<p>
									<strong>Peak Period: {datum.visiblePeak.period.toFixed(2)} hrs</strong>
									<StoreValueButton
										label="Peak Period"
										getter={() => datum.visiblePeak?.period}
										defaultName={`fft_peak_period_${datum.y?.name || 'data' + i}`}
										source="FFT"
									/>
								</p>
							{/if}
							<p>
								<strong>Peak Frequency: {datum.visiblePeak.frequency.toFixed(4)} cycles/hr</strong>
								<StoreValueButton
									label="Peak Frequency"
									getter={() => datum.visiblePeak?.frequency}
									defaultName={`fft_peak_frequency_${datum.y?.name || 'data' + i}`}
									source="FFT"
								/>
							</p>
							<p>
								<strong>Peak Magnitude: {datum.visiblePeak.magnitude.toFixed(2)}</strong>
								<StoreValueButton
									label="Peak Magnitude"
									getter={() => datum.visiblePeak?.magnitude}
									defaultName={`fft_peak_magnitude_${datum.y?.name || 'data' + i}`}
									source="FFT"
								/>
							</p>
							{#if datum.peak && Math.abs(datum.visiblePeak.frequency - datum.peak.frequency) > 0.000001}
								<div class="data-warning">
									<p>
										⚠ Overall peak at {datum.peak.period != null
											? datum.peak.period.toFixed(2) + ' hrs / '
											: ''}{datum.peak.frequency.toFixed(4)} cycles/hr is outside the displayed range
									</p>
								</div>
							{/if}
						{:else if datum.peak}
							{#if datum.peak.period != null}
								<p>
									<strong>Peak Period: {datum.peak.period.toFixed(2)} hrs</strong>
									<StoreValueButton
										label="Peak Period"
										getter={() => datum.peak?.period}
										defaultName={`fft_peak_period_${datum.y?.name || 'data' + i}`}
										source="FFT"
									/>
								</p>
							{/if}
							<p>
								<strong>Peak Frequency: {datum.peak.frequency.toFixed(4)} cycles/hr</strong>
								<StoreValueButton
									label="Peak Frequency"
									getter={() => datum.peak?.frequency}
									defaultName={`fft_peak_frequency_${datum.y?.name || 'data' + i}`}
									source="FFT"
								/>
							</p>
							<p>
								<strong>Peak Magnitude: {datum.peak.magnitude.toFixed(2)}</strong>
								<StoreValueButton
									label="Peak Magnitude"
									getter={() => datum.peak?.magnitude}
									defaultName={`fft_peak_magnitude_${datum.y?.name || 'data' + i}`}
									source="FFT"
								/>
							</p>
						{/if}

						<Line lineData={datum.line} which="controls" title="Magnitude" />
						<Points pointsData={datum.points} which="controls" />
						{#if datum.showPhase}
							<Line lineData={datum.phaseLine} which="controls" title="Phase" />
							<Points pointsData={datum.phasePoints} which="controls" />
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
		{#key `${theData.plot.logScale}-${theData.plot.showPeriod}-${theData.plot.data.some((d) => d.showPhase)}`}
			{@const hasPhase = theData.plot.data.some((d) => d.showPhase)}
			{@const yScale = theData.plot.logScale
				? scaleLog()
						.domain([Math.max(theData.plot.ylims[0], 1e-6), theData.plot.ylims[1]])
						.range([theData.plot.plotheight, 0])
				: scaleLinear()
						.domain([theData.plot.ylims[0], theData.plot.ylims[1]])
						.range([theData.plot.plotheight, 0])}

			{@const phaseYScale = scaleLinear()
				.domain([theData.plot.phaseYlims[0], theData.plot.phaseYlims[1]])
				.range([theData.plot.plotheight, 0])}

			{@const xScale = scaleLinear()
				.domain([theData.plot.xlims[0], theData.plot.xlims[1]])
				.range([0, theData.plot.plotwidth])}
			<!-- Y Axis (Magnitude) -->
			<Axis
				height={theData.plot.plotheight}
				width={theData.plot.plotwidth}
				scale={yScale}
				position="left"
				plotPadding={theData.plot.padding}
				axisData={theData.plot.yAxisMag}
				which="plot"
			/>

			<!-- Y Axis (Phase) - on right side if any data shows phase -->
			{#if hasPhase}
				<Axis
					height={theData.plot.plotheight}
					width={theData.plot.plotwidth}
					scale={phaseYScale}
					position="right"
					plotPadding={theData.plot.padding}
					axisData={theData.plot.yAxisPhase}
					which="plot"
				/>
			{/if}

			<!-- X Axis -->
			<Axis
				height={theData.plot.plotheight}
				width={theData.plot.plotwidth}
				scale={xScale}
				position="bottom"
				plotPadding={theData.plot.padding}
				axisData={theData.plot.xAxis}
				which="plot"
			/>

			<!-- Plot data -->
			{#each theData.plot.data as datum}
				{@const xData = theData.plot.showPeriod
					? datum.fftData.frequencies.filter((f) => f > 0).map((f) => 1 / f)
					: datum.fftData.frequencies}
				{@const yData = theData.plot.showPeriod
					? datum.fftData.magnitudes.filter((_, i) => datum.fftData.frequencies[i] > 0)
					: datum.fftData.magnitudes}
				{@const phaseData = theData.plot.showPeriod
					? datum.fftData.phases.filter((_, i) => datum.fftData.frequencies[i] > 0)
					: datum.fftData.phases}

				<!-- Magnitude Line and Points -->
				<Line
					lineData={datum.line}
					x={xData}
					y={yData}
					xscale={xScale}
					yscale={yScale}
					yoffset={theData.plot.padding.top}
					xoffset={theData.plot.padding.left}
					tooltip={true}
					dataLabel={datum.y.name || ''}
					dataColour={datum.line.colour}
					xLabel={theData.plot.xAxis.label || 'Frequency'}
					yLabel={theData.plot.yAxisMag.label || 'Magnitude'}
					siblings={fftMagnitudeSiblings}
					which="plot"
				/>
				<Points
					pointsData={datum.points}
					x={xData}
					y={yData}
					xscale={xScale}
					yscale={yScale}
					yoffset={theData.plot.padding.top}
					xoffset={theData.plot.padding.left}
					tooltip={true}
					dataLabel={datum.y.name || ''}
					dataColour={datum.points.colour}
					xLabel={theData.plot.xAxis.label || 'Frequency'}
					yLabel={theData.plot.yAxisMag.label || 'Magnitude'}
					siblings={fftMagnitudeSiblings}
					which="plot"
				/>

				<!-- Phase Line (if enabled) -->
				{#if datum.showPhase}
					<Line
						lineData={datum.phaseLine}
						x={xData}
						y={phaseData}
						xscale={xScale}
						yscale={phaseYScale}
						yoffset={theData.plot.padding.top}
						xoffset={theData.plot.padding.left}
						tooltip={true}
						dataLabel={datum.y.name ? datum.y.name + ' (phase)' : 'Phase'}
						dataColour={datum.phaseLine.colour}
						xLabel={theData.plot.xAxis.label || 'Frequency'}
						yLabel={theData.plot.yAxisPhase.label || 'Phase (radians)'}
						siblings={fftPhaseSiblings}
						which="plot"
					/>
					<Points
						pointsData={datum.phasePoints}
						x={xData}
						y={phaseData}
						xscale={xScale}
						yscale={phaseYScale}
						yoffset={theData.plot.padding.top}
						xoffset={theData.plot.padding.left}
						tooltip={true}
						dataLabel={datum.y.name ? datum.y.name + ' (phase)' : 'Phase'}
						dataColour={datum.phasePoints.colour}
						xLabel={theData.plot.xAxis.label || 'Frequency'}
						yLabel={theData.plot.yAxisPhase.label || 'Phase (radians)'}
						siblings={fftPhaseSiblings}
						which="plot"
					/>
				{/if}
			{/each}
		{/key}
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
