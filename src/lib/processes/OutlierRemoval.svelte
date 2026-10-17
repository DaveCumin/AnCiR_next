<script module>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import { KahanSum, kahanMean } from '$lib/utils/numerics.js';
	import { dataEnteringProcess } from '$lib/core/processInput.js';
	import { quantileType7 } from '$lib/utils/sampleStats.js';
	import { isInvalidValue } from '$lib/utils/stats.js';

	const outlierremoval_defaults = new Map([
		['method', { val: 'zscore' }],
		['iqrMultiplier', { val: 1.5 }],
		['zThreshold', { val: 3 }]
	]);

	export const outlierRemovalMethodOptions = ['iqr', 'zscore'];
	export const outlierRemovalMethodDisplay = ['IQR', 'Z-Score'];

	// Outlier detection functions
	/**
	 * Tukey fences on type-7 quartiles (R's default, numpy.percentile's default, and what
	 * the Boxplot and DescribeData use), so a value is an outlier here exactly when the
	 * Boxplot draws it as one. sorted[floor(n/4)] used to disagree (review STAT-22).
	 */
	export function detectOutliersIQR(y, multiplier = 1.5) {
		const q1 = quantileType7(y, 0.25);
		const q3 = quantileType7(y, 0.75);
		const iqr = q3 - q1;
		const lowerBound = q1 - multiplier * iqr;
		const upperBound = q3 + multiplier * iqr;
		return y.map((val) => val < lowerBound || val > upperBound);
	}

	export function detectOutliersZScore(y, threshold = 3) {
		const mean = kahanMean(y);
		const sumSq = new KahanSum();
		for (let val of y) {
			const diff = val - mean;
			sumSq.add(diff * diff);
		}
		const variance = sumSq.value / y.length;
		const std = Math.sqrt(variance);
		// A flat column has std === 0; every z-score is 0/0 = NaN, which already
		// flags nothing, but return an explicit all-false mask so the intent is
		// clear and no future refactor can turn this into an all-outliers wipe.
		if (std === 0) return y.map(() => false);
		return y.map((val) => Math.abs((val - mean) / std) > threshold);
	}

	export function outlierremoval(x, args) {
		const method = args.method;

		// Track valid indices so we can map the mask back to original positions
		const validIndices = [];
		const validData = [];
		for (let i = 0; i < x.length; i++) {
			// The house rule: '' and ' ' are missing (isNaN('') is false, so they used to
			// enter as zeros); a numeric string is a number.
			if (!isInvalidValue(x[i])) {
				validIndices.push(i);
				validData.push(Number(x[i]));
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

	/**
	 * Too-few-points warning for the node's ⚠ badge (processWarnings.js). The
	 * compute above is UNCHANGED — under 4 valid points it still passes the data
	 * through with nothing removed — this message just says so. Pure, so it is
	 * unit-testable without a session. Also warns when the z rule cannot fire at this n.
	 * @param {any[]} x
	 * @param {{method?: string, zThreshold?: number}} [args]
	 */
	export function outlierRemovalWarnings(x, args = {}) {
		if (x.length === 0) return [];
		const validCount = x.reduce((n, v) => (isInvalidValue(v) ? n : n + 1), 0);
		if (validCount < 4) {
			return [
				`Outlier detection needs at least 4 valid points to estimate what is typical, and this ` +
					`input has ${validCount} (missing cells do not count), so the data passed through ` +
					`unchanged with nothing removed. Wire in a longer column, or remove this node.`
			];
		}
		// The z rule uses the population SD, which bounds every |z| at (n - 1)/sqrt(n)
		// (Shiffler 1988, The American Statistician 42:79-80). At or below the threshold the
		// rule cannot flag anything, however extreme a value is (review STAT-22).
		if (args?.method === 'zscore') {
			const threshold = Number(args.zThreshold ?? 3);
			const bound = (validCount - 1) / Math.sqrt(validCount);
			if (Number.isFinite(threshold) && bound <= threshold) {
				return [
					`With ${validCount} points no value can have |z| above ${bound.toFixed(2)} ` +
						`((n - 1)/sqrt(n)), so a z threshold of ${threshold} can never flag anything. ` +
						`Lower the threshold below ${bound.toFixed(2)}, use the IQR rule, or use more data.`
				];
			}
		}
		return [];
	}

	export const definition = {
		displayName: 'Remove Outliers',
		func: outlierremoval,
		defaults: outlierremoval_defaults,
		// Free-process warnings channel: derived at render time by the node
		// components (processWarnings.js), never stored, so it cannot go stale.
		getWarnings: (p) => {
			const inData = dataEnteringProcess(p);
			if (!inData) return [];
			return outlierRemovalWarnings(inData, p.args);
		},
		nodeSpec: {
			id: 'process.outlierremoval',
			inputs: [{ name: 'input', kind: 'column', cardinality: 'one' }],
			outputs: [{ name: 'output', kind: 'column', cardinality: 'one' }]
		}
	};
</script>

<script>
	import ProcessShell from '$lib/core/ProcessShell.svelte';
	import { core } from '$lib/core/core.svelte.js';
	import { getUNIXDate } from '$lib/utils/time/TimeUtils.js';

	let { p = $bindable() } = $props();

	const removedValues = $derived.by(() => {
		const col = p.parentCol;
		let data;
		if (!col) {
			// Free dataflow node: the data entering this process is its input
			// column's data (the node reads that column directly).
			const inData = p.inputCol?.getData();
			if (!inData) return [];
			data = [...inData];
		} else {
			if (!col.processes) return [];
			const processIndex = col.processes.findIndex((proc) => proc.id === p.id);
			if (processIndex < 0) return [];

			// Reconstruct the data as it enters this process (legacy inline path)
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
		}

		// Run outlier detection on the input data
		// Same valid-value rule as outlierremoval(), so the list matches what was removed.
		const validData = data.filter((val) => !isInvalidValue(val)).map(Number);
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
		<ControlInput label="IQR multiplier">
			<NumberWithUnits bind:value={p.args.iqrMultiplier} step="0.1" min={0.1} max={5} />
		</ControlInput>
	{:else if p.args.method === 'zscore'}
		<ControlInput label="Z-score threshold">
			<NumberWithUnits bind:value={p.args.zThreshold} step="0.1" min={1} max={10} />
		</ControlInput>
	{/if}
	{#if removedValues.length > 0}
		<div>
			<p>Removed values</p>
			<div class="removed-values-list">
				{#each removedValues as value, i (i)}
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
		border-radius: var(--radius-sm);
		padding: 4px;
	}

	.removed-value-row {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: var(--font-xs);
	}

	.removed-value-number {
		color: var(--color-lightness-35);
		min-width: 24px;
		flex-shrink: 0;
	}

	.removed-value {
		width: 70px;
		font-size: var(--font-xs);
		padding: 1px 4px;
	}
</style>
