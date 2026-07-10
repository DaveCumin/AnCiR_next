<script module>
	import { normalizeYInputs, migrateLegacyYIN } from '$lib/tableProcesses/tpArgHelpers.js';
	import { writeOutputColumn } from '$lib/tableProcesses/outputColumns.js';
	// @ts-nocheck
	// Circular-statistics tests for phase/angle columns. Two related tests share
	// this node — pick with `testType` (like the permutation toggle in Cosinor):
	//   • 'rayleigh'       – per-column test of uniformity vs a preferred
	//                        direction: mean resultant length R, Rayleigh z, and p
	//                        (one value per Y column, in yIN order).
	//   • 'watsonwilliams' – do 2+ columns (each a group of angles) share a common
	//                        mean direction? The circular analogue of one-way ANOVA
	//                        (F, p) — a single value across all groups.
	// Both report through the same scalar-metric ports; ports not produced by the
	// active test are written as NaN (as Cosinor does for its mode-specific ports).
	import { getColumnById } from '$lib/core/Column.svelte';
	import { rayleighTest, circularMean, watsonWilliams, toRadians } from '$lib/utils/circular.js';
	import cdf_f from '@stdlib/stats-base-dists-f-cdf';

	const displayName = 'Rayleigh test';

	const defaults = new Map([
		['yIN', { val: [] }],
		// Which circular test to run: 'rayleigh' (uniformity, default) or
		// 'watsonwilliams' (equal mean direction across the Y columns).
		['testType', { val: 'rayleigh' }],
		['unit', { val: 'radians' }], // radians | degrees | hours
		['period', { val: 24 }], // full cycle when unit === 'hours'
		// Scalar-metric output ports. Rayleigh fills R/z/pvalue (one per Y);
		// Watson-Williams fills F/pvalue (a single value). Unused ports = NaN.
		['out', { R: { val: -1 }, z: { val: -1 }, F: { val: -1 }, pvalue: { val: -1 } }],
		['valid', { val: false }],
		['forcollected', { val: false }],
		['collectedType', { val: 'rayleightest' }]
	]);

	export const definition = {
		displayName,
		defaults,
		func: rayleigh,
		columnIdFields: { scalar: [], array: ['yIN'] },
		nodeSpec: {
			id: 'tableprocess.rayleightest',
			inputs: [{ name: 'yIN', kind: 'column', cardinality: 'many' }],
			outputs: [
				{ name: 'R', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'z', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'F', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'pvalue', kind: 'column', cardinality: 'one', metric: true }
			]
		}
	};

	const METRIC_KEYS = ['R', 'z', 'F', 'pvalue'];

	/** Upper-tail p from the F distribution (guards degenerate df / F). */
	export function pUpperFromF(fValue, df1, df2) {
		if (!Number.isFinite(fValue) || !Number.isFinite(df1) || !Number.isFinite(df2)) return NaN;
		if (df1 <= 0 || df2 <= 0 || fValue < 0) return NaN;
		return 1 - cdf_f(fValue, df1, df2);
	}

	/** Convert a raw column of angles to radians per the chosen unit. */
	function anglesToRadians(data, unit, period) {
		// Empty / null / whitespace / non-numeric cells become NaN (dropped downstream
		// by cleanAngles), matching the Python port. Using Number(v) directly would
		// coerce null/'' to a real 0-rad angle and bias the circular mean toward 0.
		return (data ?? []).map((v) => {
			if (v == null) return NaN;
			if (typeof v === 'string' && v.trim() === '') return NaN;
			const num = Number(v);
			return Number.isFinite(num) ? toRadians(num, unit, period) : NaN;
		});
	}

	// Rayleigh uniformity: returns { perY: { [yId]: {n,R,z,pValue,meanAngle} }, anyValid, yINs }.
	export function evaluateRayleigh(argsIN) {
		const yINs = normalizeYInputs(argsIN.yIN);
		const unit = argsIN.unit ?? 'radians';
		const period = Number.isFinite(argsIN.period) ? argsIN.period : 24;

		const perY = {};
		let anyValid = false;
		for (const yId of yINs) {
			if (yId == null || yId === -1) continue;
			const yCol = getColumnById(yId);
			if (!yCol) continue;
			const angles = anglesToRadians(yCol.getData(), unit, period);
			const res = rayleighTest(angles);
			if (res.n > 0) {
				const mean = circularMean(angles);
				perY[yId] = { ...res, meanAngle: mean.meanAngle };
				anyValid = true;
			}
		}
		return { perY, anyValid, yINs };
	}

	// Watson-Williams: the Y columns are the groups. Returns { result, valid, yINs }.
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
		return { result: { ...result, groupNames }, valid: result.valid, yINs };
	}

	function writeRayleighMetrics(argsIN, result) {
		const { perY, yINs } = result;
		const processHash = crypto.randomUUID();
		const perYArr = (field) => yINs.map((yId) => perY[yId]?.[field] ?? NaN);
		writeOutputColumn(argsIN.out?.R, perYArr('R'), { processHash });
		writeOutputColumn(argsIN.out?.z, perYArr('z'), { processHash });
		writeOutputColumn(argsIN.out?.pvalue, perYArr('pValue'), { processHash });
		// F is a Watson-Williams-only metric; keep the port numeric + index-aligned.
		writeOutputColumn(argsIN.out?.F, yINs.map(() => NaN), { processHash });
	}

	function writeWatsonWilliamsMetrics(argsIN, result) {
		const processHash = crypto.randomUUID();
		// A single value across all groups, written one-per-array (metric-port shape).
		writeOutputColumn(argsIN.out?.F, [result.F], { processHash });
		writeOutputColumn(argsIN.out?.pvalue, [result.pValue], { processHash });
		// R/z are Rayleigh-only metrics; keep the ports numeric.
		writeOutputColumn(argsIN.out?.R, [NaN], { processHash });
		writeOutputColumn(argsIN.out?.z, [NaN], { processHash });
	}

	export function rayleigh(argsIN) {
		if ((argsIN.testType ?? 'rayleigh') === 'watsonwilliams') {
			const { result, valid, yINs } = evaluateWatsonWilliams(argsIN);
			if (valid) writeWatsonWilliamsMetrics(argsIN, result);
			return [{ testType: 'watsonwilliams', ww: result, anyValid: valid, yINs }, valid];
		}
		const result = evaluateRayleigh(argsIN);
		if (result.anyValid) writeRayleighMetrics(argsIN, result);
		return [{ testType: 'rayleigh', ...result }, result.anyValid];
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
	if (p.args.testType === undefined) p.args.testType = 'rayleigh';
	if (p.args.unit === undefined) p.args.unit = 'radians';
	if (p.args.period === undefined) p.args.period = 24;

	let rayleighData = $state({ testType: 'rayleigh', perY: {}, anyValid: false, yINs: [] });
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
		out += p.args.testType ?? 'rayleigh';
		out += p.args.unit ?? 'radians';
		out += p.args.period ?? 24;
		return out;
	});

	function recompute() {
		[rayleighData, p.args.valid] = rayleigh(p.args);
		lastHash = getHash;
	}

	$effect(() => {
		const h = getHash;
		if (!mounted) return;
		if (h !== lastHash) untrack(() => recompute());
	});

	// Backfill + reconcile the fixed metric-key set (R/z/F/pvalue). F was added
	// when the Watson-Williams test was folded in, so older Rayleigh sessions get
	// their F column backfilled here.
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

	let rows = $derived.by(() => {
		if (rayleighData?.testType !== 'rayleigh' || !rayleighData?.perY) return [];
		return (p.args.yIN ?? [])
			.filter((yId) => rayleighData.perY[yId])
			.map((yId) => ({
				yId,
				name: getColumnByIdLocal(Number(yId))?.name ?? String(yId),
				...rayleighData.perY[yId]
			}));
	});
	let ww = $derived.by(() =>
		rayleighData?.testType === 'watsonwilliams' && rayleighData.anyValid ? rayleighData.ww : null
	);
	const fmt = (v, dp = 3) => (Number.isFinite(v) ? v.toFixed(dp) : '—');
</script>

<div class="control-input-vertical">
	{#if !hideInputs}
		<div class="control-input">
			<p>{p.args.testType === 'watsonwilliams' ? 'Group angle columns (y)' : 'Angle columns (y)'}</p>
			<ColumnSelector multiple bind:value={p.args.yIN} excludeColIds={yExcludeIds} />
		</div>
	{/if}

	<div class="control-input-horizontal">
		<ControlInput label="Test">
			<select bind:value={p.args.testType}>
				<option value="rayleigh">Rayleigh (uniformity)</option>
				<option value="watsonwilliams">Watson-Williams (equal mean direction)</option>
			</select>
		</ControlInput>
	</div>

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

{#if p.args.testType === 'watsonwilliams'}
	{#if ww}
		<div class="rayleigh-results">
			<p>
				F({ww.df1}, {ww.df2}) = {fmt(ww.F, 4)}, p = {Number.isFinite(ww.pValue)
					? ww.pValue.toPrecision(4)
					: '—'}
			</p>
			<p class="rayleigh-hint" style="opacity:0.8;">
				{ww.k} groups, N = {ww.N}; κ̂ = {fmt(ww.kappa, 3)}, correction β = {fmt(ww.beta, 3)}
			</p>
			<div class="section-row" style="gap: 0.4rem;">
				<StoreValueButton
					label="F"
					getter={() => ww.F}
					defaultName={'watson_williams_F'}
					source="RayleighTest (Watson-Williams)"
				/>
				<StoreValueButton
					label="p-value"
					getter={() => ww.pValue}
					defaultName={'watson_williams_p'}
					source="RayleighTest (Watson-Williams)"
				/>
			</div>
			<p class="rayleigh-hint">
				Tests whether the groups share a mean direction. Assumes concentrated, similarly-dispersed
				samples (κ̂ ≳ 2); a small p means the mean angles differ.
			</p>
		</div>
	{:else if mounted}
		<p class="rayleigh-hint">Select two or more columns of angles (one per group).</p>
	{/if}
{:else if rows.length}
	<div class="rayleigh-results">
		<table>
			<thead>
				<tr>
					<th>Series</th>
					<th>n</th>
					<th>R</th>
					<th>z</th>
					<th>p</th>
					<th>Mean angle</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as r (r.yId)}
					<tr>
						<td>{r.name}</td>
						<td>{r.n}</td>
						<td>
							{fmt(r.R)}
							<StoreValueButton
								label="R"
								getter={() => r.R}
								defaultName={`rayleigh_R_${r.name}`}
								source="RayleighTest"
							/>
						</td>
						<td>{fmt(r.z, 2)}</td>
						<td>
							{Number.isFinite(r.pValue) ? r.pValue.toPrecision(3) : '—'}
							<StoreValueButton
								label="p"
								getter={() => r.pValue}
								defaultName={`rayleigh_p_${r.name}`}
								source="RayleighTest"
							/>
						</td>
						<td>{fmt(r.meanAngle, 3)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
		<p class="rayleigh-hint">
			R is the mean resultant length (0 = uniform, 1 = perfectly clustered). A small p rejects
			uniformity: the angles have a preferred direction. Wire any port into <em>Compare groups</em>
			or a boxplot.
		</p>
	</div>
{:else if mounted}
	<p class="rayleigh-hint">Select one or more columns of angles.</p>
{/if}

<style>
	.rayleigh-results {
		margin-top: var(--space-2, 0.5rem);
		overflow-x: auto;
	}
	.rayleigh-results table {
		border-collapse: collapse;
		font-size: 0.8rem;
		width: 100%;
	}
	.rayleigh-results th,
	.rayleigh-results td {
		border: 1px solid var(--color-lightness-90);
		padding: 0.2rem 0.4rem;
		text-align: right;
		white-space: nowrap;
	}
	.rayleigh-results th:first-child,
	.rayleigh-results td:first-child {
		text-align: left;
	}
	.rayleigh-hint {
		font-size: var(--font-sm);
		opacity: 0.7;
		margin-top: var(--space-2, 0.5rem);
		line-height: 1.35;
	}
</style>
