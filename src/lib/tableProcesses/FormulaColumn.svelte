<script module>
	import { core } from '$lib/core/core.svelte';

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

		// Build the JS expression: text tokens become literal text,
		// col tokens become __colN[i] references
		const formulaExpr = tokens
			.map((t) => {
				if (t.type === 'text') return t.value ?? '';
				if (t.type === 'col') return `__col${t.id}[i]`;
				return '';
			})
			.join('');

		if (!formulaExpr.trim()) return [[], false];

		// Collect unique column IDs and their data arrays
		const colIds = [...new Set(colTokens.map((t) => t.id))];
		const firstData = getColumnById(colIds[0]).getData();
		if (!firstData || firstData.length === 0) return [[], false];
		const n = firstData.length;

		let result;
		try {
			const paramNames = colIds.map((id) => `__col${id}`);
			const paramValues = colIds.map((id) => getColumnById(id).getData());
			// eslint-disable-next-line no-new-func
			const fn = new Function(
				...paramNames,
				'Math',
				`"use strict";
const _r = new Array(${n});
for (let i = 0; i < ${n}; i++) { _r[i] = (${formulaExpr}); }
return _r;`
			);
			result = fn(...paramValues, Math);
		} catch (e) {
			console.warn('Formula evaluation error:', e.message);
			return [[], false];
		}

		if (argsIN.out.result !== -1) {
			core.rawData.set(argsIN.out.result, result);
			getColumnById(argsIN.out.result).data = argsIN.out.result;
			getColumnById(argsIN.out.result).type =
				typeof result[0] === 'string' ? 'category' : 'number';
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

	// Ensure tokens array is always initialised
	if (!p.args.tokens || p.args.tokens.length === 0) {
		p.args.tokens = [{ type: 'text', value: '' }];
	}

	// Derived reactivity hash so $effect can detect column-data changes
	let allColIds = $derived.by(() =>
		(p.args.tokens ?? []).filter((t) => t.type === 'col' && t.id >= 0).map((t) => t.id)
	);

	let getHash = $derived.by(
		() =>
			allColIds.map((id) => getColumnById(id)?.getDataHash ?? '').join('|') +
			JSON.stringify(p.args.tokens)
	);

	let lastHash = '';
	$effect(() => {
		const h = getHash;
		if (lastHash !== h) {
			doFormula();
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
	}

	// ── Column chip insertion ──────────────────────────────────────────────────
	let selectedColId = $state(-1);

	function insertColumnChip() {
		if (selectedColId < 0) return;
		const tokens = p.args.tokens;

		// Ensure there is a text token at the end before appending the chip
		if (tokens.length === 0 || tokens[tokens.length - 1].type === 'col') {
			tokens.push({ type: 'text', value: '' });
		}
		tokens.push({ type: 'col', id: Number(selectedColId) });
		tokens.push({ type: 'text', value: '' });

		selectedColId = -1;
		doFormula();
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
	}

	onMount(() => {
		const outKey = p.args.out.result;
		if (outKey >= 0 && core.rawData.has(outKey) && core.rawData.get(outKey).length > 0) {
			result = core.rawData.get(outKey);
			p.args.valid = true;
			lastHash = getHash;
		} else {
			doFormula();
		}
	});
</script>

<div style="display: block;">
	<div class="section-row">
		<div class="tableProcess-label">
			<span>Formula</span>
		</div>
	</div>

	<!-- Formula editor: inline tokens (text inputs + column chips) -->
	<div class="formula-editor">
		{#each p.args.tokens as token, i}
			{#if token.type === 'text'}
				<input
					type="text"
					class="formula-text-input"
					bind:value={token.value}
					oninput={doFormula}
					placeholder={p.args.tokens.length === 1 ? 'e.g.  2 * ' : ''}
				/>
			{:else if token.type === 'col'}
				<span class="chip">
					{getColumnById(token.id)?.name ?? '(unknown)'}
					<button class="chip-remove" onclick={() => removeToken(i)} title="Remove">×</button>
				</span>
			{/if}
		{/each}
	</div>

	<!-- Column selector for inserting chips -->
	<div class="control-input">
		<p>Insert column</p>
		<ColumnSelector
			bind:value={selectedColId}
			onChange={(v) => {
				selectedColId = Number(v);
				if (selectedColId >= 0) insertColumnChip();
			}}
		/>
	</div>

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
	}

	.formula-text-input {
		border: none;
		background: transparent;
		font-size: 13px;
		font-family: monospace;
		outline: none;
		min-width: 3ch;
		width: auto;
		flex: 1 1 auto;
		padding: 0.1rem 0.2rem;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		padding: 0.15rem 0.5rem 0.15rem 0.55rem;
		border-radius: 999px;
		background-color: var(--color-lightness-85, #ddd);
		font-size: 12px;
		font-weight: 500;
		white-space: nowrap;
		user-select: none;
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

	.formula-error {
		color: #c0392b;
		font-size: 12px;
		margin: 0.25rem 0;
	}
</style>
