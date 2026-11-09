// @ts-nocheck
// With no output x set, Cosinor writes ONE shared x output (`cosinorx`) and one curve per y.
// Each curve used to be the fit at that y's own valid rows, while cosinorx came from the first
// y with a curve: a y without gaps and a y with missing values gave cosinorx 96 rows,
// cosinory_<y1> 96 and cosinory_<y2> 76, so the second curve could not be plotted against
// the x. Every curve is now evaluated on the one shared grid (the rows where x is valid).
// Real Columns and core; nothing mocked.
import { describe, it, expect, beforeEach } from 'vitest';
import { core, pushObj } from '$lib/core/core.svelte.js';
import { Column, getColumnById } from '$lib/core/Column.svelte';
import { cosinor } from './Cosinor.svelte';

function column(name, values) {
	const c = new Column({ type: 'number' });
	c.name = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	pushObj(c);
	return c.id;
}
const outColumn = (name) => column(name, []);
const read = (id) => getColumnById(id).getData();

beforeEach(() => {
	core.data = [];
	core.rawData = new Map();
	core.tableProcesses = [];
});

const t = Array.from({ length: 96 }, (_, i) => i);
const curve = (h, shift) => 10 + 3 * Math.cos((2 * Math.PI * (h - shift)) / 24);

describe.each([
	['fixed period', { useFixedPeriod: true, fixedPeriod: 24, nHarmonics: 1 }],
	['free period', { useFixedPeriod: false, Ncurves: 1, minPeriod: 20, maxPeriod: 28 }]
])('Cosinor (%s) with no output x', (_, mode) => {
	it('writes every curve on the one shared x, whatever rows each y is missing', async () => {
		const xId = column('x', [...t.slice(0, 95), null]); // the x has a gap too
		const y1 = column(
			'full',
			t.map((h) => curve(h, 6))
		);
		const y2 = column(
			'gappy',
			t.map((h) => (h >= 30 && h < 50 ? null : curve(h, 12)))
		);
		const out = {
			cosinorx: outColumn('cx'),
			['cosinory_' + y1]: outColumn('c1'),
			['cosinory_' + y2]: outColumn('c2')
		};
		const [res, valid] = await cosinor({ xIN: xId, yIN: [y1, y2], ...mode, out });
		expect(valid).toBe(true);

		const cx = read(out.cosinorx);
		const c1 = read(out['cosinory_' + y1]);
		const c2 = read(out['cosinory_' + y2]);
		expect(cx).toEqual(t.slice(0, 95));
		expect(c1).toHaveLength(95);
		expect(c2).toHaveLength(95);
		// Each curve is its own fit, evaluated at the shared x (including y2's missing rows).
		for (let i = 0; i < 95; i++) {
			expect(c1[i]).toBeCloseTo(curve(cx[i], 6), 6);
			expect(c2[i]).toBeCloseTo(curve(cx[i], 12), 6);
		}
		// The fit itself still uses each y's own rows: R² and the stored t are per series.
		expect(res.y_results[y2].t).toHaveLength(75);
		expect(res.y_results[y2].fittedData.fitted).toHaveLength(75);
		expect(res.y_results[y2].fittedData.rSquared).toBeCloseTo(1, 6);
	});
});
