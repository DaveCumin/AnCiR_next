<script>
	// @ts-nocheck
	// The permutation-test readout, rendered directly under the test's own controls so the
	// result appears where it was switched on — in the control panel as well as in the node.
	// (The per-series stats block repeats the p beside RMSE/R², where the other per-series
	// numbers live; this block is the summary for the whole node plus the full-distribution
	// actions.)
	import {
		showStaticDataAsTable,
		saveStaticDataAsCSV
	} from '$lib/components/plotbits/helpers/save.svelte.js';
	import {
		permutationTableData,
		hasPermutationDetail
	} from '$lib/tableProcesses/permutationSupport.js';

	/**
	 * @type {{
	 *   entries: Array<{name: string, result: object}>,
	 *   nodeId: number|string,
	 *   label: string
	 * }}
	 */
	let { entries = [], nodeId, label = 'Permutation' } = $props();

	const shown = $derived((entries ?? []).filter((e) => Number.isFinite(e?.result?.pValue)));
	const hasDetail = $derived(hasPermutationDetail(entries));

	const fileName = $derived(`${label.toLowerCase().replace(/\s+/g, '_')}_permutations`);
	const getTable = () => permutationTableData(entries);
</script>

{#if shown.length > 0}
	<div class="control-input-horizontal">
		<div class="control-input">
			{#each shown as e (e.name)}
				<p class="perm-line" class:sig={e.result.significant}>
					{#if shown.length > 1}<span class="perm-series">{e.name}:</span>{/if}
					p = {e.result.pValue.toFixed(4)}
					{#if e.result.significant}
						✓ Significant (p &lt; 0.05)
					{:else}
						⚠ Not significant (p ≥ 0.05)
					{/if}
					{#if Number.isFinite(e.result.observedStat)}
						<span class="perm-detail">
							observed {e.result.permStatistic ?? 'rSquared'} = {e.result.observedStat.toFixed(4)}
							over {e.result.permStats?.length ?? 0} permutations
						</span>
					{/if}
				</p>
			{/each}
			{#if hasDetail}
				<div class="tp-stat-actions">
					<button
						class="tp-stat-btn"
						title="Every permuted statistic, alongside the observed value and the p-value"
						onclick={() => {
							const { headers, rows } = getTable();
							showStaticDataAsTable(
								`${label}: permutations`,
								headers,
								rows,
								getTable,
								`tableprocess_${nodeId}`
							);
						}}>View permutations</button
					>
					<button
						class="tp-stat-btn"
						onclick={() => {
							const { headers, rows } = getTable();
							saveStaticDataAsCSV(fileName, headers, rows);
						}}>Download permutations</button
					>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.perm-line {
		font-weight: 600;
		color: var(--color-warning-text);
	}
	.perm-line.sig {
		color: var(--color-success);
	}
	.perm-series {
		font-weight: 700;
	}
	.perm-detail {
		display: block;
		font-weight: 400;
		color: var(--color-text-muted, inherit);
		font-size: 0.9em;
	}
</style>
