// @ts-nocheck
/**
 * Wiring rules for the input of a FREE column process (a dataflow node whose input
 * fans out: every column wired in gets its own paired output, `out_<colId>`).
 *
 * Two per-process rules, both declared on the process definition's input port
 * (`definition.nodeSpec.inputs[0]`), next to each other:
 *
 *  - `disallowTypes: ['time', …]`  column types the input refuses outright
 *    (Substitute refuses time: it matches raw UNIX-ms values).
 *  - `sameType: true | false`      whether every column wired into the input must
 *    share one type. The settings of most column processes are in the INPUT'S
 *    units (Add 5 adds 5 to a number but 5 hours to a time; an outlier threshold,
 *    a normalisation range, a substitute value), so one shared setting cannot be
 *    right for a time column and a number column at once. A process whose settings
 *    are not in the input's units (Filter: its conditions test OTHER columns) can
 *    declare `sameType: false` and take a mix, each input keeping its own type.
 *
 * `sameType` defaults to TRUE when a process does not declare it, so a new process
 * is safe until its author decides a mix is meaningful.
 *
 * Enforced by every path that wires a column into a free process: the canvas
 * (WorkflowEditor.connectColumnToInput, and a splice onto a wire) and the side panel's
 * input picker (CanvasNodeControls.setProcessInputs). The MCP add_column_process tool
 * attaches to ONE column, so only `disallowTypes` applies there (mcp/src/engine/session.js).
 *
 * A column wired before its type was refused (a saved session) still loads: the process
 * passes that input through unchanged (Process.doProcess, `refusesInputType`) and the node
 * shows the refusal as a warning (`refusedInputWarnings`, through processWarnings.js), rather
 * than computing on a time column's raw epoch milliseconds.
 */
import { core, appConsts } from '$lib/core/core.svelte.js';

function inputSpecOf(entry) {
	return entry?.definition?.nodeSpec?.inputs?.[0] ?? entry?.nodeSpec?.inputs?.[0] ?? null;
}

/** Column types the process's input refuses (declared `disallowTypes`), else []. */
export function disallowedInputTypes(entry) {
	const types = inputSpecOf(entry)?.disallowTypes;
	return Array.isArray(types) ? types : [];
}

/** True unless the process declares `sameType: false` on its input (the safe default). */
export function requiresSameTypeInputs(entry) {
	return inputSpecOf(entry)?.sameType !== false;
}

/**
 * Why a column of type `newType` cannot join a process input that already holds
 * columns of `existingTypes`; null when it can. Pure.
 *
 * @param {object} entry  the process's registry entry (appConsts.processMap value)
 * @param {string} label  the process's display name, for the message
 * @param {string|null|undefined} newType
 * @param {Array<string|null|undefined>} existingTypes
 * @returns {string|null}
 */
export function inputTypeRefusal(entry, label, newType, existingTypes = []) {
	if (newType == null) return null;
	if (disallowedInputTypes(entry).includes(newType)) {
		return `${label} doesn't support ${newType} columns yet.`;
	}
	if (!requiresSameTypeInputs(entry)) return null;
	const other = existingTypes.find((t) => t != null && t !== newType);
	if (other != null) {
		return (
			`${label} inputs must all be the same type (already ${other}), ` +
			`because its settings are in the inputs' units.`
		);
	}
	return null;
}

/**
 * Why column `colId` cannot be wired into free process `proc`, whose input already
 * holds `currentIds`; null when it can. Reads the live registry and columns.
 */
export function processInputRefusal(proc, colId, currentIds = []) {
	if (!proc) return null;
	const entry = appConsts.processMap?.get(proc.name);
	const label = proc.displayName || entry?.displayName || proc.name;
	const typeOf = (id) => (core.data ?? []).find((c) => c.id === id)?.type;
	const existing = currentIds.filter((id) => id !== colId).map(typeOf);
	return inputTypeRefusal(entry, label, typeOf(colId), existing);
}

/** True when `entry` (a registry entry) refuses columns of `type` (declared `disallowTypes`). */
export function refusesInputType(entry, type) {
	return type != null && disallowedInputTypes(entry).includes(type);
}

/**
 * Warnings for a process whose input already holds a column of a type it refuses (wired
 * before the rule existed, in a saved session): the standard refusal, and that the input
 * passes through unchanged. [] when nothing refused is wired. Reads the live registry.
 */
export function refusedInputWarnings(proc) {
	if (!proc?.name) return [];
	const entry = appConsts?.processMap?.get(proc.name);
	if (!disallowedInputTypes(entry).length) return [];
	const label = proc.displayName || entry?.displayName || proc.name;
	let cols;
	if (proc.parentCol) cols = [proc.parentCol];
	else {
		const raw = proc.args?.inIN;
		const ids = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
		cols = ids.map((id) => (core?.data ?? []).find((c) => c.id === id)).filter(Boolean);
	}
	const out = [];
	for (const type of new Set(cols.map((c) => c.type))) {
		if (!refusesInputType(entry, type)) continue;
		const n = cols.filter((c) => c.type === type).length;
		out.push(
			`${inputTypeRefusal(entry, label, type)} ` +
				(n === 1
					? `Its ${type} input passes through unchanged.`
					: `Its ${type} inputs pass through unchanged.`)
		);
	}
	return out;
}
