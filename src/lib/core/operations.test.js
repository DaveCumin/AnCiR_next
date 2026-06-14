// src/lib/core/operations.test.js
// @ts-nocheck
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { addOpListener, withSuppressedListeners, applyOp } from './operations.js';
import { appConsts, core } from './core.svelte.js';
import { Column } from './Column.svelte';
import { Table } from './Table.svelte';

beforeAll(() => {
    // Register a minimal stub for 'scatterplot' so Plot's constructor can
    // resolve appConsts.plotMap.get(this.type) without pulling in the real
    // (Svelte-rendered) scatterplot component.
    if (!appConsts.plotMap.has('scatterplot')) {
        appConsts.plotMap.set('scatterplot', {
            displayName: 'Scatterplot (test stub)',
            data: {
                fromJSON: (_plot, plotData) => plotData ?? {}
            }
        });
    }
    if (!appConsts.processMap.has('Normalize')) {
        appConsts.processMap.set('Normalize', {
            displayName: 'Normalize (test stub)',
            defaults: new Map([['normalizationType', { val: 'z-score' }]]),
            func: (data, args) => data // no-op
        });
    }
    if (!appConsts.tableProcessMap.has('BinnedData')) {
        appConsts.tableProcessMap.set('BinnedData', {
            displayName: 'BinnedData (test stub)',
            defaults: new Map([['binSize', { val: 60 }]]),
            func: () => null, // no-op; new TableProcess() calls this for side-effects
            columnIdFields: { scalar: [], array: [] }
        });
    }
});

describe('applyOp listener plumbing', () => {
    it('addOpListener returns an unsubscribe function', () => {
        const seen = [];
        const off = addOpListener((f, r) => seen.push({ f, r }));
        expect(typeof off).toBe('function');
        off();
    });

    it('withSuppressedListeners runs the callback', () => {
        let ran = false;
        withSuppressedListeners(() => {
            ran = true;
        });
        expect(ran).toBe(true);
    });
});

describe('applyOp: plot ops', () => {
    beforeEach(() => {
        core.plots.length = 0;
    });

    it('addPlot inserts a plot and returns removePlot as inverse', () => {
        const inv = applyOp({
            kind: 'addPlot',
            plotData: { type: 'scatterplot', x: 0, y: 0, width: 500, height: 300 }
        });
        expect(core.plots).toHaveLength(1);
        expect(typeof core.plots[0].id).toBe('number');
        expect(inv).toEqual({ kind: 'removePlot', id: core.plots[0].id });
    });

    it('removePlot deletes a plot and returns addPlot as inverse', () => {
        applyOp({
            kind: 'addPlot',
            plotData: { type: 'scatterplot', x: 10, y: 20, width: 400, height: 250 }
        });
        const id = core.plots[0].id;
        const inv = applyOp({ kind: 'removePlot', id });
        expect(core.plots).toHaveLength(0);
        expect(inv.kind).toBe('addPlot');
        expect(inv.plotData.id).toBe(id);
    });

    it('setPlotProperty changes a key and returns the reverse', () => {
        applyOp({
            kind: 'addPlot',
            plotData: { type: 'scatterplot', name: 'old', x: 0, y: 0, width: 1, height: 1 }
        });
        const id = core.plots[0].id;
        const inv = applyOp({ kind: 'setPlotProperty', id, key: 'name', value: 'new' });
        expect(core.plots[0].name).toBe('new');
        expect(inv).toEqual({ kind: 'setPlotProperty', id, key: 'name', value: 'old' });
    });

    it('setPlotPosition changes coords and returns the previous coords', () => {
        applyOp({
            kind: 'addPlot',
            plotData: { type: 'scatterplot', x: 0, y: 0, width: 100, height: 100 }
        });
        const id = core.plots[0].id;
        const inv = applyOp({ kind: 'setPlotPosition', id, x: 50, y: 60 });
        expect(core.plots[0].x).toBe(50);
        expect(core.plots[0].y).toBe(60);
        expect(inv.kind).toBe('setPlotPosition');
        expect(inv.x).toBe(0);
        expect(inv.y).toBe(0);
    });
});

describe('applyOp: column + process ops', () => {
    beforeEach(() => {
        core.data.length = 0;
    });

    it('addColumn pushes a column and returns removeColumn', () => {
        const inv = applyOp({
            kind: 'addColumn',
            columnData: { name: 'X', type: 'number' }
        });
        expect(core.data).toHaveLength(1);
        expect(typeof core.data[0].id).toBe('number');
        expect(inv).toEqual({ kind: 'removeColumn', id: core.data[0].id });
    });

    it('removeColumn removes and inverse re-adds with the same id', () => {
        applyOp({ kind: 'addColumn', columnData: { name: 'X', type: 'number' } });
        const id = core.data[0].id;
        const inv = applyOp({ kind: 'removeColumn', id });
        expect(core.data).toHaveLength(0);
        expect(inv.kind).toBe('addColumn');
        expect(inv.columnData.id).toBe(id);
    });

    it('addProcess appends and returns removeProcess', () => {
        applyOp({ kind: 'addColumn', columnData: { name: 'X', type: 'number' } });
        const colId = core.data[0].id;
        const inv = applyOp({
            kind: 'addProcess',
            columnId: colId,
            processType: 'Normalize',
            args: { normalizationType: 'z-score' }
        });
        const col = core.data.find((c) => c.id === colId);
        expect(col.processes).toHaveLength(1);
        expect(typeof col.processes[0].id).toBe('number');
        expect(inv).toEqual({ kind: 'removeProcess', columnId: colId, processId: col.processes[0].id });
    });

    it('setProcessArg updates an arg and returns the previous value', () => {
        applyOp({ kind: 'addColumn', columnData: { name: 'X', type: 'number' } });
        const colId = core.data[0].id;
        applyOp({
            kind: 'addProcess',
            columnId: colId,
            processType: 'Normalize',
            args: { normalizationType: 'z-score' }
        });
        const procId = core.data[0].processes[0].id;
        const inv = applyOp({
            kind: 'setProcessArg',
            columnId: colId,
            processId: procId,
            key: 'normalizationType',
            value: 'min-max'
        });
        expect(core.data[0].processes[0].args.normalizationType).toBe('min-max');
        expect(inv.value).toBe('z-score');
    });
});

describe('applyOp: table + tableprocess ops', () => {
    beforeEach(() => {
        core.tables.length = 0;
        core.data.length = 0; // TableProcess construction may try to read columns
    });

    it('addTable inserts and returns removeTable', () => {
        const inv = applyOp({
            kind: 'addTable',
            tableData: { name: 'T', columnRefs: [] }
        });
        expect(core.tables).toHaveLength(1);
        expect(typeof core.tables[0].id).toBe('number');
        expect(inv).toEqual({ kind: 'removeTable', id: core.tables[0].id });
    });

    it('removeTable removes and inverse re-adds with same id', () => {
        applyOp({ kind: 'addTable', tableData: { name: 'T', columnRefs: [] } });
        const id = core.tables[0].id;
        const inv = applyOp({ kind: 'removeTable', id });
        expect(core.tables).toHaveLength(0);
        expect(inv.kind).toBe('addTable');
        expect(inv.tableData.id).toBe(id);
    });

    it('addTableProcess appends and returns removeTableProcess', () => {
        applyOp({ kind: 'addTable', tableData: { name: 'T', columnRefs: [] } });
        const tableId = core.tables[0].id;
        const inv = applyOp({
            kind: 'addTableProcess',
            tableId,
            tpType: 'BinnedData',
            args: { binSize: 60, out: {} }
        });
        const t = core.tables.find((x) => x.id === tableId);
        expect(t.processes).toHaveLength(1);
        expect(typeof t.processes[0].id).toBe('number');
        expect(inv).toEqual({ kind: 'removeTableProcess', tableId, tpId: t.processes[0].id });
    });

    it('setTableProcessArg returns the previous value', () => {
        applyOp({ kind: 'addTable', tableData: { name: 'T', columnRefs: [] } });
        const tableId = core.tables[0].id;
        applyOp({
            kind: 'addTableProcess',
            tableId,
            tpType: 'BinnedData',
            args: { binSize: 60, out: {} }
        });
        const tpId = core.tables[0].processes[0].id;
        const inv = applyOp({
            kind: 'setTableProcessArg',
            tableId,
            tpId,
            key: 'binSize',
            value: 120
        });
        expect(core.tables[0].processes[0].args.binSize).toBe(120);
        expect(inv.value).toBe(60);
    });
});
