import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { core, appConsts, appState } from '$lib/core/core.svelte';
import { loadPlots } from '$test/plotRegistry.js';
import { showDataAsTable } from './save.svelte.js';

function fakeSource(id, name, rows) {
	return {
		id,
		name,
		x: 0,
		y: 0,
		width: 400,
		height: 300,
		plot: {
			getDownloadData() {
				return { headers: ['X', 'Y'], rows };
			}
		}
	};
}

describe('showDataAsTable wiring (id vs index)', () => {
	beforeAll(async () => {
		appConsts.plotMap = await loadPlots();
	});

	afterEach(() => {
		core.plots.length = 0;
	});

	it('resolves the source plot by id, not array index', () => {
		// Source plot whose id (5) does NOT equal its array index (0).
		const src = fakeSource(5, 'RealSource', [
			[1, 2],
			[3, 4]
		]);
		core.plots.push(src);

		showDataAsTable(5); // callers always pass the plot id

		// A new Table in "Plot's computed data" mode should have been created pointing at id 5.
		const t = core.plots.find((p) => p.type === 'tableplot');
		expect(t).toBeTruthy();
		expect(t.plot.source).toBe('plot');
		expect(t.plot.sourcePlotId).toBe(5);
		expect(t.plot.view.headers).toEqual(['X', 'Y']);
		expect(t.plot.view.rows).toHaveLength(2);
		expect(t.plot.getDownloadData().rows).toHaveLength(2);
		// No Data View is spawned any more.
		expect(core.plots.some((p) => p.type === 'dataview')).toBe(false);
	});

	it('on a Table that is already a view, focuses it instead of mirroring it', () => {
		core.plots.push(fakeSource(5, 'RealSource', [[1, 2]]));
		const view = showDataAsTable(5);
		const before = core.plots.length;
		const again = showDataAsTable(view.id);
		expect(core.plots.length).toBe(before);
		expect(again.id).toBe(view.id);
		expect(appState.focusNodeRequest?.id).toBe(`plot_${view.id}`);
	});
});
