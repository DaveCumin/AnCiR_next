// src/lib/core/operations.test.js
// @ts-nocheck
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { addOpListener, withSuppressedListeners, applyOp } from './operations.js';
import { appConsts, core } from './core.svelte.js';

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
