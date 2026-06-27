<script>
	// @ts-nocheck
	import { core, appConsts, appState, getProcessNodeGraph } from '$lib/core/core.svelte.js';
	import { getColumnById } from '$lib/core/Column.svelte';
	import { tick, untrack } from 'svelte';

	import Icon from '$lib/icons/Icon.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import NodeSourceItem from './NodeSourceItem.svelte';
	import MakeNewColumn from './modals/MakeNewColumn.svelte';
	import { openImportData } from '$lib/core/dataSourceActions.js';
	import SwapColumns from './modals/SwapColumns.svelte';
	import Editable from '../inputs/Editable.svelte';
	import { getNodeName } from '$lib/core/nodeNaming.js';
	import { getNodeMeta } from '$lib/core/nodeMeta.js';
	import { selectPlot } from '$lib/core/Plot.svelte';
	import SinglePlotAction from '../iconActions/SinglePlotAction.svelte';

	let showSwapColumns = $state(false);
	let showNewCol = $state(false);
	let newColInitialType = $state('');

	// ─── Search ────────────────────────────────────────────────────────────────
	// Filters Sources / Nodes / Plots by name. While a query is active, every
	// section is forced open (see isOpen) so matches are always visible.
	let query = $state('');
	const q = $derived(query.trim().toLowerCase());
	function matches(name) {
		return !q || (name ?? '').toString().toLowerCase().includes(q);
	}
	function isOpen(id) {
		return openSections[id] || !!q;
	}
	function groupVisibleColumns(group) {
		return (group.sourceColumnIds ?? [])
			.map((id) => getColumnById(id))
			.filter((c) => c && matches(c.name));
	}

	function openMakeNewColumn() {
		newColInitialType = '';
		showNewCol = true;
	}

	// Expand state — keyed by section id (group id, '__nodes__', '__ungrouped__',
	// '__plots__'). Nodes + Plots start open so they're visible without a click.
	let openSections = $state({ __data__: true, __nodes__: true, __plots__: true });

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
	// Source columns (grouped or not) all live in the "Data" section now.
	const selectedSectionId = $derived.by(() => {
		const sel = canvasSelection;
		if (!sel) return null;
		if (sel.kind === 'tableprocess' || sel.kind === 'process') return '__nodes__';
		if (sel.kind === 'data') return '__data__';
		return null;
	});

	// The group nested under "Data" that owns the selected column, so it can also
	// be expanded when the column is selected on the canvas.
	const selectedGroupId = $derived.by(() => {
		const sel = canvasSelection;
		if (!sel || sel.kind !== 'data') return null;
		for (const g of core.groups ?? []) {
			if ((g.sourceColumnIds ?? []).includes(sel.id)) return g.id;
		}
		return null;
	});

	// Scroll-into-view refs keyed by `${kind}_${id}`
	let rowRefs = $state({});

	$effect(() => {
		const sel = canvasSelection;
		const sid = selectedSectionId;
		const gid = selectedGroupId;
		if (!sel || !sid) return;
		untrack(() => {
			openSections[sid] = true;
			if (gid != null) openSections[gid] = true;
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

	// A producer column is the output of an operation node (dataflow model). These
	// render as a node's outputs in the "Nodes" section, never as standalone rows.
	function isProducerColumn(c) {
		return c?.producerNodeId != null && c.refId == null && c.data == null;
	}

	// Operation nodes (free processes + free table-processes) as their own panel
	// entries — each rendered with its inputs + outputs by NodeSourceItem. Nested
	// TPs are members of their parent and aren't listed separately.
	const nodeEntries = $derived.by(() => {
		const nodes = getProcessNodeGraph().nodes ?? [];
		return nodes.filter(
			(n) =>
				n.type === 'process' ||
				(n.type === 'tableprocess' && typeof n.id === 'string' && !n.id.startsWith('tableprocess_nested_'))
		);
	});

	// Source/generator nodes (Simulate Data, Random, Sequence Column, Enter Data)
	// are conceptually data, not processing steps — they belong in the "Data"
	// section, not "Nodes". Classify via the central node-meta family.
	function isSourceNode(node) {
		return getNodeMeta(node.tpName ?? node.processName).family === 'Sources';
	}
	const sourceNodeEntries = $derived(nodeEntries.filter(isSourceNode));
	const operationNodeEntries = $derived(nodeEntries.filter((n) => !isSourceNode(n)));

	// Source columns only: not in a group, not a TP output, not a producer column.
	// (Outputs of nodes live inside their node entry now.)
	const ungroupedColumns = $derived.by(() => {
		return (core.data ?? []).filter(
			(c) => !groupedColumnIds.has(c.id) && !tpOutputColIds.has(c.id) && !isProducerColumn(c)
		);
	});

	// Search-filtered views of each section.
	const filteredUngrouped = $derived(ungroupedColumns.filter((c) => matches(c.name)));
	function nodeMatches(node) {
		if (!q) return true;
		if (matches(getNodeName(node))) return true;
		for (const o of node.outputColumns ?? []) {
			const c = getColumnById(o.colId);
			if (c && matches(c.name)) return true;
		}
		return false;
	}
	// Source nodes render inside "Data"; operation nodes inside "Nodes".
	const filteredSourceNodes = $derived(sourceNodeEntries.filter(nodeMatches));
	const filteredNodeEntries = $derived(operationNodeEntries.filter(nodeMatches));
	// The "Data" section (groups + ungrouped source columns + source nodes) has
	// something to show.
	const dataHasContent = $derived(
		filteredUngrouped.length > 0 ||
			filteredSourceNodes.length > 0 ||
			(core.groups ?? []).some((g) => groupVisibleColumns(g).length > 0)
	);

	// ─── Plots section ───────────────────────────────────────────────────────────
	// The plot list (formerly the standalone Worksheet Layers panel) lives here so
	// Sources, Nodes and Plots share one panel + one search box. Display order is
	// reversed so the topmost row is the plot drawn last (highest z-index); drag to
	// reorder rewrites core.plots, which is the worksheet stacking order.
	const filteredPlots = $derived((core.plots ?? []).filter((p) => matches(p.name)));
	const displayPlots = $derived(q ? filteredPlots : (core.plots ?? []).toReversed());

	let plotDraggedIndex = $state(null);
	let plotDraggedViewIndex = $state(null);
	let plotDragOverIdx = $state(null);
	function plotViewToModel(i) {
		return core.plots.length - 1 - i;
	}
	function plotDragStart(e, i) {
		plotDraggedViewIndex = i;
		plotDraggedIndex = plotViewToModel(i);
		e.dataTransfer.effectAllowed = 'move';
	}
	function plotDragOver(e, i) {
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
		plotDragOverIdx = i;
	}
	function plotDrop(i) {
		if (plotDraggedIndex === null) return;
		const target = plotViewToModel(i);
		if (plotDraggedIndex !== target) {
			const updated = [...core.plots];
			const [moved] = updated.splice(plotDraggedIndex, 1);
			updated.splice(target, 0, moved);
			core.plots = updated;
		}
		plotDragReset();
	}
	function plotDragReset() {
		plotDraggedIndex = null;
		plotDraggedViewIndex = null;
		plotDragOverIdx = null;
	}

	function changePlotVisibility(id) {
		if (appState.invisiblePlotIds.includes(id)) {
			appState.invisiblePlotIds = appState.invisiblePlotIds.filter((p) => p !== id);
		} else {
			appState.invisiblePlotIds.push(id);
		}
	}

	let showSinglePlotDropdown = $state(false);
	let selectedPlotId = $state(null);
	let plotDropdownTop = $state(0);
	let plotDropdownLeft = $state(0);
	function openSinglePlotDropdown(e, id) {
		selectedPlotId = id;
		const r = e.currentTarget.getBoundingClientRect();
		plotDropdownTop = r.top + window.scrollY;
		plotDropdownLeft = r.right + window.scrollX + 6;
		showSinglePlotDropdown = true;
	}

	// Select a plot from the panel: mark it selected (workspace view) and find it on
	// the canvas. The focus request also resets the canvas selection to just this
	// plot, so any other selected nodes are deselected. View is left as-is so it
	// works in either the workflow or workspace canvas.
	function plotSelectAndFind(e, plot) {
		selectPlot(e ?? {}, plot.id);
		// Mirror the resulting plot selection into the canvas selection so the
		// control panel counts exactly the selected plots (it unions plot.selected
		// with canvasMultiSelectedNodeIds — a stale canvas id otherwise shows e.g.
		// "2 plots selected" when only one is chosen here).
		const selIds = (core.plots ?? []).filter((p) => p.selected).map((p) => `plot_${p.id}`);
		appState.canvasMultiSelectedNodeIds = selIds;
		appState.canvasMultiSelectedCount = selIds.length;
		appState.canvasSelectedNodeId = `plot_${plot.id}`;
		appState.focusNodeRequest = {
			id: `plot_${plot.id}`,
			n: (appState.focusNodeRequest?.n ?? 0) + 1
		};
	}

	// Find a group's node on the workflow canvas (select + pan + open its panel).
	function groupFindSelect(group) {
		appState.canvasSelectedNodeId = group.id;
		appState.focusNodeRequest = { id: group.id, n: (appState.focusNodeRequest?.n ?? 0) + 1 };
		appState.view = 'canvas';
		appState.showControlPanel = true;
	}

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

<div class="search-row">
	<Icon name="search" width={14} height={14} className="search-icon" />
	<input
		class="search-input"
		type="search"
		placeholder="Search sources, nodes, plots…"
		bind:value={query}
		aria-label="Search sources, nodes and plots"
	/>
	{#if q}
		<button class="icon search-clear" title="Clear search" onclick={() => (query = '')}>
			<Icon name="close" width={14} height={14} />
		</button>
	{/if}
</div>

<div class="display-list">
	<!-- Data: groups + ungrouped source columns. Swap / import sit on the section
	     header, revealed on hover. -->
	{#if !q || dataHasContent}
		<div class="clps-container section">
			<details class="clps-item" open={isOpen('__data__')}>
				<summary class="clps-title-container" onclick={(e) => toggleSection(e, '__data__')}>
					<div class="clps-title"><p class="section-label">Data</p></div>
					<div class="clps-title-button">
						<button
							class="icon section-action"
							title="Swap columns"
							onclick={(e) => {
								e.stopPropagation();
								showSwapColumns = true;
							}}
						>
							<Icon name="swap" width={15} height={15} />
						</button>
						<button
							class="icon section-action"
							title="Import data"
							onclick={(e) => {
								e.stopPropagation();
								openImportData();
							}}
						>
							<Icon name="add" width={15} height={15} />
						</button>
						<button class="icon" onclick={(e) => toggleSectionFromCaret(e, '__data__')}>
							{#if isOpen('__data__')}
								<Icon name="caret-down" width={20} height={20} />
							{:else}
								<Icon name="caret-right" width={20} height={20} />
							{/if}
						</button>
					</div>
				</summary>

				<!-- Groups (nested under Data) -->
				{#each core.groups as group (group.id)}
		{@const visCols = groupVisibleColumns(group)}
		{#if !q || visCols.length > 0}
			<div
				class="clps-container"
				class:canvas-selected={appState.canvasSelectedNodeId === group.id}
				draggable="true"
				ondragstart={(e) => startDragGroup(e, group.id)}
				ondragover={(e) => onDragOverSection(e, '__group_order__', group.id)}
				ondrop={(e) => onDropSection(e, '__group_order__', group.id)}
			>
				<details class="clps-item" open={isOpen(group.id)}>
					<summary class="clps-title-container" onclick={(e) => toggleSection(e, group.id)}>
						<div class="clps-title">
							<p><Editable bind:value={group.name} /></p>
						</div>
						<div class="clps-title-button">
							<button
								class="icon group-find-btn"
								title="Find on canvas"
								onclick={(e) => {
									e.stopPropagation();
									groupFindSelect(group);
								}}
							>
								<Icon name="process" width={15} height={15} className="menu-icon" />
							</button>
							<button class="icon" onclick={(e) => toggleSectionFromCaret(e, group.id)}>
								{#if isOpen(group.id)}
									<Icon name="caret-down" width={20} height={20} />
								{:else}
									<Icon name="caret-right" width={20} height={20} />
								{/if}
							</button>
						</div>
					</summary>

					{#each visCols as col (col.id)}
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
		{/if}
	{/each}

				<!-- Ungrouped source columns (flat, after the groups) -->
				{#each filteredUngrouped as col (col.id)}
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
				{/each}

				<!-- Source/generator nodes (Simulate Data, Random, Sequence, Enter Data):
				     conceptually data, so they live under Data with their output columns. -->
				{#each filteredSourceNodes as node (node.id)}
					<div
						class="second-clps"
						class:canvas-selected={appState.canvasSelectedNodeId === node.id}
						bind:this={rowRefs[node.id]}
					>
						<NodeSourceItem {node} />
					</div>
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

	<div class="section-sep"></div>

	<!-- Nodes: every operation (process + table-process) as its own entry, with
	     read-only input(s) and its output columns. -->
	{#if filteredNodeEntries.length > 0}
		<div class="clps-container section">
			<details class="clps-item" open={isOpen('__nodes__')}>
				<summary class="clps-title-container" onclick={(e) => toggleSection(e, '__nodes__')}>
					<div class="clps-title">
						<p>Nodes</p>
					</div>
					<div class="clps-title-button">
						<button class="icon" onclick={(e) => toggleSectionFromCaret(e, '__nodes__')}>
							{#if isOpen('__nodes__')}
								<Icon name="caret-down" width={20} height={20} />
							{:else}
								<Icon name="caret-right" width={20} height={20} />
							{/if}
						</button>
					</div>
				</summary>

				{#each filteredNodeEntries as node (node.id)}
					<div
						class="second-clps"
						class:canvas-selected={appState.canvasSelectedNodeId === node.id}
						bind:this={rowRefs[node.id]}
					>
						<NodeSourceItem {node} />
					</div>
				{/each}
			</details>
		</div>
	{/if}

	<div class="section-sep"></div>

	<!-- Plots: the worksheet stacking order. Topmost row = highest z-index; drag to
	     reorder (disabled while searching). -->
	{#if displayPlots.length > 0}
		<div class="clps-container section">
			<details class="clps-item" open={isOpen('__plots__')}>
				<summary class="clps-title-container" onclick={(e) => toggleSection(e, '__plots__')}>
					<div class="clps-title">
						<p>Plots</p>
					</div>
					<div class="clps-title-button">
						<button class="icon" onclick={(e) => toggleSectionFromCaret(e, '__plots__')}>
							{#if isOpen('__plots__')}
								<Icon name="caret-down" width={20} height={20} />
							{:else}
								<Icon name="caret-right" width={20} height={20} />
							{/if}
						</button>
					</div>
				</summary>

				{#each displayPlots as plot, i (plot.id)}
					<div
						class="second-clps plot-row"
						class:plot-drag-over={!q && plotDragOverIdx === i && plotDraggedViewIndex !== i}
						class:canvas-selected={plot.selected}
						draggable={!q}
						ondragstart={(e) => plotDragStart(e, i)}
						ondragover={(e) => plotDragOver(e, i)}
						ondrop={() => plotDrop(i)}
						ondragend={plotDragReset}
					>
						<div
							class="plot-row-inner"
							role="button"
							tabindex="0"
							onclick={(e) => plotSelectAndFind(e, plot)}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									plotSelectAndFind(e, plot);
								}
							}}
						>
							{#if !q}
								<div class="plot-drag-handle" title="Drag to reorder (changes stacking order)">
									⠇
								</div>
							{/if}
							<button
								class="icon"
								title="Toggle visibility"
								onclick={(e) => {
									e.stopPropagation();
									changePlotVisibility(plot.id);
								}}
							>
								{#if appState.invisiblePlotIds.includes(plot.id)}
									<Icon name="eye-slash" width={16} height={16} />
								{:else}
									<Icon name="eye" width={16} height={16} className="visible" />
								{/if}
							</button>
							<p class="plot-name"><Editable bind:value={plot.name} /></p>
							<button
								class="icon plot-find-btn"
								title="Find on canvas"
								onclick={(e) => {
									e.stopPropagation();
									plotSelectAndFind({}, plot);
								}}
							>
								<Icon name="process" width={15} height={15} className="menu-icon" />
							</button>
							<button
								class="icon"
								title="Plot actions"
								onclick={(e) => {
									e.stopPropagation();
									openSinglePlotDropdown(e, plot.id);
								}}
							>
								<Icon name="menu-horizontal-dots" width={20} height={20} className="menu-icon" />
							</button>
						</div>
					</div>
				{/each}
			</details>
		</div>
	{/if}

	<div class="div-block"></div>
</div>

<MakeNewColumn bind:show={showNewCol} bind:initialType={newColInitialType} />
<SwapColumns bind:showModal={showSwapColumns} />
<SinglePlotAction
	bind:showDropdown={showSinglePlotDropdown}
	dropdownTop={plotDropdownTop}
	dropdownLeft={plotDropdownLeft}
	plotId={selectedPlotId}
/>

<style>
	/* Section dividers (between Data / Nodes / Plots), mirroring the nav .rail-sep. */
	.section-sep {
		height: 1px;
		margin: var(--space-3) var(--space-4);
		background: var(--divider-soft);
	}

	.section-label {
		font-weight: 600;
		font-size: var(--font-md);
	}

	/* Swap / import buttons on the Data section header — revealed on hover. Extra
	   specificity so they beat the section header's resting icon opacity. */
	.section summary .section-action {
		opacity: 0;
		transition: opacity 0.12s ease;
	}
	.section:hover summary .section-action,
	.section summary .section-action:focus-visible {
		opacity: 1;
	}

	.search-row {
		position: sticky;
		top: 0;
		z-index: 998;
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
		box-sizing: border-box;
		padding: var(--space-3) var(--space-4);
		background-color: var(--surface-card);
		border-bottom: 1px solid var(--divider-soft);
	}
	.search-row :global(.search-icon) {
		color: var(--color-text-muted, #666);
		flex-shrink: 0;
	}
	.search-input {
		flex: 1;
		min-width: 0;
		border: none;
		outline: none;
		background: transparent;
		font: inherit;
		font-size: var(--font-md);
		padding: 2px 0;
	}
	.search-input::-webkit-search-cancel-button {
		display: none;
	}
	.search-clear {
		flex-shrink: 0;
		opacity: 0.6;
	}
	.search-clear:hover {
		opacity: 1;
	}

	.display-list {
		width: 100%;
		margin-top: var(--space-2);
	}

	/* Plots section rows */
	.plot-row-inner {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: var(--space-1);
		width: 100%;
		cursor: pointer;
	}
	.plot-name {
		flex: 1;
		margin: 0;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.plot-drag-handle {
		cursor: grab;
		user-select: none;
		font-size: var(--font-sm);
		line-height: 1;
		color: var(--color-lightness-65, #aaa);
		padding: 0 var(--space-1);
		opacity: 0;
		transition: opacity 0.15s ease;
	}
	.plot-drag-handle:active {
		cursor: grabbing;
	}
	.plot-row:hover .plot-drag-handle {
		opacity: 1;
	}
	.plot-row[draggable='true'] {
		cursor: grab;
	}
	.plot-drag-over {
		border-top: 2px solid var(--color-lightness-35, #555);
	}

	/* Find-on-canvas buttons reveal on hover (groups + plots), matching nodes. The
	   group button needs extra specificity to beat `summary .icon`'s rest opacity. */
	.clps-container summary .group-find-btn,
	.plot-row .plot-find-btn {
		opacity: 0;
		transition: opacity 0.12s ease;
		flex-shrink: 0;
	}
	.clps-container:hover summary .group-find-btn,
	.clps-container summary .group-find-btn:focus-visible,
	.plot-row:hover .plot-find-btn,
	.plot-row .plot-find-btn:focus-visible {
		opacity: 1;
	}

	details {
		margin: var(--space-2) var(--space-4) var(--space-2) var(--space-5);
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


	.second-clps.canvas-selected,
	.clps-container.canvas-selected {
		border-radius: var(--radius-sm);
		box-shadow: inset 2px 0 0 var(--color-accent);
		background-color: color-mix(in srgb, var(--color-accent) 8%, transparent);
	}

	.dropzone {
		height: 6px;
		margin: 0;
		border-radius: 3px;
		transition: background-color 0.15s ease;
	}
	.dropzone.active {
		background-color: var(--color-accent);
	}

	.clps-container[draggable='true'] {
		cursor: grab;
	}
	.clps-container[draggable='true']:active {
		cursor: grabbing;
	}
</style>
