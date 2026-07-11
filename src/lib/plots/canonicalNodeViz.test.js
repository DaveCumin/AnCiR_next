import { describe, it, expect, beforeEach } from 'vitest';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { loadTableProcesses } from '$lib/tableProcesses/tableProcessMap.js';
import { canonicalNodeViz, plotDataFromSpec } from './canonicalNodeViz.js';

beforeEach(async () => {
	core.data = [];
	core.rawData = new Map();
	appConsts.tableProcessMap = await loadTableProcesses();
});

// Minimal fake nodes (the shape WorkflowEditor's allNodes exposes).
function fitNode(name, { xIN, yIN, out }) {
	return { id: `tableprocess_1`, type: 'tableprocess', tpObj: { id: 1, name, args: { xIN, yIN, out } } };
}

describe('canonicalNodeViz', () => {
	it('fit TP (Cosinor) → data+fit scatter: raw points + fitted line per Y', () => {
		// Cosinor declares xOutKey:'cosinorx', yOutKeyPrefix:'cosinory_'.
		const node = fitNode('Cosinor', {
			xIN: 10,
			yIN: [20],
			out: { cosinorx: 30, cosinory_20: 40, period: 50 }
		});
		const spec = canonicalNodeViz(node);
		expect(spec.type).toBe('scatterplot');
		// series[0] = raw (points, x=10,y=20); series[1] = fit (line, x=30,y=40)
		expect(spec.series[0]).toMatchObject({ x: 10, y: 20, kind: 'points' });
		expect(spec.series[1]).toMatchObject({ x: 30, y: 40, kind: 'line' });
	});

	it('GroupComparison → boxplot with sig bars', () => {
		const node = fitNode('GroupComparison', { xIN: 11, yIN: [22], out: {} });
		const spec = canonicalNodeViz(node);
		expect(spec).toMatchObject({ type: 'boxplot', box: { x: 11, y: 22 }, showSigBars: true });
	});

	it('RayleighTest → circular phase plot: one series per Y, time from timeIN', () => {
		const node = { id: 'tableprocess_2', type: 'tableprocess', tpObj: { id: 2, name: 'RayleighTest', args: { timeIN: 7, yIN: [21, 22], out: {} } } };
		const spec = canonicalNodeViz(node);
		expect(spec.type).toBe('circularphase');
		expect(spec.series).toEqual([
			{ x: 7, y: 21, label: expect.any(String) },
			{ x: 7, y: 22, label: expect.any(String) }
		]);
	});

	it('RayleighTest with no timeIN → circular series with x = -1', () => {
		const node = { id: 'tableprocess_3', type: 'tableprocess', tpObj: { id: 3, name: 'RayleighTest', args: { timeIN: -1, yIN: [21], out: {} } } };
		expect(canonicalNodeViz(node).series[0]).toMatchObject({ x: -1, y: 21 });
	});

	it('other TP → tableplot fallback of inputs + numeric outputs', () => {
		// MovingAnalysis has no xOutKey/yOutKeyPrefix (not a fit node), so it
		// should fall through to the generic tableplot fallback.
		const node = fitNode('MovingAnalysis', { xIN: 1, yIN: [2], out: { a: 3, b: 4 } });
		const spec = canonicalNodeViz(node);
		expect(spec.type).toBe('tableplot');
		expect(spec.columnRefs).toEqual(expect.arrayContaining([1, 2, 3, 4]));
	});

	it('returns null for a plot node', () => {
		expect(canonicalNodeViz({ id: 'plot_1', type: 'plot', plotObj: {} })).toBeNull();
	});

	it('fit TP with no x wired → falls back to tableplot (no broken scatter)', () => {
		const node = { id: 'tableprocess_9', type: 'tableprocess', tpObj: { id: 9, name: 'Cosinor', args: { xIN: -1, yIN: [20], out: { cosinory_20: 40, period: 50 } } } };
		const spec = canonicalNodeViz(node);
		expect(spec.type).toBe('tableplot');
	});
});

describe('plotDataFromSpec', () => {
	it('scatterplot spec → addPlot payload with refId-wired series + sourceNodeId', () => {
		const spec = {
			type: 'scatterplot',
			title: 'Cosinor: data + fit',
			series: [
				{ x: 10, y: 20, label: 'y', kind: 'points', colour: '#234154' },
				{ x: 30, y: 40, label: 'y fit', kind: 'line', colour: '#BE796B' }
			]
		};
		const pd = plotDataFromSpec(spec, { x: 800, y: 60, sourceNodeId: 'tableprocess_1' });
		expect(pd).toMatchObject({ name: 'Cosinor: data + fit', type: 'scatterplot', x: 800, y: 60, sourceNodeId: 'tableprocess_1' });
		expect(pd.plot.data[0]).toMatchObject({ x: { refId: 10 }, y: { refId: 20 } });
		expect(pd.plot.data[1].line.draw).toBe(true);   // fit series is a line
		expect(pd.plot.data[0].points.draw).toBe(true); // raw series is points
	});

	it('boxplot + tableplot specs → correct inner shapes', () => {
		const box = plotDataFromSpec({ type: 'boxplot', title: 't', box: { x: 1, y: 2 }, showSigBars: true }, { x: 0, y: 0 });
		expect(box.plot).toMatchObject({ data: [{ x: { refId: 1 }, y: { refId: 2 } }], showSigBars: true });
		const tbl = plotDataFromSpec({ type: 'tableplot', title: 't', columnRefs: [1, 2, 3] }, { x: 0, y: 0 });
		expect(tbl.plot).toMatchObject({ columnRefs: [1, 2, 3], showCol: [true, true, true] });
	});

	it('circularphase spec → data series wired {x:time, y:phase}', () => {
		const cp = plotDataFromSpec(
			{ type: 'circularphase', title: 'c', series: [{ x: 7, y: 21, label: 'a' }, { x: -1, y: 22, label: 'b' }] },
			{ x: 0, y: 0 }
		);
		expect(cp.type).toBe('circularphase');
		expect(cp.plot.data).toEqual([
			{ x: { refId: 7 }, y: { refId: 21 }, label: 'a' },
			{ x: { refId: -1 }, y: { refId: 22 }, label: 'b' }
		]);
	});
});
