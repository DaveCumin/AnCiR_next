// src/lib/core/graphPatch.js
// @ts-nocheck
//
// Snapshot-and-diff undo for graph edits that cascade.
//
// Deleting a node is never one write. A table process takes its output columns with it,
// scrubs every input that read them, clears plot series, drops group memberships, detaches
// Column Sets and so on; a wire deletion reconciles outputs; a column deletion breaks every
// reference to it. Each of those paths already exists and is tested, but none of them is an
// op, so none of them could be undone (review ROB-3, ROB-4, ROB-15).
//
// Writing a hand-made inverse for each cascade would duplicate every one of those paths and
// drift from them. Instead the cascade runs as it always has, between two captures of the
// graph's structural state, and the difference between the captures IS the undo (and, read
// the other way, the redo). Whatever the cascade touched comes back, including references a
// future change adds to the cascade.
//
// What is captured: columns, table processes, free processes, plots, groups, composites,
// notes, chain refs, node notes, stored values, series appearance and colour maps, each as a JSON string
// keyed by id (strings are compared, so an untouched entity costs one stringify). rawData is
// captured BY REFERENCE (never copied): a patch that removes a column frees its data from
// core.rawData and the inverse patch, held by the history entry, is the only thing keeping it
// alive. That is what stops deleted data being written into a saved session (ROB-19) while
// still letting undo bring it back.
//
// Restoration keeps object identity wherever the change allows it: args and plain objects are
// patched in place, so an open editor keeps its bindings, and only an entity that is gone is
// rebuilt (through the same fromJSON paths session load uses).

import { core, appConsts } from './core.svelte.js';
import { Column } from './Column.svelte';
import { Process } from './Process.svelte';
import { TableProcess } from './TableProcess.svelte';
import { Plot } from './Plot.svelte';
import { memoForget } from './computeMemo.js';

const stringify = (v) => JSON.stringify(v, (k, x) => (typeof x === 'function' ? undefined : x));
const parse = (s) => (s === undefined ? undefined : JSON.parse(s));
const clone = (v) => (v === undefined ? undefined : parse(stringify(v)));

// Entity lists. `canvasId` names the node's workflow-canvas id, so a restored node can be put
// back where it was (see layoutFor).
const LISTS = [
	{ key: 'data', canvasId: (id) => `data_${id}` },
	{ key: 'orphanProcesses', canvasId: (id) => `process_${id}` },
	{ key: 'tableProcesses', canvasId: (id) => `tableprocess_${id}` },
	{ key: 'plots', canvasId: (id) => `plot_${id}` },
	{ key: 'groups', canvasId: (id) => id },
	{ key: 'composites', canvasId: (id) => id },
	{ key: 'notes', canvasId: (id) => id }
];
// Keyed maps. The appearance and colour-map ones are here so an op folded into a recorded
// gesture while it settles (see recordGraphMutation) is still part of that step.
const MAPS = ['nodeNotes', 'storedValues', 'seriesAppearance', 'categoryColours', 'plotColormaps'];

function safeStringify(item) {
	try {
		return stringify(item);
	} catch {
		// An entity that cannot be serialised is treated as unknown: never restored, never
		// rewritten. Better than failing the user's delete.
		return null;
	}
}

function captureList(arr) {
	const out = new Map();
	(arr ?? []).forEach((item, index) => {
		if (item?.id == null) return;
		out.set(item.id, { s: safeStringify(item), index });
	});
	return out;
}

/** Capture the graph's structural state. Cheap enough to run around every delete gesture. */
export function captureGraph() {
	const snap = {};
	for (const { key } of LISTS) snap[key] = captureList(core[key]);
	for (const key of MAPS) {
		const m = new Map();
		// storedValues entries can hold a live getter function, which JSON drops, so the
		// entry itself is kept too (shallow-copied on restore, as op_setStoredValue does).
		for (const [k, v] of Object.entries(core[key] ?? {})) m.set(k, { s: safeStringify(v), ref: v });
		snap[key] = m;
	}
	snap.chainRefs = safeStringify(core.chainRefs ?? []);
	snap.nodeLayout = { ...(core.nodeLayout ?? {}) };
	snap.rawData = new Map(core.rawData ?? []);
	return snap;
}

function diffList(from, to) {
	const remove = [];
	const add = [];
	const update = [];
	for (const id of from.keys()) if (!to.has(id)) remove.push(id);
	for (const [id, t] of to) {
		const f = from.get(id);
		if (!f) {
			if (t.s != null) add.push({ id, index: t.index, value: parse(t.s) });
		} else if (f.s != null && t.s != null && f.s !== t.s) {
			update.push({ id, value: parse(t.s) });
		}
	}
	add.sort((a, b) => a.index - b.index);
	return remove.length || add.length || update.length ? { remove, add, update } : null;
}

function diffMap(from, to) {
	const set = [];
	const del = [];
	for (const k of from.keys()) if (!to.has(k)) del.push(k);
	for (const [k, t] of to) {
		const f = from.get(k);
		if (!f || f.s !== t.s) set.push([k, t.ref]);
	}
	return set.length || del.length ? { set, del } : null;
}

/**
 * A patch. A class rather than a plain object on purpose: Svelte deep-proxies plain objects
 * pushed onto the history's $state stacks, which would copy the patch, and a recorded gesture
 * has to be able to AMEND its patch in place once the graph has finished reacting to it (see
 * recordGraphMutation). Class instances are stored as they are.
 */
export class GraphPatch {
	/** Replace this patch's contents with `other`'s. */
	replaceWith(other) {
		for (const k of Object.keys(this)) delete this[k];
		Object.assign(this, other);
	}
}

/**
 * The patch that turns state `from` into state `to`, or null when they match. rawData values
 * travel by reference; everything else is plain JSON.
 */
export function makePatch(from, to) {
	const patch = new GraphPatch();
	let any = false;
	for (const { key, canvasId } of LISTS) {
		const d = diffList(from[key], to[key]);
		if (!d) continue;
		patch[key] = d;
		any = true;
		// A node coming back should land where it was. Its canvas position lives in
		// core.nodeLayout, which the canvas prunes once the node is gone, so carry the
		// entry the target state had.
		for (const { id } of d.add) {
			const entry = to.nodeLayout?.[canvasId(id)];
			if (entry) (patch.layout ??= {})[canvasId(id)] = clone(entry);
		}
	}
	for (const key of MAPS) {
		const d = diffMap(from[key], to[key]);
		if (!d) continue;
		// Plain maps restore from JSON; storedValues keeps its entry object (getters).
		if (key !== 'storedValues') d.set = d.set.map(([k, ref]) => [k, clone(ref)]);
		patch[key] = d;
		any = true;
	}
	if (from.chainRefs != null && to.chainRefs != null && from.chainRefs !== to.chainRefs) {
		patch.chainRefs = parse(to.chainRefs);
		any = true;
	}
	const rawSet = [];
	const rawDel = [];
	for (const k of from.rawData.keys()) if (!to.rawData.has(k)) rawDel.push(k);
	for (const [k, v] of to.rawData) if (from.rawData.get(k) !== v) rawSet.push([k, v]);
	if (rawSet.length || rawDel.length) {
		patch.rawData = { set: rawSet, del: rawDel };
		any = true;
	}
	return any ? patch : null;
}

// Make `target` hold exactly `src`'s keys and values, writing only what differs so an open
// editor bound to `target` keeps its proxy and only re-runs for the keys that changed.
function syncInPlace(target, src) {
	if (!target || !src) return;
	for (const k of Object.keys(target)) if (!(k in src)) delete target[k];
	for (const [k, v] of Object.entries(src)) {
		if (stringify(target[k]) !== stringify(v)) target[k] = clone(v);
	}
}

function insertAt(arr, index, item) {
	const i = Math.max(0, Math.min(index ?? arr.length, arr.length));
	arr.splice(i, 0, item);
}

function removeById(arr, id, onRemove) {
	const i = arr.findIndex((x) => x?.id === id);
	if (i < 0) return;
	onRemove?.(arr[i]);
	arr.splice(i, 1);
}

function forgetColumnProcesses(col) {
	for (const p of col?.processes ?? []) memoForget(p, 'process');
}

// Fields a cascade rewrites on a surviving column (broken refs, rerouted producer ports).
const COLUMN_FIELDS = [
	'refId',
	'refUpToProcessId',
	'producerNodeId',
	'producerPort',
	'producerArtifactKind',
	'tableProcessGUId',
	'compression',
	'groupLabel'
];
const COLUMN_DEFAULTS = { tableProcessGUId: '' };
// Fields a referencing column DERIVES from what it points at; they follow refId by themselves.
const DERIVED_FIELDS = new Set(['name', 'type', 'binWidth', 'originTime_ms', 'timeFormat']);

function updateColumn(index, value) {
	const col = core.data[index];
	const cur = parse(safeStringify(col)) ?? {};
	const derived = value.refId != null || value.producerNodeId != null;
	const settable = new Set([...COLUMN_FIELDS, 'data', 'isTap']);
	const keys = new Set([...Object.keys(cur), ...Object.keys(value)]);
	const structural = [...keys].some(
		(k) =>
			!settable.has(k) &&
			!(derived && DERIVED_FIELDS.has(k)) &&
			stringify(cur[k]) !== stringify(value[k])
	);
	if (structural) {
		// Processes, a raw column's own name or type: rebuild it the way load does.
		forgetColumnProcesses(col);
		core.data[index] = Column.fromJSON(value);
		return;
	}
	for (const k of COLUMN_FIELDS) {
		const next = value[k] ?? COLUMN_DEFAULTS[k] ?? null;
		if (stringify(col[k] ?? COLUMN_DEFAULTS[k] ?? null) !== stringify(next)) col[k] = clone(next);
	}
	if (value.data !== undefined && stringify(col.data) !== stringify(value.data))
		col.data = value.data;
	const tap = value.isTap === true;
	if (!!col.isTap !== tap) col.isTap = tap;
}

function restoreTableProcess(value) {
	// The constructor ADOPTS `out` ids only when the first one is valid, and otherwise mints a
	// fresh set of output columns. A placeholder that is always valid takes the adopt branch
	// (no minting, no compute); the real args, whatever shape `out` has, go in afterwards.
	const tp = new TableProcess(
		{
			name: value.name,
			displayName: value.displayName,
			refTPId: value.refTPId ?? null,
			args: { out: { _restore: 0 } }
		},
		null,
		value.id
	);
	tp.args = clone(value.args ?? {});
	return tp;
}

function updatePlot(plot, value) {
	const cur = parse(safeStringify(plot)) ?? {};
	for (const k of new Set([...Object.keys(cur), ...Object.keys(value)])) {
		if (k === 'id' || k === 'type' || k === 'plot') continue;
		if (stringify(cur[k]) === stringify(value[k])) continue;
		const fallback = k === 'facetOverrides' || k === 'setRefs' || k === 'metricOut' ? {} : null;
		plot[k] = clone(value[k]) ?? fallback;
	}
	if (stringify(cur.plot) !== stringify(value.plot)) {
		const entry = appConsts.plotMap.get(plot.type);
		if (typeof entry?.data?.fromJSON === 'function')
			plot.plot = entry.data.fromJSON(plot, clone(value.plot));
	}
}

const APPLY = {
	data: {
		remove: (id) => removeById(core.data, id, forgetColumnProcesses),
		add: ({ index, value }) => insertAt(core.data, index, Column.fromJSON(value)),
		update: ({ id, value }) => {
			const i = core.data.findIndex((c) => c.id === id);
			if (i >= 0) updateColumn(i, value);
		}
	},
	orphanProcesses: {
		remove: (id) => removeById(core.orphanProcesses, id, (p) => memoForget(p, 'process')),
		add: ({ index, value }) => insertAt(core.orphanProcesses, index, Process.fromJSON(value, null)),
		update: ({ id, value }) => {
			const p = core.orphanProcesses.find((x) => x.id === id);
			if (!p) return;
			if (!p.args) p.args = {};
			syncInPlace(p.args, value.args ?? {});
			if ((p.linkedGroupId ?? null) !== (value.linkedGroupId ?? null))
				p.linkedGroupId = value.linkedGroupId ?? null;
		}
	},
	tableProcesses: {
		remove: (id) => removeById(core.tableProcesses, id, (tp) => memoForget(tp, 'tableprocess')),
		add: ({ index, value }) => insertAt(core.tableProcesses, index, restoreTableProcess(value)),
		update: ({ id, value }) => {
			const tp = core.tableProcesses.find((x) => x.id === id);
			if (!tp) return;
			if (!tp.args) tp.args = {};
			syncInPlace(tp.args, value.args ?? {});
			if ((tp.refTPId ?? null) !== (value.refTPId ?? null)) tp.refTPId = value.refTPId ?? null;
			if (value.displayName && tp.displayName !== value.displayName)
				tp.displayName = value.displayName;
		}
	},
	plots: {
		remove: (id) => removeById(core.plots, id),
		add: ({ index, value }) => insertAt(core.plots, index, Plot.fromJSON(clone(value))),
		update: ({ id, value }) => {
			const plot = core.plots.find((p) => p.id === id);
			if (plot) updatePlot(plot, value);
		}
	}
};
for (const key of ['groups', 'composites', 'notes']) {
	APPLY[key] = {
		remove: (id) => removeById(core[key], id),
		add: ({ index, value }) => insertAt(core[key], index, clone(value)),
		update: ({ id, value }) => {
			const item = core[key].find((x) => x.id === id);
			if (item) syncInPlace(item, value);
		}
	};
}

/** Apply a patch made by makePatch. Order matters: data before the columns that read it,
 *  columns before the nodes that adopt them, and rawData is freed only at the very end. */
export function applyPatch(patch) {
	if (!patch) return;
	for (const [k, v] of patch.rawData?.set ?? []) core.rawData.set(k, v);
	for (const { key } of LISTS) {
		const d = patch[key];
		if (!d) continue;
		if (!Array.isArray(core[key])) core[key] = [];
		for (const id of d.remove) APPLY[key].remove(id);
		for (const a of d.add) APPLY[key].add(a);
		for (const u of d.update) APPLY[key].update(u);
	}
	for (const key of MAPS) {
		const d = patch[key];
		if (!d) continue;
		if (!core[key] || typeof core[key] !== 'object') core[key] = {};
		for (const k of d.del) delete core[key][k];
		for (const [k, v] of d.set) core[key][k] = key === 'storedValues' ? { ...v } : clone(v);
	}
	if (patch.chainRefs) core.chainRefs = clone(patch.chainRefs);
	if (patch.layout && core.nodeLayout && typeof core.nodeLayout === 'object') {
		for (const [id, entry] of Object.entries(patch.layout)) core.nodeLayout[id] = clone(entry);
	}
	for (const k of patch.rawData?.del ?? []) core.rawData.delete(k);
}
