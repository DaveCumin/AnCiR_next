<script>
	// Controls for one figure style object.
	//
	// Used in TWO places with the same markup, which is the point of factoring it out:
	//   - the Settings modal, bound to core.figureStyle (the session TEMPLATE), where
	//     it also offers "Apply to all plots";
	//   - the plot control panel, bound to that plot's own style.
	//
	// The template/per-plot distinction lives entirely in the caller. This component
	// only ever edits the object it is handed, so there is no way for it to write to
	// the wrong one.
	//
	// Fields come from plots/figureStyle.js. Two registry fields are deliberately not
	// exposed here: `palette`, because the app already has one palette control in
	// Settings and a second one per figure would be a confusing duplicate; and
	// `roleScale`, which is the advanced per-role escape hatch and has no sensible
	// generic UI.
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import ColourPicker from '$lib/components/inputs/ColourPicker.svelte';
	import { resolveStyle, WIDTH_PRESET_MM, BASE_PT } from '$lib/plots/figureStyle.js';

	let {
		style,
		/** Show the "Apply to all plots" button (Settings only). */
		showApplyToAll = false,
		/** Called when that button is pressed. */
		onApplyToAll = null,
		title = 'Figure'
	} = $props();

	const resolved = $derived(resolveStyle(style));

	// Background is three named choices rather than a bare colour picker, because
	// "transparent" is right for the screen and wrong for submission: many journals
	// reject transparency in raster figures. Making white one click makes that easy to
	// get right.
	const bgMode = $derived(
		style.backgroundColour === 'transparent'
			? 'transparent'
			: String(style.backgroundColour).toLowerCase() === '#ffffff'
				? 'white'
				: 'custom'
	);

	function setBackground(mode) {
		if (mode === 'transparent') style.backgroundColour = 'transparent';
		else if (mode === 'white') style.backgroundColour = '#ffffff';
		else if (style.backgroundColour === 'transparent') style.backgroundColour = '#ffffff';
	}

	let applied = $state(0);
	function apply() {
		applied = onApplyToAll ? (onApplyToAll() ?? 0) : 0;
	}

	/** One decimal, so the pt -> px relationship is readable without being noisy. */
	const round1 = (n) => Math.round(n * 10) / 10;
</script>

<div class="control-component">
	<div class="control-component-title">
		<p>{title}</p>
	</div>

	<div class="control-input-horizontal">
		<div class="control-input">
			<p>Typeface</p>
			<AttributeSelect
				bind:value={style.fontFamily}
				options={['sans', 'serif']}
				optionsDisplay={['Sans serif', 'Serif']}
			/>
		</div>
		<div class="control-input">
			<p>Type size</p>
			<AttributeSelect
				bind:value={style.fontSize}
				options={['s', 'm', 'l', 'custom']}
				optionsDisplay={[
					`Small (${BASE_PT.s} pt)`,
					`Medium (${BASE_PT.m} pt)`,
					`Large (${BASE_PT.l} pt)`,
					'Custom'
				]}
			/>
		</div>
	</div>

	{#if style.fontSize === 'custom'}
		<div class="control-input-horizontal">
			<ControlInput label="Size (pt)">
				<NumberWithUnits bind:value={style.fontSizePt} min={1} max={72} step={0.5} />
			</ControlInput>
		</div>
	{/if}

	<div class="control-input-horizontal">
		<div class="control-input">
			<p>Figure width</p>
			<AttributeSelect
				bind:value={style.widthPreset}
				options={['single', 'double', 'custom']}
				optionsDisplay={[
					`Single column (${WIDTH_PRESET_MM.single} mm)`,
					`Double column (${WIDTH_PRESET_MM.double} mm)`,
					'Custom'
				]}
			/>
		</div>
		{#if style.widthPreset === 'custom'}
			<ControlInput label="Width (mm)">
				<NumberWithUnits bind:value={style.widthMm} min={1} max={500} step={1} />
			</ControlInput>
		{/if}
	</div>

	<div class="control-input-horizontal">
		<div class="control-input">
			<p>Background</p>
			<AttributeSelect
				value={bgMode}
				options={['transparent', 'white', 'custom']}
				optionsDisplay={['Transparent', 'White', 'Custom']}
				onChange={(m) => setBackground(m)}
			/>
		</div>
		{#if bgMode === 'custom'}
			<div class="control-input" style="max-width: 1.5rem;">
				<p>Colour</p>
				<ColourPicker bind:value={style.backgroundColour} />
			</div>
		{/if}
	</div>

	<div class="control-input-horizontal">
		<ControlInput label="Export DPI">
			<NumberWithUnits bind:value={style.exportDpi} min={72} max={1200} step={1} />
		</ControlInput>
	</div>

	<div class="control-input-vertical">
		<div class="control-input-checkbox">
			<input type="checkbox" bind:checked={style.legendBox} />
			<p>Box around legend</p>
		</div>
		<div class="control-input-checkbox">
			<input type="checkbox" bind:checked={style.varyMarkers} />
			<p>Vary marker shape per series</p>
		</div>
		<div class="control-input-checkbox">
			<input type="checkbox" bind:checked={style.monochrome} />
			<p>Monochrome (print-safe)</p>
		</div>
	</div>

	{#if style.monochrome && !style.varyMarkers}
		<!-- Not a forced coupling: a single-series figure in monochrome is perfectly
		     legitimate. But with more than a couple of greys the series become
		     indistinguishable, so it is worth saying so where the choice is made. -->
		<div class="style-note">
			<p>
				⚠ Monochrome with a single marker shape makes several series hard to tell apart.
				Consider turning on varying marker shapes.
			</p>
		</div>
	{/if}

	<!-- What the choices above actually resolve to. Points only mean something at a
	     declared physical width, so showing both makes that relationship visible
	     instead of leaving the user to guess why 8.5 pt is not 8.5 px. -->
	<div class="style-readout">
		<p>
			{round1(resolved.widthMm)} mm wide ({Math.round(resolved.widthPx)} px) ·
			{round1(resolved.basePt)} pt base · axis {round1(resolved.sizes.axisLabel)} px, ticks
			{round1(resolved.sizes.tick)} px, legend {round1(resolved.sizes.legend)} px
		</p>
	</div>

	{#if showApplyToAll}
		<div class="control-input-vertical">
			<button class="apply-btn" onclick={apply}>Apply to all plots</button>
			<p class="apply-hint">
				These are the defaults for NEW plots. Existing plots keep their own settings until
				you apply.
				{#if applied > 0}
					<strong>Applied to {applied} plot{applied === 1 ? '' : 's'}.</strong>
				{/if}
			</p>
		</div>
	{/if}
</div>

<style>
	.style-readout p,
	.apply-hint {
		margin: var(--space-2) 0 0;
		font-size: var(--font-2xs);
		color: var(--color-text-muted);
		line-height: 1.4;
	}
	.style-note p {
		margin: var(--space-2) 0 0;
		font-size: var(--font-2xs);
		color: var(--color-warning-text);
		background: var(--color-warning-bg);
		border-radius: var(--radius-sm);
		padding: var(--space-2);
		line-height: 1.4;
	}
	.apply-btn {
		font: inherit;
		font-size: var(--font-xs);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-lightness-85);
		border-radius: var(--radius-sm);
		background: var(--color-lightness-99);
		color: var(--color-lightness-25);
		cursor: pointer;
	}
	.apply-btn:hover {
		border-color: var(--color-accent);
		background: var(--color-hover);
	}
</style>
