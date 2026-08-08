<script module>
	// @ts-nocheck
	// Q-Q plot — a SELF-COMPUTING normal quantile-quantile plot.
	//
	// Takes raw data columns directly (one `column` ref per wired series, exactly like the
	// Histogram / CorrelationHeatmap plots) and computes the quantile pairs ITSELF via
	// utils/qq.js — Blom plotting positions (the same convention as the Shapiro-Wilk
	// m-values in utils/normality.js), a quartile reference line (R's qqline), and a
	// pointwise confidence envelope (the car::qqPlot construction). So it stands alone —
	// wire a column in, see how the data departs from normal — with no dependency on the
	// NormalityTest node (whose Quick-Plot spawns this plot). Storage field is `column`,
	// which the workflow graph's edge detection recognises (ProcessNode checks
	// x/y/z/column), so input wires draw and upstream edits propagate.
	//
	// v1 draws the NORMAL theoretical distribution only; `distribution` is persisted (as
	// 'normal') so sessions never need migrating when other distributions are added. A
	// fit node's `resid_<y>` outputs are ordinary columns, so residual Q-Q needs nothing
	// special — just wire the residual column.
	import { Column as ColumnClass } from '$lib/core/Column.svelte';
	import { viewFontScale, viewStyleFor, scalePadding } from '$lib/plots/viewBox.js';
	import Column from '$lib/core/Column.svelte';
	import Axis, { AxisClass } from '$lib/components/plotbits/Axis.svelte';
	import { scaleLinear } from 'd3-scale';
	import ColourPicker, { getPaletteColor } from '$lib/components/inputs/ColourPicker.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import { dataSettingsScrollTo } from '$lib/components/views/ControlDisplay.svelte';
	import { qqPoints } from '$lib/utils/qq.js';

	export const QQPlot_defaultDataInputs = ['column'];
	export const QQPlot_controlHeaders = ['Properties', 'Data'];
	export const QQPlot_displayName = 'Q-Q plot';

	class QQPlotDataclass {
		static descriptors = {};

		parentPlot = $state();
		column = $state();
		label = $state('Series 1');
		colour = $state(getPaletteColor(0));
		pointRadius = $state(3);
		opacity = $state(0.85);

		constructor(parent, dataIN) {
			this.parentPlot = parent;
			if (dataIN?.column) {
				this.column = ColumnClass.fromJSON(dataIN.column);
			} else {
				this.column = new ColumnClass({ refId: -1 });
			}
			this.label = dataIN?.label ?? 'Series ' + (parent.data.length + 1);
			this.colour = dataIN?.colour ?? getPaletteColor(parent.data.length);
			this.pointRadius = dataIN?.pointRadius ?? 3;
			this.opacity = dataIN?.opacity ?? 0.85;
		}

		// Derived: the full Q-Q computation for this series' live column data.
		// { theoretical, sample, line:{slope,intercept}, band:{lo,hi}, n, dropped }
		qq = $derived.by(() => {
			const values = this.column?.getData?.() ?? [];
			if (this.column?.type === 'time' || values.length === 0) {
				return qqPoints([], {});
			}
			return qqPoints(values, {
				distribution: this.parentPlot.distribution,
				confidence: this.parentPlot.confidence
			});
		});

		getLegendItem() {
			return {
				label: this.label,
				elements: [{ type: 'points', color: this.colour, shape: 'circle', size: 4 }]
			};
		}

		toJSON() {
			return {
				column: this.column,
				label: this.label,
				colour: this.colour,
				pointRadius: this.pointRadius,
				opacity: this.opacity
			};
		}

		static fromJSON(json, parent) {
			return new QQPlotDataclass(parent, json);
		}
	}

	export class QQPlotclass {
		static descriptors = {
			padding: { group: 'Padding' },
			xlimsIN: { group: 'X-axis', _children: { 0: { label: 'X min' }, 1: { label: 'X max' } } },
			ylimsIN: { group: 'Y-axis', _children: { 0: { label: 'Y min' }, 1: { label: 'Y max' } } }
		};

		parentBox = $state();
		// Draw at the VIEW's size when one is given (a workflow node), else the figure's own.
		// See plots/viewBox.js for the whole story and why type scales with it.
		renderBox = $state(null);
		viewWidth = $derived(this.renderBox?.w ?? this.parentBox.width);
		viewHeight = $derived(this.renderBox?.h ?? this.parentBox.height);
		fontScale = $derived(viewFontScale(this.renderBox, this.parentBox));
		viewStyle = $derived(viewStyleFor(this.parentBox?.style, this.fontScale));
		data = $state(/** @type {QQPlotDataclass[]} */ ([]));
		legend = $state();

		// Stored padding belongs to the FIGURE. A view that draws the type smaller needs
		// proportionally less room for it, so `padding` reads back SCALED while a renderBox is
		// set; the raw value is what gets saved. See plots/viewBox.js.
		#padding = $state({ top: 20, right: 20, bottom: 45, left: 60 });
		paddingScaled = $derived(scalePadding(this.#padding, this.fontScale));
		get padding() {
			return this.renderBox ? this.paddingScaled : this.#padding;
		}
		set padding(v) {
			this.#padding = v;
		}
		plotheight = $derived(this.viewHeight - this.padding.top - this.padding.bottom);
		plotwidth = $derived(this.viewWidth - this.padding.left - this.padding.right);

		// v1: 'normal' only; persisted for forward compatibility (no UI until a second
		// distribution exists).
		distribution = $state('normal');
		showLine = $state(true); // quartile reference line (R qqline)
		showBand = $state(true); // pointwise confidence envelope
		confidence = $state(0.95);
		// Per-series n / dropped / r line on the Data tab. Descriptive stats only —
		// deliberately no p-value here: the NormalityTest node owns W/p.
		showStats = $state(true);

		xlimsIN = $state(/** @type {(number|null)[]} */ ([null, null]));
		ylimsIN = $state(/** @type {(number|null)[]} */ ([null, null]));

		xAxis = $state();
		yAxis = $state();

		// Auto limits: theoretical quantiles on x; sample values (plus the band when shown)
		// on y, padded 5% so end points don't sit on the frame.
		xlims = $derived.by(() => {
			let min = Infinity;
			let max = -Infinity;
			this.data.forEach((d) => {
				const t = d.qq.theoretical;
				if (t.length > 0) {
					if (t[0] < min) min = t[0];
					if (t[t.length - 1] > max) max = t[t.length - 1];
				}
			});
			if (min === Infinity || max === -Infinity) return [-1, 1];
			const pad = (max - min || 1) * 0.05;
			return [
				this.xlimsIN[0] != null ? this.xlimsIN[0] : min - pad,
				this.xlimsIN[1] != null ? this.xlimsIN[1] : max + pad
			];
		});

		ylims = $derived.by(() => {
			let min = Infinity;
			let max = -Infinity;
			this.data.forEach((d) => {
				const q = d.qq;
				for (const v of q.sample) {
					if (v < min) min = v;
					if (v > max) max = v;
				}
				if (this.showBand) {
					for (const v of q.band.lo) if (Number.isFinite(v) && v < min) min = v;
					for (const v of q.band.hi) if (Number.isFinite(v) && v > max) max = v;
				}
			});
			if (min === Infinity || max === -Infinity) return [0, 1];
			const pad = (max - min || 1) * 0.05;
			return [
				this.ylimsIN[0] != null ? this.ylimsIN[0] : min - pad,
				this.ylimsIN[1] != null ? this.ylimsIN[1] : max + pad
			];
		});

		getLegendItems = $derived.by(() => {
			const items = [];
			this.data.forEach((d) => {
				const item = d.getLegendItem();
				if (item) items.push(item);
			});
			return items;
		});

		// CSV export: one row per (series × order statistic) with the quantile pair,
		// the reference-line value at that theoretical quantile, and the envelope.
		getDownloadData() {
			const headers = ['series', 'theoretical', 'sample', 'line', 'band_lo', 'band_hi'];
			const rows = [];
			this.data.forEach((d) => {
				const q = d.qq;
				for (let i = 0; i < q.theoretical.length; i++) {
					rows.push([
						d.label,
						q.theoretical[i],
						q.sample[i],
						q.line.intercept + q.line.slope * q.theoretical[i],
						q.band.lo[i],
						q.band.hi[i]
					]);
				}
			});
			return { headers, rows };
		}

		constructor(parent, dataIN) {
			this.parentBox = parent;
			this.legend = new LegendClass(dataIN?.legend);
			this.xAxis = AxisClass.withDefaults(dataIN?.xAxis, {
				gridlines: false,
				label: 'Theoretical quantiles'
			});
			this.yAxis = AxisClass.withDefaults(dataIN?.yAxis, { label: 'Sample quantiles' });
			if (dataIN?.data) {
				dataIN.data.forEach((/** @type {any} */ d) => this.addData(d));
			}
		}

		addData(dataIN) {
			this.data.push(new QQPlotDataclass(this, dataIN));
		}

		removeData(idx) {
			this.data.splice(idx, 1);
		}

		getAutoScaleValues() {
			/** @type {Record<string, number|null>} */
			const axisWidths = { left: null, right: null, top: null, bottom: null };
			const root = document.getElementById('plot' + this.parentBox.id);
			if (!root) return axisWidths;

			// getBoundingClientRect() is in SCREEN pixels, magnified by the canvas
			// zoom (the plot renders inside a CSS scale() transform). Padding is in
			// SVG user units, so divide the measured deltas back out by the effective
			// scale — otherwise padding grows with zoom and jumps when re-measured at
			// a different zoom (e.g. when the control panel opens). See Scatterplot.
			const userWidth = Number(root.getAttribute('width')) || this.viewWidth;
			const scale = userWidth > 0 ? root.getBoundingClientRect().width / userWidth : 1;

			const allLeftAxes = root.getElementsByClassName('axis-left');
			if (allLeftAxes && allLeftAxes.length > 0) {
				const whole = allLeftAxes[0].getBoundingClientRect().left;
				const domain = allLeftAxes[0].getElementsByClassName('domain')[0];
				if (domain) {
					const line = domain.getBoundingClientRect().left;
					axisWidths.left = Math.round((line - whole) / scale + 6);
				}
			}

			const allBottomAxes = root.getElementsByClassName('axis-bottom');
			if (allBottomAxes && allBottomAxes.length > 0) {
				const whole = allBottomAxes[0].getBoundingClientRect().bottom;
				const domain = allBottomAxes[0].getElementsByClassName('domain')[0];
				if (domain) {
					const line = domain.getBoundingClientRect().bottom;
					axisWidths.bottom = Math.round((whole - line) / scale + 12);
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
			const v = this.getAutoScaleValues();
			if (side === 'all') {
				['top', 'left', 'right', 'bottom'].forEach((s) => {
					this.padding[s] = v[s] ?? this.padding[s];
				});
			} else {
				this.padding[side] = v[side] ?? this.padding[side];
			}
		}

		toJSON() {
			return {
				distribution: this.distribution,
				showLine: this.showLine,
				showBand: this.showBand,
				confidence: this.confidence,
				showStats: this.showStats,
				xlimsIN: this.xlimsIN,
				ylimsIN: this.ylimsIN,
				padding: this.#padding,
				xAxis: this.xAxis.toJSON(),
				yAxis: this.yAxis.toJSON(),
				data: this.data.map((d) => d.toJSON()),
				legend: this.legend.toJSON()
			};
		}

		static fromJSON(parent, json) {
			const chart = new QQPlotclass(parent, null);
			if (!json) return chart;
			// `?? default`: a tool-written inner (Quick-Plot) carries only `data`, and a bare
			// `=` would put `undefined` over the class default, throwing at render (see
			// plotFromJSONRobustness.test.js which drives every registered plot).
			chart.distribution = json.distribution ?? chart.distribution;
			chart.showLine = json.showLine ?? chart.showLine;
			chart.showBand = json.showBand ?? chart.showBand;
			chart.confidence = json.confidence ?? chart.confidence;
			chart.showStats = json.showStats ?? chart.showStats;
			chart.padding = json.padding ?? chart.padding;
			chart.xlimsIN = json.xlimsIN ?? chart.xlimsIN;
			chart.ylimsIN = json.ylimsIN ?? chart.ylimsIN;
			if (json.xAxis) chart.xAxis = AxisClass.fromJSON(json.xAxis);
			if (json.yAxis) chart.yAxis = AxisClass.fromJSON(json.yAxis);
			chart.legend = LegendClass.fromJSON(json.legend);
			if (json.data) {
				chart.data = json.data.map((/** @type {any} */ d) => QQPlotDataclass.fromJSON(d, chart));
			} else if (json.dataIn) {
				// Creation-time hint: wire raw column refs via the live addData path so
				// undo/redo of a brand-new plot replays its data wiring (see addPlot op).
				chart.addData(json.dataIn);
			}
			return chart;
		}
	}

	export const definition = {
		displayName: QQPlot_displayName,
		defaultDataInputs: QQPlot_defaultDataInputs,
		controlHeaders: QQPlot_controlHeaders,
		plotClass: QQPlotclass
	};

	// Envelope polygon path: hi curve left→right, lo curve right→left, closed.
	function bandPath(qq, xScale, yScale, xoff, yoff) {
		const { theoretical, band } = qq;
		if (theoretical.length < 2) return '';
		let d = '';
		for (let i = 0; i < theoretical.length; i++) {
			d += (i === 0 ? 'M' : 'L') + (xScale(theoretical[i]) + xoff) + ',' + (yScale(band.hi[i]) + yoff);
		}
		for (let i = theoretical.length - 1; i >= 0; i--) {
			d += 'L' + (xScale(theoretical[i]) + xoff) + ',' + (yScale(band.lo[i]) + yoff);
		}
		return d + 'Z';
	}
</script>

<script>
	// @ts-nocheck
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import Editable from '$lib/components/inputs/Editable.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import { appState } from '$lib/core/core.svelte';
	import { onMount, tick } from 'svelte';
	import { flip } from 'svelte/animate';
	import { slide } from 'svelte/transition';
	import Legend, { LegendClass } from '$lib/components/plotbits/Legend.svelte';
	import { usePlotMetricOutputs } from '$lib/plots/plotMetricOutputs.svelte.js';

	let { theData, which } = $props();

	// Keep the plot's metric output columns (qq_r / qq_n ports) reconciled +
	// written from the per-series qq deriveds this component already renders.
	// For which === 'plot', theData is the wrapper Plot (as in Periodogram).
	usePlotMetricOutputs(
		() => theData,
		() => which === 'plot'
	);

	onMount(() => {
		if (which === 'plot') {
			theData.plot.autoScalePadding('all');
		}
	});

	$effect(() => {
		if (which === 'controls') {
			theData.yAxis.label;
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
			<div class="control-component-title">Q-Q plot</div>
			<ControlInput label="Width"><NumberWithUnits bind:value={theData.parentBox.width} /></ControlInput>
			<ControlInput label="Height"><NumberWithUnits bind:value={theData.parentBox.height} /></ControlInput>
			<div class="control-input-checkbox" style="margin-top: var(--space-2);">
				<input type="checkbox" bind:checked={theData.showLine} />
				<p title="Reference line through the first and third quartiles (robust to tail departures)">
					Show reference line
				</p>
			</div>
			<div class="control-input-checkbox" style="margin-top: var(--space-2);">
				<input type="checkbox" bind:checked={theData.showBand} />
				<p
					title="Pointwise envelope: each quantile's plausible range under normality. About {Math.round((1 - theData.confidence) * 100)}% of points stray outside it even for perfectly normal data."
				>
					Show confidence envelope
				</p>
			</div>
			{#if theData.showBand}
				<ControlInput label="Confidence level">
					<NumberWithUnits bind:value={theData.confidence} min="0.5" max="0.999" step="0.01" />
				</ControlInput>
			{/if}
			<div class="control-input-checkbox" style="margin-top: var(--space-2);">
				<input type="checkbox" bind:checked={theData.showStats} />
				<p
					title="Per-series values used (n), dropped-value count, and the probability-plot correlation r — how tightly the points follow a straight line (1 = the sample's shape matches the normal exactly). Descriptive only; for a formal normality test use the Normality Test node."
				>
					Show series statistics
				</p>
			</div>
		</div>

		<div class="div-line"></div>

		<Legend legendData={theData.legend} figureStyle={theData.parentBox?.style} which="controls" />

		<div class="control-component">
			<div class="control-component-title">
				<p>Padding</p>
			</div>
			<div class="control-input-square">
				<ControlInput label="Top">
					<NumberWithUnits bind:value={theData.padding.top} />
				</ControlInput>
				<ControlInput label="Bottom">
					<NumberWithUnits bind:value={theData.padding.bottom} />
				</ControlInput>
				<ControlInput label="Left">
					<NumberWithUnits bind:value={theData.padding.left} />
				</ControlInput>
				<ControlInput label="Right">
					<NumberWithUnits bind:value={theData.padding.right} />
				</ControlInput>
			</div>
		</div>

		<div class="div-line"></div>

		<Axis axisData={theData.yAxis} which="controls" title="Y-Axis" />

		<div class="control-component">
			<div class="control-input-horizontal">
				<ControlInput label="Y min">
					<NumberWithUnits
						value={theData.ylimsIN[0] ?? theData.ylims[0]}
						onInput={(/** @type {string} */ v) => (theData.ylimsIN[0] = parseFloat(v))}
					/>
				</ControlInput>
				<ControlInput label="Y max">
					<NumberWithUnits
						value={theData.ylimsIN[1] ?? theData.ylims[1]}
						onInput={(/** @type {string} */ v) => (theData.ylimsIN[1] = parseFloat(v))}
					/>
				</ControlInput>
				{#if theData.ylimsIN[0] != null || theData.ylimsIN[1] != null}
					<div class="control-component-input-icons">
						<button
							class="icon"
							onclick={() => (theData.ylimsIN = [null, null])}
							title="Revert to automatic range"
						>
							<Icon name="reset" width={14} height={14} className="control-component-input-icon" />
						</button>
					</div>
				{/if}
			</div>
		</div>

		<div class="div-line"></div>

		<Axis axisData={theData.xAxis} which="controls" title="X-Axis" />

		<div class="control-component">
			<div class="control-input-horizontal">
				<ControlInput label="X min">
					<NumberWithUnits
						value={theData.xlimsIN[0] ?? theData.xlims[0]}
						onInput={(/** @type {string} */ v) => (theData.xlimsIN[0] = parseFloat(v))}
					/>
				</ControlInput>
				<ControlInput label="X max">
					<NumberWithUnits
						value={theData.xlimsIN[1] ?? theData.xlims[1]}
						onInput={(/** @type {string} */ v) => (theData.xlimsIN[1] = parseFloat(v))}
					/>
				</ControlInput>
				{#if theData.xlimsIN[0] != null || theData.xlimsIN[1] != null}
					<div class="control-component-input-icons">
						<button
							class="icon"
							onclick={() => (theData.xlimsIN = [null, null])}
							title="Revert to automatic range"
						>
							<Icon name="reset" width={14} height={14} className="control-component-input-icon" />
						</button>
					</div>
				{/if}
			</div>
		</div>
	{:else if appState.currentControlTab === 'data'}
		<div id="dataSettings">
			<div class="control-data-add">
				<div class="add">
					<button
						class="icon"
						title="Add a series"
						onclick={async () => {
							theData.addData({});
							await tick();
							dataSettingsScrollTo('bottom');
						}}
					>
						<Icon name="add" width={16} height={16} />
					</button>
				</div>
			</div>

			<p class="qq-hint">
				Wire any numeric column — e.g. a fit node's resid_ output to check whether its
				residuals are normal.
			</p>

			{#each theData.data as datum, i (datum.column.id)}
				<div
					class="dataBlock"
					animate:flip={{ duration: 500 }}
					in:slide={{ duration: 500, axis: 'y' }}
					out:slide={{ duration: 500, axis: 'y' }}
				>
					<div class="control-component-title">
						<p><Editable bind:value={datum.label} /></p>
						<button class="icon" onclick={() => theData.removeData(i)}>
							<Icon name="trash" width={16} height={16} className="control-component-title-icon" />
						</button>
					</div>

					<div class="data-wrapper">
						<div class="y-select">
							<ControlInput label="Column"></ControlInput>
							<Column col={datum.column} canChange={true} />
						</div>

						{#if datum.column?.type === 'time'}
							<div class="data-warning">
								<p>⚠ A Q-Q plot of a time column is meaningless. Pick a numeric column.</p>
							</div>
						{:else if datum.column?.refId >= 0 && datum.qq.n > 0 && datum.qq.n < 3}
							<div class="data-warning">
								<p>⚠ At least 3 valid values are needed ({datum.qq.n} present).</p>
							</div>
						{/if}

						{#if theData.showStats && datum.qq.n >= 3}
							<!-- Consolidated stats line (subsumes the dropped-count warning below).
							     r is descriptive — no p-value here; the NormalityTest node owns W/p. -->
							<p
								class="qq-stats"
								title="n: values used. dropped: missing / non-numeric values excluded. r: probability-plot correlation — how tightly the points follow a straight line (1 = shape matches the normal exactly). Descriptive only; use the Normality Test node for a formal test."
							>
								n = {datum.qq.n}{datum.qq.dropped > 0
									? `, dropped ${datum.qq.dropped}`
									: ''}, r = {datum.qq.r == null ? 'n/a' : datum.qq.r.toFixed(3)}
							</p>
						{:else if datum.qq.dropped > 0}
							<div class="data-warning">
								<p>
									⚠ {datum.qq.dropped} missing / non-numeric value{datum.qq.dropped === 1
										? ''
										: 's'} dropped
								</p>
							</div>
						{/if}

						<div class="control-input-horizontal">
							<div class="control-input">
								<p>Colour</p>
								<ColourPicker bind:value={datum.colour} />
							</div>
							<ControlInput label="Point size">
								<NumberWithUnits bind:value={datum.pointRadius} min="0.5" step="0.5" />
							</ControlInput>
							<ControlInput label="Opacity">
								<NumberWithUnits bind:value={datum.opacity} min="0" max="1" step="0.05" />
							</ControlInput>
						</div>
					</div>
					<div class="div-line"></div>
				</div>
			{/each}
		</div>
	{/if}
{/snippet}

{#snippet plot(theData)}
	{@const xScale = scaleLinear()
		.domain([theData.plot.xlims[0], theData.plot.xlims[1]])
		.range([0, theData.plot.plotwidth])}
	{@const yScale = scaleLinear()
		.domain([theData.plot.ylims[0], theData.plot.ylims[1]])
		.range([theData.plot.plotheight, 0])}
	{@const hasData = theData.plot.data.some((d) => d.qq.n >= 3)}
	<svg
		id={'plot' + theData.plot.parentBox.id}
		width={theData.plot.viewWidth}
		height={theData.plot.viewHeight}
		viewBox="0 0 {theData.plot.viewWidth} {theData.plot.viewHeight}"
		style={`background: var(--surface-card); position: absolute;`}
	>
		{#if !hasData}
			<text
				x={theData.plot.viewWidth / 2}
				y={theData.plot.viewHeight / 2}
				text-anchor="middle"
				fill="var(--color-text-muted)"
				font-size="12"
			>
				Wire a numeric column (3+ values) to see its normal Q-Q plot.
			</text>
		{:else}
			<clipPath id={'qqclip' + theData.plot.parentBox.id}>
				<rect
					x={theData.plot.padding.left}
					y={theData.plot.padding.top}
					width={theData.plot.plotwidth}
					height={theData.plot.plotheight}
				/>
			</clipPath>
			<Axis
				figureStyle={theData.plot.viewStyle}
				height={theData.plot.plotheight}
				width={theData.plot.plotwidth}
				scale={yScale}
				position="left"
				plotPadding={theData.plot.padding}
				axisData={theData.plot.yAxis}
				which="plot"
			/>
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

			<g clip-path="url(#{'qqclip' + theData.plot.parentBox.id})">
				{#each theData.plot.data as datum}
					{@const q = datum.qq}
					{#if q.n >= 3}
						{#if theData.plot.showBand && Number.isFinite(q.line.slope)}
							<path
								d={bandPath(q, xScale, yScale, theData.plot.padding.left, theData.plot.padding.top)}
								fill={datum.colour}
								fill-opacity="0.12"
								stroke="none"
							/>
						{/if}
						{#if theData.plot.showLine && Number.isFinite(q.line.slope)}
							<line
								x1={xScale(theData.plot.xlims[0]) + theData.plot.padding.left}
								y1={yScale(q.line.intercept + q.line.slope * theData.plot.xlims[0]) +
									theData.plot.padding.top}
								x2={xScale(theData.plot.xlims[1]) + theData.plot.padding.left}
								y2={yScale(q.line.intercept + q.line.slope * theData.plot.xlims[1]) +
									theData.plot.padding.top}
								stroke={datum.colour}
								stroke-width="1.5"
								stroke-dasharray="5 3"
							/>
						{/if}
						{#each q.theoretical as t, i}
							<circle
								cx={xScale(t) + theData.plot.padding.left}
								cy={yScale(q.sample[i]) + theData.plot.padding.top}
								r={datum.pointRadius}
								fill={datum.colour}
								fill-opacity={datum.opacity}
							/>
						{/each}
					{/if}
				{/each}
			</g>

			<Legend
				figureStyle={theData.plot.viewStyle}
				legendData={theData.plot.legend}
				items={theData.plot.getLegendItems}
				plotWidth={theData.plot.plotwidth}
				plotHeight={theData.plot.plotheight}
				padding={theData.plot.padding}
				which="plot"
			/>
		{/if}
	</svg>
{/snippet}

{#if which === 'plot'}
	{@render plot(theData)}
{:else if which === 'controls'}
	{@render controls(theData)}
{/if}

<style>
	.control-component-title {
		font-weight: 600;
		font-size: var(--font-sm);
		margin-bottom: var(--space-2);
	}
	.qq-hint {
		font-size: 0.85em;
		color: var(--color-text-muted);
		margin: 0.2rem 0 0.4rem;
	}
	.qq-stats {
		font-size: 0.85em;
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
		margin: 0.4rem 0 0;
	}
	.data-warning {
		margin-top: 0.4rem;
		padding: 0.45rem 0.6rem;
		border-radius: 0.375rem;
		background: color-mix(in srgb, #f5c76a 18%, white);
		border: 1px solid color-mix(in srgb, #d89c1b 35%, white);
	}
	.data-warning p {
		margin: 0.15rem 0;
		font-size: 0.92em;
	}
</style>
