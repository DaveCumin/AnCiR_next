<script module>
	import { core } from '$lib/core/core.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';

	export const random_defaults = new Map([
		['offset', { val: 0 }],
		['multiply', { val: 10 }],
		['N', { val: 10 }],
		['out', { result: { val: -1 } }], //needed to set upu the output columns
		['valid', { val: false }] //needed for the progress step logic
	]);

	export function random(argsIN) {
		let result = [];
		for (let i = 0; i < argsIN.N; i++) {
			result.push(Number((argsIN.offset + Math.random() * argsIN.multiply).toFixed(2)));
		}
		if (argsIN.out.result == -1 || !argsIN.out.result) {
		} else {
			core.rawData.set(argsIN.out.result, result);
			getColumnById(argsIN.out.result).data = argsIN.out.result;
			getColumnById(argsIN.out.result).type = typeof result[0] != 'number' ? 'category' : 'number';

			const processHash = crypto.randomUUID();
			getColumnById(argsIN.out.result).tableProcessGUId = processHash;
		}

		return [result, result.length > 0];
	}
</script>

<script>
	import ColumnComponent from '$lib/core/Column.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';

	import { getColumnById } from '$lib/core/Column.svelte';
	import { onMount } from 'svelte';

	let { p = $bindable() } = $props();

	let result = $state();
	let previewStart = $state(1);
	function doRandom() {
		previewStart = 1;
		[result, p.args.valid] = random(p.args);
	}
	onMount(() => {
		//If data already exists (e.g. imported from JSON), use it instead of regenerating
		const outKey = p.args.out.result;
		if (outKey >= 0 && core.rawData.has(outKey) && core.rawData.get(outKey).length > 0) {
			result = core.rawData.get(outKey);
			p.args.valid = true;
		} else {
			doRandom();
		}
	});
</script>

<div class="section-row">
	<div class="tableProcess-label">
		<span>Random settings</span>
	</div>

	<div class="control-input-vertical">
		<div class="control-input">
			<p>Offset</p>
			<NumberWithUnits bind:value={p.args.offset} onInput={doRandom} />
		</div>
		<div class="control-input">
			<p>Multiply</p>
			<NumberWithUnits bind:value={p.args.multiply} onInput={doRandom} />
		</div>
	</div>
</div>

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
