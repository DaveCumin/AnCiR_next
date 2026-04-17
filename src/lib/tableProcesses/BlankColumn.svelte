<script module>
	import { core, getStoredValue } from '$lib/core/core.svelte';

	const displayName = 'Blank Column';
	const defaults = new Map([
		['N', { val: 10 }],
		['storedValueRefs', { val: {} }],
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
			// Apply stored value references
			const refs = argsIN.storedValueRefs || {};
			for (const [idx, key] of Object.entries(refs)) {
				const i = Number(idx);
				if (i < count && key in core.storedValues) {
					result[i] = getStoredValue(key);
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

	export const definition = { displayName, defaults, func: blankcolumn };
</script>

<script>
	import ColumnComponent from '$lib/core/Column.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import { onMount, untrack } from 'svelte';

	let { p = $bindable() } = $props();

	if (!p.args.storedValueRefs) p.args.storedValueRefs = {};

	let result = $state([]);
	let editableData = $state([]);

	function doBlank() {
		// Clean up stored value refs for rows beyond the new count
		const count = Math.max(0, Math.floor(Number(p.args.N)));
		for (const idx of Object.keys(p.args.storedValueRefs)) {
			if (Number(idx) >= count) delete p.args.storedValueRefs[idx];
		}
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

	// ── Stored value reactivity ──────────────────────────────────────────────
	let svHash = $derived.by(() => {
		const refs = p.args.storedValueRefs || {};
		const keys = [...new Set(Object.values(refs))];
		return keys.map((k) => `${k}:${getStoredValue(k)}`).join(',');
	});

	let lastSvHash = '';
	$effect(() => {
		const h = svHash;
		if (lastSvHash === h) return;
		lastSvHash = h;
		untrack(() => {
			const refs = p.args.storedValueRefs || {};
			let changed = false;
			for (const [idx, key] of Object.entries(refs)) {
				const i = Number(idx);
				if (key in core.storedValues) {
					const val = getStoredValue(key);
					if (editableData[i] !== val) {
						editableData[i] = val;
						changed = true;
					}
				}
			}
			if (changed) {
				editableData = [...editableData];
				commitData();
			}
		});
	});

	// ── Autocomplete state ───────────────────────────────────────────────────
	let ac = $state({ show: false, cellIndex: -1, filter: '', selIdx: 0 });
	let acPos = $state({ left: 0, top: 0 });

	let allStoredValues = $derived(
		Object.entries(core.storedValues).map(([key, entry]) => ({
			key,
			value: getStoredValue(key),
			source: entry.source
		}))
	);

	let filteredStoredValues = $derived.by(() => {
		if (!ac.show) return [];
		if (!ac.filter) return allStoredValues;
		const f = ac.filter.toLowerCase();
		return allStoredValues.filter((sv) => sv.key.toLowerCase().includes(f));
	});

	function closeAc() {
		ac = { show: false, cellIndex: -1, filter: '', selIdx: 0 };
	}

	function handleCellInput(e, index) {
		const val = e.target.value;
		editableData[index] = val;

		const cursor = e.target.selectionStart ?? val.length;
		let triggerPos = -1;
		for (let i = cursor - 1; i >= 0; i--) {
			if (val[i] === '#') {
				triggerPos = i;
				break;
			}
			if (val[i] === ' ') break;
		}

		if (triggerPos >= 0) {
			const filter = val.slice(triggerPos + 1, cursor);
			const rect = e.target.getBoundingClientRect();
			acPos = { left: rect.left, top: rect.bottom + 2 };
			ac = { show: true, cellIndex: index, filter, selIdx: 0 };
		} else {
			closeAc();
			commitData();
		}
	}

	function handleCellKeydown(e, index) {
		if (!ac.show) return;

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			ac.selIdx = Math.min(ac.selIdx + 1, filteredStoredValues.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			ac.selIdx = Math.max(ac.selIdx - 1, 0);
		} else if (e.key === 'Enter' || e.key === 'Tab') {
			if (filteredStoredValues.length > 0) {
				e.preventDefault();
				assignStoredValue(filteredStoredValues[ac.selIdx].key, index);
			} else {
				closeAc();
			}
		} else if (e.key === 'Escape') {
			e.preventDefault();
			closeAc();
			commitData();
		}
	}

	function assignStoredValue(key, index) {
		p.args.storedValueRefs[index] = key;
		editableData[index] = getStoredValue(key);
		editableData = [...editableData];
		closeAc();
		commitData();
	}

	function removeStoredValueRef(index) {
		delete p.args.storedValueRefs[index];
		editableData[index] = '';
		editableData = [...editableData];
		commitData();
	}

	function commitData() {
		if (p.args.out.result >= 0) {
			// Apply stored value refs before committing
			const refs = p.args.storedValueRefs || {};
			for (const [idx, key] of Object.entries(refs)) {
				const i = Number(idx);
				if (key in core.storedValues) {
					editableData[i] = getStoredValue(key);
				}
			}

			// Try to detect numeric data
			const allNumeric = editableData.every((v) => v === '' || !isNaN(Number(v)));
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
			// Handle tab-separated values: take only the first column,
			// since this is a single-column process
			const cellValue = lines[i].split('\t')[0].trim();
			editableData[startIndex + i] = cellValue;
			// Clear any stored value ref for this cell
			delete p.args.storedValueRefs[startIndex + i];
		}

		editableData = [...editableData]; // trigger reactivity
		commitData();
	}
</script>

<!-- Close autocomplete on outside click -->
<svelte:window
	onclick={(e) => {
		if (ac.show && !e.target.closest('.editable-table')) {
			closeAc();
			commitData();
		}
	}}
/>

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
	<p class="hint">
		Click cells to edit. Paste from a spreadsheet into any cell. Type <kbd>#</kbd> for stored values.
	</p>
	<div class="editable-table" onpaste={handlePaste}>
		<table>
			<thead>
				<tr><th>Row</th><th>Value</th></tr>
			</thead>
			<tbody>
				{#each editableData as cell, i (i)}
					<tr>
						<td class="row-num">{i + 1}</td>
						<td>
							{#if p.args.storedValueRefs[i]}
								{@const key = p.args.storedValueRefs[i]}
								{@const exists = key in core.storedValues}
								<span class="chip chip-stored" class:chip-invalid={!exists}>
									<span class="sv-name">{key}</span>
									{#if exists}
										<span class="sv-value">= {getStoredValue(key)}</span>
									{:else}
										<span class="sv-value">(removed)</span>
									{/if}
									<button class="chip-remove" onclick={() => removeStoredValueRef(i)} title="Remove"
										>×</button
									>
								</span>
							{:else}
								<input
									type="text"
									value={cell}
									data-index={i}
									oninput={(e) => handleCellInput(e, i)}
									onkeydown={(e) => handleCellKeydown(e, i)}
								/>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	{#if ac.show}
		<div class="ac-dropdown" style="left: {acPos.left}px; top: {acPos.top}px;" role="listbox">
			{#if filteredStoredValues.length === 0}
				<div class="ac-empty">No matching stored values</div>
			{:else}
				{#each filteredStoredValues as sv, j (sv.key)}
					<div
						class="ac-item"
						class:ac-selected={j === ac.selIdx}
						role="option"
						tabindex="-1"
						aria-selected={j === ac.selIdx}
						onmousedown={(e) => {
							e.preventDefault();
							assignStoredValue(sv.key, ac.cellIndex);
						}}
						onmouseenter={() => (ac.selIdx = j)}
					>
						<span class="ac-sv-name">{sv.key}</span>
						<span class="ac-sv-value">= {sv.value}</span>
					</div>
				{/each}
			{/if}
		</div>
	{/if}
{:else}
	<p>Column will be created with {p.args.N} blank rows.</p>
{/if}

<style>
	.hint {
		font-size: 12px;
		color: var(--color-lightness-50, #888);
		margin: 0.25rem 0;
	}

	.hint kbd {
		background: var(--color-lightness-85, #ddd);
		border-radius: 3px;
		padding: 0.05rem 0.3rem;
		font-size: 11px;
		font-family: monospace;
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

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		padding: 0.15rem 0.4rem 0.15rem 0.55rem;
		border-radius: 999px;
		font-size: 12px;
		font-weight: 600;
		white-space: nowrap;
		user-select: none;
		max-width: 100%;
		overflow: hidden;
	}

	.chip-stored {
		background-color: #90d94a66;
		color: #2a5c1a;
	}

	.chip-invalid {
		background-color: #d94a4a33;
		color: #8b1a1a;
	}

	.sv-name {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.sv-value {
		font-weight: 400;
		font-size: 11px;
		opacity: 0.75;
	}

	.chip-remove {
		background: none;
		border: none;
		cursor: pointer;
		font-size: 14px;
		line-height: 1;
		padding: 0;
		color: inherit;
		opacity: 0.6;
		flex-shrink: 0;
	}

	.chip-remove:hover {
		opacity: 1;
	}

	.ac-dropdown {
		position: fixed;
		width: 220px;
		max-height: 180px;
		overflow-y: auto;
		background: var(--color-lightness-97, #f8f8f8);
		border: 1px solid var(--color-lightness-85, #ccc);
		border-radius: 4px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
		z-index: 200;
	}

	.ac-item {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		padding: 0.35rem 0.6rem;
		cursor: pointer;
		font-size: 13px;
	}

	.ac-item:hover,
	.ac-selected {
		background-color: var(--color-lightness-85, #e0e0e0);
	}

	.ac-sv-name {
		font-weight: 600;
	}

	.ac-sv-value {
		font-size: 11px;
		color: var(--color-lightness-55, #777);
	}

	.ac-empty {
		padding: 0.4rem 0.6rem;
		font-size: 13px;
		color: var(--color-lightness-55, #777);
		font-style: italic;
	}
</style>
