<script module>
	// @ts-nocheck
	import { getColumnById } from '$lib/core/Column.svelte';
	import { linearRegression } from '$lib/components/plotbits/helpers/wrangleData.js';

	export const removetrend_displayName = 'Remove Trend';
	export const removetrend_defaults = new Map([
		['xColId', { val: -1 }],
		['model', { val: 'linear' }],
		['polyDegree', { val: 2 }],
		['slidingWindow', { val: false }],
		['windowSize', { val: 10 }]
	]);

	// --- Trend fitting helpers ---
	function multiplyMatrices(A, B) {
		const rows = A.length;
		const cols = B[0].length;
		const common = B.length;
		const result = Array.from({ length: rows }, () => Array(cols).fill(0));
		for (let i = 0; i < rows; i++)
			for (let j = 0; j < cols; j++)
				for (let k = 0; k < common; k++)
					result[i][j] += A[i][k] * B[k][j];
		return result;
	}

	function transpose(matrix) {
		return matrix[0].map((_, c) => matrix.map((row) => row[c]));
	}

	function solveLinearSystem(A, b) {
		const n = A.length;
		const aug = A.map((row, i) => [...row, b[i]]);
		for (let i = 0; i < n; i++) {
			let mx = i;
			for (let k = i + 1; k < n; k++)
				if (Math.abs(aug[k][i]) > Math.abs(aug[mx][i])) mx = k;
			[aug[i], aug[mx]] = [aug[mx], aug[i]];
			for (let k = i + 1; k < n; k++) {
				const f = aug[k][i] / aug[i][i];
				for (let j = i; j <= n; j++) aug[k][j] -= f * aug[i][j];
			}
		}
		const res = new Array(n);
		for (let i = n - 1; i >= 0; i--) {
			res[i] = aug[i][n];
			for (let j = i + 1; j < n; j++) res[i] -= aug[i][j] * res[j];
			res[i] /= aug[i][i];
		}
		return res;
	}

	function polynomialFit(x, y, degree) {
		const n = x.length;
		const A = [];
		for (let i = 0; i < n; i++) {
			const row = [];
			for (let j = 0; j <= degree; j++) row.push(Math.pow(x[i], j));
			A.push(row);
		}
		const AT = transpose(A);
		const ATA = multiplyMatrices(AT, A);
		const ATy = multiplyMatrices(AT, y.map((v) => [v])).map((r) => r[0]);
		return solveLinearSystem(ATA, ATy);
	}

	function evaluatePolynomial(coeffs, x) {
		return coeffs.reduce((sum, c, i) => sum + c * Math.pow(x, i), 0);
	}

	function computeRSquared(y, fitted) {
		const meanY = y.reduce((s, v) => s + v, 0) / y.length;
		const ssTot = y.reduce((s, v) => s + Math.pow(v - meanY, 2), 0);
		const ssRes = y.reduce((s, v, i) => s + Math.pow(v - fitted[i], 2), 0);
		return ssTot > 0 ? 1 - ssRes / ssTot : 0;
	}

	export function fitTrend(x, y, model, polyDegree = 2) {
		let parameters, fitted, rSquared;
		if (model === 'linear') {
			const reg = linearRegression(x, y);
			parameters = { slope: reg.slope, intercept: reg.intercept };
			fitted = x.map((xi) => reg.slope * xi + reg.intercept);
			rSquared = reg.rSquared;
		} else if (model === 'exponential') {
			const reg = linearRegression(x, y.map(Math.log));
			const a = Math.exp(reg.intercept);
			const b = reg.slope;
			parameters = { a, b };
			fitted = x.map((xi) => a * Math.exp(b * xi));
			rSquared = computeRSquared(y, fitted);
		} else if (model === 'logarithmic') {
			const reg = linearRegression(x.map(Math.log), y);
			const a = reg.intercept;
			const b = reg.slope;
			parameters = { a, b };
			fitted = x.map((xi) => a + b * Math.log(xi));
			rSquared = computeRSquared(y, fitted);
		} else if (model === 'polynomial') {
			const coeffs = polynomialFit(x, y, polyDegree);
			parameters = { coeffs };
			fitted = x.map((xi) => evaluatePolynomial(coeffs, xi));
			rSquared = computeRSquared(y, fitted);
		}
		const rmse = Math.sqrt(
			fitted.reduce((s, fi, i) => s + Math.pow(y[i] - fi, 2), 0) / x.length
		);
		return { parameters, fitted, rmse, rSquared };
	}

	function slidingStandardisation(data, windowSize) {
		const half = Math.floor(windowSize / 2);
		return data.map((_, i) => {
			const start = Math.max(0, i - half);
			const end = Math.min(data.length - 1, i + half);
			let sum = 0, sumSq = 0;
			const count = end - start + 1;
			for (let j = start; j <= end; j++) {
				sum += data[j];
				sumSq += data[j] * data[j];
			}
			const mean = sum / count;
			const std = Math.sqrt(sumSq / count - mean * mean) || 1;
			return (data[i] - mean) / std;
		});
	}

	export function removetrend(x, args) {
		const xColId = args.xColId;
		const xCol = xColId != -1 ? getColumnById(xColId) : null;
		const t = xCol
			? (xCol.type === 'time' ? xCol.hoursSinceStart : xCol.getData())
			: x.map((_, i) => i);

		const validIndices = t
			.map((v, i) => (!isNaN(v) && x[i] != null && !isNaN(x[i]) ? i : -1))
			.filter((i) => i !== -1);

		if (validIndices.length < 2) return [...x];

		const tt = validIndices.map((i) => t[i]);
		const yy = validIndices.map((i) => x[i]);
		const fittedData = fitTrend(tt, yy, args.model, args.polyDegree);
		let detrended = yy.map((yi, k) => yi - fittedData.fitted[k]);

		if (args.slidingWindow && args.windowSize > 1) {
			detrended = slidingStandardisation(detrended, args.windowSize);
		}

		const out = [...x];
		for (let k = 0; k < validIndices.length; k++) out[validIndices[k]] = detrended[k];
		return out;
	}
</script>

<script>
	// @ts-nocheck
	import Icon from '$lib/icons/Icon.svelte';
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import { core } from '$lib/core/core.svelte.js';
	import { getUNIXDate } from '$lib/utils/time/TimeUtils.js';

	let { p = $bindable() } = $props();

	// Reactively compute trend fit stats for display
	let trendStats = $derived.by(() => {
		const col = p.parentCol;
		if (!col?.processes) return null;
		const processIndex = col.processes.findIndex((proc) => proc.id === p.id);
		if (processIndex < 0) return null;

		// Reconstruct data as it enters this process (same pattern as OutlierRemoval)
		let data;
		if (col.isReferencial()) {
			const refData = col.refColumn?.getData();
			if (!refData) return null;
			data = [...refData];
		} else {
			const rawData = core.rawData.get(col.data);
			if (!rawData) return null;
			if (col.compression === 'awd') {
				data = new Array(rawData.length);
				for (let i = 0; i < rawData.length; i++) data[i] = rawData.start + i * rawData.step;
			} else {
				data = [...rawData];
			}
			if (col.type === 'time' && col.compression !== 'awd') {
				try { data = data.map((v) => Number(getUNIXDate(v, col.timeFormat))); } catch { /* ignore */ }
			}
			if (col.type === 'bin') data = data.map((v) => v + col.binWidth / 2);
		}
		for (let i = 0; i < processIndex; i++) data = col.processes[i].doProcess(data);

		const statsXCol = p.args.xColId != -1 ? getColumnById(p.args.xColId) : null;
		const t = statsXCol
			? (statsXCol.type === 'time' ? statsXCol.hoursSinceStart : statsXCol.getData())
			: data.map((_, i) => i);

		const validIndices = t
			.map((v, i) => (!isNaN(v) && data[i] != null && !isNaN(data[i]) ? i : -1))
			.filter((i) => i !== -1);
		if (validIndices.length < 2) return null;

		try {
			return fitTrend(
				validIndices.map((i) => t[i]),
				validIndices.map((i) => data[i]),
				p.args.model,
				p.args.polyDegree
			);
		} catch {
			return null;
		}
	});
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

	<!-- X column for trend fitting -->
	<div class="control-input">
		<p>X axis</p>
		<ColumnSelector bind:value={p.args.xColId} />
	</div>

	<!-- Trend model -->
	<div class="control-input">
		<p>Model</p>
		<AttributeSelect
			bind:value={p.args.model}
			label=""
			options={['linear', 'exponential', 'logarithmic', 'polynomial']}
			optionsDisplay={['Linear', 'Exponential', 'Logarithmic', 'Polynomial']}
		/>
	</div>

	{#if p.args.model === 'polynomial'}
		<div class="control-input">
			<p>Degree</p>
			<NumberWithUnits bind:value={p.args.polyDegree} min={1} step={1} />
		</div>
	{/if}

	<!-- Sliding-window standardisation -->
	<div class="control-input">
		<label>
			<input type="checkbox" bind:checked={p.args.slidingWindow} />
			Sliding-window standardisation
		</label>
	</div>

	{#if p.args.slidingWindow}
		<div class="control-input">
			<p>Window size</p>
			<NumberWithUnits bind:value={p.args.windowSize} min={3} step={1} />
		</div>
	{/if}

	<!-- Trend fit stats -->
	{#if trendStats}
		<div class="info-text">
			<span class="stat-label">Trend:</span>
			{#if p.args.model === 'linear'}
				{trendStats.parameters?.slope?.toFixed(3)}·x + {trendStats.parameters?.intercept?.toFixed(3)}
			{:else if p.args.model === 'exponential'}
				{trendStats.parameters?.a?.toFixed(3)}·e^({trendStats.parameters?.b?.toFixed(3)}·x)
			{:else if p.args.model === 'logarithmic'}
				{trendStats.parameters?.a?.toFixed(3)} + {trendStats.parameters?.b?.toFixed(3)}·ln(x)
			{:else if p.args.model === 'polynomial'}
				poly deg {p.args.polyDegree}
			{/if}
			&ensp;R²={trendStats.rSquared?.toFixed(3)}&ensp;RMSE={trendStats.rmse?.toFixed(3)}
		</div>
	{/if}
</div>

<style>
	.info-text {
		font-size: 0.75rem;
		color: var(--text-secondary, #666);
		font-style: italic;
		margin-top: 0.25rem;
		word-break: break-word;
	}
	.stat-label {
		font-weight: 600;
		font-style: normal;
		margin-right: 0.25rem;
	}
</style>
