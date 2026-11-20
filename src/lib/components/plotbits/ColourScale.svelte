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
	import { wrapKeyTitle } from './SizeKey.svelte';
	import { measureTextWidths } from './legendLayout.js';

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

	/** A character's estimated width, in em, where text cannot be measured. */
	const CHAR_EM = 0.6;

	/**
	 * Text widths in px: MEASURED in `fontFamily` on a canvas in the browser, so a label is as
	 * wide as it is drawn ("36800" is 3.16 em in system-ui, not the 3 em a 0.6 em average
	 * gives, and the bar's turned title overlapped it by 2 px), else estimated at 0.6 em a
	 * character (no family given, or no canvas: jsdom, SSR, and the Python export's port).
	 * @param {string[]} texts
	 * @param {number} fontSize
	 * @param {string|null} [fontFamily]
	 * @returns {number[]}
	 */
	export function scaleTextWidths(texts, fontSize, fontFamily = null) {
		return (
			measureTextWidths(texts, fontSize, fontFamily) ??
			texts.map((t) => String(t ?? '').length * fontSize * CHAR_EM)
		);
	}

	/** One text's width (scaleTextWidths). */
	export function scaleTextWidth(text, fontSize, fontFamily = null) {
		return scaleTextWidths([text], fontSize, fontFamily)[0];
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
	 * Text widths are measured in `fontFamily` (scaleTextWidths), so the turned title beside a
	 * vertical bar clears its widest tick label however wide its digits are drawn. A host that
	 * reserves room for the key passes the same family the component draws in. Without a
	 * family (or a canvas) they are estimated at 0.6 em a character, as the Python export does.
	 *
	 * @param {object} o
	 * @param {boolean} o.vertical
	 * @param {number} o.thickness bar width across its own axis
	 * @param {number} o.barLen bar length along its own axis
	 * @param {number} o.fontSize
	 * @param {string[]} o.tickLabels
	 * @param {string|null} [o.label]
	 * @param {string|null} [o.noValueLabel] the "no value" entry's text, or null for none
	 * @param {string|null} [o.fontFamily] the family the key is drawn in (null: estimate)
	 */
	export function colourScaleGeometry({
		vertical,
		thickness,
		barLen,
		fontSize,
		tickLabels,
		label = null,
		noValueLabel = null,
		fontFamily = null
	}) {
		const tickTextW = Math.max(
			...scaleTextWidths(tickLabels, fontSize, fontFamily),
			fontSize * CHAR_EM
		);
		// A one- or two-character label ('r', '\u03c1') rotated onto its side reads as a stray
		// mark rather than a word, so only a real word is turned. Short ones stay upright.
		const rotateLabel = !!label && String(label).length > 2;
		const labelGap = label
			? rotateLabel
				? fontSize + 4
				: scaleTextWidth(label, fontSize, fontFamily) + 4
			: 0;
		const swatch = Math.max(6, Math.round(fontSize * 0.8));
		const noValueW = noValueLabel
			? swatch + 4 + scaleTextWidth(noValueLabel, fontSize, fontFamily)
			: 0;
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

	// ---- The CATEGORY key (Colour by, Category mode; colour-by plan v1.1) ----
	//
	// A category has no position on a ramp, so its key is a list: one swatch per category in
	// its colour, named, in the Boxplot's order, then "no value" when a mark had none. It takes
	// the colour bar's place (same class, same placement, same stacking with the legend and the
	// size key). `length` is the room for its rows: when they do not fit in one column they
	// wrap into more, filled top to bottom then left to right (reading order), each column as
	// wide as its longest name. The title sits on top, wrapped as the size key's is.

	/** Gap between two rows, and between two columns, of the category key, px. */
	export const CATEGORY_ROW_GAP = 3;
	export const CATEGORY_COLUMN_GAP = 10;
	/** Gap between a swatch and its name, px. */
	export const CATEGORY_LABEL_GAP = 4;
	const CATEGORY_TITLE_GAP = 4;
	const CATEGORY_TITLE_LINE_GAP = 2;
	const CATEGORY_TITLE_MIN_CHARS = 14;

	/**
	 * The category key's geometry, shared by the component and the host (placement, reserved
	 * room) and ported one for one by the Python export (ancir_runtime.category_key_geometry).
	 * Pure. Text widths are measured in `fontFamily` when given (scaleTextWidths), else
	 * estimated at 0.6 em a character, as the bar's are.
	 *
	 * @param {object} o
	 * @param {{label: string, colour: string}[]} o.items the categories, in key order
	 * @param {{label?: string, colour: string}|null} [o.noValue]
	 * @param {string|null} [o.title]
	 * @param {number} o.fontSize
	 * @param {number|null} [o.length] the room for the rows' height, px (null: one column)
	 * @param {string|null} [o.fontFamily] the family the key is drawn in (null: estimate)
	 * @returns {{width: number, height: number, swatch: number, rowH: number, step: number,
	 *   titleH: number, natural: number, perColumn: number, columns: number,
	 *   titleLines: {text: string, y: number}[],
	 *   rows: {label: string, colour: string, noValue: boolean, x: number, y: number}[]}}
	 */
	export function categoryKeyGeometry({
		items,
		noValue = null,
		title = null,
		fontSize,
		length = null,
		fontFamily = null
	}) {
		const entries = [
			...(items ?? []).map((it) => ({
				label: String(it.label),
				colour: it.colour,
				noValue: false
			})),
			...(noValue
				? [{ label: noValue.label ?? 'no value', colour: noValue.colour, noValue: true }]
				: [])
		];
		const swatch = Math.max(6, Math.round(fontSize * 0.8));
		const rowH = Math.max(swatch, fontSize);
		const step = rowH + CATEGORY_ROW_GAP;
		const n = Math.max(1, entries.length);
		const fit =
			length != null && Number.isFinite(length)
				? Math.max(1, Math.floor((length + CATEGORY_ROW_GAP) / step))
				: n;
		const perColumn = Math.min(n, fit);
		const columns = Math.max(1, Math.ceil(entries.length / perColumn));
		const charW = fontSize * CHAR_EM;
		const colWs = [];
		for (let c = 0; c < columns; c++) {
			const names = scaleTextWidths(
				entries.slice(c * perColumn, (c + 1) * perColumn).map((e) => e.label),
				fontSize,
				fontFamily
			);
			colWs.push(swatch + CATEGORY_LABEL_GAP + Math.max(0, ...names));
		}
		const entriesW = colWs.reduce((a, w) => a + w, 0) + (columns - 1) * CATEGORY_COLUMN_GAP;
		const maxChars = Math.max(CATEGORY_TITLE_MIN_CHARS, Math.floor(entriesW / charW));
		const lines = title ? wrapKeyTitle(title, maxChars) : [];
		const titleLines = lines.map((text, k) => ({
			text,
			y: k * (fontSize + CATEGORY_TITLE_LINE_GAP)
		}));
		const titleH = lines.length
			? lines.length * fontSize + (lines.length - 1) * CATEGORY_TITLE_LINE_GAP + CATEGORY_TITLE_GAP
			: 0;
		const rows = [];
		let x = 0;
		for (let c = 0; c < columns; c++) {
			entries.slice(c * perColumn, (c + 1) * perColumn).forEach((e, r) => {
				rows.push({ ...e, x, y: titleH + r * step });
			});
			x += colWs[c] + CATEGORY_COLUMN_GAP;
		}
		const titleW = Math.max(0, ...scaleTextWidths(lines, fontSize, fontFamily));
		return {
			width: Math.max(entriesW, titleW),
			height: titleH + perColumn * step - CATEGORY_ROW_GAP,
			swatch,
			rowH,
			step,
			titleH,
			// The rows' height in ONE column, and the least room a row needs.
			natural: n * step - CATEGORY_ROW_GAP,
			perColumn,
			columns,
			titleLines,
			rows
		};
	}

	/** Space kept between two neighbouring tick labels along the bar, px. */
	export const TICK_LABEL_SPACE = 2;
	/**
	 * Where a tick's label runs along the bar: [from, to] in px from the bar's LOW end. A label
	 * at an end sits inside the bar's length (flush with that end); any other is centred on its
	 * tick. Along a vertical bar a label takes one em; along a horizontal one its width
	 * (scaleTextWidth: measured in `fontFamily`, else estimated).
	 * @param {number} t the tick's place along the bar, 0 (low) to 1 (high)
	 * @param {string} label
	 * @param {{vertical: boolean, barLen: number, fontSize: number, fontFamily?: string|null}} o
	 * @returns {[number, number]}
	 */
	export function tickLabelSpan(t, label, { vertical, barLen, fontSize, fontFamily = null }) {
		const at = t * barLen;
		const ext = vertical ? fontSize : scaleTextWidth(label ?? '', fontSize, fontFamily);
		if (t <= 0) return [at, at + ext];
		if (t >= 1) return [at - ext, at];
		return [at - ext / 2, at + ext / 2];
	}

	/** Whether no two neighbouring labels of `ticks` (ascending t) come within TICK_LABEL_SPACE. */
	function ticksFit(ticks, o) {
		for (let i = 1; i < ticks.length; i++) {
			const a = tickLabelSpan(ticks[i - 1].t, ticks[i - 1].label, o);
			const b = tickLabelSpan(ticks[i].t, ticks[i].label, o);
			if (b[0] - a[1] < TICK_LABEL_SPACE) return false;
		}
		return true;
	}

	/**
	 * The ticks a bar of this length can label without two labels crowding: all of them when
	 * they fit, else every second one (both ends kept, so hour of day reads 0, 12, 24), every
	 * fourth, ..., and at last the two ends alone. The ends are what a reader needs most (the
	 * range), so they always stay: on a bar too short even for them (only a stored length
	 * under minBarLength can be) they are drawn anyway.
	 * @param {{t: number, label: string}[]} ticks low end first
	 * @param {{vertical: boolean, barLen: number, fontSize: number, fontFamily?: string|null}} o
	 */
	export function fitBarTicks(ticks, o) {
		const n = ticks?.length ?? 0;
		if (n <= 2 || ticksFit(ticks, o)) return ticks;
		for (let stride = 2; stride < n - 1; stride *= 2) {
			if ((n - 1) % stride !== 0) continue;
			const kept = ticks.filter((_, i) => i % stride === 0);
			if (ticksFit(kept, o)) return kept;
		}
		return [ticks[0], ticks[n - 1]];
	}

	/**
	 * A title as it fits along `room` px: whole when it does, else shortened to whole
	 * characters and an ellipsis (the component keeps the whole title as the text's tooltip),
	 * and empty when not even one character and the ellipsis fit.
	 * @param {string|null} title
	 * @param {number} room px
	 * @param {number} fontSize
	 * @param {string|null} [fontFamily] the family it is drawn in (null: estimate widths)
	 */
	export function fitScaleTitle(title, room, fontSize, fontFamily = null) {
		const s = String(title ?? '');
		if (scaleTextWidth(s, fontSize, fontFamily) <= room) return s;
		// Every shortening at once (one measuring pass), then the longest that fits.
		const cuts = Array.from({ length: s.length - 1 }, (_, i) => s.slice(0, i + 1) + '\u2026');
		const widths = scaleTextWidths(cuts, fontSize, fontFamily);
		for (let keep = cuts.length; keep >= 1; keep--) {
			if (widths[keep - 1] <= room) return s.slice(0, keep).trimEnd() + '\u2026';
		}
		return '';
	}

	/**
	 * The shortest an automatic bar is made (when a legend or the size key shares its place):
	 * room for both end labels (one em each and TICK_LABEL_SPACE between), and never under
	 * 30 px. Below it the size key goes beside the bar instead of under it
	 * (EncodingKeyLayout.sizeBeside).
	 * @param {number} fontSize
	 */
	export function minBarLength(fontSize) {
		return Math.max(30, 2 * fontSize + TICK_LABEL_SPACE);
	}

	/**
	 * How far a title runs ALONG the bar, px: a vertical bar's turned title (longer than two
	 * characters, colourScaleGeometry.rotateLabel) and a horizontal bar's title under it; 0 for
	 * an upright one- or two-character title beside a vertical bar, which runs across it.
	 * @param {string|null} label
	 * @param {number} fontSize
	 * @param {boolean} vertical
	 * @param {string|null} [fontFamily] the family it is drawn in (null: estimate)
	 */
	export function titleRunLength(label, fontSize, vertical, fontFamily = null) {
		if (!label) return 0;
		const s = String(label);
		if (vertical && s.length <= 2) return 0;
		return scaleTextWidth(s, fontSize, fontFamily);
	}

	/**
	 * The bar's automatic length: the plot's extent, between 30 and 150 px, or longer than 150
	 * (still within the extent) when its title runs further, so a title fits whole wherever
	 * the plot is long enough for it.
	 * @param {number} extent
	 * @param {number} [titleLen] titleRunLength
	 */
	export function autoBarLength(extent, titleLen = 0) {
		return Math.max(30, Math.min(extent, Math.max(150, titleLen)));
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
		// The position presets the panel offers (a subset of POSITIONS' keys), or null for all.
		// A host with no room inside its plot area for a key (the Circular phase clock) offers
		// "Beside plot" only.
		positions = null,
		// Draw the backdrop box: null decides by position (over the data: yes; beside: no). A
		// host that always places the key outside its marks passes false.
		backdrop = null,
		// Category mode (Colour by, v1.1): `[{ label, colour }]` in key order. The key is then a
		// list of named swatches (categoryKeyGeometry), `length` the room for its rows, and the
		// bar's own settings (layout, bar width and length) do not apply. null draws the bar.
		categories = null,
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
	const positionKeys = $derived(positions ?? Object.keys(POSITIONS));

	const resolved = $derived(resolveStyle(figureStyle));
	const fontSize = $derived(scaleData?.fontSize ?? resolved.sizes.legend);
	const showBox = $derived(resolved.legendBox !== false);

	const boxW = $derived(contentWidth ?? plotWidth);
	const boxH = $derived(contentHeight ?? plotHeight);

	const vertical = $derived(scaleData?.orientation !== 'horizontal');
	const thickness = $derived(scaleData?.barThickness ?? 10);
	const barLen = $derived(
		length ??
			scaleData?.barLength ??
			autoBarLength(
				vertical ? boxH : boxW,
				titleRunLength(label, fontSize, vertical, resolved.fontFamily)
			)
	);

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
			noValueLabel: noValue ? (noValue.label ?? 'no value') : null,
			fontFamily: resolved.fontFamily
		})
	);
	const tickTextW = $derived(geom.tickTextW);
	const rotateLabel = $derived(geom.rotateLabel);
	// What a bar of this length can show: its labels thinned so none crowd (fitBarTicks), and a
	// title that runs along the bar (turned beside a vertical bar, under a horizontal one)
	// shortened to the bar's length, the whole title kept as its tooltip. The geometry above is
	// the full set's, so the room a host reserved does not change with the bar's length.
	const shownTicks = $derived(
		fitBarTicks(tickItems, { vertical, barLen, fontSize, fontFamily: resolved.fontFamily })
	);
	const shownLabel = $derived(
		label && (rotateLabel || !vertical)
			? fitScaleTitle(label, barLen, fontSize, resolved.fontFamily)
			: label
	);
	const labelShortened = $derived(!!label && shownLabel !== label);

	const catGeom = $derived(
		categories
			? categoryKeyGeometry({
					items: categories,
					noValue,
					title: label,
					fontSize,
					length: length ?? null,
					fontFamily: resolved.fontFamily
				})
			: null
	);

	/** The whole key's footprint, used for placement and for the backdrop. */
	const dims = $derived(
		catGeom
			? { width: catGeom.width, height: catGeom.height }
			: { width: geom.width, height: geom.height }
	);

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
	const overData = $derived(backdrop ?? scaleData?.position !== 'right');
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

			{#if catGeom}
				<!-- Category: one named swatch per category, then "no value" (in the series colour). -->
				{#each catGeom.titleLines as line, i (i)}
					<text
						class="colour-scale-label"
						x={0}
						y={line.y}
						dominant-baseline="hanging"
						font-size={fontSize}
						font-family={resolved.fontFamily}
						fill="black">{line.text}</text
					>
				{/each}
				{#each catGeom.rows as row, i (i)}
					<g
						class={row.noValue ? 'colour-scale-novalue' : 'colour-scale-category'}
						transform="translate({row.x}, {row.y})"
					>
						<rect
							x={0}
							y={(catGeom.rowH - catGeom.swatch) / 2}
							width={catGeom.swatch}
							height={catGeom.swatch}
							fill={row.colour}
							stroke="none"
						/>
						<text
							x={catGeom.swatch + CATEGORY_LABEL_GAP}
							y={catGeom.rowH / 2}
							dominant-baseline="central"
							font-size={fontSize}
							font-family={resolved.fontFamily}
							fill="black">{row.label}</text
						>
					</g>
				{/each}
			{:else if vertical}
				<rect x={0} y={0} width={thickness} height={barLen} fill={'url(#' + gradId + ')'} />
				<!-- Top to bottom, so the DOM order matches the reading order: a vertical
				     bar runs high at the top. -->
				{#each shownTicks.slice().reverse() as tick, i (i)}
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
						fill="black"
						>{shownLabel}{#if labelShortened}<title>{label}</title>{/if}</text
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
				{#each shownTicks as tick, i (i)}
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
						fill="black"
						>{shownLabel}{#if labelShortened}<title>{label}</title>{/if}</text
					>
				{/if}
			{/if}
			{#if noValue && !catGeom}
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
			<p>{categories ? 'Colour key' : 'Colour scale'}</p>
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
				{#if positionKeys.length > 1}
					<ControlInput label="Position">
						<AttributeSelect
							bind:value={scaleData.position}
							options={positionKeys}
							optionsDisplay={positionKeys.map((k) => POSITIONS[k])}
							onChange={(v) => onPositionChange(v)}
						/>
					</ControlInput>
				{/if}
				{#if !categories}
					<ControlInput label="Layout">
						<AttributeSelect
							bind:value={scaleData.orientation}
							options={['vertical', 'horizontal']}
							optionsDisplay={['Vertical', 'Horizontal']}
						/>
					</ControlInput>
				{/if}
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
				{#if !categories}
					<ControlInput label="Bar width">
						<NumberWithUnits bind:value={scaleData.barThickness} min={2} max={40} />
					</ControlInput>
				{/if}
			</div>
		{/if}
	</div>
{/snippet}

{#if which === 'plot'}
	{@render scalePlot()}
{:else if which === 'controls'}
	{@render scaleControls()}
{/if}
