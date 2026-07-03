<script>
	// @ts-nocheck
	import { createEventDispatcher } from 'svelte';
	import MiniDataTable from './MiniDataTable.svelte';
	import Editable from '$lib/components/reusables/Editable.svelte';
	import TypeSelector from '$lib/components/reusables/TypeSelector.svelte';
	import NodeNoteButton from './NodeNoteButton.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';
	import { getNodeName, setNodeName, isNodeNameEditable } from '$lib/core/nodeNaming.js';
	import { tooltip } from '$lib/utils/tooltip.js';
	import { guessDateofArray } from '$lib/utils/time/TimeUtils.js';
	import { core } from '$lib/core/core.svelte.js';
	import { plotPortRows } from '$lib/core/ProcessNode.svelte.js';
	let {
		node,
		selected = false,
		expanded = false,
		isDropTarget = false,
		spliceTargetPort = null,
		width = null
	} = $props();
	const dispatch = createEventDispatcher();

	// Note flag: keeps the left-side note button visible whenever a note exists.
	const hasNote = $derived(!!core.nodeNotes[node.id]?.trim());

	// Mirror the legacy Column.svelte behaviour: when the user picks "time" and
	// no format is set yet, sniff one from the first few raw rows.
	function onColumnTypeChange(newType) {
		const col = node.refId != null ? getColumnById(node.refId) : null;
		if (!col || newType !== 'time') return;
		const fmt = col.timeFormat;
		const isEmpty = !fmt || (Array.isArray(fmt) ? fmt.length === 0 : fmt === '');
		if (!isEmpty) return;
		const rawData = core.rawData.get(col.data);
		if (!Array.isArray(rawData) || rawData.length === 0) return;
		const sample = rawData.slice(0, 10);
		const guessed = guessDateofArray(sample);
		if (guessed !== -1 && guessed.length > 0) {
			col.timeFormat = guessed;
		}
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

	// Plot nodes whose inputs carry series metadata (axis/series) render grouped
	// under "Series N" headers with friendly x/y labels. plotPortRows() is the
	// single source of truth for slot order — WorkflowEditor's edge anchor uses
	// the same helper so wires stay attached.
	let isPlotGrouped = $derived(node.type === 'plot' && inputPorts.some((p) => p?.axis));
	let groupedRows = $derived(isPlotGrouped ? plotPortRows(inputPorts) : []);

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
		// Shift+click disconnects. Right-click opens the column picker instead of
		// disconnecting (see openInputPicker).
		if (!e.shiftKey) return;
		e.preventDefault();
		dispatch('portdisconnect', { nodeId: node.id, port: portName, direction: 'in' });
	}
	// Right-click an input port → ask the editor to open a column picker to add a
	// connection to this input.
	function openInputPicker(e, portName) {
		e.preventDefault();
		e.stopPropagation();
		dispatch('portpick', { nodeId: node.id, port: portName, x: e.clientX, y: e.clientY });
	}
</script>

<div
	class="workflow-node"
	class:selected
	class:expanded={hasPanel}
	class:drop-target={isDropTarget}
	style={width != null ? `width:${width}px;` : ''}
	role="button"
	tabindex="0"
>
	<div class="node-header">
		<!-- Note button on the LEFT (status side), so it doesn't shift when the
		     collapse/delete buttons reveal on the right. Shown when a note exists,
		     or on hover/selection. -->
		<div
			class="note-slot"
			class:has-note={hasNote}
			class:sel={selected}
			onpointerdown={(e) => e.stopPropagation()}
			role="presentation"
		>
			<NodeNoteButton nodeId={node.id} />
		</div>
		{#if node.type === 'data' && node.refId != null}
			{@const liveCol = getColumnById(node.refId)}
			{#if liveCol}
				<div class="node-type" onpointerdown={(e) => e.stopPropagation()}>
					<TypeSelector bind:value={liveCol.type} onChange={onColumnTypeChange} />
				</div>
			{/if}
			<div class="node-label" onpointerdown={(e) => e.stopPropagation()}>
				<Editable
					value={getNodeName(node)}
					placeholder="column name"
					ariaLabel="Rename column"
					title="Double-click to rename"
					onInput={(v) => setNodeName(node, v)}
					onCommit={(v) => setNodeName(node, v, { commit: true })}
				/>
			</div>
		{:else if isNodeNameEditable(node)}
			<div class="node-label" onpointerdown={(e) => e.stopPropagation()}>
				<Editable
					value={getNodeName(node)}
					placeholder="name"
					ariaLabel="Rename node"
					title="Double-click to rename"
					onInput={(v) => setNodeName(node, v)}
					onCommit={(v) => setNodeName(node, v, { commit: true })}
				/>
			</div>
		{:else}
			<div class="node-label">{node.label}</div>
		{/if}
		{#if isDropTarget}
			<span class="drop-badge" title="Drop to replace all references">↓ replace</span>
		{/if}
		<!-- Note · collapse · delete live in the shared action cluster pinned to the
		     header's top-right by WorkflowEditor (NodeActions), not per-node. -->
	</div>

	{#if isPlotGrouped}
		<div class="node-ports grouped" style="height:{groupedRows.length * PORT_H}px;">
			{#each groupedRows as row, i (`r_${i}`)}
				{#if row.kind === 'header'}
					<div class="series-header" style="top:{i * PORT_H}px;">
						{row.label}
					</div>
				{:else}
					<div class="port-row input" style="top:{i * PORT_H}px;">
						<div
							class="port-dot dot-input"
							data-node-id={node.id}
							data-port-name={row.port.name}
							data-port-dir="in"
							{@attach tooltip(
								`Input: ${row.port.display ?? row.port.name}${row.port.dynamic ? ' — accepts one or more columns' : ''}`
							)}
							onmousedown={(e) => disconnectInput(e, row.port.name)}
							onmouseup={(e) => endAtInput(e, row.port.name)}
							oncontextmenu={(e) => openInputPicker(e, row.port.name)}
							role="button"
							tabindex="-1"
						></div>
						<span class="port-label"
							>{row.port.display ?? row.port.name}{#if row.port.dynamic}<span class="dyn-star"
									>*</span
								>{/if}</span
						>
					</div>
				{/if}
			{/each}
		</div>
	{:else if portRows > 0}
		<div class="node-ports" style="height:{portRows * PORT_H}px;">
			{#each inputPorts as port, i (`in_${port.name}_${i}`)}
				<div class="port-row input" style="top:{i * PORT_H}px;">
					<div
						class="port-dot dot-input"
						data-node-id={node.id}
						data-port-name={port.name}
						data-port-dir="in"
						{@attach tooltip(`Input: ${port.name}${port.dynamic ? ' (many)' : ''}`)}
						onmousedown={(e) => disconnectInput(e, port.name)}
						onmouseup={(e) => endAtInput(e, port.name)}
						oncontextmenu={(e) => openInputPicker(e, port.name)}
						role="button"
						tabindex="-1"
					></div>
					<span class="port-label">{port.display ?? port.name}{port.dynamic ? '*' : ''}</span>
				</div>
			{/each}
			{#each outputPorts as port, i (`out_${port.name}_${i}`)}
				<div class="port-row output" style="top:{i * PORT_H}px;">
					<div
						class="port-dot dot-output"
						class:splice-target={spliceTargetPort === port.name}
						data-node-id={node.id}
						data-port-name={port.name}
						data-port-dir="out"
						{@attach tooltip(`Output: ${port.display ?? port.name}${port.dynamic ? ' (many)' : ''}`)}
						onmousedown={(e) => startFromOutput(e, port.name)}
						role="button"
						tabindex="-1"
					></div>
					<span class="port-label">{port.display ?? port.name}{port.dynamic ? '*' : ''}</span>
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
			style="height:{node.noteObj.height ?? 120}px;"
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
		<!-- Plot-style resize: drag the corner; the node grows in place (no move).
		     WorkflowEditor handles the drag via on:resizestart. -->
		<div
			class="note-resize-handle"
			role="presentation"
			title="Drag to resize"
			onmousedown={(e) => {
				e.stopPropagation();
				dispatch('resizestart', e);
			}}
		></div>
	{/if}
</div>

<style>
	.workflow-node {
		width: 160px;
		position: relative;
		border-radius: var(--radius-md);
		border: 1px solid rgba(0, 0, 0, 0.18);
		background: var(--surface-card);
		cursor: grab;
		user-select: none;
		box-sizing: border-box;
		font-size: var(--font-sm);
		box-shadow: var(--shadow-1);
		transition:
			border-color 0.12s ease,
			box-shadow 0.12s ease,
			transform 0.12s ease;
	}

	.workflow-node:hover {
		border-color: rgba(0, 0, 0, 0.35);
		box-shadow: var(--shadow-1);
	}

	.workflow-node.selected {
		border-color: var(--color-accent);
		box-shadow:
			var(--shadow-1),
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

	/* Left-side note button, always visible so the label never shifts. It reads as
	   a faint "N" until a note exists (then NodeNoteButton turns it green). */
	.note-slot {
		flex-shrink: 0;
		display: flex;
	}

	.node-type {
		display: flex;
		align-items: center;
		flex-shrink: 0;
	}

	.expand-indicator {
		font-size: 9px;
		color: #666;
		flex-shrink: 0;
		padding: 2px 4px;
		border: none;
		border-radius: 3px;
		background: transparent;
		cursor: pointer;
		line-height: 1;
	}

	.expand-indicator:hover {
		color: var(--color-accent);
		background: rgba(0, 0, 0, 0.05);
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

	/* Faint "Series N" caption grouping each (x, y) pair on plot nodes. Occupies
	   one PORT_H slot so it lines up with the absolute port rows below it. */
	.series-header {
		position: absolute;
		left: 0;
		right: 0;
		height: 22px; /* PORT_H */
		display: flex;
		align-items: center;
		padding-left: 10px;
		font-size: 9.5px;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-text-muted, #666);
		pointer-events: none;
		border-top: 1px solid var(--color-lightness-90, #ededed);
	}
	/* "*" marks a dynamic port that accepts one or more columns. Plain text colour
	   (not accent) so it reads as a footnote marker, not a link. */
	.dyn-star {
		margin-left: 1px;
		color: inherit;
		font-weight: 700;
	}

	.port-row {
		position: absolute;
		display: flex;
		align-items: center;
		height: 22px; /* PORT_H */
		font-size: var(--font-xs);
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
		width: 13px;
		height: 13px;
		border-radius: 50%;
		background: var(--color-lightness-95, #ececec);
		border: 1px solid var(--color-lightness-60, #8a8a8a);
		cursor: crosshair;
		flex-shrink: 0;
		padding: 0;
		overflow: visible;
		pointer-events: auto;
	}

	/* Invisible enlarged hit area so the user doesn't have to land exactly on the
	   10px dot to start or finish a wire. Wider than tall so it doesn't swallow the
	   neighbouring row's dot (rows are PORT_H = 22px apart). */
	.port-dot::before {
		content: '';
		position: absolute;
		inset: -4px -16px;
		border-radius: var(--radius-lg);
	}

	/* Sit halfway outside the card so wires meet the dot, not the card edge. */
	.port-dot.dot-input {
		transform: translateX(-150%);
	}
	.port-dot.dot-output {
		transform: translateX(150%);
	}

	.port-dot:hover {
		background: var(--color-accent);
		border-color: var(--color-accent);
	}

	/* Active drop target while dragging an orphan / 1-in-1-out process onto
	   this output port. Slightly larger ring + accent fill mirrors the wire
	   splice-target highlight in WorkflowEdges. */
	.port-dot.splice-target {
		background: var(--color-accent);
		border-color: var(--color-accent);
		box-shadow: 0 0 0 4px rgba(77, 159, 227, 0.35);
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
		box-sizing: border-box;
	}

	.note-textarea {
		width: 100%;
		height: 100%;
		/* Sized by the node (drag the corner handle); no native textarea grip. */
		resize: none;
		border: 1px solid rgba(0, 0, 0, 0.15);
		border-radius: 3px;
		padding: 4px 6px;
		font-family: inherit;
		font-size: var(--font-xs);
		line-height: 1.4;
		background: #fffef6;
		outline: none;
		box-sizing: border-box;
	}

	.note-textarea:focus {
		border-color: var(--color-accent);
	}

	/* Bottom-right resize grip, mirroring the plot resize handle. */
	.note-resize-handle {
		position: absolute;
		right: 0;
		bottom: 0;
		width: 14px;
		height: 14px;
		cursor: nwse-resize;
		background: linear-gradient(
			135deg,
			transparent 0 50%,
			var(--color-lightness-60, #8a8a8a) 50% 60%,
			transparent 60% 70%,
			var(--color-lightness-60, #8a8a8a) 70% 80%,
			transparent 80%
		);
		border-bottom-right-radius: 6px;
	}
</style>
