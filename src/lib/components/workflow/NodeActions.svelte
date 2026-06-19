<script>
	// @ts-nocheck
	// Shared node/plot action cluster: note · maximise · collapse/expand · delete.
	// Used by the worksheet plot header (Draggable), the workflow node header
	// (expanded), and the compact-node overlay (collapsed) — so the controls look
	// and behave the same everywhere, and the note button always travels with the
	// collapse/delete buttons.
	//
	// Visibility (within the cluster):
	//   · action buttons (maximise/collapse/delete) show only when `revealed`
	//     (hover or selection — the parent computes this).
	//   · the note button shows when `revealed` OR `hasNote`, so an existing note
	//     stays flagged even when the cluster is otherwise hidden.
	import Icon from '$lib/icons/Icon.svelte';
	import { tooltip } from '$lib/utils/tooltip.js';
	import NodeNoteButton from './NodeNoteButton.svelte';

	let {
		revealed = false,
		// Note button: pass the canvas node id to render it; `hasNote` keeps it
		// visible (as a flag) even when not revealed.
		noteNodeId = null,
		hasNote = false,
		// Collapse/expand toggle (workflow nodes). `expanded` picks the glyph.
		showCollapse = false,
		expanded = true,
		onToggleCollapse,
		// Maximise/restore toggle (plots with a viewable body).
		showMaximise = false,
		maximised = false,
		onToggleMaximise,
		// Delete. `deleteTooltip` lets callers say "Delete plot" vs "Delete node".
		showDelete = true,
		onDelete,
		deleteTooltip = 'Delete'
	} = $props();

	// Buttons must not start a node/plot drag or bubble to canvas selection.
	function stop(e) {
		e.stopPropagation();
	}
</script>

<div class="node-actions" class:revealed class:has-note={hasNote}>
	{#if noteNodeId}
		<div class="na-note" onpointerdown={stop} onmousedown={stop} role="presentation">
			<NodeNoteButton nodeId={noteNodeId} />
		</div>
	{/if}

	{#if showMaximise}
		<button
			type="button"
			class="na-btn na-action"
			aria-label={maximised ? 'Restore size' : 'Maximise'}
			onpointerdown={stop}
			onmousedown={stop}
			onclick={(e) => {
				stop(e);
				onToggleMaximise?.(e);
			}}
			{@attach tooltip(maximised ? 'Restore size' : 'Maximise')}
		>
			<Icon name={maximised ? 'minimise' : 'maximise'} width={15} height={15} />
		</button>
	{/if}

	{#if showCollapse}
		<button
			type="button"
			class="na-btn na-action"
			aria-label={expanded ? 'Collapse' : 'Expand'}
			onpointerdown={stop}
			onmousedown={stop}
			onclick={(e) => {
				stop(e);
				onToggleCollapse?.(e);
			}}
			{@attach tooltip(expanded ? 'Collapse' : 'Expand')}
		>
			<span class="na-glyph">{expanded ? '⤡' : '⤢'}</span>
		</button>
	{/if}

	{#if showDelete}
		<button
			type="button"
			class="na-btn na-action na-danger"
			aria-label={deleteTooltip}
			onpointerdown={stop}
			onmousedown={stop}
			onclick={(e) => {
				stop(e);
				onDelete?.(e);
			}}
			{@attach tooltip(deleteTooltip)}
		>
			<Icon name="trash" width={13} height={13} />
		</button>
	{/if}
</div>

<style>
	.node-actions {
		display: flex;
		align-items: center;
		gap: 1px;
	}

	/* Action buttons appear only when the cluster is revealed (hover/selection). */
	.node-actions .na-action {
		display: none;
	}
	.node-actions.revealed .na-action {
		display: inline-flex;
	}

	/* The note button additionally stays visible whenever a note exists. */
	.node-actions .na-note {
		display: none;
	}
	.node-actions.revealed .na-note,
	.node-actions.has-note .na-note {
		display: inline-flex;
	}

	.na-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		padding: 0;
		border: none;
		background: transparent;
		border-radius: 4px;
		color: var(--color-lightness-35, #555);
		cursor: pointer;
		line-height: 1;
		transition:
			background 0.12s ease,
			color 0.12s ease;
	}
	.na-btn:hover {
		background: var(--color-lightness-88, #dcdcdc);
		color: var(--color-lightness-20, #222);
	}
	.na-danger:hover {
		background: rgba(210, 59, 59, 0.14);
		color: #d23b3b;
	}
	.na-glyph {
		font-size: 13px;
		line-height: 1;
	}
</style>
