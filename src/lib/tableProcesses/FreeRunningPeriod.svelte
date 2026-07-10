<script module>
	// @ts-nocheck
	// Free-Running Period — auto-estimate each series' dominant circadian period
	// (tau) from the peak of a chi-squared (Sokolove-Bushell) periodogram. Exposes
	// period / power / pvalue as scalar-metric output ports (one value per Y input,
	// in yIN order) so tau wires straight into Compare groups / a boxplot, the same
	// "stored values as ports" pattern as Cosinor / Nonparametric RA.
	//
	// Scope note: this is the periodogram-tau estimator. An onset-regression tau
	// (slope of daily activity-onset times) is a separate node gated on an
	// onset/offset detector and is intentionally out of scope here.
	import {
		normalizeYInputs,
		migrateLegacyYIN,
		fillDefaults
	} from '$lib/tableProcesses/tpArgHelpers.js';
	import { writeOutputColumn } from '$lib/tableProcesses/outputColumns.js';
	import { estimateFreeRunningPeriod } from '$lib/utils/freeRunningPeriod.js';

	const displayName = 'Free-Running Period';

	const defaults = new Map([
		['xIN', { val: -1 }],
		['yIN', { val: [] }],
		['pMin', { val: 20 }],
		['pMax', { val: 28 }],
		['step', { val: 0.1 }],
		['method', { val: 'Chi-squared' }],
		['binSize', { val: 1 }],
		['alpha', { val: 0.05 }],
		['out', { period: { val: -1 }, power: { val: -1 }, pvalue: { val: -1 } }],
		['valid', { val: false }],
		['preProcesses', { val: [] }],
		['tableProcesses', { val: [] }]
	]);

	// Scalar-metric out keys (fixed — never change with params/selection).
	export const METRIC_KEYS = ['period', 'power', 'pvalue'];

	export const definition = {
		displayName,
		defaults,
		func: freerunningperiod,
		columnIdFields: { scalar: ['xIN'], array: ['yIN'] },
		nodeSpec: {
			id: 'tableprocess.freerunningperiod',
			inputs: [
				{ name: 'xIN', kind: 'column', cardinality: 'one' },
				{ name: 'yIN', kind: 'column', cardinality: 'many' }
			],
			outputs: [
				// One value per y input, in yIN order.
				{ name: 'period', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'power', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'pvalue', kind: 'column', cardinality: 'one', metric: true }
			]
		}
	};

	function optsFrom(argsIN) {
		return {
			pMin: argsIN.pMin ?? 20,
			pMax: argsIN.pMax ?? 28,
			step: argsIN.step ?? 0.1,
			method: argsIN.method ?? 'Chi-squared',
			binSize: argsIN.binSize ?? 1,
			alpha: argsIN.alpha ?? 0.05
		};
	}

	// Estimate tau per Y. Returns { perY: { [yId]: {period,power,pValue} }, yINs, anyValid }.
	// getColumnById resolves at runtime from the instance <script> import (same as
	// Cosinor / RhythmicityAnalysis).
	export function evaluateFreeRunningPeriod(argsIN) {
		const xIN = argsIN.xIN;
		const yINs = normalizeYInputs(argsIN.yIN);
		const perY = {};

		if (xIN == null || xIN === -1 || !getColumnById(xIN) || yINs.length === 0) {
			return { perY, yINs, anyValid: false };
		}

		const tCol = getColumnById(xIN);
		const tAll = tCol.type === 'time' ? tCol.hoursSinceStart : tCol.getData();
		const opts = optsFrom(argsIN);

		let anyValid = false;
		for (const yId of yINs) {
			if (yId == null || yId === -1) continue;
			const yCol = getColumnById(yId);
			if (!yCol) continue;
			const yData = yCol.getData();

			const tt = [];
			const yy = [];
			for (let i = 0; i < tAll.length; i++) {
				const ti = tAll[i];
				const yi = yData[i];
				if (ti == null || yi == null || isNaN(ti) || isNaN(yi)) continue;
				tt.push(ti);
				yy.push(yi);
			}
			if (tt.length < 3) continue;

			const res = estimateFreeRunningPeriod(tt, yy, opts);
			perY[yId] = res;
			if (Number.isFinite(res.period)) anyValid = true;
		}
		return { perY, yINs, anyValid };
	}

	function writeOutputs(argsIN, result) {
		const { perY, yINs } = result;
		const processHash = crypto.randomUUID();
		const pick = (yId, key) => perY[yId]?.[key] ?? NaN;
		writeOutputColumn(
			argsIN.out?.period,
			yINs.map((y) => pick(y, 'period')),
			{ processHash }
		);
		writeOutputColumn(
			argsIN.out?.power,
			yINs.map((y) => pick(y, 'power')),
			{ processHash }
		);
		writeOutputColumn(
			argsIN.out?.pvalue,
			yINs.map((y) => pick(y, 'pValue')),
			{ processHash }
		);
	}

	export function freerunningperiod(argsIN) {
		const result = evaluateFreeRunningPeriod(argsIN);
		if (result.anyValid) writeOutputs(argsIN, result);
		return [result, result.anyValid];
	}
</script>

<script>
	// @ts-nocheck
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import StoreValueButton from '$lib/components/inputs/StoreValueButton.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';
	import { syncMetricOutColumns } from '$lib/tableProcesses/metricOutputs.js';
	import { onMount, untrack } from 'svelte';
	import {
		showStaticDataAsTable,
		saveStaticDataAsCSV
	} from '$lib/components/plotbits/helpers/save.svelte.js';

	let { p = $bindable(), hideInputs = false } = $props();

	migrateLegacyYIN(p.args);
	fillDefaults(p.args, defaults);

	let result = $state({ perY: {}, yINs: [], anyValid: false });
	let mounted = $state(false);
	let lastHash = '';

	let xIN_col = $derived.by(() => (p.args.xIN >= 0 ? getColumnById(p.args.xIN) : null));

	// Own output columns are never selectable as inputs.
	let outIds = $derived.by(() =>
		METRIC_KEYS.map((k) => p.args.out?.[k]).filter((id) => typeof id === 'number' && id >= 0)
	);
	let yExcludeIds = $derived.by(() => {
		if (hideInputs) return [];
		return [p.args.xIN, ...outIds].filter((id) => id >= 0);
	});

	let getHash = $derived.by(() => {
		let out = '';
		out += xIN_col?.getDataHash ?? '';
		for (const yId of p.args.yIN ?? []) {
			const col = yId >= 0 ? getColumnById(yId) : null;
			out += col?.getDataHash ?? '';
		}
		out +=
			p.args.pMin +
			'|' +
			p.args.pMax +
			'|' +
			p.args.step +
			'|' +
			p.args.method +
			'|' +
			p.args.binSize +
			'|' +
			p.args.alpha;
		return out;
	});

	function recompute() {
		const [data, valid] = untrack(() => freerunningperiod(p.args));
		result = data;
		p.args.valid = valid;
		lastHash = getHash;
	}

	$effect(() => {
		const h = getHash;
		if (!mounted) return;
		if (h !== lastHash) untrack(() => recompute());
	});

	onMount(() => {
		if (!p.args.out) p.args.out = {};
		// Backfill metric out-columns for sessions saved before they existed. Metric
		// keys are fixed, so this only ever needs to run here (never in a $effect).
		syncMetricOutColumns(p, METRIC_KEYS, (k) => METRIC_KEYS.includes(k));
		recompute();
		mounted = true;
	});

	function fmt(v, dp = 3) {
		if (v == null || !Number.isFinite(v)) return '—';
		const a = Math.abs(v);
		if (a !== 0 && (a < 0.001 || a >= 1e4)) return v.toExponential(3);
		return v.toFixed(dp);
	}

	function getStatsData() {
		const headers = ['column', 'period', 'power', 'pvalue'];
		const rows = [];
		for (const yId of p.args.yIN ?? []) {
			const name = getColumnById(Number(yId))?.name ?? String(yId);
			const r = result?.perY?.[yId];
			rows.push([
				name,
				Number.isFinite(r?.period) ? r.period : null,
				Number.isFinite(r?.power) ? r.power : null,
				Number.isFinite(r?.pValue) ? r.pValue : null
			]);
		}
		return { headers, rows };
	}

	let rows = $derived.by(() =>
		(p.args.yIN ?? [])
			.filter((yId) => result?.perY?.[yId])
			.map((yId) => ({
				yId,
				name: getColumnById(Number(yId))?.name ?? String(yId),
				...result.perY[yId]
			}))
	);
</script>

<div class="control-input-vertical">
	{#if !hideInputs}
		<div class="control-input">
			<p>Time (x)</p>
			<ColumnSelector bind:value={p.args.xIN} />
		</div>
		<div class="control-input">
			<p>Series (y)</p>
			<ColumnSelector multiple bind:value={p.args.yIN} excludeColIds={yExcludeIds} />
		</div>
	{/if}

	<div class="control-input-horizontal">
		<div class="control-input">
			<p>Method</p>
			<AttributeSelect
				bind:value={p.args.method}
				options={['Chi-squared', 'Lomb-Scargle', 'Enright']}
				optionsDisplay={['Chi-squared', 'Lomb-Scargle', 'Enright']}
			/>
		</div>
	</div>
	<div class="control-input-horizontal">
		<ControlInput label="Period min (hrs)">
			<NumberWithUnits bind:value={p.args.pMin} min="0.1" step="0.5" />
		</ControlInput>
		<ControlInput label="Period max (hrs)">
			<NumberWithUnits bind:value={p.args.pMax} min="0.1" step="0.5" />
		</ControlInput>
		<ControlInput label="Period step (hrs)">
			<NumberWithUnits bind:value={p.args.step} min="0.001" step="0.01" />
		</ControlInput>
	</div>
	{#if p.args.method === 'Chi-squared' || p.args.method === 'Enright'}
		<div class="control-input-horizontal">
			<ControlInput label="Bin size (hrs)">
				<NumberWithUnits bind:value={p.args.binSize} min="0.01" step="0.25" />
			</ControlInput>
			{#if p.args.method === 'Chi-squared'}
				<ControlInput label="α (significance)">
					<NumberWithUnits bind:value={p.args.alpha} min="0.0001" max="0.9999" step="0.01" />
				</ControlInput>
			{/if}
		</div>
	{/if}
</div>

{#if rows.length}
	<div class="frp-results">
		<table>
			<thead>
				<tr>
					<th>Series</th>
					<th>Period τ (h)</th>
					<th>Power</th>
					<th>p-value</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as r (r.yId)}
					<tr>
						<td>{r.name}</td>
						<td>
							{fmt(r.period, 2)}
							<StoreValueButton
								label="Period"
								getter={() => result?.perY?.[r.yId]?.period}
								defaultName={`tau_${r.name}`}
								source="Free-Running Period"
							/>
						</td>
						<td>{fmt(r.power)}</td>
						<td>{fmt(r.pValue)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
		<p class="frp-hint">
			τ is the period at the periodogram peak. Wire the <em>period</em> output port into
			<em>Compare groups</em> or a boxplot to test τ across conditions.
		</p>
	</div>
	<div class="tp-stat-actions">
		<button
			class="tp-stat-btn"
			onclick={() => {
				const { headers, rows: rr } = getStatsData();
				showStaticDataAsTable('Free-running period', headers, rr, getStatsData);
			}}>View stats</button
		>
		<button
			class="tp-stat-btn"
			onclick={() => {
				const { headers, rows: rr } = getStatsData();
				saveStaticDataAsCSV('free_running_period', headers, rr);
			}}>Download stats</button
		>
	</div>
{:else if mounted}
	<p class="frp-hint">Select a time column and one or more series columns.</p>
{/if}

<style>
	.frp-results {
		margin-top: var(--space-2, 0.5rem);
		overflow-x: auto;
	}
	.frp-results table {
		border-collapse: collapse;
		font-size: 0.8rem;
		width: 100%;
	}
	.frp-results th,
	.frp-results td {
		border: 1px solid var(--color-lightness-90);
		padding: 0.2rem 0.4rem;
		text-align: right;
		white-space: nowrap;
	}
	.frp-results th:first-child,
	.frp-results td:first-child {
		text-align: left;
	}
	.frp-hint {
		font-size: var(--font-sm);
		opacity: 0.7;
		margin-top: var(--space-2, 0.5rem);
		line-height: 1.35;
	}
	.tp-stat-actions {
		display: flex;
		gap: 0.4rem;
		margin-top: 0.3rem;
	}
	.tp-stat-btn {
		font-size: var(--font-xs);
		padding: var(--space-2) var(--space-4);
		border: 1px solid var(--color-lightness-75);
		border-radius: var(--radius-xs);
		background: none;
		cursor: pointer;
		color: var(--color-lightness-35);
	}
	.tp-stat-btn:hover {
		background: var(--color-lightness-95);
		border-color: var(--color-lightness-55);
	}
</style>
