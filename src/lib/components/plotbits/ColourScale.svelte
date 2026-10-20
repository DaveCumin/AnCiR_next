<script module>
	// @ts-nocheck
	// The colour-scale legend: the key for a plot that encodes its values as COLOUR
	// rather than as position.
	//
	// WHY THIS IS NOT Legend.svelte
	//
	// A series legend lists discrete things: one swatch and one name per series. The
	// two colour-mapped plots (CWT's scalogram, the correlation heatmap) have no
	// series to list. Their key is the continuous ramp itself, so the honest legend
	// is a gradient bar labelled with the numbers its ends stand for. Same feature,
	// different mark — so this deliberately reuses the series legend's vocabulary
	// (show, the five position presets, custom fractions, font size, padding) by
	// EXTENDING LegendClass rather than restating it. Anything the user learns about
	// placing one legend transfers to the other.
	//
	// WHAT IT REPLACED
	//
	// Both plots already drew a bar, hardcoded: always on, fixed in the right margin,
	// and silently dropped altogether when the figure was too narrow for it. CWT's
	// was labelled "0" and "max" — a shape, not a measurement. This one is movable,
	// switchable, clamped into the figure rather than dropped, and labelled with the
	// real domain the plot normalises against.
	import { LegendClass, LEGEND_MARGIN, cornerFraction } from './Legend.svelte';
	import { colormapRGB } from '$lib/components/plotbits/colormaps.js';

	/** How many stops the SVG gradient is built from. Enough that the eye cannot
	 *  find the joins in any of the shipped ramps, cheap enough to inline. */
	export const GRADIENT_STOPS = 11;

	/**
	 * The gradient's stops, sampled from the SAME function that paints the field.
	 *
	 * Going through `colormapRGB` rather than restating the anchor colours is the
	 * whole point: a key drawn from a second copy of the ramp can drift away from
	 * the picture beside it, and nothing on screen would say so.
	 *
	 * @param {string} colormap key into COLORMAPS
	 * @param {number} [n] number of stops
	 * @returns {{offset: number, color: string}[]} offsets in [0, 1]
	 */
	export function gradientStops(colormap, n = GRADIENT_STOPS) {
		const count = Math.max(2, Math.floor(n));
		return Array.from({ length: count }, (_, i) => {
			const t = i / (count - 1);
			return { offset: t, color: colormapRGB(colormap, t) };
		});
	}

	/**
	 * The three values the bar is labelled with: both ends and the midpoint.
	 *
	 * Read from the domain the plot actually normalises against, never invented. A
	 * degenerate or non-finite domain collapses to zeroes rather than emitting NaN
	 * into a figure.
	 *
	 * @param {[number, number] | null | undefined} domain
	 * @returns {[number, number, number]} ascending
	 */
	export function scaleTickValues(domain) {
		const lo = Number(domain?.[0]);
		const hi = Number(domain?.[1]);
		if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 0, 0];
		return [lo, (lo + hi) / 2, hi];
	}

	/**
	 * A tick label: three significant figures, with no trailing zeroes to pad a
	 * round number out into something that looks more precise than it is.
	 * @param {number} v
	 */
	export function formatScaleValue(v) {
		if (!Number.isFinite(v)) return '';
		if (v === 0) return '0';
		return String(Number(v.toPrecision(3)));
	}

	/** Gap between the bar and its tick labels, px. */
	export const TICK_GAP = 5;
	/** Side of the "no value" swatch relative to the font size, and its gap below the bar. */
	const NO_VALUE_GAP = 6;

	/**
	 * The colour scale's geometry, shared by the component (which draws it) and a host that
	 * must reserve room for it or place it (the Scatterplot's colour by, encodingHost.js).
	 * Pure, so a host's reservation and the drawn key cannot disagree.
	 *
	 * Tick label widths are ESTIMATED from the character count rather than measured with a
	 * canvas: the bar only needs to know how much room to leave beside itself, an
	 * average-width estimate is within a character of the truth for the short numbers it
	 * prints, and it keeps the geometry testable (jsdom's measureText returns 0).
	 *
	 * @param {object} o
	 * @param {boolean} o.vertical
	 * @param {number} o.thickness bar width across its own axis
	 * @param {number} o.barLen bar length along its own axis
	 * @param {number} o.fontSize
	 * @param {string[]} o.tickLabels
	 * @param {string|null} [o.label]
	 * @param {string|null} [o.noValueLabel] the "no value" entry's text, or null for none
	 */
	export function colourScaleGeometry({
		vertical,
		thickness,
		barLen,
		fontSize,
		tickLabels,
		label = null,
		noValueLabel = null
	}) {
		const tickTextW = Math.max(...tickLabels.map((t) => t.length), 1) * fontSize * 0.6;
		// A one- or two-character label ('r', '\u03c1') rotated onto its side reads as a stray
		// mark rather than a word, so only a real word is turned. Short ones stay upright.
		const rotateLabel = !!label && String(label).length > 2;
		const labelGap = label
			? rotateLabel
				? fontSize + 4
				: String(label).length * fontSize * 0.6 + 4
			: 0;
		const swatch = Math.max(6, Math.round(fontSize * 0.8));
		const noValueW = noValueLabel ? swatch + 4 + noValueLabel.length * fontSize * 0.6 : 0;
		const noValueH = noValueLabel ? NO_VALUE_GAP + Math.max(swatch, fontSize) : 0;
		const width = vertical
			? Math.max(thickness + TICK_GAP + tickTextW + labelGap, noValueW)
			: Math.max(barLen, noValueW);
		const height = vertical ? barLen + noValueH : thickness + 3 + fontSize + labelGap + noValueH;
		return {
			width,
			height,
			tickTextW,
			rotateLabel,
			labelGap,
			swatch,
			noValueY: vertical
				? barLen + NO_VALUE_GAP
				: thickness + 3 + fontSize + labelGap + NO_VALUE_GAP
		};
	}

	/** The bar's automatic length: the plot's extent, between 30 and 150 px. */
	export function autoBarLength(extent) {
		return Math.max(30, Math.min(extent, 150));
	}

	/**
	 * The persisted colour-scale legend.
	 *
	 * Extends LegendClass so `show`, `position`, `customX/Y`, `orientation`,
	 * `fontSize`, `padding` and the background/border are defined exactly once.
	 * `withDefaults` and `fromJSON` construct via `new this`, so both come back as
	 * this class.
	 */
	export class ColourScaleClass extends LegendClass {
		/** Bar length along its own axis, in px. null = size to the plot. */
		barLength = $state(null);
		/** Bar width across its own axis, in px. */
		barThickness = $state(10);

		constructor(dataIN) {
			super(dataIN);
			// 'right' is an EXTRA preset the series legend does not have: the margin
			// beside the plot, which is where both plots' hardcoded bars already sat and
			// where a key belongs when the plot area is a dense field it would otherwise
			// cover. Set unconditionally (not inside the `if (dataIN)` the base class
			// uses) so a bare `new ColourScaleClass()` gets it too.
			this.position = dataIN?.position ?? 'right';
			if (dataIN) {
				this.barLength = typeof dataIN.barLength === 'number' ? dataIN.barLength : null;
				this.barThickness = dataIN.barThickness ?? 10;
			}
		}

		toJSON() {
			return { ...super.toJSON(), barLength: this.barLength, barThickness: this.barThickness };
		}
	}
</script>

<script>
	// @ts-nocheck
	import { resolveStyle } from '$lib/plots/figureStyle.js';
	import Icon from '$lib/icons/Icon.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';

	let {
		scaleData,
		colormap = 'viridis',
		/** [min, max] of the quantity the colours encode. */
		domain = [0, 1],
		/** The measured quantity, e.g. 'Power' or 'r'. null draws no label. */
		label = null,
		plotWidth = 0,
		plotHeight = 0,
		padding = { top: 0, right: 0, bottom: 0, left: 0 },
		// The extent of the DRAWN content inside the plot area, when it is smaller
		// than the plot area itself. The correlation heatmap's grid is square, so its
		// content stops well short of the right edge on a wide figure and the scale
		// belongs against the grid, not against empty space.
		contentWidth = null,
		contentHeight = null,
		/** Unique per plot, so a combined export cannot cross-wire two gradients. */
		idPrefix = 'plot',
		figureStyle = null,
		// Explicit ticks `{ t, label }` (t in [0, 1] along the bar), for a key whose labels are
		// not the domain's ends and middle (hour of day: 0, 6, 12, 18, 24). null keeps the
		// three domain ticks.
		ticks = null,
		// `{ colour, label }`: a swatch for the marks that have no colour value and are drawn in
		// their series colour instead (colour by). null draws none.
		noValue = null,
		// `{ x, y }` relative to the plot area, set by a host that places the key itself
		// (encodingHost.placeColourKey). null lets the position presets place it.
		placement = null,
		// The bar's length when a host sizes it (it reserved the room), or null for the
		// stored length or the automatic one.
		length = null,
		which = 'plot'
	} = $props();

	const resolved = $derived(resolveStyle(figureStyle));
	const fontSize = $derived(scaleData?.fontSize ?? resolved.sizes.legend);
	const showBox = $derived(resolved.legendBox !== false);

	const boxW = $derived(contentWidth ?? plotWidth);
	const boxH = $derived(contentHeight ?? plotHeight);

	const vertical = $derived(scaleData?.orientation !== 'horizontal');
	const thickness = $derived(scaleData?.barThickness ?? 10);
	const barLen = $derived(length ?? scaleData?.barLength ?? autoBarLength(vertical ? boxH : boxW));

	const stops = $derived(gradientStops(colormap));
	// Low end first, as `t` runs. The default three are the domain's ends and middle.
	const tickItems = $derived(
		ticks ?? scaleTickValues(domain).map((v, i) => ({ t: i / 2, label: formatScaleValue(v) }))
	);
	const gradId = $derived(`colour-scale-${idPrefix}`);
	const gap = TICK_GAP;

	const geom = $derived(
		colourScaleGeometry({
			vertical,
			thickness,
			barLen,
			fontSize,
			tickLabels: tickItems.map((t) => t.label),
			label,
			noValueLabel: noValue ? (noValue.label ?? 'no value') : null
		})
	);
	const tickTextW = $derived(geom.tickTextW);
	const rotateLabel = $derived(geom.rotateLabel);

	/** The whole key's footprint, used for placement and for the backdrop. */
	const dims = $derived({ width: geom.width, height: geom.height });

	const pos = $derived.by(() => {
		if (placement) return placement;
		const margin = LEGEND_MARGIN;
		const { width, height } = dims;
		switch (scaleData?.position) {
			case 'right': {
				// The margin beside the content. Clamped to the figure's right edge, so a
				// narrow figure squeezes the key rather than dropping it.
				const limit = plotWidth + (padding?.right ?? 0) - width;
				return { x: Math.max(0, Math.min(boxW + margin, limit)), y: 0 };
			}
			case 'custom': {
				const fx = Math.min(1, Math.max(0, scaleData.customX ?? 0));
				const fy = Math.min(1, Math.max(0, scaleData.customY ?? 0));
				const spanX = Math.max(0, boxW - width - margin * 2);
				const spanY = Math.max(0, boxH - height - margin * 2);
				return { x: margin + spanX * fx, y: margin + spanY * fy };
			}
			case 'topleft':
				return { x: margin, y: margin };
			case 'bottomright':
				return { x: boxW - width - margin, y: boxH - height - margin };
			case 'bottomleft':
				return { x: margin, y: boxH - height - margin };
			case 'topright':
			default:
				return { x: boxW - width - margin, y: margin };
		}
	});

	// A backdrop only where the key sits OVER the data. In the right margin there is
	// nothing to sit over, and a box round it there would add furniture to two
	// figures that never had any.
	const overData = $derived(scaleData?.position !== 'right');
	// Where a tick sits along the bar: vertical bars run low at the BOTTOM.
	const tickAlong = (t) => (vertical ? (1 - t) * barLen : t * barLen);
	const edgeOf = (t) => (t <= 0 ? 'low' : t >= 1 ? 'high' : 'mid');
	const pad = $derived(scaleData?.padding ?? 8);

	let lastCorner = $state('topright');
	$effect(() => {
		if (scaleData && scaleData.position !== 'custom' && scaleData.position !== 'right') {
			lastCorner = scaleData.position;
		}
	});
	function onPositionChange(next) {
		if (next !== 'custom') return;
		const f = cornerFraction(lastCorner);
		scaleData.customX = f.x;
		scaleData.customY = f.y;
	}

	// The size box edits a MIRROR, not scaleData.fontSize directly: that field is
	// nullable ("follow the figure"), and binding a nullable straight to the number
	// input turns inheriting into a hard override the moment the panel opens. A
	// writable $derived is the mirror: it shows the size actually being drawn, and
	// only a real edit (onInput below) writes the override back.
	let sizeInput = $derived(Math.round(fontSize * 10) / 10);
</script>

{#snippet scalePlot()}
	{#if scaleData?.show}
		<g
			class="colour-scale"
			transform="translate({pos.x + (padding?.left ?? 0)}, {pos.y + (padding?.top ?? 0)})"
		>
			<defs>
				<!-- Vertical bars run low at the BOTTOM, which is how every axis in the
				     app reads; horizontal ones run low at the left. -->
				<linearGradient
					id={gradId}
					x1="0%"
					y1={vertical ? '100%' : '0%'}
					x2={vertical ? '0%' : '100%'}
					y2="0%"
				>
					{#each stops as stop (stop.offset)}
						<stop offset={stop.offset * 100 + '%'} stop-color={stop.color} />
					{/each}
				</linearGradient>
			</defs>

			{#if overData}
				<rect
					x={-pad}
					y={-pad}
					width={dims.width + pad * 2}
					height={dims.height + pad * 2}
					rx={3}
					fill={scaleData.backgroundColor}
					stroke={showBox ? scaleData.borderColor : 'none'}
					stroke-width={showBox ? scaleData.borderWidth : 0}
				/>
			{/if}

			{#if vertical}
				<rect x={0} y={0} width={thickness} height={barLen} fill={'url(#' + gradId + ')'} />
				<!-- Top to bottom, so the DOM order matches the reading order: a vertical
				     bar runs high at the top. -->
				{#each tickItems.slice().reverse() as tick, i (i)}
					<text
						class="colour-scale-tick"
						x={thickness + gap}
						y={tickAlong(tick.t)}
						dominant-baseline={edgeOf(tick.t) === 'high'
							? 'hanging'
							: edgeOf(tick.t) === 'low'
								? 'auto'
								: 'central'}
						font-size={fontSize}
						font-family={resolved.fontFamily}
						fill="black">{tick.label}</text
					>
				{/each}
				{#if label && rotateLabel}
					<text
						class="colour-scale-label"
						transform="translate({thickness + gap + tickTextW + fontSize}, {barLen /
							2}) rotate(-90)"
						text-anchor="middle"
						font-size={fontSize}
						font-family={resolved.fontFamily}
						fill="black">{label}</text
					>
				{:else if label}
					<text
						class="colour-scale-label"
						x={thickness + gap + tickTextW + 4}
						y={barLen / 2}
						dominant-baseline="central"
						font-size={fontSize}
						font-family={resolved.fontFamily}
						fill="black">{label}</text
					>
				{/if}
			{:else}
				<rect x={0} y={0} width={barLen} height={thickness} fill={'url(#' + gradId + ')'} />
				{#each tickItems as tick, i (i)}
					<text
						class="colour-scale-tick"
						x={tickAlong(tick.t)}
						y={thickness + 3}
						dominant-baseline="hanging"
						text-anchor={edgeOf(tick.t) === 'low'
							? 'start'
							: edgeOf(tick.t) === 'high'
								? 'end'
								: 'middle'}
						font-size={fontSize}
						font-family={resolved.fontFamily}
						fill="black">{tick.label}</text
					>
				{/each}
				{#if label}
					<text
						class="colour-scale-label"
						x={barLen / 2}
						y={thickness + 3 + fontSize + 3}
						text-anchor="middle"
						dominant-baseline="hanging"
						font-size={fontSize}
						font-family={resolved.fontFamily}
						fill="black">{label}</text
					>
				{/if}
			{/if}
			{#if noValue}
				<!-- The marks with no colour value are drawn in their series colour: say so. -->
				<g class="colour-scale-novalue" transform="translate(0, {geom.noValueY})">
					<rect
						x={0}
						y={0}
						width={geom.swatch}
						height={geom.swatch}
						fill={noValue.colour}
						stroke="none"
					/>
					<text
						x={geom.swatch + 4}
						y={geom.swatch / 2}
						dominant-baseline="central"
						font-size={fontSize}
						font-family={resolved.fontFamily}
						fill="black">{noValue.label ?? 'no value'}</text
					>
				</g>
			{/if}
		</g>
	{/if}
{/snippet}

{#snippet scaleControls()}
	<div class="control-component">
		<div class="control-component-title">
			<p>Colour scale</p>
			<button
				class="icon"
				title="Show the colour scale"
				onclick={() => (scaleData.show = !scaleData.show)}
			>
				{#if !scaleData.show}
					<Icon name="eye-slash" width={16} height={16} />
				{:else}
					<Icon name="eye" width={16} height={16} className="visible" />
				{/if}
			</button>
		</div>

		{#if scaleData.show}
			<div class="control-input-horizontal">
				<div class="control-input">
					<p>Position</p>
					<AttributeSelect
						bind:value={scaleData.position}
						options={['right', 'topright', 'topleft', 'bottomright', 'bottomleft', 'custom']}
						optionsDisplay={[
							'Beside plot',
							'Top right',
							'Top left',
							'Bottom right',
							'Bottom left',
							'Custom'
						]}
						onChange={(v) => onPositionChange(v)}
					/>
				</div>
				<div class="control-input">
					<p>Layout</p>
					<AttributeSelect
						bind:value={scaleData.orientation}
						options={['vertical', 'horizontal']}
						optionsDisplay={['Vertical', 'Horizontal']}
					/>
				</div>
			</div>

			<div class="control-input-horizontal">
				{#if scaleData.position === 'custom'}
					<ControlInput label="X (0-1)">
						<NumberWithUnits bind:value={scaleData.customX} min={0} max={1} step={0.01} />
					</ControlInput>
					<ControlInput label="Y (0-1)">
						<NumberWithUnits bind:value={scaleData.customY} min={0} max={1} step={0.01} />
					</ControlInput>
				{/if}
				<ControlInput label="Font size">
					<NumberWithUnits
						bind:value={sizeInput}
						min={4}
						max={48}
						step={0.5}
						onInput={() => (scaleData.fontSize = sizeInput)}
					/>
				</ControlInput>
				<ControlInput label="Bar width">
					<NumberWithUnits bind:value={scaleData.barThickness} min={2} max={40} />
				</ControlInput>
			</div>
		{/if}
	</div>
{/snippet}

{#if which === 'plot'}
	{@render scalePlot()}
{:else if which === 'controls'}
	{@render scaleControls()}
{/if}
