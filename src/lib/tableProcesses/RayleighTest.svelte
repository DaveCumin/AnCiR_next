<script module>
	import { normalizeYInputs, migrateLegacyYIN } from '$lib/tableProcesses/tpArgHelpers.js';
	import { writeOutputColumn } from '$lib/tableProcesses/outputColumns.js';
	// @ts-nocheck
	// Circular-statistics tests for phase/angle columns. The Rayleigh test ALWAYS
	// runs — for each Y column it reports the mean resultant length R, Rayleigh's z,
	// and a p-value (test of a preferred direction), one value per Y in yIN order.
	//
	// An OPTIONAL Watson-Williams test (toggle `showWatsonWilliams`, like the
	// boxplot's pairwise comparisons) additionally asks whether the Y columns —
	// treated as groups of angles — share a common mean direction (the circular
	// analogue of one-way ANOVA), reporting a single F statistic and p-value.
	//
	// Ports: R / z / pvalue are the always-on Rayleigh metrics (one per Y). F and
	// ww_pvalue are the optional Watson-Williams metrics (a single value; NaN when
	// the test is off), like Cosinor's mode-specific ports.
	import { getColumnById } from '$lib/core/Column.svelte';
	import {
		rayleighTest,
		circularMean,
		watsonWilliams,
		toRadiansColumn
	} from '$lib/utils/circular.js';
	// A bare `export { x } from './y.js'` re-export does NOT bind `x` in this
	// module's own scope, and pUpperFromF is used internally below (in
	// watsonWilliams's callback) — so import it normally and re-export it.
	import { pUpperFromF } from '$lib/utils/fdist.js';
	export { pUpperFromF };

	const displayName = 'Rayleigh test';

	const defaults = new Map([
		['yIN', { val: [] }],
		['unit', { val: 'radians' }], // radians | degrees | hours
		['period', { val: 24 }], // full cycle when unit === 'hours'
		// Optional add-on: also run the Watson-Williams equal-mean-direction test
		// across the Y columns (off by default), like the boxplot's pairwise panel.
		['showWatsonWilliams', { val: false }],
		// Scalar-metric output ports. R/z/pvalue are the always-on Rayleigh metrics
		// (one value per Y). F/ww_pvalue are the optional Watson-Williams metrics
		// (a single value; NaN when the test is off).
		['out', { R: { val: -1 }, z: { val: -1 }, pvalue: { val: -1 }, F: { val: -1 }, ww_pvalue: { val: -1 } }],
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
				{ name: 'pvalue', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'F', kind: 'column', cardinality: 'one', metric: true },
				{ name: 'ww_pvalue', kind: 'column', cardinality: 'one', metric: true }
			]
		}
	};

	const METRIC_KEYS = ['R', 'z', 'pvalue', 'F', 'ww_pvalue'];

	/** Convert a raw column of angles to radians per the chosen unit. */
	function anglesToRadians(data, unit, period) {
		return toRadiansColumn(data, unit, period);
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

	// Watson-Williams: the Y columns are the groups. Returns { ...stats, valid }.
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
		return { ...result, groupNames };
	}

	function writeMetrics(argsIN, result) {
		const { perY, yINs, ww } = result;
		const processHash = crypto.randomUUID();
		const perYArr = (field) => yINs.map((yId) => perY[yId]?.[field] ?? NaN);
		writeOutputColumn(argsIN.out?.R, perYArr('R'), { processHash });
		writeOutputColumn(argsIN.out?.z, perYArr('z'), { processHash });
		writeOutputColumn(argsIN.out?.pvalue, perYArr('pValue'), { processHash });
		// Watson-Williams (optional): a single value across all groups; NaN when the
		// test is off or degenerate, so the ports stay numeric + present.
		const wwValid = ww && ww.valid;
		writeOutputColumn(argsIN.out?.F, [wwValid ? ww.F : NaN], { processHash });
		writeOutputColumn(argsIN.out?.ww_pvalue, [wwValid ? ww.pValue : NaN], { processHash });
	}

	export function rayleigh(argsIN) {
		const rayleighRes = evaluateRayleigh(argsIN);
		const ww = argsIN.showWatsonWilliams ? evaluateWatsonWilliams(argsIN) : null;
		const result = { ...rayleighRes, ww };
		if (rayleighRes.anyValid) writeMetrics(argsIN, result);
		return [result, rayleighRes.anyValid];
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
	if (p.args.showWatsonWilliams === undefined) {
		// Migrate the old testType selector: 'watsonwilliams' → optional test ON.
		p.args.showWatsonWilliams = p.args.testType === 'watsonwilliams';
	}
	if (p.args.unit === undefined) p.args.unit = 'radians';
	if (p.args.period === undefined) p.args.period = 24;

	let rayleighData = $state({ perY: {}, anyValid: false, yINs: [], ww: null });
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
		out += p.args.showWatsonWilliams ? 'ww' : '';
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

	// Backfill + reconcile the fixed metric-key set (R/z/pvalue/F/ww_pvalue). F and
	// ww_pvalue were added when the Watson-Williams test was folded in, so older
	// Rayleigh sessions get those columns backfilled here.
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
		if (!rayleighData?.perY) return [];
		return (p.args.yIN ?? [])
			.filter((yId) => rayleighData.perY[yId])
			.map((yId) => ({
				yId,
				name: getColumnByIdLocal(Number(yId))?.name ?? String(yId),
				...rayleighData.perY[yId]
			}));
	});
	let ww = $derived.by(() =>
		p.args.showWatsonWilliams && rayleighData?.ww?.valid ? rayleighData.ww : null
	);
	const fmt = (v, dp = 3) => (Number.isFinite(v) ? v.toFixed(dp) : '—');
</script>

<div class="control-input-vertical">
	{#if !hideInputs}
		<div class="control-input">
			<p>Angle columns (y)</p>
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

	<div class="control-input">
		<label class="ww-toggle">
			<input type="checkbox" bind:checked={p.args.showWatsonWilliams} />
			Also run Watson-Williams test (equal mean direction across columns)
		</label>
	</div>
</div>

{#if rows.length}
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

{#if p.args.showWatsonWilliams}
	<details class="ww-panel" open>
		<summary class="ww-summary">Watson-Williams test</summary>
		{#if ww}
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
				Tests whether the groups share a mean direction (needs 2+ columns). Assumes concentrated,
				similarly-dispersed samples (κ̂ ≳ 2); a small p means the mean angles differ.
			</p>
		{:else if mounted}
			<p class="rayleigh-hint">Select two or more columns of angles (one per group).</p>
		{/if}
	</details>
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
	.ww-toggle {
		display: flex;
		align-items: center;
		gap: var(--space-2, 0.4rem);
		font-size: var(--font-sm);
	}
	.ww-panel {
		margin-top: var(--space-3, 0.6rem);
		font-size: 0.82rem;
	}
	.ww-panel p {
		margin: 0.14rem 0;
	}
	.ww-summary {
		font-weight: 600;
		cursor: pointer;
		font-size: var(--font-sm);
	}
	.rayleigh-hint {
		font-size: var(--font-sm);
		opacity: 0.7;
		margin-top: var(--space-2, 0.5rem);
		line-height: 1.35;
	}
</style>
