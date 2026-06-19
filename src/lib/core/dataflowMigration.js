// src/lib/core/dataflowMigration.js
// @ts-nocheck
//
// Phase 4 of the "columns are just node outputs" migration: convert a column's
// legacy inline `processes[]` pipeline into a chain of free operation nodes
// (core.orphanProcesses) + producer columns, on session load.
//
// Topology ("keep the source, derive the result"): the column KEEPS its identity
// (raw / ref / TP-output) and simply loses its inline processes — it becomes the
// pre-process SOURCE. Each process becomes a free node producing a derived column;
// the chain reads the source. Existing consumers of the column (which expected the
// PROCESSED value) are repointed to the final derived column via replaceColumnRefs.
//
// This works uniformly for every column type because the chain reads the column's
// getData() rather than its internals, and because replaceColumnRefs repoints
// column refs / table-process args / plot refs but NOT node inIN — so the chain's
// own reference to the source is never rewritten (no cycle).
//
// Tap columns (refUpToProcessId) are re-anchored to the producer column that now
// represents that step of the source's pipeline.

import { core, createOrphanProcess, replaceColumnRefs } from './core.svelte.js';
import { Column } from './Column.svelte';

function cloneArgs(args) {
	return JSON.parse(JSON.stringify(args ?? {}));
}

/**
 * Migrate one column's inline processes into a chain of free nodes + producer
 * columns, repointing consumers to the final derived column. Records each
 * process id → its producer column id in `stepMap` (for tap re-anchoring).
 * Returns true if migrated.
 */
export function migrateColumnProcesses(col, stepMap) {
	if (!col) return false;
	const procs = [...(col.processes ?? [])];
	if (procs.length === 0) return false;
	if (col.producerNodeId != null) return false; // already in the dataflow model

	const producerType = col.type;
	let inputColId = col.id; // the chain reads the column itself (the source)
	let lastDerivedId = col.id;

	for (const p of procs) {
		const node = createOrphanProcess(p.name, { ...cloneArgs(p.args), inIN: [inputColId] });
		if (!node) return false;
		const derived = new Column({
			type: producerType,
			producerNodeId: `process_${node.id}`,
			producerPort: `out_${inputColId}`,
			producerArtifactKind: 'column'
		});
		core.data.push(derived);
		if (stepMap) stepMap.set(p.id, derived.id);
		inputColId = derived.id;
		lastDerivedId = derived.id;
	}

	// The column is now just the source; drop its inline pipeline.
	col.processes = [];
	// Existing consumers wanted the PROCESSED value → repoint them to the final
	// derived column. The chain's own inIN references are untouched (no cycle).
	replaceColumnRefs(lastDerivedId, col.id);
	return true;
}

/**
 * Migrate every column's inline processes. Idempotent — a no-op for sessions
 * already in the dataflow model. Tap columns are re-anchored after the main pass.
 * Returns counts.
 */
export function migrateAllInlineProcesses() {
	const stepMap = new Map(); // original process id → producer column id
	let migrated = 0;

	// Pass 1: non-tap columns (build the stepMap the taps will re-anchor against).
	for (const col of [...(core.data ?? [])]) {
		if (col.isTap || (col.refUpToProcessId != null && col.refUpToProcessId !== -1)) continue;
		if (migrateColumnProcesses(col, stepMap)) migrated++;
	}

	// Pass 2: re-anchor taps. "X up to process P" becomes a plain ref to the
	// producer column that now represents X's value after P.
	for (const col of [...(core.data ?? [])]) {
		if (col.refUpToProcessId != null && col.refUpToProcessId !== -1) {
			const producerId = stepMap.get(col.refUpToProcessId);
			if (producerId != null) {
				col.refId = producerId;
				col.refUpToProcessId = null;
				col.isTap = false;
			}
		}
	}

	// Pass 3: migrate any remaining inline processes (e.g. a re-anchored tap that
	// also carried its own processes).
	for (const col of [...(core.data ?? [])]) {
		if (migrateColumnProcesses(col, stepMap)) migrated++;
	}

	return { migrated };
}
