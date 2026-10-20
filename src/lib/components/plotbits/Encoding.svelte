<script module>
	// @ts-nocheck
	// Colour by: a series' colour encoding settings and the shared panel that edits them
	// (colour-by plan 2026-10-20, sections 3.2 and 3.3; host contract in encodingHost.js).
	//
	// The COLUMN lives on the series as `colourBy`, a Column wrapper beside x and y (a series
	// channel, core/seriesChannelRefs.js); this class holds only how it is read and drawn.
	// No `colour` field on purpose: monochrome finds a series' colour slots structurally
	// (plots/seriesAppearance.js) and would write a grey into it.
	import {
		ENCODING_MODES,
		SIZE_ENCODING_MODES,
		isCyclicMode,
		isCategoryMode,
		DEFAULT_MIN_RADIUS,
		DEFAULT_MAX_RADIUS,
		MIN_RADIUS_FLOOR
	} from './encodings.js';
	import { COLORMAPS } from './colormaps.js';
	import { AUTO } from './encodingHost.js';

	const MODES = [AUTO, ...ENCODING_MODES];
	// Size has no Hour of day and no Category (plan 3.7: neither has a "bigger").
	const SIZE_MODES = [AUTO, ...SIZE_ENCODING_MODES];

	/** A finite number, else null (an automatic end). Number(null) is 0, hence the guard. */
	function numberOrNullIn(v) {
		if (v == null || v === '') return null;
		const n = Number(v);
		return Number.isFinite(n) ? n : null;
	}

	export class ColourEncodingClass {
		// The multi-select panel and the AI editor read these (plots/sharedControls.js).
		static descriptors = {
			id: { skip: true },
			mode: { input: 'select', options: MODES, label: 'read as', group: 'Colour by' },
			colormap: {
				input: 'select',
				options: [AUTO, ...Object.keys(COLORMAPS)],
				label: 'colours',
				group: 'Colour by'
			},
			domainMin: { input: 'number', label: 'range min', group: 'Colour by' },
			domainMax: { input: 'number', label: 'range max', group: 'Colour by' },
			colourLine: { input: 'boolean', label: 'colour the line too', group: 'Colour by' }
		};

		/** Stable per plot: names the canvas port `enc<id>_colour`. */
		id = $state(1);
		/** 'auto' (hour of day for a time column, else the value) or one of ENCODING_MODES. */
		mode = $state(AUTO);
		/** 'auto' (the mode's default map) or a COLORMAPS key. */
		colormap = $state(AUTO);
		/** Manual range ends; null keeps that end at the data's (decision 8). */
		domainMin = $state(null);
		domainMax = $state(null);
		/**
		 * Colour the series' LINE by the same column too (plan 3.6, phase 1c). Off by default
		 * (decision 5: the line keeps the series colour). Each segment takes its starting row's
		 * colour and is drawn solid (components/plotbits/colouredLine.js).
		 */
		colourLine = $state(false);

		constructor(json = {}) {
			this.id = Number.isInteger(json?.id) && json.id > 0 ? json.id : 1;
			this.mode = MODES.includes(json?.mode) ? json.mode : AUTO;
			this.colormap = json?.colormap === AUTO || COLORMAPS[json?.colormap] ? json.colormap : AUTO;
			this.domainMin = numberOrNullIn(json?.domainMin);
			this.domainMax = numberOrNullIn(json?.domainMax);
			this.colourLine = json?.colourLine === true;
		}

		/** The manual range as encodings.encodingDomain takes it. */
		get domainIN() {
			return [this.domainMin, this.domainMax];
		}

		toJSON() {
			return {
				id: this.id,
				mode: this.mode,
				colormap: this.colormap,
				domainMin: this.domainMin,
				domainMax: this.domainMax,
				colourLine: this.colourLine
			};
		}

		static fromJSON(json) {
			return new ColourEncodingClass(json ?? {});
		}
	}

	/** A radius, px: a finite number, at least MIN_RADIUS_FLOOR, else the default. */
	function radiusIn(v, fallback) {
		if (v == null || v === '') return fallback;
		const n = Number(v);
		return Number.isFinite(n) ? Math.max(MIN_RADIUS_FLOOR, n) : fallback;
	}

	/**
	 * Size by (plan 3.7, phase 3): how a series' size column is read and drawn. The column is
	 * the series' `sizeBy` wrapper (a series channel), as `colourBy` is for colour. Points only:
	 * each point's radius comes from its value, area-proportional between `minRadius` and
	 * `maxRadius` (encodings.sizeRadius); a point with no size value keeps the series' own
	 * point size.
	 */
	export class SizeEncodingClass {
		// The multi-select panel and the AI editor read these (plots/sharedControls.js).
		static descriptors = {
			id: { skip: true },
			mode: { input: 'select', options: SIZE_MODES, label: 'read as', group: 'Size by' },
			minRadius: { input: 'number', label: 'smallest point', group: 'Size by', step: 0.5 },
			maxRadius: { input: 'number', label: 'largest point', group: 'Size by', step: 0.5 },
			domainMin: { input: 'number', label: 'range min', group: 'Size by' },
			domainMax: { input: 'number', label: 'range max', group: 'Size by' }
		};

		/** Stable per plot: names the canvas port `enc<id>_size`. */
		id = $state(1);
		/** 'auto' (days since start for a time column, else the value) or a size mode. */
		mode = $state(AUTO);
		/** The radius (px) of the range's low and high ends; the area is linear between. */
		minRadius = $state(DEFAULT_MIN_RADIUS);
		maxRadius = $state(DEFAULT_MAX_RADIUS);
		/** Manual range ends; null keeps that end at the data's (decision 8). */
		domainMin = $state(null);
		domainMax = $state(null);

		constructor(json = {}) {
			this.id = Number.isInteger(json?.id) && json.id > 0 ? json.id : 1;
			this.mode = SIZE_MODES.includes(json?.mode) ? json.mode : AUTO;
			this.minRadius = radiusIn(json?.minRadius, DEFAULT_MIN_RADIUS);
			this.maxRadius = radiusIn(json?.maxRadius, DEFAULT_MAX_RADIUS);
			this.domainMin = numberOrNullIn(json?.domainMin);
			this.domainMax = numberOrNullIn(json?.domainMax);
		}

		/** The manual range as encodings.encodingDomain takes it. */
		get domainIN() {
			return [this.domainMin, this.domainMax];
		}

		toJSON() {
			return {
				id: this.id,
				mode: this.mode,
				minRadius: this.minRadius,
				maxRadius: this.maxRadius,
				domainMin: this.domainMin,
				domainMax: this.domainMax
			};
		}

		static fromJSON(json) {
			return new SizeEncodingClass(json ?? {});
		}
	}
</script>

<script>
	// @ts-nocheck
	import Column from '$lib/core/Column.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import NumberWithUnits, { numberOrNull } from '$lib/components/inputs/NumberWithUnits.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import { ENCODING_MODE_LABELS, encodingModesFor } from './encodings.js';
	import { colormapChoices, CYCLIC_COLORMAP_LABELS, COLORMAP_LABELS } from './colormaps.js';
	import { effectiveColormap } from './encodingHost.js';
	import SizeBy from './SizeBy.svelte';

	// `datum`: a series meeting the encoding host contract (encodingHost.js), built on
	// EncodedSeries (colourBySeries.svelte.js), whose hooks say what a mark is. The panel shows
	// Colour by, then Size by (SizeBy.svelte) when the series' plot can size points.
	// The two selects show 'auto' while the stored choice does not apply to this column (a map
	// for the other kind of scale, a mode the column cannot be read as): that is what draws.
	let { datum } = $props();

	const on = $derived(!!datum?.colourEncoding && !!datum?.colourBy);
	const enc = $derived(datum?.colourEncoding);
	const wired = $derived(
		on && typeof datum.colourBy.refId === 'number' && datum.colourBy.refId >= 0
	);
	const mode = $derived(datum?.colourMode);

	// The modes this column can be read as, "Automatic" first (naming what it picks).
	const modeOptions = $derived.by(() => {
		const offered = encodingModesFor(datum?.colourBy ?? {}).map((m) => m.mode);
		return ['auto', ...offered];
	});
	const modeLabels = $derived(
		modeOptions.map((m) =>
			m === 'auto'
				? `Automatic: ${ENCODING_MODE_LABELS[datum?.colourMode] ?? 'Value'}`
				: ENCODING_MODE_LABELS[m]
		)
	);
	const cyclic = $derived(isCyclicMode(mode));
	const categorical = $derived(isCategoryMode(mode));
	const mapOptions = $derived(['auto', ...Object.keys(colormapChoices({ cyclic }))]);
	const mapLabels = $derived(
		mapOptions.map((k) =>
			k === 'auto'
				? `Automatic: ${(cyclic ? CYCLIC_COLORMAP_LABELS : COLORMAP_LABELS)[effectiveColormap('auto', mode ?? 'value')] ?? ''}`
				: (CYCLIC_COLORMAP_LABELS[k] ?? COLORMAP_LABELS[k] ?? k)
		)
	);
	const auto = $derived(datum?.colourAutoDomain);
</script>

<div class="control-component colour-by">
	<div class="control-component-title">
		<p>Colour by</p>
		<input
			type="checkbox"
			class="colour-by-switch"
			aria-label="Colour points by a column"
			title="Colour points by a column"
			checked={on}
			onchange={(e) => (e.currentTarget.checked ? datum.enableColourBy() : datum.disableColourBy())}
		/>
	</div>

	{#if on}
		<div class="colour-by-column">
			<ControlInput label="Column"></ControlInput>
			<Column col={datum.colourBy} canChange={true} />
		</div>

		{#if wired}
			<div class="control-input-vertical">
				<div class="control-input">
					<p>Read as</p>
					<AttributeSelect
						bind:value={
							() => (modeOptions.includes(enc.mode) ? enc.mode : 'auto'), (v) => (enc.mode = v)
						}
						options={modeOptions}
						optionsDisplay={modeLabels}
					/>
				</div>
				{#if !categorical}
					<div class="control-input">
						<p>Colours</p>
						<AttributeSelect
							bind:value={
								() => (mapOptions.includes(enc.colormap) ? enc.colormap : 'auto'),
								(v) => (enc.colormap = v)
							}
							options={mapOptions}
							optionsDisplay={mapLabels}
						/>
					</div>
				{/if}
			</div>

			{#if datum.colourLineCapable}
				<!-- Plan 3.6 (phase 1c): the line keeps the series colour unless this is on. -->
				<label class="control-input-checkbox colour-line-row">
					<input
						type="checkbox"
						aria-label="Colour the line by the same column"
						bind:checked={enc.colourLine}
					/>
					<span class="ci-label">Colour the line too</span>
				</label>
				{#if enc.colourLine && datum.line.stroke !== 'solid'}
					<p class="colour-by-note">
						The line is drawn solid while coloured; its dash returns when this is off.
					</p>
				{/if}
			{/if}

			{#if datum.colourRefusal}
				<p class="colour-by-note colour-by-warning" role="status">{datum.colourRefusal}</p>
			{:else if categorical}
				<p class="colour-by-note">
					Each category takes its session colour, the same as in box plots; change them under
					Category colours.
				</p>
			{:else if !cyclic}
				<div class="control-input-horizontal">
					<ControlInput label="Min">
						<NumberWithUnits
							nullable
							step="0.1"
							value={enc.domainMin ?? auto?.lo}
							onInput={(v) => (enc.domainMin = numberOrNull(v))}
						/>
					</ControlInput>
					<ControlInput label="Max">
						<NumberWithUnits
							nullable
							step="0.1"
							value={enc.domainMax ?? auto?.hi}
							onInput={(v) => (enc.domainMax = numberOrNull(v))}
						/>
					</ControlInput>
					{#if enc.domainMin != null || enc.domainMax != null}
						<div class="control-component-input-icons">
							<button
								class="icon"
								title="Back to the full data range"
								aria-label="Reset the colour range"
								onclick={() => {
									enc.domainMin = null;
									enc.domainMax = null;
								}}
							>
								<Icon
									name="reset"
									width={14}
									height={14}
									className="control-component-input-icon"
								/>
							</button>
						</div>
					{/if}
				</div>
			{:else}
				<p class="colour-by-note">
					Hour of day spans 0 to 24 h; midnight and noon are the dark and light ends.
				</p>
			{/if}

			{#if datum.colourWarning}
				<p class="colour-by-note colour-by-warning" role="status">{datum.colourWarning}</p>
			{/if}
			{#if datum.colourLengthNote}
				<p class="colour-by-note colour-by-warning" role="status">{datum.colourLengthNote}</p>
			{/if}
			{#if datum.colourSummaryNote}
				<p class="colour-by-note">{datum.colourSummaryNote}</p>
			{/if}
			{#if datum.drawsPoints && datum.colourNoValueCount > 0}
				{@const [one, many] = datum.markWords ?? ['point', 'points']}
				<p class="colour-by-note" role="status">
					{datum.colourNoValueCount}
					{datum.colourNoValueCount === 1 ? `${one} has` : `${many} have`} no colour value; drawn in the
					series colour.
				</p>
			{/if}
			{#if datum.colourLineNoValueCount > 0}
				<p class="colour-by-note" role="status">
					{datum.colourLineNoValueCount}
					{datum.colourLineNoValueCount === 1 ? 'line segment starts' : 'line segments start'} at a row
					with no colour value; drawn in the series colour.
				</p>
			{/if}
			{#if datum.colourMonochrome}
				<p class="colour-by-note">Drawn in greys while the figure is monochrome.</p>
			{/if}
			{#if datum.colourKeyNote}
				<p class="colour-by-note">{datum.colourKeyNote}</p>
			{/if}
		{:else}
			<p class="colour-by-note">
				Pick a column, or wire one into this series’ colour port on the canvas.
			</p>
		{/if}
	{/if}
</div>

{#if datum?.sizeCapable}
	<SizeBy {datum} />
{/if}

<style>
	.colour-by-switch {
		margin: 0;
		cursor: pointer;
	}
	.colour-line-row {
		margin-top: var(--space-2);
	}
	.colour-by-column {
		margin: var(--space-1) 0;
		/* The panel's column is `align-items: flex-start`, so a child takes its content's
		   width: pinned to the panel's, a long column name ellipsises in the picker instead
		   of running past the panel's edge. */
		width: 100%;
		min-width: 0;
	}
	.colour-by-note {
		margin: var(--space-1) 0 0;
		font-size: var(--font-xs);
		line-height: 1.3;
		color: var(--color-text-muted);
	}
	.colour-by-warning {
		color: var(--color-warning-text);
		background: var(--color-warning-bg);
		border-radius: var(--radius-sm);
		padding: var(--space-2);
	}
</style>
