<script module>
	import { core } from '$lib/core/core.svelte';

	export const blankcolumn_displayName = 'Blank Column';
	export const blankcolumn_defaults = new Map([
		['N', { val: 10 }],
		['out', { result: { val: -1 } }],
		['valid', { val: false }]
	]);

	export function blankcolumn(argsIN) {
		const count = Math.max(0, Math.floor(Number(argsIN.N)));
		let result = new Array(count).fill('');

		if (argsIN.out.result === -1 || !argsIN.out.result) {
			// preview only
		} else {
			// Preserve existing data if present and only resize
			const existing = core.rawData.get(argsIN.out.result);
			if (existing && Array.isArray(existing)) {
				if (existing.length < count) {
					result = [...existing, ...new Array(count - existing.length).fill('')];
				} else {
					result = existing.slice(0, count);
				}
			}
			core.rawData.set(argsIN.out.result, result);
			getColumnById(argsIN.out.result).data = argsIN.out.result;
			getColumnById(argsIN.out.result).type = 'category';
			const processHash = crypto.randomUUID();
			getColumnById(argsIN.out.result).tableProcessGUId = processHash;
		}

		return [result, true];
	}
</script>

<script>
	import ColumnComponent from '$lib/core/Column.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import { onMount } from 'svelte';

	let { p = $bindable() } = $props();

	let result = $state([]);
	let editableData = $state([]);

	function doBlank() {
		[result, p.args.valid] = blankcolumn(p.args);
		editableData = [...result];
	}

	onMount(() => {
		const outKey = p.args.out.result;
		if (outKey >= 0 && core.rawData.has(outKey) && core.rawData.get(outKey).length > 0) {
			result = core.rawData.get(outKey);
			editableData = [...result];
			p.args.valid = true;
		} else {
			doBlank();
		}
	});

	function updateCell(index, value) {
		editableData[index] = value;
		commitData();
	}

	function commitData() {
		if (p.args.out.result >= 0) {
			// Try to detect numeric data
			const allNumeric = editableData.every(
				(v) => v === '' || (!isNaN(Number(v)) && v !== '')
			);
			const col = getColumnById(p.args.out.result);
			if (allNumeric && editableData.some((v) => v !== '')) {
				const numData = editableData.map((v) => (v === '' ? NaN : Number(v)));
				core.rawData.set(p.args.out.result, numData);
				col.type = 'number';
			} else {
				core.rawData.set(p.args.out.result, [...editableData]);
				col.type = 'category';
			}
			const processHash = crypto.randomUUID();
			col.tableProcessGUId = processHash;
			result = [...editableData];
		}
	}

	function handlePaste(event) {
		event.preventDefault();
		const text = event.clipboardData.getData('text/plain');
		if (!text) return;

		// Split by newlines (handles both \n and \r\n from spreadsheets)
		const lines = text.split(/\r?\n/).filter((line, i, arr) => {
			// Remove trailing empty line that spreadsheets often add
			if (i === arr.length - 1 && line === '') return false;
			return true;
		});

		// Get the index of the currently focused cell
		const target = event.target;
		let startIndex = 0;
		if (target && target.dataset && target.dataset.index !== undefined) {
			startIndex = Number(target.dataset.index);
		}

		// Expand editableData if needed
		const needed = startIndex + lines.length;
		if (needed > editableData.length) {
			const extra = new Array(needed - editableData.length).fill('');
			editableData = [...editableData, ...extra];
			p.args.N = needed;
		}

		// Fill in pasted values
		for (let i = 0; i < lines.length; i++) {
			// Handle tab-separated values: take only the first column
			const cellValue = lines[i].split('\t')[0].trim();
			editableData[startIndex + i] = cellValue;
		}

		editableData = [...editableData]; // trigger reactivity
		commitData();
	}
</script>

<div class="section-row">
	<div class="tableProcess-label">
		<span>Blank column settings</span>
	</div>

	<div class="control-input">
		<p>Number of rows</p>
		<NumberWithUnits bind:value={p.args.N} onInput={doBlank} min={1} step={1} />
	</div>
</div>

{#if p.args.out.result > 0}
	<div class="section-row">
		<div class="tableProcess-label">
			<span>Output</span>
		</div>
	</div>
	<ColumnComponent col={getColumnById(p.args.out.result)} />

	<div class="section-row">
		<div class="tableProcess-label">
			<span>Edit data</span>
		</div>
	</div>
	<p class="hint">Click cells to edit. Paste from a spreadsheet into any cell.</p>
	<div class="editable-table" onpaste={handlePaste}>
		<table>
			<thead>
				<tr><th>Row</th><th>Value</th></tr>
			</thead>
			<tbody>
				{#each editableData as cell, i}
					<tr>
						<td class="row-num">{i + 1}</td>
						<td>
							<input
								type="text"
								value={cell}
								data-index={i}
								oninput={(e) => updateCell(i, e.target.value)}
							/>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{:else}
	<p>Column will be created with {p.args.N} blank rows.</p>
{/if}

<style>
	.hint {
		font-size: 12px;
		color: var(--color-lightness-50, #888);
		margin: 0.25rem 0;
	}

	.editable-table {
		max-height: 300px;
		overflow: auto;
		margin: 0.25rem 0;
	}

	.editable-table table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}

	.editable-table th,
	.editable-table td {
		border: 1px solid var(--color-lightness-85, #ddd);
		padding: 2px 4px;
	}

	.editable-table th {
		background: var(--color-lightness-95, #f5f5f5);
		position: sticky;
		top: 0;
		font-weight: 600;
	}

	.editable-table .row-num {
		width: 40px;
		text-align: center;
		color: var(--color-lightness-50, #888);
		font-size: 11px;
	}

	.editable-table input {
		width: 100%;
		border: none;
		background: transparent;
		padding: 2px;
		font-size: 13px;
		box-sizing: border-box;
	}

	.editable-table input:focus {
		outline: 2px solid var(--color-primary, #007bff);
		outline-offset: -1px;
		background: var(--color-lightness-97, #fafafa);
	}
</style>
