<script module>
	// Threshold / binarize — turn a continuous column into a 0/1 column at a user-set cutoff.
	// The main use is making a BINARY outcome for LogisticRegression, but it's general: "flag
	// every value above 100", "mark the active hours", etc. One input column, one 0/1 output.
	import { core } from '$lib/core/core.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';

	const displayName = 'Threshold';

	const defaults = new Map([
		['xIN', { val: -1 }], // the column to binarise
		['threshold', { val: 0 }], // the cutoff
		['comparison', { val: '>=' }], // '>' | '>=' | '<' | '<='
		['out', { binary: { val: -1 } }], // one fixed 0/1 output column
		['valid', { val: false }]
	]);

	const COMPARATORS = {
		'>': (v, t) => v > t,
		'>=': (v, t) => v >= t,
		'<': (v, t) => v < t,
		'<=': (v, t) => v <= t
	};

	/**
	 * Binarise the input column: each value → 1 if it satisfies `comparison` vs `threshold`,
	 * else 0. Missing / non-numeric values stay MISSING (null), never a spurious 0.
	 * @returns {[number[], boolean]}
	 */
	export function thresholddata(argsIN) {
		const xId = argsIN.xIN;
		if (xId == null || xId === -1) return [[], false];
		const col = getColumnById(xId);
		if (!col) return [[], false];

		const data = col.getData() ?? [];
		const t = Number(argsIN.threshold);
		const cmp = COMPARATORS[argsIN.comparison] ?? COMPARATORS['>='];

		const result = data.map((v) => {
			const n = Number(v);
			if (v == null || v === '' || Number.isNaN(n)) return null;
			return cmp(n, t) ? 1 : 0;
		});

		const outId = argsIN.out?.binary;
		if (outId != null && outId >= 0) {
			core.rawData.set(outId, result);
			const outCol = /** @type {any} */ (getColumnById(outId));
			if (outCol) {
				outCol.data = outId;
				outCol.type = 'number';
				outCol.tableProcessGUId = crypto.randomUUID();
			}
		}

		return [result, result.length > 0];
	}

	export const definition = {
		displayName,
		defaults,
		func: thresholddata,
		columnIdFields: { scalar: ['xIN'] },
		nodeSpec: {
			id: 'tableprocess.threshold',
			inputs: [{ name: 'xIN', kind: 'column', cardinality: 'one' }],
			outputs: [{ name: 'binary', kind: 'column', cardinality: 'one' }]
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

	// Don't let the node pick its own output as the input.
	let ownOutputIds = $derived(p.args.out?.binary >= 0 ? [p.args.out.binary] : []);

	// Recompute on the input's DATA changing (not just its id) OR a param change — a $effect
	// that read only p.args.xIN would never re-fire when an upstream cell is edited.
	let xCol = $derived(p.args.xIN >= 0 ? getColumnById(p.args.xIN) : null);
	let getHash = $derived.by(
		() => (xCol?.getDataHash ?? '') + '|t:' + p.args.threshold + '|c:' + p.args.comparison
	);
	let lastHash = '';

	function recompute() {
		p.args.valid = thresholddata(p.args)[1];
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
		const outKey = p.args.out.binary;
		// Reuse baked data from an imported session; otherwise compute now.
		if (outKey >= 0 && core.rawData.has(outKey) && core.rawData.get(outKey).length > 0) {
			p.args.valid = true;
			const stale = (getColumnById(p.args.xIN)?.rawDataVersion ?? 0) > 0;
			if (!stale) lastHash = getHash; // don't recompute valid, current data
		} else {
			recompute();
		}
		mounted = true;
	});
</script>

<div class="section-row">
	<div class="tableProcess-label"><span>Input</span></div>
	<div class="control-input">
		<p>Column</p>
		<ColumnSelector bind:value={p.args.xIN} onChange={recompute} excludeColIds={ownOutputIds} />
	</div>
</div>

<div class="section-row">
	<div class="tableProcess-label"><span>Rule</span></div>
	<div class="control-input">
		<p>Comparison</p>
		<AttributeSelect
			bind:value={p.args.comparison}
			options={['>', '>=', '<', '<=']}
			optionsDisplay={['value > t', 'value ≥ t', 'value < t', 'value ≤ t']}
		/>
	</div>
	<ControlInput label="Threshold (t)">
		<NumberWithUnits bind:value={p.args.threshold} onInput={recompute} step="0.1" />
	</ControlInput>
</div>

{#if p.args.out.binary >= 0}
	<details open>
		<summary class="section-details-summary">Output (0 / 1)</summary>
		<ColumnComponent col={getColumnById(p.args.out.binary)} />
	</details>
{:else}
	<p>Select a column to threshold.</p>
{/if}
