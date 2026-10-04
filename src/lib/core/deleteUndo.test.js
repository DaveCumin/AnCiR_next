// src/lib/core/deleteUndo.test.js
// @ts-nocheck
//
// Every deletion is one undo step that restores what it removed EXACTLY: ids, args, output
// column ids, stored data and every downstream reference (review ROB-3, ROB-4, ROB-15,
// ROB-16, ROB-18, ROB-19, UI-2). Runs against the real node registries, because the cascades
// under test (output reconcile, per-node input fields) read them.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { history } from './opHistory.svelte.js';
import { mutationService as M } from './mutationService.js';
import {
	core,
	appConsts,
	deleteOperationNode,
	createNote,
	removeNote,
	createGroup,
	removeGroup,
	createComposite,
	removeComposite,
	createOrphanProcess,
	outputCoreAsJson
} from './core.svelte.js';
import { removeColumn, getColumnById } from './Column.svelte';
import { deleteTableProcess } from './TableProcess.svelte';
import { reconcileOutputs } from './reconcileOutputs.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';
import { buildTableProcessDefaults } from './tpDefaults.js';

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
	history.init();
}, 120000);

beforeEach(() => {
	core.plots.length = 0;
	core.data.length = 0;
	core.tableProcesses.length = 0;
	core.orphanProcesses.length = 0;
	core.notes.length = 0;
	core.groups.length = 0;
	core.composites.length = 0;
	core.chainRefs = [];
	core.rawData = new Map();
	history.clear();
});

const json = (v) => JSON.parse(JSON.stringify(v));

/** A raw data column with its own stored series, the way import makes one. */
function dataColumn(name, values = [1, 2, 3]) {
	const col = M.addColumn({ name, type: 'number' });
	col.data = col.id;
	core.rawData.set(col.id, values);
	return col;
}

function binned(xId, yIds) {
	const defaults = buildTableProcessDefaults(appConsts.tableProcessMap.get('BinnedData'));
	return M.addFreeTableProcess('BinnedData', { ...defaults, xIN: xId, yIN: yIds });
}

function tablePlot(columnRefs) {
	const p = M.addPlot({ type: 'tableplot', name: 'P', x: 0, y: 0, width: 300, height: 200 });
	M.setPlotInner(p.id, { columnRefs });
	return core.plots.find((q) => q.id === p.id);
}

/** Everything the user could see change: structure, wiring and data. */
function graphState() {
	return {
		data: core.data.map((c) => json(c)),
		tps: core.tableProcesses.map((t) => json(t)),
		orphans: core.orphanProcesses.map((p) => json(p)),
		plots: core.plots.map((p) => ({ id: p.id, plot: json(p.plot), metricOut: json(p.metricOut) })),
		notes: json(core.notes),
		groups: json(core.groups),
		composites: json(core.composites),
		// Map insertion order is not something a user sees; the keys and values are.
		raw: [...core.rawData.entries()].map(([k, v]) => [k, json(v)]).sort((p, q) => p[0] - q[0])
	};
}

/** Build the analysis chain used by several tests: x, A → Bin #1 → Bin #2, and a plot. */
function analysisChain() {
	const x = dataColumn('x', [0, 1, 2]);
	const a = dataColumn('A', [5, 6, 7]);
	const tp1 = binned(x.id, [a.id]);
	const outX = tp1.args.out.binnedx;
	const outY = tp1.args.out[`binnedy_${a.id}`];
	core.rawData.set(outY, [55, 66]); // what the node's compute would have written
	const tp2 = binned(outX, [outY]);
	const plot = tablePlot([outY, a.id]);
	return { x, a, tp1, tp2, outX, outY, plot };
}

describe('deleting an analysis node (ROB-3 / UI-2)', () => {
	it('records ONE step; undo restores node, outputs, data and downstream wiring exactly', () => {
		const { tp1, tp2, outX, outY, plot } = analysisChain();
		const before = graphState();
		const steps = history.undoCount;

		deleteOperationNode({ type: 'tableprocess', tpObj: tp1 });

		expect(history.undoCount).toBe(steps + 1);
		expect(core.tableProcesses.map((t) => t.id)).toEqual([tp2.id]);
		expect(getColumnById(outY)).toBeUndefined();
		expect(core.rawData.has(outY)).toBe(false); // freed, not kept for the save file
		expect(tp2.args.xIN).toBe(-1);
		expect(tp2.args.yIN).toEqual([]);
		expect(plot.plot.columnRefs).not.toContain(outY);

		history.undo();

		expect(graphState()).toEqual(before);
		const restored = core.tableProcesses.find((t) => t.id === tp1.id);
		expect(restored.args.out.binnedx).toBe(outX);
		expect(restored.args.out[`binnedy_${core.data[1].id}`]).toBe(outY);
		expect(core.rawData.get(outY)).toEqual([55, 66]);
		expect(core.plots[0].plot.columnRefs).toEqual([outY, core.data[1].id]);
	});

	it('redo deletes it again and a second undo still restores it', () => {
		const { tp1 } = analysisChain();
		const before = graphState();
		deleteOperationNode({ type: 'tableprocess', tpObj: tp1 });
		const afterDelete = graphState();
		history.undo();
		history.redo();
		expect(graphState()).toEqual(afterDelete);
		history.undo();
		expect(graphState()).toEqual(before);
	});

	it('the step before the delete is untouched by its undo', () => {
		const { tp1, plot } = analysisChain();
		M.setPlotProperty(plot.id, 'name', 'renamed');
		deleteOperationNode({ type: 'tableprocess', tpObj: tp1 });
		history.undo();
		expect(core.plots[0].name).toBe('renamed');
		expect(core.tableProcesses.some((t) => t.id === tp1.id)).toBe(true);
	});

	it("the node editor's own delete (deleteTableProcess) is one undoable step too", () => {
		const { tp1 } = analysisChain();
		const before = graphState();
		const steps = history.undoCount;
		deleteTableProcess(tp1);
		expect(history.undoCount).toBe(steps + 1);
		history.undo();
		expect(graphState()).toEqual(before);
	});

	it('the op form (removeFreeTableProcess) scrubs and restores downstream references too', () => {
		const { tp1, tp2, outY } = analysisChain();
		const before = graphState();
		M.removeFreeTableProcess(tp1.id);
		expect(tp2.args.yIN).toEqual([]);
		expect(core.plots[0].plot.columnRefs).not.toContain(outY);
		history.undo();
		expect(graphState()).toEqual(before);
	});
});

describe('deleting a free process node bridges, and undo un-bridges', () => {
	it('restores the process, its output column and the consumer wired to it', () => {
		const src = dataColumn('src');
		const proc = createOrphanProcess('Add', { value: 1, inIN: [src.id] });
		const outCol = M.addColumn({
			type: 'number',
			producerNodeId: `process_${proc.id}`,
			producerPort: `out_${src.id}`,
			producerArtifactKind: 'column'
		});
		const plot = tablePlot([outCol.id]);
		history.clear();
		const before = graphState();

		deleteOperationNode({ type: 'process', id: `process_${proc.id}`, refId: proc.id });
		expect(history.undoCount).toBe(1);
		expect(core.orphanProcesses).toHaveLength(0);
		expect(plot.plot.columnRefs).toEqual([src.id]); // bridged to the input

		history.undo();
		expect(graphState()).toEqual(before);
		expect(core.plots[0].plot.columnRefs).toEqual([outCol.id]);
	});

	it('spawning a free process through record() is undoable', () => {
		const proc = M.record(() => createOrphanProcess('Add', {}));
		expect(history.undoCount).toBe(1);
		history.undo();
		expect(core.orphanProcesses.some((p) => p.id === proc.id)).toBe(false);
		history.redo();
		expect(core.orphanProcesses.map((p) => p.id)).toEqual([proc.id]);
	});
});

describe('notes, groups and composites', () => {
	it('a deleted note comes back with its id and text', () => {
		const id = createNote({ text: 'important', x: 5, y: 6 });
		const before = graphState();
		removeNote(id);
		expect(history.undoCount).toBe(1);
		history.undo();
		expect(graphState()).toEqual(before);
		expect(core.notes[0].text).toBe('important');
	});

	it('a deleted group comes back with its member columns in order', () => {
		const a = dataColumn('a');
		const b = dataColumn('b');
		const gid = createGroup({ name: 'G' });
		core.groups[0].sourceColumnIds = [b.id, a.id];
		history.clear();
		const before = graphState();
		removeGroup(gid);
		expect(core.groups).toHaveLength(0);
		history.undo();
		expect(graphState()).toEqual(before);
		expect(core.groups[0].sourceColumnIds).toEqual([b.id, a.id]);
	});

	it('an uncombined composite comes back with its members and interface', () => {
		const cid = createComposite({
			memberIds: ['tableprocess_1', 'tableprocess_2'],
			interface: { inputs: [{ id: 'i1' }], outputs: [] }
		});
		const before = graphState();
		removeComposite(cid);
		history.undo();
		expect(graphState()).toEqual(before);
	});
});

describe('multi-select delete is one undo step', () => {
	it('three different kinds deleted in one gesture undo together', () => {
		const { tp1 } = analysisChain();
		const noteId = createNote({ text: 'n' });
		const lone = dataColumn('lone');
		history.clear();
		const before = graphState();
		M.record(() => {
			deleteOperationNode({ type: 'tableprocess', tpObj: tp1 });
			removeNote(noteId);
			M.removeColumn(lone.id);
		});
		expect(history.undoCount).toBe(1);
		history.undo();
		expect(graphState()).toEqual(before);
		expect(history.canUndo).toBe(false);
	});
});

describe('deleting a wire into an analysis, then undoing (ROB-4)', () => {
	it('restores the per-input output column with the same id, its data and the plot wire', () => {
		const { a, tp1, outY } = analysisChain();
		history.clear();
		const before = graphState();

		// What the canvas's disconnectInputPort / removeEdge do, as one recorded gesture.
		M.record(() => {
			tp1.args.yIN = [];
			reconcileOutputs(tp1, removeColumn);
		});
		expect(history.undoCount).toBe(1);
		expect(getColumnById(outY)).toBeUndefined();
		expect(core.plots[0].plot.columnRefs).toEqual([a.id]);

		history.undo();
		expect(graphState()).toEqual(before);
		expect(tp1.args.yIN).toEqual([a.id]);
		expect(tp1.args.out[`binnedy_${a.id}`]).toBe(outY);
		expect(getColumnById(outY)).toBeTruthy();
		expect(core.plots[0].plot.columnRefs).toContain(outY);
	});
});

describe('removing a column scrubs references, and undo restores them (ROB-15 / ROB-19)', () => {
	it('plot refs, analysis inputs and free-process inputs lose the id; undo puts them back', () => {
		const c = dataColumn('X');
		const plot = tablePlot([c.id]);
		const tp = binned(c.id, [c.id]);
		const proc = createOrphanProcess('Add', { value: 0, inIN: [c.id] });
		history.clear();
		const before = graphState();

		M.removeColumn(c.id);
		expect(plot.plot.columnRefs).toEqual([]);
		expect(tp.args.xIN).toBe(-1);
		expect(tp.args.yIN).toEqual([]);
		expect(core.orphanProcesses.find((p) => p.id === proc.id).args.inIN).toEqual([]);

		history.undo();
		expect(graphState()).toEqual(before);
	});

	it("a deleted column's data leaves core and the saved session, and undo brings it back", () => {
		const c = dataColumn('secret', [42, 43, 44]);
		M.removeColumn(c.id);
		expect(core.rawData.has(c.id)).toBe(false);
		const saved = JSON.parse(outputCoreAsJson());
		expect(String(c.id) in saved.rawData).toBe(false);
		history.undo();
		expect(core.rawData.get(c.id)).toEqual([42, 43, 44]);
		expect(getColumnById(c.id).getData()).toEqual([42, 43, 44]);
	});

	it('a plot delete takes its metric columns, and undo restores both', () => {
		const metric = dataColumn('Onsets_tau_0', [24.1]);
		const p = M.addPlot({ type: 'tableplot', name: 'A', x: 0, y: 0, width: 1, height: 1 });
		core.plots[0].metricOut = { r1_tau: metric.id };
		history.clear();
		M.removePlot(p.id);
		expect(getColumnById(metric.id)).toBeUndefined();
		history.undo();
		expect(core.plots[0].metricOut).toEqual({ r1_tau: metric.id });
		expect(getColumnById(metric.id).getData()).toEqual([24.1]);
	});
});

describe('a column sharing another column’s data key (ROB-16)', () => {
	it('deleting the original does not wipe the copy', () => {
		// Sessions pasted by older versions carry copies whose `data` is the original's key.
		const orig = dataColumn('o', [1, 2, 3]);
		const copy = M.addColumn({ name: 'o copy', type: 'number', data: orig.id });
		M.removeColumn(orig.id);
		expect(copy.getData()).toEqual([1, 2, 3]);
	});
});

describe('analysis-parameter drags coalesce (ROB-18)', () => {
	it('rapid edits of one key on one free table process are one undo step', () => {
		const tp = binned(-1, []);
		history.clear();
		M.setFreeTableProcessArg(tp.id, 'binSize', 11);
		M.setFreeTableProcessArg(tp.id, 'binSize', 12);
		M.setFreeTableProcessArg(tp.id, 'binSize', 13);
		expect(history.undoCount).toBe(1);
		history.undo();
		expect(tp.args.binSize).not.toBe(13);
		expect(tp.args.binSize).not.toBe(11);
	});

	it('edits of different keys stay separate', () => {
		const tp = binned(-1, []);
		history.clear();
		M.setFreeTableProcessArg(tp.id, 'binSize', 11);
		M.setFreeTableProcessArg(tp.id, 'binStart', 3);
		expect(history.undoCount).toBe(2);
	});
});

describe("a gesture's step includes the graph's reaction to it", () => {
	// Found in the browser: deleting the last wire into a Rhythmicity node dropped its per-input
	// outputs synchronously, then the node's editor removed its summary outputs a microtask
	// later and the parameter watcher recorded that `out` write as a SECOND step. One Ctrl+Z
	// reverted only the `out` write, leaving an output map that named columns that were gone.
	it('a reaction that removes a column and rewrites `out` folds into the same undo step', async () => {
		const { paramDiffWatcher } = await import('./paramDiffWatcher.svelte.js');
		const { flushSync } = await import('svelte');
		paramDiffWatcher.init();
		try {
			const { a, tp1 } = analysisChain();
			const summary = M.addColumn({ name: 'summary', type: 'number' });
			tp1.args.out.summary = summary.id;
			flushSync();
			await new Promise((r) => setTimeout(r, 0));
			history.clear();
			const before = graphState();

			M.record(() => {
				tp1.args.yIN = [];
				reconcileOutputs(tp1, removeColumn);
				// The node's own reaction, as its editor runs it: later, and unrecorded.
				queueMicrotask(() => {
					removeColumn(summary.id);
					const rest = { ...tp1.args.out };
					delete rest.summary;
					tp1.args.out = rest;
				});
			});
			await new Promise((r) => setTimeout(r, 0));
			flushSync();
			await new Promise((r) => setTimeout(r, 0));

			expect(getColumnById(summary.id)).toBeUndefined();
			expect(history.undoCount).toBe(1);

			history.undo();
			expect(graphState()).toEqual(before);
			expect(tp1.args.yIN).toEqual([a.id]);
			expect(getColumnById(summary.id)).toBeTruthy();
		} finally {
			paramDiffWatcher._disposeForTests();
		}
	});

	it('an undo before the step has settled still reverses the reaction', async () => {
		const { a, tp1 } = analysisChain();
		const summary = M.addColumn({ name: 'summary', type: 'number' });
		tp1.args.out.summary = summary.id;
		history.clear();
		const before = graphState();
		M.record(() => {
			tp1.args.yIN = [];
			reconcileOutputs(tp1, removeColumn);
			queueMicrotask(() => removeColumn(summary.id));
		});
		await Promise.resolve(); // the reaction has run; the macrotask that settles has not
		expect(getColumnById(summary.id)).toBeUndefined();
		history.undo();
		expect(graphState()).toEqual(before);
		expect(tp1.args.yIN).toEqual([a.id]);
	});
});
