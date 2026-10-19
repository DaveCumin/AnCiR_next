// @ts-nocheck
// A guard that every rename editor goes through the history.
//
// Until v82.10 renaming a group, plot, analysis or composite wrote the name straight onto the
// object (a live `onInput` write, or `bind:value={plot.name}`), so the rename was not an undo
// step and did not count as an unsaved change: New session or closing the tab lost it without
// a prompt. Column renames had the same bug until v82.9. Every editor now commits through
// nodeNaming.commitNodeRename / setNodeName (a renameNode operation) or, for a column,
// columnLabels.commitColumnRename (a renameColumn operation).
//
// A grep guard, because the failure mode is a new editor written the old way, which no
// behavioural test of the existing editors would notice. It finds every direct write of a
// `name`, `displayName` or `customName` (an assignment other than `this.x = ...` in a
// constructor, or a `bind:value` / `bind:title` on one) under src/lib and src/routes.
//
//   NOT_EDITORS   writes that are not a user renaming something (auto-naming a node's output
//                 columns, an import naming what it reads, the operations themselves, demo
//                 builders). Each has its reason. A new entry needs one too.
//   KNOWN_OFFENDERS  user rename editors that still write directly. A ratchet: it only ever
//                 shrinks. The count per file must match exactly, so a fixed file is removed.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, '..', '..'); // src/

const NOT_EDITORS = {
	'lib/core/operations.js': 'the renameColumn operation itself (and its inverse)',
	'lib/core/columnLabels.js': 'restoreAutoNameIfLabel, the auto-name restore the rename op uses',
	'lib/core/graphPatch.js': 'undo/redo restoring a node as it was captured',
	'lib/core/Column.svelte': 'Column.fromJSON building the constructor argument',
	'lib/core/TableProcess.svelte': "names a new analysis's output columns",
	'lib/components/workflow/WorkflowEditor.svelte': 'names a new tap column and a pasted copy',
	'lib/components/views/modals/ImportData.svelte': 'names the columns an import creates',
	'lib/components/iconActions/Setting.svelte':
		"session load: seeds a plot series wrapper's name from its column",
	'lib/components/plotbits/overlaySpec.js': 'builds an overlay from an AI or MCP spec',
	'lib/plots/Actogram/markerRuleActions.js': 'builds a marker rule patch for its operation',
	'lib/components/plotbits/Overlay.svelte':
		"names a split line's copies when they are created (its name editor commits through plotEdits)",
	'lib/plots/plotMetricOutputs.svelte.js': "names a plot's metric output columns",
	'lib/plots/styleConfig.js': 'builds a saved figure-style preset object',
	'lib/tableProcesses/metricOutputs.js': "names (and re-keys) an analysis's metric output columns",
	'lib/tableProcesses/useMultiYTP.svelte.js': "names an analysis's per-series output columns",
	'lib/workers/workerPool.js': 'rebuilds an Error from a worker (Error.name)',
	'lib/_demos/nodeCatalog.js': 'builds the demo sessions',
	'lib/_demos/nodeDemoBuilders.js': 'builds the demo sessions',
	'lib/tableProcesses/BlankColumn.svelte':
		"Enter Data mirrors its own grid header (recorded as the node's args) onto its outputs",
	'lib/tableProcesses/StoredValueGroup.svelte': 'names its output column and a new group',
	// Analyses naming the output columns they create (a recompute, not a user rename).
	'lib/tableProcesses/CollectColumns.svelte': 'names its output columns',
	'lib/tableProcesses/TrendFit.svelte': 'names its output columns',
	'lib/tableProcesses/ColumnFunctions.svelte': 'names its output columns',
	'lib/tableProcesses/DoubleLogistic.svelte': 'names its output columns',
	'lib/tableProcesses/RhythmicityAnalysis.svelte': 'names its output columns',
	'lib/tableProcesses/MovingAnalysis.svelte': 'names its output columns',
	'lib/tableProcesses/BinnedData.svelte': 'names its output columns',
	'lib/tableProcesses/WideToLong.svelte': 'names its output columns',
	'lib/tableProcesses/JoinData.svelte': 'names its output columns',
	'lib/tableProcesses/LongToWide.svelte': 'names its output columns',
	'lib/tableProcesses/Cosinor.svelte': 'names its output columns',
	'lib/tableProcesses/LogisticRegression.svelte': 'names its output columns',
	'lib/tableProcesses/RectangularWave.svelte': 'names its output columns',
	'lib/tableProcesses/Sort.svelte': 'names its output columns',
	'lib/tableProcesses/SmoothedData.svelte': 'names its output columns',
	'lib/tableProcesses/Split.svelte': 'names its output columns',
	'lib/tableProcesses/NonparametricRA.svelte': 'names its output columns',
	'lib/tableProcesses/AverageProfile.svelte': 'names its output columns',
	'lib/tableProcesses/FitFunction.svelte': 'names its output columns'
};

// User rename editors that still write directly. Empty since the overlay, phase-marker and
// annotation name editors moved to plots/plotEdits.commitObjectEdit (one setPlotFields
// operation on commit). Keep it empty: a new rename editor commits through an operation.
const KNOWN_OFFENDERS = {};

const ASSIGN =
	/(?<![\w$])(?!this\.)([\w$]+(?:\??\.[\w$]+|\[[^\]]*\])*)\.(name|displayName|customName)\s*=(?![=>])/g;
const BIND = /bind:(value|title)=\{[^}]*\.(name|displayName|customName)\}/g;
const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);

function sourceFiles(dir, out = []) {
	for (const entry of readdirSync(dir)) {
		if (entry === 'node_modules' || entry.startsWith('.')) continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) sourceFiles(full, out);
		else if (/\.(svelte|js)$/.test(entry) && !/\.test\.|\.spec\.|conflicted/.test(entry))
			out.push(full);
	}
	return out;
}

/** { file: [line, ...] } of every direct name write, keyed relative to src/. */
function directNameWrites() {
	const found = {};
	for (const file of [
		...sourceFiles(join(srcRoot, 'lib')),
		...sourceFiles(join(srcRoot, 'routes'))
	]) {
		const lines = readFileSync(file, 'utf8').split('\n');
		lines.forEach((line, i) => {
			if (isComment(line)) return;
			const hits = [...line.matchAll(ASSIGN), ...line.matchAll(BIND)];
			if (hits.length === 0) return;
			const rel = relative(srcRoot, file);
			(found[rel] ??= []).push(`${i + 1}: ${line.trim()}`);
		});
	}
	return found;
}

describe('every rename editor goes through an operation', () => {
	const found = directNameWrites();

	it('finds the writes it is meant to find (guards against a regex that matches nothing)', () => {
		expect(Object.keys(found).length).toBeGreaterThan(10);
		expect(found['lib/core/operations.js']?.length).toBeGreaterThan(0);
	});

	it('no new file writes a name directly', () => {
		const unexpected = Object.keys(found).filter(
			(f) => !(f in NOT_EDITORS) && !(f in KNOWN_OFFENDERS)
		);
		expect(
			Object.fromEntries(unexpected.map((f) => [f, found[f]])),
			'These files write a name, displayName or customName directly. A user rename must be\n' +
				'ONE operation on commit, so it is an undo step and an unsaved change:\n' +
				'  a canvas node (plot, analysis, process, group, composite): nodeNaming.commitNodeRename\n' +
				'  a column: columnLabels.commitColumnRename\n' +
				'Pass `value` (no bind:) and `onCommit` to the editor. A write that is not a rename\n' +
				'(naming a new output column) goes in NOT_EDITORS with its reason.'
		).toEqual({});
	});

	it('KNOWN_OFFENDERS only shrinks: each file has exactly the writes listed', () => {
		const counts = Object.fromEntries(
			Object.keys(KNOWN_OFFENDERS).map((f) => [f, found[f]?.length ?? 0])
		);
		expect(counts, 'Lower (or delete) the KNOWN_OFFENDERS entry for a file you fixed').toEqual(
			KNOWN_OFFENDERS
		);
	});

	it('every NOT_EDITORS file still has a write (a stale entry is removed)', () => {
		const stale = Object.keys(NOT_EDITORS).filter((f) => !found[f]);
		expect(stale).toEqual([]);
	});
});
