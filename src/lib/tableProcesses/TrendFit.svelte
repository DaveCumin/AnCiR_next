<script module>
	// @ts-nocheck
	import { core } from '$lib/core/core.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import { fitTrend, evaluateTrendAtPoints } from '$lib/utils/trendfit.js';

	export const trendfit_displayName = 'Fit Trend Curves';
	export const trendfit_defaults = new Map([
		['xIN', { val: -1 }],
		['yIN', { val: [] }],
		['model', { val: 'linear' }],
		['polyDegree', { val: 2 }],
		['outputX', { val: -1 }],
		['out', { trendx: { val: -1 } }],
		['valid', { val: false }]
	]);

	export function trendfit(argsIN) {
		const xIN = argsIN.xIN;
		let yINs = argsIN.yIN;
		if (!Array.isArray(yINs)) yINs = yINs != null && yINs !== -1 ? [yINs] : [];
		const model = argsIN.model;
		const polyDegree = argsIN.polyDegree;
		const outputXId = argsIN.outputX;
		const xOUT = argsIN.out.trendx;

		let result = {
			t: [],
			outputXData: null,
			y_results: {}
		};
		let anyValid = false;

		if (xIN == -1 || !getColumnById(xIN) || yINs.length === 0) return [result, false];

		const tCol = getColumnById(xIN);
		const t = tCol.type === 'time' ? tCol.hoursSinceStart : tCol.getData();

		// Get outputX data if specified
		let outputXData = null;
		if (outputXId != -1 && getColumnById(outputXId)) {
			const outputXCol = getColumnById(outputXId);
			outputXData = outputXCol.type === 'time' ? outputXCol.hoursSinceStart : outputXCol.getData();
			outputXData = outputXData.filter((v) => !isNaN(v));
		}
		result.outputXData = outputXData;

		for (const yId of yINs) {
			if (yId == null || yId === -1) continue;
			const yCol = getColumnById(yId);
			if (!yCol) continue;

			const y = yCol.getData();
			const validIndices = t
				.map((v, i) => (isNaN(v) || isNaN(y[i]) ? -1 : i))
				.filter((i) => i !== -1);
			const tt = validIndices.map((i) => t[i]);
			const yy = validIndices.map((i) => y[i]);

			if (tt.length === 0) continue;

			const fittedData = fitTrend(tt, yy, model, polyDegree);
			const predicted = outputXData
				? evaluateTrendAtPoints(fittedData.parameters, model, outputXData)
				: null;

			result.y_results[yId] = {
				fittedData,
				predicted,
				t: tt,
				xOutData: outputXData ?? tt,
				yOutData: predicted ?? fittedData.fitted
			};
			if (result.t.length === 0) result.t = tt;
			if (fittedData.fitted.length > 0) anyValid = true;
		}

		// Write output columns
		if (anyValid && xOUT !== -1) {
			const processHash = crypto.randomUUID();

			const firstYId = Object.keys(result.y_results)[0];
			const firstYResult = result.y_results[firstYId];
			const xOutData = firstYResult.xOutData ?? outputXData ?? firstYResult.t;
			const xColOut = getColumnById(xOUT);
			if (xColOut) {
				core.rawData.set(xOUT, xOutData);
				xColOut.data = xOUT;
				xColOut.type = 'number';
				xColOut.tableProcessGUId = processHash;
			}

			for (const yId of yINs) {
				const outKey = 'trendy_' + yId;
				const yOUT = argsIN.out[outKey];
				const yResult = result.y_results[yId];
				if (yOUT != null && yOUT !== -1 && yResult) {
					const yColOut = getColumnById(yOUT);
					if (yColOut) {
						core.rawData.set(yOUT, yResult.yOutData);
						yColOut.data = yOUT;
						yColOut.type = 'number';
						yColOut.tableProcessGUId = processHash;
					}
				}
			}
		}

		return [result, anyValid];
	}
</script>

<script>
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';
	import StoreValueButton from '$lib/components/inputs/StoreValueButton.svelte';

	import { Column, getColumnById, removeColumn } from '$lib/core/Column.svelte';
	import { pushObj } from '$lib/core/core.svelte.js';
	import { onMount, untrack } from 'svelte';

	let { p = $bindable() } = $props();

	// Backward compat: convert legacy single yIN to array
	if (typeof p.args.yIN === 'number') {
		p.args.yIN = p.args.yIN !== -1 ? [p.args.yIN] : [];
	}

	let trendData = $state();
	let showOutputX = $state(p.args.outputX !== -1);
	let mounted = $state(false);
	let previewStart = $state(1);

	// Track previous Y IDs to detect what changed (non-reactive)
	let prevYIds = [...(p.args.yIN ?? [])].map(Number);

	// for reactivity -----------
	let xIN_col = $derived.by(() => (p.args.xIN >= 0 ? getColumnById(p.args.xIN) : null));
	let outputX_col = $derived.by(() => (p.args.outputX >= 0 ? getColumnById(p.args.outputX) : null));
	let getHash = $derived.by(() => {
		let out = '';
		out += xIN_col?.getDataHash;
		for (const yId of p.args.yIN ?? []) {
			const col = yId >= 0 ? getColumnById(yId) : null;
			out += col?.getDataHash ?? '';
		}
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
			lastHash = getHash;
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
				const outKey = 'trendy_' + oldId;
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
			const outKey = 'trendy_' + newId;
			if (p.args.out[outKey] == null || p.args.out[outKey] === -1) {
				if (p.parent) {
					const srcName = getColumnById(newId)?.name ?? String(newId);
					const yCol = new Column({});
					yCol.name = 'trend_' + srcName + '_' + p.id;
					pushObj(yCol);
					p.parent.columnRefs = [yCol.id, ...p.parent.columnRefs];
					p.args.out[outKey] = yCol.id;
				}
			}
		}

		// Update tracking
		prevYIds = [...newIds];

		// Recompute
		getTrend();
	}

	//------------
	function getTrend() {
		previewStart = 1;
		[trendData, p.args.valid] = trendfit(p.args);
		lastHash = getHash;
	}

	// Exclude own output column IDs from the Y selector
	let yExcludeIds = $derived.by(() => {
		const ids = [p.args.xIN];
		if (p.args.out.trendx >= 0) ids.push(p.args.out.trendx);
		for (const key of Object.keys(p.args.out)) {
			if (key.startsWith('trendy_') && p.args.out[key] >= 0) {
				ids.push(p.args.out[key]);
			}
		}
		return ids;
	});

	onMount(() => {
		const xKey = p.args.out.trendx;
		if (xKey >= 0 && core.rawData.has(xKey) && core.rawData.get(xKey).length > 0) {
			const y_results = {};
			for (const yId of p.args.yIN ?? []) {
				const outKey = 'trendy_' + yId;
				const yOutId = p.args.out[outKey];
				if (yOutId >= 0 && core.rawData.has(yOutId)) {
					y_results[yId] = {
						fittedData: {
							fitted: core.rawData.get(yOutId),
							parameters: {},
							rmse: NaN,
							rSquared: NaN
						},
						predicted: null,
						t: core.rawData.get(xKey)
					};
				}
			}
			trendData = {
				t: core.rawData.get(xKey),
				outputXData: null,
				y_results
			};
			p.args.valid = true;
			lastHash = getHash;
		}
		mounted = true;
	});

	function toggleOutputX(checked) {
		if (!checked) {
			p.args.outputX = -1;
		} else {
			p.args.outputX = p.args.xIN;
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
				<ColumnSelector bind:value={p.args.outputX} excludeColIds={yExcludeIds} />
			</div>
		</div>
	{/if}
</div>

{#snippet trendStats(yResult, yName)}
	<div class="control-input-horizontal">
		<div class="control-input">
			<p>
				R²: {yResult?.fittedData?.rSquared?.toFixed(3)}
				<StoreValueButton
					label="R²"
					getter={() => yResult?.fittedData?.rSquared}
					defaultName={`trend_r2_${yName}`}
					source={'Trend Fit (' + p.args.model + ')'}
				/>
				&ensp;RMSE: {yResult?.fittedData?.rmse?.toFixed(3)}
				<StoreValueButton
					label="RMSE"
					getter={() => yResult?.fittedData?.rmse}
					defaultName={`trend_rmse_${yName}`}
					source={'Trend Fit (' + p.args.model + ')'}
				/>
			</p>
		</div>
	</div>
	<div class="control-input-horizontal">
		<div class="control-input">
			{#if p.args.model === 'linear'}
				<p>
					Slope: {yResult?.fittedData?.parameters?.slope?.toFixed(2)}
					<StoreValueButton
						label="Slope"
						getter={() => yResult?.fittedData?.parameters?.slope}
						defaultName={`trend_slope_${yName}`}
						source="Trend Fit (linear)"
					/>
				</p>
				<p>
					Intercept: {yResult?.fittedData?.parameters?.intercept?.toFixed(2)}
					<StoreValueButton
						label="Intercept"
						getter={() => yResult?.fittedData?.parameters?.intercept}
						defaultName={`trend_intercept_${yName}`}
						source="Trend Fit (linear)"
					/>
				</p>
			{:else if p.args.model === 'exponential'}
				<p>
					a: {yResult?.fittedData?.parameters?.a?.toFixed(2)}
					<StoreValueButton
						label="a"
						getter={() => yResult?.fittedData?.parameters?.a}
						defaultName={`trend_a_${yName}`}
						source="Trend Fit (exponential)"
					/>
				</p>
				<p>
					b: {yResult?.fittedData?.parameters?.b?.toFixed(2)}
					<StoreValueButton
						label="b"
						getter={() => yResult?.fittedData?.parameters?.b}
						defaultName={`trend_b_${yName}`}
						source="Trend Fit (exponential)"
					/>
				</p>
			{:else if p.args.model === 'logarithmic'}
				<p>
					a: {yResult?.fittedData?.parameters?.a?.toFixed(2)}
					<StoreValueButton
						label="a"
						getter={() => yResult?.fittedData?.parameters?.a}
						defaultName={`trend_a_${yName}`}
						source="Trend Fit (logarithmic)"
					/>
				</p>
				<p>
					b: {yResult?.fittedData?.parameters?.b?.toFixed(2)}
					<StoreValueButton
						label="b"
						getter={() => yResult?.fittedData?.parameters?.b}
						defaultName={`trend_b_${yName}`}
						source="Trend Fit (logarithmic)"
					/>
				</p>
			{:else if p.args.model === 'polynomial'}
				{#each yResult?.fittedData?.parameters?.coeffs ?? [] as c, i}
					<p>
						c{i}: {c.toFixed(2)}
						<StoreValueButton
							label={'c' + i}
							getter={() => yResult?.fittedData?.parameters?.coeffs?.[i]}
							defaultName={`trend_c${i}_${yName}`}
							source="Trend Fit (polynomial)"
						/>
					</p>
				{/each}
			{/if}
			<p>
				Equation:
				{#if p.args.model === 'linear'}
					{yResult?.fittedData?.parameters?.slope?.toFixed(2)}*x + {yResult?.fittedData?.parameters?.intercept?.toFixed(
						2
					)}
				{:else if p.args.model === 'exponential'}
					{yResult?.fittedData?.parameters?.a?.toFixed(
						2
					)}*exp({yResult?.fittedData?.parameters?.b?.toFixed(2)}*x)
				{:else if p.args.model === 'logarithmic'}
					{yResult?.fittedData?.parameters?.a?.toFixed(2)} + {yResult?.fittedData?.parameters?.b?.toFixed(
						2
					)}*ln(x)
				{:else if p.args.model === 'polynomial'}
					{yResult?.fittedData?.parameters?.coeffs
						?.map((c, i) => `${c.toFixed(2)}*x^${i}`)
						.join(' + ')}
				{/if}
			</p>
		</div>
	</div>
{/snippet}

<!-- Output Section -->
<div class="section-row">
	<div class="tableProcess-label">
		<span>Output</span>
	</div>
	<div class="section-content">
		{#if p.args.valid && p.args.out.trendx != -1}
			{@const xout = getColumnById(p.args.out.trendx)}
			<div class="tp-outputs">
				<div class="tp-output-row">
					<span class="tp-output-label">{getColumnById(p.args.xIN)?.name ?? 'x'} (shared)</span>
					<ColumnComponent col={xout} />
				</div>
				{#each p.args.yIN ?? [] as yId}
					{@const outKey = 'trendy_' + yId}
					{@const yOutId = p.args.out[outKey]}
					{#if yOutId >= 0}
						{@const yout = getColumnById(yOutId)}
						{#if yout}
							{@const yResult = trendData?.y_results?.[yId]}
							{@const srcName = getColumnById(Number(yId))?.name ?? yId}
							<div class="tp-output-row">
								<span class="tp-output-label">{srcName}</span>
								<ColumnComponent col={yout} />
								{#if yResult}
									{@render trendStats(yResult, srcName)}
								{/if}
							</div>
						{/if}
					{/if}
				{/each}
			</div>
		{:else if p.args.valid}
			<p>Preview:</p>
			{#each Object.entries(trendData?.y_results ?? {}) as [yId, yResult]}
				{@const srcName = getColumnById(Number(yId))?.name ?? yId}
				<div class="div-line"></div>
				<p><strong>{srcName}</strong></p>
				{@render trendStats(yResult, srcName)}
			{/each}
			{@const xData = trendData.outputXData ?? trendData.t}
			{@const yIds = Object.keys(trendData?.y_results ?? {})}
			{@const totalRows = xData.length}
			<Table
				headers={[
					'x',
					...yIds.map(
						(id) =>
							(trendData.outputXData ? 'predicted ' : 'fitted ') +
							(getColumnById(Number(id))?.name ?? id)
					)
				]}
				data={[
					xData.slice(previewStart - 1, previewStart + 5).map((x) => x.toFixed(2)),
					...yIds.map((id) => {
						const yr = trendData.y_results[id];
						const yData = yr.predicted ?? yr.fittedData.fitted;
						return yData.slice(previewStart - 1, previewStart + 5).map((x) => x.toFixed(2));
					})
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
	</div>
</div>

<style>
	.tp-outputs {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 0.25rem;
	}

	.tp-output-row {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		border-left: 2px solid var(--color-lightness-85);
		padding-left: 0.5rem;
	}

	.tp-output-label {
		font-size: 11px;
		color: var(--color-lightness-45, #666);
		font-style: italic;
	}
</style>
