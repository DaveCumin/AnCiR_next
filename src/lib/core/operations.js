// src/lib/core/operations.js
// @ts-nocheck

import {
	core,
	appConsts,
	replaceColumnRefs,
	swapColumnRefs,
	propagateStoredValueRename
} from './core.svelte.js';
import { Plot, removePlotsCascade, plotInnerFromJSON } from './Plot.svelte';
import { Column, removeColumn as removeColumnCascade } from './Column.svelte';
import { Process } from './Process.svelte';
import { TableProcess, deleteTableProcessCascade } from './TableProcess.svelte';
import { memoForget } from './computeMemo.js';
import { captureGraph, makePatch, applyPatch } from './graphPatch.js';
import { inReaction } from './reactionContext.svelte.js';

/**
 * @typedef {Object} OpAddFreeTableProcess
 * @property {'addFreeTableProcess'} kind
 * @property {string} tpType
 * @property {string} [tpId]
 * @property {Object} [args]
 *
 * @typedef {Object} OpRemoveFreeTableProcess
 * @property {'removeFreeTableProcess'} kind
 * @property {string} tpId
 *
 * @typedef {Object} OpSetFreeTableProcessArg
 * @property {'setFreeTableProcessArg'} kind
 * @property {string} tpId
 * @property {string} key
 * @property {unknown} value
 *
 * @typedef {Object} OpAddColumn
 * @property {'addColumn'} kind
 * @property {string} [id]              optional pre-assigned id for replay
 * @property {Object} columnData        plain-object snapshot used by Column.fromJSON
 * @property {string} [tableId]         optional table to add to
 *
 * @typedef {Object} OpRemoveColumn
 * @property {'removeColumn'} kind
 * @property {string} id
 *
 * @typedef {Object} OpAddProcess
 * @property {'addProcess'} kind
 * @property {string} columnId
 * @property {string} processType
 * @property {string} [processId]
 * @property {Object} [args]
 * @property {number} [index]
 *
 * @typedef {Object} OpRemoveProcess
 * @property {'removeProcess'} kind
 * @property {string} columnId
 * @property {string} processId
 *
 * @typedef {Object} OpSetProcessArg
 * @property {'setProcessArg'} kind
 * @property {string} columnId
 * @property {string} processId
 * @property {string} key
 * @property {unknown} value
 *
 * @typedef {Object} OpAddPlot
 * @property {'addPlot'} kind
 * @property {Object} plotData
 *
 * @typedef {Object} OpRemovePlot
 * @property {'removePlot'} kind
 * @property {string} id
 *
 * @typedef {Object} OpSetPlotProperty
 * @property {'setPlotProperty'} kind
 * @property {string} id
 * @property {string} key
 * @property {unknown} value
 *
 * @typedef {Object} OpSetPlotPosition
 * @property {'setPlotPosition'} kind
 * @property {string} id
 * @property {number} [x]
 * @property {number} [y]
 * @property {number} [width]
 * @property {number} [height]
 *
 * @typedef {Object} OpSetPlotInner
 * @property {'setPlotInner'} kind
 * @property {string} id
 * @property {Object} inner   serialized snapshot of plot.plot (the type's data object)
 *
 * @typedef {Object} OpSetPlotInnerField
 * @property {'setPlotInnerField'} kind
 * @property {string} id        the plot's id
 * @property {string} path      dotted path into the inner ('yAxisLeft.label')
 * @property {unknown} value    JSON value to write (copied in and out)
 * @property {boolean} [coalesce] a spinner-style edit: a quick run on one path is one undo step
 *
 * @typedef {Object} OpSetPlotFields
 * @property {'setPlotFields'} kind
 * @property {string} id        the plot's id
 * @property {{ path: string, value: unknown }[]} edits  writes IN ORDER, each a path into the
 *   Plot wrapper ('plot.figurePadding.top', 'plot.data[0].line.colour', 'width',
 *   'style.fontFamily'); values are JSON and are copied in and out
 * @property {string} [coalesceKey] a gesture that sends many of these (a spinner, a drag) and
 *   should be ONE undo step: quick runs with the same key merge (opHistory)
 *
 * @typedef {Object} OpSetFacetOverride
 * @property {'setFacetOverride'} kind
 * @property {string} id        the facet generator's plot id
 * @property {string} unitKey   the panel's unit key (facetPanels.unitKeyFor)
 * @property {string} path      dotted inner path ('ylimsLeftIN', 'xlimsIN[0]')
 * @property {unknown} [value]  the override; undefined removes the path
 *
 * @typedef {Object} OpSetMarkerRule
 * @property {'setMarkerRule'} kind
 * @property {string} id        the actogram's plot id
 * @property {string} ruleId    the rule's persisted id ('r1', ...)
 * @property {Object} patch     { setting: value } for the rule's own settings
 *
 * @typedef {Object} OpRenameColumn
 * @property {'renameColumn'} kind
 * @property {number} id        the column's id (never changes)
 * @property {string|null} name the new name; null clears the user name (back to the auto name)
 * @property {string} [restoreName] with name null: the name to show again (an inverse's)
 *
 * @typedef {Object} OpRenameNode
 * @property {'renameNode'} kind
 * @property {'plot'|'tableprocess'|'process'|'group'|'composite'} target  the node's kind
 * @property {number|string} id  the node's id (a plot, analysis or process id; a group or
 *   composite id string)
 * @property {string} name       the new name (editors resolve an empty field to the default)
 *
 * @typedef {Object} OpSetRawCell
 * @property {'setRawCell'} kind
 * @property {number} columnId  the column whose raw series holds the cell
 * @property {number} row       0-based index into that series
 * @property {unknown} value    what to store (null marks the cell missing)
 *
 * @typedef {Object} OpSetPlotMetricOut
 * @property {'setPlotMetricOut'} kind
 * @property {string} id        the plot's id
 * @property {Object} metricOut { key: colId }, the plot's whole metric-output map
 *
 * @typedef {Object} OpSetOrphanProcessArg
 * @property {'setOrphanProcessArg'} kind
 * @property {string} processId
 * @property {string} key
 * @property {unknown} value
 *
 * @typedef {Object} OpSetStoredValue
 * @property {'setStoredValue'} kind
 * @property {string} name
 * @property {Object} entry
 *
 * @typedef {Object} OpRemoveStoredValue
 * @property {'removeStoredValue'} kind
 * @property {string} name
 *
 * @typedef {Object} OpRenameStoredValue
 * @property {'renameStoredValue'} kind
 * @property {string} oldName
 * @property {string} newName
 *
 * @typedef {Object} OpReplaceColumnRefs
 * @property {'replaceColumnRefs'} kind
 * @property {string} newColId
 * @property {string} oldColId
 *
 * @typedef {Object} OpSwapColumnRefs
 * @property {'swapColumnRefs'} kind
 * @property {string} idA
 * @property {string} idB
 *
 * @typedef {Object} OpBatch
 * @property {'batch'} kind
 * @property {GraphOperation[]} ops
 * @property {string} [coalesceKey] quick runs of batches with the same key are one undo step
 *
 * @typedef {Object} OpGraphPatch
 * @property {'graphPatch'} kind
 * @property {Object} patch   a graphPatch.js patch (entity adds/removes/updates + rawData)
 *
 * @typedef {OpAddColumn | OpRemoveColumn | OpAddProcess | OpRemoveProcess |
 *   OpSetProcessArg | OpAddPlot | OpRemovePlot | OpSetPlotProperty | OpSetPlotPosition |
 *   OpSetPlotInner | OpSetPlotInnerField | OpSetPlotFields | OpSetFacetOverride | OpSetMarkerRule | OpRenameColumn | OpRenameNode | OpSetRawCell | OpSetPlotMetricOut | OpAddFreeTableProcess | OpRemoveFreeTableProcess | OpSetFreeTableProcessArg |
 *   OpSetOrphanProcessArg | OpSetStoredValue | OpRemoveStoredValue |
 *   OpRenameStoredValue | OpReplaceColumnRefs | OpSwapColumnRefs | OpBatch | OpGraphPatch} GraphOperation
 */

const opListeners = new Set();
const stateChangeHooks = new Set();

/**
 * Add a listener that fires synchronously after every successful top-level applyOp.
 * Receives (forward, reverse). HistoryManager subscribes here. Future collab/MCP
 * transports register the same way.
 */
export function addOpListener(fn) {
	opListeners.add(fn);
	return () => opListeners.delete(fn);
}

/**
 * Add a hook that fires synchronously after every successful applyOp, including
 * under listener suppression (i.e. during history.undo / history.redo). Used by
 * state mirrors that need to stay in sync with core even when op recording is
 * muted, e.g. paramDiffWatcher's `prev` snapshot — otherwise an undo's mutation
 * would look like a fresh user edit on the watcher's next reactive run and get
 * re-recorded as a new op, creating an undo loop.
 */
export function addStateChangeHook(fn) {
	stateChangeHooks.add(fn);
	return () => stateChangeHooks.delete(fn);
}

let suppressed = 0;

export function withSuppressedListeners(fn) {
	suppressed++;
	try {
		return fn();
	} finally {
		suppressed--;
	}
}

function emit(forward, reverse) {
	if (suppressed > 0) return;
	// A recorded gesture is still settling (see recordGraphMutation). An op emitted from an
	// effect is the graph's reaction to it, which the gesture's step absorbs when it settles.
	// Anything else is a new gesture: close the open one first, so neither absorbs the other.
	if (settling) {
		if (inReaction()) return;
		settleGraphMutation();
	}
	for (const l of opListeners) l(forward, reverse);
}

// Depth of graph captures in progress. A cascade nested inside another (deleteOperationNode
// calling deleteTableProcess, a delete inside an op handler) is part of the outer gesture and
// must not record a step of its own.
let captureDepth = 0;

/**
 * Run `fn` between two graph captures and return the patches that redo and undo it.
 * Ops nested in `fn` apply normally but are not recorded on their own: the capture covers them.
 */
function captureAround(fn) {
	captureDepth++;
	const before = captureGraph();
	let result;
	try {
		result = withSuppressedListeners(fn);
	} finally {
		captureDepth--;
	}
	const after = captureGraph();
	return { result, forward: makePatch(before, after), inverse: makePatch(after, before) };
}

/**
 * Record a cascading edit (a node delete, a wire delete, a paste) as ONE undoable step.
 *
 * `fn` runs exactly as it would unrecorded; what it changed is captured as a graphPatch whose
 * inverse restores every entity it touched with its id, args, output columns, wiring and
 * downstream references (see graphPatch.js). Nested calls fold into the outermost one, so a
 * multi-node delete is one step. If `fn` throws, what it did before throwing is still recorded
 * (and so can be undone) before the error propagates. Returns `fn`'s result.
 */
export function recordGraphMutation(fn) {
	if (captureDepth > 0) return fn();
	settleGraphMutation();
	captureDepth++;
	const before = captureGraph();
	let result;
	let error = null;
	try {
		result = withSuppressedListeners(fn);
	} catch (e) {
		error = e;
	} finally {
		captureDepth--;
	}
	const after = captureGraph();
	const forward = makePatch(before, after);
	if (forward) {
		const backward = makePatch(after, before);
		const canonical = { kind: 'graphPatch', patch: forward };
		const inverse = { kind: 'graphPatch', patch: backward };
		emit(canonical, inverse);
		for (const h of stateChangeHooks) h(canonical, inverse);
		if (suppressed === 0) {
			settling = { before, forward, backward };
			setTimeout(settleGraphMutation, 0);
		}
	}
	if (error) throw error;
	return result;
}

// The gesture most recently recorded, while the graph is still reacting to it.
//
// A gesture's synchronous cascade is not always the whole of it. Deleting the last wire into an
// analysis drops its per-input outputs here, but the node's own editor then notices it has no
// input left and removes its summary outputs too, from an effect a microtask later, and the
// parameter watcher records that `out` write as a step of its own. Undo then reverted only that
// write: an output map naming columns that no longer existed, and the outputs never came back.
//
// So the step stays open until the next macrotask (after every effect and microtask the gesture
// set off has run). Ops that effects emit in that window are the reaction, so they are not
// recorded on their own, and the step's patches are then re-taken against the settled graph,
// IN PLACE (GraphPatch), so the entry already on the undo stack describes everything the
// gesture did. An op from outside an effect (the user's next gesture) closes the step first.
let settling = null;

/**
 * Close the open gesture now: re-take its patches against the current graph. Runs on its own
 * timer, before any undo or redo (so the entry is complete before it is reversed), and before
 * the next recorded gesture. Exported for tests that act again before a macrotask passes.
 */
export function settleGraphMutation() {
	const s = settling;
	if (!s) return;
	settling = null;
	const after = captureGraph();
	const forward = makePatch(s.before, after);
	if (!forward) return; // the reaction undid the gesture; keep what was recorded
	s.forward.replaceWith(forward);
	s.backward.replaceWith(makePatch(after, s.before));
}

/** Apply one op; return its inverse, or null if the op was a no-op. */
export function applyOp(op) {
	// An undo or redo (applied with listeners suppressed) must see the open gesture's complete
	// patches; ops that are the gesture's own reaction (unsuppressed) must not close it early.
	if (settling && suppressed > 0 && captureDepth === 0) settleGraphMutation();
	const result = applyForward(op);
	if (!result) return null;
	emit(result.canonical, result.inverse);
	for (const h of stateChangeHooks) h(result.canonical, result.inverse);
	return result.inverse;
}

export function applyOps(ops) {
	const inverses = [];
	for (const op of ops) {
		const inv = applyOp(op);
		if (inv) inverses.unshift(inv);
	}
	return inverses;
}

function pair(canonical, inverse) {
	return { canonical, inverse };
}

function snapshotPlot(plot) {
	// Cheap deep clone; drop functions so Svelte $state proxies don't smuggle methods.
	return JSON.parse(JSON.stringify(plot, (k, v) => (typeof v === 'function' ? undefined : v)));
}

function applyForward(op) {
	switch (op.kind) {
		case 'addPlot':
			return op_addPlot(op);
		case 'removePlot':
			return op_removePlot(op);
		case 'setPlotProperty':
			return op_setPlotProperty(op);
		case 'setPlotPosition':
			return op_setPlotPosition(op);
		case 'setPlotInner':
			return op_setPlotInner(op);
		case 'setPlotInnerField':
			return op_setPlotInnerField(op);
		case 'setPlotFields':
			return op_setPlotFields(op);
		case 'setFacetOverride':
			return op_setFacetOverride(op);
		case 'setMarkerRule':
			return op_setMarkerRule(op);
		case 'renameColumn':
			return op_renameColumn(op);
		case 'renameNode':
			return op_renameNode(op);
		case 'setRawCell':
			return op_setRawCell(op);
		case 'setPlotMetricOut':
			return op_setPlotMetricOut(op);
		case 'addColumn':
			return op_addColumn(op);
		case 'removeColumn':
			return op_removeColumn(op);
		case 'addProcess':
			return op_addProcess(op);
		case 'removeProcess':
			return op_removeProcess(op);
		case 'setProcessArg':
			return op_setProcessArg(op);
		case 'addFreeTableProcess':
			return op_addFreeTableProcess(op);
		case 'removeFreeTableProcess':
			return op_removeFreeTableProcess(op);
		case 'setFreeTableProcessArg':
			return op_setFreeTableProcessArg(op);
		case 'setOrphanProcessArg':
			return op_setOrphanProcessArg(op);
		case 'setStoredValue':
			return op_setStoredValue(op);
		case 'removeStoredValue':
			return op_removeStoredValue(op);
		case 'renameStoredValue':
			return op_renameStoredValue(op);
		case 'setAppearanceMaps':
			return op_setAppearanceMaps(op);
		case 'replaceColumnRefs':
			return op_replaceColumnRefs(op);
		case 'swapColumnRefs':
			return op_swapColumnRefs(op);
		case 'graphPatch':
			return op_graphPatch(op);
		case 'batch':
			return op_batch(op);
		default:
			throw new Error(`applyOp: unknown kind '${op?.kind}'`);
	}
}

function op_addPlot(op) {
	const plot = Plot.fromJSON(op.plotData);
	core.plots.push(plot);
	return pair(
		{ kind: 'addPlot', plotData: snapshotPlot(plot) },
		{ kind: 'removePlot', id: plot.id }
	);
}

// A plot owns its metric out-columns (an actogram marker rule's tau column, for one), so
// removing the plot removes them too, exactly as the workspace delete always did. The inverse
// restores the plot, its columns (same ids, same data) and anything wired to them.
function op_removePlot(op) {
	if (!core.plots.some((p) => p.id === op.id)) return null;
	const { inverse } = captureAround(() => removePlotsCascade([op.id]));
	return pair(op, { kind: 'graphPatch', patch: inverse });
}

function op_setPlotProperty(op) {
	const plot = core.plots.find((p) => p.id === op.id);
	if (!plot) return null;
	const before = plot[op.key];
	if (before === op.value) return null;
	plot[op.key] = op.value;
	return pair(op, { kind: 'setPlotProperty', id: op.id, key: op.key, value: before });
}

function op_setPlotPosition(op) {
	const plot = core.plots.find((p) => p.id === op.id);
	if (!plot) return null;
	const before = { x: plot.x, y: plot.y, width: plot.width, height: plot.height };
	if (op.x != null) plot.x = op.x;
	if (op.y != null) plot.y = op.y;
	if (op.width != null) plot.width = op.width;
	if (op.height != null) plot.height = op.height;
	return pair(op, {
		kind: 'setPlotPosition',
		id: op.id,
		x: before.x,
		y: before.y,
		width: before.width,
		height: before.height
	});
}

// Serialize a plot's inner data object (plot.plot) to a plain, replay-safe
// snapshot. Same drop-functions contract as snapshotPlot; the object's own
// toJSON governs shape and the type's data.fromJSON reconstructs it.
function snapshotPlotInner(inner) {
	return JSON.parse(JSON.stringify(inner, (k, v) => (typeof v === 'function' ? undefined : v)));
}

// Replace a plot's inner data object wholesale from a serialized snapshot. Used
// to make plot input wiring (series/columnRefs edits) undoable: the connect /
// disconnect handlers mutate plot.plot in place, then route the resulting state
// through this op so the change lands on the history stack. Reconstruction goes
// through the type's data.fromJSON — the exact contract session save/load and
// the addPlot/removePlot ops already rely on — so it round-trips every plot
// type. plot.plot is a $state field, so the swap is reactive.
function op_setPlotInner(op) {
	const plot = core.plots.find((p) => p.id === op.id);
	if (!plot) return null;
	const entry = appConsts.plotMap.get(plot.type);
	if (typeof entry?.data?.fromJSON !== 'function') return null;
	const before = snapshotPlotInner(plot.plot);
	plot.plot = plotInnerFromJSON(plot, op.inner);
	return pair(
		{ kind: 'setPlotInner', id: op.id, inner: snapshotPlotInner(op.inner) },
		{ kind: 'setPlotInner', id: op.id, inner: before }
	);
}

// One setting of a plot's inner, written IN PLACE (an axis label, its gridlines, tick count or
// manual ticks): the control's own edit, as one undo step and an unsaved change. Not
// setPlotInner, which rebuilds the whole inner through fromJSON (every series recomputes) for
// what is one field. The plot is looked up by id and the field by path at apply time, so an
// undo after the inner was rebuilt (a wire, an AI edit) still lands. The path must already
// lead to an object (no intermediate objects are created); the value is deep-copied both ways
// so a later in-place edit of an array cannot rewrite history.
function op_setPlotInnerField(op) {
	const plot = core.plots.find((p) => p.id === op.id);
	if (!plot?.plot || typeof op.path !== 'string' || !op.path) return null;
	const parts = op.path.split('.');
	let owner = plot.plot;
	for (const key of parts.slice(0, -1)) {
		owner = owner?.[key];
		if (owner == null || typeof owner !== 'object') return null;
	}
	const leaf = parts.at(-1);
	const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
	const before = copy(owner[leaf]);
	const next = copy(op.value);
	if (JSON.stringify(before ?? null) === JSON.stringify(next ?? null)) return null;
	owner[leaf] = next;
	const flag = op.coalesce === true ? { coalesce: true } : {};
	return pair(
		{ kind: 'setPlotInnerField', id: op.id, path: op.path, value: copy(next), ...flag },
		{ kind: 'setPlotInnerField', id: op.id, path: op.path, value: before, ...flag }
	);
}

// Several settings of one plot, written IN PLACE and in the given order (plots/plotEdits.js):
// what one control-panel gesture changed (a padding, a series colour, a figure-style field
// with what it pushed into the series), or one multi-select edit. Paths start at the Plot
// wrapper, so a size or a style field rides in the same step as the inner fields it moved.
// The inverse writes the old values in the SAME order (not reversed): a write through a
// setter that resets a partner (Periodogram `binSize` turns `binSizeAuto` off) is then
// followed by the partner's own old value, as the forward direction is. The recorder checks
// that both directions reproduce the serialised plot before it records this op, and falls
// back to a whole-inner rebuild when they do not.
function op_setPlotFields(op) {
	const plot = core.plots.find((p) => p.id === op.id);
	if (!plot || !Array.isArray(op.edits) || op.edits.length === 0) return null;
	// The recorder (plots/plotEdits.js) passes the old values as SERIALISED (`before`): a live
	// read can differ from what is saved (a series colour reads back resolved while the saved
	// value is null, "automatic"), and undo must restore what was saved.
	const given =
		Array.isArray(op.before) && op.before.length === op.edits.length
			? op.edits.map((e, i) => ({ path: e.path, value: jsonCopy(op.before[i]) }))
			: null;
	const before = given ?? readPlotFields(plot, op.edits);
	if (before == null) return null;
	if (op.edits.every((e, i) => sameJSON(before[i].value, e.value))) return null;
	writePlotFields(plot, op.edits);
	const key = typeof op.coalesceKey === 'string' ? { coalesceKey: op.coalesceKey } : {};
	return pair(
		{ kind: 'setPlotFields', id: op.id, edits: copyEdits(op.edits), ...key },
		{ kind: 'setPlotFields', id: op.id, edits: before, ...key }
	);
}

const jsonCopy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const sameJSON = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const copyEdits = (edits) => edits.map((e) => ({ path: e.path, value: jsonCopy(e.value) }));
/** 'plot.data[0].line.colour' -> ['plot', 'data', '0', 'line', 'colour'] */
const pathParts = (path) => (typeof path === 'string' ? (path.match(/[^.[\]]+/g) ?? []) : []);

/** The object a path's last part is a field of, or null when the path does not lead there. */
function pathOwner(root, parts) {
	let owner = root;
	for (const key of parts.slice(0, -1)) {
		owner = owner?.[key];
		if (owner == null || typeof owner !== 'object') return null;
	}
	return owner;
}

/** The current values at each edit's path (copies), or null when a path is unreachable. */
export function readPlotFields(plot, edits) {
	const out = [];
	for (const { path } of edits) {
		const parts = pathParts(path);
		const owner = parts.length ? pathOwner(plot, parts) : null;
		if (!owner) return null;
		out.push({ path, value: jsonCopy(owner[parts.at(-1)]) });
	}
	return out;
}

/** Write each edit's value (a copy) at its path, in order. Unreachable paths are skipped. */
export function writePlotFields(plot, edits) {
	for (const { path, value } of edits) {
		const parts = pathParts(path);
		const owner = parts.length ? pathOwner(plot, parts) : null;
		if (owner) owner[parts.at(-1)] = jsonCopy(value);
	}
}

// One path of one panel's override map (plan 1.6 / 1.7): `value` undefined REMOVES the path
// (and drops the unit's entry once it is empty), so "reset to facet" is the same op with no
// value, and the inverse of a first-time set is a removal. Arrays are copied on the way in
// and out so a later in-place edit of a limit pair cannot rewrite history. The map is a
// $state object on the generator, so in-place writes re-run the panel projection.
function op_setFacetOverride(op) {
	const plot = core.plots.find((p) => p.id === op.id);
	if (!plot || typeof op.unitKey !== 'string' || !op.unitKey || typeof op.path !== 'string')
		return null;
	if (!op.path) return null;
	if (!plot.facetOverrides || typeof plot.facetOverrides !== 'object') plot.facetOverrides = {};
	const map = plot.facetOverrides;
	const entry = map[op.unitKey];
	const had = entry != null && Object.prototype.hasOwnProperty.call(entry, op.path);
	const before = had ? JSON.parse(JSON.stringify(entry[op.path])) : undefined;
	const next = op.value === undefined ? undefined : JSON.parse(JSON.stringify(op.value));
	if (
		JSON.stringify(before ?? null) === JSON.stringify(next ?? null) &&
		had === (next !== undefined)
	)
		return null;
	if (next === undefined) {
		if (had) {
			delete entry[op.path];
			if (Object.keys(entry).length === 0) delete map[op.unitKey];
		}
	} else {
		if (!map[op.unitKey]) map[op.unitKey] = {};
		map[op.unitKey][op.path] = next;
	}
	const canonical = { kind: 'setFacetOverride', id: op.id, unitKey: op.unitKey, path: op.path };
	if (next !== undefined) canonical.value = JSON.parse(JSON.stringify(next));
	const inverse = { kind: 'setFacetOverride', id: op.id, unitKey: op.unitKey, path: op.path };
	if (had) inverse.value = before;
	return pair(canonical, inverse);
}

// One or more settings of one actogram marker rule, applied IN PLACE (plan 2026-09-30
// actogram marker rules, section 4). Deliberately not setPlotInner: that rebuilds the whole
// inner through fromJSON, re-running every detection on every series, whereas a rule's
// instances read the rule live, so an in-place write recomputes exactly that rule's
// instances and remounts nothing. On a facet generator the panels mirror the leaf change.
// The plot and the rule are looked up by id at apply time (ids are persisted, so an
// intervening setPlotInner cannot strand the op); either missing is a no-op. Only keys the
// rule already has are patched, never `id`. The inverse is the prior values.
function op_setMarkerRule(op) {
	const plot = core.plots.find((p) => p.id === op.id);
	const rule = plot?.plot?.markerRules?.find?.((r) => r.id === op.ruleId);
	if (!rule || op.patch == null || typeof op.patch !== 'object') return null;
	const before = {};
	const after = {};
	for (const [key, value] of Object.entries(op.patch)) {
		if (key === 'id' || !(key in rule)) continue;
		const prev = rule[key];
		if (JSON.stringify(prev ?? null) === JSON.stringify(value ?? null)) continue;
		before[key] = prev;
		after[key] = value;
	}
	if (Object.keys(after).length === 0) return null;
	for (const [key, value] of Object.entries(after)) rule[key] = value;
	return pair(
		{ kind: 'setMarkerRule', id: op.id, ruleId: op.ruleId, patch: after },
		{ kind: 'setMarkerRule', id: op.id, ruleId: op.ruleId, patch: before }
	);
}

// Rename a column in place: its id, data and every wire into it stay (plan 2026-09-30,
// section 4: renaming a marker rule renames its output columns and must never re-mint
// them). Writes `customName`, the field a user's own rename writes, so the name holds
// whatever the column's derived default would have been.
//
// `name: null` clears the user's name, so the column shows its derived (auto) name again: a
// user who empties a rename field of a node output gets that. The inverse restores
// `customName` exactly, null included, so undoing a first rename of a node output gives back a
// LIVE derived name rather than pinning the text it showed at the time.
//
// A column can also show a name with `customName` null: an imported or loaded column's name is
// assigned straight onto the `name` derived (Column's constructor, Object.assign), which
// Svelte keeps as an override until the derived's inputs change. Clearing customName drops
// that override ("Unnamed"), so the inverse carries the name shown before (`restoreName`) and
// writes it back the same way the constructor did.
function op_renameColumn(op) {
	const col = core.data.find((c) => c.id === op.id);
	if (!col) return null;
	const name =
		op.name === null ? null : typeof op.name === 'string' && op.name ? op.name : undefined;
	if (name === undefined) return null;
	const before = col.customName ?? null;
	const shown = col.name;
	if (before === name) return null;
	// Naming a column what it is already called changes nothing.
	if (name !== null && shown === name) return null;
	col.customName = name;
	const restoreName = name === null && typeof op.restoreName === 'string' ? op.restoreName : null;
	if (restoreName != null) col.name = restoreName;
	return pair(
		{ kind: 'renameColumn', id: op.id, name, ...(restoreName != null ? { restoreName } : {}) },
		{
			kind: 'renameColumn',
			id: op.id,
			name: before,
			...(before === null ? { restoreName: shown } : {})
		}
	);
}

// The object holding a node's user-facing name, and the field it is in: a plot's `name`, an
// analysis or column process's `displayName`, a group or composite's `name`. Looked up by id at
// apply time, so an op replayed after the node was rebuilt (an undo of a delete) still finds it.
function nodeNameField(target, id) {
	switch (target) {
		case 'plot':
			return { obj: core.plots.find((p) => p.id === id), key: 'name' };
		case 'tableprocess':
			return { obj: core.tableProcesses.find((t) => t.id === id), key: 'displayName' };
		case 'process': {
			const proc =
				core.orphanProcesses.find((p) => p.id === id) ??
				core.data.flatMap((c) => c.processes ?? []).find((p) => p.id === id);
			return { obj: proc, key: 'displayName' };
		}
		case 'group':
			return { obj: core.groups.find((g) => g.id === id), key: 'name' };
		case 'composite':
			return { obj: core.composites.find((c) => c.id === id), key: 'name' };
	}
	return { obj: null, key: null };
}

// Rename a canvas node (plot, analysis, column process, group, composite) in place: one undo
// step, and an unsaved change like every op. The node's editors resolve what the typed text
// means (trimmed, an empty field back to the node's default name; core/nodeNaming.js), so an
// edit never writes an empty name; an inverse may restore one a node already had.
function op_renameNode(op) {
	if (typeof op.name !== 'string') return null;
	const { obj, key } = nodeNameField(op.target, op.id);
	if (!obj) return null;
	const before = obj[key];
	if (before === op.name) return null;
	obj[key] = op.name;
	return pair(
		{ kind: 'renameNode', target: op.target, id: op.id, name: op.name },
		{ kind: 'renameNode', target: op.target, id: op.id, name: before ?? '' }
	);
}

// Write one cell of a column's raw series (a Table plot edit of a time cell, which has no
// Edit value process to carry it). Only the one value is kept for undo, never the series.
function op_setRawCell(op) {
	const col = core.data.find((c) => c.id === op.columnId);
	if (!col) return null;
	const arr = core.rawData.get(col.data);
	if (!Array.isArray(arr) || !(op.row >= 0) || op.row >= arr.length) return null;
	const before = arr[op.row];
	if (Object.is(before, op.value)) return null;
	arr[op.row] = op.value;
	col.rawDataVersion++;
	return pair(
		{ kind: 'setRawCell', columnId: op.columnId, row: op.row, value: op.value },
		{ kind: 'setRawCell', columnId: op.columnId, row: op.row, value: before }
	);
}

// Replace a plot's whole metric-output map ({ key: colId }). Deep-copied both ways, unlike
// setPlotProperty, whose inverse holds the live $state object: the metric sync mutates that
// object in place (syncPlotMetricColumns), which would rewrite history after the fact.
// Used with removeColumn in one batch when a marker rule is deleted, so undo restores the
// map AND the columns with their ids, and downstream wires come back.
function op_setPlotMetricOut(op) {
	const plot = core.plots.find((p) => p.id === op.id);
	if (!plot || op.metricOut == null || typeof op.metricOut !== 'object') return null;
	const before = JSON.parse(JSON.stringify(plot.metricOut ?? {}));
	const next = JSON.parse(JSON.stringify(op.metricOut));
	if (JSON.stringify(before) === JSON.stringify(next)) return null;
	plot.metricOut = next;
	return pair(
		{ kind: 'setPlotMetricOut', id: op.id, metricOut: JSON.parse(JSON.stringify(next)) },
		{ kind: 'setPlotMetricOut', id: op.id, metricOut: before }
	);
}

function snapshotColumn(col) {
	return JSON.parse(JSON.stringify(col, (k, v) => (typeof v === 'function' ? undefined : v)));
}

function op_addColumn(op) {
	const data = op.columnData;
	const col = Column.fromJSON(data);
	core.data.push(col);
	return pair(
		{ kind: 'addColumn', columnData: snapshotColumn(col) },
		{ kind: 'removeColumn', id: col.id }
	);
}

// The full removal, not a bare splice (ROB-15): every reference to the column (plot series
// and table refs, analysis inputs, free-process inputs, group membership, ref chains) is
// scrubbed, and per-input outputs that described it go with it. Leaving the dead id in place
// meant a column minted later with the same id (the counter restarts at max+1 after a reload)
// was silently wired into the old plot. Its rawData is freed from core (so it is not saved
// with the session, ROB-19); the inverse holds it, so undo restores the column with the same
// id and data AND puts every scrubbed reference back.
function op_removeColumn(op) {
	if (!core.data.some((c) => c.id === op.id)) return null;
	const { inverse } = captureAround(() => removeColumnCascade(op.id));
	return pair(op, { kind: 'graphPatch', patch: inverse });
}

function op_addProcess(op) {
	const col = core.data.find((c) => c.id === op.columnId);
	if (!col) return null;
	const proc = new Process(
		{ name: op.processType, args: op.args ?? {}, linkedGroupId: op.linkedGroupId ?? null },
		col,
		op.processId ?? null
	);
	if (op.index != null && op.index >= 0 && op.index < col.processes.length) {
		col.processes.splice(op.index, 0, proc);
	} else {
		col.processes.push(proc);
	}
	return pair(
		{
			kind: 'addProcess',
			columnId: op.columnId,
			processType: op.processType,
			processId: proc.id,
			args: JSON.parse(JSON.stringify(op.args ?? {})),
			...(op.linkedGroupId != null && { linkedGroupId: op.linkedGroupId }),
			...(op.index != null && { index: op.index })
		},
		{ kind: 'removeProcess', columnId: op.columnId, processId: proc.id }
	);
}

function op_removeProcess(op) {
	const col = core.data.find((c) => c.id === op.columnId);
	if (!col) return null;
	const procIdx = col.processes.findIndex((p) => p.id === op.processId);
	if (procIdx < 0) return null;
	const before = col.processes[procIdx];
	memoForget(before, 'process');
	const snap = {
		processType: before.name,
		processId: before.id,
		args: JSON.parse(JSON.stringify(before.args ?? {})),
		linkedGroupId: before.linkedGroupId ?? null,
		index: procIdx
	};
	col.processes.splice(procIdx, 1);
	return pair(op, {
		kind: 'addProcess',
		columnId: op.columnId,
		processType: snap.processType,
		processId: snap.processId,
		args: snap.args,
		...(snap.linkedGroupId != null && { linkedGroupId: snap.linkedGroupId }),
		index: snap.index
	});
}

function op_setProcessArg(op) {
	const col = core.data.find((c) => c.id === op.columnId);
	if (!col) return null;
	const proc = col.processes.find((p) => p.id === op.processId);
	if (!proc) return null;
	if (!proc.args) proc.args = {};
	const before = proc.args[op.key];
	if (before === op.value) return null;
	proc.args[op.key] = op.value;
	return pair(op, {
		kind: 'setProcessArg',
		columnId: op.columnId,
		processId: op.processId,
		key: op.key,
		value: before
	});
}

function op_addFreeTableProcess(op) {
	const tp = new TableProcess({ name: op.tpType, args: op.args ?? {} }, null, op.tpId ?? null);
	core.tableProcesses.push(tp);

	// Describe what ACTUALLY happened, not what was asked for. When `out` arrives without ids
	// the constructor mints an output column per key, so this op really created a node AND its
	// columns — and redo has to recreate both, with the SAME ids, or anything wired to them
	// (a plot's `refId`) is left pointing at a column that no longer exists.
	//
	// Hence a batch: columns first, then the node whose `out` already names their ids (which
	// makes the constructor adopt them instead of minting a second set). The snapshots are of
	// empty columns — the node recomputes their data on redo, exactly as it did on the first
	// add. Symmetrical with op_removeFreeTableProcess's inverse.
	const args = JSON.parse(JSON.stringify(tp.args ?? {}));
	const minted = Object.values(args.out ?? {})
		.filter((id) => typeof id === 'number' && id >= 0)
		.map((id) => core.data.find((c) => c.id === id))
		.filter(Boolean)
		.map(snapshotColumn);

	const addNode = { kind: 'addFreeTableProcess', tpType: op.tpType, tpId: tp.id, args };
	const canonical = minted.length
		? {
				kind: 'batch',
				ops: [...minted.map((columnData) => ({ kind: 'addColumn', columnData })), addNode]
			}
		: addNode;

	return pair(canonical, { kind: 'removeFreeTableProcess', tpId: tp.id });
}

// Delete a free table process the way the canvas does: its output columns go with it (it
// minted them, so they are part of the node), every input that read them is scrubbed, Column
// Set links it fed are detached, and chained nodes are unhooked. The inverse puts all of it
// back: the node with its id and args, its output columns with the SAME ids and data, and
// every downstream reference, so the next compute lands where the plots already look.
function op_removeFreeTableProcess(op) {
	const tp = core.tableProcesses.find((x) => x.id === op.tpId);
	if (!tp) return null;
	const { inverse } = captureAround(() => deleteTableProcessCascade(tp));
	return pair(op, { kind: 'graphPatch', patch: inverse });
}

// Apply a recorded patch (an undo or redo of a cascading edit). The inverse is captured
// around the application rather than derived from the patch, so it is exact even when the
// state has drifted since the patch was made.
function op_graphPatch(op) {
	if (!op.patch) return null;
	const { forward, inverse } = captureAround(() => applyPatch(op.patch));
	if (!forward) return null;
	return pair({ kind: 'graphPatch', patch: op.patch }, { kind: 'graphPatch', patch: inverse });
}

function op_setFreeTableProcessArg(op) {
	const tp = core.tableProcesses.find((x) => x.id === op.tpId);
	if (!tp) return null;
	if (!tp.args) tp.args = {};
	const before = tp.args[op.key];
	if (before === op.value) return null;
	tp.args[op.key] = op.value;
	return pair(op, {
		kind: 'setFreeTableProcessArg',
		tpId: op.tpId,
		key: op.key,
		value: before
	});
}

function op_setOrphanProcessArg(op) {
	const proc = core.orphanProcesses.find((p) => p.id === op.processId);
	if (!proc) return null;
	if (!proc.args) proc.args = {};
	const before = proc.args[op.key];
	if (before === op.value) return null;
	proc.args[op.key] = op.value;
	return pair(op, {
		kind: 'setOrphanProcessArg',
		processId: op.processId,
		key: op.key,
		value: before
	});
}

function op_setStoredValue(op) {
	const before = core.storedValues[op.name];
	core.storedValues[op.name] = { ...op.entry };
	return pair(
		op,
		before
			? { kind: 'setStoredValue', name: op.name, entry: { ...before } }
			: { kind: 'removeStoredValue', name: op.name }
	);
}

function op_removeStoredValue(op) {
	const before = core.storedValues[op.name];
	if (!before) return null;
	delete core.storedValues[op.name];
	return pair(op, { kind: 'setStoredValue', name: op.name, entry: { ...before } });
}

function op_renameStoredValue(op) {
	const entry = core.storedValues[op.oldName];
	if (!entry || core.storedValues[op.newName]) return null;
	core.storedValues[op.newName] = entry;
	delete core.storedValues[op.oldName];
	// Keep formula references (FormulaColumn/BlankColumn/StoredValueGroup)
	// pointing at the new name; the inverse op propagates back on undo.
	propagateStoredValueRename(op.oldName, op.newName);
	return pair(op, { kind: 'renameStoredValue', oldName: op.newName, newName: op.oldName });
}

/**
 * Replace the two appearance maps wholesale.
 *
 * A SNAPSHOT op rather than a per-record one, deliberately. Applying a saved style rewrites
 * an unknown number of records across two maps in one gesture, and the user's expectation is
 * that one undo puts the session back. Recording a record-at-a-time op would either bury the
 * user under N undo steps or need a batch whose size the caller has to know in advance.
 *
 * Both maps move together because a style writes both, and a half-undone restyle (columns
 * reverted, categories not) is a state the user never asked for.
 *
 * The maps are plain data: `{colId: {colour, shape, dash, edited}}` and `{label: {slot|hex}}`.
 * Cloning is enough; there is nothing live to preserve.
 */
function op_setAppearanceMaps(op) {
	const before = {
		series: JSON.parse(JSON.stringify(core.seriesAppearance ?? {})),
		categories: JSON.parse(JSON.stringify(core.categoryColours ?? {}))
	};
	if (op.series) core.seriesAppearance = JSON.parse(JSON.stringify(op.series));
	if (op.categories) core.categoryColours = JSON.parse(JSON.stringify(op.categories));
	return pair(
		{ kind: 'setAppearanceMaps', series: op.series, categories: op.categories },
		{ kind: 'setAppearanceMaps', series: before.series, categories: before.categories }
	);
}

function op_replaceColumnRefs(op) {
	// Note: this is one-directional in current AnCiR. The inverse re-applies with
	// arguments swapped; round-trip restores the original ref topology.
	replaceColumnRefs(op.newColId, op.oldColId);
	return pair(op, { kind: 'replaceColumnRefs', newColId: op.oldColId, oldColId: op.newColId });
}

function op_swapColumnRefs(op) {
	swapColumnRefs(op.idA, op.idB);
	return pair(op, { kind: 'swapColumnRefs', idA: op.idA, idB: op.idB });
}

function op_batch(op) {
	const inverses = [];
	const canonicals = [];
	for (const child of op.ops) {
		const result = applyForward(child);
		if (!result) continue; // a no-op child contributes nothing to either direction
		canonicals.push(result.canonical);
		inverses.unshift(result.inverse);
	}
	// Record what the children ACTUALLY did, not what the caller asked for. Every entity-creating
	// op canonicalises the id it minted (addColumn → the column's id, addFreeTableProcess → its
	// tpId) precisely so redo restores that same entity. Replaying the caller's original children
	// instead would mint a NEW one each redo — for a table process, a second node and a second
	// set of output columns. Harmless while batches only carried wiring ops, whose canonical form
	// equals what was passed in; not harmless once a batch creates things.
	// A batch whose every child was a no-op changed nothing: not an undo step (it used to push
	// an empty entry, so Cmd+Z appeared to do nothing).
	if (canonicals.length === 0) return null;
	// A gesture that sends many batches (a wheel zoom: x and y limits per tick) names itself
	// with `coalesceKey` so a quick run of them is one undo step (opHistory).
	const key = typeof op.coalesceKey === 'string' ? { coalesceKey: op.coalesceKey } : {};
	return pair({ kind: 'batch', ops: canonicals, ...key }, { kind: 'batch', ops: inverses, ...key });
}
