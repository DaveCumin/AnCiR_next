<script module>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';

	export const smootheddata_defaults = new Map([
		['xIN', { val: -1 }],
		['yIN', { val: -1 }],
		['smootherType', { val: 'moving' }],
		['whittakerLambda', { val: 100 }],
		['whittakerOrder', { val: 2 }],
		['savitzkyWindowSize', { val: 5 }],
		['savitzkyPolyOrder', { val: 2 }],
		['loessBandwidth', { val: 0.3 }],
		['movingAvgWindowSize', { val: 5 }],
		['movingAvgType', { val: 'simple' }],
		['out', { smoothedx: { val: -1 }, smoothedy: { val: -1 } }],
		['valid', { val: false }]
	]);

	// Smoother implementations
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
				if (!isNaN(y[j])) {
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
		const yIN = argsIN.yIN;
		const smootherType = argsIN.smootherType;
		const xOUT = argsIN.out.smoothedx;
		const yOUT = argsIN.out.smoothedy;

		if (xIN == undefined || yIN == undefined || xIN == -1 || yIN == -1) {
			return [{ x_out: [], y_out: [] }, false];
		}

		console.log('xIN:, yIN: ', xIN, yIN);
		console.log('xIN COL: ', $state.snapshot(getColumnById(xIN)));
		console.log('xIN DATA: ', $state.snapshot(getColumnById(xIN).getData()));
		const xData =
			getColumnById(xIN).type == 'time'
				? getColumnById(xIN).hoursSinceStart
				: getColumnById(xIN).getData();
		const yData = getColumnById(yIN).getData();

		console.log('xData: ', xData);

		// Filter out invalid data
		const filteredData = xData
			.map((x, i) => ({ x, y: yData[i] }))
			.filter((d) => d.x != null && d.y != null && !isNaN(d.x) && !isNaN(d.y));

		if (filteredData.length < 3) {
			return [{ x_out: [], y_out: [] }, false];
		}

		// Sort by x values
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
					return [{ x_out: [], y_out: [] }, false];
			}
		} catch (error) {
			console.warn('Smoothing failed:', error);
			return [{ x_out: [], y_out: [] }, false];
		}

		const result = { x_out: xVals, y_out: smoothedY };

		if (xOUT != -1 && yOUT != -1) {
			getColumnById(xOUT).data = result.x_out;
			getColumnById(xOUT).type = 'number';
			getColumnById(yOUT).data = result.y_out;
			getColumnById(yOUT).type = 'number';
			const processHash = crypto.randomUUID();
			getColumnById(xOUT).tableProcessGUId = processHash;
			getColumnById(yOUT).tableProcessGUId = processHash;
		}

		console.log('smootheddata result: ', result);
		return [result, result.x_out.length > 0];
	}
</script>

<script>
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';
	import { onMount } from 'svelte';

	let { p = $bindable() } = $props();

	let smoothedResult = $state();

	// Reactivity
	let xIN_col = $derived.by(() => (p.args.xIN >= 0 ? getColumnById(p.args.xIN) : null));
	let yIN_col = $derived.by(() => (p.args.yIN >= 0 ? getColumnById(p.args.yIN) : null));
	let getHash = $derived.by(() => {
		let out = '';
		out += xIN_col?.getDataHash;
		out += yIN_col?.getDataHash;
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
		if (lastHash === dataHash) {
			// do nothing
		} else {
			[smoothedResult, p.args.valid] = smootheddata(p.args);
			lastHash = getHash;
		}
	});

	function getSmoothedData() {
		[smoothedResult, p.args.valid] = smootheddata(p.args);
	}

	onMount(() => {
		getSmoothedData();
	});
</script>

Smooth: <br />
x = <ColumnSelector bind:value={p.args.xIN} onChange={(e) => getSmoothedData()} /> <br />
y = <ColumnSelector
	bind:value={p.args.yIN}
	excludeColIds={[p.args.xIN]}
	onChange={(e) => getSmoothedData()}
/><br />

<div class="control-input-horizontal">
	<div class="control-input">
		<p>Type</p>
		<AttributeSelect
			bind:value={p.args.smootherType}
			options={['moving', 'whittaker', 'savitzky', 'loess']}
			optionsDisplay={['Moving Average', 'Whittaker-Eilers', 'Savitzky-Golay', 'LOESS']}
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
				step="0.1"
				min={0.1}
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

<p>Output:</p>
{#key smoothedResult}
	{#if p.args.valid && p.args.out.smoothedx != -1 && p.args.out.smoothedy != -1}
		{@const xout = getColumnById(p.args.out.smoothedx)}
		<ColumnComponent col={xout} />
		{@const yout = getColumnById(p.args.out.smoothedy)}
		<ColumnComponent col={yout} />
	{:else if p.args.valid}
		<p>Preview:</p>
		<div style="height:250px; overflow:auto;">
			<Table
				headers={['smoothed x', 'smoothed y']}
				data={[
					smoothedResult.x_out.map((x) => x.toFixed(2)),
					smoothedResult.y_out.map((x) => x.toFixed(2))
				]}
			/>
		</div>
	{:else}
		<p>Need to have valid inputs to create columns.</p>
	{/if}
{/key}
