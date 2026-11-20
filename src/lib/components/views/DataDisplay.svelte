<script>
	import { facetUnits } from '$lib/core/facetPanels.svelte.js';
	// @ts-nocheck
	import { core, appState, getProcessNodeGraph } from '$lib/core/core.svelte.js';
	import { getColumnById } from '$lib/core/Column.svelte';
	import { columnNamer } from '$lib/core/columnLabels.js';
	import { tick, untrack } from 'svelte';

	import Icon from '$lib/icons/Icon.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import NodeSourceItem from './NodeSourceItem.svelte';
	import { openImportData } from '$lib/core/dataSourceActions.js';
	import SwapColumns from './modals/SwapColumns.svelte';
	import Editable from '../inputs/Editable.svelte';
	import { getNodeName, commitNodeRename } from '$lib/core/nodeNaming.js';
	import { getNodeMeta } from '$lib/core/nodeMeta.js';
	import { selectPlot } from '$lib/core/Plot.svelte';
	import SinglePlotAction from '../iconActions/SinglePlotAction.svelte';
	import { recordGraphMutation } from '$lib/core/operations.js';
	import { announce } from '$lib/utils/announce.js';
	import { rovingRows } from '$lib/utils/rovingRows.js';

	let showSwapColumns = $state(false);

	// ─── Search ────────────────────────────────────────────────────────────────
	// Filters Sources / Nodes / Plots by name. While a query is active, every
	// section is forced open (see isOpen) so matches are always visible.
	let query = $state('');
	const q = $derived(query.trim().toLowerCase());
	function matches(name) {
		return !q || (name ?? '').toString().toLowerCase().includes(q);
	}
	// A column matches on the name it SHOWS (a node output's label, e.g. "Acrophase (h)") as
	// well as its stored name (UI-4), so searching either finds it.
	const namer = $derived(columnNamer());
	function columnMatches(c) {
		return matches(c.name) || matches(namer(c));
	}
	function isOpen(id) {
		return openSections[id] || !!q;
	}
	function groupVisibleColumns(group) {
		return (group.sourceColumnIds ?? [])
			.map((id) => getColumnById(id))
			.filter((c) => c && columnMatches(c));
	}

	// Expand state — keyed by section id (group id, '__nodes__', '__ungrouped__',
	// '__plots__'). Nodes + Plots start open so they're visible without a click.
	let openSections = $state({ __data__: true, __nodes__: true, __plots__: true });

	// Toggle a section open/closed from a click on its header row (a mouse convenience; the
	// caret button is the disclosure control for the keyboard and assistive tech). The header
	// is a plain row, not a <summary>: a summary is itself a control, and holding the name
	// editor and the action buttons inside one nested controls in a control (axe
	// nested-interactive). Skip clicks on the inline name editor or buttons so renaming and
	// the caret keep their own behaviour.
	function toggleSection(e, id) {
		if (e.target?.closest?.('.inline-edit-span, .inline-edit-input, input, textarea, button')) {
			return;
		}
		openSections[id] = !openSections[id];
	}

	// Caret-button toggle: stopPropagation so the header row's handler doesn't also fire.
	function toggleSectionFromCaret(e, id) {
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

	// Which section owns the selected item? Used to auto-open it.
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
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built fresh inside this $derived and never mutated afterwards; the derived recomputing is what drives the UI
		const s = new Set();
		for (const tp of core.tableProcesses ?? []) {
			for (const cid of Object.values(tp.args?.out ?? {})) {
				if (typeof cid === 'number' && cid >= 0) s.add(cid);
			}
		}
		return s;
	});

	const groupedColumnIds = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built fresh inside this $derived and never mutated afterwards; the derived recomputing is what drives the UI
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
				(n.type === 'tableprocess' &&
					typeof n.id === 'string' &&
					!n.id.startsWith('tableprocess_nested_'))
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
	const filteredUngrouped = $derived(ungroupedColumns.filter(columnMatches));
	function nodeMatches(node) {
		if (!q) return true;
		if (matches(getNodeName(node))) return true;
		for (const o of node.outputColumns ?? []) {
			const c = getColumnById(o.colId);
			if (c && columnMatches(c)) return true;
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
	const displayPlots = $derived(q ? filteredPlots : (core.plots ?? []).slice().reverse());

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
	// Move the plot at model index `from` to `to` (core.plots is the stacking order). One undo
	// step: graphPatch records a list's order (a drag or Alt+Arrow alike).
	function movePlot(from, to) {
		if (from === to) return;
		recordGraphMutation(() => {
			const updated = [...core.plots];
			const [moved] = updated.splice(from, 1);
			updated.splice(to, 0, moved);
			core.plots = updated;
		});
	}
	function plotDrop(i) {
		if (plotDraggedIndex === null) return;
		movePlot(plotDraggedIndex, plotViewToModel(i));
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
		// One undo step per drop (graphPatch captures group membership and list order).
		recordGraphMutation(() => {
			if (payload.kind === 'group') {
				reorderGroup(payload.rest[0], beforeId);
			} else if (payload.kind === 'col') {
				const [colIdStr] = payload.rest;
				moveColumnTo(Number(colIdStr), section, beforeId == null ? null : Number(beforeId));
			} else if (payload.kind === 'tp') {
				reorderTP(Number(payload.rest[0]), beforeId == null ? null : Number(beforeId));
			}
		});
	}

	function onDragOverSection(e, section, beforeId) {
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
		dropHint = { section, beforeId };
	}

	// ─── Keyboard reorder ──────────────────────────────────────────────────────
	// The Data list (groups and their columns, then the ungrouped columns) and the Plots list
	// are each ONE Tab stop: a treegrid whose rows take a roving tabindex (utils/rovingRows.js:
	// Up/Down, Home/End, Right/Left into and out of a group, Tab to the focused row's own
	// controls). One treegrid for groups AND columns, not one stop per group, because a column
	// moves between groups with Alt+Arrow: it is one ordering, so one list.
	//
	// Alt+ArrowUp / Alt+ArrowDown on a focused group header, column row or plot row moves it one
	// place, through the same helpers a drop calls (one undo step each, the same result as the
	// drag), keeps focus on the moved row and says where it went in the app's live region.
	// Rows say so through aria-keyshortcuts and the hidden hints below.
	const DATA_HINT_ID = 'data-panel-reorder-hint';
	const PLOTS_HINT_ID = 'data-panel-plots-hint';
	const dataRows = rovingRows({
		onExpand: (row, open) => {
			const id = row.dataset.groupId;
			if (id != null) openSections[id] = open;
		}
	});
	const plotRows = rovingRows();
	const isReorderKey = (e) =>
		e.altKey &&
		!e.ctrlKey &&
		!e.metaKey &&
		!e.shiftKey &&
		(e.key === 'ArrowUp' || e.key === 'ArrowDown');
	// Typing in a field (the inline name editor) keeps its own keys.
	const isEditing = (e) => !!e.target?.closest?.('input, textarea, [contenteditable="true"]');

	// The moved row's DOM node is re-inserted (or, between groups, re-created), which drops
	// focus; put it back once the list has re-rendered.
	async function refocusRow(key) {
		await tick();
		document.querySelector(`.display-list [data-reorder-key="${key}"]`)?.focus();
	}

	function onRowKeydown(e, move) {
		if (!isReorderKey(e) || isEditing(e)) return false;
		e.preventDefault();
		e.stopPropagation();
		move(e.key === 'ArrowUp' ? -1 : +1);
		return true;
	}

	function moveGroupBy(group, delta) {
		const groups = core.groups ?? [];
		const from = groups.findIndex((g) => g.id === group.id);
		const to = from + delta;
		if (from < 0) return;
		if (to < 0 || to >= groups.length) {
			announce(`${group.name} is already ${delta < 0 ? 'first' : 'last'}.`);
			return;
		}
		const beforeId = delta < 0 ? groups[to].id : (groups[to + 1]?.id ?? null);
		recordGraphMutation(() => reorderGroup(group.id, beforeId));
		announce(`Moved ${group.name} to position ${to + 1} of ${groups.length}.`);
		refocusRow(`group-${group.id}`);
	}

	// A column moves within its group; past either end it moves into the neighbouring group
	// (as dropping it there would), and down out of the last group it leaves the groups (the
	// "remove from group" drop zone). An ungrouped column moves up into the end of the last
	// group. Where the ungrouped columns sit among themselves is their import order, which no
	// drop can change, so that is where they stop.
	function moveColumnBy(col, sectionId, delta) {
		const name = namer(col);
		const groups = core.groups ?? [];
		let target = null; // a group, or '__ungrouped__'
		let beforeId = null;
		if (sectionId === '__ungrouped__') {
			if (delta > 0 || groups.length === 0) {
				announce(`${name} is already ${delta > 0 ? 'last' : 'first'}.`);
				return;
			}
			target = groups[groups.length - 1];
		} else {
			const gi = groups.findIndex((g) => g.id === sectionId);
			if (gi < 0) return;
			const list = groups[gi].sourceColumnIds ?? [];
			const i = list.indexOf(col.id);
			const j = i + delta;
			if (j >= 0 && j < list.length) {
				target = groups[gi];
				beforeId = delta < 0 ? list[j] : (list[j + 1] ?? null);
			} else if (delta < 0) {
				if (gi === 0) {
					announce(`${name} is already first.`);
					return;
				}
				target = groups[gi - 1];
			} else if (gi < groups.length - 1) {
				target = groups[gi + 1];
				beforeId = target.sourceColumnIds?.[0] ?? null;
			} else {
				target = '__ungrouped__';
			}
		}
		const toSection = target === '__ungrouped__' ? target : target.id;
		recordGraphMutation(() => moveColumnTo(col.id, toSection, beforeId));
		if (target === '__ungrouped__') {
			announce(`Moved ${name} out of ${groups[groups.length - 1].name}, to the ungrouped columns.`);
		} else {
			openSections[target.id] = true;
			const list = target.sourceColumnIds ?? [];
			announce(
				`Moved ${name} to position ${list.indexOf(col.id) + 1} of ${list.length} in ${target.name}.`
			);
		}
		refocusRow(`col-${col.id}`);
	}

	// Plots are listed topmost first (the reverse of core.plots), so up is a higher index.
	function movePlotBy(plot, delta) {
		const n = core.plots.length;
		const from = core.plots.indexOf(plot);
		const to = from - delta;
		if (from < 0) return;
		if (q) {
			announce('Clear the search to reorder plots.');
			return;
		}
		if (to < 0 || to >= n) {
			announce(`${plot.name} is already ${delta < 0 ? 'at the top' : 'at the bottom'}.`);
			return;
		}
		movePlot(from, to);
		announce(`Moved ${plot.name} to position ${n - to} of ${n}.`);
		refocusRow(`plot-${plot.id}`);
	}

	// Enter or Space on a focused row header (not on a control inside it).
	const isActivate = (e) => e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ');
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

<!-- One source-column row, in a group or ungrouped: a row of the Data treegrid (level 2 in a
     group, 1 ungrouped). Dragging it moves it; so does Alt+Up/Down while it has focus. Its
     controls sit in one gridcell, reached by Tab from the row. -->
{#snippet columnRow(col, sectionId, colSelected, ownsSelectedProcess)}
	<div
		class="second-clps reorder-row"
		class:canvas-selected={colSelected || ownsSelectedProcess}
		bind:this={rowRefs[`data_${col.id}`]}
		draggable="true"
		role="row"
		tabindex="-1"
		aria-level={sectionId === '__ungrouped__' ? 1 : 2}
		aria-label={`${namer(col)} column`}
		aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
		aria-describedby={DATA_HINT_ID}
		data-roving-row
		data-reorder-key={`col-${col.id}`}
		ondragstart={(e) => startDragColumn(e, col.id, sectionId)}
		ondragover={(e) => onDragOverSection(e, sectionId, col.id)}
		ondrop={(e) => onDropSection(e, sectionId, col.id)}
		onkeydown={(e) => onRowKeydown(e, (d) => moveColumnBy(col, sectionId, d))}
	>
		<div role="gridcell">
			<ColumnComponent
				{col}
				canvasSelectedProcessId={ownsSelectedProcess ? canvasSelection.id : null}
			/>
		</div>
	</div>
{/snippet}

<div class="display-list">
	<!-- Read by the reorderable rows (aria-describedby). Visually hidden. -->
	<p id={DATA_HINT_ID} class="sr-only">
		Up and Down go through the list, Right and Left open and close a group, Tab reaches the row's
		buttons. Alt+Up or Alt+Down moves it.
	</p>
	<p id={PLOTS_HINT_ID} class="sr-only">
		Up and Down go through the plots, Enter selects one, Tab reaches its buttons. Alt+Up or Alt+Down
		moves it.
	</p>

	<!-- Each section and group is a disclosure: a header row (a plain row, so the name editor and
	     buttons in it are not controls nested in a control) with the caret button as the
	     disclosure control, and a body that is hidden while closed. -->
	<!-- Data: groups + ungrouped source columns. Swap sits on the section header, revealed on
	     hover. Importing is not here (removed 2026-11-21): the start screen, the canvas + menu,
	     the canvas's add-data prompt, dropping a file and this list's empty-state link do it. -->
	{#if !q || dataHasContent}
		<div class="clps-container section">
			<div class="clps-item disclosure">
				<div
					class="clps-title-container disclosure-head"
					role="presentation"
					onclick={(e) => toggleSection(e, '__data__')}
				>
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
							class="icon disclosure-caret"
							type="button"
							aria-label="Show data"
							aria-expanded={isOpen('__data__')}
							aria-controls="data-panel-section-data"
							onclick={(e) => toggleSectionFromCaret(e, '__data__')}
						>
							{#if isOpen('__data__')}
								<Icon name="caret-down" width={20} height={20} />
							{:else}
								<Icon name="caret-right" width={20} height={20} />
							{/if}
						</button>
					</div>
				</div>

				<div class="disclosure-body" id="data-panel-section-data" hidden={!isOpen('__data__')}>
					<!-- Groups (nested under Data) and the ungrouped columns: one treegrid, one Tab
					     stop (rovingRows). -->
					<div class="data-tree" role="treegrid" aria-label="Data columns" {@attach dataRows}>
						{#each core.groups as group (group.id)}
							{@const visCols = groupVisibleColumns(group)}
							{#if !q || visCols.length > 0}
								<div
									class="clps-container"
									class:canvas-selected={appState.canvasSelectedNodeId === group.id}
									draggable="true"
									role="presentation"
									ondragstart={(e) => startDragGroup(e, group.id)}
									ondragover={(e) => onDragOverSection(e, '__group_order__', group.id)}
									ondrop={(e) => onDropSection(e, '__group_order__', group.id)}
								>
									<div class="clps-item disclosure">
										<!-- The group's header is a parent row of the Data treegrid (its name
									     editor and buttons are in its two gridcells): Alt+Arrow moves the
									     group; Enter or Space opens or closes it, as the summary it replaces
									     did, and so do Right and Left (rovingRows). -->
										<div
											class="clps-title-container disclosure-head reorder-row"
											role="row"
											tabindex="-1"
											aria-level="1"
											aria-expanded={isOpen(group.id)}
											aria-label={`${group.name} group`}
											aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
											aria-describedby={DATA_HINT_ID}
											data-roving-row
											data-group-id={group.id}
											data-reorder-key={`group-${group.id}`}
											onclick={(e) => toggleSection(e, group.id)}
											onkeydown={(e) => {
												if (onRowKeydown(e, (d) => moveGroupBy(group, d))) return;
												if (isActivate(e)) {
													e.preventDefault();
													openSections[group.id] = !openSections[group.id];
												}
											}}
										>
											<div class="clps-title" role="gridcell">
												<p>
													<Editable
														value={group.name}
														onCommit={(v) => commitNodeRename('group', group, v)}
													/>
												</p>
											</div>
											<div class="clps-title-button" role="gridcell">
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
												<button
													class="icon disclosure-caret"
													type="button"
													aria-label={`Show ${group.name}`}
													aria-expanded={isOpen(group.id)}
													aria-controls={`data-panel-group-${group.id}`}
													onclick={(e) => toggleSectionFromCaret(e, group.id)}
												>
													{#if isOpen(group.id)}
														<Icon name="caret-down" width={20} height={20} />
													{:else}
														<Icon name="caret-right" width={20} height={20} />
													{/if}
												</button>
											</div>
										</div>

										<div
											class="disclosure-body"
											id={`data-panel-group-${group.id}`}
											hidden={!isOpen(group.id)}
										>
											{#each visCols as col (col.id)}
												{@const colSelected =
													canvasSelection?.kind === 'data' && canvasSelection.id === col.id}
												{@const ownsSelectedProcess =
													canvasSelection?.kind === 'process' &&
													col.processes?.some((pr) => pr.id === canvasSelection.id)}
												{@render columnRow(col, group.id, colSelected, ownsSelectedProcess)}
											{/each}

											<!-- Drop zone at end of group -->
											<div
												class="dropzone"
												class:active={dropHint.section === group.id && dropHint.beforeId == null}
												role="presentation"
												ondragover={(e) => onDragOverSection(e, group.id, null)}
												ondrop={(e) => onDropSection(e, group.id, null)}
											></div>
										</div>
									</div>
								</div>
							{/if}
						{/each}

						<!-- Ungrouped source columns (flat, after the groups) -->
						{#each filteredUngrouped as col (col.id)}
							{@const colSelected =
								canvasSelection?.kind === 'data' && canvasSelection.id === col.id}
							{@const ownsSelectedProcess =
								canvasSelection?.kind === 'process' &&
								col.processes?.some((pr) => pr.id === canvasSelection.id)}
							{@render columnRow(col, '__ungrouped__', colSelected, ownsSelectedProcess)}
						{/each}
					</div>

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

					{#if !q && !dataHasContent}
						<!-- Without this the section is a bare heading: its import button only shows on
						     hover, so an empty session gave no hint of where data comes from (UI-9). -->
						<p class="data-empty">
							No data yet. <button
								type="button"
								class="data-empty-link"
								onclick={() => openImportData()}>Import a file</button
							>, or drop one on the canvas.
						</p>
					{/if}

					<!-- Drop zone to remove a column from its group -->
					<div
						class="dropzone"
						class:active={dropHint.section === '__ungrouped__' && dropHint.beforeId == null}
						role="presentation"
						ondragover={(e) => onDragOverSection(e, '__ungrouped__', null)}
						ondrop={(e) => onDropSection(e, '__ungrouped__', null)}
					></div>
				</div>
			</div>
		</div>
	{/if}

	<div class="section-sep"></div>

	<!-- Nodes: every operation (process + table-process) as its own entry, with
	     read-only input(s) and its output columns. -->
	{#if filteredNodeEntries.length > 0}
		<div class="clps-container section">
			<div class="clps-item disclosure">
				<div
					class="clps-title-container disclosure-head"
					role="presentation"
					onclick={(e) => toggleSection(e, '__nodes__')}
				>
					<div class="clps-title">
						<p>Nodes</p>
					</div>
					<div class="clps-title-button">
						<button
							class="icon disclosure-caret"
							type="button"
							aria-label="Show nodes"
							aria-expanded={isOpen('__nodes__')}
							aria-controls="data-panel-section-nodes"
							onclick={(e) => toggleSectionFromCaret(e, '__nodes__')}
						>
							{#if isOpen('__nodes__')}
								<Icon name="caret-down" width={20} height={20} />
							{:else}
								<Icon name="caret-right" width={20} height={20} />
							{/if}
						</button>
					</div>
				</div>

				<div class="disclosure-body" id="data-panel-section-nodes" hidden={!isOpen('__nodes__')}>
					{#each filteredNodeEntries as node (node.id)}
						<div
							class="second-clps"
							class:canvas-selected={appState.canvasSelectedNodeId === node.id}
							bind:this={rowRefs[node.id]}
						>
							<NodeSourceItem {node} />
						</div>
					{/each}
				</div>
			</div>
		</div>
	{/if}

	<div class="section-sep"></div>

	<!-- Plots: the worksheet stacking order. Topmost row = highest z-index; drag to
	     reorder (disabled while searching), or Alt+Up/Down on a focused row. -->
	{#if displayPlots.length > 0}
		<div class="clps-container section">
			<div class="clps-item disclosure">
				<div
					class="clps-title-container disclosure-head"
					role="presentation"
					onclick={(e) => toggleSection(e, '__plots__')}
				>
					<div class="clps-title">
						<p>Plots</p>
					</div>
					<div class="clps-title-button">
						<button
							class="icon disclosure-caret"
							type="button"
							aria-label="Show plots"
							aria-expanded={isOpen('__plots__')}
							aria-controls="data-panel-section-plots"
							onclick={(e) => toggleSectionFromCaret(e, '__plots__')}
						>
							{#if isOpen('__plots__')}
								<Icon name="caret-down" width={20} height={20} />
							{:else}
								<Icon name="caret-right" width={20} height={20} />
							{/if}
						</button>
					</div>
				</div>

				<div
					class="disclosure-body"
					id="data-panel-section-plots"
					hidden={!isOpen('__plots__')}
					role="treegrid"
					aria-label="Plots"
					{@attach plotRows}
				>
					{#each displayPlots as plot, i (plot.id)}
						<!-- A row of the Plots treegrid (one Tab stop, rovingRows), not a button: it
						     holds the visibility, find and actions buttons and the name editor (in its
						     gridcell), which a button could not. Enter or Space selects the plot;
						     Alt+Up/Down moves it. -->
						<div
							class="second-clps plot-row reorder-row"
							class:plot-drag-over={!q && plotDragOverIdx === i && plotDraggedViewIndex !== i}
							class:canvas-selected={plot.selected}
							draggable={!q}
							role="row"
							tabindex="-1"
							aria-level="1"
							aria-label={plot.name}
							aria-keyshortcuts={q ? undefined : 'Alt+ArrowUp Alt+ArrowDown'}
							aria-describedby={PLOTS_HINT_ID}
							data-roving-row
							data-reorder-key={`plot-${plot.id}`}
							ondragstart={(e) => plotDragStart(e, i)}
							ondragover={(e) => plotDragOver(e, i)}
							ondrop={() => plotDrop(i)}
							ondragend={plotDragReset}
							onclick={(e) => plotSelectAndFind(e, plot)}
							onkeydown={(e) => {
								if (onRowKeydown(e, (d) => movePlotBy(plot, d))) return;
								if (isActivate(e)) {
									e.preventDefault();
									plotSelectAndFind(e, plot);
								}
							}}
						>
							<div class="plot-row-inner" role="gridcell">
								{#if !q}
									<div
										class="plot-drag-handle"
										title="Drag to reorder (changes stacking order), or press Alt+Up/Down on the row"
									>
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
								<p class="plot-name">
									<Editable value={plot.name} onCommit={(v) => commitNodeRename('plot', plot, v)} />
									{#if plot.facet}
										<!-- A facet generator's panels are views, not plots: one row, with the count. -->
										<span class="panel-count">({facetUnits(plot).length} panels)</span>
									{/if}
								</p>
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
				</div>
			</div>
		</div>
	{/if}
	<div class="div-block"></div>
</div>

<SwapColumns bind:showModal={showSwapColumns} />
<SinglePlotAction
	bind:showDropdown={showSinglePlotDropdown}
	dropdownTop={plotDropdownTop}
	dropdownLeft={plotDropdownLeft}
	plotId={selectedPlotId}
/>

<style>
	.data-empty {
		margin: var(--space-2) var(--space-4) var(--space-3);
		font-size: var(--font-sm);
		color: var(--color-text-muted);
		line-height: 1.4;
	}
	.data-empty-link {
		padding: 0;
		border: none;
		background: none;
		font: inherit;
		/* Link text, so 4.5:1: --color-accent is 2.84:1. */
		color: var(--color-accent-text);
		text-decoration: underline;
		cursor: pointer;
	}
	.panel-count {
		font-size: var(--font-xs);
		color: var(--color-text-muted);
		margin-left: var(--space-1);
		white-space: nowrap;
	}
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

	/* The swap button on the Data section header, revealed on hover. Extra
	   specificity so it beats the section header's resting icon opacity. */
	.section .disclosure-head .section-action {
		opacity: 0;
		transition: opacity 0.12s ease;
	}
	.section:hover .disclosure-head .section-action,
	.section .disclosure-head .section-action:focus-visible {
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
	/* The field has no border of its own, so keyboard focus (and a click, as for any text
	   field) shows the app's focus ring around it. */
	.search-input:focus-visible {
		outline: var(--focus-ring);
		outline-offset: 1px;
		border-radius: var(--radius-xs);
	}
	.search-row :global(.search-icon) {
		color: var(--color-text-muted);
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
		color: var(--color-lightness-50);
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
		border-top: 2px solid var(--color-lightness-35);
	}

	/* Find-on-canvas buttons reveal on hover (groups + plots), matching nodes. The
	   group button needs extra specificity to beat `.disclosure-head .icon`'s rest opacity. */
	.clps-container .disclosure-head .group-find-btn,
	.plot-row .plot-find-btn {
		opacity: 0;
		transition: opacity 0.12s ease;
		flex-shrink: 0;
	}
	.clps-container:hover .disclosure-head .group-find-btn,
	.clps-container .disclosure-head .group-find-btn:focus-visible,
	.plot-row:hover .plot-find-btn,
	.plot-row .plot-find-btn:focus-visible {
		opacity: 1;
	}

	/* A section or group: what used to be a <details> (see the markup note). */
	.disclosure {
		margin: var(--space-2) var(--space-4) var(--space-2) var(--space-5);
		padding: 0;
	}

	.disclosure-head {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
		margin: 0;
		padding: 0;
	}

	.disclosure-head p {
		margin: 0;
		padding: 0;
	}

	.disclosure-head button {
		margin: 0;
		padding: 0;
	}

	/* The 15px find button's pointer box is 24px, given back by a negative margin. It grows
	   mostly to the left: the caret 4px to its right has a 24px box too, and two boxes that
	   overlap shrink each other's target. */
	.clps-container .disclosure-head .group-find-btn {
		padding: 4.5px 2px 4.5px 7px;
		margin: -4.5px -2px -4.5px -7px;
	}

	/* The 20px caret's pointer box is 24px (WCAG 2.5.8): 2px of padding each side, given back
	   by a negative margin, so nothing moves. */
	.disclosure-head .disclosure-caret {
		padding: 2px;
		margin: -2px;
	}

	/* Expand/collapse caret is always visible (and clickable) so sections can be
	   expanded directly, not only when their node is selected on the canvas. */
	.disclosure-head .icon {
		opacity: 0.55;
		pointer-events: auto;
		transition: opacity 0.2s ease;
	}

	.disclosure:hover .disclosure-head .icon {
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
		border-radius: var(--radius-xs);
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
