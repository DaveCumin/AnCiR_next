<script module>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import ColourPicker from '$lib/components/inputs/ColourPicker.svelte';
	import { scaleLinear, scaleTime } from 'd3-scale';
	import { getPlotById } from '$lib/core/Plot.svelte';

	let _nightBandCounter = 0;

	export function deleteNightBand(plotid, bandid) {
		const plot = getPlotById(plotid);
		if (plot) {
			plot.plot.nightBands = plot.plot.nightBands.filter((band) => band.id !== bandid);
		}
	}

	export class NightBandClass {
		parentPlot = $state();
		id;
		name = $state('Night');
		mode = $state('repeating'); // 'repeating' or 'custom'
		colour = $state('#2C2C2C30'); // Semi-transparent dark gray with alpha
		enabled = $state(true);

		// Repeating mode properties
		repeatEveryHours = $state(24);
		nightDurationHours = $state(12);
		startTimeHours = $state(0);
		useDataMin = $state(true); // Use min of x-axis as start time reference

		// Custom mode properties
		customBands = $state([]); // Array of { startTime, endTime }

		// Calculate all band segments to render
		bands = $derived.by(() => {
			// Force dependency on mode and other key toggles
			const mode = this.mode;
			const enabled = this.enabled;
			const parent = this.parentPlot;
			const hasData = parent?.data?.length > 0;

			if (!parent || !enabled || !hasData) {
				return [];
			}

			const bands = [];

			if (mode === 'repeating') {
				let minX = parent.xlims[0];
				let maxX = parent.xlims[1];

				let bandStart = this.useDataMin ? minX : this.startTimeHours;
				const bandWidth = parent.anyXdataTime
					? this.nightDurationHours * 3600000
					: this.nightDurationHours;
				const step = parent.anyXdataTime ? this.repeatEveryHours * 3600000 : this.repeatEveryHours;

				while (bandStart < maxX) {
					const bandEnd = bandStart + bandWidth;
					if (bandEnd > minX && bandStart < maxX) {
						bands.push({
							startTime: Math.max(bandStart, minX),
							endTime: Math.min(bandEnd, maxX),
							label: `Night ${bands.length + 1}`
						});
					}
					bandStart += step;
				}
			} else if (mode === 'custom') {
				const msPerUnit = parent.anyXdataTime ? 3600000 : 1;
				this.customBands.forEach((band, idx) => {
					if (band.startTime == null || band.durationHours == null) return;
					const endTime = band.startTime + band.durationHours * msPerUnit;
					if (band.durationHours > 0 && endTime > band.startTime) {
						bands.push({
							startTime: band.startTime,
							endTime,
							label: band.label || `Night ${idx + 1}`
						});
					}
				});
			}

			return bands;
		});
		constructor(parent, dataIN) {
			this.parentPlot = parent;
			this.id = _nightBandCounter++;

			if (dataIN) {
				this.name = dataIN.name || 'Night';
				this.mode = dataIN.mode || 'repeating';
				this.colour = dataIN.colour || '#2C2C2C99';
				this.enabled = dataIN.enabled ?? true;
				this.repeatEveryHours = Number(dataIN.repeatEveryHours) || 24;
				this.nightDurationHours = Number(dataIN.nightDurationHours) || 12;
				this.startTimeHours = Number(dataIN.startTimeHours) || 0;
				this.useDataMin = dataIN.useDataMin ?? true;
				this.customBands = (dataIN.customBands || []).map((b) => this._normaliseBand(b));
			}
		}

		// ms per "duration unit": duration input is always in hours. For non-time x-axes the hours
		// value is treated as raw x-axis units (mirrors repeating-mode behaviour).
		get _msPerDurationUnit() {
			return this.parentPlot?.anyXdataTime ? 3600000 : 1;
		}

		// Store primary fields (startTime, durationHours); endTime is derived. Supports legacy
		// bands that stored endTime directly.
		_normaliseBand(band) {
			const msPerUnit = this._msPerDurationUnit;
			let startTime = band.startTime ?? null;
			let durationHours = band.durationHours ?? null;
			if (durationHours == null && band.endTime != null && startTime != null) {
				durationHours = (band.endTime - startTime) / msPerUnit;
			}
			return {
				label: band.label,
				startTime,
				durationHours: durationHours ?? 0
			};
		}

		addCustomBand() {
			const parent = this.parentPlot;
			const xmin = parent?.xlims?.[0] ?? 0;
			const xmax = parent?.xlims?.[1] ?? 1;
			const msPerUnit = this._msPerDurationUnit;
			const defaultDurationHours = parent?.anyXdataTime
				? 12
				: Math.max((xmax - xmin) / msPerUnit / 10, 1);
			this.customBands.push({
				label: `Band ${this.customBands.length + 1}`,
				startTime: xmin,
				durationHours: defaultDurationHours
			});
		}

		removeCustomBand(index) {
			this.customBands.splice(index, 1);
		}

		// Update one field; mirrors actogram annotation behaviour:
		//   - editing start keeps duration (end moves with start)
		//   - editing end keeps start (duration changes)
		//   - editing duration keeps start (end moves)
		updateCustomBandField(index, field, value) {
			if (index < 0 || index >= this.customBands.length) return;
			const band = { ...this.customBands[index] };
			const msPerUnit = this._msPerDurationUnit;

			if (field === 'label') {
				band.label = value;
			} else if (field === 'start') {
				band.startTime = Number(value);
			} else if (field === 'end') {
				const newDuration = (Number(value) - band.startTime) / msPerUnit;
				band.durationHours = Math.max(0, newDuration);
			} else if (field === 'duration') {
				band.durationHours = Math.max(0, Number(value));
			}

			this.customBands[index] = band;
		}

		toJSON() {
			return {
				id: this.id,
				name: this.name,
				mode: this.mode,
				colour: this.colour,
				enabled: this.enabled,
				repeatEveryHours: this.repeatEveryHours,
				nightDurationHours: this.nightDurationHours,
				startTimeHours: this.startTimeHours,
				useDataMin: this.useDataMin,
				customBands: this.customBands
			};
		}

		static fromJSON(parent, json) {
			if (!json) {
				return new NightBandClass(parent);
			}
			return new NightBandClass(parent, json);
		}
	}
</script>

<script>
	import { flip } from 'svelte/animate';
	import { slide } from 'svelte/transition';
	import DateTimeHrs from '$lib/components/inputs/DateTimeHrs.svelte';

	let { nightBand, which, plotId } = $props();

	function handleMouseEnter(e) {
		e.target.dispatchEvent(
			new CustomEvent('tooltip', {
				detail: {
					visible: true,
					text: `${nightBand.name}:  ${nightBand.mode === 'repeating' ? 'Repeating' : 'Custom'}`
				},
				bubbles: true
			})
		);
	}

	function handleMouseLeave(e) {
		e.target.dispatchEvent(
			new CustomEvent('tooltip', {
				detail: { visible: false },
				bubbles: true
			})
		);
	}
</script>

{#snippet controls(nightBand)}
	<div
		class="control-component-title-icons"
		style="margin-bottom: -1rem; z-index: 9999; margin-top: 0.25rem;"
	>
		<button
			class="icon"
			onclick={() => deleteNightBand(plotId, nightBand.id)}
			onmouseenter={handleMouseEnter}
			onmouseleave={handleMouseLeave}
		>
			<Icon name="minus" width={16} height={16} className="menu-icon" />
		</button>
	</div>

	<div class="control-input-horizontal">
		<div class="control-input">
			<p>Name</p>
			<input bind:value={nightBand.name} />
		</div>

		<div class="control-color">
			<ColourPicker bind:value={nightBand.colour} />
		</div>
	</div>

	<div class="control-input-horizontal">
		<label style="display: flex; align-items: center; gap: 0.5rem; flex:  1;">
			<input type="checkbox" bind:checked={nightBand.enabled} />
			<span style="font-size:  12px; color: var(--color-lightness-35);">Enabled</span>
		</label>
	</div>

	<div class="div-line"></div>

	<!-- Mode Selection -->
	<div class="control-component-title">
		<p>Mode</p>
	</div>

	<div class="control-input-horizontal">
		<label style="display: flex; align-items: center; gap: 0.5rem; flex: 1;">
			<input
				type="radio"
				name="mode-{nightBand.id}"
				value="repeating"
				checked={nightBand.mode === 'repeating'}
				onchange={() => (nightBand.mode = 'repeating')}
			/>
			<span style="font-size: 12px;">Repeating</span>
		</label>
		<label style="display: flex; align-items: center; gap: 0.5rem; flex: 1;">
			<input
				type="radio"
				name="mode-{nightBand.id}"
				value="custom"
				checked={nightBand.mode === 'custom'}
				onchange={() => (nightBand.mode = 'custom')}
			/>
			<span style="font-size: 12px;">Custom</span>
		</label>
	</div>

	<div class="div-line"></div>

	{#if nightBand.mode === 'repeating'}
		<!-- Repeating Mode Controls -->
		<div class="control-component-title">
			<p>Repeating Pattern</p>
		</div>

		<div class="control-input">
			<label style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
				<input type="checkbox" bind:checked={nightBand.useDataMin} />
				<span style="font-size: 12px;">Use data minimum as reference</span>
			</label>
		</div>

		{#if !nightBand.useDataMin}
			<div class="control-input">
				<p>Start Time (hours)</p>
				{#if nightBand.parentPlot.anyXdataTime}
					<DateTimeHrs step="0.5" bind:value={nightBand.startTimeHours} />
				{:else}
					<NumberWithUnits step="0.5" bind:value={nightBand.startTimeHours} />
				{/if}
			</div>
		{:else}
			<div class="control-input">
				<p>Start Time: Data Min + {nightBand.startTimeHours} hrs</p>
			</div>
		{/if}

		<div class="control-input">
			<p>Period (hours)</p>
			<NumberWithUnits min="0.5" step="0.5" bind:value={nightBand.repeatEveryHours} />
		</div>

		<div class="control-input">
			<p>Night Duration (hours)</p>
			<NumberWithUnits
				min="0.1"
				max={nightBand.repeatEveryHours * 0.99}
				step="0.5"
				bind:value={nightBand.nightDurationHours}
			/>
		</div>

		{#if nightBand.bands.length > 0}
			<div class="control-input">
				<p>Generates {nightBand.bands.length} band(s)</p>
			</div>
		{/if}
	{:else}
		<!-- Custom Mode Controls -->
		<div class="control-component-title">
			<p>Custom Bands</p>
			<div class="control-component-title-icons">
				<button
					class="icon"
					onclick={() => nightBand.addCustomBand()}
					onmouseenter={handleMouseEnter}
					onmouseleave={handleMouseLeave}
				>
					<Icon name="plus" width={16} height={16} className="control-component-title-icon" />
				</button>
			</div>
		</div>

		{#if nightBand.customBands.length === 0}
			<div class="control-input">
				<p>Click + to add a custom band</p>
			</div>
		{:else}
			{@const isTime = nightBand.parentPlot?.anyXdataTime}
			{@const msPerUnit = isTime ? 3600000 : 1}
			{#each nightBand.customBands as band, idx (idx)}
				<div
					class="custom-band-container"
					animate:flip={{ duration: 300 }}
					in:slide={{ duration: 300, axis: 'y' }}
					out:slide={{ duration: 300, axis: 'y' }}
				>
					<div class="control-input-horizontal">
						<div class="control-input" style="flex: 1;">
							<p>Label</p>
							<input
								value={band.label}
								onchange={(e) =>
									nightBand.updateCustomBandField(idx, 'label', e.currentTarget.value)}
							/>
						</div>
						<button class="icon" onclick={() => nightBand.removeCustomBand(idx)}>
							<Icon name="minus" width={16} height={16} className="control-component-title-icon" />
						</button>
					</div>

					<div class="control-input-vertical">
						<div class="control-input">
							<p>Start{isTime ? '' : ' (hours)'}</p>
							{#if isTime}
								<DateTimeHrs
									value={band.startTime}
									onChange={(/** @type {number} */ val) =>
										nightBand.updateCustomBandField(idx, 'start', Number(val))}
								/>
							{:else}
								<NumberWithUnits
									step={0.1}
									value={band.startTime}
									onInput={(/** @type {number} */ val) =>
										nightBand.updateCustomBandField(idx, 'start', val)}
								/>
							{/if}
						</div>

						<div class="control-input">
							<p>End{isTime ? '' : ' (hours)'}</p>
							{#if isTime}
								<DateTimeHrs
									value={band.startTime + band.durationHours * msPerUnit}
									onChange={(/** @type {number} */ val) =>
										nightBand.updateCustomBandField(idx, 'end', Number(val))}
								/>
							{:else}
								<NumberWithUnits
									step={0.1}
									value={band.startTime + band.durationHours * msPerUnit}
									onInput={(/** @type {number} */ val) =>
										nightBand.updateCustomBandField(idx, 'end', val)}
								/>
							{/if}
						</div>

						<div class="control-input">
							<p>Duration (hours)</p>
							<NumberWithUnits
								min={0}
								step={0.1}
								value={band.durationHours}
								onInput={(/** @type {number} */ val) =>
									nightBand.updateCustomBandField(idx, 'duration', val)}
							/>
						</div>
					</div>
					<div class="div-line" style="margin-top: 0.5rem; margin-bottom: 0;"></div>
				</div>
			{/each}
		{/if}
	{/if}
{/snippet}

{#snippet plot(nightBand)}
	{#if nightBand.enabled && nightBand.bands.length > 0}
		{@const xScale = scaleLinear().domain([0, 100]).range([0, 100])}

		{#each nightBand.bands as band (band.label)}
			<g class="night-band">
				<rect
					class="night-band-rect"
					x={`${(band.startTime / (nightBand.parentPlot?.xlimsOUT?.[1] ?? 100)) * 100}%`}
					y="0"
					width={`${((band.endTime - band.startTime) / (nightBand.parentPlot?.xlimsOUT?.[1] ?? 100)) * 100}%`}
					height="100%"
					fill={nightBand.colour}
					style="pointer-events: none;"
				/>
			</g>
		{/each}
	{/if}
{/snippet}

{#if which === 'plot'}
	{@render plot(nightBand)}
{:else if which === 'controls'}
	{@render controls(nightBand)}
{/if}

<style>
	:global(.custom-band-container) {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.5rem;
		background-color: var(--color-lightness-98);
		border-radius: 4px;
		margin-bottom: 0.5rem;
	}

	input[type='checkbox'],
	input[type='radio'] {
		cursor: pointer;
		width: 16px;
		height: 16px;
	}

	input[type='range'] {
		cursor: pointer;
	}
</style>
