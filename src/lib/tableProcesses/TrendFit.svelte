<script module>
	// @ts-nocheck
	import { core } from '$lib/core/core.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import { fitTrend, evaluateTrendAtPoints } from '$lib/utils/trendfit.js';

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

	export function trendfit(argsIN) {
		const xIN = argsIN.xIN;
		const yIN = argsIN.yIN;
		const model = argsIN.model;
		const polyDegree = argsIN.polyDegree;
		const outputXId = argsIN.outputX;
		const xOUT = argsIN.out.trendx;
		const yOUT = argsIN.out.trendy;

		/** @type {{ t: number[], outputXData: number[]|null, fittedData: { fitted: number[], parameters: object, rmse: number, rSquared: number }, predicted: number[]|null }} */
		let result = {
			t: [],
			outputXData: null,
			fittedData: { fitted: /** @type {number[]} */ ([]), parameters: {}, rmse: NaN, rSquared: NaN },
			predicted: null
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
	let previewStart = $state(1);

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
				previewStart = 1;
				[trendData, p.args.valid] = trendfit(p.args);
			});
			lastHash = getHash; // read after untrack so mutations to p.args.valid don't re-trigger
		}
	});
	//------------
	function getTrend() {
		previewStart = 1;
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
			{@const xData = trendData.outputXData ?? trendData.t}
			{@const yData = trendData.predicted ?? trendData.fittedData.fitted}
			{@const totalRows = xData.length}
			<Table
				headers={['x', trendData.outputXData ? 'predicted y' : 'fitted y']}
				data={[
					xData.slice(previewStart - 1, previewStart + 5).map((x) => x.toFixed(2)),
					yData.slice(previewStart - 1, previewStart + 5).map((x) => x.toFixed(2))
				]}
			/>
			<p>Row <NumberWithUnits min={1} max={Math.max(1, totalRows - 5)} step={1} bind:value={previewStart} /> to {Math.min(previewStart + 5, totalRows)} of {totalRows}</p>
		{:else}
			<p>Need to have valid inputs to create columns.</p>
		{/if}
	</div>
</div>
