<script module>
	// @ts-nocheck
	// Continuous wavelet transform — a SCALOGRAM: power as a function of time (x)
	// and period (y), with the cone of influence and an optional ridge overlay.
	//
	// Self-contained like CorrelationHeatmap: wire a time column and a value
	// column and it runs the transform itself via utils/cwt.js (Torrence & Compo
	// 1998). Storage fields are `x`/`y`, which the workflow graph's edge detection
	// recognises, so input wires draw and upstream edits propagate.
	//
	// RENDERING NOTE — the one thing that makes this plot different from every
	// other plot in the app. A scalogram is far denser than anything else drawn
	// here: 7 days at 1-minute epochs over 60 scales is ~600,000 cells, and the
	// app's usual one-<rect>-per-cell approach would lock the browser solid. So
	// the power field is painted to an OFFSCREEN CANVAS and embedded as a single
	// <image> element; axes, COI, ridge and legend stay ordinary SVG on top. One
	// element regardless of resolution, and SVG/PNG export still works.
	import { Column as ColumnClass } from '$lib/core/Column.svelte';
	import {
		viewFontScale,
		viewStyleFor,
		scalePadding,
		viewPadFloorFor
	} from '$lib/plots/viewBox.js';
	import { cwtFromSeries, waveletRidge, WAVELETS } from '$lib/utils/cwt.js';
	import { cwtTimeAxis, exportTimeOf } from './cwtTimeAxis.js';
	import {
		colormapRGB,
		normaliseTo01,
		COLORMAP_LABELS
	} from '$lib/components/plotbits/colormaps.js';
	import {
		ColourScaleClass,
		colourScaleGeometry,
		scaleTickValues,
		formatScaleValue
	} from '$lib/components/plotbits/ColourScale.svelte';
	import { LEGEND_MARGIN } from '$lib/components/plotbits/legendLayout.js';
	import { resolveStyle } from '$lib/plots/figureStyle.js';
	import { scaleLinear, scaleLog } from 'd3-scale';
	import { OverlayClass } from '$lib/components/plotbits/Overlay.svelte';
	import { overlaysFromJSON, overlaysToJSON } from '$lib/components/plotbits/overlayHost.js';

	export const CWT_defaultDataInputs = ['x', 'y'];
	export const CWT_controlHeaders = ['Properties', 'Data', 'Overlays'];
	export const CWT_displayName = 'Wavelet (CWT)';

	class CWTSeries {
		parentPlot = $state();
		x = $state();
		y = $state();

		constructor(parent, dataIN) {
			this.parentPlot = parent;
			// `time` is aliased to `x` the way the actogram family does it, so a
			// friendlier public name still stores under the field the graph reads.
			const xJSON = dataIN?.x ?? dataIN?.time;
			this.x = xJSON ? ColumnClass.fromJSON(xJSON) : new ColumnClass({ refId: -1 });
			const yJSON = dataIN?.y ?? dataIN?.values;
			this.y = yJSON ? ColumnClass.fromJSON(yJSON) : new ColumnClass({ refId: -1 });
		}
		toJSON() {
			return { x: this.x, y: this.y };
		}
		static fromJSON(json, parent) {
			return new CWTSeries(parent, json);
		}
	}

	/** Period → y pixel. Scales are log2-spaced, so a log axis is the honest one. */
	export function periodToY(period, periods, h, logScale) {
		if (periods.length < 2) return h / 2;
		const lo = periods[0];
		const hi = periods[periods.length - 1];
		if (logScale) {
			const t = (Math.log(period) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
			return h - t * h;
		}
		return h - ((period - lo) / (hi - lo)) * h;
	}

	export class CWTClass {
		// The overlay host contract (components/plotbits/overlayHost.js): HORIZONTAL reference
		// lines and bands on the period axis only (a line at 24 h, a 20 to 28 h circadian band).
		// The x axis is hours since the start of the record; a vertical mark there is deferred
		// (overlays plan, step 4). Nothing widens: the period range is the range the transform
		// is COMPUTED over, so a reference mark must never change it, and a mark outside it is
		// not drawn (its block says so). No series legend, so no Label field.
		static overlayCapabilities = Object.freeze({
			line: Object.freeze(['horizontal']),
			band: Object.freeze(['horizontal']),
			legend: false,
			xTime: false,
			domain: Object.freeze([])
		});

		static descriptors = { padding: { group: 'Padding' } };

		parentBox = $state();
		// Draw at the VIEW's size when one is given (a workflow node), else the figure's own.
		// See plots/viewBox.js for the whole story and why type scales with it.
		renderBox = $state(null);
		viewWidth = $derived(this.renderBox?.w ?? this.parentBox.width);
		viewHeight = $derived(this.renderBox?.h ?? this.parentBox.height);
		fontScale = $derived(viewFontScale(this.renderBox, this.parentBox));
		viewStyle = $derived(viewStyleFor(this.parentBox?.style, this.fontScale));
		data = $state([]);
		// Stored padding belongs to the FIGURE. A view that draws the type smaller needs
		// proportionally less room for it, so `padding` reads back SCALED while a renderBox is
		// set; the raw value is what gets saved. See plots/viewBox.js.
		#padding = $state({ top: 20, right: 70, bottom: 46, left: 62 });
		// A node view's own measured floor (fitViewPadding, plots/viewBox.js); never saved.
		viewPadFloor = $state(null);
		paddingScaled = $derived(
			scalePadding(
				this.#padding,
				this.fontScale,
				viewPadFloorFor(this.viewPadFloor, this.renderBox)
			)
		);
		get padding() {
			const p = this.renderBox ? this.paddingScaled : this.#padding;
			return this.keyRoom > p.right ? { ...p, right: this.keyRoom } : p;
		}
		set padding(v) {
			this.#padding = v;
		}
		// The stored figure padding, for the Padding controls. While a node view is mounted
		// `padding` reads back a derived, scaled copy, so an edit bound there was lost.
		get figurePadding() {
			return this.#padding;
		}

		wavelet = $state('morlet');
		waveletParam = $state(6);
		dj = $state(0.125);
		periodMin = $state(1);
		periodMax = $state(48);
		colormap = $state('viridis');
		rectify = $state(true);
		showCOI = $state(true);
		showRidge = $state(false);
		logScale = $state(true);
		// The gradient key for the power field. DEFAULT ON, which is the opposite of
		// the five plots that gained a SERIES legend, and for the same reason: this
		// plot has always drawn a colour bar, so ON is what leaves a saved figure
		// looking as it did. Turning it off is now possible, which it was not before.
		colourScale = $state();

		plotheight = $derived(this.viewHeight - this.padding.top - this.padding.bottom);
		plotwidth = $derived(this.viewWidth - this.padding.left - this.padding.right);

		transform = $derived.by(() => {
			const d = this.data[0];
			// hoursSinceStart, NOT getData(): a `time` column's raw data is epoch
			// MILLISECONDS, so a raw read makes dt 1.8e6 and reports every period in
			// ms (a 24 h rhythm comes out as 86,400,000). hoursSinceStart converts
			// time -> hours and re-bases number/bin columns to start at 0, which is
			// exactly what Periodogram and FFT already do. All the period params on
			// this plot are in HOURS, so the x axis has to be too.
			const t = d?.x?.hoursSinceStart ?? [];
			const v = d?.y?.getData?.() ?? [];
			if (t.length === 0 || v.length === 0) {
				return { valid: false, reason: 'no data', periods: [], power: [], coi: [], times: [] };
			}
			return cwtFromSeries(t, v, {
				wavelet: this.wavelet,
				param: this.waveletParam,
				dj: this.dj,
				rectify: this.rectify,
				periodRange: [this.periodMin, this.periodMax]
			});
		});

		ridge = $derived.by(() => {
			const tr = this.transform;
			if (!tr.valid || !this.showRidge) return { ridgePeriod: [], ridgePower: [] };
			return waveletRidge(tr);
		});

		/**
		 * The room the power key takes beside the plot (its "Beside plot" place, a vertical bar):
		 * the legend margin and the key's width as drawn (colourScaleGeometry, text measured in
		 * the view's family). The right padding is never less, so the key is never squeezed back
		 * over the scalogram: the raw (unrectified) power's five-digit labels need more than the
		 * stored 70 px, and the clamp in ColourScale.svelte pushed the bar onto the plot frame.
		 * 0 when the key is hidden, inside the plot, or horizontal (its length follows the plot
		 * width, so it is not reserved for).
		 */
		keyRoom = $derived.by(() => {
			const cs = this.colourScale;
			if (!cs?.show || cs.position !== 'right' || cs.orientation === 'horizontal') return 0;
			const style = resolveStyle(this.viewStyle);
			const g = colourScaleGeometry({
				vertical: true,
				thickness: cs.barThickness ?? 10,
				barLen: 0,
				fontSize: cs.fontSize ?? style.sizes.legend,
				tickLabels: scaleTickValues([0, this.powerMax]).map(formatScaleValue),
				label: 'Power',
				fontFamily: style.fontFamily
			});
			return Math.ceil(LEGEND_MARGIN + g.width);
		});

		/** Global max, used to normalise the colour scale. */
		powerMax = $derived.by(() => {
			const tr = this.transform;
			if (!tr.valid) return 1;
			let m = 0;
			for (const row of tr.power) for (const v of row) if (Number.isFinite(v) && v > m) m = v;
			return m > 0 ? m : 1;
		});

		// ---- overlay host (components/plotbits/overlayHost.js) ----------------------------
		// Reference lines and shaded bands, in draw order.
		overlays = $state([]);
		// The plot's own axes, as d3 scales (the scalogram draws with periodToY): hours since
		// the start on x, period on y from the shortest period (bottom) to the longest (top),
		// log or linear exactly as periodToY maps them. Before a transform exists, the
		// requested period range stands in.
		overlayXScale = $derived.by(() => {
			const times = this.transform.times ?? [];
			const t0 = times.length ? times[0] : 0;
			const t1 = times.length ? times[times.length - 1] : 1;
			return scaleLinear().domain([t0, t1]).range([0, this.plotwidth]);
		});
		overlayYScale = $derived.by(() => {
			const periods = this.transform.periods ?? [];
			const domain =
				periods.length >= 2
					? [periods[0], periods[periods.length - 1]]
					: [this.periodMin, this.periodMax];
			return (this.logScale ? scaleLog() : scaleLinear())
				.domain(domain)
				.range([this.plotheight, 0]);
		});

		/** Add an overlay of `kind` ('line' | 'band'); it is always horizontal here. */
		addOverlay(kind, form) {
			const overlay = new OverlayClass(this, { kind, form });
			this.overlays.push(overlay);
			return overlay;
		}

		removeOverlay(id) {
			const idx = this.overlays.findIndex((o) => o.id === id);
			if (idx >= 0) this.overlays.splice(idx, 1);
		}

		/** The draw context every overlay's geometry() takes (hours since the start). */
		overlayContext() {
			const [t0, t1] = this.overlayXScale.domain();
			return { xDomainMin: t0, xDomainMax: t1, xAnchorMin: t0, xIsTime: false };
		}

		/** A band's default fill never reads it (no ribbon here); kept for the contract. */
		overlaySeriesColour() {
			return null;
		}

		/**
		 * A horizontal line at period `v` is drawn at `v`, or not at all outside the period
		 * range: nothing widens here, so such a line would only be placed off the plot and
		 * clipped (its block's note says it is not drawn).
		 */
		overlayHorizontalLineAt(v) {
			const [lo, hi] = this.overlayYScale.domain();
			const tol = Math.abs(hi - lo) * 1e-9;
			return v >= Math.min(lo, hi) - tol && v <= Math.max(lo, hi) + tol ? v : null;
		}

		/** The remedy an Overlays-tab block offers when its mark is outside the period range. */
		overlayRangeHint(axis) {
			return axis === 'y'
				? 'Overlays never widen the period range, because it is the range the scalogram is computed over; change Min and Max period in Properties.'
				: null;
		}

		constructor(parent, dataIN) {
			this.parentBox = parent;
			this.colourScale = ColourScaleClass.withDefaults(dataIN?.colourScale, { show: true });
			if (dataIN?.x || dataIN?.y || dataIN?.time || dataIN?.values) this.addData(dataIN);
		}

		addData(dataIN) {
			// One series: a scalogram shows a single signal. Replace rather than
			// stack, so re-wiring the input does the obvious thing.
			const s = new CWTSeries(this, dataIN);
			if (this.data.length === 0) this.data.push(s);
			else this.data[0] = s;
		}
		removeData() {
			this.data = [];
		}
		autoScalePadding() {}

		getDownloadData() {
			// Times in the record's own time, as the axis shows them (cwtTimeAxis.js).
			return scalogramExport(this.transform, CWT_EXPORT_MAX_ROWS, exportTimeOf(this.data[0]?.x));
		}

		toJSON() {
			return {
				padding: this.#padding,
				wavelet: this.wavelet,
				waveletParam: this.waveletParam,
				dj: this.dj,
				periodMin: this.periodMin,
				periodMax: this.periodMax,
				colormap: this.colormap,
				rectify: this.rectify,
				showCOI: this.showCOI,
				showRidge: this.showRidge,
				logScale: this.logScale,
				colourScale: this.colourScale.toJSON(),
				data: this.data.map((d) => d.toJSON()),
				overlays: overlaysToJSON(this.overlays)
			};
		}
		static fromJSON(parent, json) {
			const c = new CWTClass(parent, null);
			if (!json) return c;
			// Every field uses ?? so a partial inner (a Quick-Plot writes only
			// `data`) keeps the class defaults instead of undefined.
			c.padding = json.padding ?? c.padding;
			c.wavelet = json.wavelet ?? c.wavelet;
			c.waveletParam = json.waveletParam ?? c.waveletParam;
			c.dj = json.dj ?? c.dj;
			c.periodMin = json.periodMin ?? c.periodMin;
			c.periodMax = json.periodMax ?? c.periodMax;
			c.colormap = json.colormap ?? c.colormap;
			c.rectify = json.rectify ?? c.rectify;
			c.showCOI = json.showCOI ?? c.showCOI;
			c.showRidge = json.showRidge ?? c.showRidge;
			c.logScale = json.logScale ?? c.logScale;
			// withDefaults, not fromJSON: a CWT saved before the scale was a persisted
			// object has no `colourScale` key, and it must come back ON so the figure
			// keeps the bar it already had.
			c.colourScale = ColourScaleClass.withDefaults(json.colourScale, { show: true });
			if (Array.isArray(json.data)) c.data = json.data.map((d) => CWTSeries.fromJSON(d, c));
			else if (json.dataIn) c.addData(json.dataIn);
			// After the series, as on every host. A session saved before the scalogram had
			// overlays carries none; a saved vertical mark is coerced to horizontal.
			overlaysFromJSON(c, json);
			return c;
		}
	}

	export const definition = {
		displayName: CWT_displayName,
		defaultDataInputs: CWT_defaultDataInputs,
		controlHeaders: CWT_controlHeaders,
		plotClass: CWTClass
	};

	/** Most rows "Download data" / "View data" produce for a scalogram. See scalogramExport. */
	export const CWT_EXPORT_MAX_ROWS = 250_000;

	/**
	 * The scalogram as a tidy long table (time, period, power), one row per cell, matching
	 * Histogram's export convention.
	 *
	 * A cell per sample per period does not scale: 250,000 samples x 45 periods is over 11
	 * million rows, a CSV of hundreds of MB and a View data table that cannot render. When
	 * the full grid exceeds `maxRows`, time is binned (power averaged over consecutive
	 * samples, each row's time the mean time of its bin) to the most time points that fit;
	 * every period is kept. The result then carries a `note` saying so, which the CSV
	 * download shows to the user.
	 *
	 * `toTime` turns the transform's hours since the first sample into the record's own time
	 * (exportTimeOf); the default leaves them as they are.
	 */
	export function scalogramExport(tr, maxRows = CWT_EXPORT_MAX_ROWS, toTime = (h) => h) {
		const headers = ['time', 'period', 'power'];
		if (!tr?.valid) return { headers, rows: [] };
		const nP = tr.periods.length;
		const nT = tr.times.length;
		const maxCols = Math.max(1, Math.floor(maxRows / Math.max(1, nP)));
		let times = tr.times;
		let power = tr.power;
		let note = null;
		if (nT > maxCols) {
			times = downsampleColumns([tr.times], maxCols)[0];
			power = downsampleColumns(tr.power, maxCols);
			const perBin = (nT / maxCols).toFixed(1);
			note =
				`The full scalogram is ${nT.toLocaleString('en')} time points x ${nP} periods ` +
				`(${(nT * nP).toLocaleString('en')} cells). To keep the export under ` +
				`${maxRows.toLocaleString('en')} rows, power is averaged over about ${perBin} ` +
				`consecutive samples per row, and each row's time is the mean time of its samples.`;
		}
		const rows = [];
		for (let j = 0; j < nP; j++) {
			for (let i = 0; i < times.length; i++) {
				rows.push([toTime(times[i]), tr.periods[j], power[j][i]]);
			}
		}
		return note ? { headers, rows, note } : { headers, rows };
	}

	/**
	 * Most image columns the scalogram is painted with. One column per sample made a
	 * 250,000-sample record a 250,000 px wide canvas: past the browsers' canvas size
	 * limits, so the plot came out blank (and it cost millions of colour lookups).
	 * The image is stretched to the plot width anyway, a few hundred pixels.
	 */
	export const SCALOGRAM_MAX_COLUMNS = 4096;

	/**
	 * Bin the time axis of a power field (rows = scales) down to at most `maxCols`
	 * columns, averaging the finite values in each bin (NaN if a bin has none).
	 * Returns the input unchanged when it is already narrow enough.
	 */
	export function downsampleColumns(power, maxCols) {
		const nTimes = power[0]?.length ?? 0;
		if (nTimes <= maxCols) return power;
		return power.map((row) => {
			const out = new Float64Array(maxCols);
			for (let c = 0; c < maxCols; c++) {
				const i0 = Math.floor((c * nTimes) / maxCols);
				const i1 = Math.floor(((c + 1) * nTimes) / maxCols);
				let sum = 0;
				let n = 0;
				for (let i = i0; i < i1; i++) {
					const v = row[i];
					if (Number.isFinite(v)) {
						sum += v;
						n++;
					}
				}
				out[c] = n > 0 ? sum / n : NaN;
			}
			return out;
		});
	}

	/**
	 * Image rows the scalogram is painted with (at least one per scale). Each row is H / 1024
	 * px tall at most, under a pixel for any plot up to 1024 px.
	 */
	export const SCALOGRAM_IMAGE_ROWS = 1024;

	/**
	 * What each image row shows, row 0 at the TOP of the plot (the longest period):
	 * `{ j0, j1, w }`, row r painted as scale j0[r]'s colours blended with scale j1[r]'s at
	 * weight w[r] (0 = all j0).
	 *
	 * The image is resampled onto the axis it is drawn against: SCALOGRAM_IMAGE_ROWS evenly
	 * spaced rows, each at the period of its centre on that axis (log or linear), blending the
	 * two scales whose periods bracket it by its distance from each in log period. So each
	 * scale's colour is exactly at its own period, where periodToY puts its tick, the cone,
	 * the ridge and the overlays, and it fades into its neighbours in between.
	 *
	 * Both axes used to go wrong differently. On a LINEAR axis one evenly spaced row per
	 * (log2-spaced) scale put the 24 h power at about 26 h on a 4 to 30 h axis (fixed in
	 * v82.54). On a LOG axis the same one-row-per-scale image was half a row off at the edges:
	 * n rows stretched over the axis put scale j's row centre at (j + 0.5) / n of the height,
	 * while its tick is at j / (n - 1), so the shortest and longest periods sat half a row
	 * inside the plot (6 px at the default 0.125 octave spacing on a 300 px plot).
	 * Mirrored by tools/ancir_runtime.py cwt_image_rows.
	 */
	export function scalogramImageRows(periods, logScale, nRows = SCALOGRAM_IMAGE_ROWS) {
		const n = periods.length;
		if (n < 2) {
			const j = Int32Array.from({ length: n }, () => 0);
			return { j0: j, j1: j, w: new Float64Array(n) };
		}
		const lo = periods[0];
		const hi = periods[n - 1];
		// The period at fraction f of the way up the axis.
		const periodAt = logScale ? (f) => lo * (hi / lo) ** f : (f) => lo + f * (hi - lo);
		const R = Math.max(n, nRows);
		const j0 = new Int32Array(R);
		const j1 = new Int32Array(R);
		const w = new Float64Array(R);
		let k = 1; // walking up from the bottom row: periods[k - 1] <= p <= periods[k]
		for (let r = R - 1; r >= 0; r--) {
			const p = periodAt(1 - (r + 0.5) / R);
			while (k < n - 1 && periods[k] < p) k++;
			j0[r] = k - 1;
			j1[r] = k;
			const t = Math.log(p / periods[k - 1]) / Math.log(periods[k] / periods[k - 1]);
			w[r] = Math.min(1, Math.max(0, t));
		}
		return { j0, j1, w };
	}

	/**
	 * Paint the power field to an offscreen canvas and return a data URI.
	 *
	 * Row 0 of the image is the TOP of the plot, and the top of a scalogram is the
	 * LONGEST period. `rows` says what each image row shows (scalogramImageRows); without
	 * it, the scales are taken as evenly spaced on a log axis (as cwt.js spaces them).
	 *
	 * Returns '' when there is no DOM (SSR / unit tests) so the caller can fall
	 * back to a plain message instead of throwing.
	 */
	export function renderScalogramURI(power, colormap, powerMax, rows = null) {
		if (typeof document === 'undefined') return '';
		power = downsampleColumns(power, SCALOGRAM_MAX_COLUMNS);
		const nScales = power.length;
		const nTimes = power[0]?.length ?? 0;
		if (nScales === 0 || nTimes === 0) return '';
		rows =
			rows ??
			scalogramImageRows(
				power.map((_, j) => 2 ** j),
				true
			);
		const nRows = rows.j0.length;
		if (nRows === 0) return '';

		const canvas = document.createElement('canvas');
		canvas.width = nTimes;
		canvas.height = nRows;
		const ctx = canvas.getContext('2d');
		if (!ctx) return '';
		const img = ctx.createImageData(nTimes, nRows);

		// Each scale's colours once (the colour lookup is the costly part), then every row
		// blended from its two scales' (scalogramImageRows).
		const scaleRGB = new Array(nScales);
		const rgbOf = (j) => {
			if (scaleRGB[j]) return scaleRGB[j];
			const px = new Uint8Array(nTimes * 3);
			for (let i = 0; i < nTimes; i++) {
				const [r, g, b] = parseRGB(colormapRGB(colormap, normaliseTo01(power[j][i], 0, powerMax)));
				px[i * 3] = r;
				px[i * 3 + 1] = g;
				px[i * 3 + 2] = b;
			}
			return (scaleRGB[j] = px);
		};
		for (let row = 0; row < nRows; row++) {
			const a = rgbOf(rows.j0[row]);
			const wt = rows.w[row];
			const b = wt > 0 ? rgbOf(rows.j1[row]) : a;
			const base = row * nTimes * 4;
			for (let i = 0; i < nTimes; i++) {
				const o = base + i * 4;
				for (let c = 0; c < 3; c++) {
					const va = a[i * 3 + c];
					img.data[o + c] = wt > 0 ? Math.round(va + (b[i * 3 + c] - va) * wt) : va;
				}
				img.data[o + 3] = 255;
			}
		}
		ctx.putImageData(img, 0, 0);
		return canvas.toDataURL('image/png');
	}

	/** colormapRGB returns 'rgb(r, g, b)'; pull the three channels back out. */
	function parseRGB(s) {
		const m = /rgb\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(String(s));
		return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
	}

	// An end of the period axis gets its own labelled tick when the nearest readable period is
	// at least this fraction of the axis away: the axis starts at the shortest period the data
	// allow (about 1.03 h at 30 min sampling), so "1" falls just outside it and the bottom of
	// the axis was left unlabelled below "2".
	const END_TICK_GAP = 0.08;

	/**
	 * The labelled periods: the readable ones inside the range, plus an end of the range when
	 * the nearest readable period is far from it; else the ends and their geometric mean.
	 * @param {number[]} periods  ascending
	 * @param {boolean} [logScale]
	 * @returns {number[]}
	 */
	export function periodTicks(periods, logScale = true) {
		if (periods.length < 2) return [];
		const lo = periods[0];
		const hi = periods[periods.length - 1];
		const candidates = [0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 36, 48, 72, 96, 168, 336];
		const inside = candidates.filter((c) => c >= lo && c <= hi);
		if (inside.length < 2) return [lo, Math.sqrt(lo * hi), hi];
		const at = (v) => 1 - periodToY(v, periods, 1, logScale);
		const out = [...inside];
		if (at(inside[0]) - at(lo) >= END_TICK_GAP) out.unshift(lo);
		if (at(hi) - at(inside[inside.length - 1]) >= END_TICK_GAP) out.push(hi);
		return out;
	}

	/**
	 * A period label: a whole number as it is ("2", "12"), anything else to 3 significant
	 * figures ("0.5", "1.03"). It used to be one decimal below 10 and none above, so the axis
	 * read "2.0, 3.0, ... 12, 16".
	 * @param {number} v
	 */
	export function fmtPeriod(v) {
		if (Number.isInteger(v)) return String(v);
		return String(Number(v.toPrecision(3)));
	}
</script>

<script>
	// @ts-nocheck
	import { appState } from '$lib/core/core.svelte';
	import Column from '$lib/core/Column.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import ColourScale from '$lib/components/plotbits/ColourScale.svelte';
	import OverlayLayers from '$lib/components/plotbits/OverlayLayers.svelte';
	import OverlaysTab from '$lib/components/plotbits/OverlaysTab.svelte';

	let { theData, which } = $props();

	const colormapOptions = Object.keys(COLORMAP_LABELS);
	const colormapLabelList = colormapOptions.map((k) => COLORMAP_LABELS[k]);

	/** A handful of readable period ticks inside the rendered range. */
</script>

{#snippet plot(theData)}
	{@const plot = theData.plot}
	{@const tr = plot.transform}
	{@const W = plot.plotwidth}
	{@const H = plot.plotheight}
	<!-- Type, and the offsets that make room for it, scale with the view (a workflow node
	     draws smaller type and its padding shrinks to match, see plots/viewBox.js). At fixed
	     sizes the axis titles and the colour legend were pushed off a node's edge and cut. -->
	{@const fs = plot.fontScale}
	<svg
		id={'plot' + plot.parentBox.id}
		width={plot.viewWidth}
		height={plot.viewHeight}
		viewBox="0 0 {plot.viewWidth} {plot.viewHeight}"
		style="background: var(--surface-card); position: absolute;"
	>
		{#if !tr.valid}
			<text
				x={plot.viewWidth / 2}
				y={plot.viewHeight / 2}
				text-anchor="middle"
				fill="var(--color-text-muted)"
				font-size={12 * fs}
			>
				{tr.reason === 'no data' ? 'Wire a time column and a value column.' : tr.reason}
			</text>
		{:else}
			{@const uri = renderScalogramURI(
				tr.power,
				plot.colormap,
				plot.powerMax,
				scalogramImageRows(tr.periods, plot.logScale)
			)}
			{@const t0 = tr.times[0]}
			{@const t1 = tr.times[tr.times.length - 1]}
			{@const ticks = periodTicks(tr.periods, plot.logScale)}
			{@const timeAxis = cwtTimeAxis({ t0, t1, width: W, xCol: plot.data[0]?.x })}
			<g transform="translate({plot.padding.left}, {plot.padding.top})">
				<!-- The whole power field as ONE element (see the module comment). -->
				{#if uri}
					<image href={uri} x="0" y="0" width={W} height={H} preserveAspectRatio="none" />
				{/if}
			</g>

			<!-- Shaded bands OVER the power image (an opaque image would hide anything beneath
			     it) and under the cone of influence, ridge and axes. The layers place themselves
			     at the padding, so they sit between the two translated groups. -->
			<OverlayLayers inner={plot} layer="bands" />

			<g transform="translate({plot.padding.left}, {plot.padding.top})">
				<!-- Cone of influence: everything OUTSIDE the curve is edge-contaminated. -->
				{#if plot.showCOI && tr.coi.length}
					{@const step = Math.max(1, Math.floor(tr.times.length / 240))}
					{@const pts = tr.times
						.map((t, i) => ({ t, i }))
						.filter(({ i }) => i % step === 0 || i === tr.times.length - 1)
						.map(({ t, i }) => {
							const px = ((t - t0) / (t1 - t0 || 1)) * W;
							const period = Math.max(
								tr.periods[0],
								Math.min(tr.periods[tr.periods.length - 1], tr.coi[i])
							);
							return px + ',' + periodToY(period, tr.periods, H, plot.logScale);
						})
						.join(' ')}
					<polyline
						points={pts}
						fill="none"
						stroke="#fff"
						stroke-width="1.5"
						stroke-dasharray="4 3"
						opacity="0.85"
					/>
					<!-- Shade the contaminated region so it reads as "do not interpret". -->
					<polygon
						points={'0,0 ' + pts + ' ' + W + ',0'}
						fill="var(--surface-card)"
						opacity="0.45"
					/>
				{/if}

				<!-- Ridge: dominant period at each time. -->
				{#if plot.showRidge && plot.ridge.ridgePeriod.length}
					{@const step = Math.max(1, Math.floor(tr.times.length / 400))}
					{@const rpts = tr.times
						.map((t, i) => ({ t, i }))
						.filter(({ i }) => i % step === 0 && Number.isFinite(plot.ridge.ridgePeriod[i]))
						.map(({ t, i }) => {
							const px = ((t - t0) / (t1 - t0 || 1)) * W;
							return px + ',' + periodToY(plot.ridge.ridgePeriod[i], tr.periods, H, plot.logScale);
						})
						.join(' ')}
					{#if rpts}
						<polyline points={rpts} fill="none" stroke="#ff3b30" stroke-width="1.5" opacity="0.9" />
					{/if}
				{/if}

				<rect x="0" y="0" width={W} height={H} fill="none" stroke="var(--color-lightness-75)" />

				<!-- period axis -->
				{#each ticks as p (p)}
					{@const y = periodToY(p, tr.periods, H, plot.logScale)}
					<line class="tick" x1="-4" y1={y} x2="0" y2={y} stroke="var(--color-lightness-50)" />
					<text
						x={-(4 + 3 * fs)}
						{y}
						text-anchor="end"
						dominant-baseline="central"
						font-size={10 * fs}
						fill="var(--color-lightness-25)">{fmtPeriod(p)}</text
					>
				{/each}
				<text
					transform="translate({-(4 + 42 * fs)}, {H / 2}) rotate(-90)"
					text-anchor="middle"
					font-size={11 * fs}
					fill="var(--color-lightness-25)">Period (h)</text
				>

				<!-- time axis, in the column's own time (cwtTimeAxis.js) -->
				{#each timeAxis.ticks as tick, ti (ti)}
					<line
						class="tick"
						x1={tick.x}
						y1={H}
						x2={tick.x}
						y2={H + 4}
						stroke="var(--color-lightness-50)"
					/>
					<text
						x={tick.x}
						y={H + 4 + 12 * fs}
						text-anchor="middle"
						font-size={10 * fs}
						fill="var(--color-lightness-25)">{tick.label}</text
					>
				{/each}
				<text
					x={W / 2}
					y={H + 4 + 30 * fs}
					text-anchor="middle"
					font-size={11 * fs}
					fill="var(--color-lightness-25)">{timeAxis.title}</text
				>
			</g>

			<!-- Reference lines above the scalogram, its cone of influence and ridge. -->
			<OverlayLayers inner={plot} layer="lines" />

			<!-- Power key: the shared colour-scale legend. Drawn OUTSIDE the padding
			     translate above because the component applies the padding itself, the same
			     way the series legend does on the eleven plots that have one.

			     The power field is a canvas <image>, so this is the only part of the key
			     that is real SVG; it sits above the image and exports with it. -->
			<ColourScale
				scaleData={plot.colourScale}
				colormap={plot.colormap}
				domain={[0, plot.powerMax]}
				label="Power"
				plotWidth={W}
				plotHeight={H}
				padding={plot.padding}
				idPrefix={'cwt-' + plot.parentBox.id}
				figureStyle={plot.viewStyle}
				which="plot"
			/>
		{/if}
	</svg>
{/snippet}

{#snippet controls(theData)}
	{#if appState.currentControlTab === 'properties'}
		<!-- First in the Properties tab, where every legend control in the app lives. -->
		<ColourScale
			scaleData={theData.colourScale}
			figureStyle={theData.parentBox?.style}
			which="controls"
		/>
		<div class="control-component">
			<div class="control-component-title">Wavelet transform</div>
			<ControlInput label="Width">
				<NumberWithUnits bind:value={theData.parentBox.width} />
			</ControlInput>
			<ControlInput label="Height">
				<NumberWithUnits bind:value={theData.parentBox.height} />
			</ControlInput>
			<ControlInput label="Wavelet">
				<AttributeSelect
					bind:value={theData.wavelet}
					options={WAVELETS}
					optionsDisplay={['Morlet', 'Paul', 'DOG (Mexican hat)']}
				/>
			</ControlInput>
			<ControlInput label={theData.wavelet === 'morlet' ? 'omega0' : 'order m'}>
				<NumberWithUnits bind:value={theData.waveletParam} min="1" step="1" />
			</ControlInput>
			<ControlInput label="Min period (h)">
				<NumberWithUnits bind:value={theData.periodMin} min="0.01" step="1" />
			</ControlInput>
			<ControlInput label="Max period (h)">
				<NumberWithUnits bind:value={theData.periodMax} min="0.1" step="1" />
			</ControlInput>
			<ControlInput label="Scale resolution (dj)">
				<NumberWithUnits bind:value={theData.dj} min="0.005" max="1" step="0.025" />
			</ControlInput>
			<ControlInput label="Colour map">
				<AttributeSelect
					bind:value={theData.colormap}
					options={colormapOptions}
					optionsDisplay={colormapLabelList}
				/>
			</ControlInput>
			<ControlInput label="Cone of influence">
				<input type="checkbox" bind:checked={theData.showCOI} />
			</ControlInput>
			<ControlInput label="Ridge (dominant period)">
				<input type="checkbox" bind:checked={theData.showRidge} />
			</ControlInput>
			<ControlInput label="Rectify power">
				<input type="checkbox" bind:checked={theData.rectify} />
			</ControlInput>
			<ControlInput label="Log period axis">
				<input type="checkbox" bind:checked={theData.logScale} />
			</ControlInput>
			{#if !theData.rectify}
				<p class="cwt-hint">
					Unrectified power grows with scale, so long periods look brighter than equally strong
					short ones. Rectified is the right choice for reading a scalogram; turn it off for raw
					Torrence-Compo power or the most accurate peak period.
				</p>
			{/if}
		</div>
	{:else if appState.currentControlTab === 'data'}
		<div id="dataSettings">
			{#each theData.data as datum, i (i)}
				<div class="control-component">
					<div class="control-component-title">Signal</div>
					<Column col={datum.x} canChange={true} />
					<Column col={datum.y} canChange={true} />
				</div>
			{/each}
			{#if theData.data.length === 0}
				<p class="cwt-hint">Wire a time column and a value column.</p>
			{/if}
		</div>
	{:else if appState.currentControlTab === 'overlays'}
		<OverlaysTab inner={theData} />
	{/if}
{/snippet}

{#if which === 'plot'}
	{@render plot(theData)}
{:else if which === 'controls'}
	{@render controls(theData)}
{/if}

<style>
	.cwt-hint {
		font-size: var(--font-size-small, 0.8rem);
		color: var(--color-text-muted);
		margin: var(--space-2) 0;
	}
</style>
