<script module>
	import { line } from 'd3-shape';
	import ColourPicker, { getPaletteColor } from '$lib/components/inputs/ColourPicker.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import { isValidStroke } from '$lib/components/plotBits/helpers/misc.js';

	// Smoother implementations
	function whittakerEilers(y, lambda = 100, order = 2) {
		const n = y.length;
		if (n < 3) return y;

		// Create difference matrix D
		const D = [];
		for (let i = 0; i < n - order; i++) {
			const row = new Array(n).fill(0);
			for (let j = 0; j <= order; j++) {
				row[i + j] = Math.pow(-1, j) * binomial(order, j);
			}
			D.push(row);
		}

		// Create weight matrix W (identity for now, could be modified for weighted version)
		const W = Array(n).fill(1);

		// Solve (W + λD'D)z = Wy
		const DTD = multiplyMatrices(transpose(D), D);
		const A = addMatrices(diagonalMatrix(W), scalarMultiply(DTD, lambda));
		const b = y.map((val, i) => W[i] * val);

		return solveLinearSystem(A, b);
	}

	function savitzkyGolay(y, windowSize = 5, polyOrder = 2) {
		if (windowSize % 2 === 0) windowSize += 1; // Ensure odd window size
		const halfWindow = Math.floor(windowSize / 2);
		const result = [...y];

		// Pre-compute Savitzky-Golay coefficients
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

	function loess(x, y, bandwidth = 0.3, iterations = 2) {
		const n = x.length;
		const result = new Array(n);
		const h = Math.max(Math.floor(bandwidth * n), 1);

		for (let i = 0; i < n; i++) {
			const xi = x[i];

			// Find the h nearest neighbors
			const distances = x.map((xj, j) => ({ dist: Math.abs(xi - xj), index: j }));
			distances.sort((a, b) => a.dist - b.dist);
			const neighbors = distances.slice(0, h);

			// Calculate tricube weights
			const maxDist = neighbors[neighbors.length - 1].dist;
			const weights = neighbors.map((n) => tricubeWeight(n.dist / maxDist));

			// Perform weighted linear regression
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

			// Solve for slope and intercept
			const denom = sumW * sumWXX - sumWX * sumWX;
			if (Math.abs(denom) < 1e-10) {
				result[i] = sumWY / sumW; // Use weighted mean if singular
			} else {
				const slope = (sumW * sumWXY - sumWX * sumWY) / denom;
				const intercept = (sumWY - slope * sumWX) / sumW;
				result[i] = slope * xi + intercept;
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
		// Simple Gaussian elimination with partial pivoting
		const n = A.length;
		const augmented = A.map((row, i) => [...row, b[i]]);

		// Forward elimination
		for (let i = 0; i < n; i++) {
			// Find pivot
			let maxRow = i;
			for (let k = i + 1; k < n; k++) {
				if (Math.abs(augmented[k][i]) > Math.abs(augmented[maxRow][i])) {
					maxRow = k;
				}
			}
			[augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];

			// Make all rows below this one 0 in current column
			for (let k = i + 1; k < n; k++) {
				const factor = augmented[k][i] / augmented[i][i];
				for (let j = i; j <= n; j++) {
					augmented[k][j] -= factor * augmented[i][j];
				}
			}
		}

		// Back substitution
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

		// Build Vandermonde matrix
		for (let i = -halfWindow; i <= halfWindow; i++) {
			const row = [];
			for (let j = 0; j <= polyOrder; j++) {
				row.push(Math.pow(i, j));
			}
			A.push(row);
		}

		// Compute pseudo-inverse and extract first row (for smoothing)
		const AT = transpose(A);
		const ATA = multiplyMatrices(AT, A);
		const ATAinv = invertMatrix(ATA);
		const pinv = multiplyMatrices(ATAinv, AT);

		return pinv[0]; // First row gives smoothing coefficients
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

		// Gaussian elimination
		for (let i = 0; i < n; i++) {
			// Find pivot
			let maxRow = i;
			for (let k = i + 1; k < n; k++) {
				if (Math.abs(augmented[k][i]) > Math.abs(augmented[maxRow][i])) {
					maxRow = k;
				}
			}
			[augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];

			// Scale pivot row
			const pivot = augmented[i][i];
			for (let j = 0; j < 2 * n; j++) {
				augmented[i][j] /= pivot;
			}

			// Eliminate column
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

	export class LineClass {
		colour = $state(getPaletteColor(0));
		strokeWidth = $state(3);
		stroke = $state('solid');
		draw = $state(true);

		// Smoother properties
		showSmoother = $state(false);
		smootherType = $state('whittaker');
		smootherColour = $state(getPaletteColor(1));
		smootherStrokeWidth = $state(2);
		smootherStroke = $state('solid');

		// Smoother parameters
		whittakerLambda = $state(100);
		whittakerOrder = $state(2);
		savitzkyWindowSize = $state(5);
		savitzkyPolyOrder = $state(2);
		loessBandwidth = $state(0.3);

		constructor(dataIN, parent) {
			this.parentData = parent;
			this.colour =
				dataIN?.colour ?? getPaletteColor(parent.parentPlot.data.length) ?? getPaletteColor(0);
			this.strokeWidth = dataIN?.strokeWidth ?? 3;
			this.stroke = dataIN?.stroke ?? 'solid';
			this.draw = dataIN?.draw ?? true;

			// Initialize smoother properties
			this.showSmoother = dataIN?.showSmoother ?? false;
			this.smootherType = dataIN?.smootherType ?? 'whittaker';
			this.smootherColour = dataIN?.smootherColour ?? getPaletteColor(1);
			this.smootherStrokeWidth = dataIN?.smootherStrokeWidth ?? 2;
			this.smootherStroke = dataIN?.smootherStroke ?? 'solid';
			this.whittakerLambda = dataIN?.whittakerLambda ?? 100;
			this.whittakerOrder = dataIN?.whittakerOrder ?? 2;
			this.savitzkyWindowSize = dataIN?.savitzkyWindowSize ?? 5;
			this.savitzkyPolyOrder = dataIN?.savitzkyPolyOrder ?? 2;
			this.loessBandwidth = dataIN?.loessBandwidth ?? 0.3;
		}

		toJSON() {
			return {
				colour: this.colour,
				strokeWidth: this.strokeWidth,
				stroke: this.stroke,
				draw: this.draw,
				showSmoother: this.showSmoother,
				smootherType: this.smootherType,
				smootherColour: this.smootherColour,
				smootherStrokeWidth: this.smootherStrokeWidth,
				smootherStroke: this.smootherStroke,
				whittakerLambda: this.whittakerLambda,
				whittakerOrder: this.whittakerOrder,
				savitzkyWindowSize: this.savitzkyWindowSize,
				savitzkyPolyOrder: this.savitzkyPolyOrder,
				loessBandwidth: this.loessBandwidth
			};
		}

		static fromJSON(json) {
			return new LineClass({
				colour: json.colour,
				strokeWidth: json.strokeWidth,
				stroke: json.stroke,
				draw: json.draw,
				showSmoother: json.showSmoother,
				smootherType: json.smootherType,
				smootherColour: json.smootherColour,
				smootherStrokeWidth: json.smootherStrokeWidth,
				smootherStroke: json.smootherStroke,
				whittakerLambda: json.whittakerLambda,
				whittakerOrder: json.whittakerOrder,
				savitzkyWindowSize: json.savitzkyWindowSize,
				savitzkyPolyOrder: json.savitzkyPolyOrder,
				loessBandwidth: json.loessBandwidth
			});
		}
	}
</script>

<script>
	let {
		lineData = $bindable(),
		x,
		y,
		xscale,
		yscale,
		yoffset = 0,
		xoffset = 0,
		which,
		title = 'Line'
	} = $props();
	let width = $derived(xscale.range()[1]);
	let height = $derived(yscale.range()[0]);
	let clipKey = $derived(`line-${xoffset}-${yoffset}-${width}-${height}`);

	let theline = $derived.by(() => {
		if (!lineData?.draw || !x || !y) return null;

		//filter out the NaNs and data outside the plot limits
		const xlims = xscale.domain();
		const [minX, maxX] = [Math.min(...xlims), Math.max(...xlims)];
		const ylims = yscale.domain();
		const [minY, maxY] = [Math.min(...ylims), Math.max(...ylims)];

		const filteredData = x
			.map((xVal, i) => ({ x: xVal, y: y[i] }))
			.filter(
				(d) =>
					d.x >= minX && d.x <= maxX && d.y != null && d.x != null && !isNaN(d.y) && !isNaN(d.x)
			);

		//No Line if only 1 or fewer points
		if (filteredData.length < 2) return null;

		const lineGenerator = line()
			.x((d) => xscale(d.x))
			.y((d) => yscale(d.y));

		return lineGenerator(filteredData);
	});

	let smoothedLine = $derived.by(() => {
		if (!lineData?.showSmoother || !x || !y || !theline) return null;

		// Get filtered data similar to main line
		const xlims = xscale.domain();
		const [minX, maxX] = [Math.min(...xlims), Math.max(...xlims)];

		const filteredData = x
			.map((xVal, i) => ({ x: xVal, y: y[i] }))
			.filter(
				(d) =>
					d.x >= minX && d.x <= maxX && d.y != null && d.x != null && !isNaN(d.y) && !isNaN(d.x)
			);

		if (filteredData.length < 3) return null;

		// Sort by x values for smoothing
		filteredData.sort((a, b) => a.x - b.x);
		const xVals = filteredData.map((d) => d.x);
		const yVals = filteredData.map((d) => d.y);

		let smoothedY;
		try {
			switch (lineData.smootherType) {
				case 'whittaker':
					smoothedY = whittakerEilers(yVals, lineData.whittakerLambda, lineData.whittakerOrder);
					break;
				case 'savitzky':
					smoothedY = savitzkyGolay(yVals, lineData.savitzkyWindowSize, lineData.savitzkyPolyOrder);
					break;
				case 'loess':
					smoothedY = loess(xVals, yVals, lineData.loessBandwidth);
					break;
				default:
					return null;
			}
		} catch (error) {
			console.warn('Smoothing failed:', error);
			return null;
		}

		const smoothedData = xVals.map((x, i) => ({ x, y: smoothedY[i] }));

		const lineGenerator = line()
			.x((d) => xscale(d.x))
			.y((d) => yscale(d.y));

		return lineGenerator(smoothedData);
	});
</script>

{#snippet controls(lineData)}
	<div class="control-component">
		<div class="control-component-title">
			<p>{title}</p>
			<button
				class="icon"
				onclick={(e) => {
					e.stopPropagation();
					lineData.draw = !lineData.draw;
				}}
			>
				{#if !lineData.draw}
					<Icon name="eye-slash" width={16} height={16} />
				{:else}
					<Icon name="eye" width={16} height={16} className="visible" />
				{/if}
			</button>
		</div>
		<div class="control-input-horizontal">
			<div class="control-input" style="max-width: 1.5rem;">
				<p style="color:{'white'};">Col</p>
				<ColourPicker bind:value={lineData.colour} />
			</div>
			<div class="control-input">
				<p>Width</p>
				<NumberWithUnits step="0.2" min={0.1} bind:value={lineData.strokeWidth} />
			</div>
			<div class="control-input">
				<p>Stroke</p>
				<div style="border: {lineData.stroke === -1 ? '1' : '0'}px solid red;">
					<AttributeSelect
						onChange={(value) => {
							if (isValidStroke(value)) {
								lineData.stroke = value;
							} else {
								lineData.stroke = -1;
							}
						}}
						options={['solid', '5, 5', '2, 2', '5, 2']}
						optionsDisplay={['Solid', 'Dashed', 'Dotted', 'Dashed & Dotted']}
						other={true}
						placeholder={'eg 5, 5'}
					/>
				</div>
			</div>
		</div>

		<!-- Smoother Controls -->
		<div class="control-component-title" style="margin-top: 1rem;">
			<p>Smoother</p>
			<button
				class="icon"
				onclick={(e) => {
					e.stopPropagation();
					lineData.showSmoother = !lineData.showSmoother;
				}}
			>
				{#if !lineData.showSmoother}
					<Icon name="eye-slash" width={16} height={16} />
				{:else}
					<Icon name="eye" width={16} height={16} className="visible" />
				{/if}
			</button>
		</div>

		{#if lineData.showSmoother}
			<div class="control-input-horizontal">
				<div class="control-input">
					<p>Type</p>
					<AttributeSelect
						bind:value={lineData.smootherType}
						options={['whittaker', 'savitzky', 'loess']}
						optionsDisplay={['Whittaker-Eilers', 'Savitzky-Golay', 'LOESS']}
					/>
				</div>
				<div class="control-input" style="max-width: 1.5rem;">
					<p style="color:{'white'};">Col</p>
					<ColourPicker bind:value={lineData.smootherColour} />
				</div>
				<div class="control-input">
					<p>Width</p>
					<NumberWithUnits step="0.2" min={0.1} bind:value={lineData.smootherStrokeWidth} />
				</div>
			</div>

			<!-- Type-specific parameters -->
			{#if lineData.smootherType === 'whittaker'}
				<div class="control-input-horizontal">
					<div class="control-input">
						<p>Lambda (Smoothing)</p>
						<NumberWithUnits step="10" min={1} max={10000} bind:value={lineData.whittakerLambda} />
					</div>
					<div class="control-input">
						<p>Order</p>
						<NumberWithUnits step="1" min={1} max={4} bind:value={lineData.whittakerOrder} />
					</div>
				</div>
			{:else if lineData.smootherType === 'savitzky'}
				<div class="control-input-horizontal">
					<div class="control-input">
						<p>Window Size</p>
						<NumberWithUnits step="2" min={3} max={21} bind:value={lineData.savitzkyWindowSize} />
					</div>
					<div class="control-input">
						<p>Poly Order</p>
						<NumberWithUnits step="1" min={1} max={6} bind:value={lineData.savitzkyPolyOrder} />
					</div>
				</div>
			{:else if lineData.smootherType === 'loess'}
				<div class="control-input-horizontal">
					<div class="control-input">
						<p>Bandwidth</p>
						<NumberWithUnits step="0.1" min={0.1} max={1.0} bind:value={lineData.loessBandwidth} />
					</div>
				</div>
			{/if}
		{/if}
	</div>
{/snippet}

{#snippet plot(lineData)}
	{#if theline && lineData?.draw}
		<clipPath id={clipKey}>
			<rect x={xoffset} y={yoffset} {width} {height} />
		</clipPath>
		<g clip-path="url(#{clipKey})">
			<!-- Original line -->
			<path
				d={theline}
				fill="none"
				stroke={lineData.colour}
				stroke-width={lineData.strokeWidth}
				style="transform: translate({xoffset}px, {yoffset}px); stroke-dasharray: {lineData.stroke};"
			/>
			<!-- Smoothed line -->
			{#if smoothedLine && lineData.showSmoother}
				<path
					d={smoothedLine}
					fill="none"
					stroke={lineData.smootherColour}
					stroke-width={lineData.smootherStrokeWidth}
					style="transform: translate({xoffset}px, {yoffset}px); stroke-dasharray: {lineData.smootherStroke};"
				/>
			{/if}
		</g>
	{/if}
{/snippet}

{#if which === 'plot'}
	{@render plot(lineData)}
{:else if which === 'controls'}
	{@render controls(lineData)}
{/if}
