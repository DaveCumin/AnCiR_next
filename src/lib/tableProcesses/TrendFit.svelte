<script module>
	import { core } from '$lib/core/core.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import { linearRegression } from '$lib/components/plotbits/helpers/wrangleData.js';

	export const trendfit_displayName = 'Fit Trend Curves';
	export const trendfit_defaults = new Map([
		['xIN', { val: -1 }],
		['yIN', { val: -1 }],
		['model', { val: 'linear' }],
		['polyDegree', { val: 2 }],
		['outputX', { val: -1 }],
		['out', { trendx: { val: -1 }, trendy: { val: -1 } }],
		['valid', { val: false }]
	]);

	// Helper functions for polynomial fitting
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

	function polynomialFit(x, y, degree) {
		const n = x.length;
		const A = [];
		for (let i = 0; i < n; i++) {
			const row = [];
			for (let j = 0; j <= degree; j++) {
				row.push(Math.pow(x[i], j));
			}
			A.push(row);
		}
		const AT = transpose(A);
		const ATA = multiplyMatrices(AT, A);
		const ATy = multiplyMatrices(
			AT,
			y.map((v) => [v])
		).map((r) => r[0]);
		return solveLinearSystem(ATA, ATy);
	}

	function evaluatePolynomial(coeffs, x) {
		return coeffs.reduce((sum, c, i) => sum + c * Math.pow(x, i), 0);
	}

	function computeRSquared(y, fitted) {
		const meanY = y.reduce((sum, val) => sum + val, 0) / y.length;
		const ssTot = y.reduce((sum, val) => sum + Math.pow(val - meanY, 2), 0);
		const ssRes = y.reduce((sum, val, i) => sum + Math.pow(val - fitted[i], 2), 0);
		return ssTot > 0 ? 1 - ssRes / ssTot : 0;
	}

	function fitTrend(x, y, model, polyDegree = 2) {
		let parameters, fitted, rSquared;
		if (model === 'linear') {
			const reg = linearRegression(x, y);
			parameters = { slope: reg.slope, intercept: reg.intercept };
			fitted = x.map((xi) => reg.slope * xi + reg.intercept);
			rSquared = reg.rSquared;
		} else if (model === 'exponential') {
			const logY = y.map(Math.log);
			const reg = linearRegression(x, logY);
			const a = Math.exp(reg.intercept);
			const b = reg.slope;
			parameters = { a, b };
			fitted = x.map((xi) => a * Math.exp(b * xi));
			rSquared = computeRSquared(y, fitted);
		} else if (model === 'logarithmic') {
			const logX = x.map(Math.log);
			const reg = linearRegression(logX, y);
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
			fitted.reduce((sum, fi, i) => sum + Math.pow(y[i] - fi, 2), 0) / x.length
		);
		return { parameters, fitted, rmse, rSquared };
	}

	function evaluateTrendAtPoints(parameters, model, xPoints) {
		if (model === 'linear') {
			return xPoints.map((xi) => parameters.slope * xi + parameters.intercept);
		} else if (model === 'exponential') {
			return xPoints.map((xi) => parameters.a * Math.exp(parameters.b * xi));
		} else if (model === 'logarithmic') {
			return xPoints.map((xi) => parameters.a + parameters.b * Math.log(xi));
		} else if (model === 'polynomial') {
			return xPoints.map((xi) => evaluatePolynomial(parameters.coeffs, xi));
		}
	}

	export function trendfit(argsIN) {
		const xIN = argsIN.xIN;
		const yIN = argsIN.yIN;
		const model = argsIN.model;
		const polyDegree = argsIN.polyDegree;
		const outputXId = argsIN.outputX;
		const xOUT = argsIN.out.trendx;
		const yOUT = argsIN.out.trendy;

		let result = {
			t: [],
			outputXData: null,
			fittedData: { fitted: [], parameters: {}, rmse: NaN, rSquared: NaN }
		};
		let valid = false;

		if (xIN != -1 && yIN != -1 && getColumnById(xIN) && getColumnById(yIN)) {
			const tCol = getColumnById(xIN);
			const yCol = getColumnById(yIN);

			const t = tCol.type === 'time' ? tCol.hoursSinceStart : tCol.getData();
			const y = yCol.getData();

			const validIndices = t
				.map((v, i) => (isNaN(v) || isNaN(y[i]) ? -1 : i))
				.filter((i) => i !== -1);

			const tt = validIndices.map((i) => t[i]);
			const yy = validIndices.map((i) => y[i]);

			// Get outputX data if specified
			let outputXData = null;
			if (outputXId != -1 && getColumnById(outputXId)) {
				const outputXCol = getColumnById(outputXId);
				outputXData =
					outputXCol.type === 'time' ? outputXCol.hoursSinceStart : outputXCol.getData();
				outputXData = outputXData.filter((v) => !isNaN(v));
			}

			const fittedData = fitTrend(tt, yy, model, polyDegree);

			// Evaluate fitted model at outputX points after fitting
			const predicted = outputXData
				? evaluateTrendAtPoints(fittedData.parameters, model, outputXData)
				: null;

			result = { t: tt, outputXData, fittedData, predicted };
			valid = fittedData.fitted.length > 0;

			// Only write to output columns if they exist
			if (xOUT != -1 && yOUT != -1) {
				const xColOut = getColumnById(xOUT);
				const yColOut = getColumnById(yOUT);

				if (xColOut && yColOut) {
					const xOutData = outputXData ?? tt;
					const yOutData = predicted ?? fittedData.fitted;

					core.rawData.set(xOUT, xOutData);
					xColOut.data = xOUT;
					xColOut.type = 'number';
					core.rawData.set(yOUT, yOutData);
					yColOut.data = yOUT;
					yColOut.type = 'number';

					const processHash = crypto.randomUUID();
					xColOut.tableProcessGUId = processHash;
					yColOut.tableProcessGUId = processHash;
				}
			}
		}

		return [result, valid];
	}
</script>

<script>
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';
	import StoreValueButton from '$lib/components/inputs/StoreValueButton.svelte';

	import { getColumnById } from '$lib/core/Column.svelte';
	import { onMount, untrack } from 'svelte';

	let { p = $bindable() } = $props();

	let trendData = $state();
	let showOutputX = $state(p.args.outputX !== -1);
	let mounted = $state(false);

	// for reactivity -----------
	let xIN_col = $derived.by(() => (p.args.xIN >= 0 ? getColumnById(p.args.xIN) : null));
	let yIN_col = $derived.by(() => (p.args.yIN >= 0 ? getColumnById(p.args.yIN) : null));
	let outputX_col = $derived.by(() => (p.args.outputX >= 0 ? getColumnById(p.args.outputX) : null));
	let getHash = $derived.by(() => {
		let out = '';
		out += xIN_col?.getDataHash;
		out += yIN_col?.getDataHash;
		out += outputX_col?.getDataHash;
		return out;
	});
	let lastHash = '';
	$effect(() => {
		const dataHash = getHash;
		if (!mounted) return;
		if (lastHash !== dataHash) {
			untrack(() => {
				[trendData, p.args.valid] = trendfit(p.args);
			});
			lastHash = getHash; // read after untrack so mutations to p.args.valid don't re-trigger
		}
	});
	//------------
	function getTrend() {
		[trendData, p.args.valid] = trendfit(p.args);
	}

	onMount(() => {
		//If data already exists (e.g. imported from JSON), use it instead of regenerating
		const xKey = p.args.out.trendx;
		const yKey = p.args.out.trendy;
		if (xKey >= 0 && yKey >= 0 && core.rawData.has(xKey) && core.rawData.get(xKey).length > 0) {
			trendData = {
				t: core.rawData.get(xKey),
				outputXData: null,
				fittedData: { fitted: core.rawData.get(yKey), parameters: {}, rmse: NaN, rSquared: NaN }
			};
			p.args.valid = true;
			lastHash = getHash; // prevent $effect from recalculating
		}
		mounted = true;
	});

	function toggleOutputX(checked) {
		if (!checked) {
			p.args.outputX = -1;
		} else {
			p.args.outputX = p.args.xIN; // default to input X
		}
	}
</script>

<!-- Input Section -->
<div class="section-row">
	<div class="tableProcess-label">
		<span>Input</span>
	</div>

	<div class="control-input-vertical">
		<div class="control-input">
			<p>X column</p>
			<ColumnSelector bind:value={p.args.xIN} />
		</div>

		<div class="control-input-vertical">
			<div class="control-input">
				<p>Y column</p>
				<ColumnSelector
					bind:value={p.args.yIN}
					excludeColIds={[p.args.xIN]}
				/>
			</div>
		</div>
	</div>
</div>

<!-- Process Section -->
<div class="section-row">
	<div class="tableProcess-label">
		<span>Trend parameters</span>
	</div>

	<div class="control-input-horizontal">
		<div class="control-input">
			<p>Model</p>
			<AttributeSelect
				bind:value={p.args.model}
				options={['linear', 'exponential', 'logarithmic', 'polynomial']}
				optionsDisplay={['Linear', 'Exponential', 'Logarithmic', 'Polynomial']}
				onChange={() => getTrend()}
			/>
		</div>
	</div>

	{#if p.args.model === 'polynomial'}
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>Degree</p>
				<NumberWithUnits
					bind:value={p.args.polyDegree}
					onInput={() => getTrend()}
					min="1"
					step="1"
				/>
			</div>
		</div>
	{/if}

	<div class="control-input-horizontal">
		<div class="control-input">
			<label>
				<input
					type="checkbox"
					bind:checked={showOutputX}
					onchange={(e) => toggleOutputX(e.target.checked)}
				/>
				Specify output x values
			</label>
		</div>
	</div>

	{#if showOutputX}
		<div class="control-input-vertical">
			<div class="control-input">
				<p>Output X column</p>
				<ColumnSelector
					bind:value={p.args.outputX}
					excludeColIds={[p.args.out.trendx, p.args.out.trendy]}
				/>
			</div>
		</div>
	{/if}
</div>

<!-- Output Section -->
<div class="section-row">
	<div class="tableProcess-label">
		<span>Output</span>
	</div>
	<div class="section-content">
		{#if p.args.valid && p.args.out.trendx != -1 && p.args.out.trendy != -1}
			{@const xout = getColumnById(p.args.out.trendx)}
			<ColumnComponent col={xout} />
			{@const yout = getColumnById(p.args.out.trendy)}
			<ColumnComponent col={yout} />
			<div class="control-input-horizontal">
				<div class="control-input">
					<p>
						R²: {trendData?.fittedData?.rSquared?.toFixed(3)}
						<StoreValueButton label="R²" getter={() => trendData?.fittedData?.rSquared} defaultName="trend_r_squared" source={'Trend Fit (' + p.args.model + ')'} />
						&ensp;RMSE: {trendData?.fittedData?.rmse?.toFixed(3)}
						<StoreValueButton label="RMSE" getter={() => trendData?.fittedData?.rmse} defaultName="trend_rmse" source={'Trend Fit (' + p.args.model + ')'} />
					</p>
				</div>
			</div>
			<div class="control-input-horizontal">
				<div class="control-input">
					{#if p.args.model === 'linear'}
						<p>Slope: {trendData?.fittedData?.parameters?.slope?.toFixed(2)}
							<StoreValueButton label="Slope" getter={() => trendData?.fittedData?.parameters?.slope} defaultName="trend_slope" source="Trend Fit (linear)" />
						</p>
						<p>Intercept: {trendData?.fittedData?.parameters?.intercept?.toFixed(2)}
							<StoreValueButton label="Intercept" getter={() => trendData?.fittedData?.parameters?.intercept} defaultName="trend_intercept" source="Trend Fit (linear)" />
						</p>
					{:else if p.args.model === 'exponential'}
						<p>a: {trendData?.fittedData?.parameters?.a?.toFixed(2)}
							<StoreValueButton label="a" getter={() => trendData?.fittedData?.parameters?.a} defaultName="trend_a" source="Trend Fit (exponential)" />
						</p>
						<p>b: {trendData?.fittedData?.parameters?.b?.toFixed(2)}
							<StoreValueButton label="b" getter={() => trendData?.fittedData?.parameters?.b} defaultName="trend_b" source="Trend Fit (exponential)" />
						</p>
					{:else if p.args.model === 'logarithmic'}
						<p>a: {trendData?.fittedData?.parameters?.a?.toFixed(2)}
							<StoreValueButton label="a" getter={() => trendData?.fittedData?.parameters?.a} defaultName="trend_a" source="Trend Fit (logarithmic)" />
						</p>
						<p>b: {trendData?.fittedData?.parameters?.b?.toFixed(2)}
							<StoreValueButton label="b" getter={() => trendData?.fittedData?.parameters?.b} defaultName="trend_b" source="Trend Fit (logarithmic)" />
						</p>
					{:else if p.args.model === 'polynomial'}
						{#each trendData?.fittedData?.parameters?.coeffs ?? [] as c, i}
							<p>c{i}: {c.toFixed(2)}
								<StoreValueButton label={'c' + i} getter={() => trendData?.fittedData?.parameters?.coeffs?.[i]} defaultName={'trend_c' + i} source="Trend Fit (polynomial)" />
							</p>
						{/each}
					{/if}
					<p>
						Equation:
						{#if p.args.model === 'linear'}
							{trendData?.fittedData?.parameters?.slope?.toFixed(2)}*x + {trendData?.fittedData?.parameters?.intercept?.toFixed(
								2
							)}
						{:else if p.args.model === 'exponential'}
							{trendData?.fittedData?.parameters?.a?.toFixed(
								2
							)}*exp({trendData?.fittedData?.parameters?.b?.toFixed(2)}*x)
						{:else if p.args.model === 'logarithmic'}
							{trendData?.fittedData?.parameters?.a?.toFixed(2)} + {trendData?.fittedData?.parameters?.b?.toFixed(
								2
							)}*ln(x)
						{:else if p.args.model === 'polynomial'}
							{trendData?.fittedData?.parameters?.coeffs
								?.map((c, i) => `${c.toFixed(2)}*x^${i}`)
								.join(' + ')}
						{/if}
					</p>
				</div>
			</div>
		{:else if p.args.valid}
			<p>Preview:</p>
			<div class="control-input-horizontal">
				<div class="control-input">
					<p>
						R²: {trendData?.fittedData?.rSquared?.toFixed(3)}
						<StoreValueButton label="R²" getter={() => trendData?.fittedData?.rSquared} defaultName="trend_r_squared" source={'Trend Fit (' + p.args.model + ')'} />
						&ensp;RMSE: {trendData?.fittedData?.rmse?.toFixed(3)}
						<StoreValueButton label="RMSE" getter={() => trendData?.fittedData?.rmse} defaultName="trend_rmse" source={'Trend Fit (' + p.args.model + ')'} />
					</p>
				</div>
			</div>
			<div class="control-input-horizontal">
				<div class="control-input">
					{#if p.args.model === 'linear'}
						<p>Slope: {trendData?.fittedData?.parameters?.slope?.toFixed(2)}
							<StoreValueButton label="Slope" getter={() => trendData?.fittedData?.parameters?.slope} defaultName="trend_slope" source="Trend Fit (linear)" />
						</p>
						<p>Intercept: {trendData?.fittedData?.parameters?.intercept?.toFixed(2)}
							<StoreValueButton label="Intercept" getter={() => trendData?.fittedData?.parameters?.intercept} defaultName="trend_intercept" source="Trend Fit (linear)" />
						</p>
					{:else if p.args.model === 'exponential'}
						<p>a: {trendData?.fittedData?.parameters?.a?.toFixed(2)}
							<StoreValueButton label="a" getter={() => trendData?.fittedData?.parameters?.a} defaultName="trend_a" source="Trend Fit (exponential)" />
						</p>
						<p>b: {trendData?.fittedData?.parameters?.b?.toFixed(2)}
							<StoreValueButton label="b" getter={() => trendData?.fittedData?.parameters?.b} defaultName="trend_b" source="Trend Fit (exponential)" />
						</p>
					{:else if p.args.model === 'logarithmic'}
						<p>a: {trendData?.fittedData?.parameters?.a?.toFixed(2)}
							<StoreValueButton label="a" getter={() => trendData?.fittedData?.parameters?.a} defaultName="trend_a" source="Trend Fit (logarithmic)" />
						</p>
						<p>b: {trendData?.fittedData?.parameters?.b?.toFixed(2)}
							<StoreValueButton label="b" getter={() => trendData?.fittedData?.parameters?.b} defaultName="trend_b" source="Trend Fit (logarithmic)" />
						</p>
					{:else if p.args.model === 'polynomial'}
						{#each trendData?.fittedData?.parameters?.coeffs ?? [] as c, i}
							<p>c{i}: {c.toFixed(2)}
								<StoreValueButton label={'c' + i} getter={() => trendData?.fittedData?.parameters?.coeffs?.[i]} defaultName={'trend_c' + i} source="Trend Fit (polynomial)" />
							</p>
						{/each}
					{/if}
					<p>
						Equation:
						{#if p.args.model === 'linear'}
							{trendData?.fittedData?.parameters?.slope?.toFixed(2)}*x + {trendData?.fittedData?.parameters?.intercept?.toFixed(
								2
							)}
						{:else if p.args.model === 'exponential'}
							{trendData?.fittedData?.parameters?.a?.toFixed(
								2
							)}*exp({trendData?.fittedData?.parameters?.b?.toFixed(2)}*x)
						{:else if p.args.model === 'logarithmic'}
							{trendData?.fittedData?.parameters?.a?.toFixed(2)} + {trendData?.fittedData?.parameters?.b?.toFixed(
								2
							)}*ln(x)
						{:else if p.args.model === 'polynomial'}
							{trendData?.fittedData?.parameters?.coeffs
								?.map((c, i) => `${c.toFixed(2)}*x^${i}`)
								.join(' + ')}
						{/if}
					</p>
				</div>
			</div>
			<div style="height:250px; overflow:auto;">
				<Table
					headers={['x', trendData.outputXData ? 'predicted y' : 'fitted y']}
					data={[
						(trendData.outputXData ?? trendData.t).map((x) => x.toFixed(2)),
						(trendData.predicted ?? trendData.fittedData.fitted).map((x) => x.toFixed(2))
					]}
				/>
			</div>
		{:else}
			<p>Need to have valid inputs to create columns.</p>
		{/if}
	</div>
</div>
