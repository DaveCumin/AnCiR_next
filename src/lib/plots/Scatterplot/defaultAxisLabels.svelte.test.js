// A scatterplot's axes are titled with their wired column's name while the label is empty
// (renders and new plots had no axis titles at all). A typed label wins, and the default is
// never saved.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { Plot } from '$lib/core/Plot.svelte';
import { Column } from '$lib/core/Column.svelte';
import { loadPlots } from '$test/plotRegistry.js';

beforeAll(async () => {
	appConsts.plotMap = await loadPlots();
});
beforeEach(() => {
	core.data = [];
	core.plots = [];
	core.rawData = new Map();
});

function column(name, values) {
	const c = new Column({ type: 'number', data: -1, name });
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c;
}

function scatter(series) {
	const plot = new Plot({
		type: 'scatterplot',
		name: 's',
		width: 400,
		height: 300,
		plot: { data: series }
	});
	core.plots.push(plot);
	return core.plots.at(-1).plot;
}

describe('Scatterplot default axis titles', () => {
	it('names x and y after their columns; two different y columns get no y title', () => {
		const h = column('hours', [0, 1, 2]);
		const a = column('temp', [1, 2, 3]);
		const b = column('temp2', [2, 3, 4]);
		const one = scatter([{ x: { refId: h.id }, y: { refId: a.id } }]);
		expect(one.defaultXLabel).toBe('hours');
		expect(one.defaultYLeftLabel).toBe('temp');
		const two = scatter([
			{ x: { refId: h.id }, y: { refId: a.id } },
			{ x: { refId: h.id }, y: { refId: b.id } }
		]);
		expect(two.defaultXLabel).toBe('hours');
		expect(two.defaultYLeftLabel).toBe('');
	});

	it('is not saved: an empty label stays empty in the session', () => {
		const h = column('hours', [0, 1, 2]);
		const a = column('temp', [1, 2, 3]);
		const p = scatter([{ x: { refId: h.id }, y: { refId: a.id } }]);
		expect(p.toJSON().xAxis.label).toBe('');
		expect(p.toJSON().yAxisLeft.label).toBe('');
	});
});
