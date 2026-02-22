// @ts-nocheck

import { Column } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core//Plot.svelte';
import { Table } from '$lib/core//Table.svelte';
import * as jsonpatch from 'fast-json-patch';

export const core = $state({
	rawData: new Map(),
	data: [],
	plots: [],
	tables: []
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

	showWorkflow: false
});

export const appConsts = $state({
	version: 'β.8.1',
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

export function loadAppState(newAppState) {
	for (const key in newAppState) {
		if (key in appState && key !== 'loadingState') {
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
			if (tp.args.xIN === oldColId) tp.args.xIN = newColId;
			if (tp.args.yIN === oldColId) tp.args.yIN = newColId;
			if (Array.isArray(tp.args.xsIN)) {
				tp.args.xsIN = tp.args.xsIN.map((id) => (id === oldColId ? newColId : id));
			}
			if (tp.args.out) {
				Object.keys(tp.args.out).forEach((key) => {
					if (tp.args.out[key] === oldColId) tp.args.out[key] = newColId;
				});
			}
		});
	});

	core.plots.forEach((plot) => {
		if (plot.type === 'tableplot') {
			if (plot.plot.columnRefs) {
				plot.plot.columnRefs = plot.plot.columnRefs.map((id) =>
					id === oldColId ? newColId : id
				);
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

export function outputCoreAsJson() {
	let coreOut = JSON.parse(JSON.stringify(core));
	coreOut.rawData = Object.fromEntries(core.rawData);
	const output = { ...coreOut, appState, version: appConsts.version };
	return JSON.stringify(output, null, 2);
}

/** Returns a plain-object snapshot of core (no class instances). */
export function getCoreAsPlainObject() {
	const snap = JSON.parse(JSON.stringify(core));
	snap.rawData = Object.fromEntries(core.rawData);
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
}
