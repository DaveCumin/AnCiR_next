<script>
	// @ts-nocheck
	import { createEventDispatcher } from 'svelte';
	import MiniDataTable from './MiniDataTable.svelte';
	import Editable from '$lib/components/reusables/Editable.svelte';
	import NodeNoteButton from './NodeNoteButton.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';
	let { node, selected = false, expanded = false, isDropTarget = false } = $props();
	const dispatch = createEventDispatcher();

	function renameDataNode(next) {
		const col = node.refId != null ? getColumnById(node.refId) : null;
		if (!col) return;
		const trimmed = (next ?? '').trim();
		// Empty input restores the auto-derived name.
		col.customName = trimmed === '' ? null : trimmed;
	}

	// Shared port-layout constants (mirrors WorkflowEditor.svelte). Re-declared locally
	// — they're trivial numbers and the duplication is contained to these two files.
	const HEADER_H = 26;
	const PORT_H = 22;

	let isEditable = $derived(node.type === 'process' || node.type === 'tableprocess');
	// Plot nodes always have a preview panel below, so apply the expanded border style
	let hasPanel = $derived(node.type === 'plot' || expanded);

	let inputPorts = $derived(node.ports?.inputs ?? []);
	let outputPorts = $derived(node.ports?.outputs ?? []);
	let portRows = $derived(Math.max(inputPorts.length, outputPorts.length));

	function startFromOutput(e, portName) {
		e.stopPropagation();
		e.preventDefault();
		dispatch('portstart', { nodeId: node.id, port: portName, direction: 'out' });
	}

	function endAtInput(e, portName) {
		e.stopPropagation();
		e.preventDefault();
		dispatch('portend', { nodeId: node.id, port: portName, direction: 'in' });
	}

	function disconnectInput(e, portName) {
		e.stopPropagation();
		if (!e.shiftKey && e.button !== 2) return;
		e.preventDefault();
		dispatch('portdisconnect', { nodeId: node.id, port: portName, direction: 'in' });
	}
</script>

<div
	class="workflow-node"
	class:selected
	class:expanded={hasPanel}
	class:drop-target={isDropTarget}
	role="button"
	tabindex="0"
>
	<div class="node-header">
		{#if node.type === 'data' && node.refId != null}
			<div class="node-label" onpointerdown={(e) => e.stopPropagation()}>
				<Editable
					value={node.label}
					placeholder="column name"
					ariaLabel="Rename column"
					title="Double-click to rename"
					onCommit={renameDataNode}
				/>
			</div>
		{:else}
			<div class="node-label">{node.label}</div>
		{/if}
		{#if isDropTarget}
			<span class="drop-badge" title="Drop to replace all references">↓ replace</span>
		{:else if isEditable}
			<span class="expand-indicator" title={expanded ? 'Collapse' : 'Expand to edit'}>
				{expanded ? '▲' : '▼'}
			</span>
		{/if}
		<NodeNoteButton nodeId={node.id} />
	</div>

	{#if portRows > 0}
		<div class="node-ports" style="height:{portRows * PORT_H}px;">
			{#each inputPorts as port, i (`in_${port.name}_${i}`)}
				<div class="port-row input" style="top:{i * PORT_H}px;">
					<div
						class="port-dot dot-input"
						title={`Input: ${port.name}${port.dynamic ? ' (many)' : ''}`}
						onmousedown={(e) => disconnectInput(e, port.name)}
						onmouseup={(e) => endAtInput(e, port.name)}
						oncontextmenu={(e) => disconnectInput(e, port.name)}
						role="button"
						tabindex="-1"
					></div>
					<span class="port-label">{port.name}{port.dynamic ? '*' : ''}</span>
				</div>
			{/each}
			{#each outputPorts as port, i (`out_${port.name}_${i}`)}
				<div class="port-row output" style="top:{i * PORT_H}px;">
					<div
						class="port-dot dot-output"
						title={`Output: ${port.name}${port.dynamic ? ' (many)' : ''}`}
						onmousedown={(e) => startFromOutput(e, port.name)}
						role="button"
						tabindex="-1"
					></div>
					<span class="port-label">{port.name}{port.dynamic ? '*' : ''}</span>
				</div>
			{/each}
		</div>
	{/if}

	{#if node.sublabel}
		<div class="node-sublabel">{node.sublabel}</div>
	{/if}

	{#if node.type === 'data' && node.refId != null}
		{@const col = getColumnById(node.refId)}
		{#if col}
			<div class="node-body-padded"><MiniDataTable column={col} maxRows={5} /></div>
		{/if}
	{/if}

	{#if node.type === 'note' && node.noteObj}
		<div
			class="note-body"
			onpointerdown={(e) => e.stopPropagation()}
			role="presentation"
		>
			<textarea
				class="note-textarea"
				value={node.noteObj.text ?? ''}
				placeholder="Write a note"
				oninput={(e) => (node.noteObj.text = e.currentTarget.value)}
			></textarea>
		</div>
	{/if}
</div>

<style>
	.workflow-node {
		width: 160px;
		position: relative;
		border-radius: 6px;
		border: 1px solid rgba(0, 0, 0, 0.18);
		background: #ffffff;
		cursor: grab;
		user-select: none;
		box-sizing: border-box;
		font-size: 12px;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
		transition:
			border-color 0.12s ease,
			box-shadow 0.12s ease,
			transform 0.12s ease;
	}

	.workflow-node:hover {
		border-color: rgba(0, 0, 0, 0.35);
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
	}

	.workflow-node.selected {
		border-color: var(--color-accent, #4d9fe3);
		box-shadow:
			0 1px 3px rgba(0, 0, 0, 0.08),
			0 0 0 2px rgba(77, 159, 227, 0.28);
	}

	.workflow-node.expanded {
		border-bottom-left-radius: 0;
		border-bottom-right-radius: 0;
		border-bottom-color: transparent;
	}

	.workflow-node.drop-target {
		border: 2px dashed #28a745;
		box-shadow: 0 0 0 3px rgba(40, 167, 69, 0.25);
	}

	.node-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 4px;
		padding: 0 10px;
		height: 26px; /* HEADER_H */
		background: var(--color-lightness-97, #f4f4f4);
		border-bottom: 1px solid var(--color-lightness-90, #e7e7e7);
		border-radius: 6px 6px 0 0;
		font-weight: 600;
		color: var(--color-lightness-25, #333);
	}

	.node-label {
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.expand-indicator {
		font-size: 9px;
		color: #666;
		flex-shrink: 0;
		pointer-events: none;
	}
	.drop-badge {
		font-size: 9px;
		font-weight: 700;
		color: #28a745;
		flex-shrink: 0;
		white-space: nowrap;
	}

	.node-ports {
		position: relative;
	}

	.port-row {
		position: absolute;
		display: flex;
		align-items: center;
		height: 22px; /* PORT_H */
		font-size: 11px;
		color: var(--color-lightness-40, #5b5b5b);
		pointer-events: none; /* let only the dot capture clicks */
	}

	.port-row.input {
		left: 0;
		padding-left: 14px;
		flex-direction: row;
	}

	.port-row.output {
		right: 0;
		padding-right: 14px;
		flex-direction: row-reverse;
	}

	.port-dot {
		position: relative;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--color-lightness-95, #ececec);
		border: 1px solid var(--color-lightness-60, #8a8a8a);
		cursor: crosshair;
		flex-shrink: 0;
		padding: 0;
		overflow: visible;
		pointer-events: auto;
	}

	/* Sit halfway outside the card so wires meet the dot, not the card edge. */
	.port-dot.dot-input {
		transform: translateX(-150%);
	}
	.port-dot.dot-output {
		transform: translateX(150%);
	}

	.port-dot:hover {
		background: var(--color-accent, #4d9fe3);
		border-color: var(--color-accent, #4d9fe3);
	}

	.port-label {
		padding: 0 4px;
		pointer-events: none;
		white-space: nowrap;
		max-width: 80px;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.node-sublabel {
		font-size: 10px;
		color: #555;
		background-color: rgba(0, 0, 0, 0.04);
		border-radius: 3px;
		padding: 1px 4px;
		display: inline-block;
		margin: 6px 10px 2px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: calc(100% - 20px);
	}

	.node-body-padded {
		padding: 6px 10px 8px;
	}

	.note-body {
		padding: 6px 10px 8px;
		background: #fffde7;
	}

	.note-textarea {
		width: 100%;
		min-height: 80px;
		resize: vertical;
		border: 1px solid rgba(0, 0, 0, 0.15);
		border-radius: 3px;
		padding: 4px 6px;
		font-family: inherit;
		font-size: 11px;
		line-height: 1.4;
		background: #fffef6;
		outline: none;
		box-sizing: border-box;
	}

	.note-textarea:focus {
		border-color: var(--color-accent, #4d9fe3);
	}
</style>
