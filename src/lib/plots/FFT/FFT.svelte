<script module>
	import {
		LegendAutoLayout,
		rightOfPlot,
		lineSeriesObstacle
	} from '$lib/components/plotbits/legendAuto.svelte.js';
	import { Column as ColumnClass } from '$lib/core/Column.svelte';
	import { seriesDisplayLabel } from '$lib/components/plotbits/helpers/seriesLabel.js';
	import {
		viewFontScale,
		viewStyleFor,
		scalePadding,
		autoPadWhenDrawn
	} from '$lib/plots/viewBox.js';
	import Column from '$lib/core/Column.svelte';
	import Axis, { AxisClass } from '$lib/components/plotbits/Axis.svelte';
	import { scaleLinear, scaleLog } from 'd3-scale';
	import {
		logAxisDomain,
		minPositiveOf,
		drawableOnLog,
		logTickFormat
	} from '$lib/plots/logAxis.js';
	import NumberWithUnits, { numberOrNull } from '$lib/components/inputs/NumberWithUnits.svelte';
	import PaddingControls from '$lib/components/inputs/PaddingControls.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';

	import Line, { LineClass } from '$lib/components/plotbits/Line.svelte';
	import Points, { PointsClass } from '$lib/components/plotbits/Points.svelte';
	import { dataSettingsScrollTo } from '$lib/components/views/dataSettingsScroll.js';
	import { computeFFT, fftPeak } from '$lib/utils/fft.js';
	import { minMax, minMaxAcross, max as arrMax } from '$lib/utils/stats.js';
	import {
		findNearestY,
		bindAltTooltipToggle
	} from '$lib/components/plotbits/helpers/tooltipHelpers.js';
	import PlotTooltip from '$lib/components/plotbits/PlotTooltip.svelte';
	import { paddedDomain } from '$lib/plots/axisDomain.js';
	import {
		fftXAxisLabel,
		setFftShowPeriod,
		convertFftLimitOverride,
		FFT_PERIOD_LABEL
	} from './fftAxis.js';
	import { OverlayClass } from '$lib/components/plotbits/Overlay.svelte';
	import {
		overlayExtentOf,
		overlayLegendItems,
		overlaysFromJSON,
		overlaysToJSON
	} from '$lib/components/plotbits/overlayHost.js';

	export const FFT_defaultDataInputs = ['time', 'values'];
	export const FFT_controlHeaders = ['Properties', 'Data', 'Overlays'];
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
		phasePoints = $state();

		fftData = $derived.by(() => {
			const times = this.x.hoursSinceStart;
			const values = this.y.getData();
			return computeFFT(times, values, this.freqStep);
		});

		// The { frequency, period, magnitude } of a peak, refined between bins by fftPeak
		// (a rhythm between two bins of the record's grid is reported at its own period and
		// amplitude, not at the nearer bin with up to a third of the amplitude lost).
		peakOf(found) {
			if (!found) return null;
			return {
				frequency: found.frequency,
				period: found.frequency !== 0 ? found.period : null,
				magnitude: found.magnitude
			};
		}

		// Peak detection - find the highest magnitude across ALL calculated data
		peak = $derived.by(() => this.peakOf(fftPeak(this.fftData)));

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
			if (!visibleIndices.length) return null;
			return this.peakOf(fftPeak(this.fftData, { indices: visibleIndices }));
		});

		// The transform runs on the series' own sampling grid (computeFFT -> regridUniform):
		// a few missing samples are interpolated, a long gap or heavy missingness is refused.
		// Both are reported here, as is the record's true frequency resolution.
		dataWarnings = $derived.by(() => {
			const spec = this.fftData;
			const warnings = [];
			if (spec?.reason) warnings.push(`No spectrum: ${spec.reason}`);
			for (const w of spec?.warnings ?? []) warnings.push(w);
			return warnings;
		});

		constructor(parent, dataIN) {
			this.parentPlot = parent;

			// Accept the PUBLIC PORT name (`time`/`values`) as well as the stored `x`/`y`.
			// The two vocabularies are easy to conflate — a tool that wrote the port names got a
			// silently unwired plot (every refId -1) that then crashed at render. CircularPhase
			// already tolerated both; this makes the whole family consistent.
			const xJSON = dataIN?.x ?? dataIN?.time;
			if (xJSON) {
				this.x = ColumnClass.fromJSON(xJSON);
			} else {
				if (parent.data.length > 0) {
					this.x = new ColumnClass({ refId: parent.data[parent.data.length - 1].x.refId });
				} else {
					this.x = new ColumnClass({ refId: -1 });
				}
			}
			const yJSON = dataIN?.y ?? dataIN?.values;
			if (yJSON) {
				this.y = ColumnClass.fromJSON(yJSON);
			} else {
				this.y = new ColumnClass({ refId: -1 });
			}
			this.line = new LineClass(dataIN?.line, this);
			this.phaseLine = new LineClass(dataIN?.phaseLine, this);
			this.points = new PointsClass(dataIN?.points, this);
			this.phasePoints = new PointsClass(dataIN?.phasePoints, this);
			this.showPhase = dataIN?.showPhase ?? false;
			this.freqStep = dataIN?.freqStep ?? 0.0001;
		}

		get displayLabel() {
			return seriesDisplayLabel(this);
		}

		/**
		 * The MAGNITUDE entry for this series: the line and/or points actually drawn
		 * against the left-hand magnitude axis. Null when neither is drawn, so a
		 * hidden series never occupies a legend row (see Scatterplot).
		 */
		getLegendItem() {
			const elements = [];
			if (this.line.draw) {
				elements.push({
					type: 'line',
					color: this.line.colour,
					strokeWidth: this.line.strokeWidth,
					stroke: this.line.stroke
				});
			}
			if (this.points.draw) {
				elements.push({
					type: 'points',
					color: this.points.colour,
					size: this.points.radius,
					shape: this.points.shape
				});
			}
			if (elements.length === 0) return null;
			return { label: this.displayLabel, elements };
		}

		/**
		 * The PHASE entry for this series, or null.
		 *
		 * Phase is not a separate sub-plot: it is drawn into the same plot area as the
		 * magnitude, against a right-hand axis that only appears while some series has
		 * `showPhase` on. So one legend covers both, and the entry is suffixed
		 * " phase" to tell the two curves of a series apart.
		 *
		 * `showPhase` gates the ENTIRE phase render in the template, so it is checked
		 * first: without it a series with showPhase off would advertise a phase curve
		 * that is nowhere on the figure.
		 */
		getPhaseLegendItem() {
			if (!this.showPhase) return null;
			const elements = [];
			if (this.phaseLine.draw) {
				elements.push({
					type: 'line',
					color: this.phaseLine.colour,
					strokeWidth: this.phaseLine.strokeWidth,
					stroke: this.phaseLine.stroke
				});
			}
			if (this.phasePoints.draw) {
				elements.push({
					type: 'points',
					color: this.phasePoints.colour,
					size: this.phasePoints.radius,
					shape: this.phasePoints.shape
				});
			}
			if (elements.length === 0) return null;
			return { label: `${this.displayLabel} phase`, elements };
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
				// `?? json.time` / `?? json.values`: this re-map runs BEFORE the constructor, so
				// without it the constructor's port-name fallback would never see them.
				x: json.x ?? json.time,
				y: json.y ?? json.values,
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
		// The overlay host contract (components/plotbits/overlayHost.js): reference lines (a
		// vertical line at 24 h, or at the peak_period this plot outputs) and shaded bands (a 20
		// to 28 h circadian window, a magnitude range). A vertical position is STORED as a period
		// in hours whichever way the x axis is shown (decision Q3), and drawn at 1/p while it
		// shows frequency (overlayXTransform), so toggling the axis never rewrites an overlay.
		// Only the magnitude axis widens to fit them; the phase axis never carries overlays.
		static overlayCapabilities = Object.freeze({
			line: Object.freeze(['vertical', 'horizontal']),
			band: Object.freeze(['vertical', 'horizontal']),
			legend: true,
			xTime: false,
			domain: Object.freeze(['y']),
			xNote:
				'Vertical positions are periods in hours, also when the x axis shows frequency (a line at 24 is drawn at 1/24 cycles per hour).'
		});

		parentBox = $state();
		// Draw at the VIEW's size when one is given (a workflow node), else the figure's own.
		// See plots/viewBox.js for the whole story and why type scales with it.
		renderBox = $state(null);
		viewWidth = $derived(this.renderBox?.w ?? this.parentBox.width);
		viewHeight = $derived(this.renderBox?.h ?? this.parentBox.height);
		fontScale = $derived(viewFontScale(this.renderBox, this.parentBox));
		viewStyle = $derived(viewStyleFor(this.parentBox?.style, this.fontScale));
		data = $state([]);
		legend = $state();
		// Stored padding belongs to the FIGURE. A view that draws the type smaller needs
		// proportionally less room for it, so `padding` reads back SCALED while a renderBox is
		// set; the raw value is what gets saved. See plots/viewBox.js.
		#padding = $state({ top: 15, right: 20, bottom: 30, left: 50 });
		paddingScaled = $derived(scalePadding(this.#padding, this.fontScale));
		get padding() {
			return this.renderBox ? this.paddingScaled : this.#padding;
		}
		set padding(v) {
			this.#padding = v;
		}
		// The stored figure padding, for the Padding controls. While a node view is mounted
		// `padding` reads back a derived, scaled copy, so an edit bound there was lost.
		get figurePadding() {
			return this.#padding;
		}
		plotheight = $derived(this.viewHeight - this.padding.top - this.padding.bottom);
		// Width before an outside legend takes its share; see legendAuto.svelte.js.
		basePlotWidth = $derived(this.viewWidth - this.padding.left - this.padding.right);
		basePlotHeight = $derived(this.plotheight);
		plotwidth = $derived(this.basePlotWidth - this.legendLayout.reserveW);

		legendLayout = new LegendAutoLayout(this, {
			obstacles: (w, h) => this.legendObstacles(w, h),
			// Past the phase axis when one is drawn on the right.
			outside: rightOfPlot(() => ({
				baseWidth: this.basePlotWidth,
				hasRightAxis: this.data.some((d) => d.showPhase),
				paddingRight: this.padding.right
			}))
		});

		// What a legend must not cover, in px over a w x h plot area: each series'
		// magnitude line and points, and its phase line and points when phase is shown.
		// The same x and y mapping as the plot snippet draws with.
		legendObstacles(w, h) {
			const xs = scaleLinear().domain([this.xlims[0], this.xlims[1]]).range([0, w]);
			const ys = this.yScaleFor(h);
			const phaseYs = scaleLinear().domain([this.phaseYlims[0], this.phaseYlims[1]]).range([h, 0]);
			const out = [];
			for (const d of this.data) {
				const f = d.fftData?.frequencies ?? [];
				const keep = (_, i) => !this.showPeriod || f[i] > 0;
				const x = this.showPeriod ? f.filter((v) => v > 0).map((v) => 1 / v) : f;
				const mag = lineSeriesObstacle(
					x,
					this.drawableY((d.fftData?.magnitudes ?? []).filter(keep)),
					xs,
					ys,
					d.line,
					d.points
				);
				if (mag) out.push(mag);
				if (d.showPhase) {
					const phase = lineSeriesObstacle(
						x,
						(d.fftData?.phases ?? []).filter(keep),
						xs,
						phaseYs,
						d.phaseLine,
						d.phasePoints
					);
					if (phase) out.push(phase);
				}
			}
			return out;
		}

		// Toggle between frequency and period. An accessor so that EVERY way of changing the
		// mode (the checkbox, the multi-select shared fields, fromJSON) keeps an automatic
		// x-axis label in step with it; see fftAxis.js. The setter only stores the mode: the
		// x limits are in the mode's units, and a SWITCH converts them through pairedEdits
		// below, never here, because fromJSON and the facet mirror also write this field with
		// limits that are already in the new mode.
		#showPeriod = $state(true);
		get showPeriod() {
			return this.#showPeriod;
		}
		set showPeriod(v) {
			this.#showPeriod = !!v;
			this.syncXAxisLabel();
		}
		syncXAxisLabel() {
			if (!this.xAxis) return;
			const next = fftXAxisLabel(this.xAxis.label, this.#showPeriod);
			if (next !== this.xAxis.label) this.xAxis.label = next;
		}
		xlimsIN = $state([4, 30]);

		// Fields whose edit must convert others (plots/pairedEdits.js). Switching the mode
		// converts the x limits, a manual x tick list and any facet panel x override, by every
		// edit route: Properties, the multi-select panel, an AI edit, the MCP render settings.
		static pairedEdits = {
			showPeriod: { apply: setFftShowPeriod, override: convertFftLimitOverride }
		};

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
			const extent = minMaxAcross(this.data.map((d) => d.fftData.magnitudes));
			// Overlays (reference lines / bands) widen the automatic magnitude range so a mark is
			// never silently off-screen; the user's limits below still win. Never the x range
			// (overlayCapabilities.domain), and never the phase axis.
			const ext = overlayExtentOf(this.overlays, 'y');
			const mnRaw = ext ? Math.min(extent.min ?? Infinity, ext[0]) : extent.min;
			const mxRaw = ext ? Math.max(extent.max ?? -Infinity, ext[1]) : extent.max;
			if (mnRaw == null || mxRaw == null) return [0, 1];
			// Headroom and a nice top tick; see plots/axisDomain.js. Magnitude is never negative.
			const [ymin, ymax] = paddedDomain(mnRaw, mxRaw, {
				lowerBound: 0,
				nice: this.yAxisMag?.nticks ?? 5
			});

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

		// Display only: the magnitude axis drawn on a log scale, the Periodogram's log axis
		// (plots/logAxis.js). Nothing computed changes.
		logScale = $state(false);
		// The smallest positive magnitude drawn (the series as the x mode shows them, and the
		// overlays), for the log axis's lower end. Period mode drops the f = 0 term.
		minPositiveY = $derived.by(() => {
			const arrs = this.data.map((d) => {
				const m = d.fftData?.magnitudes ?? [];
				const f = d.fftData?.frequencies ?? [];
				return this.showPeriod ? m.filter((_, i) => f[i] > 0) : m;
			});
			return minPositiveOf(arrs, overlayExtentOf(this.overlays, 'y') ?? []);
		});
		yLogDomain = $derived(logAxisDomain(this.ylimsIN[0], this.minPositiveY, this.ylims[1]));
		/** The magnitude-axis scale over a plot area `h` px tall: linear, or log when logScale is on. */
		yScaleFor(h) {
			return this.logScale
				? scaleLog().domain(this.yLogDomain).range([h, 0])
				: scaleLinear().domain([this.ylims[0], this.ylims[1]]).range([h, 0]);
		}
		yScale = $derived(this.yScaleFor(this.plotheight));
		/** Magnitudes as drawn: under the log axis a value at or below zero is a gap. */
		drawableY(arr) {
			return this.logScale ? drawableOnLog(arr) : arr;
		}
		xAxis = $state();
		yAxisMag = $state();
		yAxisPhase = $state();

		// One flat list: every series' magnitude entry, then its phase entry when phase
		// is on screen for that series. Walking `data` in order means the legend order
		// follows the Data tab and a series reorder.
		getLegendItems = $derived.by(() => {
			const items = [];
			this.data.forEach((datum) => {
				const mag = datum.getLegendItem();
				if (mag) items.push(mag);
				const phase = datum.getPhaseLegendItem();
				if (phase) items.push(phase);
			});
			// Then every enabled overlay that carries a label.
			items.push(...overlayLegendItems(this.overlays));
			return items;
		});

		// ---- overlay host (components/plotbits/overlayHost.js) ----------------------------
		// Reference lines and shaded bands, in draw order.
		overlays = $state([]);
		// The plot's own axes: period or frequency on x, MAGNITUDE on y (linear or log, the
		// scales the series are drawn with). The phase axis is never an overlay axis.
		overlayXScale = $derived(
			scaleLinear().domain([this.xlims[0], this.xlims[1]]).range([0, this.plotwidth])
		);
		overlayYScale = $derived(this.yScale);

		/**
		 * A stored vertical position (a period in hours) as drawn on the x axis: the period
		 * itself, or 1/p while the axis shows frequency. A period that is not positive has no
		 * place on either axis, so it is dropped (null) in both modes, and toggling the axis
		 * never makes a mark appear or vanish.
		 */
		overlayXTransform(p) {
			if (!(p > 0)) return null;
			return this.showPeriod ? p : 1 / p;
		}

		/** Add an overlay of `kind` ('line' | 'band'), optionally with a `form`; returns it. */
		addOverlay(kind, form) {
			const overlay = new OverlayClass(this, { kind, form });
			this.overlays.push(overlay);
			return overlay;
		}

		removeOverlay(id) {
			const idx = this.overlays.findIndex((o) => o.id === id);
			if (idx >= 0) this.overlays.splice(idx, 1);
		}

		/** The draw context every overlay's geometry() takes (the visible x range, axis units). */
		overlayContext() {
			return {
				xDomainMin: this.xlims[0],
				xDomainMax: this.xlims[1],
				xAnchorMin: this.xlims[0],
				xIsTime: false
			};
		}

		/** A band's default fill never reads it (no ribbon here); kept for the contract. */
		overlaySeriesColour() {
			return this.data[0]?.line?.colour ?? null;
		}

		/** The remedy an Overlays-tab block offers when its mark is outside the visible range. */
		overlayRangeHint(axis) {
			if (axis === 'x') {
				return 'Overlays never widen the period or frequency range; change the x limits in Properties.';
			}
			return this.ylimsIN[0] != null || this.ylimsIN[1] != null
				? 'The magnitude axis has fixed limits; reset them in Properties to fit it.'
				: null;
		}

		constructor(parent, dataIN) {
			this.parentBox = parent;
			// DEFAULT OFF. Every saved session already contains FFT plots, so a legend
			// that appeared at load would silently change a finished figure. See
			// LegendClass.withDefaults.
			this.legend = LegendClass.withDefaults(dataIN?.legend, { show: false });
			this.xAxis = AxisClass.withDefaults(dataIN?.xAxis, { label: FFT_PERIOD_LABEL });
			this.syncXAxisLabel();
			this.yAxisMag = AxisClass.withDefaults(dataIN?.yAxisMag, { label: 'Magnitude' });
			this.yAxisPhase = AxisClass.withDefaults(dataIN?.yAxisPhase, {
				label: 'Phase (radians)',
				gridlines: false
			});
			if (dataIN) {
				this.addData(dataIN);
			}
		}

		getAutoScaleValues() {
			let axisWidths = { left: null, right: null, top: null, bottom: null };

			const plotElem = document.getElementById('plot' + this.parentBox.id);
			if (!plotElem) return axisWidths;

			// getBoundingClientRect() is in SCREEN pixels, magnified by the canvas
			// zoom (the plot renders inside a CSS scale() transform). Padding is in
			// SVG user units, so divide the measured deltas back out by the effective
			// scale — otherwise padding grows with zoom and jumps when re-measured at
			// a different zoom (e.g. when the control panel opens). See Scatterplot.
			// An SVG that is not laid out (display: none, a zero-size host) has no rects to
			// measure: every delta below would be 0 / 0, and NaN padding blanks the whole plot.
			const renderedWidth = plotElem.getBoundingClientRect().width;
			if (!(renderedWidth > 0)) return axisWidths;
			const scale =
				Number(plotElem.getAttribute('width')) > 0
					? renderedWidth / Number(plotElem.getAttribute('width'))
					: 1;

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
					axisWidths.left = Math.round((leftAxisLine - leftAxisWhole) / scale + 6);
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
					axisWidths.right = Math.round((rightAxisWhole - rightAxisLine) / scale + 6);
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
					axisWidths.top = Math.round((topAxisLine - topAxisWhole) / scale + 6);
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
					axisWidths.bottom = Math.round((bottomAxisWhole - bottomAxisLine) / scale + 12);
				}
			}

			return axisWidths;
		}

		autoScalePadding(side) {
			// Never from a NODE. `padding` is a property of the FIGURE, and a node draws the
			// plot smaller with type scaled to match, so margins measured there describe the
			// node, not the figure. Letting it write would redefine the figure's margins from
			// whichever view happened to mount last.
			if (this.renderBox) return;
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
				padding: this.#padding,
				xAxis: this.xAxis.toJSON(),
				yAxisMag: this.yAxisMag.toJSON(),
				yAxisPhase: this.yAxisPhase.toJSON(),
				logScale: this.logScale,
				showPeriod: this.showPeriod,
				data: this.data,
				legend: this.legend.toJSON(),
				overlays: overlaysToJSON(this.overlays)
			};
		}

		static fromJSON(parent, json) {
			if (!json) {
				return new FFTclass(parent, null);
			}

			const fft = new FFTclass(parent, null);
			// `?? fft.padding` last: the first two are both JSON fields (paddingIN is the legacy
			// name), so an inner carrying neither left the default undefined and threw at render.
			fft.padding = json.padding ?? json.paddingIN ?? fft.padding;
			// Same rule as padding above: an inner that omits these (a Quick-Plot or AI-built plot
			// carries only `{data}`) must keep the class defaults rather than have them replaced
			// with undefined, which then reaches the renderer as `freqlimsIN[0]`.
			fft.freqlimsIN = json.freqlimsIN ?? fft.freqlimsIN;
			fft.xlimsIN = json.xlimsIN || [null, null];
			fft.ylimsIN = json.ylimsIN ?? fft.ylimsIN;
			fft.logScale = json.logScale ?? false;
			fft.showPeriod = json.showPeriod ?? false;

			// Support both new AxisClass format and old individual properties
			if (json.xAxis) {
				fft.xAxis = AxisClass.fromJSON(json.xAxis);
			} else {
				fft.xAxis = new AxisClass({
					label: fftXAxisLabel('Frequency', fft.showPeriod),
					gridlines: json.xgridlines ?? true
				});
			}
			// A legacy session has no axis object, and one saved before the label followed the
			// mode may carry the wrong automatic label; both resolve to the label for the mode.
			fft.syncXAxisLabel();
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

			// Same default-off rule as the constructor: an old session (or a tool-written
			// inner) with no `legend` key must load with the legend hidden.
			fft.legend = LegendClass.withDefaults(json.legend, { show: false });

			if (json.data) {
				fft.data = json.data.map((d) => FFTDataclass.fromJSON(d, fft));
			}
			// After the series, as on every host. A session saved before the FFT had overlays
			// carries none.
			overlaysFromJSON(fft, json);
			return fft;
		}
	}

	export const FFT_sharedFields = [
		{ path: 'width', label: 'Width', input: 'number', group: 'Dimension' },
		{ path: 'height', label: 'Height', input: 'number', group: 'Dimension' },

		{ path: 'plot.padding.top', label: 'Top', input: 'number', group: 'Padding' },
		{ path: 'plot.padding.bottom', label: 'Bottom', input: 'number', group: 'Padding' },
		{ path: 'plot.padding.left', label: 'Left', input: 'number', group: 'Padding' },
		{ path: 'plot.padding.right', label: 'Right', input: 'number', group: 'Padding' },

		{ path: 'plot.xlimsIN[0]', label: 'X min', input: 'number', group: 'X-axis' },
		{ path: 'plot.xlimsIN[1]', label: 'X max', input: 'number', group: 'X-axis' },
		{ path: 'plot.showPeriod', label: 'Show as period', input: 'boolean', group: 'X-axis' },

		{ path: 'plot.ylimsIN[0]', label: 'Magnitude min', input: 'number', group: 'Y-axis' },
		{ path: 'plot.ylimsIN[1]', label: 'Magnitude max', input: 'number', group: 'Y-axis' },
		{ path: 'plot.logScale', label: 'Log scale', input: 'boolean', group: 'Y-axis' },

		{ path: 'plot.phaseYlimsIN[0]', label: 'Phase min', input: 'number', group: 'Phase' },
		{ path: 'plot.phaseYlimsIN[1]', label: 'Phase max', input: 'number', group: 'Phase' }
	];

	export const FFT_dataSharedFields = [
		{ path: 'showPhase', label: 'Show phase', input: 'boolean' },
		{ path: 'freqStep', label: 'Freq step (cyc/h)', input: 'number', step: 0.001 }
	];

	export const definition = {
		displayName: FFT_displayName,
		defaultDataInputs: FFT_defaultDataInputs,
		controlHeaders: FFT_controlHeaders,
		plotClass: FFTclass,
		sharedFields: FFT_sharedFields,
		dataSharedFields: FFT_dataSharedFields
	};
</script>

<script>
	import { appState } from '$lib/core/core.svelte';
	import { onMount } from 'svelte';
	import { flip } from 'svelte/animate';
	import { slide } from 'svelte/transition';
	import { tick } from 'svelte';

	import Icon from '$lib/icons/Icon.svelte';
	import SeriesBlockHeader from '$lib/components/plotbits/SeriesBlockHeader.svelte';
	import DataAddHeader from '$lib/components/plotbits/DataAddHeader.svelte';
	import { tooltip as attachTooltip } from '$lib/utils/tooltip.js';
	import StoreValueButton from '$lib/components/inputs/StoreValueButton.svelte';
	import { provideStoredValueOwner } from '$lib/core/storedValueClaims.js';
	import PlotBrush from '$lib/components/plotbits/PlotBrush.svelte';
	import Legend, { LegendClass } from '$lib/components/plotbits/Legend.svelte';
	import { createPlotZoom } from '$lib/plots/plotZoomController.js';
	import { getZoomAdapter } from '$lib/plots/zoomAdapters.js';
	import { editPlotInners } from '$lib/plots/pairedEdits.js';
	import { usePlotMetricOutputs, ownsPlotMetrics } from '$lib/plots/plotMetricOutputs.svelte.js';
	import OverlayLayers from '$lib/components/plotbits/OverlayLayers.svelte';
	import OverlaysTab from '$lib/components/plotbits/OverlaysTab.svelte';

	let { theData, which, brushable = false, zoomMode = false } = $props();
	// Every stored-value button here is one entry per plot, however many copies are
	// mounted: see storedValueClaims.js.
	provideStoredValueOwner('plot', () => theData?.parentBox?.id);

	// Keep the plot's metric output columns (peak_period / peak_frequency /
	// peak_magnitude ports) reconciled + written from the stats this component
	// already computes.
	usePlotMetricOutputs(
		() => theData,
		() => ownsPlotMetrics(which)
	);

	// Brush + wheel zoom (shared controller + per-plot adapter). Mirrors Scatterplot.
	let svgEl = $state(null);
	const zoomCtl = createPlotZoom(() => ({
		plot: theData,
		brushable,
		zoomMode,
		svgEl,
		adapter: getZoomAdapter(theData)
	}));

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
		const vals = which === 'phase' ? datum.fftData.phases : datum.fftData.magnitudes;
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
		// After the first draw has landed, not from the SVG as it was at mount: see
		// autoPadWhenDrawn (plots/viewBox.js).
		if (which == 'plot') return autoPadWhenDrawn(theData.plot);
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
		<Legend
			legendData={theData.legend}
			figureStyle={theData.parentBox?.style}
			canPlaceOutside={theData.legendLayout.canPlaceOutside}
			which="controls"
		/>

		<div class="div-line"></div>

		<PaddingControls
			bind:padding={theData.figurePadding}
			auto={theData.renderBox ? null : theData.getAutoScaleValues()}
			onReset={(side) => theData.autoScalePadding(side)}
		/>

		<div class="div-line"></div>

		<Axis axisData={theData.yAxisMag} which="controls" title="Y-axis (magnitude)">
			{#snippet tools()}
				<button
					class="icon"
					type="button"
					aria-label="Reset the magnitude axis to auto range"
					onclick={() => (theData.ylimsIN = [null, null])}
					{@attach attachTooltip('Reset the magnitude axis to auto range')}
				>
					<Icon name="reset" width={14} height={14} className="control-component-title-icon" />
				</button>
			{/snippet}

			<div class="control-input-vertical">
				<label class="control-input-checkbox">
					<input type="checkbox" bind:checked={theData.logScale} />
					<span class="ci-label">Log scale</span>
				</label>
			</div>

			<div class="control-input-horizontal">
				<ControlInput label="Min">
					<NumberWithUnits
						nullable
						step="0.1"
						value={theData.ylimsIN[0] != null ? theData.ylimsIN[0] : theData.ylims[0]}
						onInput={(val) => {
							theData.ylimsIN[0] = numberOrNull(val);
						}}
					/>
				</ControlInput>

				<ControlInput label="Max">
					<NumberWithUnits
						nullable
						step="0.1"
						value={theData.ylimsIN[1] != null ? theData.ylimsIN[1] : theData.ylims[1]}
						onInput={(val) => {
							theData.ylimsIN[1] = numberOrNull(val);
						}}
					/>
				</ControlInput>
			</div>
		</Axis>

		{#if theData.data.some((d) => d.showPhase)}
			<Axis axisData={theData.yAxisPhase} which="controls" title="Y-axis (phase)">
				{#snippet tools()}
					<button
						class="icon"
						type="button"
						aria-label="Reset the phase axis to auto range"
						onclick={() => (theData.phaseYlimsIN = [null, null])}
						{@attach attachTooltip('Reset the phase axis to auto range')}
					>
						<Icon name="reset" width={14} height={14} className="control-component-title-icon" />
					</button>
				{/snippet}

				<div class="control-input-horizontal">
					<ControlInput label="Min">
						<NumberWithUnits
							nullable
							step="0.1"
							value={theData.phaseYlimsIN[0] != null
								? theData.phaseYlimsIN[0]
								: theData.phaseYlims[0]}
							onInput={(val) => {
								theData.phaseYlimsIN[0] = numberOrNull(val);
							}}
						/>
					</ControlInput>

					<ControlInput label="Max">
						<NumberWithUnits
							nullable
							step="0.1"
							value={theData.phaseYlimsIN[1] != null
								? theData.phaseYlimsIN[1]
								: theData.phaseYlims[1]}
							onInput={(val) => {
								theData.phaseYlimsIN[1] = numberOrNull(val);
							}}
						/>
					</ControlInput>
				</div>
			</Axis>
		{/if}

		<Axis axisData={theData.xAxis} which="controls" title="X-axis">
			{#snippet tools()}
				<button
					class="icon"
					type="button"
					aria-label="Reset the period/frequency axis to auto range"
					onclick={() => (theData.xlimsIN = [null, null])}
					{@attach attachTooltip('Reset the period/frequency axis to auto range')}
				>
					<Icon name="reset" width={14} height={14} className="control-component-title-icon" />
				</button>
			{/snippet}

			<div class="control-input-vertical">
				<label class="control-input-checkbox">
					<input
						type="checkbox"
						checked={theData.showPeriod}
						onchange={(e) =>
							editPlotInners(
								[theData.parentBox ?? { plot: theData }],
								'showPeriod',
								e.currentTarget.checked
							)}
					/>
					<span class="ci-label">Show as period (h)</span>
				</label>
			</div>

			<div class="control-input-horizontal">
				<div class="control-input">
					<p>
						{theData.showPeriod ? `Min (${theData.minPeriod.toFixed(3)})` : 'Min'}
					</p>

					<NumberWithUnits
						min={theData.showPeriod ? theData.minPeriod : 0}
						step="0.1"
						nullable
						value={theData.xlimsIN[0] != null ? theData.xlimsIN[0] : theData.xlims[0]}
						onInput={(val) => {
							theData.xlimsIN[0] = numberOrNull(val);
						}}
					/>
				</div>

				<div class="control-input">
					<p>
						{theData.showPeriod ? 'Max' : `Max (${theData.maxFrequency.toFixed(3)})`}
					</p>

					<NumberWithUnits
						max={theData.showPeriod ? 1000 : theData.maxFrequency}
						step={theData.showPeriod ? '1' : '0.01'}
						nullable
						value={theData.xlimsIN[1] != null ? theData.xlimsIN[1] : theData.xlims[1]}
						onInput={(val) => {
							theData.xlimsIN[1] = numberOrNull(val);
						}}
					/>
				</div>
			</div>
		</Axis>
	{:else if appState.currentControlTab === 'overlays'}
		<OverlaysTab inner={theData} />
	{:else if appState.currentControlTab === 'data'}
		<div id="dataSettings">
			<DataAddHeader
				count={theData.data.length}
				onadd={async () => {
					theData.addData({
						x: null,
						y: { refId: -1 }
					});
					await tick();
					dataSettingsScrollTo('bottom');
				}}
			/>

			<div class="control-data-container">
				{#each theData.data as datum, i (datum.x.id + '-' + datum.y.id)}
					<div
						class="dataBlock"
						animate:flip={{ duration: 500 }}
						in:slide={{ duration: 500, axis: 'y' }}
						out:slide={{ duration: 500, axis: 'y' }}
					>
						<SeriesBlockHeader inner={theData} {datum} index={i} editable={false} />

						<div class="control-data">
							<ControlInput label="x (time)"></ControlInput>
							<Column col={datum.x} canChange={true} />
						</div>

						<div class="control-data">
							<ControlInput label="y (values)"></ControlInput>
							<Column col={datum.y} canChange={true} />
						</div>

						<div class="control-input-vertical">
							<label class="control-input-checkbox">
								<input type="checkbox" bind:checked={datum.showPhase} />
								<span class="ci-label">Show phase</span>
							</label>
						</div>

						<div class="control-input">
							<p>Frequency step</p>
							<div style="display: flex; align-items: center; gap: 8px;">
								<NumberWithUnits
									nullable
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
								{#if datum.fftData.resolution > 0}
									<br />Resolution {datum.fftData.resolution.toPrecision(3)} cycles/h (1 / record length);
									a finer step interpolates between independent bins.
								{/if}
							</p>
						</div>

						{#if datum.dataWarnings && datum.dataWarnings.length > 0}
							<div class="data-warning">
								{#each datum.dataWarnings as warning, wi (wi)}
									<p>⚠ {warning}</p>
								{/each}
							</div>
						{/if}

						{#if datum.visiblePeak}
							{#if datum.visiblePeak.period != null}
								<p>
									<strong>Peak Period: {datum.visiblePeak.period.toFixed(2)} h</strong>
									<StoreValueButton
										label="Peak Period"
										getter={() => datum.visiblePeak?.period}
										defaultName={`fft_peak_period_${datum.y?.name || 'data' + i}`}
										source="FFT"
									/>
								</p>
							{/if}
							<p>
								<strong>Peak Frequency: {datum.visiblePeak.frequency.toFixed(4)} cycles/h</strong>
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
											? datum.peak.period.toFixed(2) + ' h / '
											: ''}{datum.peak.frequency.toFixed(4)} cycles/h is outside the displayed range
									</p>
								</div>
							{/if}
						{:else if datum.peak}
							{#if datum.peak.period != null}
								<p>
									<strong>Peak Period: {datum.peak.period.toFixed(2)} h</strong>
									<StoreValueButton
										label="Peak Period"
										getter={() => datum.peak?.period}
										defaultName={`fft_peak_period_${datum.y?.name || 'data' + i}`}
										source="FFT"
									/>
								</p>
							{/if}
							<p>
								<strong>Peak Frequency: {datum.peak.frequency.toFixed(4)} cycles/h</strong>
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
		bind:this={svgEl}
		id={'plot' + theData.plot.parentBox.id}
		width={theData.plot.viewWidth}
		height={theData.plot.viewHeight}
		viewBox="0 0 {theData.plot.viewWidth} {theData.plot.viewHeight}"
		style="background: var(--surface-card); position: absolute;{brushable && zoomMode
			? ' cursor: crosshair;'
			: ''}"
		ontooltip={handleTooltip}
		onwheel={brushable ? zoomCtl.handleWheelZoom : null}
	>
		{#key `${theData.plot.logScale}-${theData.plot.showPeriod}-${theData.plot.data.some((d) => d.showPhase)}`}
			{@const hasPhase = theData.plot.data.some((d) => d.showPhase)}
			{@const yScale = theData.plot.overlayYScale}

			{@const phaseYScale = scaleLinear()
				.domain([theData.plot.phaseYlims[0], theData.plot.phaseYlims[1]])
				.range([theData.plot.plotheight, 0])}

			{@const xScale = theData.plot.overlayXScale}
			<!-- Y Axis (Magnitude) -->
			<Axis
				figureStyle={theData.plot.viewStyle}
				height={theData.plot.plotheight}
				width={theData.plot.plotwidth}
				scale={yScale}
				tickFormat={theData.plot.logScale
					? logTickFormat(yScale, theData.plot.yAxisMag.nticks)
					: null}
				position="left"
				plotPadding={theData.plot.padding}
				axisData={theData.plot.yAxisMag}
				which="plot"
			/>

			<!-- Y Axis (Phase) - on right side if any data shows phase -->
			{#if hasPhase}
				<Axis
					figureStyle={theData.plot.viewStyle}
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
				figureStyle={theData.plot.viewStyle}
				height={theData.plot.plotheight}
				width={theData.plot.plotwidth}
				scale={xScale}
				position="bottom"
				plotPadding={theData.plot.padding}
				axisData={theData.plot.xAxis}
				which="plot"
			/>

			<!-- Shaded bands beneath the spectra. Inside the {#key} so they remount with the axes
			     when the scale, the period/frequency mode or the phase axis changes. -->
			<OverlayLayers inner={theData.plot} layer="bands" />

			<!-- Plot data -->
			{#each theData.plot.data as datum, di (di)}
				{@const xData = theData.plot.showPeriod
					? datum.fftData.frequencies.filter((f) => f > 0).map((f) => 1 / f)
					: datum.fftData.frequencies}
				{@const yData = theData.plot.drawableY(
					theData.plot.showPeriod
						? datum.fftData.magnitudes.filter((_, i) => datum.fftData.frequencies[i] > 0)
						: datum.fftData.magnitudes
				)}
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
					xLabel={fftXAxisLabel(theData.plot.xAxis.label || 'Frequency', theData.plot.showPeriod)}
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
					xLabel={fftXAxisLabel(theData.plot.xAxis.label || 'Frequency', theData.plot.showPeriod)}
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
						xLabel={fftXAxisLabel(theData.plot.xAxis.label || 'Frequency', theData.plot.showPeriod)}
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
						xLabel={fftXAxisLabel(theData.plot.xAxis.label || 'Frequency', theData.plot.showPeriod)}
						yLabel={theData.plot.yAxisPhase.label || 'Phase (radians)'}
						siblings={fftPhaseSiblings}
						which="plot"
					/>
				{/if}
			{/each}

			<!-- Reference lines above the magnitude and phase curves, beneath the legend. -->
			<OverlayLayers inner={theData.plot} layer="lines" />
		{/key}

		<!-- Series legend. Sits over the single plot area that BOTH the magnitude and the
		     phase curves are drawn into, so its corner presets clear the left magnitude
		     axis and the right phase axis alike (those live outside plotwidth). Drawn
		     after the data marks and before the brush overlay. -->
		<Legend
			figureStyle={theData.plot.viewStyle}
			legendData={theData.plot.legend}
			items={theData.plot.getLegendItems}
			plotWidth={theData.plot.plotwidth}
			plotHeight={theData.plot.plotheight}
			padding={theData.plot.padding}
			autoPlacement={theData.plot.legendLayout.auto}
			outsidePosition={theData.plot.legendLayout.outsidePosition}
			which="plot"
		/>

		<!-- Brush-zoom overlay (Zoom mode or Shift+drag); box renders above the data. -->
		{#if brushable}
			<g style="transform: translate({theData.plot.padding.left}px, {theData.plot.padding.top}px);">
				<PlotBrush
					{svgEl}
					{zoomMode}
					padding={theData.plot.padding}
					plotwidth={theData.plot.plotwidth}
					plotheight={theData.plot.plotheight}
					onZoom={zoomCtl.applyBrushZoom}
					onReset={zoomCtl.resetZoom}
				/>
			</g>
		{/if}
	</svg>

	<PlotTooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} content={tooltip.content} />
{/snippet}

{#if which === 'plot'}
	{@render plot(theData)}
{:else if which === 'controls'}
	{@render controls(theData)}
{/if}
