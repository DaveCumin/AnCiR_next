<script>
	// @ts-nocheck
	// Size by: the shared panel for a series' size encoding (colour-by plan 2026-10-20, section
	// 3.7; phase 3). Shown under Colour by (Encoding.svelte) on every host that can size points.
	// The settings are SizeEncodingClass (Encoding.svelte); the series' reactive state is
	// EncodedSeries (colourBySeries.svelte.js).
	import Column from '$lib/core/Column.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import NumberWithUnits, { numberOrNull } from '$lib/components/inputs/NumberWithUnits.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import { ENCODING_MODE_LABELS, sizeModesFor, MIN_RADIUS_FLOOR } from './encodings.js';

	let { datum } = $props();

	const on = $derived(!!datum?.sizeEncoding && !!datum?.sizeBy);
	const enc = $derived(datum?.sizeEncoding);
	const wired = $derived(on && typeof datum.sizeBy.refId === 'number' && datum.sizeBy.refId >= 0);

	// The modes this column can be sized by (no Hour of day), "Automatic" first.
	const modeOptions = $derived(['auto', ...sizeModesFor(datum?.sizeBy ?? {}).map((m) => m.mode)]);
	const modeLabels = $derived(
		modeOptions.map((m) =>
			m === 'auto'
				? `Automatic: ${ENCODING_MODE_LABELS[datum?.sizeMode] ?? 'Value'}`
				: ENCODING_MODE_LABELS[m]
		)
	);
	const auto = $derived(datum?.sizeAutoDomain);
	const fmt = (v) => (Number.isFinite(v) ? String(Number(v.toPrecision(3))) : '');
</script>

<div class="control-component size-by">
	<div class="control-component-title">
		<p>Size by</p>
		<input
			type="checkbox"
			class="size-by-switch"
			aria-label="Size points by a column"
			title="Size points by a column"
			checked={on}
			onchange={(e) => (e.currentTarget.checked ? datum.enableSizeBy() : datum.disableSizeBy())}
		/>
	</div>

	{#if on}
		<div class="size-by-column">
			<ControlInput label="Column"></ControlInput>
			<Column col={datum.sizeBy} canChange={true} />
		</div>

		{#if wired}
			<div class="control-input-vertical">
				<div class="control-input">
					<p>Size read as</p>
					<AttributeSelect
						bind:value={
							() => (modeOptions.includes(enc.mode) ? enc.mode : 'auto'), (v) => (enc.mode = v)
						}
						options={modeOptions}
						optionsDisplay={modeLabels}
					/>
				</div>
			</div>

			<!-- The point radius, px, at the range's ends; the AREA is linear in between. -->
			<div class="control-input-horizontal">
				<ControlInput label="Smallest (px)">
					<NumberWithUnits
						step="0.5"
						min={MIN_RADIUS_FLOOR}
						value={enc.minRadius}
						onInput={(v) => {
							const n = numberOrNull(v);
							if (n != null) enc.minRadius = Math.max(MIN_RADIUS_FLOOR, n);
						}}
					/>
				</ControlInput>
				<ControlInput label="Largest (px)">
					<NumberWithUnits
						step="0.5"
						min={MIN_RADIUS_FLOOR}
						value={enc.maxRadius}
						onInput={(v) => {
							const n = numberOrNull(v);
							if (n != null) enc.maxRadius = Math.max(MIN_RADIUS_FLOOR, n);
						}}
					/>
				</ControlInput>
			</div>

			<!-- The value range the sizes span: the data's, unless set. -->
			<div class="control-input-horizontal">
				<ControlInput label="Size from">
					<NumberWithUnits
						nullable
						step="0.1"
						value={enc.domainMin ?? auto?.lo}
						onInput={(v) => (enc.domainMin = numberOrNull(v))}
					/>
				</ControlInput>
				<ControlInput label="Size to">
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
							aria-label="Reset the size range"
							onclick={() => {
								enc.domainMin = null;
								enc.domainMax = null;
							}}
						>
							<Icon name="reset" width={14} height={14} className="control-component-input-icon" />
						</button>
					</div>
				{/if}
			</div>
			{#if enc.domainMin != null || enc.domainMax != null}
				<p class="size-by-note">
					Values beyond the range are drawn at the end sizes{auto
						? ` (data ${fmt(auto.lo)} to ${fmt(auto.hi)})`
						: ''}.
				</p>
			{/if}

			{#if !datum.drawsPoints}
				<p class="size-by-note" role="status">Size by sizes the points; show them to see it.</p>
			{/if}
			{#if datum.sizeWarning}
				<p class="size-by-note size-by-warning" role="status">{datum.sizeWarning}</p>
			{/if}
			{#if datum.sizeLengthNote}
				<p class="size-by-note size-by-warning" role="status">{datum.sizeLengthNote}</p>
			{/if}
			{#if datum.sizeSummaryNote}
				<p class="size-by-note">{datum.sizeSummaryNote}</p>
			{/if}
			<p class="size-by-note" role="status">
				{#if datum.drawsPoints && datum.sizeNoValueCount > 0}
					{@const [one, many] = datum.markWords ?? ['point', 'points']}
					{datum.sizeNoValueCount}
					{datum.sizeNoValueCount === 1 ? `${one} has` : `${many} have`} no size value; drawn at the series’
					point size ({fmt(datum.defaultRadius)} px).
				{:else}
					A point with no size value keeps the series’ point size ({fmt(datum.defaultRadius)} px).
				{/if}
			</p>
			{#if datum.sizeKeyNote}
				<p class="size-by-note">{datum.sizeKeyNote}</p>
			{/if}
		{:else}
			<p class="size-by-note">
				Pick a column, or wire one into this series’ size port on the canvas.
			</p>
		{/if}
	{/if}
</div>

<style>
	.size-by-switch {
		margin: 0;
		cursor: pointer;
	}
	.size-by-column {
		margin: var(--space-1) 0;
		/* The panel's column is `align-items: flex-start`, so a child takes its content's
		   width: pinned to the panel's, a long column name ellipsises in the picker instead
		   of running past the panel's edge. */
		width: 100%;
		min-width: 0;
	}
	.size-by-note {
		margin: var(--space-1) 0 0;
		font-size: var(--font-xs);
		line-height: 1.3;
		color: var(--color-text-muted);
	}
	.size-by-warning {
		color: var(--color-warning-text);
		background: var(--color-warning-bg);
		border-radius: var(--radius-sm);
		padding: var(--space-2);
	}
</style>
