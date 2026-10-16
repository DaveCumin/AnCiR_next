// @ts-nocheck
// Axis control edits as undo steps (the shared Axis controls, components/plotbits/Axis.svelte).
//
// The axis controls used to bind straight to the AxisClass (`bind:value={axisData.label}`), so a
// label, gridlines, tick count or manual-tick edit was not on the undo history and did not count
// as an unsaved change. Each committed edit is now ONE setPlotInnerField operation on the plot
// that owns the axis, written in place (no rebuild of the plot): a typed label on Enter or blur
// (not per keystroke), a checkbox or a select on change, a tick-count spinner per step (a run of
// steps on one field coalesces into one undo step, opHistory).
//
// The control only holds the axis object, so the owning plot and the axis's field name are
// found by identity: the plot in the session whose inner has that object in an axis field. An
// axis no session plot owns (a detached plot in a test, the MCP renderer) is edited in place,
// unrecorded, as before.
import { core } from '$lib/core/core.svelte.js';
import { applyOp } from '$lib/core/operations.js';

/** The inner's fields that can hold an axis: own ones and the class's $state accessors. */
function axisFieldNames(inner) {
	const names = new Set(Object.keys(inner).filter((k) => /axis/i.test(k)));
	for (let proto = Object.getPrototypeOf(inner); proto && proto !== Object.prototype; ) {
		for (const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(proto))) {
			if (d.get && /axis/i.test(k)) names.add(k);
		}
		proto = Object.getPrototypeOf(proto);
	}
	return names;
}

/** The session plot owning `axis`, and the inner field it is in; null when none does. */
export function locateAxis(axis) {
	if (!axis || typeof axis !== 'object') return null;
	for (const plot of core.plots ?? []) {
		const inner = plot?.plot;
		if (!inner || typeof inner !== 'object') continue;
		for (const field of axisFieldNames(inner)) {
			if (inner[field] === axis) return { plot, field };
		}
	}
	return null;
}

/**
 * Commit one axis setting (`label`, `gridlines`, `nticks`, `manualTicks`): one undo step and an
 * unsaved change on a session plot, a plain write otherwise. Returns the inverse op, or null.
 * `coalesce` (a number spinner): a quick run of edits of this setting is one undo step.
 */
export function commitAxisEdit(axis, key, value, { coalesce = false } = {}) {
	const at = locateAxis(axis);
	if (!at) {
		if (axis) axis[key] = value;
		return null;
	}
	return applyOp({
		kind: 'setPlotInnerField',
		id: at.plot.id,
		path: `${at.field}.${key}`,
		value,
		...(coalesce ? { coalesce: true } : {})
	});
}
