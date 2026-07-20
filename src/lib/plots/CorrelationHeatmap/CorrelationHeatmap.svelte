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
	import { correlationGrid } from '$lib/utils/correlationGrid.js';
	import {
		colormapRGB,
		normaliseTo01,
		COLORMAP_LABELS
	} from '$lib/plots/Actogram/colormaps.js';

	export const CorrelationHeatmap_defaultDataInputs = ['column'];
	export const CorrelationHeatmap_controlHeaders = ['Properties', 'Data'];
	export const CorrelationHeatmap_displayName = 'Correlation heatmap';

	class HeatmapColumn {
		parentPlot = $state();
		column = $state();

		constructor(parent, dataIN) {
			this.parentPlot = parent;
			this.column = dataIN?.column ? ColumnClass.fromJSON(dataIN.column) : new ColumnClass({ refId: -1 });
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
		data = $state([]); // one HeatmapColumn per wired variable
		padding = $state({ top: 20, right: 20, bottom: 70, left: 70 });
		colormap = $state('rdbu');
		showValues = $state(true);
		method = $state('pearson'); // 'pearson' | 'spearman'

		plotheight = $derived(this.parentBox.height - this.padding.top - this.padding.bottom);
		plotwidth = $derived(this.parentBox.width - this.padding.left - this.padding.right);

		// Compute the correlation matrix from the wired columns' live data.
		matrix = $derived.by(() => {
			const cols = this.data.map((d) => d.column?.getData?.() ?? []);
			const names = this.data.map((d) => d.column?.name ?? '');
			return correlationGrid(cols, names, this.method);
		});

		constructor(parent, dataIN) {
			this.parentBox = parent;
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
				padding: this.padding,
				colormap: this.colormap,
				showValues: this.showValues,
				method: this.method,
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
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';

	let { theData, which } = $props();

	const colormapOptions = Object.keys(COLORMAP_LABELS);
	const colormapLabelList = colormapOptions.map((k) => COLORMAP_LABELS[k]);
	// A short colour scale for the legend (-1 … +1).
	const legendStops = Array.from({ length: 21 }, (_, i) => i / 20);
</script>

{#snippet plot(theData)}
	{@const plot = theData.plot}
	{@const m = plot.matrix}
	{@const N = m.labels.length}
	{@const cell = N > 0 ? Math.min(plot.plotwidth, plot.plotheight) / N : 0}
	{@const gridW = cell * N}
	<svg
		id={'plot' + plot.parentBox.id}
		width={plot.parentBox.width}
		height={plot.parentBox.height}
		viewBox="0 0 {plot.parentBox.width} {plot.parentBox.height}"
		style="background: var(--surface-card); position: absolute;"
	>
		{#if N < 2}
			<text x={plot.parentBox.width / 2} y={plot.parentBox.height / 2} text-anchor="middle" fill="var(--color-text-muted)" font-size="12">
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
							<title>{rowLab} ~ {colLab}: r={fmtCell(v)}{i !== j && Number.isFinite(m.p[i][j]) ? `, p=${m.p[i][j] < 0.001 ? '<0.001' : m.p[i][j].toFixed(3)}` : ''}</title>
						</rect>
						{#if plot.showValues && cell > 22}
							<text x={j * cell + cell / 2} y={i * cell + cell / 2} text-anchor="middle" dominant-baseline="central" font-size={Math.min(12, cell / 3)} fill={cellText(v)}>
								{fmtCell(v)}
							</text>
						{/if}
					{/each}
				{/each}
				<!-- y labels (left) -->
				{#each m.labels as lab, i (i)}
					<text x={-6} y={i * cell + cell / 2} text-anchor="end" dominant-baseline="central" font-size="11" fill="var(--color-lightness-25)">{lab}</text>
				{/each}
				<!-- x labels (bottom, rotated) -->
				{#each m.labels as lab, j (j)}
					<text transform="translate({j * cell + cell / 2}, {gridW + 6}) rotate(45)" text-anchor="start" dominant-baseline="hanging" font-size="11" fill="var(--color-lightness-25)">{lab}</text>
				{/each}
			</g>
			<!-- colour legend (-1 … +1) -->
			{@const lx = plot.padding.left + gridW + 12}
			{@const lh = Math.min(gridW, 140)}
			{#if lx + 40 < plot.parentBox.width}
				<g transform="translate({lx}, {plot.padding.top})">
					{#each legendStops as t, k (k)}
						<rect x={0} y={(1 - t) * lh - lh / legendStops.length} width={12} height={lh / legendStops.length + 1} fill={colormapRGB(plot.colormap, t)} />
					{/each}
					<text x={16} y={0} dominant-baseline="hanging" font-size="10" fill="var(--color-text-muted)">+1</text>
					<text x={16} y={lh / 2} dominant-baseline="central" font-size="10" fill="var(--color-text-muted)">0</text>
					<text x={16} y={lh} dominant-baseline="auto" font-size="10" fill="var(--color-text-muted)">−1</text>
				</g>
			{/if}
		{/if}
	</svg>
{/snippet}

{#snippet controls(theData)}
	{#if appState.currentControlTab === 'properties'}
		<div class="control-component">
			<div class="control-component-title">Correlation heatmap</div>
			<ControlInput label="Width"><NumberWithUnits bind:value={theData.parentBox.width} /></ControlInput>
			<ControlInput label="Height"><NumberWithUnits bind:value={theData.parentBox.height} /></ControlInput>
			<ControlInput label="Method">
				<AttributeSelect
					bind:value={theData.method}
					options={['pearson', 'spearman']}
					optionsDisplay={['Pearson (linear)', 'Spearman (rank)']}
				/>
			</ControlInput>
			<ControlInput label="Colour scale">
				<AttributeSelect bind:value={theData.colormap} options={colormapOptions} optionsDisplay={colormapLabelList} />
			</ControlInput>
			<ControlInput label="Show values">
				<input type="checkbox" bind:checked={theData.showValues} />
			</ControlInput>
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
