<script>
	// @ts-nocheck
	// Renders type-specific editor controls for the canvas node currently
	// selected via appState.canvasSelectedNodeId. Mirrors the inline expanded
	// editor for processes/tableprocesses (same component, same target object,
	// so reactivity keeps both views in sync) and exposes lightweight editors
	// for data / group / note nodes that don't otherwise have a side panel.
	import { core, appState, appConsts, getProcessNodeGraph, extractColumnFromAnyGroup } from '$lib/core/core.svelte.js';
	import { getColumnById } from '$lib/core/Column.svelte';
	import Editable from '$lib/components/reusables/Editable.svelte';

	// Pull the live node object out of the cached graph so processObj/tpObj/
	// groupObj/noteObj are spread onto the result (see getCachedProcessNodeGraph).
	const node = $derived.by(() => {
		const id = appState.canvasSelectedNodeId;
		if (!id) return null;
		const graph = getProcessNodeGraph();
		return graph.nodes?.find((n) => n.id === id) ?? null;
	});

	// Shared note textarea — same key (canvas node id) the per-node N-button uses,
	// so edits here and there stay in sync.
	const noteText = $derived(node ? (core.nodeNotes[node.id] ?? '') : '');
	function setNoteText(next) {
		if (!node) return;
		const trimmed = (next ?? '').trim();
		if (trimmed === '') {
			delete core.nodeNotes[node.id];
		} else {
			core.nodeNotes[node.id] = next;
		}
	}

	function renameColumn(colId, next) {
		const col = getColumnById(colId);
		if (!col) return;
		const trimmed = (next ?? '').trim();
		col.customName = trimmed === '' ? null : trimmed;
	}
</script>

{#if appState.canvasMultiSelectedCount > 1}
	<div class="control-banner">
		<div class="control-banner-title">
			<p class="node-title">{appState.canvasMultiSelectedCount} nodes selected</p>
		</div>
	</div>
	<p class="multi-hint">
		Drag any selected node to move them as a group. Delete / Backspace removes them all.
		Cmd / Ctrl + C copies; Cmd / Ctrl + V pastes.
	</p>
{:else if node}
	<div class="control-banner">
		<div class="control-banner-title">
			<p class="node-title">
				{node.label}
				<span class="node-type-tag">{node.type}</span>
			</p>
		</div>
	</div>

	{#if node.type === 'process' && node.processObj}
		{@const PComp = appConsts.processMap.get(node.processName)?.component}
		{#if !node.processObj.parentCol}
			<!-- Orphan process: most editor components read p.parentCol.type and
			     crash on null. Block the editor and point the user at wiring. -->
			<div class="control-component muted">
				Drag a wire from a data column to this node's input to attach it.
				Params editor unlocks once a parent column is set.
			</div>
		{:else if PComp}
			<div class="control-component">
				<PComp p={node.processObj} />
			</div>
		{:else}
			<div class="control-component muted">No editor registered for "{node.processName}".</div>
		{/if}
	{:else if node.type === 'tableprocess' && node.tpObj}
		{@const TPComp = appConsts.tableProcessMap.get(node.tpName)?.component}
		{#if TPComp}
			<div class="control-component">
				<TPComp p={node.tpObj} />
			</div>
		{:else}
			<div class="control-component muted">No editor registered for "{node.tpName}".</div>
		{/if}
	{:else if node.type === 'data' && node.refId != null}
		{@const col = getColumnById(node.refId)}
		{#if col}
			<div class="control-component">
				<div class="control-input">
					<p>Name</p>
					<Editable
						value={col.name}
						placeholder="column name"
						ariaLabel="Rename column"
						title="Double-click to rename"
						onCommit={(v) => renameColumn(node.refId, v)}
					/>
				</div>
				<div class="control-input">
					<p>Rows</p>
					<span class="muted">{col.getData?.()?.length ?? 0}</span>
				</div>
				{#if col.timeFormat}
					<div class="control-input">
						<p>Time format</p>
						<span class="muted">{col.timeFormat}</span>
					</div>
				{/if}
			</div>
		{/if}
	{:else if node.type === 'group' && node.groupObj}
		{@const g = node.groupObj}
		<div class="control-component">
			<div class="control-input">
				<p>Name</p>
				<Editable
					value={g.name}
					placeholder="group name"
					onCommit={(v) => {
						const trimmed = (v ?? '').trim();
						g.name = trimmed === '' ? 'Group' : trimmed;
					}}
				/>
			</div>
			<div class="control-input vertical">
				<p>Source columns ({(g.sourceColumnIds ?? []).length})</p>
				{#if (g.sourceColumnIds ?? []).length === 0}
					<span class="muted">Drag a data node onto the group to add a source.</span>
				{:else}
					<ul class="source-list">
						{#each g.sourceColumnIds as colId (colId)}
							{@const col = getColumnById(colId)}
							<li>
								<span class="source-name">{col?.name ?? `col ${colId}`}</span>
								<button
									type="button"
									class="remove-btn"
									title="Extract from group"
									onclick={() => extractColumnFromAnyGroup(colId)}
								>
									✕
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</div>
	{:else if node.type === 'note' && node.noteObj}
		<div class="control-component">
			<div class="control-input vertical">
				<p>Note text</p>
				<textarea
					class="note-textarea"
					rows="6"
					value={node.noteObj.text ?? ''}
					oninput={(e) => (node.noteObj.text = e.currentTarget.value)}
					placeholder="Write a note"
				></textarea>
			</div>
		</div>
	{/if}

	<div class="control-component">
		<div class="control-input vertical">
			<p>Node note</p>
			<textarea
				class="node-note-textarea"
				rows="4"
				value={noteText}
				oninput={(e) => setNoteText(e.currentTarget.value)}
				placeholder="Add context, reminders, or interpretation notes"
			></textarea>
		</div>
	</div>
{/if}

<style>
	.control-banner {
		padding: 0.4rem 0 0.2rem;
		border-bottom: 1px solid var(--color-lightness-90, #e7e7e7);
		margin-bottom: 0.4rem;
	}
	.control-banner-title {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.node-title {
		font-weight: 600;
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.node-type-tag {
		font-size: 0.65rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0.1rem 0.35rem;
		border-radius: 0.2rem;
		background: rgba(0, 0, 0, 0.06);
		color: rgba(0, 0, 0, 0.55);
	}
	.control-component {
		padding: 0.4rem 0;
		border-bottom: 1px solid var(--color-lightness-95, #f0f0f0);
	}
	.control-component:last-child {
		border-bottom: none;
	}
	.control-component.muted {
		opacity: 0.65;
		font-size: 0.85rem;
	}
	.control-input {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.25rem 0;
	}
	.control-input.vertical {
		flex-direction: column;
		align-items: stretch;
	}
	.control-input p {
		font-size: 0.85rem;
		font-weight: 600;
		opacity: 0.8;
		margin: 0;
	}
	.muted {
		opacity: 0.65;
		font-size: 0.85rem;
	}
	.multi-hint {
		opacity: 0.75;
		font-size: 0.85rem;
		line-height: 1.35;
		margin: 0 0 0.5rem;
	}
	.source-list {
		list-style: none;
		padding: 0;
		margin: 0.2rem 0 0;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.source-list li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.4rem;
		padding: 0.2rem 0.4rem;
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 0.25rem;
		background: rgba(0, 0, 0, 0.02);
	}
	.source-name {
		font-size: 0.85rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
	}
	.remove-btn {
		background: transparent;
		border: none;
		font-size: 0.75rem;
		color: rgba(176, 48, 48, 0.8);
		cursor: pointer;
		padding: 0 0.3rem;
		border-radius: 0.2rem;
	}
	.remove-btn:hover {
		background: rgba(176, 48, 48, 0.08);
	}
	.note-textarea,
	.node-note-textarea {
		width: 100%;
		min-height: 64px;
		resize: vertical;
		padding: 0.3rem 0.4rem;
		font-family: inherit;
		font-size: 0.85rem;
		line-height: 1.3;
		border: 1px solid rgba(0, 0, 0, 0.18);
		border-radius: 0.25rem;
		box-sizing: border-box;
		outline: none;
	}
	.note-textarea:focus,
	.node-note-textarea:focus {
		border-color: var(--color-accent, #4d9fe3);
	}
</style>
