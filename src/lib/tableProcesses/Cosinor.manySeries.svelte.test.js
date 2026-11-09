// @ts-nocheck
// One Cosinor over many y columns must cost linear time in the number of columns. It was
// quadratic (250 y columns 0.6 s, 1000 9.7 s, 9471 ~17 min): every series label built a fresh
// column namer, and a namer indexes every column owner in the session (O(n) per series), and
// every column lookup scanned core.data (getColumnById, also O(n) per lookup). Timing tests
// are flaky, so this pins the structure: ONE namer per run, whatever the number of series.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const namerBuilds = vi.hoisted(() => ({ n: 0 }));
vi.mock('$lib/core/outputLabels.js', async (importOriginal) => {
	const real = await importOriginal();
	return {
		...real,
		createColumnNamer: (...a) => {
			namerBuilds.n++;
			return real.createColumnNamer(...a);
		}
	};
});

import { core, pushObj } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { cosinor, cosinorStatsTable } from './Cosinor.svelte';

function column(name, values) {
	const c = new Column({ type: 'number' });
	c.name = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	pushObj(c);
	return c.id;
}

beforeEach(() => {
	core.data = [];
	core.rawData = new Map();
	core.tableProcesses = [];
	namerBuilds.n = 0;
});

describe('Cosinor over many y columns', () => {
	it('builds one column namer per run, not one per series', async () => {
		const t = Array.from({ length: 24 }, (_, i) => i);
		const x = column('x', t);
		const ys = [];
		for (let c = 0; c < 200; c++) {
			// A few too-short series, so the per-series warning labels are exercised too.
			const v = t.map((h) => 5 + Math.cos((2 * Math.PI * (h - (c % 24))) / 24));
			ys.push(column('y' + c, c % 50 === 0 ? v.map((q, i) => (i < 2 ? q : null)) : v));
		}
		const args = {
			xIN: x,
			yIN: ys,
			useFixedPeriod: false,
			Ncurves: 1,
			minPeriod: 20,
			maxPeriod: 28,
			out: { cosinorx: -1 }
		};
		const [res, valid] = await cosinor(args);
		expect(valid).toBe(true);
		expect(Object.keys(res.y_results)).toHaveLength(196);
		expect(res.warnings.filter((w) => w.includes('"y0"')).length).toBeGreaterThan(0);
		// evaluateCosinor's labels share one namer, cosinor()'s warnings share another.
		expect(namerBuilds.n).toBeLessThanOrEqual(2);

		namerBuilds.n = 0;
		const table = cosinorStatsTable(res, args);
		expect(table.rows).toHaveLength(196);
		expect(table.rows[0][0]).toBe('y1');
		expect(namerBuilds.n).toBe(1);
	});
});
