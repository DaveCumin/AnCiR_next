<script module>
	export class LightBandClass {
		parent;
		bands = $state([]);
		height = $state(10);
		length = $derived(this.bands.length);
		allOrSingle = $state('all');

		constructor(parent, dataIN) {
			this.parentPlot = parent;
			this.bands = dataIN?.bands ?? [];
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
				bands: this.bands
			};
		}

		static fromJSON(json, parent) {
			return new LightBandClass(parent, {
				bands: json.bands
			});
		}
	}
</script>

<script>
	import ColourPicker from '$lib/components/inputs/ColourPicker.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	let { bands = $bindable(), which } = $props();
	let singleWidth = $derived.by(() => {
		const plotwidth =
			bands.parentPlot.parentBox.width -
			bands.parentPlot.paddingIN.left -
			bands.parentPlot.paddingIN.right;
		return plotwidth / bands.parentPlot.doublePlot;
	});
</script>

<!-- TODO: DEBUG swap not working after changing color -->

{#snippet controls(bands)}
	<div class="control-component-title">
		<p>Bands</p>
		<div class="control-component-title-icons">
			{#if bands.bands.length > 0}
			<button class="icon" onclick={() => bands.swapBandCols()}>
				<Icon name="swap" width={12} height={12} className="control-component-title-icon" />
			</button>
			{/if}
			<button
				class="icon"
				onclick={() =>
					bands.addBand({ col: bands.length % 2 === 0 ? '#000000' : '#ffffff', pc: 10 })}
			>
				<Icon name="plus" width={16} height={16} className="control-component-title-icon" />
			</button>
		</div>
	</div>

	{#if bands.bands.length > 0}
		<div class="control-input-vertical">
			<div class="control-input">
				<p>Height</p>
				<input type="number" bind:value={bands.height} min="1" />
			</div>
		</div>
		{#each bands.bands as b, i}
			<div class="control-input-color">
				<ColourPicker bind:value={b.col} />
				<div class="control-input">
					<input
						type="number"
						bind:value={b.pc}
						min="1"
						max="100"
						step="1"
						oninput={(e) => bands.updateBandPC(i, e.target.value)}
					/>
				</div>
					<button class="icon" onclick={() => bands.removeBand(i)}>
						<Icon name="minus" width={16} height={16} className="control-component-title-icon" />
					</button>
				
			</div>
		{/each}
	{:else}
		<div class="control-input-vertical">
			<div class="control-input">
				<p>Click + to add a band</p>
			</div>
		</div>
	{/if}
{/snippet}

{#snippet plot(bands)}
	<g
		class="actogram"
		style="transform: translate({bands.parentPlot.paddingIN.left}px, {bands.height}px);"
	>
		{#each bands.bands as b, i}
			{@const xPos = bands.bands
				.slice(0, i)
				.reduce((sum, band) => sum + singleWidth * 0.01 * band.pc, 0)}
			<rect
				x={xPos}
				y="0"
				width={singleWidth * 0.01 * b.pc}
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
