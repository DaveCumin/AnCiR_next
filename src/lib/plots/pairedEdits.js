// @ts-nocheck
// Paired edits: a plot field whose change must also rewrite OTHER fields.
//
// The FFT's `showPeriod` is the case that made this necessary. Its x limits are stored in the
// units of the current mode, so switching from period to frequency must turn [4, 30] into
// [1/30, 1/4]. Only the Properties checkbox used to; the multi-select shared field and an AI
// edit wrote the flag alone, and the axis then read 4 to 0.5 with nothing drawn.
//
// A plot class declares such a field once:
//
//   static pairedEdits = {
//     showPeriod: {
//       apply(target, value) -> boolean   set the field and convert its partners; true when
//                                          anything was converted. `target` is the live inner
//                                          OR its toJSON snapshot, so use plain fields only.
//       override(entry) -> entry | null   optional: the same conversion for one facet panel's
//                                          override entry (core/facetOverrides.js), or null
//                                          when the entry holds nothing to convert
//     }
//   };
//
// and every route that EDITS a field goes through here: `applyInnerEdits` for a batch of
// plain writes (the AI edit's snapshot, the MCP render settings), `editPlotInners` for a user
// edit on live plots (the Properties control, the multi-select panel), which also makes the
// edit one undo step. A paired edit on a live plot is recorded as a setPlotInner op (the
// whole inner, before and after) so undo restores the field AND its partners together.
//
// Routes that APPLY a state (fromJSON on load and undo, the facet panel mirror) do not come
// here: their partner fields are already consistent with the field, and converting them
// again would corrupt them. That is why this is not a property setter.
import { setByPath } from '$lib/utils/objectPath.js';
import { applyOp } from '$lib/core/operations.js';
import { core } from '$lib/core/core.svelte.js';

/**
 * The paired-edit hook for one inner path, or null for an ordinary field.
 *
 * @param {Function|null|undefined} cls the plot's inner class
 * @param {string} innerPath a path into the inner ('showPeriod'), no `plot.` head
 */
export function pairedEditFor(cls, innerPath) {
	const hooks = cls?.pairedEdits;
	if (!hooks || !Object.prototype.hasOwnProperty.call(hooks, innerPath)) return null;
	return hooks[innerPath];
}

/**
 * Apply plain field writes to a plot inner, live or a JSON snapshot of it.
 *
 * Paired fields go FIRST, whatever order the edits came in: limits given together with a mode
 * switch ("frequency, 0 to 0.1") are in the new mode, so the switch must convert the old
 * limits before the given ones overwrite them, never after.
 *
 * @param {object} target the inner (or its snapshot)
 * @param {{ path: string, value: unknown }[]} edits inner paths
 * @param {Function} [cls] the inner's class; needed when `target` is a snapshot
 * @returns {{ path: string, hook: object, changed: boolean }[]} the paired edits applied
 */
export function applyInnerEdits(target, edits, cls = target?.constructor) {
	const paired = [];
	const plain = [];
	for (const e of edits ?? []) (pairedEditFor(cls, e.path) ? paired : plain).push(e);
	const applied = [];
	for (const { path, value } of paired) {
		const hook = pairedEditFor(cls, path);
		applied.push({ path, hook, changed: hook.apply(target, value) === true });
	}
	for (const { path, value } of plain) setByPath(target, path, value);
	return applied;
}

/**
 * The setFacetOverride ops that carry a paired conversion into a facet generator's panel
 * overrides, one per path that changed (a removed path is an op with no value).
 *
 * @param {object} plot the Plot wrapper
 * @param {ReturnType<typeof applyInnerEdits>} applied
 */
export function facetOverrideOps(plot, applied) {
	const ops = [];
	const map = plot?.facetOverrides;
	if (!map || typeof map !== 'object') return ops;
	for (const { hook, changed } of applied) {
		if (!changed || typeof hook.override !== 'function') continue;
		for (const [unitKey, entry] of Object.entries(map)) {
			const next = hook.override(entry);
			if (!next) continue;
			for (const path of new Set([...Object.keys(entry), ...Object.keys(next)])) {
				const had = Object.prototype.hasOwnProperty.call(entry, path);
				const has = Object.prototype.hasOwnProperty.call(next, path);
				if (had && has && JSON.stringify(entry[path]) === JSON.stringify(next[path])) continue;
				const op = { kind: 'setFacetOverride', id: plot.id, unitKey, path };
				if (has) op.value = next[path];
				ops.push(op);
			}
		}
	}
	return ops;
}

/**
 * A user edit of one inner path on live plots. An ordinary field is written in place, as the
 * panels always have. A paired field is one undoable step for all the plots: a setPlotInner
 * per plot (the snapshot with the conversion applied) plus any facet override conversions.
 * A plot that is not in the session (a detached instance, e.g. in a test or the MCP renderer)
 * has no history, so it is edited in place through the same hook.
 *
 * @param {object[]} plots Plot wrappers
 * @param {string} innerPath a path into the inner ('showPeriod'), no `plot.` head
 * @param {unknown} value
 */
export function editPlotInners(plots, innerPath, value) {
	const ops = [];
	for (const plot of plots ?? []) {
		const inner = plot?.plot;
		if (!inner) continue;
		const cls = inner.constructor;
		if (!pairedEditFor(cls, innerPath) || !core.plots.includes(plot)) {
			applyInnerEdits(inner, [{ path: innerPath, value }], cls);
			continue;
		}
		const json = JSON.parse(JSON.stringify(inner.toJSON()));
		const applied = applyInnerEdits(json, [{ path: innerPath, value }], cls);
		if (!applied.some((a) => a.changed)) {
			// Nothing to convert (the plot was already in that mode): a plain write, no op.
			applyInnerEdits(inner, [{ path: innerPath, value }], cls);
			continue;
		}
		ops.push(
			{ kind: 'setPlotInner', id: plot.id, inner: json },
			...facetOverrideOps(plot, applied)
		);
	}
	if (ops.length) applyOp({ kind: 'batch', ops });
}
