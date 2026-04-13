<script module>
	import { core } from '$lib/core/core.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import { fitDoubleLogistic, evaluateDoubleLogisticAtPoints } from '$lib/utils/doublelogistic.js';

	export const doublelogistic_displayName = 'Double Logistic';

	export const doublelogistic_defaults = new Map([
		['xIN', { val: -1 }],
		['yIN', { val: [] }],
		['outputX', { val: -1 }],
		['fixK1', { val: false }],
		['fixedK1', { val: 0.5 }],
		['fixK2', { val: false }],
		['fixedK2', { val: 0.5 }],
		['fixPeriod', { val: false }],
		['fixedPeriod', { val: 24 }],
		['out', { dlogx: { val: -1 } }],
		['valid', { val: false }]
	]);

	export function doublelogistic(argsIN) {
		const xIN = argsIN.xIN;
		const yINraw = argsIN.yIN;
		const yINs = Array.isArray(yINraw) ? yINraw : yINraw != null && yINraw !== -1 ? [yINraw] : [];
		const outputXId = argsIN.outputX;
		const fixK1 = argsIN.fixK1 ?? false;
		const fixedK1 = argsIN.fixedK1 ?? 0.5;
		const fixK2 = argsIN.fixK2 ?? false;
		const fixedK2 = argsIN.fixedK2 ?? 0.5;
		const fixPeriod = argsIN.fixPeriod ?? false;
		const fixedPeriod = argsIN.fixedPeriod ?? 24;

		if (xIN == -1 || !getColumnById(xIN) || yINs.length === 0) return [null, false];

		const tCol = getColumnById(xIN);
		const t = tCol.type === 'time' ? tCol.hoursSinceStart : tCol.getData();

		// Output X data
		let outputXData = null;
		if (outputXId != -1 && getColumnById(outputXId)) {
			const outputXCol = getColumnById(outputXId);
			outputXData = outputXCol.type === 'time' ? outputXCol.hoursSinceStart : outputXCol.getData();
			outputXData = outputXData.filter((v) => !isNaN(v));
		}

		// Origin time for datetime display
		let originTime_ms = null;
		if (outputXId != -1) {
			const col = getColumnById(outputXId);
			if (col?.type === 'time') originTime_ms = col.getData()[0];
		}
		if (originTime_ms == null && tCol.type === 'time') {
			originTime_ms = tCol.getData()[0];
		}

		const y_results = {};
		let sharedT = null;

		for (const yId of yINs) {
			const yCol = getColumnById(yId);
			if (!yCol) continue;

			const y = yCol.getData();
			const validIndices = t
				.map((v, i) => (isNaN(v) || isNaN(y[i]) ? -1 : i))
				.filter((i) => i !== -1);
			const tt = validIndices.map((i) => t[i]);
			const yy = validIndices.map((i) => y[i]);

			if (tt.length < 4) continue;
			if (!sharedT) sharedT = tt;

			const fitResult = fitDoubleLogistic(tt, yy, {
				periodic: true,
				fixK1,
				fixK2,
				fixPeriod,
				fixedK1,
				fixedK2,
				fixedPeriod
			});

			if (fitResult) {
				const xOutData = outputXData ?? tt;
				const yOutData = outputXData
					? evaluateDoubleLogisticAtPoints(fitResult.parameters, true, outputXData)
					: fitResult.fitted;

				y_results[yId] = { fitResult, fitted: yOutData, t: tt, xOutData, yOutData };
			}
		}

		if (Object.keys(y_results).length === 0) return [null, false];

		// Write shared X output
		const finalXData = outputXData ?? sharedT;
		const xOUT = argsIN.out.dlogx;
		if (xOUT != -1) {
			const xColOut = getColumnById(xOUT);
			if (xColOut) {
				const xOutMs =
					originTime_ms != null ? finalXData.map((h) => originTime_ms + h * 3600000) : finalXData;
				core.rawData.set(xOUT, xOutMs);
				xColOut.data = xOUT;
				xColOut.type = originTime_ms != null ? 'time' : 'number';
				if (originTime_ms != null) xColOut.timeFormat = null;
				const processHash = crypto.randomUUID();
				xColOut.tableProcessGUId = processHash;

				// Write per-Y outputs
				for (const yId of Object.keys(y_results)) {
					const outKey = 'dlogy_' + yId;
					const yOutId = argsIN.out[outKey];
					if (yOutId >= 0) {
						const yColOut = getColumnById(yOutId);
						if (yColOut) {
							core.rawData.set(yOutId, y_results[yId].yOutData);
							yColOut.data = yOutId;
							yColOut.type = 'number';
							yColOut.tableProcessGUId = processHash;
						}
					}
				}
			}
		}

		return [{ t: sharedT, outputXData, y_results, originTime_ms }, true];
	}
</script>

<script>
	// @ts-nocheck
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';
	import StoreValueButton from '$lib/components/inputs/StoreValueButton.svelte';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';

	import { Column, getColumnById, removeColumn } from '$lib/core/Column.svelte';
	import { pushObj } from '$lib/core/core.svelte.js';
	import { formatTimeFromUNIX } from '$lib/utils/time/TimeUtils.js';
	import { onMount, untrack } from 'svelte';

	let { p = $bindable() } = $props();

	// Backwards compatibility: convert single yIN to array
	if (typeof p.args.yIN === 'number') {
		p.args.yIN = p.args.yIN === -1 ? [] : [p.args.yIN];
	}
	// Migrate old single dlogy key to per-Y key
	if (p.args.out.dlogy != null) {
		const oldY = p.args.out.dlogy;
		delete p.args.out.dlogy;
		if (oldY >= 0 && p.args.yIN.length === 1) {
			p.args.out['dlogy_' + p.args.yIN[0]] = oldY;
		}
	}

	if (p.args.fixK1 === undefined) p.args.fixK1 = false;
	if (p.args.fixedK1 === undefined) p.args.fixedK1 = 0.5;
	if (p.args.fixK2 === undefined) p.args.fixK2 = false;
	if (p.args.fixedK2 === undefined) p.args.fixedK2 = 0.5;
	if (p.args.fixPeriod === undefined) p.args.fixPeriod = false;
	if (p.args.fixedPeriod === undefined) p.args.fixedPeriod = 24;

	let dlData = $state(null);
	let showOutputX = $state(p.args.outputX !== -1);
	let mounted = $state(false);
	let previewStart = $state(1);
	let calculating = $state(false);
	let _calcToken = 0;

	// Track previous Y IDs to detect what changed (non-reactive)
	let prevYIds = [...(p.args.yIN ?? [])].map(Number);

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
				const outKey = 'dlogy_' + oldId;
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
			const outKey = 'dlogy_' + newId;
			if (p.args.out[outKey] == null || p.args.out[outKey] === -1) {
				if (p.parent) {
					const srcName = getColumnById(newId)?.name ?? String(newId);
					const yCol = new Column({});
					yCol.name = 'dlog_' + srcName + '_' + p.id;
					pushObj(yCol);
					p.parent.columnRefs = [yCol.id, ...p.parent.columnRefs];
					p.args.out[outKey] = yCol.id;
				}
			}
		}

		// Update tracking
		prevYIds = [...newIds];

		// Recompute
		getFit();
	}

	let yExcludeIds = $derived.by(() => {
		const ids = [p.args.xIN, p.args.out.dlogx];
		for (const yId of p.args.yIN ?? []) {
			const outKey = 'dlogy_' + yId;
			if (p.args.out[outKey] >= 0) ids.push(p.args.out[outKey]);
		}
		return ids.filter((id) => id >= 0);
	});

	let xIN_col = $derived.by(() => (p.args.xIN >= 0 ? getColumnById(p.args.xIN) : null));
	let outputX_col = $derived.by(() => (p.args.outputX >= 0 ? getColumnById(p.args.outputX) : null));
	let xIsTime = $derived(xIN_col?.type === 'time' || outputX_col?.type === 'time');

	let getHash = $derived.by(() => {
		let out = '';
		out += xIN_col?.getDataHash;
		for (const yId of p.args.yIN ?? []) {
			const yCol = getColumnById(yId);
			out += yCol?.getDataHash;
		}
		out += outputX_col?.getDataHash;
		out += p.args.fixK1;
		out += p.args.fixK2;
		out += p.args.fixPeriod;
		return out;
	});
	let lastHash = '';

	$effect(() => {
		const dataHash = getHash;
		if (!mounted) return;
		if (lastHash !== dataHash) {
			lastHash = getHash;
			calculating = true;
			const token = ++_calcToken;
			setTimeout(() => {
				if (token !== _calcToken) return;
				untrack(() => {
					previewStart = 1;
					[dlData, p.args.valid] = doublelogistic(p.args);
					calculating = false;
				});
			}, 0);
		}
	});

	function getFit() {
		previewStart = 1;
		calculating = true;
		const token = ++_calcToken;
		setTimeout(() => {
			if (token !== _calcToken) return;
			[dlData, p.args.valid] = doublelogistic(p.args);
			calculating = false;
			lastHash = getHash;
		}, 0);
	}

	onMount(() => {
		const xKey = p.args.out.dlogx;
		if (xKey >= 0 && core.rawData.has(xKey) && core.rawData.get(xKey).length > 0) {
			const y_results = {};
			for (const yId of p.args.yIN ?? []) {
				const outKey = 'dlogy_' + yId;
				const yOutId = p.args.out[outKey];
				if (yOutId >= 0 && core.rawData.has(yOutId)) {
					y_results[yId] = {
						fitResult: null,
						fitted: core.rawData.get(yOutId),
						t: core.rawData.get(xKey),
						xOutData: core.rawData.get(xKey),
						yOutData: core.rawData.get(yOutId)
					};
				}
			}
			if (Object.keys(y_results).length > 0) {
				dlData = { t: core.rawData.get(xKey), outputXData: null, y_results, originTime_ms: null };
				p.args.valid = true;
			}
		}
		lastHash = getHash;
		mounted = true;
	});

	function toggleOutputX(checked) {
		p.args.outputX = checked ? p.args.xIN : -1;
	}

	/** Safe toFixed — returns '—' for null/undefined/NaN/Infinity */
	function fmt(val, decimals = 3) {
		if (val == null || !isFinite(val)) return '—';
		return val.toFixed(decimals);
	}
</script>

<!-- Input -->
<div class="section-row">
	<div class="tableProcess-label">
		<span>Input</span>
	</div>
	<div class="control-input-vertical">
		<div class="control-input">
			<p>X column</p>
			<ColumnSelector bind:value={p.args.xIN} />
		</div>
		<div class="control-input">
			<p>Y column(s)</p>
			<ColumnSelector bind:value={p.args.yIN} excludeColIds={yExcludeIds} multiple={true} onChange={onYSelectionChange} />
		</div>
	</div>
</div>

<!-- Options -->
<div class="section-row">
	<div class="tableProcess-label">
		<span>Model parameters</span>
	</div>

	<!-- Period -->
	<div class="control-input-horizontal">
		<div class="control-input-checkbox">
			<input type="checkbox" bind:checked={p.args.fixPeriod} onchange={getFit} />
			<p>Fix period</p>
		</div>
	</div>
	{#if p.args.fixPeriod}
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>Period</p>
				<NumberWithUnits
					bind:value={p.args.fixedPeriod}
					min="0.1"
					step="0.5"
					units={{ default: 'hrs', days: 24, hrs: 1, mins: 1 / 60, secs: 1 / (60 * 60) }}
					onInput={getFit}
				/>
			</div>
		</div>
	{/if}

	<!-- Rise rate (k1) -->
	<div class="control-input-horizontal">
		<div class="control-input-checkbox">
			<input type="checkbox" bind:checked={p.args.fixK1} onchange={getFit} />
			<p>Fix rise rate (k1)</p>
		</div>
	</div>
	{#if p.args.fixK1}
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>k1 (1/hr)</p>
				<NumberWithUnits bind:value={p.args.fixedK1} min="0.001" step="0.05" onInput={getFit} />
			</div>
		</div>
	{/if}

	<!-- Fall rate (k2) -->
	<div class="control-input-horizontal">
		<div class="control-input-checkbox">
			<input type="checkbox" bind:checked={p.args.fixK2} onchange={getFit} />
			<p>Fix fall rate (k2)</p>
		</div>
	</div>
	{#if p.args.fixK2}
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>k2 (1/hr)</p>
				<NumberWithUnits bind:value={p.args.fixedK2} min="0.001" step="0.05" onInput={getFit} />
			</div>
		</div>
	{/if}

	<!-- Output X -->
	<div class="control-input-horizontal">
		<div class="control-input-checkbox">
			<input
				type="checkbox"
				bind:checked={showOutputX}
				onchange={(e) => toggleOutputX(e.target.checked)}
			/>
			<p>Specify output x values</p>
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

{#snippet dlogStats(yResult, yName)}
	{#if yResult?.fitResult}
		{@const fr = yResult.fitResult}
		{@const p_ = fr.parameters}
		<div class="control-input-horizontal">
			<div class="control-input">
				<p>
					Period: {fmt(p_.T)} hrs
					<StoreValueButton
						label="Period"
						getter={() => yResult?.fitResult?.parameters?.T}
						defaultName={`dlog_period_${yName}`}
						source="Double Logistic"
					/>
				</p>
				<p>
					Onset phase: {fmt(fr.onsetPhase)} hrs
					<StoreValueButton
						label="Onset phase"
						getter={() => yResult?.fitResult?.onsetPhase}
						defaultName={`dlog_onset_${yName}`}
						source="Double Logistic"
					/>
				</p>
				<p>
					Offset phase: {fmt(fr.offsetPhase)} hrs
					<StoreValueButton
						label="Offset phase"
						getter={() => yResult?.fitResult?.offsetPhase}
						defaultName={`dlog_offset_${yName}`}
						source="Double Logistic"
					/>
				</p>
				<p>
					Duty cycle: {fmt(fr.dutyCycle != null ? fr.dutyCycle * 100 : null, 1)}%
					<StoreValueButton
						label="Duty cycle"
						getter={() => yResult?.fitResult?.dutyCycle}
						defaultName={`dlog_dutycycle_${yName}`}
						source="Double Logistic"
					/>
				</p>
				<p>
					Rise rate (k1): {fmt(p_.k1, 4)} /hr
					<StoreValueButton
						label="Rise rate"
						getter={() => yResult?.fitResult?.parameters?.k1}
						defaultName={`dlog_k1_${yName}`}
						source="Double Logistic"
					/>
				</p>
				<p>
					Fall rate (k2): {fmt(p_.k2, 4)} /hr
					<StoreValueButton
						label="Fall rate"
						getter={() => yResult?.fitResult?.parameters?.k2}
						defaultName={`dlog_k2_${yName}`}
						source="Double Logistic"
					/>
				</p>
				<p>
					Amplitude (A): {fmt(p_.A)}
					<StoreValueButton
						label="Amplitude"
						getter={() => yResult?.fitResult?.parameters?.A}
						defaultName={`dlog_amplitude_${yName}`}
						source="Double Logistic"
					/>
				</p>
				<p>
					Mesor (M): {fmt(p_.M)}
					<StoreValueButton
						label="Mesor"
						getter={() => yResult?.fitResult?.parameters?.M}
						defaultName={`dlog_mesor_${yName}`}
						source="Double Logistic"
					/>
				</p>
				<p>
					RMSE: {fmt(fr.rmse)}
					<StoreValueButton
						label="RMSE"
						getter={() => yResult?.fitResult?.rmse}
						defaultName={`dlog_rmse_${yName}`}
						source="Double Logistic"
					/>
				</p>
				<p>
					R²: {fmt(fr.rSquared)}
					<StoreValueButton
						label="R²"
						getter={() => yResult?.fitResult?.rSquared}
						defaultName={`dlog_r2_${yName}`}
						source="Double Logistic"
					/>
				</p>
			</div>
		</div>
	{/if}
{/snippet}

<!-- Output -->
<div class="section-row">
	<div class="tableProcess-label">
		<span>Output</span>
	</div>
	<div class="section-content">
		{#if calculating}
			<LoadingSpinner message="Fitting double logistic…" />
		{:else if p.args.valid && p.args.out.dlogx != -1}
			{@const xout = getColumnById(p.args.out.dlogx)}
			<div class="tp-outputs">
				<div class="tp-output-row">
					<span class="tp-output-label">{getColumnById(p.args.xIN)?.name ?? 'x'} (shared)</span>
					<ColumnComponent col={xout} />
				</div>
				{#each p.args.yIN ?? [] as yId}
					{@const outKey = 'dlogy_' + yId}
					{@const yOutId = p.args.out[outKey]}
					{#if yOutId >= 0}
						{@const yout = getColumnById(yOutId)}
						{#if yout}
							{@const yResult = dlData?.y_results?.[yId]}
							{@const srcName = getColumnById(Number(yId))?.name ?? yId}
							<div class="tp-output-row">
								<span class="tp-output-label">{srcName}</span>
								<ColumnComponent col={yout} />
								{#if yResult}
									{@render dlogStats(yResult, srcName)}
								{/if}
							</div>
						{/if}
					{/if}
				{/each}
			</div>
		{:else if p.args.valid}
			<p>Preview:</p>
			{#each Object.entries(dlData?.y_results ?? {}) as [yId, yResult]}
				{@const srcName = getColumnById(Number(yId))?.name ?? yId}
				<div class="div-line"></div>
				<p><strong>{srcName}</strong></p>
				{@render dlogStats(yResult, srcName)}
			{/each}
			{@const xData = dlData.outputXData ?? dlData.t}
			{@const yIds = Object.keys(dlData?.y_results ?? {})}
			{@const totalRows = xData.length}
			<Table
				headers={[
					'x',
					...yIds.map(
						(id) =>
							(dlData.outputXData ? 'predicted ' : 'fitted ') +
							(getColumnById(Number(id))?.name ?? id)
					)
				]}
				data={[
					xData.slice(previewStart - 1, previewStart + 5).map((x) =>
						xIsTime && dlData.originTime_ms != null
							? {
									isTime: true,
									raw: formatTimeFromUNIX(dlData.originTime_ms + x * 3600000),
									computed: fmt(x, 2)
								}
							: fmt(x, 2)
					),
					...yIds.map((id) => {
						const yr = dlData.y_results[id];
						return yr.fitted.slice(previewStart - 1, previewStart + 5).map((y) => fmt(y, 2));
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
			<p>Need valid inputs to fit a double logistic.</p>
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
