<script module>
	import ColourPicker, { getPaletteColor } from '$lib/components/inputs/ColourPicker.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import { isValidStroke } from '$lib/components/plotBits/helpers/misc.js';

	export class BoxClass {
		colour = $state(getPaletteColor(0));
		fillColour = $state(getPaletteColor(0));
		fillOpacity = $state(0.3);
		strokeWidth = $state(2);
		stroke = $state('solid');
		draw = $state(true);
		showOutliers = $state(true);
		outlierSize = $state(3);
		whiskerWidth = $state(0.5);
		boxWidth = $state(0.8);
		medianWidth = $state(2);
		medianColour = $state('#000000');

		constructor(dataIN, parent) {
			this.parentData = parent;
			this.colour =
				dataIN?.colour ?? getPaletteColor(parent.parentPlot.data.length) ?? getPaletteColor(0);
			this.fillColour =
				dataIN?.fillColour ?? getPaletteColor(parent.parentPlot.data.length) ?? getPaletteColor(0);
			this.fillOpacity = dataIN?.fillOpacity ?? 0.3;
			this.strokeWidth = dataIN?.strokeWidth ?? 2;
			this.stroke = dataIN?.stroke ?? 'solid';
			this.draw = dataIN?.draw ?? true;
			this.showOutliers = dataIN?.showOutliers ?? true;
			this.outlierSize = dataIN?.outlierSize ?? 3;
			this.whiskerWidth = dataIN?.whiskerWidth ?? 0.5;
			this.boxWidth = dataIN?.boxWidth ?? 0.8;
			this.medianWidth = dataIN?.medianWidth ?? 2;
			this.medianColour = dataIN?.medianColour ?? '#000000';
		}

		toJSON() {
			return {
				colour: this.colour,
				fillColour: this.fillColour,
				fillOpacity: this.fillOpacity,
				strokeWidth: this.strokeWidth,
				stroke: this.stroke,
				draw: this.draw,
				showOutliers: this.showOutliers,
				outlierSize: this.outlierSize,
				whiskerWidth: this.whiskerWidth,
				boxWidth: this.boxWidth,
				medianWidth: this.medianWidth,
				medianColour: this.medianColour
			};
		}

		static fromJSON(json) {
			return new BoxClass({
				colour: json.colour,
				fillColour: json.fillColour,
				fillOpacity: json.fillOpacity,
				strokeWidth: json.strokeWidth,
				stroke: json.stroke,
				draw: json.draw,
				showOutliers: json.showOutliers,
				outlierSize: json.outlierSize,
				whiskerWidth: json.whiskerWidth,
				boxWidth: json.boxWidth,
				medianWidth: json.medianWidth,
				medianColour: json.medianColour
			});
		}
	}

	function calculateBoxPlotStats(data) {
		if (!data || data.length === 0) return null;

		// Filter out null, undefined, and NaN values
		const validData = data.filter((d) => d != null && !isNaN(d));
		if (validData.length === 0) return null;

		// Sort data
		const sorted = [...validData].sort((a, b) => a - b);
		const n = sorted.length;

		// Calculate quartiles
		const q1Index = Math.floor(n * 0.25);
		const q2Index = Math.floor(n * 0.5);
		const q3Index = Math.floor(n * 0.75);

		const q1 = sorted[q1Index];
		const q2 = sorted[q2Index]; // median
		const q3 = sorted[q3Index];

		const iqr = q3 - q1;
		const lowerFence = q1 - 1.5 * iqr;
		const upperFence = q3 + 1.5 * iqr;

		// Find whisker positions (min/max within fences)
		const lowerWhisker = sorted.find((d) => d >= lowerFence) ?? sorted[0];
		const upperWhisker = sorted.reverse().find((d) => d <= upperFence) ?? sorted[0];

		// Find outliers
		const outliers = validData.filter((d) => d < lowerFence || d > upperFence);

		return {
			q1,
			q2,
			q3,
			lowerWhisker,
			upperWhisker,
			outliers,
			min: sorted[0],
			max: sorted[sorted.length - 1]
		};
	}
</script>

<script>
	let {
		boxPlotData = $bindable(),
		y,
		x = null,
		xscale,
		yscale,
		yoffset = 0,
		xoffset = 0,
		which,
		title = 'Box Plot'
	} = $props();

	let width = $derived(xscale.range()[1]);
	let height = $derived(yscale.range()[0]);
	let clipKey = $derived(`boxplot-${xoffset}-${yoffset}-${width}-${height}`);

	let stats = $derived.by(() => {
		if (!boxPlotData?.draw || !y) return null;
		return calculateBoxPlotStats(y);
	});

	let xCenter = $derived.by(() => {
		if (!xscale) return 0;
		const domain = xscale.domain();
		const center = (domain[0] + domain[1]) / 2;
		return xscale(center);
	});

	let boxHalfWidth = $derived.by(() => {
		if (!xscale) return 20;
		const domain = xscale.domain();
		const range = Math.abs(domain[1] - domain[0]);
		return (xscale(domain[0] + (range * boxPlotData.boxWidth) / 2) - xscale(domain[0])) / 2;
	});

	let whiskerHalfWidth = $derived.by(() => {
		return boxHalfWidth * boxPlotData.whiskerWidth;
	});
</script>

{#snippet controls(boxPlotData)}
	<div class="control-component">
		<div class="control-component-title">
			<p>{title}</p>
			<button
				class="icon"
				onclick={(e) => {
					e.stopPropagation();
					boxPlotData.draw = !boxPlotData.draw;
				}}
			>
				{#if !boxPlotData.draw}
					<Icon name="eye-slash" width={16} height={16} />
				{:else}
					<Icon name="eye" width={16} height={16} className="visible" />
				{/if}
			</button>
		</div>
		{#if boxPlotData.draw}
			<div class="control-input-horizontal">
				<div class="control-input" style="max-width: 1.5rem;">
					<p>Stroke</p>
					<ColourPicker bind:value={boxPlotData.colour} />
				</div>
				<div class="control-input" style="max-width: 1.5rem;">
					<p>Fill</p>
					<ColourPicker bind:value={boxPlotData.fillColour} />
				</div>
				<div class="control-input">
					<p>Opacity</p>
					<NumberWithUnits step="0.1" min={0} max={1} bind:value={boxPlotData.fillOpacity} />
				</div>
			</div>
			<div class="control-input-horizontal">
				<div class="control-input">
					<p>Stroke Width</p>
					<NumberWithUnits step="0.2" min={0.1} bind:value={boxPlotData.strokeWidth} />
				</div>
				<div class="control-input">
					<p>Stroke Style</p>
					<div style="border: {boxPlotData.stroke === -1 ? '1' : '0'}px solid red;">
						<AttributeSelect
							onChange={(value) => {
								if (isValidStroke(value)) {
									boxPlotData.stroke = value;
								} else {
									boxPlotData.stroke = -1;
								}
							}}
							options={['solid', '5, 5', '2, 2', '5, 2']}
							optionsDisplay={['Solid', 'Dashed', 'Dotted', 'Dashed & Dotted']}
							other={true}
							placeholder={'eg 5, 5'}
						/>
					</div>
				</div>
			</div>
			<div class="control-input-horizontal">
				<div class="control-input">
					<p>Box Width</p>
					<NumberWithUnits step="0.1" min={0.1} max={1} bind:value={boxPlotData.boxWidth} />
				</div>
				<div class="control-input">
					<p>Whisker Width</p>
					<NumberWithUnits step="0.1" min={0.1} max={1} bind:value={boxPlotData.whiskerWidth} />
				</div>
			</div>
			<div class="control-input-horizontal">
				<div class="control-input" style="max-width: 1.5rem;">
					<p>Median</p>
					<ColourPicker bind:value={boxPlotData.medianColour} />
				</div>
				<div class="control-input">
					<p>Median Width</p>
					<NumberWithUnits step="0.2" min={0.1} bind:value={boxPlotData.medianWidth} />
				</div>
			</div>
			<div class="control-input-horizontal">
				<div class="control-input">
					<p>Show Outliers</p>
					<input type="checkbox" bind:checked={boxPlotData.showOutliers} />
				</div>
				{#if boxPlotData.showOutliers}
					<div class="control-input">
						<p>Outlier Size</p>
						<NumberWithUnits step="0.5" min={1} bind:value={boxPlotData.outlierSize} />
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/snippet}

{#snippet plot(boxPlotData)}
	{#if stats && boxPlotData?.draw}
		<clipPath id={clipKey}>
			<rect x={xoffset} y={yoffset} {width} {height} />
		</clipPath>
		<g clip-path="url(#{clipKey})" style="transform: translate({xoffset}px, {yoffset}px);">
			<!-- Lower whisker line -->
			<line
				x1={xCenter}
				y1={yscale(stats.lowerWhisker)}
				x2={xCenter}
				y2={yscale(stats.q1)}
				stroke={boxPlotData.colour}
				stroke-width={boxPlotData.strokeWidth}
				stroke-dasharray={boxPlotData.stroke}
			/>
			<!-- Lower whisker cap -->
			<line
				x1={xCenter - whiskerHalfWidth}
				y1={yscale(stats.lowerWhisker)}
				x2={xCenter + whiskerHalfWidth}
				y2={yscale(stats.lowerWhisker)}
				stroke={boxPlotData.colour}
				stroke-width={boxPlotData.strokeWidth}
				stroke-dasharray={boxPlotData.stroke}
			/>

			<!-- Box -->
			<rect
				x={xCenter - boxHalfWidth}
				y={yscale(stats.q3)}
				width={boxHalfWidth * 2}
				height={yscale(stats.q1) - yscale(stats.q3)}
				fill={boxPlotData.fillColour}
				fill-opacity={boxPlotData.fillOpacity}
				stroke={boxPlotData.colour}
				stroke-width={boxPlotData.strokeWidth}
				stroke-dasharray={boxPlotData.stroke}
			/>

			<!-- Median line -->
			<line
				x1={xCenter - boxHalfWidth}
				y1={yscale(stats.q2)}
				x2={xCenter + boxHalfWidth}
				y2={yscale(stats.q2)}
				stroke={boxPlotData.medianColour}
				stroke-width={boxPlotData.medianWidth}
			/>

			<!-- Upper whisker line -->
			<line
				x1={xCenter}
				y1={yscale(stats.q3)}
				x2={xCenter}
				y2={yscale(stats.upperWhisker)}
				stroke={boxPlotData.colour}
				stroke-width={boxPlotData.strokeWidth}
				stroke-dasharray={boxPlotData.stroke}
			/>
			<!-- Upper whisker cap -->
			<line
				x1={xCenter - whiskerHalfWidth}
				y1={yscale(stats.upperWhisker)}
				x2={xCenter + whiskerHalfWidth}
				y2={yscale(stats.upperWhisker)}
				stroke={boxPlotData.colour}
				stroke-width={boxPlotData.strokeWidth}
				stroke-dasharray={boxPlotData.stroke}
			/>

			<!-- Outliers -->
			{#if boxPlotData.showOutliers}
				{#each stats.outliers as outlier}
					<circle
						cx={xCenter}
						cy={yscale(outlier)}
						r={boxPlotData.outlierSize}
						fill="none"
						stroke={boxPlotData.colour}
						stroke-width={boxPlotData.strokeWidth}
					/>
				{/each}
			{/if}
		</g>
	{/if}
{/snippet}

{#if which === 'plot'}
	{@render plot(boxPlotData)}
{:else if which === 'controls'}
	{@render controls(boxPlotData)}
{/if}
