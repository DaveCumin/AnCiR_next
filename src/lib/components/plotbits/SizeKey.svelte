<script module>
	// @ts-nocheck
	// The size key of Size by (colour-by plan 2026-10-20, section 3.7; phase 3): a few
	// reference circles, each at the radius the scale draws its value at, labelled with the
	// value, under a title saying what the size means. A "no value" entry at the series' own
	// point size shows when a drawn point had no size value.
	//
	// Like the colour bar (ColourScale.svelte) it EXTENDS LegendClass, so `show`, the position
	// presets, custom fractions, font size, padding and the backdrop are the series legend's
	// vocabulary; 'right' (beside the plot) is the extra preset and the default. Placement is
	// the host's (colourBySeries.svelte.js EncodingKeyLayout): it stacks after the legend and
	// the colour bar wherever they share a place, so the three never overlap.
	import { LegendClass } from './Legend.svelte';

	/** The positions a size key can take (ColourScale's presets). */
	export const SIZE_KEY_POSITIONS = [
		'right',
		'topright',
		'topleft',
		'bottomright',
		'bottomleft',
		'custom'
	];

	/** Gap between a circle's column and its label, px. */
	export const SIZE_KEY_LABEL_GAP = 6;
	/** Gap under the title, and between its lines, px. */
	const TITLE_GAP = 4;
	const TITLE_LINE_GAP = 2;
	/** A title wraps at the rows' width, but never narrower than this many characters. */
	const TITLE_MIN_CHARS = 14;

	/** A label's width, estimated from its length (as colourScaleGeometry does). */
	function textW(s, fontSize) {
		return String(s ?? '').length * fontSize * 0.6;
	}

	/**
	 * A title broken into lines of at most `maxChars` characters at spaces (greedy), so a long
	 * column name ("Binned: relative humidity (%)") does not make the key, and the room it
	 * takes beside the plot, as wide as the name. A word longer than a line keeps its own line.
	 * @param {string} title
	 * @param {number} maxChars
	 * @returns {string[]}
	 */
	export function wrapKeyTitle(title, maxChars) {
		const words = String(title ?? '')
			.split(' ')
			.filter((w) => w !== '');
		const lines = [];
		let line = '';
		for (const w of words) {
			if (line && line.length + 1 + w.length > maxChars) {
				lines.push(line);
				line = w;
			} else {
				line = line ? `${line} ${w}` : w;
			}
		}
		if (line) lines.push(line);
		return lines;
	}

	/**
	 * The size key's geometry, shared by the component (which draws it) and the host (which
	 * reserves room for it and places it), so the two cannot disagree. Pure. The title sits on
	 * top, wrapped to the rows' width (TITLE_MIN_CHARS at least); rows run top to bottom low
	 * value first, then "no value"; each row is as tall as its circle or the text, whichever is
	 * taller, and the circles share one centre line, as wide as the largest.
	 *
	 * @param {object} o
	 * @param {{r: number, label: string}[]} o.items the reference circles, low first
	 * @param {{r: number, label: string}|null} [o.noValue]
	 * @param {string|null} [o.title]
	 * @param {number} o.fontSize
	 * @param {number} [o.itemSpacing] the gap between rows, px
	 * @returns {{width: number, height: number, colW: number, titleH: number,
	 *   titleLines: {text: string, y: number}[],
	 *   rows: {r: number, label: string, cy: number, noValue: boolean}[]}}
	 */
	export function sizeKeyGeometry({
		items,
		noValue = null,
		title = null,
		fontSize,
		itemSpacing = 4
	}) {
		const all = [
			...(items ?? []).map((it) => ({ r: it.r, label: it.label, noValue: false })),
			...(noValue ? [{ r: noValue.r, label: noValue.label ?? 'no value', noValue: true }] : [])
		];
		const colW = 2 * Math.max(0, ...all.map((it) => it.r));
		const labelW = Math.max(0, ...all.map((it) => textW(it.label, fontSize)));
		const rowsW = all.length ? colW + SIZE_KEY_LABEL_GAP + labelW : 0;
		const maxChars = Math.max(TITLE_MIN_CHARS, Math.floor(rowsW / (fontSize * 0.6)));
		const lines = title ? wrapKeyTitle(title, maxChars) : [];
		const titleLines = lines.map((text, k) => ({ text, y: k * (fontSize + TITLE_LINE_GAP) }));
		const titleH = lines.length
			? lines.length * fontSize + (lines.length - 1) * TITLE_LINE_GAP + TITLE_GAP
			: 0;
		let y = titleH;
		const rows = all.map((it, i) => {
			const h = Math.max(2 * it.r, fontSize);
			const row = { ...it, cy: y + h / 2 };
			y += h + (i < all.length - 1 ? itemSpacing : 0);
			return row;
		});
		const width = Math.max(rowsW, ...lines.map((l) => textW(l, fontSize)));
		return { width, height: y, colW, titleH, titleLines, rows };
	}

	/** The persisted size key: LegendClass's settings, 'right' (beside the plot) by default. */
	export class SizeScaleClass extends LegendClass {
		constructor(dataIN) {
			super(dataIN);
			// Set unconditionally (the base class only reads a saved legend), so a bare
			// `new SizeScaleClass()` gets the default too.
			this.position = SIZE_KEY_POSITIONS.includes(dataIN?.position) ? dataIN.position : 'right';
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
	import { cornerFraction } from './Legend.svelte';
	import { getPointPath } from './pointShapes.js';
	import { COLOUR_BY_SWATCH } from './encodingHost.js';

	let {
		scaleData,
		// [{ r, label }], low first (encodingHost.sizeKeyItems).
		items = [],
		// { r, label } or null.
		noValue = null,
		title = null,
		shape = 'circle',
		// sizeKeyGeometry's result, as the host placed it (null: computed here).
		geometry = null,
		// The plot area's width (a key placed by no host goes beside it); the host also passes
		// plotHeight and figureStyle with the rest of its frame.
		plotWidth = 0,
		padding = { top: 0, right: 0, bottom: 0, left: 0 },
		// { x, y } relative to the plot area, from the host (EncodingKeyLayout.sizePlacement).
		placement = null,
		// Draw the backdrop box: null decides by position (over the data: yes; beside: no).
		backdrop = null,
		positions = null,
		figureStyle = null,
		which = 'plot'
	} = $props();

	const POSITIONS = {
		right: 'Beside plot',
		topright: 'Top right',
		topleft: 'Top left',
		bottomright: 'Bottom right',
		bottomleft: 'Bottom left',
		custom: 'Custom'
	};
	const positionKeys = $derived(positions ?? SIZE_KEY_POSITIONS);

	const resolved = $derived(resolveStyle(figureStyle));
	const fontSize = $derived(scaleData?.fontSize ?? resolved.sizes.legend);
	const showBox = $derived(resolved.legendBox !== false);
	const geom = $derived(
		geometry ??
			sizeKeyGeometry({
				items,
				noValue,
				title,
				fontSize,
				itemSpacing: scaleData?.itemSpacing ?? 4
			})
	);
	const pos = $derived(placement ?? { x: plotWidth - geom.width, y: 0 });
	const overData = $derived(backdrop ?? scaleData?.position !== 'right');
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
	// A mirror of the nullable font size (see ColourScale.svelte): only a real edit writes it.
	let sizeInput = $derived(Math.round(fontSize * 10) / 10);
</script>

{#snippet keyPlot()}
	{#if scaleData?.show}
		<g
			class="size-key"
			transform="translate({pos.x + (padding?.left ?? 0)}, {pos.y + (padding?.top ?? 0)})"
		>
			{#if overData}
				<rect
					x={-pad}
					y={-pad}
					width={geom.width + pad * 2}
					height={geom.height + pad * 2}
					rx={3}
					fill={scaleData.backgroundColor}
					stroke={showBox ? scaleData.borderColor : 'none'}
					stroke-width={showBox ? scaleData.borderWidth : 0}
				/>
			{/if}
			{#each geom.titleLines as line, k (k)}
				<text
					class="size-key-title"
					x={0}
					y={line.y}
					dominant-baseline="hanging"
					font-size={fontSize}
					font-family={resolved.fontFamily}
					fill="black">{line.text}</text
				>
			{/each}
			{#each geom.rows as row, i (i)}
				<g class={row.noValue ? 'size-key-row size-key-novalue' : 'size-key-row'}>
					<path
						d={getPointPath(shape || 'circle', geom.colW / 2, row.cy, row.r)}
						fill={COLOUR_BY_SWATCH}
						stroke="none"
						data-size-key-r={row.r}
					/>
					<text
						x={geom.colW + SIZE_KEY_LABEL_GAP}
						y={row.cy}
						dominant-baseline="central"
						font-size={fontSize}
						font-family={resolved.fontFamily}
						fill="black">{row.label}</text
					>
				</g>
			{/each}
		</g>
	{/if}
{/snippet}

{#snippet keyControls()}
	<div class="control-component">
		<div class="control-component-title">
			<p>Size key</p>
			<button
				class="icon"
				title="Show the size key"
				aria-label="Show the size key"
				aria-pressed={!!scaleData.show}
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
				{#if positionKeys.length > 1}
					<div class="control-input">
						<p>Position</p>
						<AttributeSelect
							bind:value={scaleData.position}
							options={positionKeys}
							optionsDisplay={positionKeys.map((k) => POSITIONS[k])}
							onChange={(v) => onPositionChange(v)}
						/>
					</div>
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
			</div>
			{#if scaleData.position === 'custom'}
				<div class="control-input-horizontal">
					<ControlInput label="X (0-1)">
						<NumberWithUnits bind:value={scaleData.customX} min={0} max={1} step={0.01} />
					</ControlInput>
					<ControlInput label="Y (0-1)">
						<NumberWithUnits bind:value={scaleData.customY} min={0} max={1} step={0.01} />
					</ControlInput>
				</div>
			{/if}
		{/if}
	</div>
{/snippet}

{#if which === 'plot'}
	{@render keyPlot()}
{:else if which === 'controls'}
	{@render keyControls()}
{/if}
