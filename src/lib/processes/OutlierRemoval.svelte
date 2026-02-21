<script module>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import { KahanSum, kahanMean } from '$lib/utils/numerics.js';

	export const outlierremoval_displayName = 'Remove Outliers';
	export const outlierremoval_defaults = new Map([
		['method', { val: 'iqr' }],
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
		const validData = x.filter((val) => val != null && !isNaN(val));

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

		// Filter out outliers
		const cleanData = [];
		for (let i = 0; i < validData.length; i++) {
			if (!outlierMask[i]) {
				cleanData.push(validData[i]);
			}
		}

		return cleanData;
	}
</script>

<script>
	import Icon from '$lib/icons/Icon.svelte';

	let { p = $bindable() } = $props();
</script>

<div class="control-input process">
	<div class="process-title">
		<p>{p.name}</p>
		<button
			class="icon"
			onclick={(e) => {
				e.stopPropagation();
				p.parentCol.removeProcess(p.id);
			}}
		>
			<Icon name="minus" width={16} height={16} className="control-component-title-icon" />
		</button>
	</div>
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
</div>

<style>
</style>
