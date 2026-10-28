// Column NAMES wherever a column id is taken: render_plot's inputs (they were passed through
// unresolved, so a name failed with "No column with id time_h"), a fit's outputX and Sort's
// sortOnId (params that name a column without being a port: a name was silently ignored), and an
// ambiguous name refused with its candidates rather than resolved to the first match.
import { beforeAll, describe, expect, it, vi } from 'vitest';

// The browser rasteriser is out of scope here: capture the payload it would draw.
const rendered = [];
vi.mock('../src/engine/renderPlot.js', () => ({
	renderPlot: async (payload) => {
		rendered.push(payload);
		return { png: 'x.png', svg: 'x.svg' };
	}
}));

import { AncirSession, ensureRegistry } from '../src/engine/session.js';

const seq = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const T = seq(48, (i) => i);
const Y = seq(48, (i) => 10 + 5 * Math.cos((2 * Math.PI * i) / 24));

beforeAll(async () => {
	await ensureRegistry();
});

const session = () => {
	const s = new AncirSession('names');
	s.importColumns([
		{ name: 'time_h', values: T },
		{ name: 'signal', values: Y },
		{ name: 'grid', values: [0, 6, 12, 18, 24] },
		{ name: 'dup', values: Y },
		{ name: 'dup', values: Y }
	]);
	return s;
};
const idOf = (s, name) => s.listColumns().find((c) => c.name === name).id;

describe('render_plot takes column names', () => {
	it('resolves named inputs to the same columns as their ids', async () => {
		const s = session();
		rendered.length = 0;
		await s.renderPlotToFiles('scatterplot', { x: 'time_h', y: 'signal' }, { outBase: '/x' });
		await s.renderPlotToFiles(
			'scatterplot',
			{ x: idOf(s, 'time_h'), y: idOf(s, 'signal') },
			{ outBase: '/x' }
		);
		expect(rendered).toHaveLength(2);
		expect(rendered[0]).toEqual(rendered[1]);
		expect(rendered[0].columns.map((c) => c.name)).toEqual(['time_h', 'signal']);
		expect(rendered[0].plot.inputs).toEqual({ x: 0, y: 1 });
	});

	it('resolves a tableplot array of names', async () => {
		const s = session();
		rendered.length = 0;
		await s.renderPlotToFiles('tableplot', ['signal', 'grid'], { outBase: '/x' });
		expect(rendered[0].columns.map((c) => c.name)).toEqual(['signal', 'grid']);
		expect(rendered[0].plot.inputs).toEqual([0, 1]);
	});

	it('refuses an unknown name, listing what exists, before rendering', async () => {
		const s = session();
		rendered.length = 0;
		await expect(
			s.renderPlotToFiles('scatterplot', { x: 'nope', y: 'signal' }, { outBase: '/x' })
		).rejects.toThrow(/No column named "nope"\. Available: time_h, signal, grid/);
		expect(rendered).toHaveLength(0);
	});

	it('refuses an ambiguous name, naming the candidate ids', async () => {
		const s = session();
		rendered.length = 0;
		const [a, b] = s
			.listColumns()
			.filter((c) => c.name === 'dup')
			.map((c) => c.id);
		await expect(
			s.renderPlotToFiles('scatterplot', { x: 'time_h', y: 'dup' }, { outBase: '/x' })
		).rejects.toThrow(
			new RegExp(
				`Column name "dup" is ambiguous: 2 columns have it, ids ${a} \\(number\\), ${b} \\(number\\)`
			)
		);
		expect(rendered).toHaveLength(0);
		// The same rule on add_plot, which shares the resolver.
		expect(() => s.addPlot('scatterplot', { x: 'time_h', y: 'dup' })).toThrow(/ambiguous/);
	});
});

describe('column-valued params take names (run_table_process)', () => {
	it("evaluates a Cosinor's curve on the outputX column named", async () => {
		const s = session();
		const r = await s.runTableProcess('Cosinor', {
			xIN: 'time_h',
			yIN: ['signal'],
			outputX: 'grid'
		});
		expect(r.valid).toBe(true);
		const x = r.outputs.find((o) => o.key === 'cosinorx');
		expect(x.length).toBe(5);
		expect(x.preview).toEqual([0, 6, 12, 18, 24]);
	});

	it('refuses an unknown outputX name instead of ignoring it', async () => {
		const r = await session().runTableProcess('Cosinor', {
			xIN: 'time_h',
			yIN: ['signal'],
			outputX: 'nope'
		});
		expect(r.valid).toBe(false);
		expect(r.error).toMatch(/No column named "nope"/);
	});

	it("resolves Sort's sortOnId from a name", async () => {
		const s = session();
		const r = await s.runTableProcess('Sort', { yIN: ['time_h', 'signal'], sortOnId: 'signal' });
		expect(r.valid).toBe(true);
		const json = JSON.parse(s.exportSession());
		const sort = json.tableProcesses.find((t) => t.name === 'Sort');
		expect(sort.args.sortOnId).toBe(idOf(s, 'signal'));
	});
});
