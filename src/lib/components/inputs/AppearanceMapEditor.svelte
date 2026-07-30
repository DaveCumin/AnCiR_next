<script>
	// The appearance identity map, made visible and editable.
	//
	// WHY IT EXISTS. The map decides what colour, marker and dash each column gets in
	// EVERY figure, and until now it was invisible: the only way to influence it was to
	// plot things in the right order and hope. This is what lets "control is always
	// grey, treatment is always red" be STATED.
	//
	// An edit sets `edited: true` on the record, which auto-assignment then never
	// overwrites. Reset removes the record entirely, so the pinning effect re-derives it
	// on the next pass — that is why reset is safe rather than leaving a hole.
	//
	// An edited colour is stored as a hex and therefore stops following the palette,
	// which is correct: the user asked for that colour, not for that palette position.
	import ColourPicker from '$lib/components/inputs/ColourPicker.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import { core } from '$lib/core/core.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';
	import { POINT_SHAPES, POINT_SHAPE_LABELS } from '$lib/components/plotbits/pointShapes.js';
	import {
		DASH_ORDER,
		DASH_LABELS,
		appearanceRows,
		mappedColour,
		setEditedAppearance,
		releaseAppearance
	} from '$lib/plots/appearanceIdentity.js';

	const rows = $derived(
		appearanceRows(core.seriesAppearance, (id) => getColumnById(id)?.name ?? '')
	);

	/** What the row currently draws as, whether from a slot or an edited hex. */
	function shownColour(row) {
		return row.colour ?? mappedColour(row.columnId) ?? '#000000';
	}

	function setColour(row, hex) {
		setEditedAppearance(row.columnId, { colour: { hex } });
	}
</script>

<div class="control-component">
	<div class="control-component-title">
		<p>Data appearance</p>
	</div>

	{#if rows.length === 0}
		<p class="hint">
			Nothing plotted yet. Each column picks up a colour, marker and line style the
			first time a figure draws it, and they appear here to adjust.
		</p>
	{:else}
		<p class="hint">
			How each column is drawn in every figure. Editing a row fixes it, so it is no
			longer assigned automatically. Reset returns it to automatic.
		</p>
		<div class="rows">
			{#each rows as row (row.columnId)}
				<div class="row">
					<span class="name" title={row.name}>{row.name}</span>
					<div class="swatch">
						<ColourPicker value={shownColour(row)} onChange={(hex) => setColour(row, hex)} />
					</div>
					<AttributeSelect
						value={row.shape}
						options={POINT_SHAPES}
						optionsDisplay={POINT_SHAPE_LABELS}
						onChange={(shape) => setEditedAppearance(row.columnId, { shape })}
					/>
					<AttributeSelect
						value={row.dash}
						options={DASH_ORDER}
						optionsDisplay={DASH_LABELS}
						onChange={(dash) => setEditedAppearance(row.columnId, { dash })}
					/>
					<button
						class="reset"
						title={row.edited ? 'Return this column to automatic' : 'Re-assign automatically'}
						onclick={() => releaseAppearance(row.columnId)}>Reset</button
					>
					{#if row.edited}<span class="fixed" title="Fixed by you">•</span>{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.hint {
		margin: var(--space-2) 0;
		font-size: var(--font-2xs);
		color: var(--color-text-muted);
		line-height: 1.4;
	}
	.rows {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto auto auto auto;
		align-items: center;
		gap: var(--space-2);
	}
	.name {
		font-size: var(--font-xs);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.swatch {
		max-width: 1.5rem;
	}
	.reset {
		font: inherit;
		font-size: var(--font-2xs);
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--color-lightness-85);
		border-radius: var(--radius-sm);
		background: var(--color-lightness-99);
		color: var(--color-lightness-25);
		cursor: pointer;
	}
	.reset:hover {
		border-color: var(--color-accent);
		background: var(--color-hover);
	}
	.fixed {
		color: var(--color-accent);
		font-size: var(--font-sm);
	}
</style>
