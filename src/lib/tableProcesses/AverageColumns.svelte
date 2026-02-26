<script module>
	import { core } from '$lib/core/core.svelte';
	export const averagecolumns_defaults = new Map([
		['xsIN', { val: [] }],
		['out', { result: { val: -1 } }], //needed to set upu the output columns
		['valid', { val: false }] //needed for the progress step logic
	]);

	export function averagecolumns(argsIN) {
		if (argsIN.xsIN == undefined || argsIN.xsIN.length == 0) return [0, false]; //if there is no input yet

		let result = [];
		result = getColumnById(argsIN.xsIN[0]).getData();
		for (let i = 1; i < argsIN.xsIN.length; i++) {
			const temp = getColumnById(argsIN.xsIN[i]).getData();
			result = result.map((x, i) => x + temp[i]);
		}
		result = result.map((x, i) => x / argsIN.xsIN.length);

		if (argsIN.out.result == -1) {
		} else {
			core.rawData.set(argsIN.out.result, result);
			getColumnById(argsIN.out.result).data = argsIN.out.result;

			getColumnById(argsIN.out.result).type = typeof result[0] != 'string' ? 'category' : 'number';
			const processHash = crypto.randomUUID();
			getColumnById(argsIN.out.result).tableProcessGUId = processHash;
		}

		return [result, result.length > 0];
	}
</script>

<script>
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';
	import { onMount, untrack } from 'svelte';

	let { p = $bindable() } = $props();

	// for reactivity -----------
	let xIN_cols = $derived.by(() => {
		if (!p.args.xsIN) return null;
		else {
			return p.args.xsIN.map((id) => getColumnById(id));
		}
	});
	let getHash = $derived.by(() => {
		let out = '';
		out += xIN_cols.map((c) => c?.getDataHash).join('|');
		return out;
	});
	let lastHash = '';
	let mounted = $state(false);
	$effect(() => {
		const dataHash = getHash;
		if (!mounted) return;
		if (lastHash !== dataHash) {
			untrack(() => {
				doAverageColumns();
			});
			lastHash = dataHash;
		}
	});
	//------------

	let result = $state();
	let previewStart = $state(1);
	function doAverageColumns() {
		previewStart = 1;
		[result, p.args.valid] = averagecolumns(p.args);
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

<div style="display: block;">
	<div class="section-row">
		<div class="tableProcess-label">
			<span>Average</span>
		</div>
	</div>
	<div class="control-input">
		<p>Columns</p>
	</div>
	<ColumnSelector
		bind:value={p.args.xsIN}
		onChange={() => {
			doAverageColumns();
		}}
		multiple={true}
	/>
	{#each p.args.xsIN as _, i}
		<a>{getColumnById(p.args.xsIN[i]).name}</a>
		<button
			onclick={() => {
				p.args.xsIN.splice(i, 1);
				doAverageColumns();
			}}>-</button
		>
		{#if p.args.xsIN.length > 1 && i < p.args.xsIN.length - 1}
			<a>,</a>
		{/if}
	{/each}

	{#if p.args.valid && p.args.out.result == -1}
		{@const totalRows = result.length}
		<p>Preview:</p>
		<Table headers={['Result']} data={[result.slice(previewStart - 1, previewStart + 5)]} />
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
</div>
