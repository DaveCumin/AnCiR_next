<script module>
	// @ts-nocheck
	// Colour by: a series' colour encoding settings and the shared panel that edits them
	// (colour-by plan 2026-10-20, sections 3.2 and 3.3; host contract in encodingHost.js).
	//
	// The COLUMN lives on the series as `colourBy`, a Column wrapper beside x and y (a series
	// channel, core/seriesChannelRefs.js); this class holds only how it is read and drawn.
	// No `colour` field on purpose: monochrome finds a series' colour slots structurally
	// (plots/seriesAppearance.js) and would write a grey into it.
	import { ENCODING_MODES } from './encodings.js';
	import { COLORMAPS } from './colormaps.js';
	import { AUTO } from './encodingHost.js';

	const MODES = [AUTO, ...ENCODING_MODES];

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
</script>

<script>
	// @ts-nocheck
	import Column from '$lib/core/Column.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import NumberWithUnits, { numberOrNull } from '$lib/components/inputs/NumberWithUnits.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import { ENCODING_MODE_LABELS, encodingModesFor, isCyclicMode } from './encodings.js';
	import { colormapChoices, CYCLIC_COLORMAP_LABELS, COLORMAP_LABELS } from './colormaps.js';
	import { effectiveColormap } from './encodingHost.js';

	// `datum`: a series meeting the encoding host contract (encodingHost.js).
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
			</div>

			{#if datum.line?.draw}
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

			{#if !cyclic}
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
			{#if datum.points?.draw && datum.colourNoValueCount > 0}
				<p class="colour-by-note" role="status">
					{datum.colourNoValueCount}
					{datum.colourNoValueCount === 1 ? 'point has' : 'points have'} no colour value; drawn in the
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
