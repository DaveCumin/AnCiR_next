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

	// A free period has no fixedPeriod: the sampling is judged on the period the fit found
	// (the shortest one when there are several curves), not on the 24 the node keeps for its
	// fixed mode. 4-hourly samples of an 11.3 period over 96 units: about 2.9 points a cycle.
	const freeXs = Array.from({ length: 25 }, (_, i) => i * 4);
	const freeYs = freeXs.map((v) => 10 + 3 * Math.cos((2 * Math.PI * (v - 2)) / 11.3));
	const runFree = (xIN, yIN, extra = {}) =>
		cosinor({
			xIN,
			yIN: [yIN],
			Ncurves: 1,
			outputX: -1,
			useFixedPeriod: false,
			fixedPeriod: 24,
			nHarmonics: 1,
			minPeriod: 9,
			maxPeriod: 30,
			alpha: 0.05,
			out: { cosinorx: -1 },
			preProcesses: [],
			...extra
		});
	const fittedPeriod = (res) => {
		const [yr] = Object.values(res.y_results);
		return (2 * Math.PI) / yr.fittedData.parameters.cosines[0].frequency;
	};

	it('free period, number x: names the fitted period, not the fixed 24', async () => {
		const [res] = await runFree(column('x', freeXs), column('y', freeYs));
		expect(fittedPeriod(res)).toBeCloseTo(11.3, 2);
		const sparse = res.warnings.find((w) => w.startsWith('Sparse sampling'));
		expect(sparse).toMatch(/^Sparse sampling: about 2\.9 points per cycle of 11\.3 \(x units\), /);
		expect(sparse).toMatch(/1 harmonic needs at least ~4\./);
		for (const w of res.warnings) expect(w).not.toMatch(/\b24\b/);
	});

	it('free period, time x: "per 11.3 h cycle"', async () => {
		const t0 = Date.UTC(2026, 0, 5);
		const x = column(
			't',
			freeXs.map((h) => t0 + h * 3600000),
			'time'
		);
		const [res] = await runFree(x, column('y', freeYs));
		expect(res.warnings.find((w) => w.startsWith('Sparse sampling'))).toMatch(
			/^Sparse sampling: about 2\.9 points per 11\.3 h cycle, /
		);
	});

	it('free period, well sampled for its fitted period: no warning, whatever the fixed period says', async () => {
		// Hourly samples of an 11.3 period: about 11 points a cycle.
		const xs1 = Array.from({ length: 97 }, (_, i) => i);
		const ys1 = xs1.map((v) => 10 + 3 * Math.cos((2 * Math.PI * (v - 2)) / 11.3));
		const [res] = await runFree(column('x', xs1), column('y', ys1), { fixedPeriod: 2 });
		expect(res.warnings.some((w) => w.startsWith('Sparse sampling'))).toBe(false);
	});

	it('free period, several series: each is judged on its own fitted period, and named', async () => {
		const x = column('x', freeXs);
		const ys2 = freeXs.map((v) => 4 + Math.cos((2 * Math.PI * (v - 5)) / 13.7));
		const [res] = await cosinor({
			xIN: x,
			yIN: [column('a', freeYs), column('b', ys2)],
			Ncurves: 1,
			outputX: -1,
			useFixedPeriod: false,
			fixedPeriod: 24,
			nHarmonics: 1,
			minPeriod: 9,
			maxPeriod: 30,
			alpha: 0.05,
			out: { cosinorx: -1 },
			preProcesses: []
		});
		const sparse = res.warnings.filter((w) => w.startsWith('Sparse sampling'));
		expect(sparse).toHaveLength(2);
		expect(sparse[0]).toMatch(/^Sparse sampling for "a": about 2\.9 points per cycle of 11\.3 /);
		expect(sparse[1]).toMatch(/^Sparse sampling for "b": about 3\.6 points per cycle of 13\.7 /);
	});
});
