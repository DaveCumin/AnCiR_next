<script module>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import { KahanSum, kahanMean } from '$lib/utils/numerics.js';

	const outlierremoval_defaults = new Map([
		['method', { val: 'zscore' }],
		['iqrMultiplier', { val: 1.5 }],
		['zThreshold', { val: 3 }]
	]);

	// Outlier detection functions
	function detectOutliersIQR(y, multiplier = 1.5) {
		const sorted = [...y].sort((a, b) => a - b);
		const n = sorted.length;
		const q1Index = Math.floor(n / 4);
		const q3Index = Math.floor((3 * n) / 4);
		const q1 = sorted[q1Index];
		const q3 = sorted[q3Index];
		const iqr = q3 - q1;
		const lowerBound = q1 - multiplier * iqr;
		const upperBound = q3 + multiplier * iqr;
		return y.map((val) => val < lowerBound || val > upperBound);
	}

	function detectOutliersZScore(y, threshold = 3) {
		const mean = kahanMean(y);
		const sumSq = new KahanSum();
		for (let val of y) {
			const diff = val - mean;
			sumSq.add(diff * diff);
		}
		const variance = sumSq.value / y.length;
		const std = Math.sqrt(variance);
		return y.map((val) => Math.abs((val - mean) / std) > threshold);
	}

	export function outlierremoval(x, args) {
		const method = args.method;

		// Track valid indices so we can map the mask back to original positions
		const validIndices = [];
		const validData = [];
		for (let i = 0; i < x.length; i++) {
			if (x[i] != null && !isNaN(x[i])) {
				validIndices.push(i);
				validData.push(x[i]);
			}
		}

		if (validData.length < 4) {
			return x; // Return original if not enough data
		}

		let outlierMask;
		try {
			if (method === 'zscore') {
				outlierMask = detectOutliersZScore(validData, args.zThreshold);
			} else {
				// iqr
				outlierMask = detectOutliersIQR(validData, args.iqrMultiplier);
			}
		} catch (error) {
			console.warn('Outlier detection failed:', error);
			return x; // Return original on error
		}

		// Replace outliers with null, preserving original array length and indices
		const out = [...x];
		for (let i = 0; i < validIndices.length; i++) {
			if (outlierMask[i]) {
				out[validIndices[i]] = null;
			}
		}
		return out;
	}

	export const definition = {
		displayName: 'Remove Outliers',
		func: outlierremoval,
		defaults: outlierremoval_defaults
	};
</script>

<script>
	import ProcessShell from '$lib/core/ProcessShell.svelte';
	import { core } from '$lib/core/core.svelte.js';
	import { getUNIXDate } from '$lib/utils/time/TimeUtils.js';

	let { p = $bindable() } = $props();

	const removedValues = $derived.by(() => {
		const col = p.parentCol;
		if (!col?.processes) return [];
		const processIndex = col.processes.findIndex((proc) => proc.id === p.id);
		if (processIndex < 0) return [];

		// Reconstruct the data as it enters this process
		let data;
		if (col.isReferencial()) {
			const refData = col.refColumn?.getData();
			if (!refData) return [];
			data = [...refData];
		} else {
			const rawData = core.rawData.get(col.data);
			if (!rawData) return [];

			if (col.compression === 'awd') {
				data = new Array(rawData.length);
				for (let i = 0; i < rawData.length; i++) {
					data[i] = rawData.start + i * rawData.step;
				}
			} else {
				data = [...rawData];
			}

			if (col.type === 'time' && col.compression !== 'awd') {
				try {
					data = data.map((x) => Number(getUNIXDate(x, col.timeFormat)));
				} catch {
					/* ignore */
				}
			}

			if (col.type === 'bin') {
				data = data.map((x) => x + col.binWidth / 2);
			}
		}

		// Apply all processes before this one
		for (let i = 0; i < processIndex; i++) {
			data = col.processes[i].doProcess(data);
		}

		// Run outlier detection on the input data
		const validData = data.filter((val) => val != null && !isNaN(val));
		if (validData.length < 4) return [];

		let outlierMask;
		try {
			if (p.args.method === 'zscore') {
				outlierMask = detectOutliersZScore(validData, p.args.zThreshold);
			} else {
				outlierMask = detectOutliersIQR(validData, p.args.iqrMultiplier);
			}
		} catch {
			return [];
		}

		const removed = [];
		for (let i = 0; i < validData.length; i++) {
			if (outlierMask[i]) {
				removed.push(validData[i]);
			}
		}
		return removed;
	});
</script>

<ProcessShell {p}>
	<div class="control-input">
		<p>Method</p>
		<AttributeSelect
			bind:value={p.args.method}
			options={['iqr', 'zscore']}
			optionsDisplay={['IQR', 'Z-Score']}
		/>
	</div>
	{#if p.args.method === 'iqr'}
		<div class="control-input">
			<p>IQR Multiplier</p>
			<NumberWithUnits bind:value={p.args.iqrMultiplier} step="0.1" min={0.1} max={5} />
		</div>
	{:else if p.args.method === 'zscore'}
		<div class="control-input">
			<p>Z-Score Threshold</p>
			<NumberWithUnits bind:value={p.args.zThreshold} step="0.1" min={1} max={10} />
		</div>
	{/if}
	{#if removedValues.length > 0}
		<div>
			<p>Removed values</p>
			<div class="removed-values-list">
				{#each removedValues as value, i}
					<div class="removed-value-row">
						<span class="removed-value-number">{i + 1}:</span>
						<span class="removed-value">{parseFloat(value.toFixed(2))}</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</ProcessShell>

<style>
	.removed-values-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-height: 150px;
		overflow-y: auto;
		border: 1px solid #e1e9f6;
		border-radius: 4px;
		padding: 4px;
	}

	.removed-value-row {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
	}

	.removed-value-number {
		color: var(--color-lightness-35);
		min-width: 24px;
		flex-shrink: 0;
	}

	.removed-value {
		width: 70px;
		font-size: 11px;
		padding: 1px 4px;
	}
</style>
