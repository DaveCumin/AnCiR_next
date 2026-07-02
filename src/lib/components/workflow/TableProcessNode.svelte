<script>
	// @ts-nocheck
	// Side-by-side TableProcess node. Input ports (xIN/yIN/…) sit on the left;
	// the TP's output columns render as inline rows on the right (flowtest
	// Group-style) — each with an editable name, an expandable MiniDataTable
	// preview, and a `col_<colId>` output port on the card's right edge. An
	// `all` port in the header fans out to every (or a chosen subset of) output
	// column. There is no separate data_<colId> node for TP outputs any more.
	//
	// Port-Y publishing mirrors GroupNode: we measure rendered DOM and publish
	// each port's node-local centre Y via groupPortPositions (a node-id-keyed
	// store, not Group-specific) so WorkflowEditor.getPortAnchorY anchors wires
	// on the right row even when a preview expands it.
	import { onDestroy, tick, createEventDispatcher } from 'svelte';
	import Editable from '$lib/components/reusables/Editable.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import TypeSelector from '$lib/components/reusables/TypeSelector.svelte';
	import MiniDataTable from './MiniDataTable.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';
	import { sniffTimeFormatOnTypeChange } from '$lib/utils/columnType.js';
	import { core } from '$lib/core/core.svelte.js';
	import { getNodeName, setNodeName } from '$lib/core/nodeNaming.js';
	import NodeNoteButton from './NodeNoteButton.svelte';
	import { tooltip } from '$lib/utils/tooltip.js';
	import { setGroupPortY, clearGroupPortPositions } from './groupPortPositions.svelte.js';

	let {
		node,
		selected = false,
		expanded = false,
		spliceTargetPort = null,
		width = null
	} = $props();

	const dispatch = createEventDispatcher();

	const HEADER_H = 26; // mirrors WorkflowEditor.HEADER_H
	const PORT_H = 22; // mirrors WorkflowEditor.PORT_H

	const tp = $derived(node.tpObj);
	// Warnings published by the TP's editor (e.g. GroupComparison's normality /
	// variance cautions). Shown as a yellow triangle next to the label.
	const warnings = $derived(Array.isArray(tp?.warnings) ? tp.warnings : []);
	const hasWarning = $derived(warnings.length > 0);
	const warningText = $derived(warnings.join('\n'));
	// Note flag: keeps the left-side note button visible whenever a note exists.
	const hasNote = $derived(!!core.nodeNotes[node.id]?.trim());
	const inputPorts = $derived(node.ports?.inputs ?? []);
	// [{ key, colId }] from ProcessNode meta, resolved to live Column instances.
	// Each entry's `port` is the output dot's port name (TP: col_<colId>; free
	// process: the producer column's producerPort, e.g. out_<inputColId>). Falls
	// back to col_<colId> for older callers.
	const outputColumns = $derived(
		(node.outputColumns ?? [])
			.map(({ key, colId, port }) => ({
				key,
				colId,
				port: port ?? `col_${colId}`,
				col: getColumnById(colId)
			}))
			.filter((entry) => !!entry.col)
	);

	// Per-output-column row expansion (ephemeral UI state, keyed by colId).
	let rowExpanded = $state({});

	// Output-column rename: live on input, normalise (empty → auto name) on commit.
	function renameColumn(col, next, commit = false) {
		if (!col) return;
		if (commit) {
			const trimmed = (next ?? '').trim();
			col.customName = trimmed === '' ? null : trimmed;
		} else {
			col.customName = next ?? '';
		}
	}

	function toggleRowExpanded(colId, e) {
		e.stopPropagation();
		rowExpanded[colId] = !rowExpanded[colId];
	}

	// --- Port-position publishing ---
	let cardEl = $state();
	const inPortEls = $state({});
	const rowPortEls = $state({});

	function nodeLocalCenterY(el) {
		if (!el || !cardEl) return 0;
		const elR = el.getBoundingClientRect();
		const cardR = cardEl.getBoundingClientRect();
		const cardH = cardEl.offsetHeight || cardR.height;
		const scale = cardR.height && cardH ? cardR.height / cardH : 1;
		return (elR.top + elR.height / 2 - cardR.top) / (scale || 1);
	}

	function publishPositions() {
		if (!node) return;

		for (let i = 0; i < inputPorts.length; i++) {
			const name = inputPorts[i].name;
			const el = inPortEls[name];
			if (el) setGroupPortY(node.id, name, nodeLocalCenterY(el));
			else setGroupPortY(node.id, name, HEADER_H + i * PORT_H + PORT_H / 2);
		}
		for (let i = 0; i < outputColumns.length; i++) {
			const { colId, port } = outputColumns[i];
			const el = rowPortEls[colId];
			if (el) setGroupPortY(node.id, port, nodeLocalCenterY(el));
			else setGroupPortY(node.id, port, HEADER_H + i * PORT_H + PORT_H / 2);
		}
	}

	$effect(() => {
		// Re-publish on any layout-relevant change.
		void inputPorts.length;
		void outputColumns.length;
		const _track = outputColumns.map((c) => `${c.colId}|${rowExpanded[c.colId] ? 'e' : 'c'}`);
		void _track;
		(async () => {
			await tick();
			publishPositions();
		})();
	});

	onDestroy(() => {
		if (node) clearGroupPortPositions(node.id);
	});

	// Read-only type icon (mirrors GroupNode).
	const TYPE_ICON = {
		number: { icon: 'math', label: 'Numeric' },
		category: { icon: 'list', label: 'Category' },
		time: { icon: 'clock', label: 'Time' },
		bin: { icon: 'table', label: 'Bin' }
	};
	function typeMeta(col) {
		return TYPE_ICON[col?.type] ?? { icon: 'math', label: col?.type || 'value' };
	}

	// --- Wire events (match WorkflowNode/GroupNode semantics) ---
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
	function onPortContextMenu(e) {
		e.preventDefault();
		e.stopPropagation();
	}

	function stopPointer(e) {
		e.stopPropagation();
	}

	const NO_DRAG_SELECTOR = 'button, input, textarea, .port-dot, .editable-input';

	function onCardMouseDown(e) {
		if (e.button !== 0) return;
		if (e.target?.closest?.(NO_DRAG_SELECTOR)) return;
		dispatch('cardmousedown', e);
	}
</script>

<div
	bind:this={cardEl}
	class="tp-card"
	class:selected
	class:expanded
	style={width != null ? `width:${width}px;` : ''}
	onmousedown={onCardMouseDown}
	role="button"
	tabindex="0"
>
	<div class="tp-header">
		{#if hasWarning}
			<span
				class="node-warning-badge"
				role="img"
				aria-label={`Warning: ${warningText}`}
				{@attach tooltip(warningText)}>⚠</span
			>
		{/if}
		<!-- Note button sits on the LEFT with the warning (status indicators), so it
		     doesn't shift when the collapse/delete buttons reveal on the right. Shown
		     when a note exists, or on hover/selection. -->
		<div
			class="note-slot"
			class:has-note={hasNote}
			class:sel={selected}
			onpointerdown={stopPointer}
			role="presentation"
		>
			<NodeNoteButton nodeId={node.id} />
		</div>
		<div class="tp-title" onpointerdown={stopPointer} role="presentation">
			<Editable
				value={getNodeName(node)}
				placeholder="Process"
				ariaLabel="Rename analysis"
				title="Double-click to rename"
				onInput={(v) => setNodeName(node, v)}
				onCommit={(v) => setNodeName(node, v, { commit: true })}
			/>
		</div>
		<!-- Note · collapse · delete live in the shared action cluster pinned to the
		     header's top-right by WorkflowEditor (NodeActions), not per-node. -->
	</div>

	{#if node.sublabel}
		<div class="tp-sublabel">{node.sublabel}</div>
	{/if}

	<div class="tp-body">
		<div class="tp-inputs" role="presentation">
			{#each inputPorts as port (port.name)}
				<div class="in-row">
					<button
						type="button"
						class="port-dot dot-input inline-port in-port"
						bind:this={inPortEls[port.name]}
						data-node-id={node.id}
						data-port-name={port.name}
						data-port-dir="in"
						{@attach tooltip(`Input: ${port.name}${port.dynamic ? ' (many)' : ''}`)}
						onmousedown={(e) => disconnectInput(e, port.name)}
						onmouseup={(e) => endAtInput(e, port.name)}
						oncontextmenu={(e) => disconnectInput(e, port.name)}
						aria-label={`input port ${port.name}`}
					></button>
					<span class="in-label">{port.name}{port.dynamic ? '*' : ''}</span>
				</div>
			{/each}
		</div>

		<div
			class="tp-outputs"
			onwheel={(e) => {
				if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
			}}
			role="presentation"
		>
			{#each outputColumns as { colId, col, port } (colId)}
				{@const meta = typeMeta(col)}
				{@const isOpen = rowExpanded[colId] === true}
				<div class="out-row" class:expanded={isOpen}>
					<div class="row-strip">
						<button
							type="button"
							class="row-chev"
							aria-expanded={isOpen}
							title={isOpen ? 'Hide preview' : 'Show preview'}
							onmousedown={stopPointer}
							onclick={(e) => toggleRowExpanded(colId, e)}
						>
							<span class="chev" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
						</button>
						<span
							class="row-type"
							title="Change type ({meta.label})"
							onpointerdown={stopPointer}
							onmousedown={stopPointer}
							role="presentation"
						>
							<TypeSelector
								bind:value={col.type}
								onChange={(t) => sniffTimeFormatOnTypeChange(col, t)}
							/>
						</span>
						<div
							class="row-name"
							onpointerdown={stopPointer}
							onmousedown={stopPointer}
							role="presentation"
						>
							<Editable
								value={col.name}
								placeholder="column"
								ariaLabel="Rename output column"
								title="Double-click to rename"
								onInput={(v) => renameColumn(col, v)}
								onCommit={(v) => renameColumn(col, v, true)}
							/>
							{#if col.groupLabel}
								<span class="group-label-chip" title="Group label: {col.groupLabel}"
									>{col.groupLabel}</span
								>
							{/if}
						</div>
						<button
							type="button"
							class="port-dot dot-output inline-port row-port"
							class:splice-target={spliceTargetPort === port}
							bind:this={rowPortEls[colId]}
							data-node-id={node.id}
							data-port-name={port}
							data-port-dir="out"
							onmousedown={(e) => startFromOutput(e, port)}
							oncontextmenu={onPortContextMenu}
							onclick={(e) => e.stopPropagation()}
							{@attach tooltip(`output: ${col.name}`)}
							aria-label={`output port ${col.name}`}
						></button>
					</div>
					{#if isOpen}
						<div class="row-body" onmousedown={stopPointer} role="presentation">
							<MiniDataTable column={col} maxRows={5} />
						</div>
					{/if}
				</div>
			{/each}
			{#if outputColumns.length === 0}
				<div class="empty-hint">No output columns yet.</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.tp-card {
		position: relative;
		width: 230px;
		background: var(--surface-card);
		border-radius: var(--radius-md);
		border: 1px solid rgba(0, 0, 0, 0.18);
		box-sizing: border-box;
		font-size: var(--font-sm);
		cursor: grab;
		user-select: none;
		box-shadow: var(--shadow-1);
		transition:
			border-color 0.12s ease,
			box-shadow 0.12s ease;
	}
	.tp-card:hover {
		border-color: rgba(0, 0, 0, 0.35);
		box-shadow: var(--shadow-1);
	}
	.tp-card.selected {
		border-color: var(--color-accent);
		box-shadow:
			var(--shadow-1),
			0 0 0 2px rgba(77, 159, 227, 0.28);
	}
	.tp-card.expanded {
		border-bottom-left-radius: 0;
		border-bottom-right-radius: 0;
		border-bottom-color: transparent;
	}

	.tp-header {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 0 8px;
		height: 26px; /* HEADER_H */
		background: var(--color-lightness-97, #f4f4f4);
		border-bottom: 1px solid var(--color-lightness-90, #e7e7e7);
		border-radius: 6px 6px 0 0;
		font-weight: 600;
		color: var(--color-lightness-25, #333);
		box-sizing: border-box;
		position: relative;
	}
	.tp-title {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/* Yellow caution triangle shown next to the label when the analysis has
	   warnings (e.g. non-normal data under a parametric test). */
	.node-warning-badge {
		flex-shrink: 0;
		font-size: var(--font-md);
		line-height: 1;
		color: #e0a800;
		cursor: help;
		user-select: none;
	}
	/* Left-side note button, always visible so the label never shifts. It reads as
	   a faint "N" until a note exists (then NodeNoteButton turns it green). */
	.note-slot {
		flex-shrink: 0;
		display: flex;
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

	.tp-sublabel {
		font-size: 10px;
		color: #555;
		background-color: rgba(0, 0, 0, 0.04);
		border-radius: 3px;
		padding: 1px 4px;
		margin: 4px 8px 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.tp-body {
		display: grid;
		grid-template-columns: minmax(54px, auto) 1fr;
		align-items: start;
		padding: 2px 0;
	}

	.tp-inputs {
		display: flex;
		flex-direction: column;
		border-right: 1px solid rgba(0, 0, 0, 0.06);
	}
	.in-row {
		position: relative;
		display: flex;
		align-items: center;
		gap: 4px;
		height: 22px; /* PORT_H */
		padding-left: 4px;
	}
	.in-label {
		font-size: var(--font-xs);
		color: var(--color-lightness-40, #5b5b5b);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		margin-left: var(--space-4);
	}
	.in-port {
		position: absolute;
		left: -5px;
		top: 50%;
		transform: translateY(-50%);
	}

	.tp-outputs {
		position: relative;
		display: flex;
		flex-direction: column;
	}
	.out-row {
		position: relative;
		border-bottom: 1px solid rgba(0, 0, 0, 0.04);
	}
	.out-row:last-child {
		border-bottom: 0;
	}
	.row-strip {
		position: relative;
		display: grid;
		grid-template-columns: 14px 16px minmax(0, 1fr);
		align-items: center;
		gap: 4px;
		height: 22px; /* PORT_H */
		padding: 0 0 0 4px;
		font-size: var(--font-xs);
	}
	.row-chev {
		padding: 0;
		font-size: 0.7rem;
		background: transparent;
		border: 0;
		cursor: pointer;
		color: rgba(0, 0, 0, 0.5);
	}
	.row-chev:hover {
		color: rgba(0, 0, 0, 0.85);
	}
	.chev {
		display: inline-block;
		width: 0.7em;
		text-align: center;
	}
	.row-type {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: rgba(0, 0, 0, 0.55);
	}
	.row-name {
		min-width: 0;
		padding-right: 14px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 500;
		color: rgba(0, 0, 0, 0.8);
	}
	.group-label-chip {
		display: inline-block;
		margin-left: 6px;
		padding: 0 5px;
		border-radius: 8px;
		font-size: 10px;
		font-weight: 600;
		line-height: 1.4;
		color: var(--color-accent, #2563eb);
		background: var(--color-accent-soft, #dbeafe);
		vertical-align: middle;
	}
	.row-body {
		padding: 4px 8px 6px 18px;
		background: rgba(0, 0, 0, 0.02);
	}

	.inline-port {
		width: 13px;
		height: 13px;
		border-radius: 50%;
		background: var(--color-lightness-95, #ececec);
		border: 1px solid var(--color-lightness-60, #8a8a8a);
		cursor: crosshair;
		padding: 0;
		overflow: visible;
	}

	/* Invisible enlarged hit area so wiring doesn't require a pixel-perfect drop. */
	.inline-port::before {
		content: '';
		position: absolute;
		inset: -4px -16px;
		border-radius: var(--radius-lg);
	}
	.inline-port:hover {
		background: var(--color-accent);
		border-color: var(--color-accent);
	}
	.inline-port.splice-target {
		background: var(--color-accent);
		border-color: var(--color-accent);
		box-shadow: 0 0 0 4px rgba(77, 159, 227, 0.35);
	}
	.row-port {
		position: absolute;
		right: -5px;
		top: 50%;
		transform: translateY(-50%);
	}
	.empty-hint {
		padding: 6px 8px;
		font-size: var(--font-xs);
		color: rgba(0, 0, 0, 0.45);
		text-align: center;
	}

</style>
