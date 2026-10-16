<script module>
	import { KahanSum, kahanMean } from '$lib/utils/numerics.js';
	import { min, max } from '$lib/utils/MathsStats.js';
	import { dataEnteringProcess } from '$lib/core/processInput.js';
	import { isInvalidValue } from '$lib/utils/stats.js';

	// The house rule (review STAT-6): '' and ' ' are missing (isNaN('') is false, so the old
	// `val != null && !isNaN(val)` let them in as zeros), a numeric string is a number, and a
	// missing cell stays exactly as it came in, whatever the mode.
	const presentNumbers = (x) => x.filter((v) => !isInvalidValue(v)).map(Number);
	const mapPresent = (x, f) => x.map((v) => (isInvalidValue(v) ? v : f(Number(v))));

	// A numeric arg, or the default when it is absent, blank or not a finite number. Not
	// `Number(v || d)`, which turned a legitimate 0 into the default (review STAT-21).
	const numArg = (v, d) => {
		const n = v == null || v === '' ? NaN : Number(v);
		return Number.isFinite(n) ? n : d;
	};

	export function normalize(x, args) {
		const type = args.normalizationType || 'z-score';
		const customMin = numArg(args.customMin, 0);
		const customMax = numArg(args.customMax, 1);

		// Missing cells (null, NaN, blank, text) are left out of every calculation.
		const validData = presentNumbers(x);

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
					return mapPresent(x, () => 0); // All values are the same
				}
				return mapPresent(x, (val) => (val - mean) / std);
			}

			case 'min-max': {
				// Min-Max normalization to [customMin, customMax]
				const minVal = min(validData);
				const maxVal = max(validData);
				const range = maxVal - minVal;

				if (range === 0) {
					return mapPresent(x, () => customMin);
				}
				return mapPresent(
					x,
					(val) => ((val - minVal) / range) * (customMax - customMin) + customMin
				);
			}

			case 'robust': {
				// Robust normalization: (x - median) / MAD, the raw MAD (no 1.4826 scaling; labelled so in the UI)
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
					return mapPresent(x, () => 0);
				}
				return mapPresent(x, (val) => (val - median) / mad);
			}

			case 'unit-vector': {
				// Unit vector normalization: x / ||x||
				const kMag = new KahanSum();
				for (const val of validData) kMag.add(val * val);
				const magnitude = Math.sqrt(kMag.value);

				if (magnitude === 0) {
					return mapPresent(x, () => 0);
				}
				return mapPresent(x, (val) => val / magnitude);
			}

			default:
				return [...x]; // Return original data if unknown type
		}
	}

	/**
	 * Degenerate-input warnings for the node's ⚠ badge (processWarnings.js).
	 * The compute above is UNCHANGED — a constant input still z-scores to all
	 * zeros, min-maxes to all customMin, and a zero MAD/magnitude still yields
	 * zeros — these messages just explain the silence. Pure (data in → strings
	 * out) so it is unit-testable without a session. Each message follows the
	 * fitDomain rule: the requirement, what the data contains, and a remedy.
	 */
	export function normalizeWarnings(x, args) {
		const type = args.normalizationType || 'z-score';
		const validData = presentNumbers(x);
		if (validData.length === 0) return [];
		const constant = validData.every((v) => v === validData[0]);

		if (type === 'z-score' && constant) {
			return [
				`Z-score normalization scales by the input's spread, and every valid value here is ` +
					`${validData[0]} (no spread), so the output is all zeros rather than a normalized ` +
					`signal. Check that the right column is wired in, or remove this node.`
			];
		}
		if (type === 'min-max' && constant) {
			// Same numArg default as the compute, so the reported floor matches
			// what is actually written.
			return [
				`Min-max normalization scales by the input's range, and every valid value here is ` +
					`${validData[0]} (zero range), so every output value is the requested minimum ` +
					`(${numArg(args.customMin, 0)}). Check that the right column is wired in, or remove this node.`
			];
		}
		if (type === 'robust') {
			// Same median/MAD derivation as the compute; MAD can be 0 without the
			// input being constant (over half the values equal to the median).
			const sorted = [...validData].sort((a, b) => a - b);
			const n = sorted.length;
			const median =
				n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];
			const deviations = validData.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
			const mad =
				n % 2 === 0
					? (deviations[n / 2 - 1] + deviations[n / 2]) / 2
					: deviations[Math.floor(n / 2)];
			if (mad === 0) {
				return [
					`Robust normalization scales by the median absolute deviation, and at least half of ` +
						`this input's values equal the median (${median}), so the MAD is 0 and the output ` +
						`is all zeros. Use z-score or min-max for data this concentrated, or check that the ` +
						`right column is wired in.`
				];
			}
		}
		if (type === 'unit-vector' && validData.every((v) => v === 0)) {
			return [
				`Unit-vector normalization divides by the input's magnitude, and every valid value here ` +
					`is 0 (zero magnitude), so the output is all zeros. Check that the right column is wired in.`
			];
		}
		return [];
	}

	const normalize_defaults = new Map([
		['normalizationType', { val: 'z-score' }],
		['customMin', { val: 0 }],
		['customMax', { val: 1 }]
	]);

	export const definition = {
		// The file was renamed from normalize.svelte; sessions, the MCP tools and the Python/R
		// ports all store the process as 'normalize', so the registry keeps that key.
		registryKey: 'normalize',
		displayName: 'Normalize',
		func: normalize,
		defaults: normalize_defaults,
		// Free-process warnings channel: derived at render time by the node
		// components (processWarnings.js), never stored, so it cannot go stale.
		getWarnings: (p) => {
			const inData = dataEnteringProcess(p);
			if (!inData) return [];
			return normalizeWarnings(inData, p.args);
		},
		nodeSpec: {
			id: 'process.normalize',
			inputs: [{ name: 'input', kind: 'column', cardinality: 'one' }],
			outputs: [{ name: 'output', kind: 'column', cardinality: 'one' }]
		}
	};
</script>

<script>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import ProcessShell from '$lib/core/ProcessShell.svelte';

	let { p = $bindable() } = $props();

	const normalizationTypes = [
		{ value: 'z-score', label: 'Z-Score' },
		{ value: 'min-max', label: 'Min-Max' },
		{ value: 'robust', label: 'Robust (unscaled MAD)' },
		{ value: 'unit-vector', label: 'Unit Vector' }
	];
</script>

<ProcessShell {p}>
	<div class="control-input">
		<select bind:value={p.args.normalizationType}>
			{#each normalizationTypes as type (type.value)}
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
			(x - median) / MAD, with the raw MAD (not scaled by 1.4826)
		{:else if p.args.normalizationType === 'unit-vector'}
			Normalize to unit length
		{/if}
	</div>
</ProcessShell>

<style>
	.range-controls {
		display: flex;
		gap: var(--space-4);
		align-items: center;
	}

	.range-controls .control-input {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin: 0;
	}

	.range-controls label {
		font-size: 0.8rem;
		white-space: nowrap;
	}

	.info-text {
		font-size: var(--font-sm);
		color: var(--text-secondary, var(--color-text-muted));
		font-style: italic;
		margin-top: var(--space-2);
	}

	/* The field look is app.css's (UI-11). */
	select {
		width: 100%;
	}
</style>
