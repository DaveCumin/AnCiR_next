<script module>
	// FDR / multiple-comparison correction — takes a column of raw p-values and
	// returns adjusted p-values plus a reject flag.
	//
	// The input shape already exists in the app: metric out-keys hold ONE VALUE PER
	// Y INPUT, so a Cosinor wired to 20 y-columns already emits a `pvalue` column
	// with 20 rows. That column is exactly what this node corrects.
	//
	// To correct several families together as one, collect them into a single
	// column first (CollectColumns); correcting each column separately and calling
	// the result "the" FDR would understate the true multiplicity.
	import { core } from '$lib/core/core.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';
	import { pAdjust, PADJUST_METHODS } from '$lib/utils/pAdjust.js';

	const displayName = 'FDR Correction';

	const defaults = new Map([
		['xIN', { val: -1 }], // the column of raw p-values
		['method', { val: 'benjamini-hochberg' }],
		['alpha', { val: 0.05 }],
		['out', { padj: { val: -1 }, reject: { val: -1 } }],
		['valid', { val: false }]
	]);

	/**
	 * Adjust the input column's p-values.
	 *
	 * Missing / non-numeric entries stay MISSING and are excluded from n, so a
	 * test that failed to run never tightens the correction applied to the ones
	 * that did.
	 *
	 * @returns {[{padj:number[], reject:(number|null)[], nTested:number, nSignificant:number}, boolean]}
	 */
	export function fdrcorrection(argsIN) {
		const empty = { padj: [], reject: [], nTested: 0, nSignificant: 0 };
		const xId = argsIN.xIN;
		if (xId == null || xId === -1) return [empty, false];
		const col = getColumnById(xId);
		if (!col) return [empty, false];

		const data = col.getData() ?? [];
		if (data.length === 0) return [empty, false];

		const method = PADJUST_METHODS.includes(argsIN.method) ? argsIN.method : 'benjamini-hochberg';
		const alpha = Number.isFinite(Number(argsIN.alpha)) ? Number(argsIN.alpha) : 0.05;

		const padj = pAdjust(data, method);
		const reject = padj.map((p) => (Number.isFinite(p) ? (p < alpha ? 1 : 0) : null));
		const nTested = padj.filter(Number.isFinite).length;
		const nSignificant = reject.filter((r) => r === 1).length;

		writeOut(argsIN.out?.padj, padj, 'number');
		writeOut(argsIN.out?.reject, reject, 'number');

		return [{ padj, reject, nTested, nSignificant }, nTested > 0];
	}

	function writeOut(outId, values, type) {
		if (outId == null || outId < 0) return;
		core.rawData.set(outId, values);
		const outCol = /** @type {any} */ (getColumnById(outId));
		if (outCol) {
			outCol.data = outId;
			outCol.type = type;
			outCol.tableProcessGUId = crypto.randomUUID();
		}
	}

	export const definition = {
		displayName,
		defaults,
		func: fdrcorrection,
		columnIdFields: { scalar: ['xIN'] },
		nodeSpec: {
			id: 'tableprocess.fdrcorrection',
			inputs: [{ name: 'xIN', kind: 'column', cardinality: 'one' }],
			outputs: [
				{ name: 'padj', kind: 'column', cardinality: 'one' },
				{ name: 'reject', kind: 'column', cardinality: 'one' }
			]
		}
	};
</script>

<script>
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import { onMount, untrack } from 'svelte';

	let { p = $bindable() } = $props();

	let mounted = $state(false);
	let summary = $state({ nTested: 0, nSignificant: 0 });

	let ownOutputIds = $derived(
		[p.args.out?.padj, p.args.out?.reject].filter((id) => id != null && id >= 0)
	);

	// Recompute on the input's DATA changing, not just its id: an upstream edit
	// changes the values while leaving the column id alone.
	let xCol = $derived(p.args.xIN >= 0 ? getColumnById(p.args.xIN) : null);
	let getHash = $derived.by(
		() => (xCol?.getDataHash ?? '') + '|m:' + p.args.method + '|a:' + p.args.alpha
	);
	let lastHash = '';

	function recompute() {
		const [res, valid] = fdrcorrection(p.args);
		p.args.valid = valid;
		summary = { nTested: res.nTested, nSignificant: res.nSignificant };
	}

	$effect(() => {
		const h = getHash;
		if (!mounted) return;
		if (h !== lastHash) {
			untrack(() => recompute());
			lastHash = h;
		}
	});

	onMount(() => {
		if (!p.args.out) p.args.out = {};
		const baked = p.args.out.padj >= 0 && core.rawData.get(p.args.out.padj)?.length > 0;
		if (baked) {
			p.args.valid = true;
			const stale = (getColumnById(p.args.xIN)?.rawDataVersion ?? 0) > 0;
			if (!stale) lastHash = getHash;
			const padj = core.rawData.get(p.args.out.padj) ?? [];
			const rej = core.rawData.get(p.args.out.reject) ?? [];
			summary = {
				nTested: padj.filter(Number.isFinite).length,
				nSignificant: rej.filter((r) => r === 1).length
			};
		} else {
			recompute();
		}
		mounted = true;
	});
</script>

<div class="section-row">
	<div class="tableProcess-label"><span>Input</span></div>
	<div class="control-input">
		<p>p-values</p>
		<ColumnSelector bind:value={p.args.xIN} onChange={recompute} excludeColIds={ownOutputIds} />
	</div>
</div>

<div class="section-row">
	<div class="tableProcess-label"><span>Correction</span></div>
	<div class="control-input">
		<p>Method</p>
		<AttributeSelect
			bind:value={p.args.method}
			options={PADJUST_METHODS}
			optionsDisplay={[
				'None (raw p)',
				'Bonferroni (FWER)',
				'Holm (FWER)',
				'Benjamini-Hochberg (FDR)',
				'Benjamini-Yekutieli (FDR, any dependence)'
			]}
		/>
	</div>
	<ControlInput label="alpha">
		<NumberWithUnits bind:value={p.args.alpha} onInput={recompute} min="0" max="1" step="0.01" />
	</ControlInput>
</div>

{#if p.args.method === 'benjamini-hochberg'}
	<p class="tp-hint">
		Benjamini-Hochberg controls the FDR under independence or positive dependence (PRDS). If your
		tests may be dependent in other ways, use Benjamini-Yekutieli.
	</p>
{/if}

{#if p.args.xIN >= 0 && p.args.valid}
	<p class="tp-hint">
		{summary.nSignificant} of {summary.nTested} significant at alpha = {p.args.alpha}.
	</p>
{/if}

{#if p.args.out?.padj >= 0}
	<details open>
		<summary class="section-details-summary">Adjusted p-values</summary>
		<ColumnComponent col={getColumnById(p.args.out.padj)} />
	</details>
{/if}
{#if p.args.out?.reject >= 0}
	<details>
		<summary class="section-details-summary">Reject (1 / 0)</summary>
		<ColumnComponent col={getColumnById(p.args.out.reject)} />
	</details>
{/if}
{#if !(p.args.xIN >= 0)}
	<p>Select a column of p-values to correct.</p>
{/if}

<style>
	.tp-hint {
		font-size: var(--font-size-small, 0.8rem);
		color: var(--color-text-muted);
		margin: var(--space-2) 0;
	}
</style>
