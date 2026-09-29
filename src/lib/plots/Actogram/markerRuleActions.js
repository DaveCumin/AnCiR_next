// @ts-nocheck
// The RECORDED marker-rule actions: each user gesture is exactly one undo step (plan
// 2026-09-30-actogram-marker-rules-and-outputs, section 4).
//
//   rule setting edit          setMarkerRule op, applied IN PLACE (no inner rebuild)
//   add / delete a rule        recordInnerEdit (the rule list changes)
//   detach / reattach          recordInnerEdit (series arrays change)
//   detach by an instance edit the detach and the edit inside ONE recordInnerEdit callback
//   promote                    recordInnerEdit, plus the promoted block's legacy stored values
//                              re-pointed at the rule's ports, in one atomicBatch
//   rename a rule              setMarkerRule + renameColumn per output column, one atomicBatch
//   delete a rule              setPlotInner + removeColumn per output column + setPlotMetricOut,
//                              one atomicBatch, so undo brings the columns back WITH THEIR IDS
//                              and every downstream wire with them
//
// The model (markerRules.svelte.js) mutates in place and knows nothing about history; this
// file is the only place the two meet. PhaseMarker.svelte reaches these through the
// actogram's delegate methods, because it cannot import this module without an import
// cycle (markerRules extends PhaseMarkerClass at module load).
import { core } from '$lib/core/core.svelte.js';
import { mutationService } from '$lib/core/mutationService.js';
import { history } from '$lib/core/opHistory.svelte.js';
import { addNotification } from '$lib/core/notifications.svelte.js';
import { recordInnerEdit, removeFromInnerWithUndo } from '$lib/plots/seriesDelete.js';
import { getColumnById } from '$lib/core/Column.svelte';
import { parseRuleOutputKey, plotMetricColumnName } from '$lib/plots/plotMetricDefs.js';
import { promoteStoredValueOps } from '$lib/core/phaseMarkerStoredValueMigration.js';
import {
	addRule,
	removeRule,
	reattachBlock,
	promoteBlock,
	canReattach,
	matchingBlocks,
	isRuleNameFree,
	RULE_SETTING_KEYS
} from './markerRules.svelte.js';

/** Whether the inner is the live inner of a plot in `core.plots` (so ops can find it). */
function isLive(inner) {
	const box = inner?.parentBox;
	return !!box && core.plots.includes(box) && box.plot === inner;
}

/**
 * Patch one rule's settings as ONE undo step, in place. Returns false when nothing changed
 * or the patch was refused (a taken name). Off the op layer (an inner not in `core.plots`,
 * e.g. in a unit test), the patch is applied directly, as recordInnerEdit does.
 */
export function setRuleSettings(inner, rule, patch) {
	const clean = {};
	for (const [k, v] of Object.entries(patch ?? {})) {
		if (RULE_SETTING_KEYS.includes(k)) clean[k] = v;
	}
	if ('name' in clean) {
		const name = typeof clean.name === 'string' ? clean.name.trim() : '';
		if (!name || !isRuleNameFree(inner, name, rule.id)) return false;
		clean.name = name;
	}
	if (clean.name === rule.name) delete clean.name;
	if (Object.keys(clean).length === 0) return false;
	if (!isLive(inner)) {
		Object.assign(rule, clean);
		return true;
	}
	// A rename also renames the rule's output columns, in place (same ids, so every wire
	// holds), in the same undo step. The port labels follow on their own (labelFor reads the
	// rule's name).
	const renames = 'name' in clean ? ruleColumnRenameOps(inner.parentBox, rule, clean.name) : [];
	const edit = { kind: 'setMarkerRule', id: inner.parentBox.id, ruleId: rule.id, patch: clean };
	if (renames.length > 0) return mutationService.atomicBatch([edit, ...renames]) != null;
	return mutationService.setMarkerRule(inner.parentBox.id, rule.id, clean) != null;
}

/** The output keys of one rule that the plot currently carries columns for. */
function ruleColumnKeys(plot, ruleId) {
	return Object.keys(plot?.metricOut ?? {}).filter((k) => parseRuleOutputKey(k)?.ruleId === ruleId);
}

/** renameColumn ops giving rule `rule`'s output columns the names `newName` implies. */
function ruleColumnRenameOps(plot, rule, newName) {
	const renamed = {
		type: plot.type,
		id: plot.id,
		plot: { markerRules: [{ id: rule.id, name: newName }] }
	};
	const ops = [];
	for (const key of ruleColumnKeys(plot, rule.id)) {
		const colId = plot.metricOut[key];
		if (!getColumnById(colId)) continue;
		ops.push({ kind: 'renameColumn', id: colId, name: plotMetricColumnName(renamed, key) });
	}
	return ops;
}

/**
 * The ops that take a deleted rule's output columns with it: each column removed by id
 * (its data stays in rawData, keyed by that id, so the inverse re-adds it intact) and the
 * plot's metric map without the rule's keys. Downstream consumers keep naming the column
 * ids; undo puts the columns back under those ids, which is what brings the wires back.
 */
function ruleColumnRemovalOps(plot, ruleId) {
	const keys = ruleColumnKeys(plot, ruleId);
	if (keys.length === 0) return [];
	const next = { ...plot.metricOut };
	const ops = [];
	for (const key of keys) {
		const colId = plot.metricOut[key];
		delete next[key];
		if (getColumnById(colId)) ops.push({ kind: 'removeColumn', id: colId });
	}
	return [{ kind: 'setPlotMetricOut', id: plot.id, metricOut: next }, ...ops];
}

/** Add a rule (one undo step). Returns the new rule's id. */
export function addRuleRecorded(inner, init = {}) {
	let id = null;
	recordInnerEdit(inner, (i) => {
		id = addRule(i, init).id;
	});
	return id;
}

/** Delete a rule (one undo step, with an Undo toast). */
export function removeRuleRecorded(inner, rule) {
	const plot = inner?.parentBox;
	removeFromInnerWithUndo(
		inner,
		(i) => removeRule(i, rule.id),
		`Marker rule "${rule.name}" removed from all series`,
		() => (isLive(inner) ? ruleColumnRemovalOps(plot, rule.id) : [])
	);
}

/**
 * Detach one series from its rule and apply `edit` to the new own block, as ONE undo step
 * with an Undo toast. `edit` may be omitted (the explicit Detach button).
 */
export function detachRecorded(inst, edit = null) {
	const series = inst.parentData.displayLabel;
	removeFromInnerWithUndo(
		inst.parentData.parentPlot,
		() => {
			const block = inst.detach();
			if (edit) edit(block);
		},
		`"${inst.cfg.name}" detached on series "${series}"`
	);
}

/** Reattach a detached block to its rule (one undo step). */
export function reattachRecorded(block) {
	if (!canReattach(block)) return false;
	const inner = block.parentData.parentPlot;
	recordInnerEdit(inner, () => reattachBlock(block));
	return true;
}

/**
 * Promote an own block into a rule for every series (one undo step, with an Undo toast).
 * When the block had selected markers outside its day range, the rule's fit (which the
 * range scopes, Decision 1a) no longer uses them, and the toast says so.
 */
export function promoteRecorded(block, { alsoReplace = [] } = {}) {
	const inner = block.parentData.parentPlot;
	const datum = block.parentData;
	const reg = block.linearRegression;
	const before = reg && typeof reg === 'object' ? [reg.slope, reg.intercept] : null;
	let name = '';
	let ruleId = null;
	let changed = false;
	const n = inner.data.length;
	// Where each promoted block sat (its legacy stored values name its series' cell).
	const promoted = [block, ...alsoReplace].map((b) => ({
		name: b.name,
		index: inner.data.indexOf(b.parentData)
	}));
	const mutate = () => {
		const rule = promoteBlock(block, { alsoReplace });
		name = rule.name;
		ruleId = rule.id;
		const inst = datum.ruleInstances.find((i) => i.ruleId === rule.id);
		const r2 = inst?.linearRegression;
		const after = r2 && typeof r2 === 'object' ? [r2.slope, r2.intercept] : null;
		changed =
			(before == null) !== (after == null) ||
			(before != null && before.some((v, k) => Math.abs(v - after[k]) > 1e-9));
	};
	// "Make rule" makes the block's legacy stored values live again (plan 5.2): a formula
	// using `tau_<block>` now reads the rule's tau column at that series, same undo step.
	const repoint = () =>
		isLive(inner)
			? promoteStoredValueOps(core.storedValues, promoted, {
					plotId: inner.parentBox.id,
					ruleId,
					ruleName: name
				})
			: [];
	const result = recordInnerEdit(inner, mutate, repoint);
	if (!result) return;
	const note = changed
		? ' Its fit now uses only the days inside its range, so its values changed on this series.'
		: '';
	toastWithUndo(result.recorded, `Marker rule "${name}" now applies to all ${n} series.${note}`);
}

/** Own blocks on other series with the same settings (the promote offer, plan 5.1). */
export { matchingBlocks, canReattach };

// A toast with an Undo that works only while `recorded` is the top of the undo stack
// (the same contract removeFromInnerWithUndo keeps; see seriesDelete.js).
function toastWithUndo(recorded, message) {
	if (!recorded) {
		addNotification(message, 'info', 6000);
		return;
	}
	const isTop = () => history.undoStack[history.undoStack.length - 1] === recorded;
	addNotification(message, 'info', 6000, {
		label: 'Undo',
		enabled: isTop,
		run: () => {
			if (isTop()) history.undo();
		}
	});
}
