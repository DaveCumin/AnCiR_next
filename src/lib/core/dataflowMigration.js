// src/lib/core/dataflowMigration.js
// @ts-nocheck
//
// Phase 4 of the "columns are just node outputs" migration: convert a column's
// legacy inline `processes[]` pipeline into a chain of free operation nodes
// (core.orphanProcesses) + producer columns.
//
// Safe topology: the column KEEPS its id and final value. We build the chain from
// the column's pre-process source, create intermediate producer columns for all
// but the last step, and re-point the column itself to be the LAST node's
// producer. Because getData() and the column id are preserved, every existing
// consumer (plots, refs, table-processes) keeps working with no rewiring and no
// cycle risk. Migrating columns in any order is safe for the same reason.
//
// Handled: plain raw source columns and plain ref columns. Deferred (skipped,
// left as inline so nothing becomes invisible): tap columns, TP-output columns,
// and columns already in the producer model.

import { core, createOrphanProcess } from './core.svelte.js';
import { Column } from './Column.svelte';

function cloneArgs(args) {
	return JSON.parse(JSON.stringify(args ?? {}));
}

// Can this column's inline processes be migrated by the safe topology above?
function isMigratable(col) {
	if (!col) return false;
	if ((col.processes ?? []).length === 0) return false;
	if (col.producerNodeId != null) return false; // already dataflow
	if (col.tableProcessGUId) return false; // TP-output column — deferred
	if (col.isTap || col.refUpToProcessId != null) return false; // tap — deferred
	// Plain raw column (has rawData) or plain ref column (refId set).
	return col.data != null || col.refId != null;
}

/**
 * Migrate one column's inline processes into free nodes + producer columns.
 * Returns true if migrated. The column ends up as the final node's producer.
 */
export function migrateColumnProcesses(col) {
	if (!isMigratable(col)) return false;

	const procs = [...col.processes];

	// The chain's first input is the column's PRE-process source:
	//  - raw column: a new sibling source column holding the same rawData,
	//    carrying the original (raw) name so the source stays recognisable.
	//  - ref column: the referenced column itself.
	let inputColId;
	if (col.data != null) {
		const source = new Column({
			data: col.data,
			type: col.type,
			timeFormat: col.timeFormat,
			compression: col.compression,
			originTime_ms: col.originTime_ms
		});
		source.customName = col.customName ?? col.name;
		core.data.push(source);
		inputColId = source.id;
	} else {
		// ref column: source is the referenced column.
		inputColId = col.refId;
	}

	const colType = col.type;

	for (let i = 0; i < procs.length; i++) {
		const p = procs[i];
		const node = createOrphanProcess(p.name, { ...cloneArgs(p.args), inIN: [inputColId] });
		if (!node) return false;
		const port = `out_${inputColId}`;
		if (i < procs.length - 1) {
			const mid = new Column({
				type: colType,
				producerNodeId: `process_${node.id}`,
				producerPort: port,
				producerArtifactKind: 'column'
			});
			core.data.push(mid);
			inputColId = mid.id;
		} else {
			// Last step: re-point THIS column to be the final node's producer.
			col.processes = [];
			col.data = null;
			col.refId = null;
			col.customName = null; // derive "<source> → Op → …"
			col.producerNodeId = `process_${node.id}`;
			col.producerPort = port;
			col.producerArtifactKind = 'column';
		}
	}
	return true;
}

/**
 * Migrate every eligible column's inline processes. Safe to call on session load;
 * a no-op for sessions already in the dataflow model. Returns counts.
 */
export function migrateAllInlineProcesses() {
	let migrated = 0;
	let deferred = 0;
	// Snapshot the list: migration pushes new columns we must not re-scan.
	for (const col of [...(core.data ?? [])]) {
		if ((col.processes ?? []).length === 0) continue;
		if (migrateColumnProcesses(col)) migrated++;
		else deferred++;
	}
	return { migrated, deferred };
}
