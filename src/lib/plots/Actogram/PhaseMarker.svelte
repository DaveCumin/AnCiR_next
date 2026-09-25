<script module>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import {
		matchTemplateMarkers,
		markerAbsoluteTimes,
		unwrapOnsets,
		markerDisplayPosition,
		lineCopyOffsets,
		wrapPhaseToRow,
		assessOnsetFit,
		periodogramPeak
	} from './onsetUnwrap.js';
	import { tooltip } from '$lib/utils/tooltip.js';
	import ColourPicker from '$lib/components/inputs/ColourPicker.svelte';
	import Editable from '$lib/components/inputs/Editable.svelte';
	import { scaleLinear } from 'd3-scale';
	import { runPeriodogramCalculation } from '$lib/utils/periodogram.js';
	import { fitLine } from './lineFit.js';

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
		// Day (1-indexed) at which Est φ is reported / the fit line's θ is anchored.
		// null → falls back to the line's start day (lineMinDay) or day 1.
		phaseRefDay = $state(null);
		selectedPeriods = $state([]);
		manualMarkers = $state([]);
		// The line, stored as slope + intercept in the same absolute-time-vs-1-indexed-day
		// frame as the regression (so the drawn line, τ, θ and the harmonic check all reuse
		// linearRegression below). slope = τ (period, hrs); the day span is lineMin/MaxDay.
		// A block with no markers and both locks Fixed is a line the user positions
		// directly (the "Add line" preset, and what the old `fitline` type became).
		fitSlope = $state(null);
		fitIntercept = $state(null);
		// Per-parameter locks. The line has exactly two parameters, τ (the slope,
		// the period in hours) and θ (the phase, the time of day at the reference
		// day), and each is independently either FITTED from this block's selected
		// markers or FIXED at the value the user typed or dragged to.
		//   'fit'   → least squares decides it
		//   'fixed' → read out of fitSlope/fitIntercept (see tauValue/thetaValue)
		// Defaults: an eye-fit line (no markers) is fixed on both; a marker block
		// fits both, which is exactly the behaviour before locks existed.
		lockTau = $state('fit');
		lockTheta = $state('fit');

		// The day the phase (θ) is reported / anchored to (1-indexed, clamped into the
		// plot). Shared by Est φ and the fit line's θ handling. User-set via phaseRefDay;
		// defaults to the line's start day (lineMinDay) or day 1.
		get fitRefDay() {
			const Ndays = Math.max(1, this.parentData.parentPlot.Ndays);
			const raw = this.phaseRefDay ?? this.lineMinDay ?? 1;
			return Math.min(Math.max(1, raw), Ndays);
		}
		// Time-of-day the line crosses at day `d` (1-indexed): (slope - periodHrs)*d + intercept.
		fitTimeOfDayAt(d) {
			const P = this.parentData.parentPlot.periodHrs;
			return (this.fitSlope - P) * d + this.fitIntercept;
		}
		// The FIXED values of the two parameters, decoded from the stored
		// (fitSlope, fitIntercept) pair. That pair is only ever a storage encoding
		// of (τ, θ) at the reference day, which is what lets old sessions (which
		// stored nothing else) load unchanged.
		get tauValue() {
			return this.fitSlope;
		}
		get thetaValue() {
			if (this.fitSlope == null || this.fitIntercept == null) return null;
			return this.fitTimeOfDayAt(this.fitRefDay);
		}

		// Seed fitSlope/fitIntercept from the line as currently drawn, so flipping a
		// lock to Fixed or typing into one field never makes the line jump.
		pinCurrentLine() {
			const reg = this.linearRegression;
			if (
				reg &&
				typeof reg === 'object' &&
				Number.isFinite(reg.slope) &&
				Number.isFinite(reg.intercept)
			) {
				this.fitSlope = reg.slope;
				this.fitIntercept = reg.intercept;
				return;
			}
			const P = this.parentData.parentPlot.periodHrs;
			this.fitSlope ??= P;
			this.fitIntercept ??= P / 2;
		}

		// Rotate: set τ (slope) while keeping the time-of-day at the reference day
		// fixed. Typing into the τ field or rotating the line on the plot both land
		// here, and both mean "I have decided τ", so the lock flips to Fixed.
		setTau(slope) {
			this.pinCurrentLine();
			const P = this.parentData.parentPlot.periodHrs;
			const rd = this.fitRefDay;
			const tod = this.fitTimeOfDayAt(rd);
			this.fitSlope = slope;
			this.fitIntercept = tod - (slope - P) * rd;
			this.lockTau = 'fixed';
		}
		// Translate: set the time-of-day (θ) at the reference day, keeping τ fixed.
		setTheta(tod) {
			this.pinCurrentLine();
			const P = this.parentData.parentPlot.periodHrs;
			const rd = this.fitRefDay;
			this.fitIntercept = tod - (this.fitSlope - P) * rd;
			this.lockTheta = 'fixed';
		}

		// Lock switches. Going to Fixed pins the line where it is, so the only thing
		// that changes is which parameter least squares is still free to move.
		setLockTau(mode) {
			if (mode === 'fixed') this.pinCurrentLine();
			this.lockTau = mode;
		}
		setLockTheta(mode) {
			if (mode === 'fixed') this.pinCurrentLine();
			this.lockTheta = mode;
		}

		//Add a manual marker - the raw time clicked on
		addTime(clickedDay, clickedHrs) {
			// Calculate absolute time using the current periodHrs
			const periodHrs = this.parentData.parentPlot.periodHrs;
			const absoluteTime = clickedDay * periodHrs + clickedHrs;
			this.manualMarkers = [...this.manualMarkers, absoluteTime];
		}

		// Onset/offset template detections: per row, the hour in the row and the
		// detection's absolute time (it can fall in the next row). See onsetUnwrap.js.
		templateMatches = $derived.by(() =>
			matchTemplateMarkers(
				this.parentData.dataByDays.xByPeriod,
				this.parentData.dataByDays.yByPeriod,
				{
					periodHrs: this.parentData.parentPlot.periodHrs,
					binSize: this.parentData.binSize,
					hrsBefore: this.templateHrsBefore,
					hrsAfter: this.templateHrsAfter,
					centile: this.centileThreshold,
					type: this.type
				}
			)
		);

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

			return this.templateMatches.hours;
		});

		// Absolute time of each row's marker, and the selected markers unwrapped
		// across the row boundary so the regression slope is tau.
		markerTimes = $derived(
			markerAbsoluteTimes(
				this.markers,
				this.parentData.parentPlot.periodHrs,
				this.type === 'onset' || this.type === 'offset' ? this.templateMatches.times : null
			)
		);
		onsetUnwrap = $derived(
			unwrapOnsets(this.markerTimes, {
				periodHrs: this.parentData.parentPlot.periodHrs,
				selected: this.selectedPeriods
			})
		);

		markerPoints = $derived.by(() => {
			let out = '';
			const xscale = scaleLinear()
				.domain([0, this.parentData.parentPlot.periodHrs * this.parentData.parentPlot.doublePlot])
				.range([0, this.parentData.parentPlot.plotwidth]);
			const radius = this.markerSize;
			for (let m = 0; m < this.markers.length; m++) {
				if (!(this.selectedPeriods[m] ?? true)) continue;
				if (isNaN(this.markers[m]) || this.markers[m] == null) continue;
				// Drawn in the row the onset fell in (a row's search spans two rows).
				const pos = markerDisplayPosition(
					this.markerTimes[m],
					this.parentData.parentPlot.periodHrs
				);
				const cx = xscale(pos.hour) + this.parentData.parentPlot.padding.left;
				const cy =
					this.parentData.parentPlot.padding.top +
					this.parentData.parentPlot.eachplotheight -
					radius / 2 +
					pos.row * this.parentData.parentPlot.spaceBetween +
					pos.row * this.parentData.parentPlot.eachplotheight;
				// A non-finite coordinate (e.g. before the plot has sized itself) would make
				// the browser reject the whole path; skip that dot instead.
				if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
				out += `M${cx} ${cy} m-${radius} 0 a${radius} ${radius} 0 1 0 ${2 * radius} 0 a${radius} ${radius} 0 1 0 -${2 * radius} 0 `;
			}

			return out;
		});

		/**
		 * Whether this block puts any marker dots on the figure.
		 *
		 * The `<path d={marker.markerPoints}>` at the bottom of the plot snippet is
		 * NOT gated on `showMarkers` (that field is never read by the template, and
		 * its `|| true` in the constructor means it is always true anyway). What
		 * decides is simply whether `markerPoints` produced any path data: an empty
		 * string is a path that draws nothing. A one-click line block has no
		 * markers, so it is false for that and true for an onset/fit block.
		 *
		 * Exists so the legend asks the same question the renderer answers, instead
		 * of re-deriving it from a field that looks authoritative and is not.
		 */
		//
		// Asked of the markers themselves rather than of `markerPoints`: the path string
		// is in pixels, so reading it would make the legend (and through it the plot's
		// 'auto' legend reservation, which sets the plot width) depend on the plot width.
		// The loop is markerPoints' own skip rule.
		markersDrawn = $derived(
			this.markers.some((v, m) => (this.selectedPeriods[m] ?? true) && v != null && !isNaN(v))
		);

		/**
		 * Whether this block puts its fitted line on the figure. Mirrors the plot
		 * snippet's gate exactly, INCLUDING the day-range clamp: a block whose
		 * min-day is past its max-day draws no line even with `showLine` on.
		 */
		lineDrawn = $derived.by(() => {
			if (!this.showLine || !this.linearRegression?.slope) return false;
			const Ndays = this.parentData?.parentPlot?.Ndays ?? 0;
			const lo = Math.max(1, this.lineMinDay ?? 1);
			const hi = Math.min(Ndays, this.lineMaxDay ?? Ndays);
			return hi >= lo;
		});

		// The selected markers in the fit's frame: x = 1-indexed day, y = absolute
		// time + periodHrs. The rows are UNWRAPPED (onsetUnwrap.js), so once the onsets
		// cross the row boundary the slope is still tau rather than the row length. A
		// line-only block has no markers, so this is empty for it.
		fitPoints = $derived({ xs: this.onsetUnwrap.xs, ys: this.onsetUnwrap.ys });

		// Whether either parameter CAN be fitted: a source-less eye-fit line has no
		// markers to fit to, so its locks must both stay Fixed.
		canFit = $derived(this.fitPoints.xs.length > 0);

		linearRegression = $derived.by(() => {
			const { xs, ys } = this.fitPoints;
			const tau = this.lockTau === 'fixed' ? this.tauValue : null;
			const theta = this.lockTheta === 'fixed' ? this.thetaValue : null;
			const res = fitLine(xs, ys, {
				tau,
				theta,
				refDay: this.fitRefDay,
				periodHrs: this.parentData.parentPlot.periodHrs
			});
			// NaN (rather than a half-finished object) is what every consumer already
			// treats as "there is no line": no markers and nothing fixed to fall back
			// on, or a single marker with both parameters free.
			if (!Number.isFinite(res.slope) || !Number.isFinite(res.intercept)) return NaN;
			return res;
		});

		// Predicted phase (marker time within periodHrs) at the line's start
		// day. Uses the regression line directly so it matches the drawn line.
		// Reports a 1-indexed reference day so the user can see where the
		// phase is anchored.
		estimatedPhase = $derived.by(() => {
			const reg = this.linearRegression;
			if (!reg || typeof reg !== 'object' || !reg.slope) return null;
			const periodHrs = this.parentData.parentPlot.periodHrs;
			// User-settable reference day (falls back to line start / day 1), clamped.
			const refDay = this.fitRefDay;
			const yPred = reg.slope * refDay + reg.intercept;
			const markerHourPred = yPred - refDay * periodHrs;
			const wrapped = wrapPhaseToRow(markerHourPred, reg.slope, periodHrs);
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

		// Reasons not to trust the automatic tau (see assessOnsetFit). Only while tau is
		// fitted from the markers: a fixed tau is the user's own value, not an estimate.
		onsetWarnings = $derived.by(() => {
			if (this.lockTau !== 'fit' || !this.canFit) return [];
			const reg = this.linearRegression;
			if (!reg || typeof reg !== 'object') return [];
			const P = this.parentData.parentPlot.periodHrs;
			return assessOnsetFit({
				unwrap: this.onsetUnwrap,
				reg,
				periodHrs: P,
				periodogramPeak: () =>
					periodogramPeak(
						this.parentData.x?.hoursSinceStart,
						this.parentData.y?.getData(),
						this.parentData.binSize || 0.25,
						P / 2,
						P * 1.5
					)
			});
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
						// Keep each other detection's true time (it may belong to the next row).
						newManualMarkers.push(
							i === periodIndex ? i * periodHrs + wrappedHour : this.markerTimes[i]
						);
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
				// MIGRATION: `fitline` was its own type until v75.3, but by then it was
				// only "a manual block with no markers and both parameters fixed", which
				// is exactly what it becomes here. Same stored (fitSlope, fitIntercept),
				// same locks, same drawn line — and now it can gain clicked markers and
				// be switched back to Fit, which the dead-end type never could.
				const legacyFitLine = dataIN.type === 'fitline';
				this.name = dataIN.name || 'marker_' + this.id;
				this.type = legacyFitLine ? 'manual' : dataIN.type || 'onset';
				this.centileThreshold = dataIN.centileThreshold || 50;
				this.templateHrsBefore = dataIN.templateHrsBefore || 3;
				this.templateHrsAfter = dataIN.templateHrsAfter || 3;
				// Default markers/line to the parent data series' colour (falls back to black).
				this.colour = dataIN.colour || parent?.colour || 'black';
				this.fitSlope = dataIN.fitSlope ?? null;
				this.fitIntercept = dataIN.fitIntercept ?? null;
				// Migration: sessions saved before the locks existed carry neither field.
				// A `fitline` was a line the user placed by hand (both parameters fixed);
				// every other block was a plain least-squares fit (both free).
				const lockDefault = legacyFitLine ? 'fixed' : 'fit';
				this.lockTau = dataIN.lockTau ?? lockDefault;
				this.lockTheta = dataIN.lockTheta ?? lockDefault;
				this.showLine = dataIN.showLine || true;
				this.showMarkers = dataIN.showMarkers || true;
				this.lineWidth = dataIN.lineWidth || 1;
				this.markerSize = dataIN.markerSize || 5;
				this.lineMinDay = dataIN.lineMinDay ?? null;
				this.lineMaxDay = dataIN.lineMaxDay ?? null;
				this.phaseRefDay = dataIN.phaseRefDay ?? null;
				// Keep only finite day indices and cap the count: a non-time X axis can
				// produce a huge/NaN period key, which would make Array.from({length})
				// below throw (RangeError) or allocate absurdly.
				const periodKeys = Object.keys(parent.dataByDays.xByPeriod)
					.map(Number)
					.filter(Number.isFinite);
				let numPeriods = periodKeys.length > 0 ? Math.max(...periodKeys) + 1 : 0;
				if (numPeriods > 20000) numPeriods = 0;
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
				// A legacy `fitline` never had markers; keep it that way whatever the
				// session happens to carry, so it still draws as a bare line.
				this.manualMarkers = legacyFitLine ? [] : dataIN.manualMarkers || [];
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
				phaseRefDay: this.phaseRefDay,
				selectedPeriods: this.selectedPeriods,
				manualMarkers: this.manualMarkers,
				fitSlope: this.fitSlope,
				fitIntercept: this.fitIntercept,
				lockTau: this.lockTau,
				lockTheta: this.lockTheta
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
				phaseRefDay: json.phaseRefDay,
				selectedPeriods: json.selectedPeriods,
				periodRangeMin: json.periodRangeMin,
				periodRangeMax: json.periodRangeMax,
				manualMarkers: json.manualMarkers,
				fitSlope: json.fitSlope,
				fitIntercept: json.fitIntercept,
				lockTau: json.lockTau,
				lockTheta: json.lockTheta
			});
		}
	}
</script>

<script>
	import { onDestroy } from 'svelte';
	import StoreValueButton from '$lib/components/inputs/StoreValueButton.svelte';
	import { recordInnerEdit } from '$lib/plots/seriesDelete.js';
	import {
		actogramPointToDayTime,
		cursorForZone,
		dragLine,
		lineZoneAt,
		pastThreshold
	} from './lineDrag.js';

	let { marker, which } = $props();
	const xscale = $derived(
		scaleLinear()
			.domain([0, marker.parentData.parentPlot.periodHrs * marker.parentData.parentPlot.doublePlot])
			.range([0, marker.parentData.parentPlot.plotwidth])
	);
	let addMarkerButtonText = $state('Add markers');

	// The number shown beside each lock: always the value of the line as DRAWN, so a
	// fitted parameter reads out its fitted value and flipping that lock to Fixed
	// keeps the same number (pinCurrentLine holds the line still).
	function fmtLockValue(m, key) {
		const reg = m.linearRegression;
		const hasLine = reg && typeof reg === 'object';
		const P = m.parentData.parentPlot.periodHrs;
		const v = hasLine
			? key === 'tau'
				? reg.slope
				: (reg.slope - P) * m.fitRefDay + reg.intercept
			: key === 'tau'
				? m.tauValue
				: m.thetaValue;
		return Number.isFinite(v) ? v.toFixed(3) : '';
	}

	// Absent statistics read as a dash, never as a fabricated number.
	function fmtStat(v) {
		return Number.isFinite(v) ? v.toFixed(3) : '\u2013';
	}

	// ---------------------------------------------------------------------------
	// DRAGGING THE LINE
	//
	// The maths lives in lineDrag.js; this is only the plumbing: pointer pixels in,
	// setTau/setTheta out. Three things it has to get right:
	//
	//  1. LAZY CAPTURE. setPointerCapture is taken on the first move past a few
	//     pixels, never on pointerdown. Capturing eagerly is what broke the
	//     in-canvas buttons in v62.4 (fixed in v62.5, commit 1540c9e5).
	//  2. ONE UNDO STEP. Moves mutate the live marker so the line follows the
	//     finger; only pointerup records, by rewinding to the pre-drag values and
	//     replaying the final ones through recordInnerEdit (the setPlotInner op).
	//     A press that did not move records nothing.
	//  3. NOT ALSO A CLICK. pointerdown stops propagation so the gesture cannot
	//     pan the canvas or start a marquee, and a moved gesture swallows the
	//     click that follows so it cannot also drop a manual marker. A press that
	//     did not move is left alone, so clicking through the line still works,
	//     and while "Add markers" is armed the line does not take the pointer at
	//     all.
	// ---------------------------------------------------------------------------
	let hoverZone = $state('middle');
	let dragging = $state(false);
	/** @type {any} */
	let gesture = null;
	/** @type {((e: Event) => void) | null} */
	let clickSwallower = null;

	function lineGeom(m) {
		const p = m.parentData.parentPlot;
		return {
			padLeft: p.padding.left,
			padTop: p.padding.top,
			plotwidth: p.plotwidth,
			eachplotheight: p.eachplotheight,
			spaceBetween: p.spaceBetween,
			periodHrs: p.periodHrs,
			doublePlot: p.doublePlot
		};
	}

	/** The drawn day span, exactly as the `plot` snippet clamps it. */
	function lineSpan(m) {
		const Ndays = m.parentData.parentPlot.Ndays;
		return { lo: Math.max(1, m.lineMinDay ?? 1), hi: Math.min(Ndays, m.lineMaxDay ?? Ndays) };
	}

	// `ownerSVGElement` is the direct route; the walk up is the fallback, because
	// jsdom leaves ownerSVGElement null on an SVG child.
	function ownerSvg(el) {
		if (el.ownerSVGElement) return el.ownerSVGElement;
		let n = el.parentNode;
		while (n && n.nodeType === 1) {
			if (n.localName === 'svg') return n;
			n = n.parentNode;
		}
		return null;
	}

	// Client pixels to the plot SVG's own pixel frame. The host's rect is measured
	// rather than using offsetX/offsetY because the plot can sit inside a scaled
	// workflow-canvas transform, where the two differ by the zoom factor. With no
	// laid-out host (an unattached tree, or jsdom) the rect is empty, and client
	// pixels then ARE the plot's own pixels.
	function pointerDayTime(el, clientX, clientY, m, geom) {
		const r = ownerSvg(el)?.getBoundingClientRect() ?? { left: 0, top: 0, width: 0, height: 0 };
		const p = m.parentData.parentPlot;
		const sx = r.width ? p.viewWidth / r.width : 1;
		const sy = r.height ? p.viewHeight / r.height : 1;
		return actogramPointToDayTime((clientX - r.left) * sx, (clientY - r.top) * sy, geom);
	}

	function handleLineHover(e, m) {
		if (dragging) return;
		const at = pointerDayTime(e.currentTarget, e.clientX, e.clientY, m, lineGeom(m));
		hoverZone = lineZoneAt(at.day, lineSpan(m));
	}

	function handleLinePointerDown(e, m) {
		if (e.button != null && e.button !== 0) return;
		// "Add markers" is armed: the plot's click-to-place owns this pointer.
		if (m.parentData.parentPlot.isAddingMarkerTo >= 0) return;
		const reg = m.linearRegression;
		if (!reg || typeof reg !== 'object') return;
		e.stopPropagation();
		e.preventDefault();
		releaseClickSwallower();

		const geom = lineGeom(m);
		const grab = pointerDayTime(e.currentTarget, e.clientX, e.clientY, m, geom);
		const refDay = m.fitRefDay;
		gesture = {
			marker: m,
			geom,
			el: e.currentTarget,
			pointerId: e.pointerId,
			zone: lineZoneAt(grab.day, lineSpan(m)),
			grab,
			startClient: { x: e.clientX, y: e.clientY },
			// The line as DRAWN, which is what the user is grabbing.
			tau: reg.slope,
			theta: (reg.slope - geom.periodHrs) * refDay + reg.intercept,
			refDay,
			before: {
				fitSlope: m.fitSlope,
				fitIntercept: m.fitIntercept,
				lockTau: m.lockTau,
				lockTheta: m.lockTheta
			},
			moved: false
		};
		hoverZone = gesture.zone;
		window.addEventListener('pointermove', handleLinePointerMove);
		window.addEventListener('pointerup', handleLinePointerUp);
		window.addEventListener('pointercancel', handleLinePointerUp);
	}

	function handleLinePointerMove(e) {
		const g = gesture;
		if (!g) return;
		if (!g.moved) {
			if (!pastThreshold(e.clientX - g.startClient.x, e.clientY - g.startClient.y)) return;
			g.moved = true;
			dragging = true;
			try {
				g.el.setPointerCapture(g.pointerId);
			} catch {
				// Some pointers (and jsdom) cannot be captured; the window listeners
				// above already deliver every move, so the drag still works.
			}
		}
		const pointer = pointerDayTime(g.el, e.clientX, e.clientY, g.marker, g.geom);
		const next = dragLine({
			zone: g.zone,
			grab: g.grab,
			pointer,
			tau: g.tau,
			theta: g.theta,
			refDay: g.refDay,
			periodHrs: g.geom.periodHrs
		});
		if (!next) return;
		if (next.theta != null) g.marker.setTheta(next.theta);
		else g.marker.setTau(next.tau);
	}

	function handleLinePointerUp() {
		const g = gesture;
		if (!g) return;
		endGesture();
		if (!g.moved) return;
		// Swallow the click this gesture is about to produce, so the drag does not
		// also drop a manual marker through the actogram's own click handler.
		clickSwallower = (ev) => {
			ev.stopPropagation();
			clickSwallower = null;
		};
		window.addEventListener('click', clickSwallower, { capture: true, once: true });

		const m = g.marker;
		const after = {
			fitSlope: m.fitSlope,
			fitIntercept: m.fitIntercept,
			lockTau: m.lockTau,
			lockTheta: m.lockTheta
		};
		// Rewind, then replay through the op layer: the whole gesture lands on the
		// undo stack as ONE step (recordInnerEdit no-ops when nothing changed).
		Object.assign(m, g.before);
		recordInnerEdit(m.parentData.parentPlot, () => Object.assign(m, after));
	}

	function endGesture() {
		const g = gesture;
		gesture = null;
		dragging = false;
		window.removeEventListener('pointermove', handleLinePointerMove);
		window.removeEventListener('pointerup', handleLinePointerUp);
		window.removeEventListener('pointercancel', handleLinePointerUp);
		if (!g) return;
		try {
			g.el.releasePointerCapture(g.pointerId);
		} catch {
			// Never captured, or the pointer is already gone.
		}
	}

	function releaseClickSwallower() {
		if (!clickSwallower) return;
		window.removeEventListener('click', clickSwallower, { capture: true });
		clickSwallower = null;
	}

	onDestroy(() => {
		endGesture();
		releaseClickSwallower();
	});
</script>

{#snippet controls(marker)}
	<div class="tableProcess-container">
		<div class="control-component-title">
			<div class="control-component-title-colour">
				<p><Editable bind:value={marker.name} /></p>
			</div>
			<div class="control-component-title-icons" {@attach tooltip('Remove this phase marker')}>
				<button
					class="icon"
					onclick={() => {
						marker.parentData.phaseMarkers = marker.parentData.phaseMarkers.filter(
							(m) => m.id !== marker.id
						);
					}}
				>
					<Icon name="trash" width={16} height={16} className="control-component-title-icon" />
				</button>
			</div>
		</div>
		<ControlInput label="Type">
			<select bind:value={marker.type}>
				<option value="onset">Onset</option>
				<option value="offset">Offset</option>
				<option value="manual">Manual</option>
			</select>
		</ControlInput>

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
				<ControlInput label="N">
					<NumberWithUnits min="0" max="100" bind:value={marker.templateHrsBefore} />
				</ControlInput>

				<ControlInput label="M">
					<NumberWithUnits min="0" max="100" bind:value={marker.templateHrsAfter} />
				</ControlInput>

				<ControlInput label="%">
					<NumberWithUnits min="0" max="100" bind:value={marker.centileThreshold} />
				</ControlInput>
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

		<!-- Per-parameter locks: τ (slope) and θ (phase at the reference day) are each
		     either fitted from the selected markers or fixed at a value the user set.
		     "Fit" is disabled when there are no markers to fit to. -->
		<div class="lock-block">
			<p class="lock-title">Line fit</p>
			{#each [{ key: 'tau', label: 'τ (hrs)', title: 'τ: the period, i.e. the slope of the line', mode: marker.lockTau }, { key: 'theta', label: 'θ (hrs)', title: 'θ: the phase, i.e. the time of day the line crosses at the reference day', mode: marker.lockTheta }] as param (param.key)}
				<div class="lock-row">
					<span class="lock-label" title={param.title}>{param.label}</span>
					<div class="segmented small" role="radiogroup" aria-label={param.label}>
						<label
							class:active={param.mode === 'fit'}
							class:disabled={!marker.canFit}
							title={marker.canFit
								? 'Fit this parameter to the selected markers'
								: 'No markers to fit to; this line is positioned by hand'}
						>
							<input
								type="radio"
								name={'lock-' + param.key + '-' + marker.id}
								value="fit"
								checked={param.mode === 'fit'}
								disabled={!marker.canFit}
								onchange={() =>
									param.key === 'tau' ? marker.setLockTau('fit') : marker.setLockTheta('fit')}
							/>
							Fit
						</label>
						<label
							class:active={param.mode === 'fixed'}
							title="Hold this parameter at the value beside it"
						>
							<input
								type="radio"
								name={'lock-' + param.key + '-' + marker.id}
								value="fixed"
								checked={param.mode === 'fixed'}
								onchange={() =>
									param.key === 'tau' ? marker.setLockTau('fixed') : marker.setLockTheta('fixed')}
							/>
							Fixed
						</label>
					</div>
					<input
						type="number"
						class="marker-value-input lock-value"
						step="0.05"
						min={param.key === 'tau' ? 1 : undefined}
						disabled={param.mode !== 'fixed'}
						value={fmtLockValue(marker, param.key)}
						onchange={(e) => {
							const v = parseFloat(/** @type {HTMLInputElement} */ (e.currentTarget).value);
							if (isNaN(v)) return;
							if (param.key === 'tau') marker.setTau(v);
							else marker.setTheta(v);
						}}
					/>
				</div>
			{/each}
			{#if marker.showLine}
				<p class="lock-hint">
					On the plot, drag the middle of the line to shift θ, or either end to change τ. Dragging
					fixes that parameter.
				</p>
			{/if}
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

			{#if marker.onsetWarnings.length > 0}
				<div class="data-warning">
					{#each marker.onsetWarnings as warning (warning)}
						<p>⚠ {warning}</p>
					{/each}
				</div>
			{/if}

			{#if marker.estimatedPhase}
				<p>
					<strong
						>Est φ (day {marker.estimatedPhase.refDay}): {marker.estimatedPhase.phase.toFixed(2)} hrs</strong
					>
					<StoreValueButton
						label="φ"
						getter={() => marker.estimatedPhase.phase}
						defaultName={'phi_' + marker.name}
						source={'Actogram phase marker (' + marker.name + ')'}
					/>
				</p>
				<ControlInput label="φ reference day">
					<input
						type="number"
						min="1"
						max={marker.parentData.parentPlot.Ndays}
						step="1"
						placeholder={String(marker.estimatedPhase.refDay)}
						value={marker.phaseRefDay ?? ''}
						onchange={(e) => {
							const v = /** @type {HTMLInputElement} */ (e.currentTarget).value;
							marker.phaseRefDay = v === '' ? null : parseInt(v, 10);
						}}
					/>
				</ControlInput>
			{/if}

			<!-- R²/RMSE always describe the line as DRAWN against this block's selected
			     markers, in every lock combination. A line with no markers to compare
			     against reports a dash, not a fabricated 1 / 0. -->
			<p>
				R²: {fmtStat(marker.linearRegression.rSquared)}
				<StoreValueButton
					label="R²"
					getter={() => marker.linearRegression.rSquared}
					defaultName={'marker_r_squared_' + marker.name}
					source={'Actogram phase marker (' + marker.name + ')'}
				/>
				&ensp;Error: {fmtStat(marker.linearRegression.rmse)}
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
					<ControlInput label="Line min day">
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
					</ControlInput>
					<ControlInput label="Line max day">
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
					</ControlInput>
				</div>
			{/if}
		{/if}
	</div>
{/snippet}

{#snippet plot(marker)}
	<!-- `lineDrawn` folds in the day-range clamp below as well, so the legend can ask
	     one question and get the same answer this gate gives. The inner `{#if hi >= lo}`
	     stays because the coordinates are computed from lo/hi. -->
	{#if marker.lineDrawn}
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
			<!-- The line's other copies, a whole τ either side of the one below: once the
			     onsets cross the row boundary the line leaves the plot and re-enters where
			     they reappear, and a double plot shows every onset twice (onsetUnwrap.js).
			     Only the primary line below takes the pointer for dragging. -->
			{#each lineCopyOffsets( { slope: marker.linearRegression.slope, intercept: marker.linearRegression.intercept, periodHrs, span: periodHrs * marker.parentData.parentPlot.doublePlot, lo, hi } ).filter((off) => off !== 0) as off (off)}
				<line
					x1={xscale(marker.linearRegression.intercept + off + (lo - 1) * dx) + padLeft}
					y1={padTop + (lo - 1) * (eph + sb)}
					x2={xscale(marker.linearRegression.intercept + off + hi * dx) + padLeft}
					y2={padTop + (hi - 1) * (eph + sb) + eph}
					stroke={marker.colour}
					stroke-width={marker.lineWidth}
				/>
			{/each}
			<!-- y at top of day d (0-indexed) = padTop + d*(eph+sb).
			     y at bottom of day d         = padTop + d*(eph+sb) + eph.
			     x at top of day d            = intercept + d*dx. -->
			{@const x1 = xscale(marker.linearRegression.intercept + (lo - 1) * dx) + padLeft}
			{@const y1 = padTop + (lo - 1) * (eph + sb)}
			{@const x2 = xscale(marker.linearRegression.intercept + hi * dx) + padLeft}
			{@const y2 = padTop + (hi - 1) * (eph + sb) + eph}
			<line {x1} {y1} {x2} {y2} stroke={marker.colour} stroke-width={marker.lineWidth} />
			<!-- A wide transparent stroke on top, so a 2 px line is still grabbable.
			     `visibleStroke` is the same idiom Line.svelte uses for its hit area. -->
			<line
				class="line-handle"
				{x1}
				{y1}
				{x2}
				{y2}
				stroke="transparent"
				stroke-width={Math.max(14, marker.lineWidth * 4)}
				style:cursor={cursorForZone(hoverZone, dragging)}
				onpointerdown={(e) => handleLinePointerDown(e, marker)}
				onpointermove={(e) => handleLineHover(e, marker)}
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
	/* The line's grab area: invisible, wide, and it must not scroll the page on
	   touch or the drag would fight the browser's own panning. */
	.line-handle {
		pointer-events: visibleStroke;
		touch-action: none;
	}

	/* Same house style as the plots' .data-warning blocks (Periodogram, SeriesBlockHeader). */
	.data-warning {
		margin: var(--space-2) 0;
		padding: 0.45rem 0.6rem;
		border-radius: 0.375rem;
		background: color-mix(in srgb, #f5c76a 18%, white);
		border: 1px solid color-mix(in srgb, #d89c1b 35%, white);
	}

	.data-warning p {
		margin: 0.15rem 0;
		font-size: 0.92em;
	}

	.lock-hint {
		font-size: var(--font-xs);
		color: var(--color-lightness-45);
		margin: 0;
	}

	.period-selection-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 4px;
	}

	.period-selection-header p {
		font-size: var(--font-sm);
		color: var(--color-lightness-35);
		margin: 0;
	}

	.period-selection-actions {
		display: flex;
		gap: 4px;
	}

	.period-select-btn {
		font-size: var(--font-xs);
		padding: 1px 6px;
		cursor: pointer;
		border: 1px solid var(--color-lightness-80);
		border-radius: var(--radius-xs);
		background: var(--color-lightness-96);
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
		border-radius: var(--radius-sm);
		padding: 4px;
	}

	.period-marker-row {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: var(--font-xs);
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
		font-size: var(--font-xs);
		padding: 1px 4px;
		border: 1px solid #ddd;
		border-radius: 2px;
		box-sizing: border-box;
	}

	.marker-value-input:focus {
		outline: none;
		border-color: #007bff;
	}

	/* Per-parameter lock rows. The control panel is narrow, so the label column is
	   fixed and the segmented switch and value field share the rest on one line. */
	.lock-block {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: var(--space-2) 0;
	}

	.lock-row {
		display: grid;
		grid-template-columns: 1fr auto 70px;
		align-items: center;
		gap: var(--space-2);
	}

	.lock-title {
		font-size: var(--font-sm);
		color: var(--color-lightness-35);
		margin: 0;
	}

	.lock-label {
		font-size: var(--font-xs);
		color: var(--color-lightness-35);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.lock-value {
		width: 100%;
	}

	.lock-value:disabled {
		background: var(--color-lightness-96);
		color: var(--color-lightness-60);
		cursor: not-allowed;
	}

	.segmented {
		display: inline-flex;
		border: 1px solid var(--color-lightness-85);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}

	.segmented label {
		padding: 0.1rem 0.5rem;
		font-size: var(--font-xs);
		line-height: 1.5;
		color: var(--color-lightness-35);
		cursor: pointer;
		user-select: none;
		background: var(--surface-card);
		transition:
			background 0.15s,
			color 0.15s;
	}

	.segmented label + label {
		border-left: 1px solid var(--color-lightness-85);
	}

	.segmented label:hover {
		background: var(--color-lightness-97);
	}

	.segmented label.active {
		background: var(--color-accent-fill);
		color: white;
		font-weight: 600;
	}

	.segmented label.disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.segmented label:focus-within {
		box-shadow: var(--shadow-focus-soft);
	}

	/* Visually hidden radios; the label carries the state. */
	.segmented input {
		position: absolute;
		opacity: 0;
		width: 1px;
		height: 1px;
		margin: 0;
		pointer-events: none;
	}
</style>
