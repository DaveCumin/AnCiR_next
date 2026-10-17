<script module>
	// @ts-nocheck
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import { viewFontScale, viewStyleFor } from '$lib/plots/viewBox.js';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';
	import { columnDisplayName, commitColumnRename } from '$lib/core/columnLabels.js';
	import { core } from '$lib/core/core.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import { timeCellText } from '$lib/utils/time/TimeUtils.js';
	import { formatDateTime } from '$lib/utils/time/displayTime.js';
	import { isBlankEntry } from '$lib/utils/cellEntry.js';
	import { resolvePlotRef } from '$lib/core/plotRefs.js';
	import { readNodeResultTable, readNodeResultOutputs } from '$lib/core/nodeResultTables.svelte.js';
	import { TABLE_SOURCES, normaliseTableSource, normaliseRowTable } from './tableSource.js';

	export const Tableplot_defaultDataInputs = [];
	export const Tableplot_controlHeaders = ['Properties and Data'];
	export const Tableplot_displayName = 'Table';

	export class Tableplotclass {
		static descriptors = {
			showColNumber: { group: 'Display', label: 'Show row numbers' },
			decimalPlaces: { group: 'Display', label: 'Decimal places' },
			colCurrent: { group: 'Display', label: 'Starting row' },
			// The source is chosen in the Table's own panel, never in the shared properties.
			source: { skip: true },
			sourcePlotId: { skip: true },
			resultKey: { skip: true }
		};

		parentBox = $state();
		// Draw at the VIEW's size when one is given (a workflow node), else the figure's own.
		// See plots/viewBox.js for the whole story and why type scales with it.
		renderBox = $state(null);
		viewWidth = $derived(this.renderBox?.w ?? this.parentBox.width);
		viewHeight = $derived(this.renderBox?.h ?? this.parentBox.height);
		fontScale = $derived(viewFontScale(this.renderBox, this.parentBox));
		viewStyle = $derived(viewStyleFor(this.parentBox?.style, this.fontScale));
		// Where the rows come from (tableSource.js): 'columns' (wired, editable), 'plot' (another
		// plot's computed data) or 'node' (one of the Plot's sourceNodeId node's result tables).
		source = $state('columns');
		sourcePlotId = $state(null); // 'plot' mode: a plot id or a facet panel id
		resultKey = $state(null); // 'node' mode: which result table ('stats', 'permutations', ...)
		// 'node' mode: the last rows seen, shown while the node has no live result (after a
		// reload, during the hand-over between its instances) or for good when the node is
		// gone. A PLAIN field, not $state: it is refreshed as the live view is read and saved by
		// toJSON, and nothing reactive may depend on it, so a live update never re-derives the
		// canvas graph (whose signature stringifies every plot's toJSON).
		snapshot = null;
		columnRefs = $state([]);
		showCol = $state([]);
		colWidths = $state({}); // colId (header text outside columns mode) -> px; user-resizable
		colCurrent = $state(1);
		showColNumber = $state(false);
		decimalPlaces = $state(2);

		addColumn(colId) {
			if (!this.columnRefs.includes(colId)) {
				this.columnRefs = [...this.columnRefs, colId];
				this.showCol = [...this.showCol, true];
			}
		}

		addColumns(colIds) {
			const newCols = colIds.filter((id) => !this.columnRefs.includes(id));
			this.columnRefs = [...this.columnRefs, ...newCols];
			this.showCol = [...this.showCol, ...new Array(newCols.length).fill(true)];
		}

		removeColumn(index) {
			this.columnRefs = this.columnRefs.filter((_, i) => i !== index);
			this.showCol = this.showCol.filter((_, i) => i !== index);
		}

		moveColumn(fromIndex, toIndex) {
			const newRefs = [...this.columnRefs];
			const newShow = [...this.showCol];
			const [movedRef] = newRefs.splice(fromIndex, 1);
			const [movedShow] = newShow.splice(fromIndex, 1);
			newRefs.splice(toIndex, 0, movedRef);
			newShow.splice(toIndex, 0, movedShow);
			this.columnRefs = newRefs;
			this.showCol = newShow;
		}

		longestCol = $derived.by(() => {
			let out = 0;

			for (let i = 0; i < this.columnRefs.length; i++) {
				out = Math.max(out, getColumnById(this.columnRefs[i])?.getData()?.length ?? 0);
			}
			return out;
		});

		// The source plot of a 'plot'-mode Table (a Plot or a facet panel), or null.
		sourcePlot = $derived.by(() =>
			this.source === 'plot' && this.sourcePlotId != null ? resolvePlotRef(this.sourcePlotId) : null
		);

		/**
		 * The rows outside Columns mode, as `{ headers, rows, note, status }` (null in Columns
		 * mode). `status`: 'live'; 'unset' / 'missing' (no source plot chosen / found);
		 * 'updating' (the node exists but has no result yet, the snapshot is shown);
		 * 'snapshot' (the node or its table cannot be found, the snapshot is all there is).
		 */
		view = $derived.by(() => {
			if (this.source === 'plot') {
				const empty = { headers: [], rows: [], note: null };
				if (this.sourcePlotId == null) return { ...empty, status: 'unset' };
				const sp = this.sourcePlot;
				// Never a Table showing itself, and never another view (a chain of mirrors can
				// cycle); the panel does not offer either.
				const mirror =
					sp === this.parentBox || (sp?.type === 'tableplot' && sp.plot?.source !== 'columns');
				if (!sp || mirror || typeof sp.plot?.getDownloadData !== 'function') {
					return { ...empty, status: 'missing' };
				}
				const d = sp.plot.getDownloadData() ?? {};
				return {
					headers: d.headers ?? [],
					rows: d.rows ?? [],
					note: d.note ?? null,
					status: 'live'
				};
			}
			if (this.source === 'node') {
				const nodeId = this.parentBox?.sourceNodeId ?? null;
				const live = readNodeResultTable(nodeId, this.resultKey);
				if (live) {
					this.snapshot = { headers: live.headers, rows: live.rows };
					return { ...live, note: null, status: 'live' };
				}
				const snap = this.snapshot;
				const known = this.resultKey != null && nodeIdExists(nodeId);
				return {
					headers: snap?.headers ?? [],
					rows: snap?.rows ?? [],
					note: null,
					status: known ? 'updating' : 'snapshot'
				};
			}
			return null;
		});

		/**
		 * The output ports this Table offers, as `[{ key, type, label }]`: the columns the
		 * source node DECLARES for the result table shown (the permutations table's series,
		 * permutation and permuted_statistic), [] outside Node results or for a table that
		 * declares none (View stats), and null while no mounted instance of the node publishes
		 * the table (a hand-over between its instances, a reload, a deleted node). Null means
		 * UNKNOWN, so the output columns are left as they are (plotMetricDefs.js `tableplot`).
		 */
		outputDecl = $derived.by(() =>
			this.source === 'node'
				? readNodeResultOutputs(this.parentBox?.sourceNodeId ?? null, this.resultKey)
				: []
		);

		/**
		 * Switch where the rows come from. Leaving Columns mode drops the wired columns (and a
		 * wired Column Set) so `columnRefs` is only ever non-empty in Columns mode; leaving
		 * Node mode drops the node link. Column widths are keyed per mode, so they reset.
		 * Unrecorded: the panel wraps it in one undoable step.
		 */
		setSource(mode) {
			if (!TABLE_SOURCES.includes(mode) || mode === this.source) return;
			const parent = this.parentBox;
			if (this.source === 'columns') {
				this.columnRefs = [];
				this.showCol = [];
				if (parent?.setRefs?.series?.length) parent.setRefs = { ...parent.setRefs, series: [] };
			}
			if (this.source === 'node' && parent) parent.sourceNodeId = null;
			if (mode !== 'node') {
				this.resultKey = null;
				this.snapshot = null;
			}
			if (mode !== 'plot') this.sourcePlotId = null;
			this.colWidths = {};
			this.source = mode;
		}

		constructor(parent, dataIN) {
			this.parentBox = parent;
			if (dataIN) applyJSON(this, dataIN);
		}

		getDownloadData() {
			if (this.source !== 'columns') {
				const v = this.view;
				return { headers: v?.headers ?? [], rows: v?.rows ?? [], ...(v?.note && { note: v.note }) };
			}
			const headers = [];
			const columns = [];
			for (let i = 0; i < this.columnRefs.length; i++) {
				if (!this.showCol[i]) continue;
				const col = getColumnById(this.columnRefs[i]);
				if (!col) continue;
				headers.push(col.name);
				columns.push(col.getData() ?? []);
			}
			const maxLen = Math.max(...columns.map((c) => c.length), 0);
			const rows = [];
			for (let r = 0; r < maxLen; r++) {
				rows.push(columns.map((col) => (r < col.length ? col[r] : '')));
			}
			return { headers, rows };
		}

		// Columns mode writes exactly what every Table wrote before sources existed. The other
		// modes never write live rows: 'plot' saves none at all (the source plot recomputes
		// them), 'node' saves only the plain snapshot (see `snapshot`), so serialising a Table
		// never subscribes to its source.
		toJSON() {
			const base = {
				columnRefs: this.columnRefs,
				showCol: this.showCol,
				colWidths: this.colWidths,
				colCurrent: this.colCurrent,
				showColNumber: this.showColNumber,
				decimalPlaces: this.decimalPlaces
			};
			if (this.source === 'plot') {
				return { source: 'plot', sourcePlotId: this.sourcePlotId, ...base };
			}
			if (this.source === 'node') {
				return {
					source: 'node',
					resultKey: this.resultKey,
					snapshot: normaliseRowTable(this.snapshot),
					...base
				};
			}
			return base;
		}

		static fromJSON(parent, json) {
			const table = new Tableplotclass(parent, null);
			if (json) applyJSON(table, json);
			return table;
		}
	}

	function applyJSON(table, json) {
		const src = normaliseTableSource(json);
		table.source = src.source;
		table.sourcePlotId = src.source === 'plot' ? src.sourcePlotId : null;
		table.resultKey = src.source === 'node' ? src.resultKey : null;
		table.snapshot = src.source === 'node' ? src.snapshot : null;
		// Outside Columns mode a Table takes no columns, whatever the file says.
		table.columnRefs = src.source === 'columns' ? (json.columnRefs ?? []) : [];
		table.showCol =
			src.source === 'columns' ? (json.showCol ?? Array(table.columnRefs.length).fill(true)) : [];
		table.colWidths = json.colWidths ?? {};
		table.colCurrent = json.colCurrent ?? 1;
		table.showColNumber = json.showColNumber ?? false;
		table.decimalPlaces = json.decimalPlaces ?? 2;
	}

	// Whether a canvas node id names a node that still exists (only analysis and process
	// nodes publish result tables).
	function nodeIdExists(nodeId) {
		if (typeof nodeId !== 'string') return false;
		const m = /^(tableprocess|process)_(.+)$/.exec(nodeId);
		if (!m) return false;
		const same = (x) => String(x?.id) === m[2];
		if (m[1] === 'tableprocess') return (core.tableProcesses ?? []).some(same);
		return (
			(core.orphanProcesses ?? []).some(same) ||
			(core.data ?? []).some((c) => (c.processes ?? []).some(same))
		);
	}

	export const definition = {
		displayName: Tableplot_displayName,
		defaultDataInputs: Tableplot_defaultDataInputs,
		controlHeaders: Tableplot_controlHeaders,
		plotClass: Tableplotclass
	};
</script>

<script>
	// @ts-nocheck
	import VirtualList from '$lib/components/reusables/VirtualList.svelte';
	import Editable from '$lib/components/inputs/Editable.svelte';
	import { columnWidths, headerMinWidths, MIN_COL_W } from './columnWidths.js';
	import { applyCellEdit, cellReadOnlyReason } from './cellEdit.js';
	import { buildColumnOwnerIndex } from '$lib/core/outputLabels.js';
	import { mutationService } from '$lib/core/mutationService.js';
	import { addNotification } from '$lib/core/notifications.svelte.js';
	import { recordGraphMutation } from '$lib/core/operations.js';
	import { allPanels } from '$lib/core/facetPanels.svelte.js';
	import {
		listNodeResultTables,
		nodeResultTableTitle,
		publishingNodeIds
	} from '$lib/core/nodeResultTables.svelte.js';
	import { tableSourceOf, TABLE_SOURCE_LABELS } from './tableSource.js';
	import { usePlotMetricOutputs, ownsPlotMetrics } from '$lib/plots/plotMetricOutputs.svelte.js';

	let { theData, which } = $props();

	// Output ports of a Node-results Table (plotMetricDefs.js `tableplot`): the on-screen
	// instance, or the hidden `which="compute"` one NodeComputeHost mounts while the Table is
	// off screen, keeps the declared output columns equal to the rows the Table shows.
	usePlotMetricOutputs(
		() => theData,
		() => ownsPlotMetrics(which)
	);

	// ── Source controls (the panel; `theData` there is the inner Tableplotclass) ──────────
	// Each change is one undoable step (recordGraphMutation captures the inner object and the
	// Plot's own sourceNodeId and setRefs).
	function switchSource(table, mode) {
		if (tableSourceOf(table) === mode) return;
		recordGraphMutation(() => {
			table.setSource(mode);
			if (mode === 'node') {
				// Keep a node the Table was already linked to (a quick-plot Table) when it
				// publishes results, and start on its first table.
				const nodeId = table.parentBox?.sourceNodeId;
				const first = nodeId ? listNodeResultTables(nodeId)[0] : null;
				if (!first && table.parentBox) table.parentBox.sourceNodeId = null;
				table.resultKey = first?.key ?? null;
			}
		});
	}

	// Plots (and facet panels) a 'plot'-mode Table can mirror: anything with computed data,
	// except this Table and Tables that are themselves views.
	function plotCandidates(table) {
		return [...(core.plots ?? []), ...allPanels()].filter(
			(p) =>
				p &&
				p !== table.parentBox &&
				!(p.type === 'tableplot' && tableSourceOf(p.plot) !== 'columns') &&
				typeof p.plot?.getDownloadData === 'function'
		);
	}

	function choosePlot(table, value) {
		const pick = plotCandidates(table).find((p) => String(p.id) === value);
		recordGraphMutation(() => {
			table.sourcePlotId = pick ? pick.id : null;
			table.colWidths = {};
		});
	}

	function nodeLabel(nodeId) {
		const m = /^tableprocess_(.+)$/.exec(nodeId ?? '');
		const tp = m ? (core.tableProcesses ?? []).find((t) => String(t.id) === m[1]) : null;
		return tp ? tp.displayName || tp.name : String(nodeId ?? '');
	}

	function chooseNode(table, nodeId) {
		const first = nodeId ? listNodeResultTables(nodeId)[0] : null;
		recordGraphMutation(() => {
			if (table.parentBox) table.parentBox.sourceNodeId = nodeId || null;
			table.resultKey = first?.key ?? null;
			table.snapshot = null;
			table.colWidths = {};
		});
	}

	function chooseResult(table, key) {
		recordGraphMutation(() => {
			table.resultKey = key || null;
			table.snapshot = null;
			table.colWidths = {};
		});
	}

	// One read-only cell: numbers to the Table's decimal places, missing as empty.
	function formatValue(value) {
		if (value == null || value === '') return '';
		if (typeof value === 'number') {
			return Number.isFinite(value) ? value.toFixed(theData.plot.decimalPlaces) : String(value);
		}
		return String(value);
	}

	// The muted line under a read-only body: why the rows are not live, or that a plot's
	// export was reduced.
	function viewStatusText(v, table) {
		if (!v) return '';
		if (v.status === 'updating')
			return `Showing the saved rows until ${nodeLabel(table.parentBox?.sourceNodeId)} has results.`;
		if (v.status === 'snapshot') return 'Snapshot: the source node was not found.';
		if (v.note) return 'Reduced from the full data; hover for details.';
		return '';
	}

	let expandedTables = $state(new Set());
	let expandedPlots = $state(new Set());

	// ── Virtualised body helpers ──────────────────────────────────────────────
	// The table renders the FULL series via a windowed list (only on-screen rows in
	// the DOM), with per-cell formatting computed lazily, replacing the old
	// "Starting row + Ncolumns" pager.
	let visibleColumns = $derived.by(() => {
		const tp = theData?.plot;
		if (!tp) return [];
		const out = [];
		for (let i = 0; i < tp.columnRefs.length; i++) {
			// Columns added by WIRING only extend columnRefs (not showCol), so an
			// undefined entry means "not hidden" — default to visible.
			if (tp.showCol[i] === false) continue;
			const col = getColumnById(tp.columnRefs[i]);
			out.push({
				colId: tp.columnRefs[i],
				col,
				readOnly: cellReadOnlyReason(col, owners.get(col?.id))
			});
		}
		return out;
	});
	// Which node outputs each column (UI-17): a node's output is read-only in the Table.
	let owners = $derived(buildColumnOwnerIndex(core));
	// Outside Columns mode the body is read-only rows from the class's `view` (a plot's
	// computed data or a node's result table). Its columns are keyed by header text (a repeat
	// gets its position appended), which is what `colWidths` holds in those modes.
	let readOnly = $derived(tableSourceOf(theData?.plot) !== 'columns');
	let view = $derived(readOnly ? theData.plot.view : null);
	let roHeaders = $derived(view?.headers ?? []);
	let roRows = $derived(view?.rows ?? []);
	let roKeys = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local lookup built and consumed inside this $derived.by body; the returned value is a plain array
		const seen = new Set();
		return roHeaders.map((h, i) => {
			const key = String(h ?? '');
			const unique = seen.has(key) ? `${key}#${i}` : key;
			seen.add(unique);
			return unique;
		});
	});
	// The keys of the columns on screen, in order, in either body.
	let colKeys = $derived(readOnly ? roKeys : visibleColumns.map((vc) => vc.colId));
	let rowCount = $derived(readOnly ? roRows.length : (theData?.plot?.longestCol ?? 0));
	let rowItems = $derived(Array.from({ length: rowCount }, (_, i) => i));
	let hasTwoLineCol = $derived(
		visibleColumns.some(
			(c) => c.col && (c.col.type === 'bin' || (c.col.type === 'time' && !c.col.isReferencial()))
		)
	);
	// Row height for the 0.85rem cell font: ~44px for one line, more for the two-line time
	// cells (value + "computed hrs" sub-line). It used to be described as tracking 1.5rem,
	// which was only ever true inside a workflow node, and that override is gone.
	let rowH = $derived(hasTwoLineCol ? 64 : 44);
	const NUM_COL_W = 44;
	// Inner width of the scroll box; unresized columns share it (columnWidths.js).
	// Less the body list's vertical scrollbar, where the platform draws a classic
	// one: the rows are that much narrower than the header, and a table sized to
	// the full box would clip its last column under the scrollbar.
	let scrollEl = $state(null);
	let scrollBoxW = $state(0);
	let scrollBoxH = $state(0);
	let bodyGutter = $state(0);
	$effect(() => {
		void scrollBoxW;
		void scrollBoxH;
		void rowCount;
		const list = scrollEl?.querySelector('.vlist');
		bodyGutter = list ? list.offsetWidth - list.clientWidth : 0;
	});
	let numColW = $derived(theData?.plot?.showColNumber ? NUM_COL_W : 0);
	// Each header's longest word, measured in the header's own font, is the least its auto
	// column may be (columnWidths.js): a single word wider than the column could only break
	// mid-word. The font is read off the rendered header, so it follows the figure's font and
	// size; until the table has rendered (scrollEl unset) there is no minimum.
	let measureCtx = null;
	let headerMins = $derived.by(() => {
		void scrollBoxW; // re-measure when the box (and so possibly the font scale) changes
		const th = scrollEl?.querySelector('.tp-th');
		if (!th || typeof document === 'undefined') return {};
		measureCtx ??= document.createElement('canvas').getContext('2d');
		if (!measureCtx) return {};
		const cs = getComputedStyle(th);
		measureCtx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
		// Everything around the text, read off the header: the cell's padding and border and the
		// editable name's own padding and border; +1px so sub-pixel layout never tips a word over.
		const sideX = (st) =>
			['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce(
				(sum, k) => sum + (parseFloat(st[k]) || 0),
				0
			);
		const name = th.querySelector('.inline-edit-span');
		const padX = sideX(cs) + (name ? sideX(getComputedStyle(name)) : 0) + 1;
		const headers = {};
		if (readOnly) roKeys.forEach((k, i) => (headers[k] = String(roHeaders[i] ?? '')));
		else
			for (const vc of visibleColumns) headers[vc.colId] = vc.col ? columnDisplayName(vc.col) : '';
		return headerMinWidths(headers, (word) => measureCtx.measureText(word).width, padX);
	});
	let widths = $derived(
		columnWidths(
			colKeys,
			theData?.plot?.colWidths,
			scrollBoxW > 0 ? scrollBoxW - bodyGutter : 0,
			numColW,
			headerMins
		)
	);
	const widthFor = (colId) => widths[colId];
	let colOffsetPx = $derived(numColW ? `${numColW}px ` : '');
	// Fixed px column widths (not 1fr) so the sticky header grid and the row grids
	// stay aligned regardless of the body's vertical scrollbar, and so columns can
	// be resized + overflow can ellipsis.
	let gridCols = $derived(`${colOffsetPx}${colKeys.map((k) => `${widthFor(k)}px`).join(' ')}`);
	let tableMinWidth = $derived(numColW + colKeys.reduce((sum, k) => sum + widthFor(k), 0));

	// Set while a column-resize drag is live, so an unmount mid-drag can still
	// release the window listeners the drag installed.
	let releaseColResize = null;

	// Drag a column header's right edge to resize that column.
	function startColResize(e, colId) {
		e.preventDefault();
		e.stopPropagation();
		const startX = e.clientX;
		const startW = widthFor(colId);
		const onMove = (ev) => {
			const w = Math.max(MIN_COL_W, Math.round(startW + (ev.clientX - startX)));
			theData.plot.colWidths = { ...theData.plot.colWidths, [colId]: w };
		};
		const onUp = () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			releaseColResize = null;
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		releaseColResize = onUp;
	}

	// Drop any dangling drag listeners if this unmounts mid-gesture.
	$effect(() => () => releaseColResize?.());

	// Format one cell (column, absolute row index) — mirrors the per-type logic the
	// class used to bake into `tableData`, but one cell at a time.
	function formatCell(col, i) {
		if (!col) return '—';
		const dp = theData.plot.decimalPlaces;
		if (col.type === 'bin') {
			const rawArr = core.rawData.get(col.data);
			if (!Array.isArray(rawArr)) return '—';
			const x = rawArr[i];
			if (!Number.isFinite(x)) return { raw: '-', computed: '-', isTime: true };
			// Centre = start + half the bin WIDTH, as Column.getData reports it.
			const half = (col.binWidth ?? 0) / 2;
			const rangeStr = `±${half.toFixed(2)}`;
			if (col.originTime_ms != null) {
				const centerMs = col.originTime_ms + (x + half) * 3600000;
				return {
					raw: Number.isFinite(centerMs) ? formatDateTime(centerMs) : '-',
					computed: Number.isFinite(centerMs) ? rangeStr : '-',
					isTime: true
				};
			}
			return { raw: (x + half).toFixed(dp), computed: rangeStr, isTime: true };
		}
		if (col.type === 'time' && !col.isReferencial()) {
			const rawArr = core.rawData.get(col.data);
			// Source columns carry a raw series; AWD (compressed {start, step}) and
			// producer/derived time columns don't, so fall back to getData()
			// (UNIX ms) to still render dates rather than bare epoch numbers.
			const timeArr = Array.isArray(rawArr) ? rawArr : col.getData();
			if (Array.isArray(timeArr)) {
				const raw = timeCellText(timeArr[i], col.getData()?.[i]);
				const hours = col.hoursSinceStart?.[i];
				const hoursStr = raw !== '-' && Number.isFinite(hours) ? hours.toFixed(dp) : '-';
				return { raw, computed: hoursStr, isTime: true };
			}
		}
		const v = col.getData()?.[i];
		if (Number.isFinite(v)) return v.toFixed(theData.plot.decimalPlaces);
		// Missing (null, blank, or the NaN older sessions stored) shows as an empty, editable cell.
		return isBlankEntry(v) ? '' : v;
	}

	// Visible-column position → the `col` index makeEdits expects (row-number column
	// occupies slot 0 when shown).
	function editColIndex(visIndex) {
		return visIndex + (theData.plot.showColNumber ? 1 : 0);
	}

	function toggleTable(id) {
		expandedTables = expandedTables.has(id)
			? new Set([...expandedTables].filter((x) => x !== id))
			: new Set([...expandedTables, id]);
	}

	function togglePlot(id) {
		expandedPlots = expandedPlots.has(id)
			? new Set([...expandedPlots].filter((x) => x !== id))
			: new Set([...expandedPlots, id]);
	}

	function isColumnSelected(colId) {
		return theData?.columnRefs?.includes(colId) ?? false;
	}

	function isPlotSelected(plot) {
		let cols = [];
		if (plot?.data && Array.isArray(plot.plot.data)) {
			cols = plot.plot.data.flatMap((d) => [d.x?.refId, d.y?.refId, d.z?.refId]).filter(Boolean);
		} else if (plot?.columnRefs) {
			cols = plot.plot.columnRefs;
		}
		return cols.length > 0 && cols.every(isColumnSelected);
	}

	function togglePlotSelection(plot) {
		let cols = [];
		if (plot?.data && Array.isArray(plot.data)) {
			cols = [
				...new Set(plot.data.flatMap((d) => [d.x?.refId, d.y?.refId, d.z?.refId]).filter(Boolean))
			];
		} else if (plot?.columnRefs) {
			cols = plot.columnRefs;
		}
		const isSel = isPlotSelected(plot);
		if (isSel) {
			cols.forEach((colId) => {
				const idx = theData.columnRefs.indexOf(colId);
				if (idx >= 0) theData.removeColumn(idx);
			});
		} else {
			theData.addColumns(cols);
		}
	}

	function toggleColumnSelection(colId) {
		//console.log('Toggling column', colId, ', is currently selected:', isColumnSelected(colId));
		const isSel = isColumnSelected(colId);
		if (isSel) {
			const idx = theData.columnRefs.indexOf(colId);
			if (idx >= 0) theData.removeColumn(idx);
		} else {
			theData.addColumn(colId);
		}
	}

	function getPlotColumns(plot) {
		//console.log('getting columns for plot', plot.name, plot);
		if (plot?.data && Array.isArray(plot.data)) {
			return [
				...new Set(
					plot.data
						.flatMap((d) => [d.x?.refId, d.y?.refId, d.z?.refId])
						.filter((id) => id != null && id !== -1)
				)
			];
		}
		if (plot?.columnRefs) return plot.columnRefs;
		return [];
	}

	let standaloneColumns = $derived.by(() => {
		// "Standalone" = columns not absorbed by any Group node.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local lookup built and consumed inside this $derived.by body; the returned value is a plain array, so nothing reads this collection reactively
		const grouped = new Set();
		for (const g of core.groups ?? []) {
			for (const cid of g.sourceColumnIds ?? []) grouped.add(cid);
		}
		return core.data?.filter((c) => !grouped.has(c.id)) ?? [];
	});

	function makeEdits(edit) {
		const colOffset = theData.plot.showColNumber ? 1 : 0;
		const tableCol = edit.col - colOffset;

		let visibleCount = 0;
		let actualIdx = -1;
		for (let i = 0; i < theData.plot.columnRefs.length; i++) {
			if (theData.plot.showCol[i]) {
				if (visibleCount === tableCol) {
					actualIdx = i;
					break;
				}
				visibleCount++;
			}
		}

		if (actualIdx < 0) return;

		const colId = theData.plot.columnRefs[actualIdx];
		const column = getColumnById(colId);
		if (!column) return;
		const locked = edit.row === 'h' ? null : cellReadOnlyReason(column, owners.get(column.id));
		if (locked) {
			addNotification(locked, 'warning');
			return;
		}

		if (edit.row === 'h') {
			// A header rename is one renameColumn operation on commit (an undo step, an unsaved
			// change). Typing a node output's label back restores its auto name, so the label
			// stays live; an empty header restores the auto-derived name.
			commitColumnRename(column, edit.value);
			return;
		}

		const rowIndex = Number(edit.row); // virtualised rows pass an absolute index
		if (rowIndex >= theData.plot.longestCol) return;

		// Blank is stored as missing (null), a number column only takes numbers and a category
		// keeps its text (STAT-15). Every edit goes through the op history (an Edit value process
		// for number and category cells, the raw series for time cells), so each is one undo step.
		const result = applyCellEdit(column, rowIndex, edit.value, {
			rawData: core.rawData,
			addProcess: (colId, name, args) => mutationService.addProcess(colId, name, args),
			setProcessArg: (colId, procId, key, value) =>
				mutationService.setProcessArg(colId, procId, key, value),
			setRawCell: (colId, row, value) => mutationService.setRawCell(colId, row, value)
		});
		if (!result.ok) {
			addNotification(result.reason, 'warning');
			// The cell still shows the refused text; redraw it from the data it kept.
			rejectedEdits++;
		}
	}

	// Bumped when an entry is refused, to re-mount the body cells so the refused text is replaced
	// by the stored value (Editable keeps its own copy of what was typed).
	let rejectedEdits = $state(0);
</script>

{#snippet controls(theData)}
	{@const source = tableSourceOf(theData)}
	<div class="control-component">
		<div class="control-component-title"><p>Table settings</p></div>
		<div class="control-input-vertical">
			<ControlInput label="Source">
				<div class="segmented" role="radiogroup" aria-label="Table source">
					{#each TABLE_SOURCES as mode (mode)}
						<label class:active={source === mode}>
							<input
								type="radio"
								name={`table-source-${theData.parentBox?.id}`}
								value={mode}
								checked={source === mode}
								onchange={() => switchSource(theData, mode)}
							/>
							{TABLE_SOURCE_LABELS[mode]}
						</label>
					{/each}
				</div>
			</ControlInput>
		</div>
		{#if source === 'plot'}
			{@const candidates = plotCandidates(theData)}
			{@const current = candidates.find((p) => p.id === theData.sourcePlotId)}
			<div class="control-input-vertical">
				<ControlInput label="Plot">
					<select
						aria-label="Source plot"
						value={current ? String(current.id) : ''}
						onchange={(e) => choosePlot(theData, e.currentTarget.value)}
					>
						<option value="" disabled
							>{theData.sourcePlotId == null ? 'Choose a plot' : '(source plot not found)'}</option
						>
						{#each candidates as p (p.id)}
							<option value={String(p.id)}>{p.name}</option>
						{/each}
					</select>
				</ControlInput>
			</div>
		{:else if source === 'node'}
			{@const nodeId = theData.parentBox?.sourceNodeId ?? null}
			{@const nodeIds = publishingNodeIds()}
			{@const tables = nodeId ? listNodeResultTables(nodeId) : []}
			<div class="control-input-vertical">
				<ControlInput label="Node">
					<select
						aria-label="Source node"
						value={nodeId && nodeIds.includes(nodeId) ? nodeId : ''}
						onchange={(e) => chooseNode(theData, e.currentTarget.value)}
					>
						<option value="" disabled
							>{nodeId == null
								? nodeIds.length
									? 'Choose a node'
									: 'No node has results to show'
								: `${nodeLabel(nodeId)} (no results)`}</option
						>
						{#each nodeIds as id (id)}
							<option value={id}>{nodeLabel(id)}</option>
						{/each}
					</select>
				</ControlInput>
				{#if nodeId && (tables.length || theData.resultKey)}
					<ControlInput label="Result table">
						<select
							aria-label="Result table"
							value={tables.some((t) => t.key === theData.resultKey) ? theData.resultKey : ''}
							onchange={(e) => chooseResult(theData, e.currentTarget.value)}
						>
							<option value="" disabled
								>{theData.resultKey == null
									? 'Choose a table'
									: (nodeResultTableTitle(nodeId, theData.resultKey) ??
										'(table not available)')}</option
							>
							{#each tables as t (t.key)}
								<option value={t.key}>{t.title}</option>
							{/each}
						</select>
					</ControlInput>
				{/if}
			</div>
		{/if}
		<div class="control-input-vertical">
			<label class="control-input-checkbox">
				<input type="checkbox" bind:checked={theData.showColNumber} />
				<span class="ci-label">Show row numbers</span>
			</label>
		</div>
		<div class="control-input-horizontal">
			<ControlInput label="Decimal places">
				<NumberWithUnits min="0" step="1" bind:value={theData.decimalPlaces} />
			</ControlInput>
		</div>
	</div>

	{#if source === 'columns'}
		<div class="div-line"></div>

		<div class="control-component">
			<div class="control-component-title">
				<p>Columns</p>
				{#if theData.columnRefs.length}
					<span class="column-count">{theData.columnRefs.length} selected</span>
				{/if}
			</div>

			<div class="tree-list display-list">
				<!-- Groups (replace tables) -->
				{#each core.groups as group (group.id)}
					<details class="clps-item" open={expandedTables.has(group.id)}>
						<summary
							class="clps-title-container"
							onclick={(e) => e.preventDefault()}
							onkeydown={(e) => {
								if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget)
									e.preventDefault();
							}}
						>
							<div class="clps-title">
								<input
									type="checkbox"
									aria-label={`All columns of ${group.name}`}
									checked={(group.sourceColumnIds ?? []).every((cid) => isColumnSelected(cid))}
									onclick={(e) => {
										e.stopPropagation();
										const all = (group.sourceColumnIds ?? []).every((cid) => isColumnSelected(cid));
										for (const cid of group.sourceColumnIds ?? []) {
											if (all) {
												if (isColumnSelected(cid)) toggleColumnSelection(cid);
											} else {
												if (!isColumnSelected(cid)) toggleColumnSelection(cid);
											}
										}
									}}
								/>
								<span class="tree-name">{group.name}</span>
							</div>

							<div class="clps-title-button">
								<button
									class="icon"
									type="button"
									aria-label={`Show the columns of ${group.name}`}
									aria-expanded={expandedTables.has(group.id)}
									onclick={() => {
										toggleTable(group.id);
									}}
								>
									{#if expandedTables.has(group.id)}
										<Icon name="caret-down" width={20} height={20} />
									{:else}
										<Icon name="caret-right" width={20} height={20} />
									{/if}
								</button>
							</div>
						</summary>

						<div class="tree-children">
							{#each group.sourceColumnIds ?? [] as colId (colId)}
								{@const col = getColumnById(colId)}
								{#if col}
									<label class="tree-item-child">
										<input
											type="checkbox"
											checked={isColumnSelected(colId)}
											onchange={() => toggleColumnSelection(colId)}
										/>
										<span class="tree-name">{columnDisplayName(col)}</span>
									</label>
								{/if}
							{/each}
						</div>
					</details>
				{/each}

				<!-- Plots -->
				{#each core.plots as plot (plot.id)}
					{@const plotCols = getPlotColumns(plot)}
					{#if plotCols.length > 0}
						<details class="clps-item" open={expandedPlots.has(plot.id)}>
							<summary
								class="clps-title-container"
								onclick={(e) => e.preventDefault()}
								onkeydown={(e) => {
									if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget)
										e.preventDefault();
								}}
							>
								<div class="clps-title">
									<input
										type="checkbox"
										aria-label={`All columns of ${plot.name}`}
										checked={isPlotSelected(plot)}
										onclick={(e) => {
											e.stopPropagation();
											togglePlotSelection(plot);
										}}
									/>
									<span class="tree-name">{plot.name}</span>
									<span class="tree-badge">Plot</span>
								</div>

								<div class="clps-title-button">
									<button
										class="icon"
										type="button"
										aria-label={`Show the columns of ${plot.name}`}
										aria-expanded={expandedPlots.has(plot.id)}
										onclick={() => {
											togglePlot(plot.id);
										}}
									>
										{#if expandedPlots.has(plot.id)}
											<Icon
												name="caret-down"
												width={20}
												height={20}
												className="first-detail-title-icon"
											/>
										{:else}
											<Icon
												name="caret-right"
												width={20}
												height={20}
												className="first-detail-title-icon"
											/>
										{/if}
									</button>
								</div>
							</summary>

							<div class="tree-children">
								{#each plotCols as colId (colId)}
									{@const col = getColumnById(colId)}
									{#if col}
										<label class="tree-item-child">
											<input
												type="checkbox"
												checked={isColumnSelected(colId)}
												onchange={() => toggleColumnSelection(colId)}
											/>
											<span class="tree-name">{columnDisplayName(col)}</span>
											<!-- <span class="tree-type">{col.type}</span> -->
										</label>
									{/if}
								{/each}
							</div>
						</details>
					{/if}
				{/each}

				<!-- Standalone columns (flat, no grouping) -->
				{#each standaloneColumns as col (col.id)}
					<label class="tree-item-child standalone">
						<input
							type="checkbox"
							checked={isColumnSelected(col.id)}
							onchange={() => toggleColumnSelection(col.id)}
						/>
						<span class="tree-name">{columnDisplayName(col)}</span>
						<!-- <span class="tree-type">{col.type}</span> -->
					</label>
				{/each}

				{#if !core.groups.length && !core.plots.length && !standaloneColumns.length}
					<p class="empty-state">No data available</p>
				{/if}
			</div>
		</div>
	{/if}
{/snippet}

{#snippet readOnlyBody(theData)}
	{@const status = viewStatusText(view, theData.plot)}
	{#if roHeaders.length === 0}
		<p class="tp-empty">
			{#if view?.status === 'unset'}
				Choose a plot in the Table settings.
			{:else if view?.status === 'missing'}
				Source plot not found.
			{:else if tableSourceOf(theData.plot) === 'node' && theData.plot.resultKey == null}
				Choose a node's result table in the Table settings.
			{:else if view?.status === 'snapshot'}
				Source node not found.
			{:else}
				No results yet.
			{/if}
		</p>
	{:else}
		<div class="tableplot-layout">
			<div
				class="tp-scroll"
				bind:this={scrollEl}
				bind:clientWidth={scrollBoxW}
				bind:clientHeight={scrollBoxH}
				role="presentation"
				onwheel={(e) => {
					if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
				}}
			>
				<div class="tp-inner" style="min-width:{tableMinWidth}px;">
					<div class="tp-head" style="grid-template-columns:{gridCols};">
						{#if theData.plot.showColNumber}
							<div class="tp-th tp-num">#</div>
						{/if}
						{#each roKeys as key, c (key)}
							<div class="tp-th" title={String(roHeaders[c] ?? '')}>
								<span class="tp-th-text">{roHeaders[c]}</span>
								<div
									class="tp-resize"
									role="separator"
									aria-orientation="vertical"
									title="Drag to resize column"
									onpointerdown={(e) => startColResize(e, key)}
								></div>
							</div>
						{/each}
					</div>

					<VirtualList items={rowItems} fill itemHeight={rowH}>
						{#snippet row(i)}
							<div class="tp-tr" style="grid-template-columns:{gridCols};">
								{#if theData.plot.showColNumber}
									<div class="tp-td tp-num">{i + 1}</div>
								{/if}
								<!-- eslint-disable-next-line no-unused-vars -- `as` binding is required before the index; only the column index `c` is used -->
								{#each roKeys as _k, c (c)}
									{@const text = formatValue(roRows[i]?.[c])}
									<div class="tp-td" title={text}><span class="tp-cell-text">{text}</span></div>
								{/each}
							</div>
						{/snippet}
					</VirtualList>
				</div>
			</div>
			<p class="tableplot-row-bar" title={view?.note ?? ''}>
				{rowCount} row{rowCount === 1 ? '' : 's'}{#if status}<span class="tp-status">{status}</span
					>{/if}
			</p>
		</div>
	{/if}
{/snippet}

{#snippet plot(theData)}
	{#if readOnly}
		{@render readOnlyBody(theData)}
	{:else if visibleColumns.length > 0 || theData.plot.showColNumber}
		<div class="tableplot-layout">
			<div
				class="tp-scroll"
				bind:this={scrollEl}
				bind:clientWidth={scrollBoxW}
				bind:clientHeight={scrollBoxH}
				role="presentation"
				onwheel={(e) => {
					if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
				}}
			>
				<div class="tp-inner" style="min-width:{tableMinWidth}px;">
					<div class="tp-head" style="grid-template-columns:{gridCols};">
						{#if theData.plot.showColNumber}
							<div class="tp-th tp-num">#</div>
						{/if}
						{#each visibleColumns as vc, vi (vc.colId)}
							{@const headerText = vc.col ? columnDisplayName(vc.col) : '???'}
							<div
								class="tp-th"
								title={vc.col ? (vc.readOnly ? `${headerText}\n${vc.readOnly}` : headerText) : ''}
							>
								<Editable
									editable={true}
									value={headerText}
									onCommit={(v) => makeEdits({ col: editColIndex(vi), row: 'h', value: v })}
								/>
								<!-- Drag the right edge to resize this column. -->
								<div
									class="tp-resize"
									role="separator"
									aria-orientation="vertical"
									title="Drag to resize column"
									onpointerdown={(e) => startColResize(e, vc.colId)}
								></div>
							</div>
						{/each}
					</div>

					<VirtualList items={rowItems} fill itemHeight={rowH}>
						<!-- The items ARE the row indices, so the item is all a row needs. -->
						{#snippet row(i)}
							<div class="tp-tr" style="grid-template-columns:{gridCols};">
								{#if theData.plot.showColNumber}
									<div class="tp-td tp-num">{i + 1}</div>
								{/if}
								{#each visibleColumns as vc, vi (vc.colId)}
									{@const cell = formatCell(vc.col, i)}
									<!-- title: a narrow column ellipsizes long values; hover shows it whole. -->
									<div class="tp-td" title={cell?.isTime ? String(cell.raw) : (cell ?? '')}>
										<!-- Edits apply on commit (Enter / blur), one undo step each, so a
										     half-typed entry is never stored. Computed cells (a node's output, a bin
										     column) are read-only: see cellReadOnlyReason. -->
										{#if cell && cell.isTime}
											<div class="time-cell">
												{#key rejectedEdits}
													<Editable
														value={cell.raw}
														editable={!vc.readOnly}
														onCommit={(v) => makeEdits({ col: editColIndex(vi), row: i, value: v })}
													/>
												{/key}
												{#if String(cell.computed) !== String(cell.raw)}
													<div class="computed-time">{cell.computed} h</div>
												{/if}
											</div>
										{:else if cell == null}
											<span class="null-value">-</span>
										{:else}
											{#key rejectedEdits}
												<Editable
													value={cell}
													editable={!vc.readOnly}
													onCommit={(v) => makeEdits({ col: editColIndex(vi), row: i, value: v })}
												/>
											{/key}
										{/if}
									</div>
								{/each}
							</div>
						{/snippet}
					</VirtualList>
				</div>
			</div>
			<p class="tableplot-row-bar">{rowCount} row{rowCount === 1 ? '' : 's'}</p>
		</div>
	{:else}
		<p style="color: var(--color-text-muted); font-style: italic;">No columns selected</p>
	{/if}
{/snippet}

{#if which === 'plot'}
	{@render plot(theData)}
{:else if which === 'controls'}
	{@render controls(theData)}
{/if}

<!-- which === 'compute' (NodeComputeHost): renders nothing; only the output hook above runs. -->

<style>
	.tableplot-layout {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}

	.tp-scroll {
		flex: 1;
		min-height: 0;
		overflow-x: auto;
		overflow-y: hidden;
		border: 1px solid var(--color-lightness-85);
		border-radius: var(--radius-sm);
		background: var(--surface-card);
		/* One font everywhere. The node preview used to CSS-scale the whole plot down, so
		   this was compensated for below with a 1.5rem override; now the table lays out to
		   the node's own size (see plots/viewBox.js) and that override just made it huge. */
		font-size: 0.85rem;
		/* On the workflow canvas the plot preview wrapper sets pointer-events:none
		   (so the node stays draggable); re-enable it here so the table can be
		   scrolled/edited. The node is still draggable via its header. */
		pointer-events: auto;
	}

	/* Full height of .tp-scroll so the fill VirtualList can take the space left
	   under the sticky header and scroll vertically. */
	.tp-inner {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.tp-head {
		display: grid;
		position: sticky;
		top: 0;
		z-index: 1;
		background: var(--color-lightness-97);
		flex-shrink: 0;
	}

	/* Headers wrap instead of ellipsizing: a column name like "Peak period (h)"
	   is the only label the column has, so it should read in full at the default
	   width. Bottom-aligned so a one-line header sits on the same line as the
	   last line of a wrapped neighbour. The cell's title carries the full name
	   for the rare header that still hits the line clamp below. */
	.tp-th {
		padding: 6px 12px;
		font-weight: 600;
		border-bottom: 1px solid var(--color-lightness-85);
		border-right: 1px solid var(--color-lightness-85);
		display: flex;
		align-items: flex-end;
		min-width: 0;
		overflow: hidden;
		position: relative; /* anchors the resize grip */
	}

	/* Drag handle straddling each header's right border. */
	.tp-resize {
		position: absolute;
		top: 0;
		right: -3px;
		width: 7px;
		height: 100%;
		cursor: col-resize;
		z-index: 2;
		touch-action: none;
	}
	/* Invisible ~25px-wide grab zone so the thin 7px handle still meets the WCAG 2.5.8
	   24px minimum (the visible hover strip stays 7px). */
	.tp-resize::before {
		content: '';
		position: absolute;
		inset: 0 -9px;
	}
	.tp-resize:hover {
		background: color-mix(in srgb, var(--color-accent) 35%, transparent);
	}

	/* Truncate over-long cell/header text with an ellipsis (the values are
	   rendered by the Editable child, hence the :global span target). The fixed
	   column width gives it something to truncate against. */
	.tp-td :global(.inline-edit-span) {
		display: block;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* Editable cells are marked on hover or keyboard focus only (UI-17): a table where every
	   value is underlined reads as noise, and read-only (computed) cells carry no mark at all. */
	.tp-td :global(.inline-edit-span.editable),
	.tp-th :global(.inline-edit-span.editable) {
		text-decoration: none;
	}
	.tp-td :global(.inline-edit-span.editable:hover),
	.tp-td :global(.inline-edit-span.editable:focus-visible),
	.tp-th :global(.inline-edit-span.editable:hover),
	.tp-th :global(.inline-edit-span.editable:focus-visible) {
		text-decoration: underline;
		text-decoration-color: var(--color-lightness-50);
	}
	.tp-td :global(.inline-edit-span:not(.editable)) {
		cursor: default;
	}
	.tp-th :global(.inline-edit-span) {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		max-width: 100%;
		overflow: hidden;
		white-space: normal;
		/* Wrap at word boundaries ("Fragmented IV", not "Fragm / ented IV"). A single word longer
		   than a narrow column is hyphenated where the language allows ("Ray-leigh"), and only
		   then broken, rather than overflowing (UI-17). */
		overflow-wrap: break-word;
		hyphens: auto;
	}

	.tp-tr {
		display: grid;
		/* Fill the fixed-height VirtualList slot (rowH): a row only as tall as its text left a
		   strip between rows where the cell borders and the hover band broke off. */
		height: 100%;
		box-sizing: border-box;
	}

	.tp-tr:hover {
		background: var(--color-lightness-98);
	}

	.tp-td {
		padding: 4px 12px;
		border-bottom: 1px solid var(--color-lightness-90);
		border-right: 1px solid var(--color-lightness-90);
		overflow: hidden;
		min-width: 0; /* let the fixed grid track clip overflow rather than expand */
		display: flex;
		flex-direction: column;
		justify-content: center;
	}

	.tp-num {
		color: var(--color-text-muted);
		font-size: 0.8em;
		text-align: center;
		justify-content: center;
	}

	.tp-th:last-child,
	.tp-td:last-child {
		border-right: none;
	}

	.time-cell {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 1px;
		min-width: 0;
		max-width: 100%;
	}

	.computed-time {
		font-size: 0.75em;
		color: var(--color-text-muted);
		line-height: 1.1;
		padding-left: 4px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100%;
	}

	.null-value {
		/* "missing" vs "zero" is load-bearing in a data table, so this is real text
		   at 4.5:1, not a decorative marker. The old grey was 2.17:1. */
		color: var(--color-text-muted);
	}

	/* Read-only bodies (a plot's computed data, a node's results): plain text, not
	   Editable, so the header and cell text carry the same clamp and ellipsis directly. */
	.tp-th-text {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		max-width: 100%;
		overflow: hidden;
		white-space: normal;
		overflow-wrap: break-word;
		hyphens: auto;
	}
	.tp-cell-text {
		display: block;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tp-status {
		margin-left: var(--space-4);
		font-style: italic;
	}
	.tp-empty {
		color: var(--color-text-muted);
		font-style: italic;
	}

	/* The Source control: three equal segments that wrap their labels in a narrow panel. */
	.segmented {
		display: flex;
		width: 100%;
		border: 1px solid var(--color-lightness-85);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}
	.segmented label {
		flex: 1 1 0;
		min-width: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: var(--space-2) var(--space-3);
		font-size: var(--font-sm);
		line-height: 1.2;
		color: var(--color-lightness-35);
		cursor: pointer;
		user-select: none;
		background: var(--surface-card);
		transition:
			background 0.15s,
			color 0.15s;
	}
	.segmented label + label {
		border-left: 1px solid var(--color-lightness-85);
	}
	.segmented label:hover {
		background: var(--color-lightness-97);
	}
	.segmented label.active {
		background: var(--color-accent-fill);
		color: white;
		font-weight: 600;
	}
	.segmented label:focus-within {
		box-shadow: var(--shadow-focus-soft);
	}
	/* Visually hidden radios; the label carries the state. */
	.segmented input {
		position: absolute;
		opacity: 0;
		width: 1px;
		height: 1px;
		margin: 0;
		pointer-events: none;
	}

	.tableplot-row-bar {
		flex-shrink: 0;
		margin: 0.4rem 0 0;
		/* Same inset as the cells, so the count lines up with the column text and
		   does not sit on the border of a canvas node's preview. */
		padding: 0 12px;
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.display-list {
		width: 100%;
		margin-top: var(--space-2);
	}

	.clps-item {
		margin: 0.15rem 0;
	}

	.clps-title-container {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.35rem var(--space-4);
		border-radius: var(--radius-sm);
		cursor: pointer;
		user-select: none;
		transition: background 0.15s;
	}

	.clps-title-container:hover {
		background: var(--color-lightness-98);
	}

	.clps-title {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		flex: 1;
	}

	.clps-title input[type='checkbox'] {
		margin: 0;
	}

	.clps-title-button {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		opacity: 0.7;
	}

	.clps-item[open] .clps-title-container {
		font-weight: 500;
	}

	.tree-children {
		margin-left: 1.6rem;
		padding: 0.2rem 0;
	}

	.tree-item-child {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-xs);
	}

	.tree-item-child:hover {
		background: var(--color-lightness-98);
	}

	.tree-item-child.standalone {
		padding-left: 2.2rem; /* indent more to align under children */
	}

	.tree-name {
		font-size: 13.5px;
		color: var(--color-lightness-15);
	}

	.tree-badge {
		font-size: 9.5px;
		color: var(--color-text-muted);
		background: var(--color-lightness-92);
		padding: 1px 5px;
		border-radius: var(--radius-xs);
		margin-left: var(--space-4);
	}

	.empty-state {
		color: var(--color-lightness-40);
		font-size: var(--font-sm);
		margin: var(--space-6) var(--space-5);
		font-style: italic;
	}

	/* hide default summary arrow */
	.clps-item summary::-webkit-details-marker,
	.clps-item summary::marker {
		display: none;
	}
</style>
