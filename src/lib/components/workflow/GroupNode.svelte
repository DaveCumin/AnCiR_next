<script>
	// @ts-nocheck
	// flowtest-style Source group. Absorbs data columns as inline rows with
	// per-row output ports. Children rows are pure visual — the underlying
	// Column lives in core.data, the row just references it by id.
	//
	// Port layout: outputs = [all, col_X1, col_X2, ...]. WorkflowEditor's
	// `getPortAnchorY` consults `groupPortPositions` (which this component
	// populates after layout) so wires anchor at the correct row Y even when
	// the mini-table preview expands a row.
	import { onDestroy, tick, createEventDispatcher } from 'svelte';
	import Editable from '$lib/components/reusables/Editable.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import TypeSelector from '$lib/components/reusables/TypeSelector.svelte';
	import MiniDataTable from './MiniDataTable.svelte';
	import NodeNoteButton from './NodeNoteButton.svelte';
	import { sniffTimeFormatOnTypeChange } from '$lib/utils/columnType.js';
	import { core, removeGroup } from '$lib/core/core.svelte.js';
	import { getColumnById } from '$lib/core/Column.svelte';
	import { tooltip } from '$lib/utils/tooltip.js';
	import {
		setGroupPortY,
		clearGroupPortPositions
	} from './groupPortPositions.svelte.js';

	let {
		node,
		selected = false,
		isDropTarget = false,
		spliceTargetPort = null
	} = $props();

	const dispatch = createEventDispatcher();

	const HEADER_H = 26; // mirrors WorkflowEditor.HEADER_H
	const PORT_H = 22; // mirrors WorkflowEditor.PORT_H — per-row strip height

	const group = $derived(node.groupObj);
	const sourceColumnIds = $derived(group?.sourceColumnIds ?? []);
	const collapsed = $derived(group?.collapsed === true);
	const sourceColumns = $derived(
		sourceColumnIds
			.map((id) => ({ id, col: getColumnById(id) }))
			.filter((entry) => !!entry.col)
	);

	// Live on input, normalise (empty → "Group") on commit.
	function renameGroup(next, commit = false) {
		if (!group) return;
		if (commit) {
			const trimmed = (next ?? '').trim();
			group.name = trimmed === '' ? 'Group' : trimmed;
		} else {
			group.name = next ?? '';
		}
	}

	function deleteGroup(e) {
		e.stopPropagation();
		if (group) removeGroup(group.id);
	}

	function toggleCollapsed(e) {
		e.stopPropagation();
		if (!group) return;
		group.collapsed = !collapsed;
	}

	function ensureRowState(colId) {
		if (!group) return null;
		if (!group.rowState) group.rowState = {};
		if (!group.rowState[colId]) group.rowState[colId] = { expanded: false };
		return group.rowState[colId];
	}

	function toggleRowExpanded(colId, e) {
		e.stopPropagation();
		const st = ensureRowState(colId);
		if (st) st.expanded = !st.expanded;
	}

	function renameColumn(col, next, commit = false) {
		if (!col) return;
		if (commit) {
			const trimmed = (next ?? '').trim();
			col.customName = trimmed === '' ? null : trimmed;
		} else {
			col.customName = next ?? '';
		}
	}

	// Resize handle (bottom-right) — drag to resize the card. Width affects edge
	// anchor X (WorkflowEditor reads groupObj.width).
	let resizing = $state(null);
	function startResize(e) {
		e.stopPropagation();
		e.preventDefault();
		if (!group) return;
		resizing = {
			startMouse: { x: e.clientX, y: e.clientY },
			startW: group.width,
			startH: group.height
		};
		window.addEventListener('pointermove', onResizeMove);
		window.addEventListener('pointerup', stopResize, { once: true });
	}
	function onResizeMove(e) {
		if (!resizing || !group) return;
		const dx = e.clientX - resizing.startMouse.x;
		const dy = e.clientY - resizing.startMouse.y;
		group.width = Math.max(180, resizing.startW + dx);
		group.height = Math.max(120, resizing.startH + dy);
	}
	function stopResize() {
		resizing = null;
		window.removeEventListener('pointermove', onResizeMove);
	}

	// Port-position publishing — measure rendered DOM and emit Y per port.
	let cardEl = $state();
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
		if (!group) return;
		// Row strips start immediately below the header. Each is PORT_H tall,
		// so the i-th row's port-centre (assuming no rows above are expanded)
		// sits at HEADER_H + i*PORT_H + PORT_H/2. The DOM-measured Y above
		// replaces this whenever a row is expanded, but the formula is the
		// best estimate until the first measurement lands.
		for (let i = 0; i < sourceColumns.length; i++) {
			const { id } = sourceColumns[i];
			const el = rowPortEls[id];
			if (el) {
				setGroupPortY(group.id, `col_${id}`, nodeLocalCenterY(el));
			} else {
				setGroupPortY(group.id, `col_${id}`, HEADER_H + i * PORT_H + PORT_H / 2);
			}
		}
	}

	$effect(() => {
		// Re-publish on any structural change. Touch deps explicitly so the
		// effect re-runs even if the underlying DOM measure hasn't changed yet.
		void sourceColumnIds.length;
		void collapsed;
		void group?.rowState;
		void group?.width;
		void group?.height;
		const _track = sourceColumns.map((s) => `${s.id}|${group?.rowState?.[s.id]?.expanded ? 'e' : 'c'}`);
		void _track;
		(async () => {
			await tick();
			publishPositions();
		})();
	});

	onDestroy(() => {
		if (group) clearGroupPortPositions(group.id);
	});

	// Type icon lookup. AnCiR columns use 'number' / 'category' / 'time' / 'bin';
	// map onto the icons we have. Unknown types fall back to math.
	const TYPE_ICON = {
		number: { icon: 'math', label: 'Numeric' },
		category: { icon: 'list', label: 'Category' },
		time: { icon: 'clock', label: 'Time' },
		bin: { icon: 'table', label: 'Bin' }
	};

	function typeMeta(col) {
		return TYPE_ICON[col?.type] ?? { icon: 'math', label: col?.type || 'value' };
	}

	// Drag-grip pointerdown → tell the editor an extract gesture started. The
	// editor owns the window-level pointermove + drop math (and the optional
	// ghost preview), then calls back when the user releases outside the card.
	function onGripPointerDown(e, colId) {
		if (e.button !== 0) return;
		e.stopPropagation();
		e.preventDefault();
		dispatch('extractstart', {
			groupId: group.id,
			colId,
			clientX: e.clientX,
			clientY: e.clientY
		});
	}

	// The wire-drag system uses `mousedown` on output ports (matching
	// WorkflowNode.startFromOutput) — keep the same semantic here.
	function onPortMouseDown(e, portName) {
		e.stopPropagation();
		e.preventDefault();
		dispatch('portstart', { nodeId: node.id, port: portName, direction: 'out' });
	}

	function onPortContextMenu(e) {
		// Right-clicking an output port on a Source row is harmless — eat the
		// browser menu so it doesn't appear while the user is wiring.
		e.preventDefault();
		e.stopPropagation();
	}

	// The canvas wrapper kicks off a node-drag on `mousedown`; pointer events
	// have separate listeners so stopping pointerdown alone isn't enough. We
	// stop both flavours on every interactive sub-region inside the card.
	function stopPointer(e) {
		e.stopPropagation();
	}

	// Selector for elements inside the card that own their own click semantics
	// (buttons, inputs, port dots, the resize handle, the row grip). A
	// mousedown that originates inside any of these should NOT also start a
	// group drag.
	const NO_DRAG_SELECTOR =
		'button, input, textarea, .port-dot, .group-resize-handle, .editable-input';

	// Explicit dispatch of a drag-start event so WorkflowEditor doesn't have
	// to rely on plain DOM bubbling to its wrapper's `onmousedown`. We saw
	// the wrapper handler get skipped in practice (likely a Svelte 5 event
	// timing quirk around our child custom-event dispatchers); forwarding the
	// raw MouseEvent via `dispatch` makes the drag start deterministic.
	function onCardMouseDown(e) {
		if (e.button !== 0) return;
		if (e.target?.closest?.(NO_DRAG_SELECTOR)) return;
		dispatch('cardmousedown', e);
	}
</script>

<div
	bind:this={cardEl}
	class="group-card"
	class:selected
	class:drop-target={isDropTarget}
	style="width:{group?.width ?? 240}px; min-height:{group?.height ?? 180}px;"
	onmousedown={onCardMouseDown}
>
	<div class="group-header" role="presentation">
		<button
			type="button"
			class="header-collapse"
			aria-expanded={!collapsed}
			title={collapsed ? 'Expand sources' : 'Collapse sources'}
			onmousedown={stopPointer}
			onclick={toggleCollapsed}
		>
			<span class="chev" aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
		</button>
		<div class="group-title" onpointerdown={stopPointer} role="presentation">
			<Editable
				value={group?.name ?? 'Group'}
				placeholder="Group"
				ariaLabel="Rename group"
				title="Double-click to rename"
				onInput={(v) => renameGroup(v)}
				onCommit={(v) => renameGroup(v, true)}
			/>
		</div>
		<span class="sources-count" title="Source count">{sourceColumnIds.length}</span>
		<NodeNoteButton nodeId={node.id} />
		<button
			class="group-close"
			type="button"
			onmousedown={stopPointer}
			onclick={deleteGroup}
			title="Delete group"
			aria-label="Delete group"
		>✕</button>
	</div>

	{#if !collapsed}
		<div class="group-rows" onwheel={(e) => { if (!e.ctrlKey && !e.metaKey) e.stopPropagation(); }} role="presentation">
			{#each sourceColumns as { id, col } (id)}
				{@const meta = typeMeta(col)}
				{@const expanded = group?.rowState?.[id]?.expanded === true}
				<div class="source-row" class:expanded>
					<div class="row-strip" role="presentation">
						<button
							type="button"
							class="row-grip"
							title="Drag out of group to pop into a standalone Data node"
							aria-label="Drag to extract source"
							onpointerdown={(e) => onGripPointerDown(e, id)}
							onmousedown={stopPointer}
						>
							<span aria-hidden="true">⠿</span>
						</button>
						<button
							type="button"
							class="row-chev"
							aria-expanded={expanded}
							title={expanded ? 'Hide preview' : 'Show preview'}
							onmousedown={stopPointer}
							onclick={(e) => toggleRowExpanded(id, e)}
						>
							<span class="chev" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
						</button>
						<span
							class="row-type"
							title="Change type ({meta.label})"
							onpointerdown={stopPointer}
							onmousedown={stopPointer}
							role="presentation"
						>
							<TypeSelector bind:value={col.type} onChange={(t) => sniffTimeFormatOnTypeChange(col, t)} />
						</span>
						<div class="row-name" onpointerdown={stopPointer} onmousedown={stopPointer} role="presentation">
							<Editable
								value={col.name}
								placeholder="column"
								ariaLabel="Rename column"
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
							class:splice-target={spliceTargetPort === `col_${id}`}
							bind:this={rowPortEls[id]}
							data-node-id={node.id}
							data-port-name={`col_${id}`}
							data-port-dir="out"
							onmousedown={(e) => onPortMouseDown(e, `col_${id}`)}
							oncontextmenu={onPortContextMenu}
							{@attach tooltip(`output: ${col.name}`)}
							aria-label={`output port ${col.name}`}
						></button>
					</div>
					{#if expanded}
						<div class="row-body" onmousedown={stopPointer} role="presentation">
							<MiniDataTable column={col} maxRows={5} />
						</div>
					{/if}
				</div>
			{/each}
			{#if sourceColumns.length === 0}
				<div class="empty-hint">Drag a data column inside to add it.</div>
			{/if}
		</div>
	{/if}

	<div
		class="group-resize-handle"
		onpointerdown={startResize}
		onmousedown={stopPointer}
		title="Drag to resize"
		role="presentation"
	></div>
</div>

<style>
	.group-card {
		position: relative;
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

	.group-card:hover {
		border-color: rgba(0, 0, 0, 0.35);
		box-shadow: var(--shadow-1);
	}

	.group-card.selected {
		border-color: var(--color-accent);
		box-shadow:
			var(--shadow-1),
			0 0 0 2px rgba(77, 159, 227, 0.28);
	}

	.group-card.drop-target {
		border: 2px dashed #28a745;
		box-shadow: 0 0 0 3px rgba(40, 167, 69, 0.25);
	}

	.group-header {
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

	.header-collapse {
		padding: 0;
		background: transparent;
		border: 0;
		cursor: pointer;
		color: rgba(0, 0, 0, 0.6);
		font-size: var(--font-xs);
		line-height: 1;
	}
	.header-collapse:hover {
		color: rgba(0, 0, 0, 0.9);
	}
	.chev {
		display: inline-block;
		width: 0.7em;
		text-align: center;
	}

	.group-title {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.sources-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 18px;
		padding: 0 5px;
		height: 16px;
		font-size: 10px;
		font-weight: 600;
		background: rgba(255, 255, 255, 0.6);
		border-radius: var(--radius-lg);
		color: rgba(0, 0, 0, 0.6);
	}

	.group-close {
		background: transparent;
		border: none;
		cursor: pointer;
		color: rgba(0, 0, 0, 0.5);
		font-size: var(--font-sm);
		padding: 0 2px;
		line-height: 1;
	}
	.group-close:hover {
		color: rgba(0, 0, 0, 0.9);
	}

	.group-rows {
		position: relative;
		display: flex;
		flex-direction: column;
		padding: 2px 0;
	}

	.empty-hint {
		padding: 8px 10px;
		font-size: var(--font-xs);
		color: rgba(0, 0, 0, 0.45);
		text-align: center;
	}

	.source-row {
		position: relative;
		border-bottom: 1px solid rgba(0, 0, 0, 0.04);
	}
	.source-row:last-child {
		border-bottom: 0;
	}

	.row-strip {
		position: relative;
		display: grid;
		grid-template-columns: 14px 14px 16px minmax(0, 1fr);
		align-items: center;
		gap: 4px;
		height: 22px; /* PORT_H */
		/* No right padding — `.row-port`'s absolute positioning is relative to
		   this padding-edge, and we need that edge to sit at the card's right
		   border so the dot's centre lines up with the wire endpoint
		   (`pos.x + group.width`). The visual buffer between the column name
		   and the port comes from `.row-name { padding-right }` below. */
		padding: 0 0 0 4px;
		font-size: var(--font-xs);
	}

	.row-grip {
		padding: 0;
		font-size: 0.85rem;
		line-height: 1;
		color: rgba(0, 0, 0, 0.4);
		background: transparent;
		border: 0;
		cursor: grab;
		touch-action: none;
		user-select: none;
	}
	.row-grip:active {
		cursor: grabbing;
	}
	.row-grip:hover {
		color: var(--color-accent);
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

	.row-type {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: rgba(0, 0, 0, 0.55);
	}

	.row-name {
		min-width: 0;
		/* Visual buffer for the absolute-positioned `.row-port` that overlaps
		   the right edge of this column — keeps the column text from running
		   underneath the dot without changing the grid layout. */
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
		padding: 4px 8px 6px 22px;
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
	/* Active drop target while dragging a 1-in-1-out process onto this
	   output port. Mirrors the highlight used in WorkflowNode. */
	.inline-port.splice-target {
		background: var(--color-accent);
		border-color: var(--color-accent);
		box-shadow: 0 0 0 4px rgba(77, 159, 227, 0.35);
	}
	.row-port {
		/* Anchored on the card's right edge so wire endpoints land on the dot
		   centre (edge code uses `pos.x + group.width`). */
		position: absolute;
		right: -5px;
		top: 50%;
		transform: translateY(-50%);
	}
	.group-resize-handle {
		position: absolute;
		right: 0;
		bottom: 0;
		width: 14px;
		height: 14px;
		cursor: nwse-resize;
		background: linear-gradient(
			135deg,
			transparent 0 6px,
			rgba(0, 0, 0, 0.35) 6px 8px,
			transparent 8px 100%
		);
	}
</style>
