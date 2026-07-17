<script module>
	import { Column as ColumnClass } from '$lib/core/Column.svelte';
	import Column from '$lib/core/Column.svelte';
	import Axis, { AxisClass } from '$lib/components/plotbits/Axis.svelte';
	import { scaleLinear } from 'd3-scale';
	import Hist from '$lib/components/plotbits/Hist.svelte';
	import Line from '$lib/components/plotbits/Line.svelte';
	import ColourPicker, { getPaletteColor } from '$lib/components/inputs/ColourPicker.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import { binData, max } from '$lib/components/plotbits/helpers/wrangleData.js';
	import { gaussianKDE } from '$lib/utils/kde.js';
	import { dataSettingsScrollTo } from '$lib/components/views/ControlDisplay.svelte';
	import { niceAxisLimit } from '$lib/plots/Boxplot/Boxplot.svelte';

	export const Histogram_defaultDataInputs = ['column'];
	export const Histogram_controlHeaders = ['Properties', 'Data'];
	export const Histogram_displayName = 'Histogram';

	class HistogramDataclass {
		static descriptors = {};

		parentPlot = $state();
		column = $state();
		label = $state('Histogram 1');
		binMode = $state('uniform'); // 'uniform' | 'cuts'
		binSize = $state(1);
		binStart = $state(/** @type {number|null} */ (null));
		stepSize = $state(/** @type {number|null} */ (null));
		diffStep = $state(false);
		cuts = $state(/** @type {number[]} */ ([]));
		fillColour = $state(getPaletteColor(0));
		fillOpacity = $state(0.5);
		strokeWidth = $state(1);
		stroke = $state('#000000');
		showDensity = $state(false);
		bandwidth = $state(/** @type {number|null} */ (null)); // null = Silverman auto
		showCounts = $state(false);

		constructor(parent, dataIN) {
			this.parentPlot = parent;
			if (dataIN?.column) {
				this.column = ColumnClass.fromJSON(dataIN.column);
			} else {
				this.column = new ColumnClass({ refId: -1 });
			}
			this.label = dataIN?.label ?? 'Histogram ' + (parent.data.length + 1);
			this.binMode = dataIN?.binMode === 'cuts' ? 'cuts' : 'uniform';
			this.binSize = dataIN?.binSize ?? 1;
			this.binStart = dataIN?.binStart ?? null;
			this.stepSize = dataIN?.stepSize ?? null;
			this.diffStep = dataIN?.diffStep ?? false;
			this.cuts = Array.isArray(dataIN?.cuts) ? dataIN.cuts.slice() : [];
			this.fillColour = dataIN?.fillColour ?? getPaletteColor(parent.data.length);
			this.fillOpacity = dataIN?.fillOpacity ?? 0.5;
			this.strokeWidth = dataIN?.strokeWidth ?? 1;
			this.stroke = dataIN?.stroke ?? '#000000';
			// New fields; tolerate old sessions (undefined → defaults).
			this.showDensity = dataIN?.showDensity ?? false;
			this.bandwidth = dataIN?.bandwidth ?? null;
			this.showCounts = dataIN?.showCounts ?? false;
		}

		autoBinStart = $derived.by(() => {
			const values = this.column?.getData?.() ?? [];
			const valid = values.filter((value) => value != null && !isNaN(value));
			if (this.column?.type === 'time' || valid.length === 0) return 0;
			return Math.floor(Math.min(...valid));
		});

		effectiveBinStart = $derived(this.binStart ?? this.autoBinStart);

		// Derived: compute bins/counts from the current column + bin config.
		// Returns { bins, binEnds, y_out, droppedCount } from the helper.
		binned = $derived.by(() => {
			const values = this.column?.getData?.() ?? [];
			if (this.column?.type === 'time' || values.length === 0) {
				return { bins: [], binEnds: [], y_out: [], droppedCount: 0 };
			}
			const cutsArg =
				this.binMode === 'cuts' ? [...new Set(this.cuts)].sort((a, b) => a - b) : null;
			if (this.binMode === 'cuts' && (!cutsArg || cutsArg.length < 2)) {
				return { bins: [], binEnds: [], y_out: [], droppedCount: 0 };
			}
			const step = this.diffStep ? this.stepSize : this.binSize;
			return binData(
				values,
				values,
				this.binSize,
				this.effectiveBinStart,
				/** @type {any} */ (step),
				'count',
				/** @type {any} */ (cutsArg)
			);
		});

		// Derived: Gaussian KDE curve, scaled to the COUNT axis so it overlays the
		// bars. A density f(x) predicts ≈ N·binWidth·f(x) counts in a bin of that
		// width, so the overlay height is density × N × binWidth. Returns
		// { x:number[], y:number[] } in data coords (empty when off / not enough data).
		// Computed regardless of showDensity so the curve's data is always available
		// for export (getDownloadData); the `density` derived below gates DISPLAY.
		kdeCurve() {
			const values = this.column?.getData?.() ?? [];
			if (this.column?.type === 'time' || values.length === 0) return { x: [], y: [] };
			const valid = values.filter((v) => v != null && !isNaN(v));
			if (valid.length < 2) return { x: [], y: [] };
			const kde = gaussianKDE(valid, {
				bandwidth: this.bandwidth != null && this.bandwidth > 0 ? this.bandwidth : null,
				gridSize: 128
			});
			if (kde.x.length === 0) return { x: [], y: [] };
			const b = this.binned;
			let binWidth;
			if (this.binMode === 'cuts') {
				// Custom edges: variable widths → use the mean bin width for scaling.
				let sum = 0;
				let count = 0;
				for (let i = 0; i < b.bins.length; i++) {
					sum += b.binEnds[i] - b.bins[i];
					count++;
				}
				binWidth = count > 0 ? sum / count : 1;
			} else {
				binWidth = this.binSize;
			}
			const scale = valid.length * binWidth;
			return { x: kde.x, y: kde.density.map((d) => d * scale) };
		}

		density = $derived.by(() => (this.showDensity ? this.kdeCurve() : { x: [], y: [] }));

		getLegendItem() {
			return {
				label: this.label,
				elements: [
					{
						type: 'boxplot',
						color: this.stroke,
						fillColor: this.fillColour,
						fillOpacity: this.fillOpacity
					}
				]
			};
		}

		toJSON() {
			return {
				column: this.column,
				label: this.label,
				binMode: this.binMode,
				binSize: this.binSize,
				binStart: this.binStart,
				stepSize: this.stepSize,
				diffStep: this.diffStep,
				cuts: this.cuts,
				fillColour: this.fillColour,
				fillOpacity: this.fillOpacity,
				strokeWidth: this.strokeWidth,
				stroke: this.stroke,
				showDensity: this.showDensity,
				bandwidth: this.bandwidth,
				showCounts: this.showCounts
			};
		}

		static fromJSON(json, parent) {
			return new HistogramDataclass(parent, json);
		}
	}

	export class Histogramclass {
		static descriptors = {
			padding: { group: 'Padding' },
			xlimsIN: { group: 'X-axis', _children: { 0: { label: 'X min' }, 1: { label: 'X max' } } },
			ylimsIN: { group: 'Y-axis', _children: { 0: { label: 'Y min' }, 1: { label: 'Y max' } } }
		};

		parentBox = $state();
		data = $state(/** @type {HistogramDataclass[]} */ ([]));
		legend = $state();

		padding = $state({ top: 15, right: 30, bottom: 30, left: 50 });
		plotheight = $derived(this.parentBox.height - this.padding.top - this.padding.bottom);
		plotwidth = $derived(this.parentBox.width - this.padding.left - this.padding.right);

		xlimsIN = $state(/** @type {(number|null)[]} */ ([null, null]));
		ylimsIN = $state(/** @type {(number|null)[]} */ ([null, null]));

		xAxis = $state();
		yAxis = $state();

		xlims = $derived.by(() => {
			let xmin = Infinity;
			let xmax = -Infinity;
			this.data.forEach((d) => {
				const b = d.binned;
				if (b.bins.length > 0) {
					if (b.bins[0] < xmin) xmin = b.bins[0];
					const lastEnd = b.binEnds[b.binEnds.length - 1];
					if (lastEnd > xmax) xmax = lastEnd;
				}
			});
			if (xmin === Infinity || xmax === -Infinity) return [0, 1];
			return [
				this.xlimsIN[0] != null ? this.xlimsIN[0] : xmin,
				this.xlimsIN[1] != null ? this.xlimsIN[1] : xmax
			];
		});

		ylims = $derived.by(() => {
			let ymax = 0;
			this.data.forEach((d) => {
				const b = d.binned;
				if (b.y_out.length > 0) {
					const m = max(b.y_out);
					if (m != null && m > ymax) ymax = m;
				}
			});
			if (ymax === 0) ymax = 1;
			return [
				this.ylimsIN[0] != null ? this.ylimsIN[0] : 0,
				this.ylimsIN[1] != null ? this.ylimsIN[1] : niceAxisLimit(ymax, 'ceil')
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

		// CSV export: one row per (series × bin) with start/end/count
		// Tidy long export so the three computed datasets travel in one table
		// (Data View / CSV): the binned counts, the KDE density curve (count-scaled,
		// as drawn), and the raw values that went into the histogram. `kind`
		// distinguishes them; `series` labels which histogram series each row is from.
		//   kind='bin'     → x_start=bin start, x_end=bin end, value=count
		//   kind='density' → x_start=grid x,    x_end='',      value=density height
		//   kind='raw'     → x_start=value,     x_end='',      value=value
		getDownloadData() {
			const headers = ['series', 'kind', 'x_start', 'x_end', 'value'];
			const rows = [];
			this.data.forEach((d) => {
				const label = d.label;
				const b = d.binned;
				for (let i = 0; i < b.bins.length; i++) {
					rows.push([label, 'bin', b.bins[i], b.binEnds[i], b.y_out[i]]);
				}
				const curve = d.kdeCurve();
				for (let i = 0; i < curve.x.length; i++) {
					rows.push([label, 'density', curve.x[i], '', curve.y[i]]);
				}
				const raw = (d.column?.getData?.() ?? []).filter((v) => v != null && !isNaN(v));
				for (const v of raw) {
					rows.push([label, 'raw', v, '', v]);
				}
			});
			return { headers, rows };
		}

		constructor(parent, dataIN) {
			this.parentBox = parent;
			this.legend = new LegendClass(dataIN?.legend);
			this.xAxis = AxisClass.withDefaults(dataIN?.xAxis, { gridlines: false });
			this.yAxis = AxisClass.withDefaults(dataIN?.yAxis, { label: 'Count' });
			if (dataIN?.data) {
				dataIN.data.forEach((/** @type {any} */ d) => this.addData(d));
			}
		}

		addData(dataIN) {
			this.data.push(new HistogramDataclass(this, dataIN));
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
			const scale =
				this.parentBox.width > 0 ? root.getBoundingClientRect().width / this.parentBox.width : 1;

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
				xlimsIN: this.xlimsIN,
				ylimsIN: this.ylimsIN,
				padding: this.padding,
				xAxis: this.xAxis.toJSON(),
				yAxis: this.yAxis.toJSON(),
				data: this.data.map((d) => d.toJSON()),
				legend: this.legend.toJSON()
			};
		}

		static fromJSON(parent, json) {
			if (!json) return new Histogramclass(parent, null);
			const chart = new Histogramclass(parent, null);
			// `?? default`: a tool-written inner carries only `data`, and a bare `=` put
			// `undefined` over the class default, throwing at render (see Boxplot, and
			// plotFromJSONRobustness.test.js which now drives every registered plot).
			chart.padding = json.padding ?? chart.padding;
			chart.xlimsIN = json.xlimsIN ?? chart.xlimsIN;
			chart.ylimsIN = json.ylimsIN ?? chart.ylimsIN;
			if (json.xAxis) chart.xAxis = AxisClass.fromJSON(json.xAxis);
			if (json.yAxis) chart.yAxis = AxisClass.fromJSON(json.yAxis);
			chart.legend = LegendClass.fromJSON(json.legend);
			if (json.data) {
				chart.data = json.data.map((/** @type {any} */ d) => HistogramDataclass.fromJSON(d, chart));
			} else if (json.dataIn) {
				// Creation-time hint: wire raw column refs via the live addData path so
				// undo/redo of a brand-new plot replays its data wiring (see addPlot op).
				chart.addData(json.dataIn);
			}
			return chart;
		}
	}

	export const definition = {
		displayName: Histogram_displayName,
		defaultDataInputs: Histogram_defaultDataInputs,
		controlHeaders: Histogram_controlHeaders,
		plotClass: Histogramclass
	};
</script>

<script>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import Editable from '$lib/components/inputs/Editable.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import { appState } from '$lib/core/core.svelte';
	import { onMount, tick } from 'svelte';
	import { flip } from 'svelte/animate';
	import { slide } from 'svelte/transition';
	import Legend, { LegendClass } from '$lib/components/plotbits/Legend.svelte';

	let { theData, which } = $props();

	function parseCutsText(/** @type {string} */ text) {
		const parts = text.split(/[,\s]+/).filter(Boolean);
		const nums = parts.map(parseFloat).filter((n) => !isNaN(n));
		return [...new Set(nums)].sort((a, b) => a - b);
	}

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
			<div class="control-component-title">
				<p>Dimension</p>
			</div>
			<div class="control-input-horizontal">
				<ControlInput label="Width">
					<NumberWithUnits bind:value={theData.parentBox.width} />
				</ControlInput>
				<ControlInput label="Height">
					<NumberWithUnits bind:value={theData.parentBox.height} />
				</ControlInput>
			</div>
		</div>

		<div class="div-line"></div>

		<Legend legendData={theData.legend} which="controls" />

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
								<p>
									⚠ Histograms of time-typed columns are not supported in this version. Pick a
									numeric column.
								</p>
							</div>
						{/if}

						<ControlInput label="Bin mode">
							<select bind:value={datum.binMode} disabled={datum.column?.type === 'time'}>
								<option value="uniform">Uniform</option>
								<option value="cuts">Custom edges</option>
							</select>
						</ControlInput>

						{#if datum.binMode === 'cuts'}
							<ControlInput label="Cut edges (comma- or space-separated)">
								<input
									type="text"
									value={datum.cuts.join(', ')}
									oninput={(e) => {
										const target = /** @type {HTMLInputElement} */ (e.currentTarget);
										datum.cuts = parseCutsText(target.value);
									}}
									placeholder="e.g. 0, 1, 2.5, 5, 10"
								/>
								<p class="cuts-summary">
									{#if datum.cuts.length >= 2}
										{datum.cuts.length} edges → {datum.cuts.length - 1} bins
									{:else}
										Enter at least 2 distinct numeric edges
									{/if}
								</p>
							</ControlInput>
						{:else}
							<div class="control-input-horizontal">
								<ControlInput label="Bin size">
									<NumberWithUnits bind:value={datum.binSize} min="0.0001" step="0.01" />
								</ControlInput>
								<ControlInput label="Bin start">
									<NumberWithUnits
										value={datum.binStart ?? datum.autoBinStart}
										onInput={(/** @type {string} */ v) => (datum.binStart = parseFloat(v))}
									/>
								</ControlInput>
								{#if datum.binStart != null}
									<div class="control-component-input-icons">
										<button
											class="icon"
											onclick={() => (datum.binStart = null)}
											title="Revert to automatic bin start"
										>
											<Icon
												name="reset"
												width={14}
												height={14}
												className="control-component-input-icon"
											/>
										</button>
									</div>
								{/if}
							</div>
						{/if}

						{#if datum.binned.droppedCount > 0}
							<div class="data-warning">
								<p>
									⚠ {datum.binned.droppedCount} value{datum.binned.droppedCount === 1 ? '' : 's'} dropped
									(outside bin range)
								</p>
							</div>
						{/if}

						<div class="control-input-horizontal">
							<div class="control-input">
								<p>Fill</p>
								<ColourPicker bind:value={datum.fillColour} />
							</div>
							<div class="control-input">
								<p>Stroke</p>
								<ColourPicker bind:value={datum.stroke} />
							</div>
							<ControlInput label="Opacity">
								<NumberWithUnits bind:value={datum.fillOpacity} min="0" max="1" step="0.05" />
							</ControlInput>
							<ControlInput label="Stroke width">
								<NumberWithUnits bind:value={datum.strokeWidth} min="0" step="0.5" />
							</ControlInput>
						</div>

						<div class="control-input-checkbox" style="margin-top: var(--space-3);">
							<input
								type="checkbox"
								bind:checked={datum.showCounts}
								disabled={datum.column?.type === 'time'}
							/>
							<p>Show count labels</p>
						</div>

						<div class="control-input-checkbox" style="margin-top: var(--space-2);">
							<input
								type="checkbox"
								bind:checked={datum.showDensity}
								disabled={datum.column?.type === 'time'}
							/>
							<p>Show density curve (KDE)</p>
						</div>

						{#if datum.showDensity}
							<div class="control-input-horizontal">
								<ControlInput label="Bandwidth (blank = auto)">
									<input
										type="number"
										min="0"
										step="0.1"
										value={datum.bandwidth ?? ''}
										placeholder="auto"
										oninput={(e) => {
											const target = /** @type {HTMLInputElement} */ (e.currentTarget);
											const n = parseFloat(target.value);
											datum.bandwidth = isNaN(n) || n <= 0 ? null : n;
										}}
									/>
								</ControlInput>
								{#if datum.bandwidth != null}
									<div class="control-component-input-icons">
										<button
											class="icon"
											onclick={() => (datum.bandwidth = null)}
											title="Revert to automatic bandwidth (Silverman)"
										>
											<Icon
												name="reset"
												width={14}
												height={14}
												className="control-component-input-icon"
											/>
										</button>
									</div>
								{/if}
							</div>
						{/if}
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
	<svg
		id={'plot' + theData.plot.parentBox.id}
		width={theData.plot.parentBox.width}
		height={theData.plot.parentBox.height}
		viewBox="0 0 {theData.plot.parentBox.width} {theData.plot.parentBox.height}"
		style={`background: var(--surface-card); position: absolute;`}
	>
		<Axis
			height={theData.plot.plotheight}
			width={theData.plot.plotwidth}
			scale={yScale}
			position="left"
			plotPadding={theData.plot.padding}
			axisData={theData.plot.yAxis}
			which="plot"
		/>
		<Axis
			height={theData.plot.plotheight}
			width={theData.plot.plotwidth}
			scale={xScale}
			position="bottom"
			plotPadding={theData.plot.padding}
			axisData={theData.plot.xAxis}
			which="plot"
		/>

		{#each theData.plot.data as datum}
			{@const b = datum.binned}
			{#if b.bins.length > 0}
				<g
					style:fill-opacity={datum.fillOpacity}
					style:stroke={datum.stroke}
					style:stroke-width={datum.strokeWidth}
				>
					<Hist
						xStart={b.bins}
						xEnd={b.binEnds}
						y={b.y_out}
						xscale={xScale}
						yscale={yScale}
						colour={datum.fillColour}
						xoffset={theData.plot.padding.left}
						yoffset={theData.plot.padding.top}
					/>
				</g>

				{#if datum.showDensity && datum.density.x.length > 1}
					<Line
						lineData={{
							draw: true,
							colour: datum.stroke,
							strokeWidth: Math.max(1.5, datum.strokeWidth),
							stroke: 'solid',
							joinGaps: true
						}}
						x={datum.density.x}
						y={datum.density.y}
						xscale={xScale}
						yscale={yScale}
						xoffset={theData.plot.padding.left}
						yoffset={theData.plot.padding.top}
						which="plot"
					/>
				{/if}

				{#if datum.showCounts}
					{#each b.bins as _binStart, i}
						{#if b.y_out[i] > 0}
							<text
								x={xScale((b.bins[i] + b.binEnds[i]) / 2) + theData.plot.padding.left}
								y={yScale(b.y_out[i]) + theData.plot.padding.top - 3}
								text-anchor="middle"
								font-size="10"
								fill="var(--color-text)"
								style="pointer-events: none;">{b.y_out[i]}</text
							>
						{/if}
					{/each}
				{/if}
			{/if}
		{/each}

		<Legend
			legendData={theData.plot.legend}
			items={theData.plot.getLegendItems}
			plotWidth={theData.plot.plotwidth}
			plotHeight={theData.plot.plotheight}
			padding={theData.plot.padding}
			which="plot"
		/>
	</svg>
{/snippet}

{#if which === 'plot'}
	{@render plot(theData)}
{:else if which === 'controls'}
	{@render controls(theData)}
{/if}

<style>
	.cuts-summary {
		font-size: 0.85em;
		color: var(--color-text-muted);
		margin: 0.2rem 0 0;
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
