<script module>
	import { KahanSum, kahanMean } from '$lib/utils/numerics.js';
	import { min, max } from '$lib/utils/MathsStats.js';

	export function normalize(x, args) {
		const type = args.normalizationType || 'z-score';
		const customMin = Number(args.customMin || 0);
		const customMax = Number(args.customMax || 1);

		// Filter out null/undefined/NaN values for calculations
		const validData = x.filter((val) => val != null && !isNaN(val));

		if (validData.length === 0) {
			return [...x]; // Return original if no valid data
		}

		switch (type) {
			case 'z-score': {
				// Z-score normalization: (x - mean) / std
				const mean = kahanMean(validData);
				const k = new KahanSum();
				for (const val of validData) k.add(Math.pow(val - mean, 2));
				const std = Math.sqrt(k.value / validData.length);

				if (std === 0) {
					return x.map(() => 0); // All values are the same
				}
				return x.map((val) => (val == null || isNaN(val) ? val : (val - mean) / std));
			}

			case 'min-max': {
				// Min-Max normalization to [customMin, customMax]
				const minVal = min(validData);
				const maxVal = max(validData);
				const range = maxVal - minVal;

				if (range === 0) {
					return x.map((val) => (val == null || isNaN(val) ? val : customMin));
				}
				return x.map((val) =>
					val == null || isNaN(val)
						? val
						: ((val - minVal) / range) * (customMax - customMin) + customMin
				);
			}

			case 'robust': {
				// Robust normalization using median and MAD
				const sorted = [...validData].sort((a, b) => a - b);
				const median =
					sorted.length % 2 === 0
						? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
						: sorted[Math.floor(sorted.length / 2)];

				const absoluteDeviations = validData.map((val) => Math.abs(val - median));
				const sortedDeviations = absoluteDeviations.sort((a, b) => a - b);
				const mad =
					sortedDeviations.length % 2 === 0
						? (sortedDeviations[sortedDeviations.length / 2 - 1] +
								sortedDeviations[sortedDeviations.length / 2]) /
							2
						: sortedDeviations[Math.floor(sortedDeviations.length / 2)];

				if (mad === 0) {
					return x.map(() => 0);
				}
				return x.map((val) => (val == null || isNaN(val) ? val : (val - median) / mad));
			}

			case 'unit-vector': {
				// Unit vector normalization: x / ||x||
				const kMag = new KahanSum();
				for (const val of validData) kMag.add(val * val);
				const magnitude = Math.sqrt(kMag.value);

				if (magnitude === 0) {
					return x.map(() => 0);
				}
				return x.map((val) => (val == null || isNaN(val) ? val : val / magnitude));
			}

			default:
				return [...x]; // Return original data if unknown type
		}
	}

	const normalize_defaults = new Map([
		['normalizationType', { val: 'z-score' }],
		['customMin', { val: 0 }],
		['customMax', { val: 1 }]
	]);

	export const definition = {
		displayName: 'Normalize',
		func: normalize,
		defaults: normalize_defaults
	};
</script>

<script>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import ProcessShell from '$lib/core/ProcessShell.svelte';

	let { p = $bindable() } = $props();

	const normalizationTypes = [
		{ value: 'z-score', label: 'Z-Score' },
		{ value: 'min-max', label: 'Min-Max' },
		{ value: 'robust', label: 'Robust' },
		{ value: 'unit-vector', label: 'Unit Vector' }
	];
</script>

<ProcessShell {p}>
	<div class="control-input">
		<select bind:value={p.args.normalizationType}>
			{#each normalizationTypes as type}
				<option value={type.value}>{type.label}</option>
			{/each}
		</select>
	</div>

	{#if p.args.normalizationType === 'min-max'}
		<div class="range-controls">
			<div class="control-input">
				<label>Min:</label>
				<NumberWithUnits bind:value={p.args.customMin} step="0.1" />
			</div>
			<div class="control-input">
				<label>Max:</label>
				<NumberWithUnits bind:value={p.args.customMax} step="0.1" />
			</div>
		</div>
	{/if}

	<div class="info-text">
		{#if p.args.normalizationType === 'z-score'}
			Mean=0, Std=1
		{:else if p.args.normalizationType === 'min-max'}
			Scale to [{p.args.customMin}, {p.args.customMax}]
		{:else if p.args.normalizationType === 'robust'}
			Median-based, outlier-resistant
		{:else if p.args.normalizationType === 'unit-vector'}
			Normalize to unit length
		{/if}
	</div>
</ProcessShell>

<style>
	.range-controls {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.range-controls .control-input {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		margin: 0;
	}

	.range-controls label {
		font-size: 0.8rem;
		white-space: nowrap;
	}

	.info-text {
		font-size: 0.75rem;
		color: var(--text-secondary, #666);
		font-style: italic;
		margin-top: 0.25rem;
	}

	select {
		width: 100%;
		padding: 0.25rem;
		border: 1px solid var(--border-color, #ccc);
		border-radius: 0.25rem;
		font-size: 0.9rem;
	}
</style>
