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

	let labelWidths = $state([]); // width of each <text> element
	let measuringCanvas = $state(null); // hidden <canvas> for text metrics

	// create a hidden canvas once (Svelte runs this after first render)
	$effect(() => {
		if (!measuringCanvas) {
			const canvas = document.createElement('canvas');
			document.body.appendChild(canvas);
			measuringCanvas = canvas.getContext('2d');
		}
	});

	// recompute widths whenever items, fontSize or the items array change
	$effect(() => {
		if (!measuringCanvas || !legendData.show || items.length === 0) {
			labelWidths = [];
			return;
		}
		measuringCanvas.font = `${legendData.fontSize}px sans-serif`;
		labelWidths = items.map((it) => measuringCanvas.measureText(it.label).width);
	});

	// Calculate legend dimensions
	let legendDimensions = $derived.by(() => {
		if (!legendData.show || items.length === 0) return { width: 0, height: 0, contentHeight: 0 };

		const iconW = 25; // space for line / circle
		const gap = 4; // gap between icon and text
		const padding = legendData.padding;

		// max width of *all* labels (plus icon + gap)
		const maxLabelW = Math.max(...labelWidths, 0) + 2 + legendData.padding / 2;
		const contentW = iconW + gap + maxLabelW;

		const lineH = legendData.fontSize + legendData.itemSpacing + 4; // +4 for possible overlap

		if (legendData.orientation === 'vertical') {
			return {
				width: contentW + padding * 2,
				height: items.length * lineH + padding * 2,
				contentHeight: legendData.fontSize
			};
		} else {
			// horizontal: each entry gets its own width + a little extra spacing
			const totalContentW = items.reduce((sum, _, i) => sum + iconW + gap + labelWidths[i] + 10, 0);
			return {
				width: totalContentW + padding * 2,
				height: lineH + padding * 2,
				contentHeight: legendData.fontSize
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

	let xPositions = $derived.by(() => {
		if (!legendData.show || items.length === 0 || legendData.orientation !== 'horizontal') {
			return [];
		}

		const iconW = 25;
		const gap = 4;
		const spacing = 10;
		const positions = [];
		let cumulative = legendData.padding;

		for (let i = 0; i < items.length; i++) {
			const labelW = labelWidths[i] ?? 0;
			positions.push(cumulative);
			cumulative += iconW + gap + labelW + spacing;
		}

		return positions;
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
			<!--
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
			-->
		{/if}
	</div>
{/snippet}

svelte{#snippet legendPlot()}
	{#if legendData.show && items.length > 0}
		<g transform="translate({legendPosition.x + padding.left}, {legendPosition.y + padding.top})">
			<!-- background -->
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

			<!-- items -->
			{#each items as item, i}
				{@const lineH = legendData.fontSize + legendData.itemSpacing + 4}
				{@const iconW = 25}
				{@const gap = 4}
				{@const labelW = labelWidths[i] ?? 0}

				{#if legendData.orientation === 'vertical'}
					{@const itemX = legendData.padding}
					{@const itemY = legendData.padding + i * lineH + lineH / 2}
					<g transform="translate({itemX}, {itemY})">
						{#each item.elements as el}
							{#if el.type === 'line'}
								<line
									x1={2}
									y1={0}
									x2={18}
									y2={0}
									stroke={el.color}
									stroke-width={el.strokeWidth}
									stroke-dasharray={el.stroke}
								/>
							{:else if el.type === 'points'}
								<circle cx={10} cy={0} r={el.size} fill={el.color} />
							{/if}
						{/each}
						<text x={iconW + gap} y={0} dy="0.35em" font-size={legendData.fontSize} fill="black">
							{item.label}
						</text>
					</g>
				{:else}
					<!-- HORIZONTAL -->
					{@const startX = xPositions[i] ?? legendData.padding}
					{@const itemY = legendDimensions.height / 2}

					<g transform="translate({startX}, {itemY})">
						{#each item.elements as el}
							{#if el.type === 'line'}
								<line
									x1={2}
									y1={0}
									x2={18}
									y2={0}
									stroke={el.color}
									stroke-width={el.strokeWidth}
									stroke-dasharray={el.stroke}
								/>
							{:else if el.type === 'points'}
								<circle cx={10} cy={0} r={el.size} fill={el.color} />
							{/if}
						{/each}
						<text x={iconW + gap} y={0} dy="0.35em" font-size={legendData.fontSize} fill="black">
							{item.label}
						</text>
					</g>
				{/if}
			{/each}
		</g>
	{/if}
{/snippet}

{#if which === 'plot'}
	{@render legendPlot()}
{:else if which === 'controls'}
	{@render legendControls()}
{/if}
