<!--
	The add row of a list of blocks in a plot's control panel (UI-12): a one-line empty state
	while the list is empty, then one labelled `.btn-add` button per kind of block ("+ Add
	series", "+ Add line", "+ Add band", ...). Every list of blocks in the panels (series,
	overlays, light bands, annotations, marker rules, markers) adds through this row, so the
	affordance looks and reads the same everywhere: before it, some lists had a bare + icon in
	the title, one a full-width + button under the list, and the overlays a labelled row.

	Each block's own header then carries its row actions in one fixed order: show/hide,
	colour, other actions, delete last (SeriesBlockHeader, Overlay, PhaseMarker, ...).
-->
<script>
	/**
	 * @type {{
	 *   actions: { label: string, onadd: () => unknown, tooltip?: string, ariaLabel?: string }[],
	 *   count?: number,
	 *   empty?: string
	 * }}
	 */
	let { actions = [], count = 0, empty = '' } = $props();
</script>

<div class="block-add">
	{#if count === 0 && empty}
		<p class="block-empty">{empty}</p>
	{/if}
	{#if actions.length}
		<div class="block-add-row">
			{#each actions as a (a.label)}
				<button
					type="button"
					class="btn-add"
					aria-label={a.ariaLabel ?? undefined}
					title={a.tooltip ?? undefined}
					onclick={() => a.onadd?.()}
				>
					+ {a.label}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	/* Full width whatever the parent's alignment (a .control-component shrinks its children). */
	.block-add {
		width: 100%;
		align-self: stretch;
		margin-bottom: var(--space-4);
	}
	.block-empty {
		margin: 0 0 var(--space-3);
		font-size: var(--font-sm);
		color: var(--color-text-muted);
	}
	.block-add-row {
		display: flex;
		gap: var(--space-3);
	}
</style>
