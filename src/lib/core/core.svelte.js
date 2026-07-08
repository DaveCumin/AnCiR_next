// @ts-nocheck

import { Column, removeColumn } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { Process } from '$lib/core/Process.svelte';
import { TableProcess, deleteTableProcess } from '$lib/core/TableProcess.svelte';
import { getCachedProcessNodeGraph } from '$lib/core/ProcessNode.svelte.js';

export const core = $state({
	rawData: new Map(),
	data: [],
	plots: [],
	// tableProcesses — free-standing TableProcess instances. Each TP's outputs
	// live in core.data like any other column; the TP itself just declares its
	// input refs and runs its func() reactively.
	tableProcesses: [],
	storedValues: {},
	// chainRefs — consumer inputs wired via a plot's passthrough output port,
	// so the edge draws plot → consumer and follows the plot's own rewires.
	// Shape: { toId, toPort, viaPlotId, colId, channel, series } (see
	// core/chainRefs.js, the single consistency authority).
	chainRefs: [],
	// nodeNotes — per-node text annotations keyed by canvas node id (e.g.
	// `data_5`, `process_3`, `plot_2`, `note_1`). Plain string values.
	nodeNotes: {},
	// notes — standalone Note nodes spawnable via the palette. Plain objects
	// shaped like `{ id, text, x, y, width, height }`. They render as a node
	// on the canvas but have no input/output ports.
	notes: [],
	// groups — flowtest-style Source-group nodes. Each absorbs data columns as
	// internal source rows with dynamic output ports. Shape:
	// `{ id, name, x, y, width, height,
	//    sourceColumnIds: number[],        // column ids absorbed as rows; order = row order
	//    allColumnIds: number[] | null,    // subset filter for the 'all' port (null = all sources)
	//    collapsed: boolean,               // hide/show the sources list
	//    rowState: { [colId]: { expanded: boolean } }  // per-row mini-table expansion
	// }`.
	groups: [],
	// composites — folded sub-pipelines of operation nodes (process / tableprocess).
	// Members stay in the normal arrays; a composite just owns their node ids + the
	// auto-detected boundary interface. Shape:
	// `{ id, name, x, y, collapsed, originId,
	//    memberIds: string[],                       // graph node ids ('process_N' | 'tableprocess_N')
	//    interface: { inputs: Port[], outputs: Port[] } }`  // Port = { id, name, member, port }
	composites: [],
	// orphanProcesses — column processes spawned via the palette or paste that
	// haven't been wired up to a parent column yet. Each is a real Process
	// instance with parentCol = null. The canvas renders them with an input
	// port; dragging a wire from any column output to that port attaches the
	// process to that column (moves it out of this list into col.processes).
	orphanProcesses: [],
	// nodeLayout — workflow-canvas layout snapshot keyed by canvas node id
	// (`data_<colId>`, `process_<id>`, `tableprocess_<id>`, `plot_<id>`, group/
	// composite/note ids): `{ [id]: { x, y, collapsed? } }`. Maintained by
	// WorkflowEditor and serialised so a saved session restores node positions and
	// collapsed state on any machine (not just via per-browser localStorage).
	// `collapsed` is omitted for expanded nodes — absence means expanded (default).
	nodeLayout: {}
});

let _nextNoteId = 1;
export function createNote({ x = 80, y = 80, text = '' } = {}) {
	const id = `note_${_nextNoteId++}`;
	core.notes.push({ id, text, x, y, width: 200, height: 120 });
	return id;
}

export function removeNote(id) {
	core.notes = core.notes.filter((n) => n.id !== id);
	delete core.nodeNotes[id];
}

let _nextGroupId = 1;
export function createGroup({ x = 80, y = 80, name = 'Group' } = {}) {
	const id = `group_${_nextGroupId++}`;
	core.groups.push({
		id,
		name,
		x,
		y,
		width: 240,
		height: 180,
		sourceColumnIds: [],
		allColumnIds: null,
		collapsed: false,
		rowState: {}
	});
	return id;
}

export function removeGroup(id) {
	core.groups = core.groups.filter((g) => g.id !== id);
	// Absorbed columns aren't deleted — they resurface as standalone data_X
	// canvas nodes on the next derive. Just drop the per-group note if any.
	delete core.nodeNotes[id];
}

let _nextCompositeId = 1;
/** Fold a set of operation-node ids into a composite. Members stay in their
 *  normal arrays; the composite owns their ids + the boundary interface. */
export function createComposite({
	memberIds,
	interface: iface,
	x = 80,
	y = 80,
	name = 'Composite',
	originId = null
} = {}) {
	const id = `composite_${_nextCompositeId++}`;
	core.composites.push({
		id,
		name,
		x,
		y,
		collapsed: true,
		originId: originId ?? id,
		memberIds: [...(memberIds ?? [])],
		interface: iface ?? { inputs: [], outputs: [] }
	});
	return id;
}

/** Remove a composite (= "uncombine"). Members aren't deleted — they resurface
 *  as standalone canvas nodes on the next derive. */
export function removeComposite(id) {
	core.composites = core.composites.filter((c) => c.id !== id);
	delete core.nodeNotes[id];
}

/**
 * Advance the note/group/composite id counters past any ids already present in
 * core. Session import pushes loaded nodes directly (not via create*), so
 * without this the next createGroup() can mint an id (`group_3`) that collides
 * with a loaded one and overwrites it. Only plain `group_<n>`/`composite_<n>`/
 * `note_<n>` ids participate; legacy `group_legacy_<n>` ids live in a separate
 * namespace and are intentionally ignored. Idempotent; safe to call any time.
 */
export function syncNodeIdCounters() {
	const maxSuffix = (arr, re) => {
		let m = 0;
		for (const item of arr ?? []) {
			const match = re.exec(item?.id ?? '');
			if (match) m = Math.max(m, Number(match[1]));
		}
		return m;
	};
	_nextNoteId = Math.max(_nextNoteId, maxSuffix(core.notes, /^note_(\d+)$/) + 1);
	_nextGroupId = Math.max(_nextGroupId, maxSuffix(core.groups, /^group_(\d+)$/) + 1);
	_nextCompositeId = Math.max(
		_nextCompositeId,
		maxSuffix(core.composites, /^composite_(\d+)$/) + 1
	);
}

/** Remove a free-standing TableProcess by id. Cleanup of its output columns
 *  is handled by deleteTableProcess in TableProcess.svelte. */
export function removeFreeTableProcess(id) {
	core.tableProcesses = core.tableProcesses.filter((tp) => tp.id !== id);
	delete core.nodeNotes[`tableprocess_${id}`];
}

/**
 * Create a Process with no parent column. The new process lands in
 * core.orphanProcesses and renders on the canvas as a free-standing node
 * with an `input` port the user can wire to. When wired, the canvas moves
 * the process from orphans into the target column's processes[] chain.
 *
 * Returns the new Process instance (so the caller can pin its canvas
 * position via stablePositions[`process_${proc.id}`]).
 */
export function createOrphanProcess(name, args = {}) {
	if (!name) return null;
	const proc = new Process({ name, args }, null);
	core.orphanProcesses = [...core.orphanProcesses, proc];
	return proc;
}

/** Remove an orphan process by id. Used by the delete handler. */
export function removeOrphanProcess(id) {
	core.orphanProcesses = core.orphanProcesses.filter((p) => p.id !== id);
	delete core.nodeNotes[`process_${id}`];
}

function _procInputIds(proc) {
	const raw = proc?.args?.inIN;
	if (Array.isArray(raw)) return raw.filter((id) => typeof id === 'number' && id >= 0);
	return typeof raw === 'number' && raw >= 0 ? [raw] : [];
}

// Reroute a downstream free process's input oldColId → newColId and re-key its
// paired producer column (out_old → out_new) so its output survives.
function _rerouteProcessInput(targetProcId, oldColId, newColId) {
	const tproc = (core.orphanProcesses ?? []).find((p) => p.id === targetProcId);
	if (!tproc) return;
	const cur = _procInputIds(tproc);
	const idx = cur.indexOf(oldColId);
	if (idx < 0) return;
	const next = [...cur];
	next[idx] = newColId;
	tproc.args = { ...tproc.args, inIN: next };
	const pc = core.data.find(
		(c) =>
			c.producerNodeId === `process_${targetProcId}` && (c.producerPort || '') === `out_${oldColId}`
	);
	if (pc) pc.producerPort = `out_${newColId}`;
}

/**
 * Delete an operation node (free process or table-process) from anywhere — the
 * canvas removeNode handler and the Data panel both route here so behaviour
 * stays identical. A free 1:1 process is bridged (its output's consumers re-point
 * to its input source) rather than severed; a table-process removes via the
 * existing helper.
 */
export function deleteOperationNode(node) {
	if (!node) return;
	if (node.type === 'tableprocess' && node.tpObj) {
		deleteTableProcess(node.tpObj);
		return;
	}
	if (node.type === 'process') {
		const proc = (core.orphanProcesses ?? []).find((p) => p.id === node.refId);
		if (!proc) return;
		const inputs = _procInputIds(proc);
		const producerCols = (core.data ?? []).filter((c) => c.producerNodeId === node.id);
		// Bridge a 1:1 node: re-point every consumer of its output to its input.
		if (inputs.length === 1 && producerCols.length === 1) {
			const sourceColId = inputs[0];
			const outColId = producerCols[0].id;
			replaceColumnRefs(sourceColId, outColId);
			for (const op of [...(core.orphanProcesses ?? [])]) {
				if (op.id === proc.id) continue;
				if (_procInputIds(op).includes(outColId)) {
					_rerouteProcessInput(op.id, outColId, sourceColId);
				}
			}
		}
		for (const c of producerCols) removeColumn(c.id);
		removeOrphanProcess(node.refId);
	}
}

/**
 * Move an orphan process out of core.orphanProcesses and onto a column's
 * processes chain. No-op if the process isn't in orphans (e.g. already
 * attached). Returns true on success.
 */
export function attachOrphanProcessToColumn(processId, columnId) {
	const idx = core.orphanProcesses.findIndex((p) => p.id === processId);
	if (idx < 0) return false;
	const col = core.data.find((c) => c.id === columnId);
	if (!col) return false;
	const proc = core.orphanProcesses[idx];
	core.orphanProcesses = [
		...core.orphanProcesses.slice(0, idx),
		...core.orphanProcesses.slice(idx + 1)
	];
	proc.parentCol = col;
	col.processes = [...(col.processes ?? []), proc];
	return true;
}

/** Add colId to groupId's sources (and remove from any other group). */
export function absorbColumnIntoGroup(colId, groupId) {
	for (const g of core.groups ?? []) {
		const has = (g.sourceColumnIds ?? []).includes(colId);
		if (g.id === groupId && !has) {
			g.sourceColumnIds = [...(g.sourceColumnIds ?? []), colId];
		} else if (g.id !== groupId && has) {
			g.sourceColumnIds = (g.sourceColumnIds ?? []).filter((id) => id !== colId);
			if (Array.isArray(g.allColumnIds)) {
				g.allColumnIds = g.allColumnIds.filter((id) => id !== colId);
			}
		}
	}
}

/** Remove colId from every group's sources list. Returns the group it left, or null. */
export function extractColumnFromAnyGroup(colId) {
	let left = null;
	for (const g of core.groups ?? []) {
		if ((g.sourceColumnIds ?? []).includes(colId)) {
			g.sourceColumnIds = g.sourceColumnIds.filter((id) => id !== colId);
			if (Array.isArray(g.allColumnIds)) {
				g.allColumnIds = g.allColumnIds.filter((id) => id !== colId);
			}
			if (g.rowState && colId in g.rowState) {
				delete g.rowState[colId];
			}
			left = g;
		}
	}
	return left;
}

export const appState = $state({
	currentTab: initialiseCurrentTab(false, false), // change values if panel visibility initialised differently
	currentControlTab: 'properties',

	loadingState: {
		isLoading: true,
		loadingMsg: 'Warming up...'
	},

	showNavbar: true,
	showDisplayPanel: false,
	showControlPanel: false,

	// Bumped to request a one-shot workflow auto-tidy (e.g. after the demo seed);
	// WorkflowEditor watches this counter. Pre-declared so the effect subscribes.
	tidyLayoutRequest: 0,

	// One-shot request to spawn a table-process node on the workflow canvas from
	// OUTSIDE it (e.g. the worksheet's "Simulate data" empty-state). Shape:
	// { tpType: 'SimulatedData', n }. Set it together with view = 'canvas';
	// WorkflowEditor consumes it once (spawns the node) then clears it back to
	// null, so re-mounting the canvas never re-spawns. Pre-declared so the
	// effect subscribes.
	spawnNodeRequest: null,

	windowWidth: window.innerWidth,
	windowHeight: window.innerHeight,
	widthNavBar: 56,
	widthDisplayPanel: 250,
	widthControlPanel: 250,

	gridSize: 15,
	canvasOffset: { x: 0, y: 0 },
	canvasScale: 1.0,

	// 'canvas' (default): WorkflowEditor renders inline as the centre pane.
	// 'plots': legacy free-positioned PlotDisplay grid.
	view: 'canvas',

	// IANA timezone name used for all user-visible date/time formatting and
	// for parsing values typed into <input type="datetime-local"> controls.
	// Defaults to UTC; change to e.g. 'Pacific/Auckland' to localise.
	displayTimezone: 'utc',

	invisiblePlotIds: [],

	// id of the currently selected canvas node (process/tableprocess/data/
	// group/note/plot). `null` when nothing is focused. This is the SINGLE
	// source of truth for the focused node: WorkflowEditor reads/writes it
	// directly (no local mirror), and the side panels (DataDisplay,
	// NodeSourceItem, Navbar, CanvasNodeControls) write it to drive selection
	// from outside the canvas. Plot selection still flows through
	// core.plots[].selected for backwards compat, but this is set in parallel.
	canvasSelectedNodeId: null,
	// Count of nodes in the multi-select set. >1 → ControlPanel shows a
	// "X nodes selected" placeholder instead of a single-node editor.
	canvasMultiSelectedCount: 0,
	// Canvas node ids currently in the multi-select set (e.g. 'plot_3',
	// 'process_7'). Mirrored from WorkflowEditor's local Set so other parts of
	// the UI (ControlPanel, Navbar view-switch) can react. One-way:
	// WorkflowEditor writes, others read; mutate it via Plot.svelte helpers
	// (which signal back through this same field).
	canvasMultiSelectedNodeIds: [],

	appColours: [
		'#234154',
		'#BE796B',
		'#3E7295',
		'#EDADAD',
		'#A6ACD5',
		'#83422A',
		'#6B9FD5',
		'#4A1E0E',
		'#fbe67280' // transparrent yellow for light
	],
	showColourPicker: false,

	showAYSModal: false, // AreYouSure modal
	AYStext: '',
	AYScallback: null,
	AYSoptions: ['Yes', 'No'],

	showWorkflow: false
});

export const appConsts = $state({
	version: 'β.51.7',
	processMap: new Map(),
	plotMap: new Map(),
	tableProcessMap: new Map(),
	timeoutRefresh_ms: 20,
	colourPalettes: {
		batlowk: [
			'#04050A',
			'#FACCFA',
			'#4F6657',
			'#FDB9BF',
			'#6F7845',
			'#F6A986',
			'#A18E38',
			'#D89E50'
		],
		devon: ['#2C1A4C', '#3669AD', '#D0CCF5', '#6181D0', '#BAB3F1', '#989BE7', '#275186', '#E8E5FA'],
		glasgow: [
			'#361338',
			'#A6BED8',
			'#6B260B',
			'#74A9B0',
			'#716311',
			'#DBD3FF',
			'#687C48',
			'#60927D'
		],
		lipari: [
			'#031326',
			'#E9C99F',
			'#13385A',
			'#E7A279',
			'#47587A',
			'#BC6461',
			'#6B5F76',
			'#8E616C'
		],
		oslo: ['#010101', '#D4D6DB', '#133251', '#AAB6CA', '#1F4C7B', '#89A0CA', '#3869A8', '#658AC7'],
		berlin: ['#234154', '#BE796B', '#3E7295', '#EDADAD', '#A6ACD5', '#83422A', '#6B9FD5', '#4A1E0E']
	}
});

function initialiseCurrentTab(showDisplayPanel, showControlPanel) {
	if (!showDisplayPanel && !showControlPanel) return 'null';
	return 'data';
}

// Keys that should never be restored from a saved session:
// viewport dimensions are runtime values; showColourPicker is transient UI state.
const LOAD_APP_STATE_SKIP_KEYS = new Set([
	'loadingState',
	'windowWidth',
	'windowHeight',
	'showColourPicker'
]);

export function loadAppState(newAppState) {
	for (const key in newAppState) {
		if (key in appState && !LOAD_APP_STATE_SKIP_KEYS.has(key)) {
			appState[key] = newAppState[key];
		}
	}
}

export function pushObj(obj, autoPosition = true) {
	if (obj instanceof Column) {
		core.data.push(obj);
		void obj.hoursSinceStart; // eagerly compute while spinner is showing
		// console.log('Pushed column with id', obj.id, 'and name', obj.name);
	} else if (obj instanceof TableProcess) {
		core.tableProcesses.push(obj);
	} else if (obj instanceof Plot) {
		if (autoPosition) {
			const pos = findNextAvailablePosition(core.plots);
			const container = document.getElementsByClassName('canvas')[0];
			if (container) {
				obj.x = pos.x + container.scrollLeft;
				obj.y = pos.y + container.scrollTop;
			}
		}
		//now do sizing
		if (obj.type === 'scatterplot') {
			obj.width = obj.width ?? snapToGrid(500);
			obj.height = obj.height ?? snapToGrid(300);
		} else if (obj.type === 'periodogram') {
			obj.width = obj.width ?? snapToGrid(400);
			obj.height = obj.height ?? snapToGrid(250);
		} else if (obj.type === 'actogram') {
			obj.width = obj.width ?? snapToGrid(500);
			obj.height = obj.height ?? snapToGrid(600);
		}

		core.plots.push(obj);
	} else {
		console.warn('Error: object not instance of Column, Table or Plot');
	}
}

/**
 * Return a unique stored-value name by appending a counter if needed.
 * e.g. if "trend_slope" exists, returns "trend_slope_2", then "_3", etc.
 */
export function uniqueStoredValueName(base) {
	if (!(base in core.storedValues)) return base;
	let n = 2;
	while (`${base}_${n}` in core.storedValues) n++;
	return `${base}_${n}`;
}

/**
 * Store a named scalar value so it can be referenced later in formulas.
 * The getter maintains a live reference so the value auto-updates when the
 * source computation changes (e.g. markers move → τ updates).
 * @param {string} name     – user-visible name (e.g. "cosinor_amplitude")
 * @param {() => number} getter – function returning the current value
 * @param {string} [source] – optional description of where it came from
 */
export function storeValue(name, getter, source = '') {
	core.storedValues[name] = { getter, source };
}

/**
 * Store a named REFERENCE to a metric output port cell: `{ tpId, outKey, yId,
 * index }` picks one value out of a table process's metric out-column (one
 * value per y input, in yIN order). Unlike getter entries, refs live in core —
 * they are not tied to any component's lifetime, they serialize, and they
 * restore on session import.
 * @param {string} name
 * @param {{tpId: number, outKey: string, yId?: number|null, index?: number}} ref
 * @param {string} [source]
 */
export function storeValueRef(name, ref, source = '') {
	core.storedValues[name] = { ref: { ...ref }, source };
}

/**
 * Resolve a metric-port ref to its current value. Prefers yId (robust to yIN
 * reorder); falls back to a fixed index (e.g. GroupComparison's single-value
 * multi-Y mode). Returns NaN when the node/column/series is gone.
 */
export function resolveStoredValueRef(ref) {
	if (!ref) return NaN;
	const tp = (core.tableProcesses ?? []).find((t) => t.id === ref.tpId);
	const colId = tp?.args?.out?.[ref.outKey];
	if (colId == null || colId === -1) return NaN;
	const data = core.rawData.get(colId);
	if (!Array.isArray(data)) return NaN;
	let idx = 0;
	if (ref.yId != null) {
		const yIN = tp.args.yIN;
		const yINs = Array.isArray(yIN) ? yIN : yIN != null && yIN !== -1 ? [yIN] : [];
		idx = yINs.indexOf(ref.yId);
		if (idx === -1) return NaN;
	} else if (Number.isFinite(ref.index)) {
		idx = ref.index;
	}
	const v = data[idx];
	return typeof v === 'number' ? v : NaN;
}

/**
 * Resolve the current numeric value of a stored value entry.
 * Ref entries resolve live from their metric output column; getter entries
 * call the live getter; both fall back to a static snapshot (used after
 * deserialisation when neither resolves).
 */
export function getStoredValue(name) {
	const entry = core.storedValues[name];
	if (!entry) return NaN;
	if (entry.ref) {
		const v = resolveStoredValueRef(entry.ref);
		return Number.isFinite(v) ? v : (entry.staticValue ?? v);
	}
	if (typeof entry.getter === 'function') {
		try {
			return entry.getter();
		} catch (e) {
			console.warn(`Stored value '${name}' getter failed:`, e.message);
			return entry.staticValue ?? NaN;
		}
	}
	return entry.staticValue ?? NaN;
}

/** Remove a stored value by name. */
export function removeStoredValue(name) {
	delete core.storedValues[name];
}

/**
 * Rewrite every consumer reference to a renamed stored value so formulas keep
 * working: FormulaColumn `{type:'stored', key}` tokens, BlankColumn
 * `storedValueRefs` (row → key), and StoredValueGroup `groups[].keys`.
 * Shared by renameStoredValue below and the undo/redo op (operations.js), so
 * both directions of an undo propagate symmetrically.
 */
export function propagateStoredValueRename(oldName, newName) {
	if (oldName === newName) return;
	for (const tp of core.tableProcesses ?? []) {
		const args = tp?.args;
		if (!args) continue;
		if (Array.isArray(args.tokens)) {
			for (const t of args.tokens) {
				if (t?.type === 'stored' && t.key === oldName) t.key = newName;
			}
		}
		if (args.storedValueRefs && typeof args.storedValueRefs === 'object') {
			for (const [idx, key] of Object.entries(args.storedValueRefs)) {
				if (key === oldName) args.storedValueRefs[idx] = newName;
			}
		}
		if (Array.isArray(args.groups)) {
			for (const g of args.groups) {
				if (!Array.isArray(g?.keys)) continue;
				for (let i = 0; i < g.keys.length; i++) {
					if (g.keys[i] === oldName) g.keys[i] = newName;
				}
			}
		}
	}
}

/** Rename a stored value (updating formula references), returning the new name. */
export function renameStoredValue(oldName, newName) {
	if (oldName === newName || !(oldName in core.storedValues)) return oldName;
	const finalName = uniqueStoredValueName(newName);
	core.storedValues[finalName] = core.storedValues[oldName];
	delete core.storedValues[oldName];
	propagateStoredValueRename(oldName, finalName);
	return finalName;
}

export function snapToGrid(value) {
	return Math.round(value / appState.gridSize) * appState.gridSize;
}

// TODO: change to grid* layout
function findNextAvailablePosition(existingPlots) {
	const baseX = 10;
	const baseY = 20;
	const offsetX = 40;
	const offsetY = 40;

	// Scan from zero each call; restarting avoids unbounded drift once plots
	// are deleted and prior slots become free again.
	for (let attempt = 0; attempt < 1000; attempt++) {
		const x = snapToGrid(baseX + attempt * offsetX);
		const y = snapToGrid(baseY + attempt * offsetY);
		const collision = existingPlots.some((p) => Math.abs(p.x - x) < 30 && Math.abs(p.y - y) < 30);
		if (!collision) return { x, y };
	}
	return { x: snapToGrid(baseX), y: snapToGrid(baseY) };
}

/**
 * Union of scalar / array column-ID field names across every registered
 * tableProcess. Each tableProcess declares its own columnIdFields on its
 * definition (see each TP's `export const definition`); this function
 * collects them so the generic ref-rewriting helpers don't need a
 * central hardcoded registry. Called lazily to give tableProcessMap time
 * to populate during module init.
 */
function _getColIdFieldSets() {
	const scalar = new Set();
	const array = new Set();
	const map = appConsts.tableProcessMap;
	if (map && typeof map.values === 'function') {
		for (const entry of map.values()) {
			const fields = entry?.definition?.columnIdFields ?? entry?.columnIdFields;
			if (!fields) continue;
			for (const f of fields.scalar ?? []) scalar.add(f);
			for (const f of fields.array ?? []) array.add(f);
		}
	}
	return { scalar, array };
}

/**
 * Replace all downstream references to `oldColId` with `newColId`.
 * Updates: column refIds, table-process input args and output args,
 * table columnRefs, and plot data refs.
 */
export function replaceColumnRefs(newColId, oldColId) {
	if (newColId === oldColId) return;

	core.data.forEach((col) => {
		if (col.refId === oldColId) col.refId = newColId;
	});

	// A single-entry remap: same walker as the bulk swap path, so scalar/array/
	// out/nested-TP handling can't drift between the two.
	const map = new Map([[oldColId, newColId]]);
	core.tableProcesses.forEach((tp) => {
		_remapInTPArgs(tp.args, map);
	});

	core.plots.forEach((plot) => {
		if (plot.type === 'tableplot') {
			if (plot.plot.columnRefs) {
				plot.plot.columnRefs = plot.plot.columnRefs.map((id) => (id === oldColId ? newColId : id));
			}
		} else {
			plot.plot.data?.forEach((d) => {
				['x', 'y', 'z'].forEach((axis) => {
					if (d[axis]?.refId === oldColId) d[axis].refId = newColId;
				});
			});
		}
	});
}

/**
 * Atomically swap all downstream references between two column IDs.
 * Uses a temporary sentinel (one below the minimum real column ID) so
 * the three-step A→temp, B→A, temp→B pattern cannot collide with any
 * existing column ID.
 */
export function swapColumnRefs(idA, idB) {
	if (idA === idB) return;
	// Pick a sentinel that cannot be a real column ID
	const allIds = core.data.map((c) => c.id);
	const TEMP_ID = allIds.length ? Math.min(...allIds) - 1 : -1;
	replaceColumnRefs(TEMP_ID, idA);
	replaceColumnRefs(idA, idB);
	replaceColumnRefs(idB, TEMP_ID);
}

/**
 * Walk a TP args tree applying an id→id swap map in-place.
 * Each slot is visited once, so a single map holding {a→b, b→a} yields
 * the same atomic swap as the 3-phase temp-id approach.
 */
function _remapInTPArgs(args, map) {
	if (!args || typeof args !== 'object') return;

	const { scalar, array } = _getColIdFieldSets();

	for (const field of scalar) {
		const v = args[field];
		if (typeof v === 'number' && map.has(v)) args[field] = map.get(v);
	}

	for (const field of array) {
		const arr = args[field];
		if (Array.isArray(arr)) {
			for (let i = 0; i < arr.length; i++) {
				if (map.has(arr[i])) arr[i] = map.get(arr[i]);
			}
		}
	}

	if (args.out && typeof args.out === 'object') {
		for (const key of Object.keys(args.out)) {
			if (map.has(args.out[key])) args.out[key] = map.get(args.out[key]);
		}
	}

	if (Array.isArray(args.tableProcesses)) {
		for (const nested of args.tableProcesses) {
			if (nested?.args) _remapInTPArgs(nested.args, map);
		}
	}
}

/**
 * Atomically swap all downstream references for multiple column pairs in a
 * single pass over core.data / tables / plots.
 * @param {Array<[number, number]>} pairs - array of [fromId, toId] pairs to swap
 */
export function swapColumnRefsBulk(pairs) {
	if (!pairs.length) return;
	const valid = pairs.filter(([a, b]) => a !== b && a >= 0 && b >= 0);
	if (!valid.length) return;

	const map = new Map();
	for (const [a, b] of valid) {
		map.set(a, b);
		map.set(b, a);
	}

	core.data.forEach((col) => {
		if (map.has(col.refId)) col.refId = map.get(col.refId);
	});

	core.tableProcesses.forEach((tp) => _remapInTPArgs(tp.args, map));

	core.plots.forEach((plot) => {
		if (plot.type === 'tableplot') {
			const refs = plot.plot.columnRefs;
			if (refs) {
				for (let i = 0; i < refs.length; i++) {
					if (map.has(refs[i])) refs[i] = map.get(refs[i]);
				}
			}
		} else {
			plot.plot.data?.forEach((d) => {
				for (const axis of ['x', 'y', 'z']) {
					if (d[axis] && map.has(d[axis].refId)) d[axis].refId = map.get(d[axis].refId);
				}
			});
		}
	});
}

export function outputCoreAsJson() {
	let coreOut = JSON.parse(
		JSON.stringify(core, (key, val) => (typeof val === 'function' ? undefined : val))
	);
	coreOut.rawData = Object.fromEntries(core.rawData);
	// Resolve live getters into static snapshots for serialisation. Ref entries
	// (metric-port refs) additionally keep the ref itself so they re-resolve
	// live after import; the snapshot doubles as a fallback (and feeds the
	// Python export, which reads staticValue).
	const resolvedSV = {};
	for (const [name, entry] of Object.entries(core.storedValues)) {
		resolvedSV[name] = {
			source: entry.source,
			...(entry.ref ? { ref: { ...entry.ref } } : {}),
			staticValue: getStoredValue(name)
		};
	}
	coreOut.storedValues = resolvedSV;
	const output = { ...coreOut, appState, version: appConsts.version };
	return JSON.stringify(output, null, 2);
}

/**
 * Normalized workflow graph view (cached by core topology/data hash).
 * Keeps graph derivation out of UI components.
 */
export function getProcessNodeGraph() {
	return getCachedProcessNodeGraph(core, appConsts);
}
