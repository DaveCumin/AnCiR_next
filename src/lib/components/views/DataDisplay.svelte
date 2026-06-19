<script>
	// @ts-nocheck
	import { core, appConsts, appState } from '$lib/core/core.svelte.js';
	import { getColumnById } from '$lib/core/Column.svelte';
	import { producerInputColId } from '$lib/core/producerRuntime.js';
	import { tick, untrack } from 'svelte';

	import Icon from '$lib/icons/Icon.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import TableProcess from '$lib/core/TableProcess.svelte';
	import MakeNewColumn from './modals/MakeNewColumn.svelte';
	import { openImportData } from '$lib/core/dataSourceActions.js';
	import SwapColumns from './modals/SwapColumns.svelte';
	import Editable from '../inputs/Editable.svelte';
	import { tooltip } from '$lib/utils/tooltip.js';

	let showSwapColumns = $state(false);
	let showNewCol = $state(false);
	let newColInitialType = $state('');

	function openMakeNewColumn() {
		newColInitialType = '';
		showNewCol = true;
	}

	// Expand state — keyed by section id (group id, '__tps__', '__ungrouped__').
	// The Computed (table-process) section starts open so TP nodes are always
	// visible without needing a canvas double-click to reveal them.
	let openSections = $state({ __tps__: true });

	// Toggle a section open/closed from a header click. `<details>` uses
	// `bind:open`, so we MUST preventDefault to stop the browser's native toggle
	// from also flipping `open` — without it the native toggle and this manual
	// flip cancel out (double-toggle) and the section never expands. That double
	// flip is why, previously, sections only opened via canvas selection (which
	// set the state directly). Skip clicks on the inline name editor or buttons
	// so renaming / the caret keep their own behaviour.
	function toggleSection(e, id) {
		e.preventDefault();
		if (e.target?.closest?.('.inline-edit-span, .inline-edit-input, input, textarea, button')) {
			return;
		}
		openSections[id] = !openSections[id];
	}

	// Caret-button toggle: preventDefault for the same reason as above, plus
	// stopPropagation so the surrounding summary handler doesn't also fire.
	function toggleSectionFromCaret(e, id) {
		e.preventDefault();
		e.stopPropagation();
		openSections[id] = !openSections[id];
	}

	// ─── Canvas-selection mirroring ─────────────────────────────────────────────
	const canvasSelection = $derived.by(() => {
		const raw = appState.canvasSelectedNodeId;
		if (!raw || typeof raw !== 'string') return null;
		const m = raw.match(/^(data|process|tableprocess)_(\d+)$/);
		if (!m) return null;
		return { kind: m[1], id: Number(m[2]) };
	});

	// Which section owns the selected item? Used to auto-open its <details>.
	const selectedSectionId = $derived.by(() => {
		const sel = canvasSelection;
		if (!sel) return null;
		if (sel.kind === 'tableprocess') return '__tps__';
		// data or process kind: find the column id, then check group membership.
		let colId = null;
		if (sel.kind === 'data') colId = sel.id;
		else {
			const owner = core.data.find((c) => (c.processes ?? []).some((p) => p.id === sel.id));
			colId = owner?.id ?? null;
		}
		if (colId == null) return null;
		for (const g of core.groups ?? []) {
			if ((g.sourceColumnIds ?? []).includes(colId)) return g.id;
		}
		return '__ungrouped__';
	});

	// Scroll-into-view refs keyed by `${kind}_${id}`
	let rowRefs = $state({});

	$effect(() => {
		const sel = canvasSelection;
		const sid = selectedSectionId;
		if (!sel || !sid) return;
		untrack(() => {
			openSections[sid] = true;
		});
		tick().then(() => {
			const el = rowRefs[`${sel.kind}_${sel.id}`];
			if (el?.scrollIntoView) {
				el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
			}
		});
	});

	// Collect every column id that's an output of a free TP — these aren't
	// listed under groups (they're derived) but show under each TP's row.
	const tpOutputColIds = $derived.by(() => {
		const s = new Set();
		for (const tp of core.tableProcesses ?? []) {
			for (const cid of Object.values(tp.args?.out ?? {})) {
				if (typeof cid === 'number' && cid >= 0) s.add(cid);
			}
		}
		return s;
	});

	const groupedColumnIds = $derived.by(() => {
		const s = new Set();
		for (const g of core.groups ?? []) {
			for (const cid of g.sourceColumnIds ?? []) s.add(cid);
		}
		return s;
	});

	// A producer column is the output of an operation node (dataflow model). It is
	// shown nested under its SOURCE column (see derivedChildren / the derivedTree
	// snippet), never in a flat top-level list.
	function isProducerColumn(c) {
		return c?.producerNodeId != null && c.refId == null && c.data == null;
	}

	// Producer columns whose source (the operation node's input) is colId.
	function derivedChildren(colId) {
		return (core.data ?? []).filter(
			(c) => isProducerColumn(c) && producerInputColId(c.producerNodeId, c.producerPort) === colId
		);
	}

	// Columns not in any group, not a TP output column, and not a producer column
	// (producers render nested under their source, not at the top level).
	const ungroupedColumns = $derived.by(() => {
		return (core.data ?? []).filter(
			(c) => !groupedColumnIds.has(c.id) && !tpOutputColIds.has(c.id) && !isProducerColumn(c)
		);
	});

	// ─── Drag-and-drop reorder ─────────────────────────────────────────────────
	// MIME-style payloads encode kind + ids. Drop targets call the appropriate
	// reorder helper.
	let dropHint = $state({ section: null, beforeId: null });

	function startDragGroup(e, groupId) {
		e.dataTransfer?.setData('application/x-ancir-drag', `group:${groupId}`);
		e.dataTransfer.effectAllowed = 'move';
	}
	function startDragColumn(e, columnId, fromSection) {
		e.dataTransfer?.setData('application/x-ancir-drag', `col:${columnId}:${fromSection}`);
		e.dataTransfer.effectAllowed = 'move';
	}
	function startDragTP(e, tpId) {
		e.dataTransfer?.setData('application/x-ancir-drag', `tp:${tpId}`);
		e.dataTransfer.effectAllowed = 'move';
	}

	function parsePayload(dt) {
		const raw = dt?.getData?.('application/x-ancir-drag') ?? '';
		if (!raw) return null;
		const [kind, ...rest] = raw.split(':');
		return { kind, rest };
	}

	function reorderGroup(draggedId, beforeId) {
		const groups = core.groups;
		const from = groups.findIndex((g) => g.id === draggedId);
		if (from < 0) return;
		const [moved] = groups.splice(from, 1);
		let to = beforeId == null ? groups.length : groups.findIndex((g) => g.id === beforeId);
		if (to < 0) to = groups.length;
		groups.splice(to, 0, moved);
	}

	function moveColumnTo(colId, toSection, beforeColId) {
		// Remove from current group, if any.
		for (const g of core.groups ?? []) {
			if ((g.sourceColumnIds ?? []).includes(colId)) {
				g.sourceColumnIds = g.sourceColumnIds.filter((id) => id !== colId);
				if (Array.isArray(g.allColumnIds)) {
					g.allColumnIds = g.allColumnIds.filter((id) => id !== colId);
				}
			}
		}
		if (toSection === '__ungrouped__') return; // left ungrouped, no further insert
		const target = core.groups.find((g) => g.id === toSection);
		if (!target) return;
		const list = target.sourceColumnIds ?? [];
		let to = beforeColId == null ? list.length : list.indexOf(beforeColId);
		if (to < 0) to = list.length;
		target.sourceColumnIds = [...list.slice(0, to), colId, ...list.slice(to)];
	}

	function reorderTP(tpId, beforeTpId) {
		const arr = core.tableProcesses;
		const from = arr.findIndex((tp) => tp.id === tpId);
		if (from < 0) return;
		const [moved] = arr.splice(from, 1);
		let to = beforeTpId == null ? arr.length : arr.findIndex((tp) => tp.id === beforeTpId);
		if (to < 0) to = arr.length;
		arr.splice(to, 0, moved);
	}

	function onDropSection(e, section, beforeId) {
		e.preventDefault();
		e.stopPropagation();
		const payload = parsePayload(e.dataTransfer);
		dropHint = { section: null, beforeId: null };
		if (!payload) return;
		if (payload.kind === 'group') {
			reorderGroup(payload.rest[0], beforeId);
		} else if (payload.kind === 'col') {
			const [colIdStr] = payload.rest;
			moveColumnTo(Number(colIdStr), section, beforeId == null ? null : Number(beforeId));
		} else if (payload.kind === 'tp') {
			reorderTP(Number(payload.rest[0]), beforeId == null ? null : Number(beforeId));
		}
	}

	function onDragOverSection(e, section, beforeId) {
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
		dropHint = { section, beforeId };
	}
</script>

<div class="heading">
	<p>Data Sources</p>

	<div class="databuttons">
		<button class="icon" onclick={() => (showSwapColumns = true)} title="Swap columns">
			<Icon name="swap" width={16} height={16} />
		</button>
		<button
			class="icon"
			onclick={() => openImportData()}
			title="Import data"
			{@attach tooltip('Import data')}
		>
			<Icon name="add" width={16} height={16} />
		</button>
	</div>
</div>

<div class="display-list">
	<!-- Derived (producer) columns render nested beneath their source column, so the
	     data flow reads top-to-bottom (e.g. "values_0 → Add" sits under "values_0"). -->
	{#snippet derivedTree(parentColId, depth)}
		{#each derivedChildren(parentColId) as child (child.id)}
			<div
				class="second-clps derived-col"
				style="--depth:{depth}"
				class:canvas-selected={canvasSelection?.kind === 'data' && canvasSelection.id === child.id}
			>
				<ColumnComponent col={child} />
			</div>
			{@render derivedTree(child.id, depth + 1)}
		{/each}
	{/snippet}

	<!-- Groups -->
	{#each core.groups as group (group.id)}
		<div
			class="clps-container"
			draggable="true"
			ondragstart={(e) => startDragGroup(e, group.id)}
			ondragover={(e) => onDragOverSection(e, '__group_order__', group.id)}
			ondrop={(e) => onDropSection(e, '__group_order__', group.id)}
		>
			<details class="clps-item" bind:open={openSections[group.id]}>
				<summary class="clps-title-container" onclick={(e) => toggleSection(e, group.id)}>
					<div class="clps-title">
						<p><Editable bind:value={group.name} /></p>
					</div>
					<div class="clps-title-button">
						<button class="icon" onclick={(e) => toggleSectionFromCaret(e, group.id)}>
							{#if openSections[group.id]}
								<Icon name="caret-down" width={20} height={20} />
							{:else}
								<Icon name="caret-right" width={20} height={20} />
							{/if}
						</button>
					</div>
				</summary>

				{#each group.sourceColumnIds ?? [] as colId (colId)}
					{@const col = getColumnById(colId)}
					{#if col}
						{@const colSelected = canvasSelection?.kind === 'data' && canvasSelection.id === col.id}
						{@const ownsSelectedProcess =
							canvasSelection?.kind === 'process' &&
							col.processes?.some((pr) => pr.id === canvasSelection.id)}
						<div
							class="second-clps"
							class:canvas-selected={colSelected || ownsSelectedProcess}
							bind:this={rowRefs[`data_${col.id}`]}
							draggable="true"
							ondragstart={(e) => startDragColumn(e, col.id, group.id)}
							ondragover={(e) => onDragOverSection(e, group.id, col.id)}
							ondrop={(e) => onDropSection(e, group.id, col.id)}
						>
							<ColumnComponent
								{col}
								canvasSelectedProcessId={ownsSelectedProcess ? canvasSelection.id : null}
							/>
						</div>
						{@render derivedTree(col.id, 1)}
					{/if}
				{/each}

				<!-- Drop zone at end of group -->
				<div
					class="dropzone"
					class:active={dropHint.section === group.id && dropHint.beforeId == null}
					ondragover={(e) => onDragOverSection(e, group.id, null)}
					ondrop={(e) => onDropSection(e, group.id, null)}
				></div>
			</details>
		</div>
	{/each}

	<!-- Free table-processes -->
	{#if (core.tableProcesses?.length ?? 0) > 0}
		<div class="clps-container">
			<details class="clps-item" bind:open={openSections['__tps__']}>
				<summary class="clps-title-container" onclick={(e) => toggleSection(e, '__tps__')}>
					<div class="clps-title">
						<p>Computed</p>
					</div>
					<div class="clps-title-button">
						<button class="icon" onclick={(e) => toggleSectionFromCaret(e, '__tps__')}>
							{#if openSections['__tps__']}
								<Icon name="caret-down" width={20} height={20} />
							{:else}
								<Icon name="caret-right" width={20} height={20} />
							{/if}
						</button>
					</div>
				</summary>

				{#each core.tableProcesses as p (p.id)}
					<div
						class="second-clps"
						class:canvas-selected={canvasSelection?.kind === 'tableprocess' &&
							canvasSelection.id === p.id}
						bind:this={rowRefs[`tableprocess_${p.id}`]}
						draggable="true"
						ondragstart={(e) => startDragTP(e, p.id)}
						ondragover={(e) => onDragOverSection(e, '__tps__', p.id)}
						ondrop={(e) => onDropSection(e, '__tps__', p.id)}
					>
						<TableProcess {p} />
					</div>
					{#each Object.values(p.args?.out ?? {}) as outColId}
						{@render derivedTree(outColId, 1)}
					{/each}
				{/each}
			</details>
		</div>
	{/if}

	<!-- Ungrouped columns -->
	{#if ungroupedColumns.length > 0}
		<div class="clps-container">
			<details class="clps-item" bind:open={openSections['__ungrouped__']}>
				<summary class="clps-title-container" onclick={(e) => toggleSection(e, '__ungrouped__')}>
					<div class="clps-title">
						<p>Ungrouped</p>
					</div>
					<div class="clps-title-button">
						<button class="icon" onclick={(e) => toggleSectionFromCaret(e, '__ungrouped__')}>
							{#if openSections['__ungrouped__']}
								<Icon name="caret-down" width={20} height={20} />
							{:else}
								<Icon name="caret-right" width={20} height={20} />
							{/if}
						</button>
					</div>
				</summary>

				{#each ungroupedColumns as col (col.id)}
					{@const colSelected = canvasSelection?.kind === 'data' && canvasSelection.id === col.id}
					{@const ownsSelectedProcess =
						canvasSelection?.kind === 'process' &&
						col.processes?.some((pr) => pr.id === canvasSelection.id)}
					<div
						class="second-clps"
						class:canvas-selected={colSelected || ownsSelectedProcess}
						bind:this={rowRefs[`data_${col.id}`]}
						draggable="true"
						ondragstart={(e) => startDragColumn(e, col.id, '__ungrouped__')}
						ondragover={(e) => onDragOverSection(e, '__ungrouped__', col.id)}
						ondrop={(e) => onDropSection(e, '__ungrouped__', col.id)}
					>
						<ColumnComponent
							{col}
							canvasSelectedProcessId={ownsSelectedProcess ? canvasSelection.id : null}
						/>
					</div>
					{@render derivedTree(col.id, 1)}
				{/each}

				<!-- Drop zone to remove a column from its group -->
				<div
					class="dropzone"
					class:active={dropHint.section === '__ungrouped__' && dropHint.beforeId == null}
					ondragover={(e) => onDragOverSection(e, '__ungrouped__', null)}
					ondrop={(e) => onDropSection(e, '__ungrouped__', null)}
				></div>
			</details>
		</div>
	{/if}

	<div class="div-block"></div>
</div>

<MakeNewColumn bind:show={showNewCol} bind:initialType={newColInitialType} />
<SwapColumns bind:showModal={showSwapColumns} />

<style>
	.heading {
		position: sticky;
		top: 0;
		width: 100%;
		height: 2rem;
		display: flex;
		flex-direction: row;
		justify-content: space-between;
		align-items: center;
		border-bottom: 1px solid var(--color-lightness-85);
		background-color: white;
		z-index: 999;
	}

	.heading p {
		margin-left: 0.75rem;
		font-weight: bold;
	}

	.heading button {
		margin-right: 0.65rem;
	}

	.display-list {
		width: 100%;
		margin-top: 0.25rem;
	}

	details {
		margin: 0.25rem 0.5rem 0.25rem 0.75rem;
		padding: 0;
	}

	summary {
		list-style: none;
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
		margin: 0;
		padding: 0;
	}

	summary p {
		margin: 0;
		padding: 0;
	}

	summary button {
		margin: 0;
		padding: 0;
	}

	/* Expand/collapse caret is always visible (and clickable) so sections can be
	   expanded directly, not only when their node is selected on the canvas. */
	summary .icon {
		opacity: 0.55;
		pointer-events: auto;
		transition: opacity 0.2s ease;
	}

	details:hover summary .icon {
		opacity: 1;
	}

	.clps-title-container {
		cursor: pointer;
	}

	.databuttons {
		display: flex;
	}

	.second-clps.canvas-selected {
		border-radius: 4px;
		box-shadow: inset 2px 0 0 var(--color-accent, #4d9fe3);
		background-color: color-mix(in srgb, var(--color-accent, #4d9fe3) 8%, transparent);
	}

	/* Derived (producer) columns nest under their source: indent by depth and show
	   a connector rail so the data flow is easy to follow. */
	.derived-col {
		margin-left: calc(var(--depth, 1) * 14px);
		border-left: 2px solid var(--color-lightness-85, #ddd);
		padding-left: 6px;
	}

	.dropzone {
		height: 6px;
		margin: 0;
		border-radius: 3px;
		transition: background-color 0.15s ease;
	}
	.dropzone.active {
		background-color: var(--color-accent, #4d9fe3);
	}

	.clps-container[draggable='true'] {
		cursor: grab;
	}
	.clps-container[draggable='true']:active {
		cursor: grabbing;
	}
</style>
