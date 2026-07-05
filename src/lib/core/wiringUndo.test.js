// src/lib/core/wiringUndo.test.js
// @ts-nocheck
// Regression: node input wiring (plots + free-process removal) must be undoable.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { history } from './opHistory.svelte.js';
import { mutationService as M } from './mutationService.js';
import { applyOp } from './operations.js';
import { core, appConsts } from './core.svelte.js';

beforeAll(() => {
    // Stub plot type whose inner data object round-trips columnRefs through
    // toJSON / fromJSON, mirroring the real Tableplot contract op_setPlotInner
    // relies on.
    if (!appConsts.plotMap.has('stubplot')) {
        appConsts.plotMap.set('stubplot', {
            displayName: 'Stub plot',
            data: {
                fromJSON: (_parent, json) => ({
                    columnRefs: [...(json?.columnRefs ?? [])],
                    toJSON() {
                        return { columnRefs: this.columnRefs };
                    }
                })
            }
        });
    }
    history.init();
});

beforeEach(() => {
    history.clear();
    core.plots.length = 0;
    core.data.length = 0;
    core.tableProcesses.length = 0;
    core.orphanProcesses.length = 0;
});

describe('plot input wiring is undoable (setPlotInner)', () => {
    it('records, undoes, and redoes a plot-data edit', () => {
        const plot = M.addPlot({ type: 'stubplot', name: 'p', plot: { columnRefs: [] } });
        history.clear();

        // Simulate the recorded outcome of wiring a column (id 7) into the plot.
        M.setPlotInner(plot.id, { columnRefs: [7] });
        expect(plot.plot.columnRefs).toEqual([7]);
        expect(history.undoCount).toBe(1);

        history.undo();
        expect(plot.plot.columnRefs).toEqual([]); // wire removed

        history.redo();
        expect(plot.plot.columnRefs).toEqual([7]); // wire restored
    });

    it('undo restores the exact prior series set', () => {
        const plot = M.addPlot({ type: 'stubplot', name: 'p', plot: { columnRefs: [1, 2] } });
        history.clear();
        M.setPlotInner(plot.id, { columnRefs: [1, 2, 3] });
        history.undo();
        expect(plot.plot.columnRefs).toEqual([1, 2]);
    });
});

describe('plot geometry + name edits are undoable', () => {
    it('setPlotProperty records a name change and undo/redo restores it', () => {
        const plot = M.addPlot({ type: 'stubplot', name: 'first', plot: { columnRefs: [] } });
        history.clear();
        M.setPlotProperty(plot.id, 'name', 'second');
        expect(plot.name).toBe('second');
        expect(history.undoCount).toBe(1);
        history.undo();
        expect(plot.name).toBe('first');
        history.redo();
        expect(plot.name).toBe('second');
    });

    it('setPlotPosition records a resize and undo restores the prior size', () => {
        const plot = M.addPlot({ type: 'stubplot', name: 'p', width: 200, height: 150, plot: {} });
        history.clear();
        M.setPlotPosition(plot.id, { width: 400, height: 300 });
        expect([plot.width, plot.height]).toEqual([400, 300]);
        expect(history.undoCount).toBe(1);
        history.undo();
        expect([plot.width, plot.height]).toEqual([200, 150]);
        history.redo();
        expect([plot.width, plot.height]).toEqual([400, 300]);
    });

    it('atomicBatch groups a multi-plot move into ONE undo step', () => {
        const a = M.addPlot({ type: 'stubplot', name: 'a', x: 0, y: 0, plot: {} });
        const b = M.addPlot({ type: 'stubplot', name: 'b', x: 0, y: 0, plot: {} });
        history.clear();
        // Mirror Draggable's onPointerUp: end coords in the ops, models reverted first.
        a.x = 0; a.y = 0;
        b.x = 0; b.y = 0;
        M.atomicBatch([
            { kind: 'setPlotPosition', id: a.id, x: 40, y: 10 },
            { kind: 'setPlotPosition', id: b.id, x: 60, y: 20 }
        ]);
        expect([a.x, a.y, b.x, b.y]).toEqual([40, 10, 60, 20]);
        expect(history.undoCount).toBe(1); // single step for the whole group
        history.undo();
        expect([a.x, a.y, b.x, b.y]).toEqual([0, 0, 0, 0]);
        history.redo();
        expect([a.x, a.y, b.x, b.y]).toEqual([40, 10, 60, 20]);
    });
});

describe('free-process input removal is undoable (atomicBatch)', () => {
    it('clears inIN + drops the producer column as ONE undo step', () => {
        // Orphan (free) process with one wired input column (id 3) and its paired
        // producer output column.
        // Read the proxied element back so reads/writes go through Svelte's
        // $state proxy, exactly as the live editor and the op layer see it.
        core.orphanProcesses.push({ id: 42, name: 'Normalize', args: { inIN: [3] } });
        const proc = core.orphanProcesses[core.orphanProcesses.length - 1];
        const producer = M.addColumn({
            type: 'number',
            producerNodeId: 'process_42',
            producerPort: 'out_3',
            producerArtifactKind: 'column'
        });
        history.clear();

        // Mirror _removeProcInput's atomic batch: clear inIN + remove producer.
        M.atomicBatch([
            { kind: 'setOrphanProcessArg', processId: 42, key: 'inIN', value: [] },
            { kind: 'removeColumn', id: producer.id }
        ]);
        expect(proc.args.inIN).toEqual([]);
        expect(core.data.some((c) => c.id === producer.id)).toBe(false);
        expect(history.undoCount).toBe(1); // single atomic step

        history.undo();
        expect(proc.args.inIN).toEqual([3]); // input restored
        expect(core.data.some((c) => c.id === producer.id)).toBe(true); // producer restored

        history.redo();
        expect(proc.args.inIN).toEqual([]);
        expect(core.data.some((c) => c.id === producer.id)).toBe(false);
    });
});
