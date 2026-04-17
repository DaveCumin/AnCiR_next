<script module>
	import { core, appConsts } from '$lib/core/core.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	export const smootheddata_displayName = 'Smooth Data';
	export const smootheddata_defaults = new Map([
		['xIN', { val: -1 }],
		['yIN', { val: [] }],
		['smootherType', { val: 'moving' }],
		['whittakerLambda', { val: 100 }],
		['whittakerOrder', { val: 2 }],
		['savitzkyWindowSize', { val: 5 }],
		['savitzkyPolyOrder', { val: 2 }],
		['loessBandwidth', { val: 0.3 }],
		['movingAvgWindowSize', { val: 5 }],
		['movingAvgType', { val: 'simple' }],
		['out', { smoothedx: { val: -1 } }],
		['valid', { val: false }],
		['forcollected', { val: true }],
	['collectedType', { val: 'smooth' }],
	['preProcesses', { val: [] }],
	['tableProcesses', { val: [] }]
]);

export const smootheddata_xOutKey = 'smoothedx';
export const smootheddata_yOutKeyPrefix = 'smoothedy_';
	function whittakerEilers(y, lambda = 100, order = 2) {
		const n = y.length;
		if (n < 3) return y;

		const D = [];
		for (let i = 0; i < n - order; i++) {
			const row = new Array(n).fill(0);
			for (let j = 0; j <= order; j++) {
				row[i + j] = Math.pow(-1, j) * binomial(order, j);
			}
			D.push(row);
		}

		const W = Array(n).fill(1);
		const DTD = multiplyMatrices(transpose(D), D);
		const A = addMatrices(diagonalMatrix(W), scalarMultiply(DTD, lambda));
		const b = y.map((val, i) => W[i] * val);

		return solveLinearSystem(A, b);
	}

	function savitzkyGolay(y, windowSize = 5, polyOrder = 2) {
		if (windowSize % 2 === 0) windowSize += 1;
		const halfWindow = Math.floor(windowSize / 2);
		const result = [...y];

		const coeffs = getSavitzkyGolayCoeffs(windowSize, polyOrder);

		for (let i = halfWindow; i < y.length - halfWindow; i++) {
			let sum = 0;
			for (let j = -halfWindow; j <= halfWindow; j++) {
				sum += coeffs[j + halfWindow] * y[i + j];
			}
			result[i] = sum;
		}

		return result;
	}

	function loess(x, y, bandwidth = 0.3) {
		const n = x.length;
		const result = new Array(n);
		const h = Math.max(Math.floor(bandwidth * n), 1);

		for (let i = 0; i < n; i++) {
			const xi = x[i];

			const distances = x.map((xj, j) => ({ dist: Math.abs(xi - xj), index: j }));
			distances.sort((a, b) => a.dist - b.dist);
			const neighbors = distances.slice(0, h);

			const maxDist = neighbors[neighbors.length - 1].dist;
			const weights = neighbors.map((n) => tricubeWeight(n.dist / maxDist));

			let sumW = 0,
				sumWX = 0,
				sumWY = 0,
				sumWXX = 0,
				sumWXY = 0;

			for (let j = 0; j < neighbors.length; j++) {
				const idx = neighbors[j].index;
				const w = weights[j];
				const xj = x[idx];
				const yj = y[idx];

				sumW += w;
				sumWX += w * xj;
				sumWY += w * yj;
				sumWXX += w * xj * xj;
				sumWXY += w * xj * yj;
			}

			const denom = sumW * sumWXX - sumWX * sumWX;
			if (Math.abs(denom) < 1e-10) {
				result[i] = sumWY / sumW;
			} else {
				const slope = (sumW * sumWXY - sumWX * sumWY) / denom;
				const intercept = (sumWY - slope * sumWX) / sumW;
				result[i] = slope * xi + intercept;
			}
		}

		return result;
	}

	function movingAverage(y, windowSize = 5, type = 'simple') {
		const result = [...y];
		const halfWindow = Math.floor(windowSize / 2);

		for (let i = 0; i < y.length; i++) {
			let sum = 0;
			let count = 0;
			let weightSum = 0;

			const start = Math.max(0, i - halfWindow);
			const end = Math.min(y.length - 1, i + halfWindow);

			for (let j = start; j <= end; j++) {
				if (y[j] != null && !isNaN(y[j])) {
					if (type === 'simple') {
						sum += y[j];
						count++;
					} else if (type === 'weighted') {
						const distance = Math.abs(i - j);
						const weight = Math.max(0, windowSize - distance);
						sum += y[j] * weight;
						weightSum += weight;
					} else if (type === 'exponential') {
						const distance = Math.abs(i - j);
						const weight = Math.exp(-distance / (windowSize / 3));
						sum += y[j] * weight;
						weightSum += weight;
					}
				}
			}

			if (type === 'simple') {
				result[i] = count > 0 ? sum / count : y[i];
			} else {
				result[i] = weightSum > 0 ? sum / weightSum : y[i];
			}
		}

		return result;
	}

	// Helper functions
	function binomial(n, k) {
		if (k > n) return 0;
		if (k === 0 || k === n) return 1;
		let result = 1;
		for (let i = 0; i < k; i++) {
			result = (result * (n - i)) / (i + 1);
		}
		return result;
	}

	function multiplyMatrices(A, B) {
		const rows = A.length;
		const cols = B[0].length;
		const common = B.length;
		const result = Array(rows)
			.fill()
			.map(() => Array(cols).fill(0));

		for (let i = 0; i < rows; i++) {
			for (let j = 0; j < cols; j++) {
				for (let k = 0; k < common; k++) {
					result[i][j] += A[i][k] * B[k][j];
				}
			}
		}
		return result;
	}

	function transpose(matrix) {
		return matrix[0].map((_, colIndex) => matrix.map((row) => row[colIndex]));
	}

	function addMatrices(A, B) {
		return A.map((row, i) => row.map((val, j) => val + B[i][j]));
	}

	function diagonalMatrix(diagonal) {
		const n = diagonal.length;
		const result = Array(n)
			.fill()
			.map(() => Array(n).fill(0));
		for (let i = 0; i < n; i++) {
			result[i][i] = diagonal[i];
		}
		return result;
	}

	function scalarMultiply(matrix, scalar) {
		return matrix.map((row) => row.map((val) => val * scalar));
	}

	function solveLinearSystem(A, b) {
		const n = A.length;
		const augmented = A.map((row, i) => [...row, b[i]]);

		for (let i = 0; i < n; i++) {
			let maxRow = i;
			for (let k = i + 1; k < n; k++) {
				if (Math.abs(augmented[k][i]) > Math.abs(augmented[maxRow][i])) {
					maxRow = k;
				}
			}
			[augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];

			for (let k = i + 1; k < n; k++) {
				const factor = augmented[k][i] / augmented[i][i];
				for (let j = i; j <= n; j++) {
					augmented[k][j] -= factor * augmented[i][j];
				}
			}
		}

		const result = new Array(n);
		for (let i = n - 1; i >= 0; i--) {
			result[i] = augmented[i][n];
			for (let j = i + 1; j < n; j++) {
				result[i] -= augmented[i][j] * result[j];
			}
			result[i] /= augmented[i][i];
		}

		return result;
	}

	function getSavitzkyGolayCoeffs(windowSize, polyOrder) {
		const halfWindow = Math.floor(windowSize / 2);
		const A = [];

		for (let i = -halfWindow; i <= halfWindow; i++) {
			const row = [];
			for (let j = 0; j <= polyOrder; j++) {
				row.push(Math.pow(i, j));
			}
			A.push(row);
		}

		const AT = transpose(A);
		const ATA = multiplyMatrices(AT, A);
		const ATAinv = invertMatrix(ATA);
		const pinv = multiplyMatrices(ATAinv, AT);

		return pinv[0];
	}

	function invertMatrix(matrix) {
		const n = matrix.length;
		const identity = Array(n)
			.fill()
			.map((_, i) =>
				Array(n)
					.fill(0)
					.map((_, j) => (i === j ? 1 : 0))
			);
		const augmented = matrix.map((row, i) => [...row, ...identity[i]]);

		for (let i = 0; i < n; i++) {
			let maxRow = i;
			for (let k = i + 1; k < n; k++) {
				if (Math.abs(augmented[k][i]) > Math.abs(augmented[maxRow][i])) {
					maxRow = k;
				}
			}
			[augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];

			const pivot = augmented[i][i];
			for (let j = 0; j < 2 * n; j++) {
				augmented[i][j] /= pivot;
			}

			for (let k = 0; k < n; k++) {
				if (k !== i) {
					const factor = augmented[k][i];
					for (let j = 0; j < 2 * n; j++) {
						augmented[k][j] -= factor * augmented[i][j];
					}
				}
			}
		}

		return augmented.map((row) => row.slice(n));
	}

	function tricubeWeight(u) {
		if (u >= 1) return 0;
		return Math.pow(1 - Math.pow(u, 3), 3);
	}

	export function smootheddata(argsIN) {
		const xIN = argsIN.xIN;
		// Backward compat: accept single number or array
		let yINs = argsIN.yIN;
		if (!Array.isArray(yINs)) yINs = yINs != null && yINs !== -1 ? [yINs] : [];
		const smootherType = argsIN.smootherType;
		const xOUT = argsIN.out.smoothedx;

		if (xIN == undefined || xIN == -1 || yINs.length === 0) {
			return [{ x_out: [], y_results: {} }, false];
		}

		const xInCol = getColumnById(xIN);
		if (!xInCol) return [{ x_out: [], y_results: {} }, false];

		const xData = xInCol.type === 'time' ? xInCol.hoursSinceStart : xInCol.getData();
		const isTimeInput = xInCol.type === 'time';
		const originTime_ms = isTimeInput ? xInCol.getData()[0] : null;

		const result = { x_out: [], y_results: {}, originTime_ms };
		let anyValid = false;

		for (const yId of yINs) {
			if (yId == null || yId === -1) continue;
			const yCol = getColumnById(yId);
			if (!yCol) continue;
			const yData = yCol.getData();

			const filteredData = xData
				.map((x, i) => ({ x, y: yData[i] }))
				.filter((d) => d.x != null && d.y != null && !isNaN(d.x) && !isNaN(d.y));

			if (filteredData.length < 3) continue;

			filteredData.sort((a, b) => a.x - b.x);
			const xVals = filteredData.map((d) => d.x);
			const yVals = filteredData.map((d) => d.y);

			let smoothedY;
			try {
				switch (smootherType) {
					case 'whittaker':
						smoothedY = whittakerEilers(yVals, argsIN.whittakerLambda, argsIN.whittakerOrder);
						break;
					case 'savitzky':
						smoothedY = savitzkyGolay(yVals, argsIN.savitzkyWindowSize, argsIN.savitzkyPolyOrder);
						break;
					case 'loess':
						smoothedY = loess(xVals, yVals, argsIN.loessBandwidth);
						break;
					case 'moving':
						smoothedY = movingAverage(yVals, argsIN.movingAvgWindowSize, argsIN.movingAvgType);
						break;
					default:
						continue;
				}
			} catch (error) {
				console.warn('Smoothing failed for column', yId, ':', error);
				continue;
			}

			// Use first valid Y's x values as the shared x output
			if (result.x_out.length === 0) result.x_out = xVals;
			result.y_results[yId] = smoothedY;
			anyValid = true;
		}

		// Apply pre-processes to y results before writing
		for (const pp of argsIN.preProcesses ?? []) {
			if (!pp.processName) continue;
			const proc = appConsts.processMap.get(pp.processName);
			if (proc?.func) {
				for (const yId of yINs) {
					if (result.y_results[yId]) {
						result.y_results[yId] = proc.func(result.y_results[yId], pp.processArgs ?? {});
					}
				}
			}
		}

		if (anyValid && xOUT != -1) {
			const processHash = crypto.randomUUID();
			const xOutValues = isTimeInput
				? result.x_out.map((h) => originTime_ms + h * 3600000)
				: result.x_out;

			core.rawData.set(xOUT, xOutValues);
			getColumnById(xOUT).data = xOUT;
			getColumnById(xOUT).type = isTimeInput ? 'time' : 'number';
			if (isTimeInput) getColumnById(xOUT).timeFormat = null;
			getColumnById(xOUT).tableProcessGUId = processHash;

			for (const yId of yINs) {
				const outKey = 'smoothedy_' + yId;
				const yOUT = argsIN.out[outKey];
				if (yOUT != null && yOUT !== -1 && result.y_results[yId]) {
					core.rawData.set(yOUT, result.y_results[yId]);
					getColumnById(yOUT).data = yOUT;
					getColumnById(yOUT).type = 'number';
					getColumnById(yOUT).tableProcessGUId = processHash;
				}
			}
		}

		return [result, anyValid];
	}
</script>

<script>
	// @ts-nocheck
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';
	import { Column, getColumnById, removeColumn } from '$lib/core/Column.svelte';
	import { pushObj } from '$lib/core/core.svelte.js';
	import { onMount, untrack } from 'svelte';
	import { formatTimeFromUNIX } from '$lib/utils/time/TimeUtils.js';

	let { p = $bindable(), hideInputs = false } = $props();

	// Backward compat: convert legacy single yIN to array
	if (typeof p.args.yIN === 'number') {
		p.args.yIN = p.args.yIN !== -1 ? [p.args.yIN] : [];
	}

	let smoothedResult = $state();
	let mounted = $state(false);
	let previewStart = $state(1);

	// Track previous Y IDs to detect what changed (non-reactive)
	let prevYIds = [...(p.args.yIN ?? [])].map(Number);

	// Reactivity
	let xIN_col = $derived.by(() => (p.args.xIN >= 0 ? getColumnById(p.args.xIN) : null));
	let xIsTime = $derived(xIN_col?.type === 'time');

	// Build a hash that tracks input data + all selected Y columns + smoother params
	let getHash = $derived.by(() => {
		let out = '';
		out += xIN_col?.getDataHash;
		for (const yId of p.args.yIN ?? []) {
			const col = yId >= 0 ? getColumnById(yId) : null;
			out += col?.getDataHash ?? '';
		}
		out += p.args.smootherType;
		out += p.args.whittakerLambda;
		out += p.args.whittakerOrder;
		out += p.args.savitzkyWindowSize;
		out += p.args.savitzkyPolyOrder;
		out += p.args.loessBandwidth;
		out += p.args.movingAvgWindowSize;
		out += p.args.movingAvgType;
		return out;
	});
	let lastHash = '';

	$effect(() => {
		const dataHash = getHash;
		if (!mounted) return;
		if (dataHash !== lastHash) {
			untrack(() => {
				previewStart = 1;
				[smoothedResult, p.args.valid] = smootheddata(p.args);
			});
			lastHash = dataHash;
		}
	});

	// Called when Y selection changes in the multi-select.
	// bind:value has already updated p.args.yIN, so we compare against prevYIds.
	function onYSelectionChange() {
		const newIds = (p.args.yIN ?? []).map(Number).filter((id) => id >= 0);
		const newSet = new Set(newIds);
		const oldSet = new Set(prevYIds);

		// Skip if no actual change
		if (newIds.length === prevYIds.length && newIds.every((id) => oldSet.has(id))) return;

		// Remove output columns for deselected Y inputs
		for (const oldId of prevYIds) {
			if (!newSet.has(oldId)) {
				const outKey = 'smoothedy_' + oldId;
				const outColId = p.args.out[outKey];
				if (outColId != null && outColId >= 0) {
					core.rawData.delete(outColId);
					removeColumn(outColId);
				}
				delete p.args.out[outKey];
			}
		}

		// Create output columns for newly selected Y inputs
		for (const newId of newIds) {
			const outKey = 'smoothedy_' + newId;
			if (p.args.out[outKey] == null || p.args.out[outKey] === -1) {
				if (p.parent) {
					const srcName = getColumnById(newId)?.name ?? String(newId);
					const yCol = new Column({});
					yCol.name = 'smooth_' + srcName;
					pushObj(yCol);
					p.parent.columnRefs = [yCol.id, ...p.parent.columnRefs];
					p.args.out[outKey] = yCol.id;
				}
			}
		}

		// Update tracking
		prevYIds = [...newIds];

		// Recompute
		getSmoothedData();
	}

	function getSmoothedData() {
		previewStart = 1;
		[smoothedResult, p.args.valid] = smootheddata(p.args);
		lastHash = getHash;
	}

	// Exclude own output column IDs from the Y selector
	let yExcludeIds = $derived.by(() => {
		if (hideInputs) return [];
		const ids = [p.args.xIN];
		if (p.args.out.smoothedx >= 0) ids.push(p.args.out.smoothedx);
		for (const key of Object.keys(p.args.out)) {
			if (key.startsWith('smoothedy_') && p.args.out[key] >= 0) {
				ids.push(p.args.out[key]);
			}
		}
		return ids;
	});

	// Reconcile output columns when yIN changes externally (e.g. from parent in collected mode)
	$effect(() => {
		const _yIN = p.args.yIN;
		if (!mounted) return;
		untrack(() => onYSelectionChange());
	});

	onMount(() => {
		if (!p.args.out) p.args.out = {};
		// Ensure X output column exists
		if ((p.args.out.smoothedx == null || p.args.out.smoothedx < 0) && p.parent) {
			const xCol = new Column({});
			xCol.name = 'smoothedx_' + p.id;
			pushObj(xCol);
			p.parent.columnRefs = [xCol.id, ...p.parent.columnRefs];
			p.args.out.smoothedx = xCol.id;
		}
		// Create output columns for any Y inputs that don't have them yet
		// (e.g. when the process was created programmatically with yIN pre-set)
		let needsCompute = false;
		for (const yId of p.args.yIN ?? []) {
			const outKey = 'smoothedy_' + yId;
			if (p.args.out[outKey] == null || p.args.out[outKey] === -1) {
				if (p.parent) {
					const srcName = getColumnById(Number(yId))?.name ?? String(yId);
					const yCol = new Column({});
					yCol.name = 'smooth_' + srcName;
					pushObj(yCol);
					p.parent.columnRefs = [yCol.id, ...p.parent.columnRefs];
					p.args.out[outKey] = yCol.id;
					needsCompute = true;
				}
			}
		}
		prevYIds = [...(p.args.yIN ?? [])].map(Number);

		if (needsCompute) {
			getSmoothedData();
		} else {
			const xKey = p.args.out.smoothedx;
			if (xKey >= 0 && core.rawData.has(xKey) && core.rawData.get(xKey).length > 0) {
				const y_results = {};
				for (const yId of p.args.yIN ?? []) {
					const outKey = 'smoothedy_' + yId;
					const yOutId = p.args.out[outKey];
					if (yOutId >= 0 && core.rawData.has(yOutId)) {
						y_results[yId] = core.rawData.get(yOutId);
					}
				}
				smoothedResult = { x_out: core.rawData.get(xKey), y_results };
				p.args.valid = true;
				lastHash = getHash;
			}
		}
		mounted = true;
	});
</script>

<!-- Input Section -->
{#if !hideInputs}
	<div class="section-row">
		<div class="tableProcess-label">
			<span>Input</span>
		</div>

		<div class="control-input-vertical">
			<div class="control-input">
				<p>X column</p>
				<ColumnSelector bind:value={p.args.xIN} onChange={(e) => getSmoothedData()} /> <br />
			</div>
			<div class="control-input-vertical">
				<div class="control-input">
					<p>Y columns</p>
					<ColumnSelector
						bind:value={p.args.yIN}
						excludeColIds={yExcludeIds}
						multiple={true}
						onChange={onYSelectionChange}
					/>
				</div>
			</div>
		</div>
	</div>
{/if}

<div class="section-row">
	<div class="tableProcess-label">
		<span>Smooth parameters</span>
	</div>

	<div class="control-input-horizontal">
		<div class="control-input">
			<p>Type</p>
			<AttributeSelect
				bind:value={p.args.smootherType}
				options={['moving', 'savitzky', 'loess']}
				optionsDisplay={['Moving Average', 'Savitzky-Golay', 'LOESS']}
				onChange={() => getSmoothedData()}
			/>
		</div>
	</div>

	<!-- Type-specific parameters -->
	{#if p.args.smootherType === 'whittaker'}
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>Lambda (Smoothing)</p>
				<NumberWithUnits
					step="10"
					min={1}
					max={10000}
					bind:value={p.args.whittakerLambda}
					onInput={() => getSmoothedData()}
				/>
			</div>
			<div class="control-input">
				<p>Order</p>
				<NumberWithUnits
					step="1"
					min={1}
					max={4}
					bind:value={p.args.whittakerOrder}
					onInput={() => getSmoothedData()}
				/>
			</div>
		</div>
	{:else if p.args.smootherType === 'savitzky'}
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>Window Size</p>
				<NumberWithUnits
					step="2"
					min={3}
					max={21}
					bind:value={p.args.savitzkyWindowSize}
					onInput={() => getSmoothedData()}
				/>
			</div>
			<div class="control-input">
				<p>Poly Order</p>
				<NumberWithUnits
					step="1"
					min={1}
					max={6}
					bind:value={p.args.savitzkyPolyOrder}
					onInput={() => getSmoothedData()}
				/>
			</div>
		</div>
	{:else if p.args.smootherType === 'loess'}
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>Bandwidth</p>
				<NumberWithUnits
					step="0.01"
					min={0.01}
					max={1.0}
					bind:value={p.args.loessBandwidth}
					onInput={() => getSmoothedData()}
				/>
			</div>
		</div>
	{:else if p.args.smootherType === 'moving'}
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>Window Size</p>
				<NumberWithUnits
					step="1"
					min={3}
					max={51}
					bind:value={p.args.movingAvgWindowSize}
					onInput={() => getSmoothedData()}
				/>
			</div>
			<div class="control-input">
				<p>Type</p>
				<AttributeSelect
					bind:value={p.args.movingAvgType}
					options={['simple', 'weighted', 'exponential']}
					optionsDisplay={['Simple', 'Weighted', 'Exponential']}
					onChange={() => getSmoothedData()}
				/>
			</div>
		</div>
	{/if}
</div>

{#key smoothedResult}
	{#if p.args.valid && p.args.out.smoothedx != -1}
		{@const xout = getColumnById(p.args.out.smoothedx)}
		<div class="section-row">
			<div class="tableProcess-label">
				<span>Output</span>
			</div>
			<div class="tp-outputs">
				<div class="tp-output-row">
					<span class="tp-output-label">{getColumnById(p.args.xIN)?.name ?? 'x'} (shared)</span>
					<ColumnComponent col={xout} />
				</div>
				{#each p.args.yIN ?? [] as yId}
					{@const outKey = 'smoothedy_' + yId}
					{@const yOutId = p.args.out[outKey]}
					{#if yOutId >= 0}
						{@const yout = getColumnById(yOutId)}
						{#if yout}
							<div class="tp-output-row">
								<span class="tp-output-label">{getColumnById(Number(yId))?.name ?? yId}</span>
								<ColumnComponent col={yout} />
							</div>
						{/if}
					{/if}
				{/each}
			</div>
		</div>
	{:else if p.args.valid}
		{@const totalRows = smoothedResult.x_out.length}
		{@const xSlice = smoothedResult.x_out.slice(previewStart - 1, previewStart + 5)}
		{@const yIds = Object.keys(smoothedResult.y_results)}
		<p>Preview:</p>
		<Table
			headers={[
				'smoothed x',
				...yIds.map((id) => 'smoothed y (' + (getColumnById(Number(id))?.name ?? id) + ')')
			]}
			data={[
				xIsTime
					? xSlice.map((v) => ({
							isTime: true,
							raw: formatTimeFromUNIX(smoothedResult.originTime_ms + v * 3600000),
							computed: v.toFixed(2)
						}))
					: xSlice.map((x) => x.toFixed(2)),
				...yIds.map((id) =>
					smoothedResult.y_results[id]
						.slice(previewStart - 1, previewStart + 5)
						.map((x) => x.toFixed(2))
				)
			]}
		/>
		<p>
			Row <NumberWithUnits
				min={1}
				max={Math.max(1, totalRows - 5)}
				step={1}
				bind:value={previewStart}
			/> to {Math.min(previewStart + 5, totalRows)} of {totalRows}
		</p>
	{:else}
		<p>Need to have valid inputs to create columns.</p>
	{/if}
{/key}

