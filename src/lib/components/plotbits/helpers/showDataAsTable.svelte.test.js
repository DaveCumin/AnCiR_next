import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { core, appConsts } from '$lib/core/core.svelte';
import { loadPlots } from '$lib/plots/plotMap.js';
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

		// A new DataView plot should have been created pointing at id 5.
		const dv = core.plots.find((p) => p.type === 'dataview');
		expect(dv).toBeTruthy();
		expect(dv.plot.sourcePlotId).toBe(5);
		expect(dv.plot.headers.length).toBe(2);
		expect(dv.plot.totalRows).toBe(2);
	});
});
