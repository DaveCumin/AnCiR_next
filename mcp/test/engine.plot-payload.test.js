// render_plot sends each time column's clock zone to the render page (without it the rendered
// time labels showed UTC), and add_plot reports the warnings a plot shows in its controls, as
// render_plot does (render/payloadColumn.js plotWarnings).
import { beforeAll, describe, expect, it, vi } from 'vitest';

const sent = [];
vi.mock('../src/engine/renderPlot.js', () => ({
	renderPlot: async (payload) => {
		sent.push(payload);
		return { png: 'x.png', svg: 'x.svg', bytes: 0, width: 1, height: 1 };
	}
}));

const { AncirSession, ensureRegistry } = await import('../src/engine/session.js');

beforeAll(async () => {
	await ensureRegistry();
});

const H = 3600000;

describe('render_plot payload', () => {
	it('carries a time column clock zone, and none for a number column', async () => {
		const s = new AncirSession('payload-zone');
		s.importColumns([
			{
				name: 't',
				type: 'time',
				time_zone: 'Pacific/Auckland',
				values: Array.from({ length: 48 }, (_, i) => Date.UTC(2024, 0, 1) + i * H)
			},
			{ name: 'v', values: Array.from({ length: 48 }, (_, i) => i % 24) }
		]);
		await s.renderPlotToFiles('scatterplot', { x: 't', y: 'v' }, { outBase: '/tmp/unused' });
		const cols = Object.fromEntries(sent.at(-1).columns.map((c) => [c.name, c]));
		expect(cols.t.timeZone).toBe('Pacific/Auckland');
		expect('timeZone' in cols.v).toBe(false);
	});
});

describe('add_plot warnings', () => {
	it('reports a boxplot numeric x with too many distinct values', () => {
		const s = new AncirSession('plot-warnings');
		s.importColumns([
			{ name: 'g', values: Array.from({ length: 60 }, (_, i) => i) },
			{ name: 'v', values: Array.from({ length: 60 }, (_, i) => i * 2) }
		]);
		const r = s.addPlot('boxplot', { x: 'g', y: 'v' });
		expect(r.warnings?.length).toBeGreaterThan(0);
		expect(r.warnings.join(' ')).toMatch(/g/);
	});

	it('a plot with nothing to warn about has no warnings field', () => {
		const s = new AncirSession('plot-no-warnings');
		s.importColumns([
			{ name: 'g', values: [0, 0, 1, 1] },
			{ name: 'v', values: [1, 2, 3, 4] }
		]);
		expect(s.addPlot('boxplot', { x: 'g', y: 'v' }).warnings).toBeUndefined();
	});
});
