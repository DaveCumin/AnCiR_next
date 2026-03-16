<script module>
	import { core } from '$lib/core/core.svelte';
	export const columnfunctions_displayName = 'Column Function';

	export const columnfunctions_defaults = new Map([
		['func', { val: 'add' }],
		['xsIN', { val: [] }],
		['out', { result: { val: -1 } }], //needed to set up the output columns
		['data', { val: [] }], //Need a 'data' to work
		['valid', { val: false }] //needed for the progress step logic
	]);

	export function columnfunctions(argsIN) {
		if (argsIN.xsIN == undefined || argsIN.xsIN.length == 0) return [[], false];

		const columns = argsIN.xsIN.map((id) => getColumnById(id).getData());
		const n = columns[0].length;
		const nCols = columns.length;
		let result = [];

		switch (argsIN.func) {
			case 'add': {
				const firstType = getColumnById(argsIN.xsIN[0]).type;
				result = [...columns[0]];
				for (let i = 1; i < nCols; i++) {
					const colType = getColumnById(argsIN.xsIN[i]).type;
					result = result.map((x, j) =>
						firstType === 'category' || colType === 'category'
							? x + ' ' + columns[i][j]
							: x + columns[i][j]
					);
				}
				break;
			}
			case 'average': {
				result = new Array(n).fill(0);
				for (let i = 0; i < nCols; i++) {
					result = result.map((x, j) => x + columns[i][j]);
				}
				result = result.map((x) => x / nCols);
				break;
			}
			case 'min': {
				result = [...columns[0]];
				for (let i = 1; i < nCols; i++) {
					result = result.map((x, j) => Math.min(x, columns[i][j]));
				}
				break;
			}
			case 'max': {
				result = [...columns[0]];
				for (let i = 1; i < nCols; i++) {
					result = result.map((x, j) => Math.max(x, columns[i][j]));
				}
				break;
			}
			case 'sd': {
				// Element-wise SD across selected columns for each row (sample SD, n-1)
				result = new Array(n).fill(0).map((_, j) => {
					if (nCols < 2) return 0;
					const vals = columns.map((col) => col[j]);
					const mean = vals.reduce((a, b) => a + b, 0) / nCols;
					const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (nCols - 1);
					return Math.sqrt(variance);
				});
				break;
			}
			default:
				return [[], false];
		}

		if (argsIN.out.result !== -1) {
			core.rawData.set(argsIN.out.result, result);
			getColumnById(argsIN.out.result).data = argsIN.out.result;
			getColumnById(argsIN.out.result).type = typeof result[0] !== 'string' ? 'category' : 'number';
			getColumnById(argsIN.out.result).tableProcessGUId = crypto.randomUUID();
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

	const funcOptions = [
		{ value: 'add', label: 'Add' },
		{ value: 'average', label: 'Average' },
		{ value: 'min', label: 'Min' },
		{ value: 'max', label: 'Max' },
		{ value: 'sd', label: 'SD (sample)' }
	];

	let separator = $derived(p.args.func === 'add' ? '+' : ',');

	// for reactivity -----------
	let xIN_cols = $derived.by(() => {
		if (!p.args.xsIN) return null;
		else return p.args.xsIN.map((id) => getColumnById(id));
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
				doColumnFunction();
			});
			lastHash = dataHash;
		}
	});
	//------------

	let result = $state();
	let previewStart = $state(1);

	function doColumnFunction() {
		previewStart = 1;
		[result, p.args.valid] = columnfunctions(p.args);
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
			<span>Column Function</span>
		</div>
	</div>
	<div class="control-input">
		<p>Function</p>
		<select
			bind:value={p.args.func}
			onchange={() => doColumnFunction()}
			disabled={p.args.out.result > 0}
		>
			{#each funcOptions as opt}
				<option value={opt.value}>{opt.label}</option>
			{/each}
		</select>
	</div>
	<div class="control-input">
		<p>Columns</p>
	</div>
	<ColumnSelector
		bind:value={p.args.xsIN}
		onChange={() => doColumnFunction()}
		multiple={true}
	/>

	{#each p.args.xsIN as _, i}
		<a>{getColumnById(p.args.xsIN[i]).name}</a>
		<button
			onclick={() => {
				p.args.xsIN.splice(i, 1);
				doColumnFunction();
			}}>-</button
		>
		{#if p.args.xsIN.length > 1 && i < p.args.xsIN.length - 1}
			<a>{separator}</a>
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
