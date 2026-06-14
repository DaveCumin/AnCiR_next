// src/lib/core/mutationService.test.js
// @ts-nocheck
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { mutationService as M } from './mutationService.js';
import { core, appConsts } from './core.svelte.js';

beforeAll(() => {
    // Same stubs as operations.test.js — kept independent so this test file can run alone.
    if (!appConsts.plotMap.has('scatterplot')) {
        appConsts.plotMap.set('scatterplot', {
            displayName: 'Scatterplot (test stub)',
            data: { fromJSON: (_plot, plotData) => plotData ?? {} }
        });
    }
});

beforeEach(() => {
    core.plots.length = 0;
    core.data.length = 0;
    for (const k of Object.keys(core.storedValues)) delete core.storedValues[k];
});

describe('mutationService', () => {
    it('addPlot creates a plot via applyOp and returns the instance', () => {
        const plot = M.addPlot({ type: 'scatterplot', x: 0, y: 0, width: 100, height: 100 });
        expect(plot).toBeTruthy();
        expect(typeof plot.id).toBe('number');
        expect(core.plots).toHaveLength(1);
        expect(core.plots[0]).toBe(plot);
    });

    it('setPlotProperty mutates the targeted key', () => {
        const plot = M.addPlot({ type: 'scatterplot', name: 'old', x: 0, y: 0, width: 1, height: 1 });
        M.setPlotProperty(plot.id, 'name', 'new');
        expect(core.plots[0].name).toBe('new');
    });

    it('setPlotPosition updates x/y/width/height', () => {
        const plot = M.addPlot({ type: 'scatterplot', x: 0, y: 0, width: 1, height: 1 });
        M.setPlotPosition(plot.id, { x: 50, y: 60, width: 200, height: 150 });
        expect(core.plots[0].x).toBe(50);
        expect(core.plots[0].y).toBe(60);
        expect(core.plots[0].width).toBe(200);
        expect(core.plots[0].height).toBe(150);
    });

    it('removePlot deletes the plot', () => {
        const plot = M.addPlot({ type: 'scatterplot', x: 0, y: 0, width: 1, height: 1 });
        M.removePlot(plot.id);
        expect(core.plots).toHaveLength(0);
    });

    it('setStoredValue + removeStoredValue work', () => {
        M.setStoredValue('tau', { staticValue: 24, source: 'manual' });
        expect(core.storedValues.tau.staticValue).toBe(24);
        M.removeStoredValue('tau');
        expect(core.storedValues.tau).toBeUndefined();
    });

    it('batch wraps multiple ops as a single applyOp call', () => {
        M.batch([
            { kind: 'addPlot', plotData: { type: 'scatterplot', x: 0, y: 0, width: 1, height: 1 } },
            { kind: 'addPlot', plotData: { type: 'scatterplot', x: 0, y: 0, width: 1, height: 1 } }
        ]);
        expect(core.plots).toHaveLength(2);
    });
});
