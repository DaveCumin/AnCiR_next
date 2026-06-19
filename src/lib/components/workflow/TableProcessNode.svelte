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
	import MiniDataTable from './MiniDataTable.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';
	import { core } from '$lib/core/core.svelte.js';
	import { getNodeName, setNodeName } from '$lib/core/nodeNaming.js';
	import NodeNoteButton from './NodeNoteButton.svelte';
	import { tooltip } from '$lib/utils/tooltip.js';
	import {
		setGroupPortY,
		clearGroupPortPositions
	} from './groupPortPositions.svelte.js';

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

	const allColumnIds = $derived(Array.isArray(tp?.args?.allColumnIds) ? tp.args.allColumnIds : null);
	const allIsSubset = $derived(allColumnIds !== null);

	let allMenuOpen = $state(false);
	// Per-output-column row expansion (ephemeral UI state, keyed by colId).
	let rowExpanded = $state({});

	function isInAllOutput(colId) {
		return !allIsSubset || allColumnIds?.includes(colId);
	}

	function toggleAllColumnInclusion(colId) {
		if (!tp) return;
		const everyId = outputColumns.map((c) => c.colId);
		const current = allColumnIds ?? everyId.slice();
		const next = current.includes(colId)
			? current.filter((id) => id !== colId)
			: [...current, colId];
		const everyone = next.length === everyId.length && everyId.every((id) => next.includes(id));
		tp.args.allColumnIds = everyone ? null : next;
	}

	function resetAllColumns() {
		if (tp) tp.args.allColumnIds = null;
	}

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

	function onAllPortContextMenu(e) {
		e.preventDefault();
		e.stopPropagation();
		allMenuOpen = !allMenuOpen;
	}
	function onAllPortDblClick(e) {
		e.preventDefault();
		e.stopPropagation();
		allMenuOpen = !allMenuOpen;
	}
	function onAllMenuKeydown(e) {
		if (e.key === 'Escape') {
			e.preventDefault();
			allMenuOpen = false;
		}
	}

	// --- Port-position publishing ---
	let cardEl = $state();
	let allPortEl = $state();
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
		// All port lives in the header strip.
		if (allPortEl) setGroupPortY(node.id, 'all', nodeLocalCenterY(allPortEl));
		else setGroupPortY(node.id, 'all', HEADER_H / 2);

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

	const NO_DRAG_SELECTOR =
		'button, input, textarea, .port-dot, .editable-input';

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
		<div class="all-port-wrap">
			<button
				type="button"
				class="port-dot dot-output inline-port all-port"
				class:subset={allIsSubset}
				class:splice-target={spliceTargetPort === 'all'}
				bind:this={allPortEl}
				data-node-id={node.id}
				data-port-name="all"
				data-port-dir="out"
				onmousedown={(e) => startFromOutput(e, 'all')}
				oncontextmenu={onAllPortContextMenu}
				ondblclick={onAllPortDblClick}
				onclick={(e) => e.stopPropagation()}
				{@attach tooltip(
					allIsSubset
						? `all (${allColumnIds.length} of ${outputColumns.length} outputs)`
						: `all (every output)`
				)}
				aria-label="output port all"
				aria-haspopup="menu"
			></button>
			{#if allMenuOpen}
				<div
					class="all-menu-popover"
					role="menu"
					aria-label="Select outputs for all"
					tabindex="-1"
					onkeydown={onAllMenuKeydown}
					onpointerdown={stopPointer}
					onmousedown={stopPointer}
					onwheel={(e) => { if (!e.ctrlKey && !e.metaKey) e.stopPropagation(); }}
				>
					<div class="all-menu-title">Include in "all" output</div>
					<div class="all-menu-list">
						{#each outputColumns as { colId, col } (colId)}
							<label class="all-menu-item">
								<input
									type="checkbox"
									checked={isInAllOutput(colId)}
									onchange={() => toggleAllColumnInclusion(colId)}
								/>
								<span>{col.name}</span>
							</label>
						{/each}
						{#if outputColumns.length === 0}
							<div class="all-menu-empty">No outputs yet.</div>
						{/if}
					</div>
					<div class="all-menu-actions">
						<button
							type="button"
							class="all-menu-btn"
							onclick={resetAllColumns}
							disabled={!allIsSubset}
						>Reset (all)</button>
						<button type="button" class="all-menu-btn" onclick={() => (allMenuOpen = false)}>Close</button>
					</div>
				</div>
			{/if}
		</div>
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
			onwheel={(e) => { if (!e.ctrlKey && !e.metaKey) e.stopPropagation(); }}
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
						<span class="row-type" title={meta.label}>
							<Icon name={meta.icon} width={12} height={12} className="icon" />
						</span>
						<div class="row-name" onpointerdown={stopPointer} onmousedown={stopPointer} role="presentation">
							<Editable
								value={col.name}
								placeholder="column"
								ariaLabel="Rename output column"
								title="Double-click to rename"
								onInput={(v) => renameColumn(col, v)}
								onCommit={(v) => renameColumn(col, v, true)}
							/>
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
		background: #ffffff;
		border-radius: 6px;
		border: 1px solid rgba(0, 0, 0, 0.18);
		box-sizing: border-box;
		font-size: 12px;
		cursor: grab;
		user-select: none;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
		transition:
			border-color 0.12s ease,
			box-shadow 0.12s ease;
	}
	.tp-card:hover {
		border-color: rgba(0, 0, 0, 0.35);
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
	}
	.tp-card.selected {
		border-color: var(--color-accent, #4d9fe3);
		box-shadow:
			0 1px 3px rgba(0, 0, 0, 0.08),
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
		font-size: 13px;
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
		color: var(--color-accent, #4d9fe3);
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
		font-size: 11px;
		color: var(--color-lightness-40, #5b5b5b);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
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
		font-size: 11px;
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
		border-radius: 8px;
	}
	.inline-port:hover {
		background: var(--color-accent, #4d9fe3);
		border-color: var(--color-accent, #4d9fe3);
	}
	.inline-port.splice-target {
		background: var(--color-accent, #4d9fe3);
		border-color: var(--color-accent, #4d9fe3);
		box-shadow: 0 0 0 4px rgba(77, 159, 227, 0.35);
	}
	.row-port {
		position: absolute;
		right: -5px;
		top: 50%;
		transform: translateY(-50%);
	}
	.all-port {
		position: relative;
		display: block;
	}
	.all-port.subset {
		border-radius: 0 999px 999px 0;
		width: 7px;
		background: rgba(106, 159, 212, 0.25);
		border-color: #6a9fd4;
	}
	.all-port-wrap {
		position: absolute;
		right: -13px; /* -5 dot - 8 header padding, matches GroupNode */
		top: 50%;
		transform: translateY(-50%);
		width: 13px;
		height: 13px;
	}

	.empty-hint {
		padding: 6px 8px;
		font-size: 11px;
		color: rgba(0, 0, 0, 0.45);
		text-align: center;
	}

	.all-menu-popover {
		position: absolute;
		top: calc(100% + 6px);
		right: -4px;
		z-index: 40;
		min-width: 200px;
		max-width: 280px;
		padding: 6px;
		background: #fff;
		border: 1px solid rgba(0, 0, 0, 0.18);
		border-radius: 4px;
		box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.all-menu-title {
		font-size: 10px;
		font-weight: 600;
		color: rgba(0, 0, 0, 0.5);
		padding: 2px 4px;
	}
	.all-menu-list {
		display: flex;
		flex-direction: column;
		max-height: 220px;
		overflow-y: auto;
	}
	.all-menu-item {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 3px 4px;
		font-size: 11px;
		cursor: pointer;
		border-radius: 3px;
	}
	.all-menu-item:hover {
		background: rgba(0, 0, 0, 0.04);
	}
	.all-menu-empty {
		padding: 4px;
		font-size: 10px;
		color: rgba(0, 0, 0, 0.5);
	}
	.all-menu-actions {
		display: flex;
		justify-content: flex-end;
		gap: 4px;
		border-top: 1px solid rgba(0, 0, 0, 0.08);
		padding-top: 4px;
	}
	.all-menu-btn {
		padding: 2px 8px;
		font-size: 10px;
		background: transparent;
		border: 1px solid rgba(0, 0, 0, 0.18);
		border-radius: 3px;
		cursor: pointer;
	}
	.all-menu-btn:hover:not(:disabled) {
		background: rgba(0, 0, 0, 0.04);
	}
	.all-menu-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
