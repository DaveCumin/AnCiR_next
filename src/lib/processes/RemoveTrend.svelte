<script module>
	// @ts-nocheck
	import { getColumnById } from '$lib/core/Column.svelte';
	// The trend maths lives in ONE place: $lib/utils/trendfit.js. RemoveTrend used
	// to carry a verbatim copy, which meant fixes landed in only one of them (the
	// v72.20 string-coercion fix for R² never reached this copy). fitTrendSync is
	// the synchronous entry point — the async `fitTrend` exists only for the
	// optional permutation test, which RemoveTrend does not use.
	import { fitTrendSync } from '$lib/utils/trendfit.js';
	// Domain checks shared with the fit nodes (TrendFit et al). House rule:
	// REFUSE-and-pass-through — a fit outside its model's domain must not
	// silently emit an all-NaN column under the user's column name.
	import { checkTrendFitDomain, shouldRefuse, issueMessages } from '$lib/utils/fitDomain.js';
	import { dataEnteringProcess } from '$lib/core/processInput.js';

	const removetrend_defaults = new Map([
		['xColId', { val: -1 }],
		['model', { val: 'linear' }],
		['polyDegree', { val: 2 }],
		['slidingWindow', { val: false }],
		['windowSize', { val: 10 }]
	]);

	function slidingStandardisation(data, windowSize) {
		const half = Math.floor(windowSize / 2);
		return data.map((_, i) => {
			const start = Math.max(0, i - half);
			const end = Math.min(data.length - 1, i + half);
			let sum = 0,
				sumSq = 0;
			const count = end - start + 1;
			for (let j = start; j <= end; j++) {
				sum += data[j];
				sumSq += data[j] * data[j];
			}
			const mean = sum / count;
			const std = Math.sqrt(sumSq / count - mean * mean) || 1;
			return (data[i] - mean) / std;
		});
	}

	// The (t, y) pairs the fit actually sees: x-axis values (wired column, or the
	// row index) paired with the input data, filtered to rows where both are
	// usable. ONE copy, used by removetrend, the domain check, and the editor's
	// stats display, so all three always agree about which points exist.
	function trendPairs(x, args) {
		const xColId = args.xColId;
		const xCol = xColId != -1 ? getColumnById(xColId) : null;
		const t = xCol
			? xCol.type === 'time'
				? xCol.hoursSinceStart
				: xCol.getData()
			: x.map((_, i) => i);

		const validIndices = t
			.map((v, i) => (!isNaN(v) && x[i] != null && !isNaN(x[i]) ? i : -1))
			.filter((i) => i !== -1);

		return {
			validIndices,
			tt: validIndices.map((i) => t[i]),
			yy: validIndices.map((i) => x[i])
		};
	}

	/**
	 * Domain issues for this process's fit, given the data entering it. Pure
	 * (data in → issue objects out) so it is unit-testable without a session.
	 * All the trend checks are REFUSE-tier: when any fires, removetrend passes
	 * the input through unchanged instead of detrending.
	 */
	export function removetrendIssues(x, args) {
		const { validIndices, tt, yy } = trendPairs(x, args);
		if (validIndices.length < 2) return [];
		const xCol = args.xColId != -1 ? getColumnById(args.xColId) : null;
		return checkTrendFitDomain(tt, yy, args.model, args.polyDegree, {
			xLabel: xCol?.name ?? 'the row index',
			yLabel: 'the input column'
		});
	}

	export function removetrend(x, args) {
		const { validIndices, tt, yy } = trendPairs(x, args);

		if (validIndices.length < 2) return [...x];

		// REFUSE-and-pass-through (fitDomain): a logarithmic model over x <= 0 (or
		// exponential over y <= 0, an underdetermined polynomial, a constant x)
		// used to write an ALL-NaN output column with no explanation. The fit
		// cannot mean anything, so the data passes through UNCHANGED and the node
		// surfaces the reason (removetrendIssues → definition.getWarnings).
		if (shouldRefuse(checkTrendFitDomain(tt, yy, args.model, args.polyDegree))) {
			return [...x];
		}

		const fittedData = fitTrendSync(tt, yy, args.model, args.polyDegree);
		let detrended = yy.map((yi, k) => yi - fittedData.fitted[k]);

		if (args.slidingWindow && args.windowSize > 1) {
			detrended = slidingStandardisation(detrended, args.windowSize);
		}

		const out = [...x];
		for (let k = 0; k < validIndices.length; k++) out[validIndices[k]] = detrended[k];
		return out;
	}

	export const definition = {
		displayName: 'Remove Trend',
		func: removetrend,
		defaults: removetrend_defaults,
		// Optional warnings hook for column-process nodes: called at RENDER time
		// (TableProcessNode / CompactNode, via processNodeWarnings) with the live
		// Process, returning message strings for the node's ⚠ badge. Derived from
		// the same inputs the compute reads — never stored, so it cannot go stale.
		getWarnings: (p) => {
			const inData = dataEnteringProcess(p);
			if (!inData) return [];
			return issueMessages(removetrendIssues(inData, p.args));
		},
		nodeSpec: {
			id: 'process.removetrend',
			inputs: [{ name: 'input', kind: 'column', cardinality: 'one' }],
			outputs: [{ name: 'output', kind: 'column', cardinality: 'one' }]
		}
	};
</script>

<script>
	// @ts-nocheck
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import ProcessShell from '$lib/core/ProcessShell.svelte';

	let { p = $bindable() } = $props();

	// The data entering this process (input column for free nodes, reconstructed
	// pipeline state for inline ones) — shared with definition.getWarnings via
	// core/processInput.js, so the stats and the warnings see identical data.
	let enteringData = $derived.by(() => dataEnteringProcess(p));

	// Domain refusals for the CURRENT model over the current data. When any is
	// present the process passes data through unchanged, so the stats display
	// below is suppressed in favour of the explanation.
	let domainIssues = $derived.by(() => {
		if (!enteringData) return [];
		return issueMessages(removetrendIssues(enteringData, p.args));
	});

	// Reactively compute trend fit stats for display
	let trendStats = $derived.by(() => {
		if (!enteringData || domainIssues.length > 0) return null;
		const data = enteringData;

		const statsXCol = p.args.xColId != -1 ? getColumnById(p.args.xColId) : null;
		const t = statsXCol
			? statsXCol.type === 'time'
				? statsXCol.hoursSinceStart
				: statsXCol.getData()
			: data.map((_, i) => i);

		const validIndices = t
			.map((v, i) => (!isNaN(v) && data[i] != null && !isNaN(data[i]) ? i : -1))
			.filter((i) => i !== -1);
		if (validIndices.length < 2) return null;

		try {
			return fitTrendSync(
				validIndices.map((i) => t[i]),
				validIndices.map((i) => data[i]),
				p.args.model,
				p.args.polyDegree
			);
		} catch {
			return null;
		}
	});
</script>

<ProcessShell {p}>
	<!-- X column for trend fitting -->
	<div class="control-input">
		<p>X axis</p>
		<ColumnSelector bind:value={p.args.xColId} />
	</div>

	<!-- Trend model -->
	<div class="control-input">
		<p>Model</p>
		<AttributeSelect
			bind:value={p.args.model}
			label=""
			options={['linear', 'exponential', 'logarithmic', 'polynomial']}
			optionsDisplay={['Linear', 'Exponential', 'Logarithmic', 'Polynomial']}
		/>
	</div>

	{#if p.args.model === 'polynomial'}
		<ControlInput label="Degree">
			<NumberWithUnits bind:value={p.args.polyDegree} min={1} step={1} />
		</ControlInput>
	{/if}

	<!-- Sliding-window standardisation -->
	<div class="control-input">
		<label>
			<input type="checkbox" bind:checked={p.args.slidingWindow} />
			Sliding-window standardisation
		</label>
	</div>

	{#if p.args.slidingWindow}
		<ControlInput label="Window size">
			<NumberWithUnits bind:value={p.args.windowSize} min={3} step={1} />
		</ControlInput>
	{/if}

	<!-- Domain refusals: the fit was not computed and the data passed through
	     unchanged. Shown here as well as on the node badge, because the badge is
	     a tooltip and the reason has to be readable without hovering. Same
	     markup as TrendFit / Cosinor / ChiSquared. -->
	{#each domainIssues as w (w)}
		<p class="warn">{w}</p>
	{/each}

	<!-- Trend fit stats -->
	{#if trendStats}
		<div class="info-text">
			<span class="stat-label">Trend:</span>
			{#if p.args.model === 'linear'}
				{trendStats.parameters?.slope?.toFixed(3)}·x + {trendStats.parameters?.intercept?.toFixed(
					3
				)}
			{:else if p.args.model === 'exponential'}
				{trendStats.parameters?.a?.toFixed(3)}·e^({trendStats.parameters?.b?.toFixed(3)}·x)
			{:else if p.args.model === 'logarithmic'}
				{trendStats.parameters?.a?.toFixed(3)} + {trendStats.parameters?.b?.toFixed(3)}·ln(x)
			{:else if p.args.model === 'polynomial'}
				poly deg {p.args.polyDegree}
			{/if}
			&ensp;R²={trendStats.rSquared?.toFixed(3)}&ensp;RMSE={trendStats.rmse?.toFixed(3)}
		</div>
	{/if}
</ProcessShell>

<style>
	/* Matches TrendFit / ChiSquared / Rayleigh / Cosinor. */
	.warn {
		font-size: var(--font-xs);
		color: var(--color-warning-text);
		background: var(--color-warning-bg);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		margin: var(--space-1) 0 0;
	}
	.info-text {
		font-size: var(--font-sm);
		color: var(--text-secondary, var(--color-text-muted));
		font-style: italic;
		margin-top: var(--space-2);
		word-break: break-word;
	}
	.stat-label {
		font-weight: 600;
		font-style: normal;
		margin-right: var(--space-2);
	}
</style>
