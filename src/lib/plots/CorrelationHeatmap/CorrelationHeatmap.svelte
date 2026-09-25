<script module>
	// @ts-nocheck
	// Correlation heatmap — a SELF-CONTAINED coloured correlation matrix.
	//
	// Takes the raw data columns directly (one `column` ref per wired column, exactly like the
	// Histogram plot) and computes the pairwise correlation matrix ITSELF via correlationGrid
	// (the same scipy-pinned maths the Correlation node uses). So it stands alone — drop columns
	// in, get a heatmap — with no dependency on the Correlation node. Storage field is `column`,
	// which the workflow graph's edge detection recognises (ProcessNode checks x/y/z/column), so
	// input wires draw and upstream edits propagate.
	//
	// Diverging colormap centred at 0 (correlation ∈ [-1, +1]): negative → blue, 0 → white,
	// positive → red.
	import { Column as ColumnClass } from '$lib/core/Column.svelte';
	import { viewFontScale, viewStyleFor, scalePadding } from '$lib/plots/viewBox.js';
	import { correlationGrid } from '$lib/utils/correlationGrid.js';
	import { colormapRGB, normaliseTo01, COLORMAP_LABELS } from '$lib/plots/Actogram/colormaps.js';
	import { ColourScaleClass } from '$lib/components/plotbits/ColourScale.svelte';

	export const CorrelationHeatmap_defaultDataInputs = ['column'];
	export const CorrelationHeatmap_controlHeaders = ['Properties', 'Data'];
	export const CorrelationHeatmap_displayName = 'Correlation heatmap';

	class HeatmapColumn {
		parentPlot = $state();
		column = $state();

		constructor(parent, dataIN) {
			this.parentPlot = parent;
			this.column = dataIN?.column
				? ColumnClass.fromJSON(dataIN.column)
				: new ColumnClass({ refId: -1 });
		}
		toJSON() {
			return { column: this.column };
		}
		static fromJSON(json, parent) {
			return new HeatmapColumn(parent, { column: json.column });
		}
	}

	export class CorrelationHeatmapClass {
		static descriptors = { padding: { group: 'Padding' } };

		parentBox = $state();
		// Draw at the VIEW's size when one is given (a workflow node), else the figure's own.
		// See plots/viewBox.js for the whole story and why type scales with it.
		renderBox = $state(null);
		viewWidth = $derived(this.renderBox?.w ?? this.parentBox.width);
		viewHeight = $derived(this.renderBox?.h ?? this.parentBox.height);
		fontScale = $derived(viewFontScale(this.renderBox, this.parentBox));
		viewStyle = $derived(viewStyleFor(this.parentBox?.style, this.fontScale));
		data = $state([]); // one HeatmapColumn per wired variable
		// Stored padding belongs to the FIGURE. A view that draws the type smaller needs
		// proportionally less room for it, so `padding` reads back SCALED while a renderBox is
		// set; the raw value is what gets saved. See plots/viewBox.js.
		#padding = $state({ top: 20, right: 20, bottom: 70, left: 70 });
		paddingScaled = $derived(scalePadding(this.#padding, this.fontScale));
		get padding() {
			return this.renderBox ? this.paddingScaled : this.#padding;
		}
		set padding(v) {
			this.#padding = v;
		}
		colormap = $state('rdbu');
		showValues = $state(true);
		method = $state('pearson'); // 'pearson' | 'spearman'
		// The gradient key for the cells. DEFAULT ON, unlike the five plots that gained
		// a SERIES legend: this plot has always drawn a colour bar, so ON is what keeps
		// a saved figure looking as it did. What is new is being able to move it, to
		// switch it off, and to have it stay on a figure too narrow for the old one.
		colourScale = $state();

		plotheight = $derived(this.viewHeight - this.padding.top - this.padding.bottom);
		plotwidth = $derived(this.viewWidth - this.padding.left - this.padding.right);

		// Compute the correlation matrix from the wired columns' live data.
		matrix = $derived.by(() => {
			const cols = this.data.map((d) => d.column?.getData?.() ?? []);
			const names = this.data.map((d) => d.column?.name ?? '');
			return correlationGrid(cols, names, this.method);
		});

		constructor(parent, dataIN) {
			this.parentBox = parent;
			this.colourScale = ColourScaleClass.withDefaults(dataIN?.colourScale, { show: true });
			if (dataIN?.column) this.addData(dataIN);
		}

		addData(dataIN) {
			this.data.push(new HeatmapColumn(this, dataIN));
		}
		removeData(idx) {
			this.data.splice(idx, 1);
		}
		// Fixed padding (labels live in the margins); satisfy the generic plot lifecycle.
		autoScalePadding() {}

		getDownloadData() {
			const { labels, r } = this.matrix;
			const headers = ['', ...labels];
			const rows = labels.map((lab, i) => [lab, ...r[i]]);
			return { headers, rows };
		}

		toJSON() {
			return {
				padding: this.#padding,
				colormap: this.colormap,
				showValues: this.showValues,
				method: this.method,
				colourScale: this.colourScale.toJSON(),
				data: this.data.map((d) => d.toJSON())
			};
		}
		static fromJSON(parent, json) {
			const c = new CorrelationHeatmapClass(parent, null);
			if (!json) return c;
			// ?? defaults: an inner written by a tool (Quick-Plot) carries only `data`; a bare `=`
			// would clobber the class defaults with undefined and throw at render (the same trap
			// plotFromJSONRobustness.test.js guards for every plot).
			c.padding = json.padding ?? c.padding;
			c.colormap = json.colormap ?? c.colormap;
			c.showValues = json.showValues ?? c.showValues;
			c.method = json.method ?? c.method;
			// withDefaults, not fromJSON: a heatmap saved before the scale was a
			// persisted object has no `colourScale` key and must come back ON.
			c.colourScale = ColourScaleClass.withDefaults(json.colourScale, { show: true });
			if (Array.isArray(json.data)) c.data = json.data.map((d) => HeatmapColumn.fromJSON(d, c));
			else if (json.dataIn) c.addData(json.dataIn);
			return c;
		}
	}

	export const definition = {
		displayName: CorrelationHeatmap_displayName,
		defaultDataInputs: CorrelationHeatmap_defaultDataInputs,
		controlHeaders: CorrelationHeatmap_controlHeaders,
		plotClass: CorrelationHeatmapClass
	};

	// A cell's fill: correlation ∈ [-1, +1] mapped symmetrically so 0 → the colormap's centre.
	function cellFill(colormap, v) {
		return Number.isFinite(v) ? colormapRGB(colormap, normaliseTo01(v, -1, 1)) : 'transparent';
	}
	// White text on saturated (near ±1) cells, dark text on pale (near 0) cells.
	function cellText(v) {
		return Number.isFinite(v) && Math.abs(v) > 0.6 ? '#fff' : '#222';
	}
	const fmtCell = (v) => (Number.isFinite(v) ? (Math.abs(v) < 0.005 ? '0' : v.toFixed(2)) : '');
</script>

<script>
	// @ts-nocheck
	import { appState } from '$lib/core/core.svelte';
	import Column from '$lib/core/Column.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import SeriesBlockHeader from '$lib/components/plotbits/SeriesBlockHeader.svelte';
	import { flip } from 'svelte/animate';
	import { slide } from 'svelte/transition';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import ColourScale from '$lib/components/plotbits/ColourScale.svelte';

	let { theData, which } = $props();

	const colormapOptions = Object.keys(COLORMAP_LABELS);
	const colormapLabelList = colormapOptions.map((k) => COLORMAP_LABELS[k]);
</script>

{#snippet plot(theData)}
	{@const plot = theData.plot}
	{@const m = plot.matrix}
	{@const N = m.labels.length}
	{@const cell = N > 0 ? Math.min(plot.plotwidth, plot.plotheight) / N : 0}
	{@const gridW = cell * N}
	<svg
		id={'plot' + plot.parentBox.id}
		width={plot.viewWidth}
		height={plot.viewHeight}
		viewBox="0 0 {plot.viewWidth} {plot.viewHeight}"
		style="background: var(--surface-card); position: absolute;"
	>
		{#if N < 2}
			<text
				x={plot.parentBox.width / 2}
				y={plot.parentBox.height / 2}
				text-anchor="middle"
				fill="var(--color-text-muted)"
				font-size="12"
			>
				Wire two or more columns to see their correlations.
			</text>
		{:else}
			<g transform="translate({plot.padding.left}, {plot.padding.top})">
				<!-- cells -->
				{#each m.labels as rowLab, i (i)}
					{#each m.labels as colLab, j (j)}
						{@const v = m.r[i][j]}
						<rect
							x={j * cell}
							y={i * cell}
							width={cell}
							height={cell}
							fill={cellFill(plot.colormap, v)}
							stroke="var(--surface-card)"
							stroke-width="1"
						>
							<title
								>{rowLab} ~ {colLab}: r={fmtCell(v)}{i !== j && Number.isFinite(m.p[i][j])
									? `, p=${m.p[i][j] < 0.001 ? '<0.001' : m.p[i][j].toFixed(3)}`
									: ''}</title
							>
						</rect>
						{#if plot.showValues && cell > 22}
							<text
								x={j * cell + cell / 2}
								y={i * cell + cell / 2}
								text-anchor="middle"
								dominant-baseline="central"
								font-size={Math.min(12, cell / 3)}
								fill={cellText(v)}
							>
								{fmtCell(v)}
							</text>
						{/if}
					{/each}
				{/each}
				<!-- y labels (left) -->
				{#each m.labels as lab, i (i)}
					<text
						x={-6}
						y={i * cell + cell / 2}
						text-anchor="end"
						dominant-baseline="central"
						font-size="11"
						fill="var(--color-lightness-25)">{lab}</text
					>
				{/each}
				<!-- x labels (bottom, rotated) -->
				{#each m.labels as lab, j (j)}
					<text
						transform="translate({j * cell + cell / 2}, {gridW + 6}) rotate(45)"
						text-anchor="start"
						dominant-baseline="hanging"
						font-size="11"
						fill="var(--color-lightness-25)">{lab}</text
					>
				{/each}
			</g>
			<!-- Correlation key. The domain is the mapping cellFill actually uses:
			     [-1, +1], centred so 0 lands on the ramp's middle stop.

			     contentWidth/Height are the GRID, not the plot area. The grid is square,
			     so on a wide figure it stops well short of the right edge, and the key
			     belongs beside the cells rather than out in the empty space. -->
			<ColourScale
				scaleData={plot.colourScale}
				colormap={plot.colormap}
				domain={[-1, 1]}
				label={plot.method === 'spearman' ? '\u03c1' : 'r'}
				plotWidth={plot.plotwidth}
				plotHeight={plot.plotheight}
				contentWidth={gridW}
				contentHeight={gridW}
				padding={plot.padding}
				idPrefix={'heatmap-' + plot.parentBox.id}
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
			<div class="control-component-title">Correlation heatmap</div>
			<ControlInput label="Width"
				><NumberWithUnits bind:value={theData.parentBox.width} /></ControlInput
			>
			<ControlInput label="Height"
				><NumberWithUnits bind:value={theData.parentBox.height} /></ControlInput
			>
			<ControlInput label="Method">
				<AttributeSelect
					bind:value={theData.method}
					options={['pearson', 'spearman']}
					optionsDisplay={['Pearson (linear)', 'Spearman (rank)']}
				/>
			</ControlInput>
			<ControlInput label="Colour map">
				<AttributeSelect
					bind:value={theData.colormap}
					options={colormapOptions}
					optionsDisplay={colormapLabelList}
				/>
			</ControlInput>
			<ControlInput label="Show values">
				<input type="checkbox" bind:checked={theData.showValues} />
			</ControlInput>
		</div>
	{:else if appState.currentControlTab === 'data'}
		<div id="dataSettings">
			<div class="control-data-add">
				<div class="add">
					<button class="icon" title="Add a variable" onclick={() => theData.addData({})}>
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
					<SeriesBlockHeader
						inner={theData}
						{datum}
						index={i}
						editable={false}
						fallback={`Variable ${i + 1}`}
						removeTooltip="Remove this variable"
					/>
					<div class="data-wrapper">
						<div class="y-select">
							<ControlInput label="Column"></ControlInput>
							<Column col={datum.column} canChange={true} />
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
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
</style>
