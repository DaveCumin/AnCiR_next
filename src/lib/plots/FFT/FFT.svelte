<script module>
	import { Column as ColumnClass } from '$lib/core/Column.svelte';
	import Column from '$lib/core/Column.svelte';
	import Axis from '$lib/components/plotBits/Axis.svelte';
	import { scaleLinear, scaleLog } from 'd3-scale';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';

	import { mean } from '$lib/components/plotBits/helpers/wrangleData.js';

	import Line, { LineClass } from '$lib/components/plotBits/Line.svelte';
	import Points, { PointsClass } from '$lib/components/plotBits/Points.svelte';
	import { dataSettingsScrollTo } from '$lib/components/views/ControlDisplay.svelte';

	export const FFT_defaultDataInputs = ['time', 'values'];
	export const FFT_controlHeaders = ['Properties', 'Data'];

	// FFT implementation using Cooley-Tukey algorithm
	function fft(signal) {
		const n = signal.length;
		if (n <= 1) return signal;

		const even = fft(signal.filter((_, i) => i % 2 === 0));
		const odd = fft(signal.filter((_, i) => i % 2 === 1));

		const result = new Array(n);
		for (let k = 0; k < n / 2; k++) {
			const angle = (-2 * Math.PI * k) / n;
			const t = {
				re: Math.cos(angle) * odd[k].re - Math.sin(angle) * odd[k].im,
				im: Math.cos(angle) * odd[k].im + Math.sin(angle) * odd[k].re
			};

			result[k] = {
				re: even[k].re + t.re,
				im: even[k].im + t.im
			};
			result[k + n / 2] = {
				re: even[k].re - t.re,
				im: even[k].im - t.im
			};
		}
		return result;
	}

	function computeFFT(times, values, freqStep = null) {
		if (
			!times ||
			!values ||
			times.length < 2 ||
			values.length < 2 ||
			times.length !== values.length
		) {
			return {
				frequencies: [],
				magnitudes: [],
				phases: [],
				samplingRate: 0,
				nyquistFreq: 0,
				minPeriod: 0
			};
		}

		const validIndices = times
			.map((t, i) => (isNaN(t) || isNaN(values[i]) ? -1 : i))
			.filter((i) => i !== -1);

		if (validIndices.length === 0) {
			return {
				frequencies: [],
				magnitudes: [],
				phases: [],
				samplingRate: 0,
				nyquistFreq: 0,
				minPeriod: 0
			};
		}

		const t = validIndices.map((i) => times[i]);
		const y = validIndices.map((i) => values[i]);

		const yMean = mean(y);
		const yDetrended = y.map((val) => val - yMean);

		// Calculate sampling rate (times are in hours)
		const dt = t.length > 1 ? (t[t.length - 1] - t[0]) / (t.length - 1) : 1;
		const samplingRate = 1 / dt; // (cycles per hour)
		const nyquistFreq = samplingRate / 2;
		const minPeriod = 2 * dt; // hours

		// Determine target number of points
		let n;
		if (freqStep && freqStep > 0) {
			// Calculate n to achieve desired frequency step
			// freqStep = samplingRate / n  =>  n = samplingRate / freqStep
			n = Math.ceil(samplingRate / freqStep);
			// Round up to next power of 2 for efficiency
			n = Math.pow(2, Math.ceil(Math.log2(n)));
		} else {
			// Default: just use next power of 2
			n = Math.pow(2, Math.ceil(Math.log2(yDetrended.length)));
		}
		// Safety check: ensure n is at least as large as yDetrended.length
		if (n < yDetrended.length) {
			n = Math.pow(2, Math.ceil(Math.log2(yDetrended.length)));
		}
		const padded = [...yDetrended, ...new Array(n - yDetrended.length).fill(0)];
		const signal = padded.map((val) => ({ re: val, im: 0 }));

		const fftResult = fft(signal);

		const halfN = Math.floor(n / 2);
		const frequencies = [];
		const magnitudes = [];
		const phases = [];

		for (let i = 1; i < halfN; i++) {
			// Start from 1 to skip DC component
			const freq = (i * samplingRate) / n;
			if (freq > nyquistFreq) break; // Don't go beyond Nyquist
			frequencies.push(freq);
			const magnitude = (Math.sqrt(fftResult[i].re ** 2 + fftResult[i].im ** 2) * 2) / n;
			magnitudes.push(magnitude);
			phases.push(Math.atan2(fftResult[i].im, fftResult[i].re));
		}

		return { frequencies, magnitudes, phases, samplingRate, nyquistFreq, minPeriod };
	}

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
			return Math.max(...this.nyquistFreqs);
		});

		minPeriod = $derived.by(() => {
			if (this.data.length === 0) return 0.1;
			return Math.max(...this.data.map((d) => d.fftData.minPeriod || 0.1));
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
					const minF = Math.min(...freqs);
					const maxF = Math.max(...freqs);
					defMin = Math.max(1 / maxF, minPeriod);
					defMax = 1 / minF;
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

			let ymin = Infinity;
			let ymax = -Infinity;
			this.data.forEach((d) => {
				if (d.fftData.magnitudes.length > 0) {
					ymin = Math.min(ymin, Math.min(...d.fftData.magnitudes));
					ymax = Math.max(ymax, Math.max(...d.fftData.magnitudes));
				}
			});

			const range = ymax - ymin;
			ymin = Math.max(ymin - range * 0.1, 0);
			ymax = ymax + range * 0.1;

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

			let ymin = Infinity;
			let ymax = -Infinity;
			this.data.forEach((d) => {
				if (d.showPhase && d.fftData.phases.length > 0) {
					ymin = Math.min(ymin, Math.min(...d.fftData.phases));
					ymax = Math.max(ymax, Math.max(...d.fftData.phases));
				}
			});

			// Default to -π to π if no valid data
			if (ymin === Infinity) return [-Math.PI, Math.PI];

			const range = ymax - ymin;
			ymin = ymin - range * 0.1;
			ymax = ymax + range * 0.1;

			return [
				this.phaseYlimsIN[0] != null ? this.phaseYlimsIN[0] : ymin,
				this.phaseYlimsIN[1] != null ? this.phaseYlimsIN[1] : ymax
			];
		});

		xgridlines = $state(true);
		ygridlines = $state(true);
		logScale = $state(false);

		constructor(parent, dataIN) {
			this.parentBox = parent;
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
				const leftAxisLine = allLeftAxes[leftMost]
					.getElementsByClassName('domain')[0]
					.getBoundingClientRect().left;
				axisWidths.left = Math.round(leftAxisLine - leftAxisWhole + 6);
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
				const rightAxisLine = allRightAxes[rightMost]
					.getElementsByClassName('domain')[0]
					.getBoundingClientRect().right;
				axisWidths.right = Math.round(rightAxisWhole - rightAxisLine + 6);
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
				const topAxisLine = allTopAxes[topMost]
					.getElementsByClassName('domain')[0]
					.getBoundingClientRect().top;
				axisWidths.top = Math.round(topAxisLine - topAxisWhole + 6);
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
				const bottomAxisLine = allBottomAxes[bottomMost]
					.getElementsByClassName('domain')[0]
					.getBoundingClientRect().bottom;
				axisWidths.bottom = Math.round(bottomAxisWhole - bottomAxisLine + 6);
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

		toJSON() {
			return {
				xlimsIN: this.xlimsIN,
				ylimsIN: this.ylimsIN,
				padding: this.padding,
				ygridlines: this.ygridlines,
				xgridlines: this.xgridlines,
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
			fft.ygridlines = json.ygridlines;
			fft.xgridlines = json.xgridlines;
			fft.logScale = json.logScale ?? false;
			fft.showPeriod = json.showPeriod ?? false;

			if (json.data) {
				fft.data = json.data.map((d) => FFTDataclass.fromJSON(d, fft));
			}
			return fft;
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

	let tooltip = $state({ visible: false, x: 0, y: 0, content: '' });
	function handleTooltip(event) {
		tooltip = event.detail;
	}

	onMount(() => {
		if (which == 'plot') {
			theData.plot.autoScalePadding('all');
		}
	});

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
					<input type="checkbox" bind:checked={theData.ygridlines} />
					<p>Grid</p>
				</div>
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
					<input type="checkbox" bind:checked={theData.xgridlines} />
					<p>Grid</p>
				</div>
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
				nticks={5}
				gridlines={theData.plot.ygridlines}
				label={theData.plot.logScale ? 'Magnitude (log)' : 'Magnitude'}
			/>

			<!-- Y Axis (Phase) - on right side if any data shows phase -->
			{#if hasPhase}
				<Axis
					height={theData.plot.plotheight}
					width={theData.plot.plotwidth}
					scale={phaseYScale}
					position="right"
					plotPadding={theData.plot.padding}
					nticks={5}
					gridlines={false}
					label="Phase (radians)"
				/>
			{/if}

			<!-- X Axis -->
			<Axis
				height={theData.plot.plotheight}
				width={theData.plot.plotwidth}
				scale={xScale}
				position="bottom"
				plotPadding={theData.plot.padding}
				nticks={5}
				gridlines={theData.plot.xgridlines}
				label={theData.plot.showPeriod ? 'Period (hours)' : 'Frequency'}
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
						which="plot"
					/>
				{/if}
			{/each}
		{/key}
	</svg>

	{#if tooltip.visible}
		<div class="tooltip" style="left: {tooltip.x}px; top: {tooltip.y}px;">
			{tooltip.content}
		</div>
	{/if}
{/snippet}

{#if which === 'plot'}
	{@render plot(theData)}
{:else if which === 'controls'}
	{@render controls(theData)}
{/if}
