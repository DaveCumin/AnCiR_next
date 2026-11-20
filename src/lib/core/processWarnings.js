// @ts-nocheck
/**
 * Warnings for COLUMN-PROCESS nodes (free dataflow nodes and inline legacy
 * processes — node.type 'process' in the workflow graph, carrying a Process
 * instance in node.processObj).
 *
 * Table-process nodes publish `tp.warnings` from their editor's compute
 * effects; column processes have no long-lived editor doing the computing —
 * `doProcess` runs inside reactive reads (Column.getData, producerRuntime),
 * where writing $state would be an unsafe mutation. So their warnings are
 * DERIVED at render time instead: a process definition may export an optional
 * pure `getWarnings(p) -> string[]` hook, and the node components call it
 * from a $derived. The hook reads the same reactive inputs the compute reads
 * (columns, args), so the badge updates with the data and can never go stale;
 * nothing is persisted.
 *
 * Defensive by design: a hook that throws must not take the canvas down, so
 * failures render as "no warnings", never as an error.
 */
import { appConsts } from '$lib/core/core.svelte.js';
import { refusedInputWarnings } from '$lib/core/processInputRules.js';

export function processNodeWarnings(p) {
	if (!p?.name) return [];
	// An input of a type the process refuses (a saved session wired before the rule) is
	// passed through, and said so, for every process (core/processInputRules.js).
	let refused = [];
	try {
		refused = refusedInputWarnings(p);
	} catch {
		refused = [];
	}
	const getWarnings = appConsts.processMap.get(p.name)?.definition?.getWarnings;
	if (typeof getWarnings !== 'function') return refused;
	try {
		return [...refused, ...(getWarnings(p) ?? [])];
	} catch {
		return refused;
	}
}
