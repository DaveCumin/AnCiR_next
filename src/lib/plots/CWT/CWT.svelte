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
	import { viewFontScale, viewStyleFor } from '$lib/plots/viewBox.js';
	import { cwtFromSeries, waveletRidge, WAVELETS } from '$lib/utils/cwt.js';
	import { colormapRGB, normaliseTo01, COLORMAP_LABELS } from '$lib/plots/Actogram/colormaps.js';

	export const CWT_defaultDataInputs = ['x', 'y'];
	export const CWT_controlHeaders = ['Properties', 'Data'];
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

	export class CWTClass {
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
		padding = $state({ top: 20, right: 70, bottom: 46, left: 62 });

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

		/** Global max, used to normalise the colour scale. */
		powerMax = $derived.by(() => {
			const tr = this.transform;
			if (!tr.valid) return 1;
			let m = 0;
			for (const row of tr.power) for (const v of row) if (Number.isFinite(v) && v > m) m = v;
			return m > 0 ? m : 1;
		});

		constructor(parent, dataIN) {
			this.parentBox = parent;
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
			const tr = this.transform;
			if (!tr.valid) return { headers: ['time', 'period', 'power'], rows: [] };
			// Tidy long, matching Histogram's export convention: one row per cell.
			const rows = [];
			for (let j = 0; j < tr.periods.length; j++) {
				for (let i = 0; i < tr.times.length; i++) {
					rows.push([tr.times[i], tr.periods[j], tr.power[j][i]]);
				}
			}
			return { headers: ['time', 'period', 'power'], rows };
		}

		toJSON() {
			return {
				padding: this.padding,
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
				data: this.data.map((d) => d.toJSON())
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
			if (Array.isArray(json.data)) c.data = json.data.map((d) => CWTSeries.fromJSON(d, c));
			else if (json.dataIn) c.addData(json.dataIn);
			return c;
		}
	}

	export const definition = {
		displayName: CWT_displayName,
		defaultDataInputs: CWT_defaultDataInputs,
		controlHeaders: CWT_controlHeaders,
		plotClass: CWTClass
	};

	/**
	 * Paint the power field to an offscreen canvas and return a data URI.
	 *
	 * Row 0 of the image is the TOP of the plot, and the top of a scalogram is the
	 * LONGEST period, so the scale index is walked in reverse.
	 *
	 * Returns '' when there is no DOM (SSR / unit tests) so the caller can fall
	 * back to a plain message instead of throwing.
	 */
	export function renderScalogramURI(power, colormap, powerMax) {
		if (typeof document === 'undefined') return '';
		const nScales = power.length;
		const nTimes = power[0]?.length ?? 0;
		if (nScales === 0 || nTimes === 0) return '';

		const canvas = document.createElement('canvas');
		canvas.width = nTimes;
		canvas.height = nScales;
		const ctx = canvas.getContext('2d');
		if (!ctx) return '';
		const img = ctx.createImageData(nTimes, nScales);

		for (let row = 0; row < nScales; row++) {
			const j = nScales - 1 - row; // longest period at the top
			for (let i = 0; i < nTimes; i++) {
				const v = power[j][i];
				const rgb = colormapRGB(colormap, normaliseTo01(v, 0, powerMax));
				const [r, g, b] = parseRGB(rgb);
				const o = (row * nTimes + i) * 4;
				img.data[o] = r;
				img.data[o + 1] = g;
				img.data[o + 2] = b;
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
</script>

<script>
	// @ts-nocheck
	import { appState } from '$lib/core/core.svelte';
	import Column from '$lib/core/Column.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';

	let { theData, which } = $props();

	const colormapOptions = Object.keys(COLORMAP_LABELS);
	const colormapLabelList = colormapOptions.map((k) => COLORMAP_LABELS[k]);
	const legendStops = Array.from({ length: 21 }, (_, i) => i / 20);

	/** Period → y pixel. Scales are log2-spaced, so a log axis is the honest one. */
	function periodToY(period, periods, h, logScale) {
		if (periods.length < 2) return h / 2;
		const lo = periods[0];
		const hi = periods[periods.length - 1];
		if (logScale) {
			const t = (Math.log(period) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
			return h - t * h;
		}
		return h - ((period - lo) / (hi - lo)) * h;
	}

	/** A handful of readable period ticks inside the rendered range. */
	function periodTicks(periods) {
		if (periods.length < 2) return [];
		const lo = periods[0];
		const hi = periods[periods.length - 1];
		const candidates = [0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 36, 48, 72, 96, 168, 336];
		const inside = candidates.filter((c) => c >= lo && c <= hi);
		return inside.length >= 2 ? inside : [lo, Math.sqrt(lo * hi), hi];
	}

	const fmtPeriod = (v) => (v >= 10 ? v.toFixed(0) : v.toFixed(1));
</script>

{#snippet plot(theData)}
	{@const plot = theData.plot}
	{@const tr = plot.transform}
	{@const W = plot.plotwidth}
	{@const H = plot.plotheight}
	<svg
		id={'plot' + plot.parentBox.id}
		width={plot.viewWidth}
		height={plot.viewHeight}
		viewBox="0 0 {plot.viewWidth} {plot.viewHeight}"
		style="background: var(--surface-card); position: absolute;"
	>
		{#if !tr.valid}
			<text
				x={plot.parentBox.width / 2}
				y={plot.parentBox.height / 2}
				text-anchor="middle"
				fill="var(--color-text-muted)"
				font-size="12"
			>
				{tr.reason === 'no data' ? 'Wire a time column and a value column.' : tr.reason}
			</text>
		{:else}
			{@const uri = renderScalogramURI(tr.power, plot.colormap, plot.powerMax)}
			{@const t0 = tr.times[0]}
			{@const t1 = tr.times[tr.times.length - 1]}
			{@const ticks = periodTicks(tr.periods)}
			<g transform="translate({plot.padding.left}, {plot.padding.top})">
				<!-- The whole power field as ONE element (see the module comment). -->
				{#if uri}
					<image href={uri} x="0" y="0" width={W} height={H} preserveAspectRatio="none" />
				{/if}

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
					<line x1="-4" y1={y} x2="0" y2={y} stroke="var(--color-lightness-50)" />
					<text
						x="-7"
						{y}
						text-anchor="end"
						dominant-baseline="central"
						font-size="10"
						fill="var(--color-lightness-25)">{fmtPeriod(p)}</text
					>
				{/each}
				<text
					transform="translate({-46}, {H / 2}) rotate(-90)"
					text-anchor="middle"
					font-size="11"
					fill="var(--color-lightness-25)">Period (hrs)</text
				>

				<!-- time axis -->
				{#each [0, 0.25, 0.5, 0.75, 1] as f (f)}
					{@const x = f * W}
					<line x1={x} y1={H} x2={x} y2={H + 4} stroke="var(--color-lightness-50)" />
					<text {x} y={H + 16} text-anchor="middle" font-size="10" fill="var(--color-lightness-25)"
						>{(t0 + f * (t1 - t0)).toFixed(0)}</text
					>
				{/each}
				<text
					x={W / 2}
					y={H + 34}
					text-anchor="middle"
					font-size="11"
					fill="var(--color-lightness-25)">Time</text
				>
			</g>

			<!-- power legend -->
			{@const lx = plot.padding.left + W + 14}
			{@const lh = Math.min(H, 150)}
			{#if lx + 36 < plot.parentBox.width}
				<g transform="translate({lx}, {plot.padding.top})">
					{#each legendStops as t, k (k)}
						<rect
							x="0"
							y={lh - (k + 1) * (lh / legendStops.length)}
							width="10"
							height={lh / legendStops.length + 0.5}
							fill={colormapRGB(plot.colormap, t)}
						/>
					{/each}
					<text x="14" y="6" font-size="9" fill="var(--color-lightness-25)">max</text>
					<text x="14" y={lh} font-size="9" fill="var(--color-lightness-25)">0</text>
					<text
						transform="translate(34, {lh / 2}) rotate(-90)"
						text-anchor="middle"
						font-size="10"
						fill="var(--color-lightness-25)">Power</text
					>
				</g>
			{/if}
		{/if}
	</svg>
{/snippet}

{#snippet controls(theData)}
	{#if appState.currentControlTab === 'properties'}
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
			<ControlInput label="Min period (hrs)">
				<NumberWithUnits bind:value={theData.periodMin} min="0.01" step="1" />
			</ControlInput>
			<ControlInput label="Max period (hrs)">
				<NumberWithUnits bind:value={theData.periodMax} min="0.1" step="1" />
			</ControlInput>
			<ControlInput label="Scale resolution (dj)">
				<NumberWithUnits bind:value={theData.dj} min="0.005" max="1" step="0.025" />
			</ControlInput>
			<ControlInput label="Colour scale">
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
