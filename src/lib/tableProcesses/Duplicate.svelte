<script module>
	import { core } from '$lib/core/core.svelte';
	export const duplicate_defaults = new Map([
		['xIN', { val: -1 }],
		['out', { result: { val: -1 } }], //needed to setup the output columns
		['data', { val: [] }], //Need a 'data' to work
		['valid', { val: false }] //needed for the progress step logic
	]);

	export function duplicate(argsIN) {
		if (argsIN.xIN == undefined || argsIN.xIN == -1) return [[], false]; //if there is no input yet

		let result = [];
		result = getColumnById(argsIN.xIN).getData();

		if (argsIN.out.result == -1 || !argsIN.out.result) {
			//do nothing
		} else {
			core.rawData.set(argsIN.out.result, result); //duplicate the data array
			getColumnById(argsIN.out.result).data = argsIN.out.result;
			getColumnById(argsIN.out.result).type = getColumnById(argsIN.xIN).type;
			const processHash = crypto.randomUUID();
			getColumnById(argsIN.out.result).tableProcessGUId = processHash;
		}

		return [result, result.length > 0];
	}
</script>

<script>
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';

	import { getColumnById } from '$lib/core/Column.svelte';
	import { formatTimeFromUNIX } from '$lib/utils/time/TimeUtils';
	import { onMount, untrack } from 'svelte';

	let { p = $bindable() } = $props();

	// for reactivity -----------
	let xIN_col = $derived.by(() => (p.args.xIN >= 0 ? getColumnById(p.args.xIN) : null));
	let getHash = $derived.by(() => {
		let out = '';
		out += xIN_col?.getDataHash;
		return out;
	});
	let lastHash = '';
	let mounted = $state(false);
	$effect(() => {
		const dataHash = getHash;
		if (!mounted) return;
		if (lastHash !== dataHash) {
			untrack(() => {
				doDuplicate();
			});
			lastHash = dataHash;
		}
	});
	//------------
	let result = $state();
	let previewStart = $state(1);
	let displayResult = $derived(
		result && xIN_col?.type === 'time'
			? result.map((v) => formatTimeFromUNIX(v))
			: result
	);
	function doDuplicate() {
		previewStart = 1;
		[result, p.args.valid] = duplicate(p.args);
	}
	onMount(() => {
		//If data already exists (e.g. imported from JSON), use it instead of regenerating
		const outKey = p.args.out.result;
		if (outKey >= 0 && core.rawData.has(outKey) && core.rawData.get(outKey).length > 0) {
			result = core.rawData.get(outKey);
			p.args.valid = true;
			lastHash = getHash; // prevent $effect from recalculating
		}
		mounted = true;
	});
</script>

<!-- Input Section -->
<div class="section-row">
	<div class="tableProcess-label">
		<span>Duplicate</span>
	</div>

	<ColumnSelector
		bind:value={p.args.xIN}
		onChange={() => {
			doDuplicate();
		}}
	/>
</div>
{#if p.args.valid && p.args.out.result == -1}
	{@const totalRows = result.length}
	<p>Preview:</p>
	<Table headers={['Result']} data={[displayResult.slice(previewStart - 1, previewStart + 5)]} />
	<p>Row <NumberWithUnits min={1} max={Math.max(1, totalRows - 5)} step={1} bind:value={previewStart} /> to {Math.min(previewStart + 5, totalRows)} of {totalRows}</p>
{:else if p.args.out.result > 0}
	<div class="section-row">
		<div class="tableProcess-label">
			<span>Output</span>
		</div>
	</div>
	<ColumnComponent col={getColumnById(p.args.out.result)} />
{:else}
	<p>Need to have valid inputs to create columns.</p>
{/if}
