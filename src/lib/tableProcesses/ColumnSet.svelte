<script module>
	// @ts-nocheck
	// Column Set — curate a live subset of wired candidate columns by a name/label
	// rule, and expose that subset as ONE reusable output wire (the `set` port,
	// artifact kind `columnset`). Downstream, a consumer's many-in array stores a
	// `{ setRef }` token; the graph draws a single wire from this node and
	// normalizeYInputs expands it to the selected columns at compute time. See
	// docs/superpowers/specs/2026-07-07-column-set-node-design.md.
	import { selectedColumnIds } from '$lib/tableProcesses/columnSet.js';

	const displayName = 'Column Set';
	const defaults = new Map([
		['colsIN', { val: [] }], // wired candidate column ids (many-in)
		['pattern', { val: '' }], // case-insensitive substring; '' = all
		['matchField', { val: 'either' }], // 'name' | 'label' | 'either'
		['out', {}], // no data-output columns; present so the TableProcess ctor is happy
		['valid', { val: false }]
	]);

	// Pure: returns [selectedColumnIds, valid]. The node produces no data columns —
	// it references existing ones — so `valid` just means "usable as a set".
	export function columnset(argsIN) {
		return [selectedColumnIds(argsIN), true];
	}

	export const definition = {
		displayName,
		defaults,
		func: columnset,
		columnIdFields: { array: ['colsIN'] },
		nodeSpec: {
			id: 'tableprocess.columnset',
			inputs: [{ name: 'colsIN', kind: 'column', cardinality: 'many' }],
			// One bundle output carrying the selected columns. `columnset` kind →
			// rendered as a single `set` port; only connectable to a many-in input.
			outputs: [{ name: 'set', kind: 'columnset', cardinality: 'many' }]
		}
	};
</script>

<script>
	// @ts-nocheck
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';
	import { matchesPredicate } from '$lib/tableProcesses/columnSet.js';
	import { onMount } from 'svelte';

	let { p = $bindable() } = $props();

	// Candidate columns wired into colsIN (plain ids). Deselected candidates stay
	// wired — the rule just excludes them from the output set.
	const candidates = $derived(
		(p.args?.colsIN ?? []).filter((id) => typeof id === 'number' && id >= 0)
	);

	// Reactive: reads each column's name/groupLabel, so a rename or re-label
	// upstream re-evaluates membership live.
	const rows = $derived.by(() => {
		const pattern = p.args?.pattern ?? '';
		const matchField = p.args?.matchField ?? 'either';
		return candidates.map((id) => {
			const col = getColumnById(id);
			return {
				id,
				name: col?.name ?? `#${id}`,
				groupLabel: col?.groupLabel ?? null,
				selected: matchesPredicate(col, pattern, matchField)
			};
		});
	});

	const selectedCount = $derived(rows.filter((r) => r.selected).length);

	// Keep p.args.valid in step (a set is usable once it has any candidate). Guard
	// the write so the effect doesn't loop.
	$effect(() => {
		const v = candidates.length > 0;
		if (p.args.valid !== v) p.args.valid = v;
	});

	onMount(() => {
		if (!Array.isArray(p.args.colsIN)) p.args.colsIN = [];
		if (p.args.pattern == null) p.args.pattern = '';
		if (!p.args.matchField) p.args.matchField = 'either';
	});
</script>

<div class="section-row">
	<div class="tableProcess-label"><span>Filter rule</span></div>
	<div class="control-input-vertical">
		<ControlInput label="Match text">
			<input
				type="text"
				value={p.args.pattern ?? ''}
				placeholder="e.g. liver — empty selects all"
				oninput={(e) => (p.args.pattern = e.currentTarget.value)}
			/>
		</ControlInput>
		<ControlInput label="Match against">
			<select
				value={p.args.matchField ?? 'either'}
				onchange={(e) => (p.args.matchField = e.currentTarget.value)}
			>
				<option value="either">Name or label</option>
				<option value="name">Name</option>
				<option value="label">Label</option>
			</select>
		</ControlInput>
	</div>
</div>

<div class="section-row">
	<div class="tableProcess-label">
		<span>Columns</span>
		<span class="count-badge" title="Selected / wired">{selectedCount}/{rows.length}</span>
	</div>
	<div class="control-input-vertical">
		{#if rows.length === 0}
			<p class="hint">Wire columns into the input port to build a set.</p>
		{:else}
			<ul class="candidate-list">
				{#each rows as row (row.id)}
					<li class="candidate" class:excluded={!row.selected}>
						<span class="tick" aria-hidden="true">{row.selected ? '✓' : ''}</span>
						<span class="cand-name">{row.name}</span>
						{#if row.groupLabel}
							<span class="group-label-chip" title="Group label: {row.groupLabel}"
								>{row.groupLabel}</span
							>
						{/if}
					</li>
				{/each}
			</ul>
			<p class="hint">
				The output <strong>set</strong> carries the {selectedCount} selected column{selectedCount ===
				1
					? ''
					: 's'}. Wire it into any many-in input.
			</p>
		{/if}
	</div>
</div>

<style>
	.hint {
		font-size: var(--font-xs);
		color: var(--color-text-muted);
		margin: var(--space-2) 0 0 0;
	}

	.count-badge {
		margin-left: var(--space-2);
		font-size: var(--font-xs);
		font-weight: 600;
		color: var(--color-text-muted);
		background: var(--color-lightness-95);
		border-radius: var(--radius-sm);
		padding: 0 var(--space-2);
	}

	.candidate-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.candidate {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-lightness-90);
		border-radius: var(--radius-sm);
		font-size: var(--font-sm);
	}

	.candidate.excluded {
		opacity: 0.45;
		border-style: dashed;
	}

	.tick {
		width: 1em;
		flex: 0 0 auto;
		color: var(--color-accent);
		font-weight: 700;
	}

	.cand-name {
		flex: 1 1 auto;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.group-label-chip {
		flex: 0 0 auto;
		font-size: var(--font-xs);
		padding: 0 var(--space-2);
		border-radius: var(--radius-sm);
		background: var(--color-lightness-95);
		color: var(--color-lightness-35);
	}
</style>
