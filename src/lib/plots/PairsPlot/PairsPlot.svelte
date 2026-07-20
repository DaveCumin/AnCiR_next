<script module>
	// @ts-nocheck
	// Pairs plot — a scatterplot matrix (SPLOM), after R's psych::pairs.panels.
	//
	// Self-contained like the correlation heatmap: takes the raw data columns (one `column` ref
	// each, the Histogram-plot pattern) and builds the whole matrix itself. Each of the N×N
	// cells:
	//   diagonal (i=j)  — a histogram of variable i
	//   upper (i<j)     — a scatterplot of variable j (x) vs variable i (y) + a linear fit line
	//   lower (i>j)     — the correlation r, as a coloured cell with the value (bigger = stronger)
	//
	// Maths is the pure, unit-tested utils/pairsLayout.js (scipy-pinned correlations, shared
	// least-squares fit). Diverging colormap for the lower triangle, centred at 0.
	import { Column as ColumnClass } from '$lib/core/Column.svelte';
	import { pairsLayout } from '$lib/utils/pairsLayout.js';
	import { colormapRGB, normaliseTo01, COLORMAP_LABELS } from '$lib/plots/Actogram/colormaps.js';

	export const PairsPlot_defaultDataInputs = ['column'];
	export const PairsPlot_controlHeaders = ['Properties', 'Data'];
	export const PairsPlot_displayName = 'Pairs plot';

	class PairsColumn {
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
			return new PairsColumn(parent, { column: json.column });
		}
	}

	export class PairsPlotClass {
		static descriptors = { padding: { group: 'Padding' } };

		parentBox = $state();
		data = $state([]);
		padding = $state({ top: 24, right: 16, bottom: 16, left: 60 });
		colormap = $state('rdbu');
		method = $state('pearson'); // 'pearson' | 'spearman'
		pointColour = $state('#234154');

		plotheight = $derived(this.parentBox.height - this.padding.top - this.padding.bottom);
		plotwidth = $derived(this.parentBox.width - this.padding.left - this.padding.right);

		layout = $derived.by(() => {
			const cols = this.data.map((d) => d.column?.getData?.() ?? []);
			const names = this.data.map((d) => d.column?.name ?? '');
			return pairsLayout(cols, names, this.method);
		});

		constructor(parent, dataIN) {
			this.parentBox = parent;
			if (dataIN?.column) this.addData(dataIN);
		}
		addData(dataIN) {
			this.data.push(new PairsColumn(this, dataIN));
		}
		removeData(idx) {
			this.data.splice(idx, 1);
		}
		autoScalePadding() {}

		getDownloadData() {
			const { labels, r } = this.layout;
			return { headers: ['', ...labels], rows: labels.map((lab, i) => [lab, ...r[i]]) };
		}

		toJSON() {
			return {
				padding: this.padding,
				colormap: this.colormap,
				method: this.method,
				pointColour: this.pointColour,
				data: this.data.map((d) => d.toJSON())
			};
		}
		static fromJSON(parent, json) {
			const c = new PairsPlotClass(parent, null);
			if (!json) return c;
			c.padding = json.padding ?? c.padding;
			c.colormap = json.colormap ?? c.colormap;
			c.method = json.method ?? c.method;
			c.pointColour = json.pointColour ?? c.pointColour;
			if (Array.isArray(json.data)) c.data = json.data.map((d) => PairsColumn.fromJSON(d, c));
			else if (json.dataIn) c.addData(json.dataIn);
			return c;
		}
	}

	export const definition = {
		displayName: PairsPlot_displayName,
		defaultDataInputs: PairsPlot_defaultDataInputs,
		controlHeaders: PairsPlot_controlHeaders,
		plotClass: PairsPlotClass
	};

	// --- pure cell helpers ---
	const corrFill = (colormap, r) => (Number.isFinite(r) ? colormapRGB(colormap, normaliseTo01(r, -1, 1)) : 'transparent');
	const fmtR = (r) => (Number.isFinite(r) ? (Math.abs(r) < 0.005 ? '0' : r.toFixed(2)) : '');
	// Correlation value text scaled by strength — bigger for stronger, like pairs.panels.
	const corrFontSize = (r, cell) => Math.max(9, Math.min(cell * 0.34, 11 + Math.abs(r ?? 0) * (cell * 0.22)));
	const scaleTo = (v, min, max, lo, hi) => (max <= min ? (lo + hi) / 2 : lo + ((v - min) / (max - min)) * (hi - lo));

	// Least-squares fit clipped to the cell rectangle; null when undefined (< 2 points).
	function fitFor(xs, ys, rx, ry, pad, cell) {
		let sx = 0;
		let sy = 0;
		let sxx = 0;
		let sxy = 0;
		let n = 0;
		for (let k = 0; k < xs.length; k++) {
			const x = xs[k];
			const y = ys[k];
			if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
			sx += x;
			sy += y;
			sxx += x * x;
			sxy += x * y;
			n++;
		}
		if (n < 2) return null;
		const denom = n * sxx - sx * sx;
		if (denom === 0) return null;
		const slope = (n * sxy - sx * sy) / denom;
		const intercept = (sy - slope * sx) / n;
		const yAt = (xv) => slope * xv + intercept;
		const toX = (xv) => scaleTo(xv, rx.min, rx.max, pad, cell - pad);
		const toY = (yv) => scaleTo(yv, ry.min, ry.max, cell - pad, pad);
		return { x1: toX(rx.min), y1: toY(yAt(rx.min)), x2: toX(rx.max), y2: toY(yAt(rx.max)) };
	}
</script>

<script>
	// @ts-nocheck
	import { appState } from '$lib/core/core.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import ColourPicker from '$lib/components/inputs/ColourPicker.svelte';

	let { theData, which } = $props();
	const colormapOptions = Object.keys(COLORMAP_LABELS);
	const colormapLabelList = colormapOptions.map((k) => COLORMAP_LABELS[k]);
</script>

{#snippet plot(theData)}
	{@const plot = theData.plot}
	{@const L = plot.layout}
	{@const N = L.labels.length}
	{@const grid = Math.min(plot.plotwidth, plot.plotheight)}
	{@const cell = N > 0 ? grid / N : 0}
	{@const pad = Math.max(3, cell * 0.1)}
	<svg
		id={'plot' + plot.parentBox.id}
		width={plot.parentBox.width}
		height={plot.parentBox.height}
		viewBox="0 0 {plot.parentBox.width} {plot.parentBox.height}"
		style="background: var(--surface-card); position: absolute;"
	>
		{#if N < 2}
			<text x={plot.parentBox.width / 2} y={plot.parentBox.height / 2} text-anchor="middle" fill="var(--color-text-muted)" font-size="12">
				Wire two or more columns to see the pairs matrix.
			</text>
		{:else}
			<g transform="translate({plot.padding.left}, {plot.padding.top})">
				{#each L.labels as rowLab, i (i)}
					{#each L.labels as colLab, j (j)}
						{@const x0 = j * cell}
						{@const y0 = i * cell}
						<g transform="translate({x0}, {y0})">
							<rect x="0" y="0" width={cell} height={cell} fill="none" stroke="var(--color-lightness-85)" stroke-width="0.75"><title>{rowLab} × {colLab}</title></rect>
							{#if i === j}
								<!-- diagonal: histogram of variable i -->
								{@const h = L.hists[i]}
								{#if h.counts.length}
									{#each h.counts as ct, b (b)}
										{@const bw = h.counts.length > 1 ? (cell - 2 * pad) / h.counts.length : cell - 2 * pad}
										{@const bh = h.maxCount ? (ct / h.maxCount) * (cell - 2 * pad) : 0}
										<rect x={pad + b * bw} y={cell - pad - bh} width={Math.max(0, bw - 1)} height={bh} fill={plot.pointColour} opacity="0.55" />
									{/each}
								{/if}
								<text x={pad} y={pad + 9} font-size="10" font-weight="600" fill="var(--color-lightness-25)">{rowLab}</text>
							{:else if i < j}
								<!-- upper: scatter of var j (x) vs var i (y) + linear fit -->
								{@const rx = plot.layout.ranges[j]}
								{@const ry = plot.layout.ranges[i]}
								{@const xs = plot.layout.cols[j]}
								{@const ys = plot.layout.cols[i]}
								{#each xs as xv, k (k)}
									{#if Number.isFinite(xv) && Number.isFinite(ys[k])}
										<circle
											cx={scaleTo(xv, rx.min, rx.max, pad, cell - pad)}
											cy={scaleTo(ys[k], ry.min, ry.max, cell - pad, pad)}
											r={Math.max(0.8, Math.min(2, cell / 40))}
											fill={plot.pointColour}
											opacity="0.6"
										/>
									{/if}
								{/each}
								{@const fitLine = fitFor(xs, ys, rx, ry, pad, cell)}
								{#if fitLine}
									<line x1={fitLine.x1} y1={fitLine.y1} x2={fitLine.x2} y2={fitLine.y2} stroke="#BE796B" stroke-width="1.5" />
								{/if}
							{:else}
								<!-- lower: correlation colour + value -->
								{@const r = L.r[i][j]}
								<rect x="1" y="1" width={cell - 2} height={cell - 2} fill={corrFill(plot.colormap, r)} opacity="0.85" />
								<text x={cell / 2} y={cell / 2} text-anchor="middle" dominant-baseline="central" font-size={corrFontSize(r, cell)} font-weight="600" fill={Number.isFinite(r) && Math.abs(r) > 0.6 ? '#fff' : '#222'}>
									{fmtR(r)}
								</text>
							{/if}
						</g>
					{/each}
				{/each}
				<!-- left-edge variable labels -->
				{#each L.labels as lab, i (i)}
					<text x={-6} y={i * cell + cell / 2} text-anchor="end" dominant-baseline="central" font-size="10" fill="var(--color-lightness-25)">{lab}</text>
				{/each}
			</g>
		{/if}
	</svg>
{/snippet}

{#snippet controls(theData)}
	{#if appState.currentControlTab === 'properties'}
		<div class="control-component">
			<div class="control-component-title">Pairs plot</div>
			<ControlInput label="Width"><NumberWithUnits bind:value={theData.parentBox.width} /></ControlInput>
			<ControlInput label="Height"><NumberWithUnits bind:value={theData.parentBox.height} /></ControlInput>
			<ControlInput label="Method">
				<AttributeSelect bind:value={theData.method} options={['pearson', 'spearman']} optionsDisplay={['Pearson (linear)', 'Spearman (rank)']} />
			</ControlInput>
			<ControlInput label="Colour scale">
				<AttributeSelect bind:value={theData.colormap} options={colormapOptions} optionsDisplay={colormapLabelList} />
			</ControlInput>
			<ControlInput label="Point colour"><ColourPicker bind:value={theData.pointColour} /></ControlInput>
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
