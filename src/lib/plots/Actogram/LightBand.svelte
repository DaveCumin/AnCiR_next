<script module>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';

	/** The bar's height in px for a session saved without one (it was not saved before). */
	export const LIGHT_BAND_DEFAULT_HEIGHT = 10;

	/** A saved height, or the default for a missing or unusable one. */
	function validHeight(h) {
		return typeof h === 'number' && Number.isFinite(h) && h > 0 ? h : LIGHT_BAND_DEFAULT_HEIGHT;
	}

	export class LightBandClass {
		parent;
		bands = $state([]);
		height = $state(LIGHT_BAND_DEFAULT_HEIGHT);
		length = $derived(this.bands.length);
		allOrSingle = $state('all');

		constructor(parent, dataIN) {
			this.parentPlot = parent;
			this.bands = dataIN?.bands ?? [];
			this.height = validHeight(dataIN?.height);
		}

		addBand(band) {
			// Initialize new band with minimal pc to avoid large disruptions
			band.pc = Math.max(1, Math.min(band.pc, 10));
			this.bands.push(band);
			this.normalizePC(this.bands.length - 1); // Normalize, prioritizing the new band
		}

		totalPC() {
			let total = 0;
			this.bands.forEach((band) => {
				total += Number(band.pc) || 0;
			});
			return total;
		}

		removeBand(index) {
			this.bands.splice(index, 1);
			if (this.bands.length > 0) {
				this.normalizePC(index > 0 ? index - 1 : 0); // Normalize using adjacent band
			}
		}

		updateBandPC(index, pc) {
			const newPC = Math.max(1, Math.round(Number(pc) || 1));
			const oldPC = Number(this.bands[index].pc) || 0;
			this.bands[index].pc = newPC;
			const delta = newPC - oldPC;

			if (delta !== 0 && this.bands.length > 1) {
				// Adjust adjacent band
				const adjustIndex =
					delta > 0
						? index > 0
							? index - 1
							: index + 1
						: index < this.bands.length - 1
							? index + 1
							: index - 1;
				this.bands[adjustIndex].pc = Math.max(1, Number(this.bands[adjustIndex].pc) - delta);
			}

			this.normalizePC(index); // Ensure total is 100, preserving changed band's pc
		}

		//TODO: this is not quite correct.
		normalizePC(preserveIndex) {
			if (this.bands.length === 0) return;
			if (this.bands.length === 1) {
				this.bands[0].pc = 100;
				return;
			}

			let total = this.totalPC();

			// Adjust to make total 100, preserving the band at preserveIndex
			const delta = total - 100;
			if (delta === 0) return;

			// Find an adjacent band to adjust
			let adjustIndex =
				preserveIndex < this.bands.length - 1 ? preserveIndex + 1 : preserveIndex - 1;
			if (adjustIndex < 0 || adjustIndex >= this.bands.length) {
				// No valid adjacent band, pick first band != preserveIndex
				adjustIndex = preserveIndex === 0 ? 1 : 0;
			}

			const adjustBandPC = Number(this.bands[adjustIndex].pc) - delta;
			this.bands[adjustIndex].pc = Math.max(1, Math.round(adjustBandPC));

			// Recheck total to handle rounding errors
			total = this.totalPC();
			if (total !== 100) {
				const finalAdjust = 100 - total;
				this.bands[adjustIndex].pc = Math.max(1, Number(this.bands[adjustIndex].pc) + finalAdjust);
			}
		}

		swapBandCols() {
			for (let i = 0; i < this.bands.length; i++) {
				if (this.bands[i].col === '#000000') {
					this.bands[i].col = '#ffffff';
				} else {
					this.bands[i].col = '#000000';
				}
			}
		}

		toJSON() {
			return {
				bands: this.bands,
				height: this.height
			};
		}

		static fromJSON(json, parent) {
			return new LightBandClass(parent, {
				bands: json?.bands,
				height: json?.height
			});
		}
	}
</script>

<script>
	import ColourPicker from '$lib/components/inputs/ColourPicker.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import BlockAdd from '$lib/components/plotbits/BlockAdd.svelte';
	import { tooltip } from '$lib/utils/tooltip.js';
	let { bands = $bindable(), which } = $props();
	// The bar spans exactly the rows: it starts where they start (the plot's laid-out left
	// padding, which includes the row-label gutter) and is as wide as they are (after an
	// outside legend takes its share, at the view's size). Each plotted period gets its own
	// copy of the bands, so a double plot shows the light schedule over both days. It used to
	// be placed from the SAVED padding and the figure's width, so row labels pushed the rows
	// right but not the bar, and an outside legend narrowed the rows but not the bar.
	let copies = $derived(Math.max(1, Math.round(Number(bands.parentPlot.doublePlot) || 1)));
	let singleWidth = $derived(bands.parentPlot.plotwidth / copies);
	let layout = $derived.by(() => {
		const out = [];
		for (let c = 0; c < copies; c++) {
			let x = c * singleWidth;
			for (const b of bands.bands) {
				const w = singleWidth * 0.01 * b.pc;
				out.push({ x, w, col: b.col });
				x += w;
			}
		}
		return out;
	});
</script>

<!-- TODO: DEBUG swap not working after changing color -->

{#snippet controls(bands)}
	<div class="control-component-title">
		<p>Light bands</p>
		<div class="control-component-title-icons">
			{#if bands.bands.length > 0}
				<button
					class="icon"
					type="button"
					aria-label="Swap the band colours"
					onclick={() => bands.swapBandCols()}
					{@attach tooltip('Swap the band colours')}
				>
					<Icon name="swap" width={12} height={12} className="control-component-title-icon" />
				</button>
			{/if}
		</div>
	</div>

	<BlockAdd
		actions={[
			{
				label: 'Add light band',
				ariaLabel: 'Add a band',
				tooltip: 'Add a band to the light bar above the actogram',
				// Alternating dark and light, so consecutive bands read as night and day.
				onadd: () =>
					bands.addBand({ col: bands.bands.length % 2 === 0 ? '#000000' : '#ffffff', pc: 10 })
			}
		]}
		count={bands.bands.length}
		empty="No light bands yet"
	/>

	{#if bands.bands.length > 0}
		<div class="control-input-vertical">
			<ControlInput label="Height">
				<NumberWithUnits bind:value={bands.height} min="1" />
			</ControlInput>
		</div>
		{#each bands.bands as b, i (i)}
			<!-- Row actions in the fixed order: colour, then delete last. -->
			<div class="control-input-color">
				<ColourPicker bind:value={b.col} />
				<div class="control-input">
					<NumberWithUnits
						bind:value={b.pc}
						min="1"
						max="100"
						step="1"
						onInput={(val) => bands.updateBandPC(i, val)}
					/>
				</div>
				<button
					class="icon"
					aria-label="Remove this band"
					onclick={() => bands.removeBand(i)}
					{@attach tooltip('Remove this band')}
				>
					<Icon name="trash" width={16} height={16} className="control-component-title-icon" />
				</button>
			</div>
		{/each}
	{/if}
{/snippet}

{#snippet plot(bands)}
	<g
		class="actogram"
		style="transform: translate({bands.parentPlot.padding.left}px, {bands.height}px);"
	>
		{#each layout as b, i (i)}
			<rect
				x={b.x}
				y="0"
				width={b.w}
				height={bands.height}
				fill={b.col}
				stroke="gray"
				stroke-width="1"
			/>
		{/each}
	</g>
{/snippet}

{#if which === 'plot'}
	{@render plot(bands)}
{:else if which === 'controls'}
	{@render controls(bands)}
{/if}
