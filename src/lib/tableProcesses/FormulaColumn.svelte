<script module>
	import { core, getStoredValue } from '$lib/core/core.svelte';

	export const formulacolumn_displayName = 'Formula Column';

	export const formulacolumn_defaults = new Map([
		['tokens', { val: [] }],
		['out', { result: { val: -1 } }],
		['valid', { val: false }]
	]);

	export function formulacolumn(argsIN) {
		const tokens = argsIN.tokens ?? [];

		// Need at least one column token referencing a real column
		const colTokens = tokens.filter((t) => t.type === 'col' && t.id >= 0);
		if (colTokens.length === 0) return [[], false];

		// Validate all referenced columns exist
		for (const t of colTokens) {
			if (!getColumnById(t.id)) return [[], false];
		}

		// Validate stored value tokens
		const svTokens = tokens.filter((t) => t.type === 'stored');
		for (const t of svTokens) {
			if (!(t.key in core.storedValues)) return [[], false];
		}

		// Build the JS expression: text tokens become literal text,
		// col tokens become __colN[i] references,
		// stored value tokens become __sv_KEY (scalar)
		const formulaExpr = tokens
			.map((t) => {
				if (t.type === 'text') return t.value ?? '';
				if (t.type === 'col') return `__col${t.id}[i]`;
				if (t.type === 'stored') return `__sv_${t.key.replace(/[^a-zA-Z0-9_]/g, '_')}`;
				return '';
			})
			.join('');

		if (!formulaExpr.trim()) return [[], false];

		// Collect unique column IDs and their data arrays
		const colIds = [...new Set(colTokens.map((t) => t.id))];
		const firstData = getColumnById(colIds[0]).getData();
		if (!firstData || firstData.length === 0) return [[], false];
		const n = firstData.length;

		// Collect unique stored value keys
		const svKeys = [...new Set(svTokens.map((t) => t.key))];

		let result;
		try {
			const paramNames = colIds.map((id) => `__col${id}`);
			const paramValues = colIds.map((id) => getColumnById(id).getData());
			const svParamNames = svKeys.map((k) => `__sv_${k.replace(/[^a-zA-Z0-9_]/g, '_')}`);
			const svParamValues = svKeys.map((k) => getStoredValue(k));
			// eslint-disable-next-line no-new-func
			const fn = new Function(
				...paramNames,
				...svParamNames,
				'Math',
				`"use strict";
const _r = new Array(${n});
for (let i = 0; i < ${n}; i++) { _r[i] = (${formulaExpr}); }
return _r;`
			);
			result = fn(...paramValues, ...svParamValues, Math);
		} catch (e) {
			console.warn('Formula evaluation error:', e.message);
			return [[], false];
		}

		if (argsIN.out.result !== -1) {
			core.rawData.set(argsIN.out.result, result);
			getColumnById(argsIN.out.result).data = argsIN.out.result;
			getColumnById(argsIN.out.result).type = typeof result[0] === 'string' ? 'category' : 'number';
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
	import { onMount, tick, untrack } from 'svelte';

	let { p = $bindable() } = $props();

	// Ensure tokens array is always initialised and ends with a text token
	if (!p.args.tokens || p.args.tokens.length === 0) {
		p.args.tokens = [{ type: 'text', value: '' }];
	} else if (p.args.tokens[p.args.tokens.length - 1]?.type !== 'text') {
		p.args.tokens.push({ type: 'text', value: '' });
	}

	// ── Reactivity ───────────────────────────────────────────────────────────
	let allColIds = $derived.by(() =>
		(p.args.tokens ?? []).filter((t) => t.type === 'col' && t.id >= 0).map((t) => t.id)
	);

	let getHash = $derived.by(
		() => {
			const svHash = Object.keys(core.storedValues)
				.map((k) => `${k}:${getStoredValue(k)}`)
				.join(',');
			return allColIds.map((id) => getColumnById(id)?.getDataHash ?? '').join('|') +
				JSON.stringify(p.args.tokens) +
				svHash;
		}
	);

	let lastHash = '';
	let mounted = $state(false);
	$effect(() => {
		const h = getHash;
		if (!mounted) return;
		if (lastHash !== h) {
			untrack(() => {
				doFormula();
			});
			lastHash = h;
		}
	});

	let result = $state([]);
	let formulaError = $state('');

	function doFormula() {
		try {
			[result, p.args.valid] = formulacolumn(p.args);
			formulaError = p.args.valid ? '' : formulaError;
		} catch (e) {
			formulaError = e.message;
			p.args.valid = false;
		}

		// Clear the output column whenever the formula is invalid
		if (!p.args.valid) {
			const outId = p.args.out?.result;
			if (outId !== undefined && outId !== -1) {
				core.rawData.set(outId, []);
			}
		}
	}

	// ── Available columns list ────────────────────────────────────────────────
	let allColumns = $derived.by(() => {
		const seen = new Set();
		const cols = [];
		for (const table of core.tables) {
			for (const proc of table.processes) {
				for (const key of Object.keys(proc.args.out)) {
					const id = proc.args.out[key];
					if (id >= 0 && !seen.has(id)) {
						const col = getColumnById(id);
						if (col) {
							seen.add(id);
							cols.push({ id: col.id, name: col.name, tableName: table.name });
						}
					}
				}
			}
			for (const col of table.columns) {
				if (!seen.has(col.id)) {
					seen.add(col.id);
					cols.push({ id: col.id, name: col.name, tableName: table.name });
				}
			}
		}
		return cols;
	});

	// ── Autocomplete state ────────────────────────────────────────────────────
	let ac = $state({ show: false, tokenIndex: -1, filter: '', triggerStart: -1, selIdx: 0, mode: 'col' });

	let allStoredValues = $derived(Object.entries(core.storedValues).map(([key, entry]) => ({ key, value: getStoredValue(key), source: entry.source })));

	let filteredColumns = $derived.by(() => {
		if (!ac.show || ac.mode !== 'col') return [];
		if (!ac.filter) return allColumns;
		const f = ac.filter.toLowerCase();
		return allColumns.filter(
			(c) => c.name.toLowerCase().includes(f) || c.tableName.toLowerCase().includes(f)
		);
	});

	let filteredStoredValues = $derived.by(() => {
		if (!ac.show || ac.mode !== 'stored') return [];
		if (!ac.filter) return allStoredValues;
		const f = ac.filter.toLowerCase();
		return allStoredValues.filter((sv) => sv.key.toLowerCase().includes(f));
	});

	let acItems = $derived(ac.mode === 'col' ? filteredColumns : filteredStoredValues);

	function closeAc() {
		ac = { show: false, tokenIndex: -1, filter: '', triggerStart: -1, selIdx: 0, mode: 'col' };
	}

	function handleTextInput(e, tokenIndex) {
		// Update the bound token value first, then trigger formula
		doFormula();

		const input = e.target;
		const val = input.value;
		const cursor = input.selectionStart ?? val.length;

		// Walk backward from cursor for $, @ (column) or # (stored value) — stop at whitespace
		let triggerPos = -1;
		let mode = 'col';
		for (let i = cursor - 1; i >= 0; i--) {
			if (val[i] === '$' || val[i] === '@') {
				triggerPos = i;
				mode = 'col';
				break;
			}
			if (val[i] === '#') {
				triggerPos = i;
				mode = 'stored';
				break;
			}
			if (val[i] === ' ') break;
		}

		if (triggerPos >= 0) {
			const filter = val.slice(triggerPos + 1, cursor);
			ac = { show: true, tokenIndex, filter, triggerStart: triggerPos, selIdx: 0, mode };
		} else {
			closeAc();
		}
	}

	function handleTextKeydown(e, tokenIndex) {
		// Backspace at start of empty text token → remove preceding chip
		if (e.key === 'Backspace' && !e.target.value) {
			if (tokenIndex > 0 && (p.args.tokens[tokenIndex - 1]?.type === 'col' || p.args.tokens[tokenIndex - 1]?.type === 'stored')) {
				e.preventDefault();
				removeToken(tokenIndex - 1);
				// Focus the now-merged token (which has the same index after removal)
				tick().then(() => focusTextToken(tokenIndex - 1));
				return;
			}
		}

		if (!ac.show) return;

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			ac.selIdx = Math.min(ac.selIdx + 1, acItems.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			ac.selIdx = Math.max(ac.selIdx - 1, 0);
		} else if (e.key === 'Enter' || e.key === 'Tab') {
			if (acItems.length > 0) {
				e.preventDefault();
				if (ac.mode === 'col') {
					commitColumn(acItems[ac.selIdx].id, tokenIndex);
				} else {
					commitStoredValue(acItems[ac.selIdx].key, tokenIndex);
				}
			} else {
				closeAc();
			}
		} else if (e.key === 'Escape') {
			e.preventDefault();
			closeAc();
		}
	}

	// Insert a column chip, replacing the trigger+filter text in the token
	function commitColumn(colId, tokenIndexOverride) {
		const idx = tokenIndexOverride ?? ac.tokenIndex;
		const token = p.args.tokens[idx];
		if (!token || token.type !== 'text') return;

		const filterEnd = ac.triggerStart + 1 + ac.filter.length;
		const before = token.value.slice(0, ac.triggerStart);
		const after = token.value.slice(filterEnd);

		p.args.tokens.splice(
			idx,
			1,
			{ type: 'text', value: before },
			{ type: 'col', id: colId },
			{ type: 'text', value: after }
		);
		mergeAdjacentTextTokens();
		closeAc();
		doFormula();

		// Focus the text input after the newly inserted chip
		tick().then(() => {
			const newTextIdx = p.args.tokens.findIndex((t, i) => i >= idx + 2 && t.type === 'text');
			if (newTextIdx >= 0) focusTextToken(newTextIdx);
		});
	}

	// Insert a stored value chip, replacing the trigger+filter text in the token
	function commitStoredValue(key, tokenIndexOverride) {
		const idx = tokenIndexOverride ?? ac.tokenIndex;
		const token = p.args.tokens[idx];
		if (!token || token.type !== 'text') return;

		const filterEnd = ac.triggerStart + 1 + ac.filter.length;
		const before = token.value.slice(0, ac.triggerStart);
		const after = token.value.slice(filterEnd);

		p.args.tokens.splice(
			idx,
			1,
			{ type: 'text', value: before },
			{ type: 'stored', key },
			{ type: 'text', value: after }
		);
		mergeAdjacentTextTokens();
		closeAc();
		doFormula();

		tick().then(() => {
			const newTextIdx = p.args.tokens.findIndex((t, i) => i >= idx + 2 && t.type === 'text');
			if (newTextIdx >= 0) focusTextToken(newTextIdx);
		});
	}

	// Map of token index → input element
	let inputEls = {};

	function focusTextToken(tokenIndex) {
		inputEls[tokenIndex]?.focus();
	}

	function removeToken(i) {
		p.args.tokens.splice(i, 1);
		mergeAdjacentTextTokens();
		doFormula();
	}

	function mergeAdjacentTextTokens() {
		const tokens = p.args.tokens;
		for (let i = tokens.length - 2; i >= 0; i--) {
			if (tokens[i].type === 'text' && tokens[i + 1].type === 'text') {
				tokens[i].value = (tokens[i].value ?? '') + (tokens[i + 1].value ?? '');
				tokens.splice(i + 1, 1);
			}
		}
		if (tokens.length === 0) {
			tokens.push({ type: 'text', value: '' });
		}
		// Always keep a trailing text token so the cursor can be placed after the last chip
		if (tokens[tokens.length - 1]?.type !== 'text') {
			tokens.push({ type: 'text', value: '' });
		}
	}

	onMount(() => {
		const outKey = p.args.out.result;
		if (outKey >= 0 && core.rawData.has(outKey) && core.rawData.get(outKey).length > 0) {
			result = core.rawData.get(outKey);
			p.args.valid = true;
			lastHash = getHash;
		}
		mounted = true;
	});
</script>

<!-- Close autocomplete on outside click -->
<svelte:window
	onclick={(e) => {
		if (ac.show && !e.target.closest('.formula-editor-wrap')) closeAc();
	}}
/>

<div style="display: block;">
	<div class="section-row">
		<div class="tableProcess-label">
			<span>Formula</span>
		</div>
	</div>

	<div class="formula-editor-wrap">
		<!-- Formula editor: inline tokens (text inputs + column/stored value chips) -->
		<div class="formula-editor">
			{#each p.args.tokens as token, i}
				{#if token.type === 'text'}
					<input
						type="text"
						class="formula-text-input"
						bind:this={inputEls[i]}
						bind:value={token.value}
						size={Math.max(2, (token.value?.length ?? 0) + 1)}
						oninput={(e) => handleTextInput(e, i)}
						onkeydown={(e) => handleTextKeydown(e, i)}
						onfocus={() => {
							if (ac.show && ac.tokenIndex !== i) closeAc();
						}}
						placeholder={p.args.tokens.length === 1 ? 'e.g.  2 *  ($ @ for columns, # for values)' : ''}
					/>
				{:else if token.type === 'col'}
					<span class="chip">
						{getColumnById(token.id)?.name ?? '(unknown)'}
						<button class="chip-remove" onclick={() => removeToken(i)} title="Remove">×</button>
					</span>
				{:else if token.type === 'stored'}
					<span class="chip chip-stored" title="Stored value: {core.storedValues[token.key]?.value}">
						{token.key}
						<button class="chip-remove" onclick={() => removeToken(i)} title="Remove">×</button>
					</span>
				{/if}
			{/each}
		</div>

		<!-- Inline autocomplete dropdown -->
		{#if ac.show}
			<div class="ac-dropdown" role="listbox">
				{#if ac.mode === 'col'}
					{#if filteredColumns.length === 0}
						<div class="ac-empty">No matching columns</div>
					{:else}
						{#each filteredColumns as col, j}
							<div
								class="ac-item"
								class:ac-selected={j === ac.selIdx}
								role="option"
								aria-selected={j === ac.selIdx}
								onmousedown={(e) => {
									e.preventDefault();
									commitColumn(col.id, ac.tokenIndex);
								}}
								onmouseenter={() => (ac.selIdx = j)}
							>
								<span class="ac-col-name">{col.name}</span>
								<span class="ac-table-name">{col.tableName}</span>
							</div>
						{/each}
					{/if}
				{:else}
					{#if filteredStoredValues.length === 0}
						<div class="ac-empty">No matching stored values</div>
					{:else}
						{#each filteredStoredValues as sv, j}
							<div
								class="ac-item"
								class:ac-selected={j === ac.selIdx}
								role="option"
								aria-selected={j === ac.selIdx}
								onmousedown={(e) => {
									e.preventDefault();
									commitStoredValue(sv.key, ac.tokenIndex);
								}}
								onmouseenter={() => (ac.selIdx = j)}
							>
								<span class="ac-col-name">{sv.key}</span>
								<span class="ac-table-name">= {sv.value}</span>
							</div>
						{/each}
					{/if}
				{/if}
			</div>
		{/if}
	</div>

	<p class="formula-hint">Tip: type <kbd>$</kbd> or <kbd>@</kbd> for columns, <kbd>#</kbd> for stored values</p>

	{#if formulaError}
		<p class="formula-error">{formulaError}</p>
	{/if}

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

<style>
	.formula-editor-wrap {
		position: relative;
		width: 100%;
	}

	.formula-editor {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem;
		padding: 0.35rem 0.4rem;
		border: 1px solid var(--color-lightness-85);
		border-radius: 4px;
		background-color: var(--color-lightness-97);
		min-height: 2rem;
		cursor: text;
	}

	.formula-text-input {
		border: none;
		background: transparent;
		font-size: 13px;
		font-family: monospace;
		outline: none;
		padding: 0.1rem 0.1rem;
		min-width: 2ch;
	}

	/* auto-resize: the 'size' attribute drives width */
	.formula-text-input:first-child:last-child {
		flex: 1 1 auto; /* only expand when it's the sole element */
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		padding: 0.15rem 0.4rem 0.15rem 0.55rem;
		border-radius: 999px;
		background-color: #4a90d966;
		color: #1a3a5c;
		font-size: 12px;
		font-weight: 600;
		white-space: nowrap;
		user-select: none;
	}

	.chip-stored {
		background-color: #90d94a66;
		color: #2a5c1a;
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
	}

	.chip-remove:hover {
		opacity: 1;
	}

	/* ── Autocomplete dropdown ── */
	.ac-dropdown {
		position: absolute;
		top: calc(100% + 2px);
		left: 0;
		width: 100%;
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

	.ac-col-name {
		font-weight: 600;
	}

	.ac-table-name {
		font-size: 11px;
		color: var(--color-lightness-55, #777);
	}

	.ac-empty {
		padding: 0.4rem 0.6rem;
		font-size: 13px;
		color: var(--color-lightness-55, #777);
		font-style: italic;
	}

	/* ── Hints & errors ── */
	.formula-hint {
		font-size: 11px;
		color: var(--color-lightness-55, #888);
		margin: 0.2rem 0 0 0;
	}

	.formula-hint kbd {
		background: var(--color-lightness-85, #ddd);
		border-radius: 3px;
		padding: 0.05rem 0.3rem;
		font-size: 11px;
		font-family: monospace;
	}

	.formula-error {
		color: #c0392b;
		font-size: 12px;
		margin: 0.25rem 0;
	}
</style>
