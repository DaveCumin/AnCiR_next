// Column transforms (column processes) and plot creation through the real registry.
import { beforeAll, describe, expect, it } from 'vitest';
import { AncirSession, ensureRegistry, describeCapabilities } from '../src/engine/session.js';

const seq = (n, f) => Array.from({ length: n }, (_, i) => f(i));

beforeAll(async () => {
	await ensureRegistry();
});

describe('capability catalogue includes transforms and plots', () => {
	it('lists column transforms and plot types with inputs', () => {
		const caps = describeCapabilities();
		const tIds = caps.transforms.map((t) => t.id);
		// A stable subset of column processes (the registry adapts to whatever exists).
		expect(tIds).toEqual(expect.arrayContaining(['Add', 'Multiply', 'normalize']));
		const scatter = caps.plots.find((p) => p.id === 'scatterplot');
		expect(scatter.inputs).toEqual(['x', 'y']);
	});
});

describe('add_column_process (transforms)', () => {
	it('applies Add(5) to a column and runs the chain', () => {
		const s = new AncirSession('tx-add');
		s.importColumns([{ name: 'v', values: seq(10, (i) => i) }]);
		const res = s.addColumnProcess(0, 'Add', { value: 5 });
		expect(res.length).toBe(10);
		expect(res.preview[0]).toBe(5);
		expect(res.preview[3]).toBe(8);
	});

	it('normalizes a column (z-score: mean ~0, finite, recentred)', () => {
		const s = new AncirSession('tx-norm');
		s.importColumns([{ name: 'v', values: seq(10, (i) => i * 3) }]);
		const res = s.addColumnProcess(0, 'normalize', {});
		expect(res.length).toBe(10);
		expect(res.preview.every((v) => Number.isFinite(v))).toBe(true);
		// Standardised data is recentred about its mean → starts below zero here.
		expect(res.preview[0]).toBeLessThan(0);
	});

	it('rejects an unknown process name', () => {
		const s = new AncirSession('tx-bad');
		s.importColumns([{ name: 'v', values: [1, 2, 3] }]);
		expect(() => s.addColumnProcess(0, 'Nope', {})).toThrow(/Unknown column process/);
	});
});

describe('add_plot (wired into the session)', () => {
	it('creates a scatterplot and embeds it in the export', () => {
		const s = new AncirSession('plot-scatter');
		s.importColumns([
			{ name: 'x', values: seq(20, (i) => i) },
			{ name: 'y', values: seq(20, (i) => i * 2) }
		]);
		const res = s.addPlot('scatterplot', { x: 0, y: 1 });
		expect(res.type).toBe('scatterplot');

		const exported = s.exportSessionObject();
		expect(exported.plots?.length).toBe(1);
		expect(exported.plots[0].type).toBe('scatterplot');
	});

	it('creates an actogram from time + values columns', () => {
		const s = new AncirSession('plot-acto');
		s.importColumns([
			{ name: 't', type: 'time', values: seq(48, (i) => i) },
			{ name: 'v', values: seq(48, (i) => (i % 24 < 12 ? 80 : 20)) }
		]);
		const res = s.addPlot('actogram', { time: 0, values: 1 });
		expect(res.type).toBe('actogram');
		expect(s.exportSessionObject().plots.length).toBe(1);
	});

	it('rejects an unknown plot type', () => {
		const s = new AncirSession('plot-bad');
		expect(() => s.addPlot('piechart', {})).toThrow(/Unknown plot type/);
	});

	it('rejects a scatterplot with x but no y (incomplete wiring), and adds no plot', () => {
		const s = new AncirSession('plot-partial');
		s.importColumns([{ name: 'x', values: seq(10, (i) => i) }]);
		expect(() => s.addPlot('scatterplot', { x: 0 })).toThrow(/missing required input.*y/i);
		// The half-wired plot must NOT have been committed.
		expect(s.exportSessionObject().plots.length).toBe(0);
	});

	it('rejects an actogram missing its values field', () => {
		const s = new AncirSession('plot-acto-partial');
		s.importColumns([{ name: 't', type: 'time', values: seq(10, (i) => i) }]);
		expect(() => s.addPlot('actogram', { time: 0 })).toThrow(/missing required input.*values/i);
	});

	it('allows the circular-phase plot without its optional time axis', () => {
		const s = new AncirSession('plot-circ');
		s.importColumns([{ name: 'phase', values: seq(20, (i) => (i % 24) * (Math.PI / 12)) }]);
		// `values` provided, `time` omitted — must succeed (time is optional).
		const res = s.addPlot('circularphase', { values: 0 });
		expect(res.type).toBe('circularphase');
		expect(s.exportSessionObject().plots.length).toBe(1);
	});
});
