<script module>
	import { Column as ColumnClass } from '$lib/core/Column.svelte';
	import Column from '$lib/core/Column.svelte';
	import Axis, { AxisClass } from '$lib/components/plotbits/Axis.svelte';
	import { scaleLinear } from 'd3-scale';
	import Points, { PointsClass } from '$lib/components/plotbits/Points.svelte';
	import Line, { LineClass } from '$lib/components/plotbits/Line.svelte';
	import { min, max } from '$lib/components/plotbits/helpers/wrangleData.js';
	import { meanSemByGroup } from '$lib/utils/meanSem.js';

	/**
	 * Round a value outward to a "nice" axis limit (shared with Boxplot).
	 * @param {number} value
	 * @param {'floor'|'ceil'} direction
	 * @returns {number}
	 */
	export function niceAxisLimit(value, direction) {
		if (!isFinite(value)) return value;
		if (value === 0) return 0;
		const abs = Math.abs(value);
		const step = Math.pow(10, Math.floor(Math.log10(abs)));
		if (direction === 'floor') {
			return value < 0
				? -Math.ceil(Math.abs(value) / step) * step
				: Math.floor(value / step) * step;
		}
		return value < 0 ? -Math.floor(Math.abs(value) / step) * step : Math.ceil(value / step) * step;
	}

	export const MeanSEM_defaultDataInputs = ['x', 'y'];
	export const MeanSEM_controlHeaders = ['Properties', 'Data'];

	class MeanSEMDataClass {
		static descriptors = {};

		parentPlot = $state();
		x = $state();
		y = $state();
		label = $state('Mean ± SEM');
		points = $state();
		line = $state();
		errorColour = $state('#000000');
		errorWidth = $state(1.5);
		errorCapWidth = $state(6);
		showError = $state(true);

		constructor(parent, dataIN) {
			this.parentPlot = parent;

			if (dataIN?.x) {
				this.x = ColumnClass.fromJSON(dataIN.x);
			} else {
				this.x = new ColumnClass({ refId: -1 });
			}

			if (dataIN?.y) {
				this.y = ColumnClass.fromJSON(dataIN.y);
			} else {
				this.y = new ColumnClass({ refId: -1 });
			}

			this.label = dataIN?.label ?? 'Mean ± SEM ' + (parent.data.length + 1);

			this.points = new PointsClass(dataIN?.points, this);
			this.line = new LineClass(dataIN?.line, this);
			// Connecting line is off by default; the points + error bars carry the plot.
			if (dataIN?.line === undefined) this.line.draw = false;

			this.errorColour = dataIN?.errorColour ?? this.points.colour;
			this.errorWidth = dataIN?.errorWidth ?? 1.5;
			this.errorCapWidth = dataIN?.errorCapWidth ?? 6;
			this.showError = dataIN?.showError ?? true;
		}

		// Per-group mean ± SEM for this series (ignores null/NaN pairs).
		stats = $derived.by(() => {
			const yData = this.y.getData() ?? [];
			const xRaw = this.x.getData() ?? [];
			// No category column → treat the whole series as one group named by label.
			const xData = xRaw.length > 0 ? xRaw : yData.map(() => this.label);
			return meanSemByGroup(xData, yData);
		});

		getLegendItem() {
			const elements = [];
			if (this.line.draw) {
				elements.push({
					type: 'line',
					color: this.line.colour,
					strokeWidth: this.line.strokeWidth,
					stroke: this.line.stroke === 'solid' ? '' : this.line.stroke
				});
			}
			if (this.points.draw) {
				elements.push({
					type: 'points',
					color: this.points.colour,
					shape: this.points.shape,
					size: this.points.radius
				});
			}
			if (elements.length === 0) return null;
			return { label: this.label, elements };
		}

		toJSON() {
			return {
				x: this.x,
				y: this.y,
				label: this.label,
				points: this.points.toJSON(),
				line: this.line.toJSON(),
				errorColour: this.errorColour,
				errorWidth: this.errorWidth,
				errorCapWidth: this.errorCapWidth,
				showError: this.showError
			};
		}

		static fromJSON(json, parent) {
			return new MeanSEMDataClass(parent, {
				x: json.x,
				y: json.y,
				label: json.label,
				points: PointsClass.fromJSON(json.points),
				line: LineClass.fromJSON(json.line),
				errorColour: json.errorColour,
				errorWidth: json.errorWidth,
				errorCapWidth: json.errorCapWidth,
				showError: json.showError
			});
		}
	}

	export class MeanSEMclass {
		static descriptors = {
			padding: { group: 'Padding' },
			xlimsIN: { group: 'X-axis', _children: { 0: { label: 'X min' }, 1: { label: 'X max' } } },
			ylimsIN: { group: 'Y-axis', _children: { 0: { label: 'Y min' }, 1: { label: 'Y max' } } }
		};

		parentBox = $state();
		data = $state([]);
		legend = $state();

		padding = $state({ top: 15, right: 30, bottom: 30, left: 50 });
		plotheight = $derived(this.parentBox.height - this.padding.top - this.padding.bottom);
		plotwidth = $derived(this.parentBox.width - this.padding.left - this.padding.right);

		xlimsIN = $state([null, null]);
		ylimsIN = $state([null, null]);

		xAxis = $state();
		yAxis = $state();

		// Union of group keys across all series, numeric-aware sorted (matches Boxplot).
		uniqueXValues = $derived.by(() => {
			const all = new Set();
			this.data.forEach((d) => {
				d.stats.forEach((s) => all.add(s.x));
			});
			return Array.from(all).sort((a, b) => {
				const sa = String(a);
				const sb = String(b);
				if (!isNaN(+sa) && !isNaN(+sb)) return +sa - +sb;
				return sa.localeCompare(sb);
			});
		});

		ylims = $derived.by(() => {
			let ymin = Infinity;
			let ymax = -Infinity;
			this.data.forEach((d) => {
				d.stats.forEach((s) => {
					const lo = s.mean - (d.showError ? s.sem : 0);
					const hi = s.mean + (d.showError ? s.sem : 0);
					if (lo < ymin) ymin = lo;
					if (hi > ymax) ymax = hi;
				});
			});
			if (ymin === Infinity || ymax === -Infinity) return [0, 10];

			const yBot = this.ylimsIN[0] != null ? this.ylimsIN[0] : niceAxisLimit(ymin, 'floor');
			const yTop = this.ylimsIN[1] != null ? this.ylimsIN[1] : niceAxisLimit(ymax, 'ceil');
			return [yBot, yTop];
		});

		xlims = $derived.by(() => {
			const n = this.uniqueXValues.length;
			if (n === 0) return [0, 1];
			return [
				this.xlimsIN[0] != null ? this.xlimsIN[0] : -0.5,
				this.xlimsIN[1] != null ? this.xlimsIN[1] : n - 0.5
			];
		});

		constructor(parent, dataIN) {
			this.parentBox = parent;
			this.legend = new LegendClass(dataIN?.legend);
			this.xAxis = AxisClass.withDefaults(dataIN?.xAxis, { gridlines: false });
			this.yAxis = AxisClass.withDefaults(dataIN?.yAxis);
			if (dataIN) {
				this.addData(dataIN);
			}
		}

		// Horizontal dodge (category units) so overlapping series separate slightly.
		dodgeFor(seriesIndex) {
			const total = this.data.length;
			if (total <= 1) return 0;
			const spread = 0.5;
			return (seriesIndex - (total - 1) / 2) * (spread / total);
		}

		getAutoScaleValues() {
			let axisWidths = { left: null, right: null, top: null, bottom: null };
			const plotRoot = document.getElementById('plot' + this.parentBox.id);
			if (!plotRoot) return axisWidths;
			const scale =
				this.parentBox.width > 0
					? plotRoot.getBoundingClientRect().width / this.parentBox.width
					: 1;

			const allLeftAxes = plotRoot.getElementsByClassName('axis-left');
			if (allLeftAxes && allLeftAxes.length > 0) {
				let leftMost = 0;
				let leftAxisWhole = allLeftAxes[0].getBoundingClientRect().left;
				for (let i = 1; i < allLeftAxes.length; i++) {
					if (allLeftAxes[i].getBoundingClientRect().left < leftAxisWhole) {
						leftMost = i;
						leftAxisWhole = allLeftAxes[i].getBoundingClientRect().left;
					}
				}
				const domain = allLeftAxes[leftMost].getElementsByClassName('domain')[0];
				if (domain) {
					const leftAxisLine = domain.getBoundingClientRect().left;
					axisWidths.left = Math.round((leftAxisLine - leftAxisWhole) / scale + 6);
				}
			}

			const allBottomAxes = plotRoot.getElementsByClassName('axis-bottom');
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
			if (side == 'all') {
				['top', 'left', 'right', 'bottom'].forEach((theSide) => {
					this.padding[theSide] = this.getAutoScaleValues()[theSide] || this.padding[theSide];
				});
			} else {
				this.padding[side] = this.getAutoScaleValues()[side];
			}
		}

		addData(dataIN) {
			this.data.push(new MeanSEMDataClass(this, dataIN));
		}

		removeData(idx) {
			this.data.splice(idx, 1);
		}

		getLegendItems = $derived.by(() => {
			const items = [];
			this.data.forEach((datum) => {
				const item = datum.getLegendItem();
				if (item) items.push(item);
			});
			return items;
		});

		getDownloadData() {
			const categories = [...this.uniqueXValues];
			const statKeys = ['n', 'mean', 'sem', 'sd'];
			const multiSeries = this.data.length > 1;
			const headers = multiSeries
				? ['DataSeries', 'Stat', ...categories.map(String)]
				: ['Stat', ...categories.map(String)];

			const rows = [];
			this.data.forEach((datum, d) => {
				const label = datum.label || `Data ${d}`;
				const byX = new Map(datum.stats.map((s) => [String(s.x), s]));
				statKeys.forEach((key) => {
					const row = multiSeries ? [label, key] : [key];
					categories.forEach((cat) => {
						const s = byX.get(String(cat));
						row.push(s ? s[key] : '');
					});
					rows.push(row);
				});
			});
			return { headers, rows };
		}

		toJSON() {
			return {
				xlimsIN: this.xlimsIN,
				ylimsIN: this.ylimsIN,
				padding: this.padding,
				xAxis: this.xAxis.toJSON(),
				yAxis: this.yAxis.toJSON(),
				data: this.data,
				legend: this.legend.toJSON()
			};
		}

		static fromJSON(parent, json) {
			if (!json) return new MeanSEMclass(parent, null);

			const chart = new MeanSEMclass(parent, null);
			// `?? default`: a tool-written inner carries only `data`, and a bare `=` put
			// `undefined` over the class default, throwing at render (see Boxplot, and
			// plotFromJSONRobustness.test.js which now drives every registered plot).
			chart.padding = json.padding ?? chart.padding;
			chart.xlimsIN = json.xlimsIN ?? chart.xlimsIN;
			chart.ylimsIN = json.ylimsIN ?? chart.ylimsIN;

			if (json.xAxis) {
				chart.xAxis = AxisClass.fromJSON(json.xAxis);
			} else {
				chart.xAxis = new AxisClass({ label: json.xlabel ?? '', gridlines: false });
			}
			if (json.yAxis) {
				chart.yAxis = AxisClass.fromJSON(json.yAxis);
			} else {
				chart.yAxis = new AxisClass({ label: json.ylabel ?? '', gridlines: true });
			}

			if (json.data) {
				chart.data = json.data.map((d) => MeanSEMDataClass.fromJSON(d, chart));
			} else if (json.dataIn) {
				chart.addData(json.dataIn);
			}

			chart.legend = LegendClass.fromJSON(json.legend);
			return chart;
		}
	}

	export const definition = {
		defaultDataInputs: MeanSEM_defaultDataInputs,
		controlHeaders: MeanSEM_controlHeaders,
		optionalDataInputs: ['x'],
		displayName: 'Mean ± SEM',
		plotClass: MeanSEMclass
	};
</script>

<script>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import ColourPicker from '$lib/components/inputs/ColourPicker.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import { appState } from '$lib/core/core.svelte';
	import { onMount, tick } from 'svelte';
	import { flip } from 'svelte/animate';
	import { slide } from 'svelte/transition';
	import Legend, { LegendClass } from '$lib/components/plotbits/Legend.svelte';
	import Editable from '$lib/components/inputs/Editable.svelte';
	import { dataSettingsScrollTo } from '$lib/components/views/ControlDisplay.svelte';

	let { theData, which } = $props();

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
			theData.xlims;
			theData.autoScalePadding('all');
		}
	});

	function formatCategoryTick(value, categories) {
		const idx = Math.round(Number(value));
		if (!Number.isFinite(idx) || idx < 0 || idx >= categories.length) return '';
		return String(categories[idx]);
	}

	function getManualCategoryTicks(categories) {
		return categories.map((_, i) => i);
	}

	function getXAxisForManualCategories(axisData, categories) {
		return {
			label: axisData.label,
			gridlines: false,
			nticks: categories.length,
			manualTicks: getManualCategoryTicks(categories)
		};
	}

	// Map a series' per-group stats onto category-index x positions (+ dodge).
	function seriesPoints(plot, datum, seriesIndex) {
		const cats = plot.uniqueXValues.map(String);
		const dodge = plot.dodgeFor(seriesIndex);
		return datum.stats.map((s) => ({
			cx: cats.indexOf(String(s.x)) + dodge,
			mean: s.mean,
			sem: s.sem,
			n: s.n
		}));
	}
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
				<ControlInput label="Min">
					<NumberWithUnits
						step="0.1"
						value={theData.ylimsIN[0] ? theData.ylimsIN[0] : theData.ylims[0]}
						onInput={(val) => {
							theData.ylimsIN[0] = parseFloat(val);
						}}
					/>
				</ControlInput>
				<ControlInput label="Max">
					<NumberWithUnits
						step="0.1"
						value={theData.ylimsIN[1] ? theData.ylimsIN[1] : theData.ylims[1]}
						onInput={(val) => {
							theData.ylimsIN[1] = parseFloat(val);
						}}
					/>
				</ControlInput>
				{#if theData.ylimsIN[0] != null || theData.ylimsIN[1] != null}
					<div class="control-component-input-icons">
						<button class="icon" onclick={() => (theData.ylimsIN = [null, null])}>
							<Icon name="reset" width={14} height={14} className="control-component-input-icon" />
						</button>
					</div>
				{/if}
			</div>
		</div>

		<div class="div-line"></div>

		<div class="control-component">
			<div class="control-component-title">
				<p>X-Axis</p>
			</div>
			<div class="control-input-vertical">
				<ControlInput label="Label">
					<input bind:value={theData.xAxis.label} />
				</ControlInput>
			</div>
		</div>
	{:else if appState.currentControlTab === 'data'}
		<div id="dataSettings">
			<div class="control-data-add">
				<div class="add">
					<button
						class="icon"
						onclick={async () => {
							theData.addData({ x: null, y: null });
							await tick();
							dataSettingsScrollTo('bottom');
						}}
					>
						<Icon name="add" width={16} height={16} />
					</button>
				</div>
			</div>

			{#each theData.data as datum, i (datum.x.id + '-' + datum.y.id)}
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
							<ControlInput label="x (categories, optional)"></ControlInput>
							<Column col={datum.x} canChange={true} />
							{#if datum.x.refId >= 0}
								<button
									type="button"
									class="icon"
									onclick={() => {
										datum.x.refId = -1;
									}}
								>
									<Icon name="reset" width={14} height={14} />
								</button>
							{/if}
						</div>
						<div class="y-select">
							<ControlInput label="y (values)"></ControlInput>
							<Column col={datum.y} canChange={true} />
						</div>

						<Points pointsData={datum.points} which="controls" />
						<Line lineData={datum.line} which="controls" title="Connecting line" />

						<div class="control-component">
							<div class="control-component-title">
								<p>Error bars (± SEM)</p>
								<button
									class="icon"
									onclick={(e) => {
										e.stopPropagation();
										datum.showError = !datum.showError;
									}}
								>
									{#if !datum.showError}
										<Icon name="eye-slash" width={16} height={16} />
									{:else}
										<Icon name="eye" width={16} height={16} className="visible" />
									{/if}
								</button>
							</div>
							{#if datum.showError}
								<div class="control-input-horizontal">
									<div class="control-input" style="max-width: 1.5rem;">
										<p>Col</p>
										<ColourPicker bind:value={datum.errorColour} />
									</div>
									<ControlInput label="Width">
										<NumberWithUnits step="0.1" min={0.1} bind:value={datum.errorWidth} />
									</ControlInput>
									<ControlInput label="Cap">
										<NumberWithUnits step="1" min={0} bind:value={datum.errorCapWidth} />
									</ControlInput>
								</div>
							{/if}
						</div>
					</div>
					<div class="div-line"></div>
				</div>
			{/each}
		</div>
	{/if}
{/snippet}

{#snippet plot(theData)}
	{@const plot = theData.plot}
	{@const xScale = scaleLinear().domain([plot.xlims[0], plot.xlims[1]]).range([0, plot.plotwidth])}
	{@const yScale = scaleLinear().domain([plot.ylims[0], plot.ylims[1]]).range([plot.plotheight, 0])}
	<svg
		id={'plot' + plot.parentBox.id}
		width={plot.parentBox.width}
		height={plot.parentBox.height}
		viewBox="0 0 {plot.parentBox.width} {plot.parentBox.height}"
		style={`background: var(--surface-card); position: absolute;`}
	>
		<Axis
			height={plot.plotheight}
			width={plot.plotwidth}
			scale={yScale}
			position="left"
			plotPadding={plot.padding}
			axisData={plot.yAxis}
			which="plot"
		/>

		<Axis
			height={plot.plotheight}
			width={plot.plotwidth}
			scale={xScale}
			position="bottom"
			plotPadding={plot.padding}
			axisData={getXAxisForManualCategories(plot.xAxis, plot.uniqueXValues)}
			tickFormat={(d) => formatCategoryTick(d, plot.uniqueXValues)}
			which="plot"
		/>

		{#each plot.data as datum, i}
			{@const pts = seriesPoints(plot, datum, i)}
			<!-- Error bars: vertical whisker + caps at mean ± SEM -->
			{#if datum.showError}
				<g style={`transform: translate(${plot.padding.left}px, ${plot.padding.top}px);`}>
					{#each pts as p}
						{#if p.sem > 0}
							{@const cx = xScale(p.cx)}
							{@const yTop = yScale(p.mean + p.sem)}
							{@const yBot = yScale(p.mean - p.sem)}
							<line
								x1={cx}
								y1={yTop}
								x2={cx}
								y2={yBot}
								stroke={datum.errorColour}
								stroke-width={datum.errorWidth}
							/>
							{#if datum.errorCapWidth > 0}
								<line
									x1={cx - datum.errorCapWidth / 2}
									y1={yTop}
									x2={cx + datum.errorCapWidth / 2}
									y2={yTop}
									stroke={datum.errorColour}
									stroke-width={datum.errorWidth}
								/>
								<line
									x1={cx - datum.errorCapWidth / 2}
									y1={yBot}
									x2={cx + datum.errorCapWidth / 2}
									y2={yBot}
									stroke={datum.errorColour}
									stroke-width={datum.errorWidth}
								/>
							{/if}
						{/if}
					{/each}
				</g>
			{/if}

			<!-- Connecting line through the means -->
			{#if datum.line.draw && pts.length > 1}
				<Line
					lineData={datum.line}
					x={pts.map((p) => p.cx)}
					y={pts.map((p) => p.mean)}
					xscale={xScale}
					yscale={yScale}
					xoffset={plot.padding.left}
					yoffset={plot.padding.top}
					which="plot"
				/>
			{/if}

			<!-- Mean markers -->
			<Points
				pointsData={datum.points}
				x={pts.map((p) => p.cx)}
				y={pts.map((p) => p.mean)}
				xscale={xScale}
				yscale={yScale}
				xoffset={plot.padding.left}
				yoffset={plot.padding.top}
				which="plot"
			/>
		{/each}

		<Legend
			legendData={plot.legend}
			items={plot.getLegendItems}
			plotWidth={plot.plotwidth}
			plotHeight={plot.plotheight}
			padding={plot.padding}
			which="plot"
		/>
	</svg>
{/snippet}

{#if which === 'plot'}
	{@render plot(theData)}
{:else if which === 'controls'}
	{@render controls(theData)}
{/if}
