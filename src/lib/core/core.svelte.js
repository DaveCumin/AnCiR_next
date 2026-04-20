// @ts-nocheck

import { Column } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core//Plot.svelte';
import { Table } from '$lib/core//Table.svelte';
import * as jsonpatch from 'fast-json-patch';

export const core = $state({
	rawData: new Map(),
	data: [],
	plots: [],
	tables: [],
	storedValues: {}
});

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

	windowWidth: window.innerWidth,
	windowHeight: window.innerHeight,
	widthNavBar: 56,
	widthDisplayPanel: 250,
	widthControlPanel: 250,

	gridSize: 15,
	canvasOffset: { x: 0, y: 0 },
	canvasScale: 1.0,

	invisiblePlotIds: [],

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
	version: 'β.27.8',
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
	} else if (obj instanceof Table) {
		core.tables.push(obj);
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
 * Resolve the current numeric value of a stored value entry.
 * Calls the live getter when available; falls back to a static snapshot
 * (used after deserialisation when no getter exists).
 */
export function getStoredValue(name) {
	const entry = core.storedValues[name];
	if (!entry) return NaN;
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

/** Rename a stored value, returning the new name. */
export function renameStoredValue(oldName, newName) {
	if (oldName === newName || !(oldName in core.storedValues)) return oldName;
	const finalName = uniqueStoredValueName(newName);
	core.storedValues[finalName] = core.storedValues[oldName];
	delete core.storedValues[oldName];
	return finalName;
}

/** Show an error modal with a single OK button. */
export function showError(message) {
	appState.AYStext = message;
	appState.AYScallback = null;
	appState.AYSoptions = ['OK'];
	appState.showAYSModal = true;
}

/** Show an "Are you sure?" confirmation modal. */
export function showAYS(text, callback, options = ['Yes', 'No']) {
	appState.AYStext = text;
	appState.AYScallback = callback;
	appState.AYSoptions = options;
	appState.showAYSModal = true;
}

export function snapToGrid(value) {
	return Math.round(value / appState.gridSize) * appState.gridSize;
}

// TODO: change to grid* layout
let _attempt = 0;
function findNextAvailablePosition(existingPlots) {
	const baseX = 10;
	const baseY = 20;
	const offsetX = 40;
	const offsetY = 40;

	while (true) {
		const rawX = baseX + _attempt * offsetX;
		const rawY = baseY + _attempt * offsetY;

		const x = snapToGrid(rawX);
		const y = snapToGrid(rawY);

		const collision = existingPlots.some((p) => Math.abs(p.x - x) < 30 && Math.abs(p.y - y) < 30);

		if (!collision) {
			return { x, y };
		}

		_attempt++;
	}
}

/**
 * The set of TP args fields that hold a single column ID (scalar).
 * Add to this list when new TPs introduce non-standard column-ID fields.
 */
const _SCALAR_COLID_FIELDS = new Set([
	'xIN',
	'yIN', // legacy scalar; modern TPs use array — handled below too
	'categoryIN', // LongToWide
	'timeIN', // LongToWide, WideToLong
	'valueIN' // LongToWide
]);

/**
 * The set of TP args fields that hold an *array* of column IDs.
 */
const _ARRAY_COLID_FIELDS = new Set([
	'yIN', // BinnedData, Cosinor, etc. (modern array form)
	'xsIN',
	'valueColIds', // WideToLong
	'colIds', // CollectColumns
	'outColIds' // CollectColumns
]);

/**
 * Recursively replace `oldColId` with `newColId` inside a TP's args object,
 * including nested tableProcesses.
 */
function _replaceInTPArgs(args, oldColId, newColId) {
	if (!args || typeof args !== 'object') return;

	// Scalar column-ID fields
	for (const field of _SCALAR_COLID_FIELDS) {
		if (typeof args[field] === 'number' && args[field] === oldColId) {
			args[field] = newColId;
		}
	}

	// Array column-ID fields
	for (const field of _ARRAY_COLID_FIELDS) {
		if (Array.isArray(args[field])) {
			args[field] = args[field].map((id) => (id === oldColId ? newColId : id));
		}
	}

	// Output map (object with column ID values)
	if (args.out && typeof args.out === 'object') {
		for (const key of Object.keys(args.out)) {
			if (args.out[key] === oldColId) args.out[key] = newColId;
		}
	}

	// Recurse into nested tableProcesses (e.g. bin/cosinor inside L2W)
	if (Array.isArray(args.tableProcesses)) {
		for (const nested of args.tableProcesses) {
			if (nested?.args) _replaceInTPArgs(nested.args, oldColId, newColId);
		}
	}
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

	core.tables.forEach((table) => {
		table.columnRefs = table.columnRefs.map((id) => (id === oldColId ? newColId : id));
		table.processes.forEach((tp) => {
			_replaceInTPArgs(tp.args, oldColId, newColId);
		});
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
 * Atomically swap all downstream references for multiple column pairs.
 * @param {Array<[number, number]>} pairs - array of [fromId, toId] pairs to swap
 */
export function swapColumnRefsBulk(pairs) {
	if (!pairs.length) return;
	const valid = pairs.filter(([a, b]) => a !== b && a >= 0 && b >= 0);
	if (!valid.length) return;

	const allIds = core.data.map((c) => c.id);
	let tempBase = allIds.length ? Math.min(...allIds) - 1 : -1;

	// Assign a unique temp ID per pair
	const temps = valid.map(() => tempBase--);

	// Phase 1: move all "from" refs to temp IDs
	valid.forEach(([from], i) => replaceColumnRefs(temps[i], from));
	// Phase 2: move all "to" refs to the corresponding "from" slots
	valid.forEach(([from, to]) => replaceColumnRefs(from, to));
	// Phase 3: move temp IDs into the "to" slots
	valid.forEach(([, to], i) => replaceColumnRefs(to, temps[i]));
}

export function outputCoreAsJson() {
	let coreOut = JSON.parse(
		JSON.stringify(core, (key, val) => (typeof val === 'function' ? undefined : val))
	);
	coreOut.rawData = Object.fromEntries(core.rawData);
	// Resolve live getters into static snapshots for serialisation
	const resolvedSV = {};
	for (const [name, entry] of Object.entries(core.storedValues)) {
		resolvedSV[name] = {
			source: entry.source,
			staticValue: getStoredValue(name)
		};
	}
	coreOut.storedValues = resolvedSV;
	const output = { ...coreOut, appState, version: appConsts.version };
	return JSON.stringify(output, null, 2);
}

/** Returns a plain-object snapshot of core (no class instances). */
export function getCoreAsPlainObject() {
	const snap = JSON.parse(
		JSON.stringify(core, (key, val) => (typeof val === 'function' ? undefined : val))
	);
	snap.rawData = Object.fromEntries(core.rawData);
	// Resolve live getters into static snapshots
	const resolvedSV = {};
	for (const [name, entry] of Object.entries(core.storedValues)) {
		resolvedSV[name] = {
			source: entry.source,
			staticValue: getStoredValue(name)
		};
	}
	snap.storedValues = resolvedSV;
	return snap;
}

/**
 * Applies a JSON Patch (RFC 6902 array) to core in-place,
 * reconciling only the changed arrays/maps so Svelte only
 * re-renders the affected components.
 */
export function applyPatchToCore(patch) {
	// Work on a plain snapshot of the current state
	const snap = getCoreAsPlainObject();

	// Apply the patch to the snapshot
	jsonpatch.applyPatch(snap, patch);

	// --- Reconcile rawData ---
	const patchedRawData = snap.rawData ?? {};
	// Remove keys that no longer exist
	for (const key of core.rawData.keys()) {
		if (!(String(key) in patchedRawData)) {
			core.rawData.delete(key);
		}
	}
	// Add/update keys
	for (const [k, v] of Object.entries(patchedRawData)) {
		core.rawData.set(+k, v);
	}

	// --- Reconcile core.data (columns) by id ---
	const patchedDataIds = (snap.data ?? []).map((c) => c.id);
	// Remove stale columns
	core.data = core.data.filter((col) => patchedDataIds.includes(col.id));
	// Update existing or add new
	for (const colSnap of snap.data ?? []) {
		const existing = core.data.find((c) => c.id === colSnap.id);
		if (existing) {
			// Update mutable properties in-place
			existing.customName = colSnap.name ?? null;
			existing.refId = colSnap.refId ?? null;
			existing.data = colSnap.data ?? null;
			existing.compression = colSnap.compression ?? null;
			existing.timeFormat = colSnap.timeFormat ?? [];
			existing.tableProcessGUId = colSnap.tableProcessGUId ?? '';
			// Reconcile processes by id
			const patchedProcIds = (colSnap.processes ?? []).map((p) => p.id);
			existing.processes = existing.processes.filter((p) => patchedProcIds.includes(p.id));
			for (const pSnap of colSnap.processes ?? []) {
				const ep = existing.processes.find((p) => p.id === pSnap.id);
				if (ep) {
					ep.name = pSnap.name;
					ep.displayName = pSnap.displayName ?? ep.displayName;
					ep.args = pSnap.args ?? ep.args;
				} else {
					// New process — re-import via Column.fromJSON for a single process
					const tmpCol = Column.fromJSON({ ...colSnap, processes: [pSnap] });
					existing.processes.push(tmpCol.processes[0]);
				}
			}
		} else {
			// Entirely new column
			core.data.push(Column.fromJSON(colSnap));
		}
	}

	// --- Reconcile core.tables by id ---
	const patchedTableIds = (snap.tables ?? []).map((t) => t.id);
	core.tables = core.tables.filter((t) => patchedTableIds.includes(t.id));
	for (const tableSnap of snap.tables ?? []) {
		const existing = core.tables.find((t) => t.id === tableSnap.id);
		if (existing) {
			existing.name = tableSnap.name;
			existing.columnRefs = tableSnap.columnRefs ?? [];
			// Reconcile table processes
			const patchedTPIds = (tableSnap.processes ?? []).map((p) => p.id);
			existing.processes = existing.processes.filter((p) => patchedTPIds.includes(p.id));
			for (const pSnap of tableSnap.processes ?? []) {
				const ep = existing.processes.find((p) => p.id === pSnap.id);
				if (ep) {
					ep.name = pSnap.name;
					ep.displayName = pSnap.displayName ?? ep.displayName;
					ep.args = pSnap.args ?? ep.args;
				} else {
					const tmpTable = Table.fromJSON({ ...tableSnap, processes: [pSnap] });
					existing.processes.push(tmpTable.processes[0]);
				}
			}
		} else {
			core.tables.push(Table.fromJSON(tableSnap));
		}
	}

	// --- Reconcile core.plots by id ---
	const patchedPlotIds = (snap.plots ?? []).map((p) => p.id);
	core.plots = core.plots.filter((p) => patchedPlotIds.includes(p.id));
	for (const plotSnap of snap.plots ?? []) {
		const existing = core.plots.find((p) => p.id === plotSnap.id);
		if (existing) {
			existing.name = plotSnap.name;
			existing.x = plotSnap.x;
			existing.y = plotSnap.y;
			existing.width = plotSnap.width;
			existing.height = plotSnap.height;
			existing.selected = plotSnap.selected;
			// Re-hydrate the inner plot data from JSON
			const plotTypeEntry = appConsts.plotMap.get(existing.type);
			if (plotTypeEntry?.data?.fromJSON) {
				existing.plot = plotTypeEntry.data.fromJSON(existing, plotSnap.plot);
			}
		} else {
			core.plots.push(Plot.fromJSON(plotSnap));
		}
	}

	// --- Reconcile core.storedValues ---
	core.storedValues = snap.storedValues ?? {};
}
