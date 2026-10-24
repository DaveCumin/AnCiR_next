// @ts-nocheck
// Cosinor's sampling warnings name the period in the x's units. On a time x that is hours
// ("per 24 h cycle"); a number x has no unit to put before the noun, and the warning used to
// read "1.1 points per 24 x units cycle". It now reads "per cycle of 24 (x units)".
//
// Real Columns and core: nothing mocked.
import { describe, it, expect, beforeEach } from 'vitest';
import { core, pushObj } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { cosinor } from './Cosinor.svelte';

function column(name, values, type = 'number') {
	const c = new Column({ type });
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
	core.plots = [];
});

// 8 points over 30 x units: 1.1 cycles of 24, about 7 points per cycle (< 4 x 2 harmonics).
const xs = [0, 4, 8, 12, 17, 21, 25, 30];
const ys = xs.map((v) => 10 + 3 * Math.cos((2 * Math.PI * v) / 24));
const run = (xIN, yIN) =>
	cosinor({
		xIN,
		yIN: [yIN],
		Ncurves: 1,
		outputX: -1,
		useFixedPeriod: true,
		fixedPeriod: 24,
		nHarmonics: 2,
		alpha: 0.05,
		out: { cosinorx: -1 },
		preProcesses: []
	});

describe('Cosinor sampling warnings', () => {
	it('a number x: "a period of 24 (x units)" and "per cycle of 24 (x units)"', async () => {
		const [res] = await run(column('x', xs), column('y', ys));
		const short = res.warnings.find((w) => w.startsWith('Short record'));
		const sparse = res.warnings.find((w) => w.startsWith('Sparse sampling'));
		expect(short).toMatch(/^Short record: 1\.3 cycles at a period of 24 \(x units\)\. /);
		expect(sparse).toMatch(/^Sparse sampling: about 6\.4 points per cycle of 24 \(x units\), /);
		for (const w of res.warnings) expect(w).not.toMatch(/x units (cycle|period)/);
	});

	it('a time x keeps "a 24 h period" and "per 24 h cycle"', async () => {
		const t0 = Date.UTC(2026, 0, 5);
		const x = column(
			't',
			xs.map((h) => t0 + h * 3600000),
			'time'
		);
		const [res] = await run(x, column('y', ys));
		expect(res.warnings.find((w) => w.startsWith('Short record'))).toMatch(
			/cycles at a 24 h period\. /
		);
		expect(res.warnings.find((w) => w.startsWith('Sparse sampling'))).toMatch(
			/points per 24 h cycle, /
		);
	});
});
