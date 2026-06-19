// src/lib/core/producerRuntime.js
// @ts-nocheck
//
// Producer runtime — the seed of the "columns are just node outputs" model.
//
// In the legacy model a Column owns an ordered `processes[]` pipeline and
// computes its own value by running that chain (see Column.#computePipeline).
// In the dataflow model a Column is instead a thin *handle* onto the output of
// some node: it carries `producerNodeId` / `producerPort` / `producerArtifactKind`
// and asks the producing node for its value. The operation lives free on the
// canvas (e.g. in core.orphanProcesses) rather than being owned by the column.
//
// This module resolves a (producerNodeId, port) reference to a data array. It is
// deliberately additive: the legacy pipeline still works untouched. Column only
// takes this path when `producerNodeId` is set and the column has no rawData of
// its own. See docs note 2026-06-19-columns-as-node-outputs.md for the full plan.
//
// IMPORTANT: this module must NOT import Column.svelte — Column imports from here,
// so importing back would create a cycle. It reads the live objects off `core`
// instead (core.orphanProcesses are Process instances; core.data are Column
// instances), and calls their existing methods (doProcess / getData).

import { core } from './core.svelte.js';

// Parse a free-process producer id ("process_<n>") to its numeric process id.
// Returns null for any other producer-node shape (tableprocess_, data_, …),
// which this slice does not yet resolve.
export function freeProcessIdFromProducer(producerNodeId) {
	if (typeof producerNodeId !== 'string') return null;
	const m = /^process_(\d+)$/.exec(producerNodeId);
	return m ? Number(m[1]) : null;
}

function findFreeProcess(producerNodeId) {
	const pid = freeProcessIdFromProducer(producerNodeId);
	if (pid == null) return null;
	return (core.orphanProcesses ?? []).find((p) => p.id === pid) ?? null;
}

/**
 * The free process node that produces a column's value, or null. Exposed so
 * Column can build a descriptive name from the producing op + its input.
 */
export function getProducerProcess(producerNodeId) {
	return findFreeProcess(producerNodeId);
}

function findColumn(id) {
	if (id == null) return null;
	return (core.data ?? []).find((c) => c.id === id) ?? null;
}

// Re-entrancy guard. A producer whose input resolves (directly or transitively)
// back to itself would recurse forever; we break the cycle and degrade to [].
const _inFlight = new Set();

/**
 * Resolve the data produced by a node port.
 *
 * Currently handles free single-input processes (producerNodeId === "process_<n>"
 * with producerPort "output"/"column"): it reads the process's declared input
 * column from `proc.args.inIN`, fetches that column's data, and runs the process
 * function over it. Unknown producers or broken refs degrade to [] — matching the
 * broken-ref / broken-tap convention used throughout Column.
 *
 * @param {string} producerNodeId  e.g. "process_5"
 * @param {string} [producerPort]  e.g. "output" (accepted: output | column)
 * @returns {Array} the produced data array (possibly empty)
 */
export function resolveProducer(producerNodeId, producerPort = 'output') {
	if (producerPort != null && producerPort !== 'output' && producerPort !== 'column') {
		// This slice only models the single "result" output of a process node.
		return [];
	}

	const proc = findFreeProcess(producerNodeId);
	if (!proc) return [];

	if (_inFlight.has(producerNodeId)) {
		console.warn('producerRuntime: cycle detected at', producerNodeId, '— returning [].');
		return [];
	}

	_inFlight.add(producerNodeId);
	try {
		const inputCol = findColumn(proc.args?.inIN);
		if (!inputCol) return [];
		const input = inputCol.getData() ?? [];
		return proc.doProcess(input);
	} finally {
		_inFlight.delete(producerNodeId);
	}
}

/**
 * Register reactive dependencies for a producer-sourced column so its getData()
 * cache (keyed on Column.getDataHash) busts when the upstream node or its input
 * changes. Called from Column.getDataHash. Performs only reactive *reads*; the
 * return value is unused.
 *
 * Mirrors the dependency-touching that the legacy pipeline does for its own
 * processes (process name + a deep walk of args + the ref column's hash).
 */
export function touchProducerDeps(producerNodeId) {
	const proc = findFreeProcess(producerNodeId);
	if (!proc) return;
	// Reading these inside the $derived body registers them as dependencies.
	proc.name;
	_touch(proc.args);
	const inputCol = findColumn(proc.args?.inIN);
	inputCol?.getDataHash;
}

// Walk a reactive tree registering a dependency on each leaf, without allocating
// a string. Same idea as Column._touchTree (kept private there).
function _touch(v) {
	if (v == null || typeof v !== 'object') return;
	if (Array.isArray(v)) {
		for (let i = 0; i < v.length; i++) _touch(v[i]);
		return;
	}
	for (const k in v) _touch(v[k]);
}
