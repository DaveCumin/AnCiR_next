// @ts-nocheck
/**
 * Can this session be exported as R?
 *
 * The R runtime is STRICT: an analysis it does not implement aborts the generated script
 * rather than being skipped, because a script that quietly omits a step still writes a
 * plausible columns.csv, and a plausible file with a missing analysis is more dangerous than
 * no file. That protects the user who RUNS the script.
 *
 * This module protects the user who EXPORTS it, by checking coverage up front so the failure
 * arrives while they are still looking at the session that caused it — not later, in a
 * terminal, from a script they have already filed somewhere.
 *
 * Kept OUT of the sidecar deliberately. The check has to run before we decide to fetch the
 * sidecar at all, so it lives in the bundle; it is a few hundred bytes of name lists.
 */

import { R_IMPLEMENTED, R_COLUMN_PROCESSES } from '$lib/_parity/runtimeCoverage.js';

/**
 * Nodes that produce data from a seeded PRNG.
 *
 * Excluded from R by decision, not by omission: reproducing them means reimplementing
 * mulberry32 and every generator's draw order bit-exactly, and the failure mode of getting
 * it subtly wrong is silently different data. They get their own message because "not
 * implemented" and "deliberately not implemented, and here is the alternative" are different
 * things to tell someone.
 *
 * SequenceColumn and BlankColumn are deliberately NOT here, though they look like they
 * belong: a sequence is start + i*step and a blank column is a constant fill, so neither
 * touches a PRNG and both reproduce exactly. Listing them cost 20 of the 84 demo sessions
 * their R export for no reason — measured, which is how the mistake surfaced.
 */
export const R_GENERATOR_NODES = ['random', 'simulateddata'];

/** ColumnSet emits no columns and is resolved before export, so it never reaches a runtime. */
const RESOLVED_BEFORE_EXPORT = ['columnset'];

/** Normalise a stored node name ("Bin Data", "BinnedData") to its runtime key. */
export function runtimeKey(name) {
	return String(name ?? '')
		.toLowerCase()
		.replace(/\s+/g, '');
}

/**
 * @param {any} session parsed session object
 * @returns {{ok: boolean, missingAnalyses: string[], missingProcesses: string[],
 *            generators: string[]}}
 */
export function checkRSupport(session) {
	const missingAnalyses = new Set();
	const generators = new Set();
	const missingProcesses = new Set();

	const tps = [
		...(session?.tableProcesses ?? []),
		...(session?.tables ?? []).flatMap((t) => t.processes ?? [])
	];
	for (const tp of tps) {
		const key = runtimeKey(tp?.name);
		if (!key || RESOLVED_BEFORE_EXPORT.includes(key)) continue;
		if (R_GENERATOR_NODES.includes(key)) generators.add(tp.name);
		else if (!R_IMPLEMENTED.includes(key)) missingAnalyses.add(tp.name);
	}

	for (const col of session?.data ?? []) {
		for (const p of col?.processes ?? []) {
			const key = runtimeKey(p?.funcname ?? p?.name);
			if (!key) continue;
			if (!R_COLUMN_PROCESSES.includes(key)) missingProcesses.add(p?.funcname ?? p?.name);
		}
	}

	return {
		ok: missingAnalyses.size === 0 && generators.size === 0 && missingProcesses.size === 0,
		missingAnalyses: [...missingAnalyses].sort(),
		missingProcesses: [...missingProcesses].sort(),
		generators: [...generators].sort()
	};
}

/**
 * A message naming exactly what stops the export, and what to do instead.
 *
 * Says the specific node names rather than "some nodes": the user has to be able to find
 * them on the canvas. Always points at the Python export, which is complete.
 */
export function explainRSupport(report) {
	const parts = [];
	if (report.generators.length) {
		parts.push(
			`${report.generators.join(', ')} generate${report.generators.length === 1 ? 's' : ''} ` +
				`random data, which R cannot reproduce identically.`
		);
	}
	if (report.missingAnalyses.length) {
		parts.push(`The R runtime does not implement: ${report.missingAnalyses.join(', ')}.`);
	}
	if (report.missingProcesses.length) {
		parts.push(`It does not implement the column transform(s): ${report.missingProcesses.join(', ')}.`);
	}
	parts.push('Export as Python instead — the Python runtime covers the whole engine.');
	return parts.join(' ');
}
