<script module>
	import Icon from '$lib/icons/Icon.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import ColourPicker from '$lib/components/inputs/ColourPicker.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';

	export class LegendClass {
		show = $state(true);
		position = $state('topright'); // topright, topleft, bottomright, bottomleft
		orientation = $state('vertical'); // vertical, horizontal
		backgroundColor = $state('rgba(255, 255, 255, 0.9)');
		borderColor = $state('#ccc');
		borderWidth = $state(1);
		padding = $state(8);
		itemSpacing = $state(4);
		fontSize = $state(12);

		constructor(dataIN) {
			if (dataIN) {
				this.show = dataIN.show ?? true;
				this.position = dataIN.position ?? 'topright';
				this.orientation = dataIN.orientation ?? 'vertical';
				this.backgroundColor = dataIN.backgroundColor ?? 'rgba(255, 255, 255, 0.9)';
				this.borderColor = dataIN.borderColor ?? '#ccc';
				this.borderWidth = dataIN.borderWidth ?? 1;
				this.padding = dataIN.padding ?? 8;
				this.itemSpacing = dataIN.itemSpacing ?? 4;
				this.fontSize = dataIN.fontSize ?? 12;
			}
		}

		toJSON() {
			return {
				show: this.show,
				position: this.position,
				orientation: this.orientation,
				backgroundColor: this.backgroundColor,
				borderColor: this.borderColor,
				borderWidth: this.borderWidth,
				padding: this.padding,
				itemSpacing: this.itemSpacing,
				fontSize: this.fontSize
			};
		}

		static fromJSON(json) {
			return new LegendClass(json);
		}
	}
</script>

<script>
	let { legendData, items = [], plotWidth, plotHeight, padding, which = 'plot' } = $props();

	// Calculate legend dimensions
	let legendDimensions = $derived.by(() => {
		if (!legendData.show || items.length === 0) return { width: 0, height: 0 };

		// Account for potential multiple elements per item (line + points)
		const itemHeight = legendData.fontSize + legendData.itemSpacing + 4; // Extra space for overlapping elements
		const maxLabelWidth = 80; // Approximate max width for label
		const iconWidth = 25;
		const itemWidth = iconWidth + maxLabelWidth;

		if (legendData.orientation === 'vertical') {
			return {
				width: itemWidth + legendData.padding * 2,
				height: items.length * itemHeight + legendData.padding * 2
			};
		} else {
			return {
				width: items.length * (itemWidth + 10) + legendData.padding * 2, // Extra spacing between items
				height: itemHeight + legendData.padding * 2
			};
		}
	});

	// Calculate legend position
	let legendPosition = $derived.by(() => {
		if (!legendData.show) return { x: 0, y: 0 };

		const { width, height } = legendDimensions;
		const margin = 10;

		switch (legendData.position) {
			case 'topright':
				return {
					x: plotWidth - width - margin,
					y: margin
				};
			case 'topleft':
				return {
					x: margin,
					y: margin
				};
			case 'bottomright':
				return {
					x: plotWidth - width - margin,
					y: plotHeight - height - margin
				};
			case 'bottomleft':
				return {
					x: margin,
					y: plotHeight - height - margin
				};
			default:
				return { x: margin, y: margin };
		}
	});
</script>

{#snippet legendControls()}
	<div class="control-component">
		<div class="control-component-title">
			<p>Legend</p>
			<button class="icon" onclick={() => (legendData.show = !legendData.show)}>
				{#if !legendData.show}
					<Icon name="eye-slash" width={16} height={16} />
				{:else}
					<Icon name="eye" width={16} height={16} className="visible" />
				{/if}
			</button>
		</div>

		{#if legendData.show}
			<div class="control-input-horizontal">
				<div class="control-input">
					<p>Position</p>
					<AttributeSelect
						bind:value={legendData.position}
						options={['topright', 'topleft', 'bottomright', 'bottomleft']}
						optionsDisplay={['Top Right', 'Top Left', 'Bottom Right', 'Bottom Left']}
					/>
				</div>
				<div class="control-input">
					<p>Layout</p>
					<AttributeSelect
						bind:value={legendData.orientation}
						options={['vertical', 'horizontal']}
						optionsDisplay={['Vertical', 'Horizontal']}
					/>
				</div>
			</div>

			<div class="control-input-horizontal">
				<div class="control-input">
					<p>Font Size</p>
					<NumberWithUnits bind:value={legendData.fontSize} min={8} max={24} />
				</div>
				<div class="control-input">
					<p>Padding</p>
					<NumberWithUnits bind:value={legendData.padding} min={0} max={20} />
				</div>
			</div>

			<div class="control-input-horizontal">
				<div class="control-input">
					<p style="color: white;">BG</p>
					<ColourPicker bind:value={legendData.backgroundColor} />
				</div>
				<div class="control-input">
					<p style="color: white;">Border</p>
					<ColourPicker bind:value={legendData.borderColor} />
				</div>
			</div>
		{/if}
	</div>
{/snippet}

{#snippet legendPlot()}
	{#if legendData.show && items.length > 0}
		<g transform="translate({legendPosition.x + padding.left}, {legendPosition.y + padding.top})">
			<!-- Legend background -->
			<rect
				x={0}
				y={0}
				width={legendDimensions.width}
				height={legendDimensions.height}
				fill={legendData.backgroundColor}
				stroke={legendData.borderColor}
				stroke-width={legendData.borderWidth}
				rx={3}
			/>

			<!-- Legend items -->
			{#each items as item, i}
				{@const itemX =
					legendData.orientation === 'horizontal'
						? i * 120 + legendData.padding
						: legendData.padding}
				{@const itemY =
					legendData.orientation === 'vertical'
						? i * (legendData.fontSize + legendData.itemSpacing + 4) + legendData.padding
						: legendData.padding}

				<g transform="translate({itemX}, {itemY})">
					<!-- Render combined elements for this data series -->
					{#each item.elements as element, j}
						{@const yOffset = j * 2}
						<!-- Slight offset for multiple elements -->

						{#if element.type === 'line'}
							<line
								x1={2}
								y1={legendData.fontSize / 2 + yOffset}
								x2={18}
								y2={legendData.fontSize / 2 + yOffset}
								stroke={element.color}
								stroke-width={Math.min(element.strokeWidth, 3)}
								stroke-dasharray={element.stroke}
							/>
							<!-- Show smoother if present -->
							{#if element.smoother}
								<line
									x1={2}
									y1={legendData.fontSize / 2 + yOffset}
									x2={18}
									y2={legendData.fontSize / 2 + yOffset}
									stroke={element.smoother.color}
									stroke-width={Math.min(element.smoother.strokeWidth, 2)}
									stroke-dasharray={element.smoother.stroke}
								/>
							{/if}
						{:else if element.type === 'points'}
							<circle
								cx={10}
								cy={legendData.fontSize / 2 + yOffset - Math.min(element.size, 4) / 2}
								r={Math.min(element.size, 4)}
								fill={element.color}
							/>
						{/if}
					{/each}

					<!-- Label -->
					<text
						x={22}
						y={legendData.fontSize / 2}
						dy="0.35em"
						font-size={legendData.fontSize}
						fill="black"
					>
						{item.label}
					</text>
				</g>
			{/each}
		</g>
	{/if}
{/snippet}

{#if which === 'plot'}
	{@render legendPlot()}
{:else if which === 'controls'}
	{@render legendControls()}
{/if}
