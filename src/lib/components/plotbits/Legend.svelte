<script module>
	import Icon from '$lib/icons/Icon.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import ColourPicker from '$lib/components/inputs/ColourPicker.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';

	// Legend border defaults.
	//
	// The old default was too pale to read as a box, so legends looked unboxed even
	// though the rect was always drawn. Bumping the default alone would have fixed
	// only NEW legends: borderColor is persisted, so every saved session (including
	// all the shipped examples) would keep the faint value forever.
	//
	// So this exact string is treated as "never deliberately chosen" and upgraded on
	// load, on the same principle as an auto-assigned series colour: it was a
	// default, not a decision. Any other value is left untouched, including a
	// deliberately pale grey: the ColourPicker writes a hex literal, never this
	// token reference, so a user's choice is always distinguishable from the default
	// even when the two resolve to the same colour.
	/**
	 * Inset the corner presets sit at, and the span the custom fractions map onto.
	 *
	 * Shared deliberately: because custom placement runs over the SAME inset area,
	 * fraction 0 lands exactly where a left preset does and fraction 1 exactly where a
	 * right preset does. That is what lets switching to Custom keep the legend
	 * precisely where it already was instead of nudging it by the margin.
	 */
	export const LEGEND_MARGIN = 10;

	/**
	 * The custom fraction equivalent to each corner preset.
	 *
	 * Used when the user switches position to Custom: seeding from the corner the
	 * legend is currently in means Custom starts as "where it is now" and becomes an
	 * adjustment, rather than throwing the placement away and starting at a default.
	 */
	export const CORNER_FRACTIONS = {
		topleft: { x: 0, y: 0 },
		topright: { x: 1, y: 0 },
		bottomleft: { x: 0, y: 1 },
		bottomright: { x: 1, y: 1 }
	};

	/** @param {string} position */
	export function cornerFraction(position) {
		return CORNER_FRACTIONS[position] ?? { x: 0, y: 0 };
	}

	const LEGACY_PALE_BORDER = 'var(--color-lightness-80)';
	const DEFAULT_BORDER = 'var(--color-lightness-25)';

	// Legend type size.
	//
	// It used to be a hardcoded 12, persisted on every legend. Same problem as the
	// border colour: leaving a saved 12 in place would pin every existing legend
	// outside the type system forever, so a saved value EQUAL to that old default is
	// treated as "never deliberately chosen" and released to follow the figure. Any
	// other number is a real override and kept.
	//
	// Appearance does not change: the transitional style's legend ratio resolves to
	// exactly 12px (see TRANSITIONAL_ROLE_SCALE).
	const LEGACY_FONT_SIZE = 12;

	/** @param {number | undefined | null} saved */
	function resolveFontSize(saved) {
		if (typeof saved !== 'number' || !Number.isFinite(saved)) return null;
		return saved === LEGACY_FONT_SIZE ? null : saved;
	}

	/** @param {string | undefined | null} saved */
	function resolveBorderColour(saved) {
		if (!saved || saved === LEGACY_PALE_BORDER) return DEFAULT_BORDER;
		return saved;
	}

	export class LegendClass {
		show = $state(true);
		// topright | topleft | bottomright | bottomleft | custom
		position = $state('topright');
		// Free placement, used only when position === 'custom'. Stored as a FRACTION of
		// the plot area (0..1) rather than pixels, so a legend keeps its place when the
		// figure is resized — which now happens whenever a width preset is chosen.
		customX = $state(0.02);
		customY = $state(0.02);
		orientation = $state('vertical'); // vertical, horizontal
		backgroundColor = $state('rgba(255, 255, 255, 0.9)');
		// Matches the ink of the type it encloses, which is the convention for a
		// figure legend. See LEGACY_PALE_BORDER above for why saved sessions are
		// migrated rather than left on the old value.
		borderColor = $state(DEFAULT_BORDER);
		borderWidth = $state(1);
		padding = $state(8);
		itemSpacing = $state(4);
		// null = follow the figure's base type size. A number is a deliberate override.
		// The old default was a hardcoded 12; see LEGACY_FONT_SIZE.
		fontSize = $state(null);

		constructor(dataIN) {
			if (dataIN) {
				this.show = dataIN.show ?? true;
				this.position = dataIN.position ?? 'topright';
				this.customX = typeof dataIN.customX === 'number' ? dataIN.customX : 0.02;
				this.customY = typeof dataIN.customY === 'number' ? dataIN.customY : 0.02;
				this.orientation = dataIN.orientation ?? 'vertical';
				this.backgroundColor = dataIN.backgroundColor ?? 'rgba(255, 255, 255, 0.9)';
				this.borderColor = resolveBorderColour(dataIN.borderColor);
				this.borderWidth = dataIN.borderWidth ?? 1;
				this.padding = dataIN.padding ?? 8;
				this.itemSpacing = dataIN.itemSpacing ?? 4;
				this.fontSize = resolveFontSize(dataIN.fontSize);
			}
		}

		toJSON() {
			return {
				show: this.show,
				position: this.position,
				customX: this.customX,
				customY: this.customY,
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
	import { resolveStyle } from '$lib/plots/figureStyle.js';
	import { getPointPath } from './pointShapes.js';

	let {
		legendData,
		items = [],
		plotWidth,
		plotHeight,
		padding,
		which = 'plot',
		// This figure's style, passed by the plot that renders this legend. See the
		// note in Axis.svelte for why this is a prop and not context.
		figureStyle = null
	} = $props();

	// Tolerates null and returns the defaults.
	const resolved = $derived(resolveStyle(figureStyle));
	// The size actually drawn: a deliberate per-legend override, else the figure's
	// legend size. Every use goes through this — the box is sized from measured text
	// widths and line heights, so a null leaking into that maths would become NaN and
	// collapse the legend rather than merely mis-size it.
	const legendFontSize = $derived(legendData.fontSize ?? resolved.sizes.legend);

	// The control edits a LOCAL mirror, not legendData.fontSize directly.
	//
	// Binding the nullable field straight to NumberWithUnits meant its mount-time
	// clamp wrote `min` back into it, so opening the control panel turned "follow the
	// figure" into a hard 8px override. NumberWithUnits no longer clamps non-numbers,
	// but going through a mirror is the right shape regardless: the box always shows
	// the size actually being drawn (inherited or overridden), and only a real edit
	// writes an override.
	// The last corner preset the legend sat in, so switching to Custom can seed the
	// fractions from where it already is. Tracked rather than read at change time
	// because bind:value has already written 'custom' by the time onChange fires.
	let lastCorner = $state('topright');
	$effect(() => {
		if (legendData.position !== 'custom') lastCorner = legendData.position;
	});

	function onPositionChange(next) {
		if (next !== 'custom') return;
		const f = cornerFraction(lastCorner);
		legendData.customX = f.x;
		legendData.customY = f.y;
	}

	let legendSizeInput = $state(0);
	$effect(() => {
		legendSizeInput = Math.round(legendFontSize * 10) / 10;
	});
	// Whether to draw the box at all. The border colour and width stay on
	// legendData: this flag is house style, those are per-legend refinements.
	const showBox = $derived(resolved.legendBox !== false);

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
		// Family from the figure style, NOT a hardcoded 'sans-serif'. The legend box is
		// sized from these measured widths, so measuring in the wrong family makes the
		// border not fit the text it encloses — invisible while the figure is sans,
		// wrong the moment it is switched to serif.
		measuringCanvas.font = `${legendFontSize}px ${resolved.fontFamily}`;
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

		const lineH = legendFontSize + legendData.itemSpacing + 4; // +4 for possible overlap

		if (legendData.orientation === 'vertical') {
			return {
				width: contentW + padding * 2,
				height: items.length * lineH + padding * 2,
				contentHeight: legendFontSize
			};
		} else {
			// horizontal: each entry gets its own width + a little extra spacing
			const totalContentW = items.reduce((sum, _, i) => sum + iconW + gap + labelWidths[i] + 10, 0);
			return {
				width: totalContentW + padding * 2,
				height: lineH + padding * 2,
				contentHeight: legendFontSize
			};
		}
	});

	// Calculate legend position
	let legendPosition = $derived.by(() => {
		if (!legendData.show) return { x: 0, y: 0 };

		const { width, height } = legendDimensions;
		const margin = LEGEND_MARGIN;

		switch (legendData.position) {
			case 'custom': {
				// Runs over the same inset area the presets use, so fraction 0 and 1 coincide
				// exactly with the left/right and top/bottom presets. Clamped, so a legend
				// can never be typed entirely off the figure and appear to have vanished.
				const fx = Math.min(1, Math.max(0, legendData.customX ?? 0));
				const fy = Math.min(1, Math.max(0, legendData.customY ?? 0));
				const spanX = Math.max(0, plotWidth - width - margin * 2);
				const spanY = Math.max(0, plotHeight - height - margin * 2);
				return { x: margin + spanX * fx, y: margin + spanY * fy };
			}
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
						options={['topright', 'topleft', 'bottomright', 'bottomleft', 'custom']}
						optionsDisplay={['Top Right', 'Top Left', 'Bottom Right', 'Bottom Left', 'Custom']}
					onChange={(v) => onPositionChange(v)}
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
				{#if legendData.position === 'custom'}
					<ControlInput label="X (0-1)">
						<NumberWithUnits bind:value={legendData.customX} min={0} max={1} step={0.01} />
					</ControlInput>
					<ControlInput label="Y (0-1)">
						<NumberWithUnits bind:value={legendData.customY} min={0} max={1} step={0.01} />
					</ControlInput>
				{/if}
				<ControlInput label="Font Size">
					<NumberWithUnits
						bind:value={legendSizeInput}
						min={4}
						max={48}
						step={0.5}
						onInput={() => (legendData.fontSize = legendSizeInput)}
					/>
				</ControlInput>
				<ControlInput label="Padding">
					<NumberWithUnits bind:value={legendData.padding} min={0} max={20} />
				</ControlInput>
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

{#snippet legendPlot()}
	{#if legendData.show && items.length > 0}
		<g transform="translate({legendPosition.x + padding.left}, {legendPosition.y + padding.top})">
			<!-- background + box. `legendBox: false` drops the stroke but keeps the fill,
			     so an unboxed legend over data is still readable. -->
			<rect
				x={0}
				y={0}
				width={legendDimensions.width}
				height={legendDimensions.height}
				fill={legendData.backgroundColor}
				stroke={showBox ? legendData.borderColor : 'none'}
				stroke-width={showBox ? legendData.borderWidth : 0}
				rx={3}
			/>

			<!-- items -->
			{#each items as item, i}
				{@const lineH = legendFontSize + legendData.itemSpacing + 4}
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
								<path d={getPointPath(el.shape || 'circle', 10, 0, el.size)} fill={el.color} />
							{:else if el.type === 'boxplot'}
								<rect
									x={3}
									y={-6}
									width={14}
									height={12}
									fill={el.fillColor ?? 'none'}
									fill-opacity={el.fillOpacity ?? 0.3}
									stroke={el.color}
									stroke-width={2}
								/>
							{/if}
						{/each}
						<text x={iconW + gap} y={0} dy="0.35em" font-size={legendFontSize} font-family={resolved.fontFamily} fill="black">
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
								<path d={getPointPath(el.shape || 'circle', 10, 0, el.size)} fill={el.color} />
							{:else if el.type === 'boxplot'}
								<rect
									x={3}
									y={-6}
									width={14}
									height={12}
									fill={el.fillColor ?? 'none'}
									fill-opacity={el.fillOpacity ?? 0.3}
									stroke={el.color}
									stroke-width={2}
								/>
							{/if}
						{/each}
						<text x={iconW + gap} y={0} dy="0.35em" font-size={legendFontSize} font-family={resolved.fontFamily} fill="black">
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
