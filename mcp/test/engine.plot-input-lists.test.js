// add_plot / render_plot take a LIST of columns on a plot's many input (engine/plotInputs.js):
// the only field of a one-input plot (correlationheatmap, pairsplot, histogram, qqplot) and the
// second field of a two-input plot (y / values). Before, every input took one column, so a
// correlation heatmap or pairs plot made over MCP held one variable and drew "Wire two or more
// columns". A single column still wires exactly as before.
import { beforeAll, describe, expect, it, vi } from 'vitest';

// The browser rasteriser is out of scope here (test/smoke-render-lists.mjs draws for real):
// capture the payload it would draw.
const rendered = [];
vi.mock('../src/engine/renderPlot.js', () => ({
	renderPlot: async (payload) => {
		rendered.push(payload);
		return { png: 'x.png', svg: 'x.svg' };
	}
}));

import { AncirSession, ensureRegistry } from '../src/engine/session.js';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { manyInputField, plotSeriesDataIns } from '../src/engine/plotInputs.js';

const seq = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const T = seq(48, (i) => i);
const A = seq(48, (i) => 10 + 5 * Math.cos((2 * Math.PI * i) / 24));
const B = seq(48, (i) => 3 + 2 * Math.sin((2 * Math.PI * i) / 24) + (i % 5) * 0.1);
const C = seq(48, (i) => i * 0.5 + (i % 3));

beforeAll(async () => {
	await ensureRegistry();
});

const session = () => {
	const s = new AncirSession('lists');
	s.importColumns([
		{ name: 'time_h', values: T },
		{ name: 'a', values: A },
		{ name: 'b', values: B },
		{ name: 'c', values: C }
	]);
	return s;
};
const idOf = (s, name) => s.listColumns().find((c) => c.name === name).id;
const plotOf = (r) => core.plots.find((p) => p.id === r.plotId);
const refs = (p, field) => p.plot.data.map((d) => d[field]?.refId);

describe('the many input is read from the plot registry', () => {
	it('is the only field of a one-input plot and the second of a two-input plot', () => {
		const many = Object.fromEntries(
			[...appConsts.plotMap].map(([id, e]) => [id, manyInputField(e.defaultInputs ?? [])])
		);
		expect(many.correlationheatmap).toBe('column');
		expect(many.pairsplot).toBe('column');
		expect(many.histogram).toBe('column');
		expect(many.qqplot).toBe('column');
		expect(many.scatterplot).toBe('y');
		expect(many.periodogram).toBe('values');
		expect(many.tableplot).toBe(null);
	});
});

describe('add_plot with a list of columns', () => {
	it('wires a correlation heatmap of 3 columns (names) into a 3 x 3 matrix', () => {
		const s = session();
		const r = s.addPlot('correlationheatmap', { column: ['a', 'b', 'c'] });
		const p = plotOf(r);
		expect(refs(p, 'column')).toEqual([idOf(s, 'a'), idOf(s, 'b'), idOf(s, 'c')]);
		const m = p.plot.matrix;
		expect(m.labels).toEqual(['a', 'b', 'c']);
		expect(m.r).toHaveLength(3);
		expect(m.r[0][0]).toBeCloseTo(1, 10);
		expect(Number.isFinite(m.r[0][1])).toBe(true);
		// And the session saves all three variables.
		const saved = s.exportSessionObject().plots.find((q) => q.id === r.plotId);
		expect(saved.plot.data).toHaveLength(3);
	});

	it('wires a pairs plot of 3 columns (ids and names mixed)', () => {
		const s = session();
		const r = s.addPlot('pairsplot', { column: [idOf(s, 'a'), 'b', String(idOf(s, 'c'))] });
		expect(refs(plotOf(r), 'column')).toEqual([idOf(s, 'a'), idOf(s, 'b'), idOf(s, 'c')]);
	});

	it('takes a bare array as the list on a one-input plot', () => {
		const s = session();
		const r = s.addPlot('correlationheatmap', ['a', 'b']);
		expect(refs(plotOf(r), 'column')).toEqual([idOf(s, 'a'), idOf(s, 'b')]);
	});

	it('makes one series per y column on the shared x of a two-input plot', () => {
		const s = session();
		const r = s.addPlot('scatterplot', { x: 'time_h', y: ['a', 'b'] });
		const p = plotOf(r);
		expect(refs(p, 'x')).toEqual([idOf(s, 'time_h'), idOf(s, 'time_h')]);
		expect(refs(p, 'y')).toEqual([idOf(s, 'a'), idOf(s, 'b')]);
	});

	it('refuses a list on an input that takes one column, adding no plot', () => {
		const s = session();
		const before = core.plots.length;
		expect(() => s.addPlot('scatterplot', { x: ['time_h', 'a'], y: 'b' })).toThrow(
			/Plot "scatterplot" input "x" takes one column, not a list; only "y" takes a list/
		);
		expect(core.plots.length).toBe(before);
	});

	it('refuses a list on a plot that draws one series (cwt), adding no plot', () => {
		const s = session();
		const before = core.plots.length;
		expect(() => s.addPlot('cwt', { x: 'time_h', y: ['a', 'b'] })).toThrow(
			/Plot "cwt" draws one series, so its "y" input takes one column, not a list of 2/
		);
		expect(core.plots.length).toBe(before);
	});

	it('names an unknown column in the list (and the input), adding no plot', () => {
		const s = session();
		const before = core.plots.length;
		expect(() => s.addPlot('correlationheatmap', { column: ['a', 'zzz', 'c'] })).toThrow(
			/Plot "correlationheatmap" input "column": No column named "zzz"\. Available: time_h, a, b, c/
		);
		expect(() => s.addPlot('pairsplot', { column: ['a', 9999] })).toThrow(
			/input "column": No column with id 9999/
		);
		expect(core.plots.length).toBe(before);
	});

	it('treats an empty list as a missing input', () => {
		const s = session();
		expect(() => s.addPlot('correlationheatmap', { column: [] })).toThrow(
			/missing required input: column/
		);
	});
});

describe('add_plot with single columns is unchanged', () => {
	it('a single column on a one-input plot is one series, the same as a list of one', () => {
		const s = session();
		const one = plotOf(s.addPlot('histogram', { column: 'a' }));
		const list = plotOf(s.addPlot('histogram', { column: ['a'] }));
		expect(refs(one, 'column')).toEqual([idOf(s, 'a')]);
		expect(refs(list, 'column')).toEqual([idOf(s, 'a')]);
		// One variable still asks for more (the heatmap's own message, not an error).
		const heat = plotOf(s.addPlot('correlationheatmap', { column: 'a' }));
		expect(heat.plot.matrix.labels).toEqual(['a']);
	});

	it('every two-input plot wires one series from {field: column}, as before', () => {
		const s = session();
		for (const [type, e] of appConsts.plotMap) {
			const fields = e.defaultInputs ?? [];
			if (fields.length !== 2) continue;
			const p = plotOf(s.addPlot(type, { [fields[0]]: 'time_h', [fields[1]]: 'a' }));
			expect(p.plot.data, type).toHaveLength(1);
			expect(p.plot.data[0].x.refId, type).toBe(idOf(s, 'time_h'));
			expect(p.plot.data[0].y.refId, type).toBe(idOf(s, 'a'));
		}
	});

	it('a positional pair still wires x then y; more entries than fields are refused', () => {
		const s = session();
		const p = plotOf(s.addPlot('scatterplot', ['time_h', 'a']));
		expect(refs(p, 'x')).toEqual([idOf(s, 'time_h')]);
		expect(refs(p, 'y')).toEqual([idOf(s, 'a')]);
		expect(() => s.addPlot('scatterplot', ['time_h', 'a', 'b'])).toThrow(
			/takes 2 positional inputs \(x, y\), got 3/
		);
	});
});

describe('render_plot with a list of columns', () => {
	it('sends the heatmap its 3 columns as one list, renumbered', async () => {
		const s = session();
		rendered.length = 0;
		await s.renderPlotToFiles('correlationheatmap', { column: ['a', 'b', 'c'] }, { outBase: '/x' });
		expect(rendered[0].columns.map((c) => c.name)).toEqual(['a', 'b', 'c']);
		expect(rendered[0].plot.inputs).toEqual({ column: [0, 1, 2] });
		// What the render page wires from it (render/mount.js): three series.
		expect(plotSeriesDataIns(['column'], rendered[0].plot.inputs)).toEqual([
			{ column: { refId: 0 } },
			{ column: { refId: 1 } },
			{ column: { refId: 2 } }
		]);
	});

	it('shares one x column across a y list', async () => {
		const s = session();
		rendered.length = 0;
		await s.renderPlotToFiles('scatterplot', { x: 'time_h', y: ['a', 'b'] }, { outBase: '/x' });
		expect(rendered[0].plot.inputs).toEqual({ x: 0, y: [1, 2] });
		expect(plotSeriesDataIns(['x', 'y'], rendered[0].plot.inputs)).toEqual([
			{ x: { refId: 0 }, y: { refId: 1 } },
			{ x: { refId: 0 }, y: { refId: 2 } }
		]);
	});

	it('keeps a single-column payload as it was', async () => {
		const s = session();
		rendered.length = 0;
		await s.renderPlotToFiles('scatterplot', { x: 'time_h', y: 'a' }, { outBase: '/x' });
		await s.renderPlotToFiles('histogram', { column: 'a' }, { outBase: '/x' });
		expect(rendered[0].plot.inputs).toEqual({ x: 0, y: 1 });
		expect(rendered[1].plot.inputs).toEqual({ column: 0 });
		expect(plotSeriesDataIns(['x', 'y'], rendered[0].plot.inputs)).toEqual([
			{ x: { refId: 0 }, y: { refId: 1 } }
		]);
	});

	it('names an unknown column in the list before launching a browser', async () => {
		const s = session();
		rendered.length = 0;
		await expect(
			s.renderPlotToFiles('pairsplot', { column: ['a', 'nope'] }, { outBase: '/x' })
		).rejects.toThrow(/Plot "pairsplot" input "column": No column named "nope"/);
		expect(rendered).toHaveLength(0);
	});
});
