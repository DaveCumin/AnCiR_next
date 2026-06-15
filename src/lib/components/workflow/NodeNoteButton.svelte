<script>
	// @ts-nocheck
	// Per-node note button: lives in the node header and toggles a popover
	// textarea for the note text. Stores notes in core.nodeNotes keyed by
	// canvas node id (data_<colId>, process_<procId>, plot_<plotId>, ...).
	import { tick } from 'svelte';
	import { core } from '$lib/core/core.svelte.js';
	import { tooltip } from '$lib/utils/tooltip.js';

	let { nodeId } = $props();

	let open = $state(false);
	let draft = $state('');
	let rootEl;
	let textareaEl;

	let note = $derived(core.nodeNotes[nodeId] ?? '');
	let hasNote = $derived(note.trim().length > 0);

	async function openEditor() {
		draft = note;
		open = true;
		await tick();
		textareaEl?.focus();
		textareaEl?.select();
	}

	function toggleEditor() {
		if (open) {
			open = false;
			return;
		}
		void openEditor();
	}

	function saveNote() {
		const next = draft.trim();
		if (next === '') {
			delete core.nodeNotes[nodeId];
		} else {
			core.nodeNotes[nodeId] = next;
		}
		open = false;
	}

	function clearNote() {
		draft = '';
		delete core.nodeNotes[nodeId];
		open = false;
	}

	function shortTitle(s) {
		if (!s) return '';
		const trimmed = s.replace(/\s+/g, ' ').trim();
		return trimmed.length > 28 ? `"${trimmed.slice(0, 28)}…"` : `"${trimmed}"`;
	}
</script>

<div class="node-note-wrap" bind:this={rootEl}>
	<button
		type="button"
		class="node-note-btn"
		class:has-note={hasNote}
		onclick={(e) => {
			e.stopPropagation();
			toggleEditor();
		}}
		onpointerdown={(e) => e.stopPropagation()}
		aria-label={hasNote ? 'View or edit note' : 'Add note'}
		{@attach tooltip(hasNote ? shortTitle(note) : 'Add note')}
	>
		N
	</button>

	{#if open}
		<div class="node-note-popover" role="presentation" onpointerdown={(e) => e.stopPropagation()}>
			<div class="node-note-label">Node note</div>
			<textarea
				bind:this={textareaEl}
				class="node-note-textarea"
				bind:value={draft}
				rows="4"
				placeholder="Add context, reminders, or interpretation notes"
			></textarea>
			<div class="node-note-actions">
				<button type="button" class="np-action" onclick={saveNote}>Save</button>
				<button type="button" class="np-action" onclick={() => (open = false)}>Close</button>
				{#if hasNote || draft.trim() !== ''}
					<button type="button" class="np-action danger" onclick={clearNote}>Clear</button>
				{/if}
			</div>
		</div>
	{/if}
</div>

<svelte:window
	onclick={(e) => {
		if (!open) return;
		if (!rootEl?.contains(e.target)) open = false;
	}}
	onkeydown={(e) => {
		if (open && e.key === 'Escape') {
			e.stopPropagation();
			open = false;
		}
	}}
/>

<style>
	.node-note-wrap {
		position: relative;
		flex: 0 0 auto;
	}

	.node-note-btn {
		color: rgba(0, 0, 0, 0.45);
		font-size: 0.68rem;
		line-height: 1;
		padding: 2px 5px;
		border: 1px solid transparent;
		border-radius: 4px;
		background: transparent;
		cursor: pointer;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-weight: 700;
	}

	.node-note-btn:hover {
		color: rgba(0, 0, 0, 0.85);
		border-color: rgba(0, 0, 0, 0.18);
		background: rgba(0, 0, 0, 0.04);
	}

	.node-note-btn.has-note {
		color: #1f8c4f;
		border-color: rgba(31, 140, 79, 0.4);
		background: rgba(31, 140, 79, 0.1);
	}

	.node-note-popover {
		position: absolute;
		top: calc(100% + 6px);
		right: 0;
		width: 260px;
		padding: 0.55rem;
		border: 1px solid rgba(0, 0, 0, 0.18);
		border-radius: 6px;
		background: #fff;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
		z-index: 60;
		cursor: default;
	}

	.node-note-label {
		font-size: 11px;
		font-weight: 600;
		margin-bottom: 4px;
		color: rgba(0, 0, 0, 0.6);
	}

	.node-note-textarea {
		width: 100%;
		min-height: 80px;
		resize: vertical;
		line-height: 1.3;
		padding: 4px 6px;
		font-size: 12px;
		font-family: inherit;
		border: 1px solid rgba(0, 0, 0, 0.2);
		border-radius: 4px;
		outline: none;
		box-sizing: border-box;
	}

	.node-note-textarea:focus {
		border-color: var(--color-accent, #4d9fe3);
	}

	.node-note-actions {
		display: flex;
		gap: 4px;
		margin-top: 6px;
	}

	.np-action {
		font-size: 11px;
		padding: 3px 8px;
		border: 1px solid rgba(0, 0, 0, 0.2);
		background: #fff;
		border-radius: 3px;
		cursor: pointer;
	}

	.np-action:hover {
		background: rgba(0, 0, 0, 0.05);
	}

	.np-action.danger {
		color: #b03030;
		border-color: rgba(176, 48, 48, 0.4);
	}

	.np-action.danger:hover {
		background: rgba(176, 48, 48, 0.08);
	}
</style>
