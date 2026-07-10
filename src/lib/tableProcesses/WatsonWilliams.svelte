<script module>
	import { normalizeYInputs, migrateLegacyYIN } from '$lib/tableProcesses/tpArgHelpers.js';
	import { writeOutputColumn } from '$lib/tableProcesses/outputColumns.js';
	// @ts-nocheck
	// Watson–Williams multi-sample test: do 2+ groups of angles share a common
	// mean direction? (the circular analogue of one-way ANOVA). Each Y column is
	// one group of angles; the node reports the F statistic and its p-value as
	// scalar-metric ports (a single value, written as a one-element array in the
	// same "metric port" shape as the other analyses).
	import { getColumnById } from '$lib/core/Column.svelte';
	import { watsonWilliams, toRadians } from '$lib/utils/circular.js';
	import cdf_f from '@stdlib/stats-base-dists-f-cdf';

	const displayName = 'Watson-Williams test';

	const defaults = new Map([
		['yIN', { val: [] }],
		['unit', { val: 'radians' }], // radians | degrees | hours
		['period', { val: 24 }],
		['out', { F: { val: -1 }, pvalue: { val: -1 } }],
		['valid', { val: false }],
		['forcollected', { val: false }],
		['collectedType', { val: 'watsonwilliams' }]
	]);

	export const definition = {
		displayName,
		defaults,
		func: watsonwilliams,
		columnIdFields: { scalar: [], array: ['yIN'] },
		nodeSpec: {
			id: 'tableprocess.watsonwilliams',
			inputs: [{ name: 'yIN', kind: 'column', cardinality: 'many' }],
			outputs: [
				{ name: 'F', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'pvalue', kind: 'column', cardinality: 'one', metric: true }
			]
		}
	};

	const METRIC_KEYS = ['F', 'pvalue'];

	/** Upper-tail p from the F distribution (guards degenerate df / F). */
	export function pUpperFromF(fValue, df1, df2) {
		if (!Number.isFinite(fValue) || !Number.isFinite(df1) || !Number.isFinite(df2)) return NaN;
		if (df1 <= 0 || df2 <= 0 || fValue < 0) return NaN;
		return 1 - cdf_f(fValue, df1, df2);
	}

	function anglesToRadians(data, unit, period) {
		// Empty / null / whitespace / non-numeric cells become NaN (dropped downstream
		// by cleanAngles), matching the Python port. Using Number(v) directly would
		// coerce null/'' to a real 0-rad angle and bias the group's circular mean.
		return (data ?? []).map((v) => {
			if (v == null) return NaN;
			if (typeof v === 'string' && v.trim() === '') return NaN;
			const num = Number(v);
			return Number.isFinite(num) ? toRadians(num, unit, period) : NaN;
		});
	}

	// Pure evaluation: returns { result, valid } where result is the
	// watsonWilliams(...) object (F, df1, df2, pValue, kappa, beta, ...).
	export function evaluateWatsonWilliams(argsIN) {
		const yINs = normalizeYInputs(argsIN.yIN);
		const unit = argsIN.unit ?? 'radians';
		const period = Number.isFinite(argsIN.period) ? argsIN.period : 24;

		const groups = [];
		const groupNames = [];
		for (const yId of yINs) {
			if (yId == null || yId === -1) continue;
			const yCol = getColumnById(yId);
			if (!yCol) continue;
			groups.push(anglesToRadians(yCol.getData(), unit, period));
			groupNames.push(yCol.name || String(yId));
		}

		const result = watsonWilliams(groups, pUpperFromF);
		return { result: { ...result, groupNames }, valid: result.valid };
	}

	function writeWatsonWilliamsMetrics(argsIN, result) {
		const processHash = crypto.randomUUID();
		// Single value across all groups, written one-per-array like GroupComparison's
		// multiY fallback (the metric-port shape stays "an array of values").
		writeOutputColumn(argsIN.out?.F, [result.F], { processHash });
		writeOutputColumn(argsIN.out?.pvalue, [result.pValue], { processHash });
	}

	export function watsonwilliams(argsIN) {
		const { result, valid } = evaluateWatsonWilliams(argsIN);
		if (valid) writeWatsonWilliamsMetrics(argsIN, result);
		return [result, valid];
	}
</script>

<script>
	// @ts-nocheck
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import StoreValueButton from '$lib/components/inputs/StoreValueButton.svelte';
	import { getColumnById as getColumnByIdLocal } from '$lib/core/Column.svelte';
	import { syncMetricOutColumns } from '$lib/tableProcesses/metricOutputs.js';
	import { onMount, untrack } from 'svelte';

	let { p = $bindable(), hideInputs = false } = $props();

	migrateLegacyYIN(p.args);
	if (typeof p.args.out !== 'object' || p.args.out === null) p.args.out = {};
	if (p.args.unit === undefined) p.args.unit = 'radians';
	if (p.args.period === undefined) p.args.period = 24;

	let wwData = $state({ valid: false });
	let mounted = $state(false);
	let lastHash = '';

	let yCols = $derived.by(() =>
		(p.args.yIN ?? []).map((id) => getColumnByIdLocal(id)).filter(Boolean)
	);
	let outIds = $derived.by(() => {
		const ids = [];
		for (const key of Object.keys(p.args.out ?? {})) {
			if (p.args.out[key] >= 0) ids.push(p.args.out[key]);
		}
		return ids;
	});
	let yExcludeIds = $derived(outIds);
	let getHash = $derived.by(() => {
		let out = '';
		for (const col of yCols) out += col?.getDataHash ?? '';
		out += p.args.unit ?? 'radians';
		out += p.args.period ?? 24;
		return out;
	});

	function recompute() {
		const [data, valid] = watsonwilliams(p.args);
		wwData = data;
		p.args.valid = valid;
		lastHash = getHash;
	}

	$effect(() => {
		const h = getHash;
		if (!mounted) return;
		if (h !== lastHash) untrack(() => recompute());
	});

	$effect(() => {
		p.args.yIN;
		if (!mounted) return;
		queueMicrotask(() =>
			untrack(() => {
				syncMetricOutColumns(p, METRIC_KEYS, (k) => METRIC_KEYS.includes(k));
				recompute();
			})
		);
	});

	onMount(() => {
		if (!p.args.out) p.args.out = {};
		syncMetricOutColumns(p, METRIC_KEYS, (k) => METRIC_KEYS.includes(k));
		recompute();
		mounted = true;
	});

	const fmt = (v, dp = 3) => (Number.isFinite(v) ? v.toFixed(dp) : '—');
</script>

<div class="control-input-vertical">
	{#if !hideInputs}
		<div class="control-input">
			<p>Group angle columns (y)</p>
			<ColumnSelector multiple bind:value={p.args.yIN} excludeColIds={yExcludeIds} />
		</div>
	{/if}

	<div class="control-input-horizontal">
		<ControlInput label="Unit">
			<select bind:value={p.args.unit}>
				<option value="radians">Radians</option>
				<option value="degrees">Degrees</option>
				<option value="hours">Clock hours</option>
			</select>
		</ControlInput>
		{#if p.args.unit === 'hours'}
			<ControlInput label="Period (h)">
				<NumberWithUnits bind:value={p.args.period} min="0.1" step="1" />
			</ControlInput>
		{/if}
	</div>
</div>

{#if wwData?.valid}
	<div class="ww-results">
		<p>
			F({wwData.df1}, {wwData.df2}) = {fmt(wwData.F, 4)}, p = {Number.isFinite(wwData.pValue)
				? wwData.pValue.toPrecision(4)
				: '—'}
		</p>
		<p class="ww-sub">
			{wwData.k} groups, N = {wwData.N}; κ̂ = {fmt(wwData.kappa, 3)}, correction β = {fmt(
				wwData.beta,
				3
			)}
		</p>
		<div class="section-row" style="gap: 0.4rem;">
			<StoreValueButton
				label="F"
				getter={() => wwData.F}
				defaultName={'watson_williams_F'}
				source="WatsonWilliams"
			/>
			<StoreValueButton
				label="p-value"
				getter={() => wwData.pValue}
				defaultName={'watson_williams_p'}
				source="WatsonWilliams"
			/>
		</div>
		<p class="ww-hint">
			Tests whether the groups share a mean direction. Assumes concentrated, similarly-dispersed
			samples (κ̂ ≳ 2); a small p means the mean angles differ.
		</p>
	</div>
{:else if mounted}
	<p class="ww-hint">Select two or more columns of angles (one per group).</p>
{/if}

<style>
	.ww-results {
		margin-top: var(--space-2, 0.5rem);
		font-size: 0.82rem;
	}
	.ww-results p {
		margin: 0.14rem 0;
	}
	.ww-sub {
		opacity: 0.8;
	}
	.ww-hint {
		font-size: var(--font-sm);
		opacity: 0.7;
		margin-top: var(--space-2, 0.5rem);
		line-height: 1.35;
	}
</style>
