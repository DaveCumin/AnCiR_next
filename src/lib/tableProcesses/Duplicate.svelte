<script module>
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
			getColumnById(argsIN.out.result).data = result;
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

	import { getColumnById } from '$lib/core/Column.svelte';
	import { onMount } from 'svelte';

	let { p = $bindable() } = $props();

	// for reactivity -----------
	let xIN_col = $derived.by(() => (p.args.xIN >= 0 ? getColumnById(p.args.xIN) : null));
	let getHash = $derived.by(() => {
		let out = '';
		out += xIN_col?.getDataHash;
		return out;
	});
	let lastHash = '';
	$effect(() => {
		const dataHash = getHash;
		if (lastHash === dataHash) {
			//do nothing
		} else {
			doDuplicate(); // DO THE BUSINESS
			lastHash = getHash;
		}
	});
	//------------
	let result = $state();
	function doDuplicate() {
		[result, p.args.valid] = duplicate(p.args);
	}
	onMount(() => {
		//needed to get the values when it first mounts
		doDuplicate();
	});
</script>

<div class="tableProcess-container">
	<!-- Input Section -->
	<div class="section-row">
		<div class="tableProcess-label">
			<span>Duplicate</span>
		</div>
	</div>
	<ColumnSelector
		bind:value={p.args.xIN}
		onChange={() => {
			doDuplicate();
		}}
	/>

	{#if p.args.valid && p.args.out.result == -1}
		<p>Preview:</p>
		<div style="height:250px; overflow:auto;"><Table headers={['Result']} data={[result]} /></div>
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
