// @ts-nocheck
// Plot edits as undo steps: the general recorder.
//
// A plot's settings are edited in many places: the control panel's own inputs (each plot
// type's controls, and the shared plotbits: Line, Points, Box, Legend, the colour picker),
// the multi-select panel, the name editors of things inside a plot (an overlay, a phase
// marker, an annotation). Most of them write straight onto the live objects, as a Svelte
// `bind:` does. Making each of those hundreds of writes an operation by hand would be a
// rewrite of every control, and every new control would have to remember.
//
// So the step is taken around the GESTURE instead. Before it, the plot's editable state is
// serialised (`plotEditState`: its size, figure style and inner, as saved); after it, the
// difference is turned into ONE operation (`recordPlotGesture`):
//
//   setPlotFields   the changed paths, written in place in both directions. Used when a dry
//                   run proves that writing the old values reproduces the old serialised plot
//                   and writing the new ones the new (a getter that reads back something other
//                   than what it saves, or a setter with a side effect, fails the check).
//   setPlotInner    otherwise (a series added or removed, a field that does not round-trip):
//                   the whole inner, rebuilt through the type's fromJSON, as a wiring edit is.
//
// The plot is put back to its state before the gesture and the operation applied, so the
// step lands on the history and counts as an unsaved change like any other.
//
// Who calls this: plots/plotEditScope.js (every gesture in the plot control panel),
// the multi-select panel (`commitPlotsEdit` / `createPlotsGesture`, one step over every
// selected plot) and `commitObjectEdit` (an edit of an object inside a plot, found by
// identity).
import { core } from '$lib/core/core.svelte.js';
import { applyOp } from '$lib/core/operations.js';
import { plotInnerFromJSON } from '$lib/core/Plot.svelte';

/**
 * What a plot edit can change, as saved: the size, the figure style and the inner. Plain JSON
 * (every class's toJSON applied). Not the position, the name or the facet override map: each
 * of those has its own operation.
 */
export function plotEditState(plot) {
	return JSON.parse(
		JSON.stringify({
			width: plot?.width ?? null,
			height: plot?.height ?? null,
			style: plot?.style ?? null,
			plot: plot?.plot ?? null
		})
	);
}

const str = (v) => JSON.stringify(v ?? null);
const isPrim = (v) => v == null || typeof v !== 'object';
const isPlainObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const join = (path, key) => (path ? `${path}.${key}` : String(key));

/**
 * The leaf writes that turn `a` into `b` (both plain JSON), appended to `out`, as wrapper
 * paths. Arrays of primitives (a limit pair, manual ticks) are one write. Returns false when
 * the change is structural (an array of objects changed length: a series or an overlay was
 * added or removed), which is recorded as a whole-inner rebuild instead.
 */
function diffJSON(a, b, path, out) {
	if (str(a) === str(b)) return true;
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.every(isPrim) && b.every(isPrim)) {
			out.push({ path, value: b });
			return true;
		}
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++)
			if (!diffJSON(a[i], b[i], `${path}[${i}]`, out)) return false;
		return true;
	}
	if (isPlainObj(a) && isPlainObj(b)) {
		for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
			if (!diffJSON(a[key], b[key], join(path, key), out)) return false;
		return true;
	}
	out.push({ path, value: b });
	return true;
}

const pathParts = (path) => path.match(/[^.[\]]+/g) ?? [];
function jsonAt(json, path) {
	let cur = json;
	for (const key of pathParts(path)) {
		if (cur == null || typeof cur !== 'object') return undefined;
		cur = cur[key];
	}
	return cur;
}
const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** Write each edit at its wrapper path, in order (a dry run of setPlotFields). */
function writeAll(plot, edits) {
	for (const { path, value } of edits) {
		const parts = pathParts(path);
		let owner = plot;
		for (const key of parts.slice(0, -1)) {
			owner = owner?.[key];
			if (owner == null || typeof owner !== 'object') break;
		}
		if (owner != null && typeof owner === 'object') owner[parts.at(-1)] = copy(value);
	}
}

/** The wrapper-level writes (size, style) between two states; the inner is not included. */
function wrapperEdits(before, after) {
	const out = [];
	for (const key of ['width', 'height']) {
		if (str(before[key]) !== str(after[key])) out.push({ path: key, value: after[key] });
	}
	if (str(before.style) !== str(after.style)) out.push({ path: 'style', value: after.style });
	return out;
}

/**
 * The operations that take `plot` from `before` (its `plotEditState` before a gesture) to its
 * state now, with the plot PUT BACK to `before`, so that applying them records the gesture.
 * Empty when nothing changed. Calling it and dropping the result cancels the gesture (Escape).
 *
 * @param {object} plot the Plot wrapper
 * @param {object} before plotEditState(plot) from before the gesture
 * @param {{ coalesceKey?: string }} [opts]
 * @returns {object[]}
 */
export function opsSince(plot, before, { coalesceKey } = {}) {
	if (!plot || !before) return [];
	const beforeStr = str(before);
	const after = plotEditState(plot);
	const afterStr = str(after);
	if (afterStr === beforeStr) return [];
	const key = typeof coalesceKey === 'string' ? { coalesceKey } : {};

	const forward = [];
	if (diffJSON(before, after, '', forward) && forward.length > 0) {
		const backward = forward.map((e) => ({ path: e.path, value: jsonAt(before, e.path) }));
		// Dry run: both directions must reproduce the serialised plot exactly.
		writeAll(plot, backward);
		if (str(plotEditState(plot)) === beforeStr) {
			writeAll(plot, forward);
			if (str(plotEditState(plot)) === afterStr) {
				writeAll(plot, backward);
				return [
					{
						kind: 'setPlotFields',
						id: plot.id,
						edits: forward.map((e) => ({ path: e.path, value: copy(e.value) })),
						before: backward.map((e) => copy(e.value)),
						...key
					}
				];
			}
		}
	}

	// A change that does not round-trip in place: rebuild the inner from its saved form, as
	// every plot load and undo does, and record the whole inner. The size and the style are
	// plain fields and go in place.
	const ops = [];
	const wrap = wrapperEdits(before, after);
	if (wrap.length) {
		writeAll(
			plot,
			wrap.map((e) => ({ path: e.path, value: before[e.path] }))
		);
		ops.push({
			kind: 'setPlotFields',
			id: plot.id,
			edits: wrap,
			before: wrap.map((e) => copy(before[e.path])),
			...key
		});
	}
	if (str(before.plot) !== str(after.plot)) {
		plot.plot = plotInnerFromJSON(plot, copy(before.plot));
		ops.push({ kind: 'setPlotInner', id: plot.id, inner: after.plot });
	}
	return ops;
}

function applyAsOneStep(ops, coalesceKey) {
	if (ops.length === 0) return null;
	if (ops.length === 1) return applyOp(ops[0]);
	const key = typeof coalesceKey === 'string' ? { coalesceKey } : {};
	return applyOp({ kind: 'batch', ops, ...key });
}

/** Whether `plot` is one of the session's plots (only those have a history). */
export function isSessionPlot(plot) {
	return !!plot && (core.plots ?? []).includes(plot);
}

/**
 * Record what changed on `plot` since `before` as ONE undo step (and an unsaved change).
 * Returns the inverse, or null when nothing changed or the plot is not in the session.
 */
export function recordPlotGesture(plot, before, { coalesceKey } = {}) {
	if (!isSessionPlot(plot)) return null;
	return applyAsOneStep(opsSince(plot, before, { coalesceKey }), coalesceKey);
}

/**
 * Run `mutate()` (plain writes onto the live plots) and record everything it changed on
 * `plots` as ONE undo step. Plots not in the session are just mutated. `extraOps` are applied
 * in the same step (operations the edit needs that are not plot state, e.g. a facet override
 * conversion).
 *
 * `prepare`, when given, runs after the plots have been put back to where they were and
 * before anything is applied: it puts back whatever ELSE `mutate` changed (session state that
 * is not a plot, e.g. the palette) and returns the operations that redo it, applied first in
 * the same step.
 *
 * @param {object[]} plots Plot wrappers
 * @param {() => void} mutate
 * @param {{ coalesceKey?: string, extraOps?: object[], prepare?: () => object[] }} [opts]
 */
export function commitPlotsEdit(plots, mutate, { coalesceKey, extraOps = [], prepare } = {}) {
	const targets = [...new Set(plots ?? [])].filter(isSessionPlot);
	const befores = targets.map((p) => plotEditState(p));
	mutate();
	const plotOps = [];
	targets.forEach((p, i) => plotOps.push(...opsSince(p, befores[i], { coalesceKey })));
	const ops = [...extraOps, ...(prepare ? (prepare() ?? []) : []), ...plotOps];
	return applyAsOneStep(ops, coalesceKey);
}

/**
 * A gesture on several plots that previews before it commits (a typed number or text in the
 * multi-select panel): `begin` before the first preview write, then `commit` (one step, or
 * nothing when the values ended where they started) or `cancel` (back to where it began,
 * nothing recorded).
 */
export function createPlotsGesture() {
	let targets = null;
	let befores = null;
	return {
		get active() {
			return targets != null;
		},
		begin(plots) {
			if (targets) return;
			targets = [...new Set(plots ?? [])].filter(isSessionPlot);
			befores = targets.map((p) => plotEditState(p));
		},
		commit({ coalesceKey } = {}) {
			if (!targets) return null;
			const ops = [];
			targets.forEach((p, i) => ops.push(...opsSince(p, befores[i], { coalesceKey })));
			targets = befores = null;
			return applyAsOneStep(ops, coalesceKey);
		},
		cancel() {
			if (!targets) return;
			targets.forEach((p, i) => opsSince(p, befores[i]));
			targets = befores = null;
		}
	};
}

/**
 * Where `obj` lives in the session's plots: the plot and its wrapper path ('plot.overlays[1]',
 * 'plot.data[0].phaseMarkers[2]'), found by identity through the SAVED fields (each level's
 * toJSON keys, so a back-reference such as `parentPlot` is never followed). Null when no
 * session plot holds it.
 */
export function locateInPlots(obj, { maxDepth = 6 } = {}) {
	if (obj == null || typeof obj !== 'object') return null;
	const seen = new Set();
	function walk(node, path, depth) {
		if (node === obj) return path;
		if (node == null || typeof node !== 'object' || depth >= maxDepth || seen.has(node))
			return null;
		seen.add(node);
		if (Array.isArray(node)) {
			for (let i = 0; i < node.length; i++) {
				const hit = walk(node[i], `${path}[${i}]`, depth + 1);
				if (hit) return hit;
			}
			return null;
		}
		let keys;
		try {
			keys = Object.keys(typeof node.toJSON === 'function' ? (node.toJSON() ?? {}) : node);
		} catch {
			return null;
		}
		for (const key of keys) {
			let v;
			try {
				v = node[key];
			} catch {
				continue;
			}
			const hit = walk(v, join(path, key), depth + 1);
			if (hit) return hit;
		}
		return null;
	}
	for (const plot of core.plots ?? []) {
		const path = walk(plot?.plot, 'plot', 0);
		if (path) return { plot, path };
	}
	return null;
}

/**
 * Set `obj[key] = value` on an object inside a session plot (an overlay's name, a phase
 * marker's name, an annotation's name) as ONE undo step. An object no session plot holds is
 * written in place, unrecorded.
 */
export function commitObjectEdit(obj, key, value) {
	const at = locateInPlots(obj);
	if (!at) {
		if (obj) obj[key] = value;
		return null;
	}
	const before = plotEditState(at.plot);
	obj[key] = value;
	return recordPlotGesture(at.plot, before);
}
