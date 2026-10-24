// @ts-nocheck
// A new Cosinor is a free-period fit, and it used to start with no cosine curve (Ncurves 0),
// so a node added from the palette fitted nothing until the count was typed in. It now starts
// with one curve. A saved session keeps the count it was saved with: an explicit 0 stays 0
// (a free-period fit with no curve, which fits nothing, as before).
//
// The registry's own definition, the palette's defaults recipe and real Columns; nothing mocked.
import { describe, it, expect, beforeEach } from 'vitest';
import { core, pushObj } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { buildTableProcessDefaults } from '$lib/core/tpDefaults.js';
import { fillDefaults } from '$lib/tableProcesses/tpArgHelpers.js';
import { definition, cosinor } from './Cosinor.svelte';

const entry = { defaults: definition.defaults, definition };

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
});

describe('a new Cosinor', () => {
	it('starts as a free-period fit with one cosine curve, and fits it', async () => {
		const args = buildTableProcessDefaults(entry);
		expect(args.useFixedPeriod).toBe(false);
		expect(args.Ncurves).toBe(1);

		const t = Array.from({ length: 96 }, (_, i) => i);
		const [res, valid] = await cosinor({
			...args,
			xIN: column('x', t),
			yIN: [
				column(
					'y',
					t.map((h) => 10 + 3 * Math.cos((2 * Math.PI * (h - 6)) / 24))
				)
			],
			out: { cosinorx: -1 }
		});
		expect(valid).toBe(true);
		const [yr] = Object.values(res.y_results);
		expect(yr.fittedData.parameters.cosines).toHaveLength(1);
		const period = (2 * Math.PI) / yr.fittedData.parameters.cosines[0].frequency;
		expect(period).toBeCloseTo(24, 3);
	});

	it('a saved node keeps its stored count: an explicit 0 stays 0 and fits nothing', async () => {
		const saved = { useFixedPeriod: false, Ncurves: 0 };
		fillDefaults(saved, definition.defaults);
		expect(saved.Ncurves).toBe(0);

		const t = Array.from({ length: 96 }, (_, i) => i);
		const [, valid] = await cosinor({
			...buildTableProcessDefaults(entry),
			...saved,
			xIN: column('x', t),
			yIN: [
				column(
					'y',
					t.map((h) => Math.cos((2 * Math.PI * h) / 24))
				)
			],
			out: { cosinorx: -1 }
		});
		expect(valid).toBe(false);
	});
});
