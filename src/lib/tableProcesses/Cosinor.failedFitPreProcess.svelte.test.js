// @ts-nocheck
// A Cosinor whose fit fails, with a pre-process, must fail like one without: the node's
// normal "produced no usable numbers" warning, not an internal error.
//
// REPORTED (vault TODO, port parity pass 2026-10-20): "Cosinor with a failed fixed fit plus a
// pre-process throws". Reproduced in the app 2026-10-22 (a session with x on whole periods,
// 0, 24, ..., 168 h, so the sine column of the design matrix is all zero and the fixed fit is
// singular): with no pre-process the node said the fit "produced no usable numbers"; with an
// Add pre-process it said "An internal error in AnCiR stopped this calculation ... Cannot read
// properties of null (reading 'map')". A failed series keeps `yOutData: null`, and the
// pre-process loop handed that null to the process function.
//
// Real Columns, real core and the real process registry: nothing mocked.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { core, appConsts, pushObj } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { loadProcesses } from '$test/processRegistry.js';
import { cosinor } from './Cosinor.svelte';

const OUT = {
	cosinorx: -1,
	cosinory: -1,
	period: -1,
	mesor: -1,
	amplitude: -1,
	acrophase: -1,
	rsquared: -1,
	pvalue: -1
};

function numberColumn(name, values) {
	const c = new Column({ type: 'number' });
	c.name = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	pushObj(c);
	return c.id;
}

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
});

let xId;
let yId;
beforeEach(() => {
	core.data = [];
	core.rawData = new Map();
	core.tableProcesses = [];
	core.plots = [];
	// Whole periods: cos(2*pi*t/24) is 1 and sin is 0 on every row, so the fixed design
	// matrix [1, cos, sin] is singular and the fit returns nothing.
	xId = numberColumn('hours', [0, 24, 48, 72, 96, 120, 144, 168]);
	yId = numberColumn('y', [3, 5, 4, 6, 5, 7, 6, 8]);
});

const args = (over = {}) => ({
	xIN: xId,
	yIN: [yId],
	Ncurves: 1,
	outputX: -1,
	useFixedPeriod: true,
	fixedPeriod: 24,
	nHarmonics: 1,
	alpha: 0.05,
	referenceHrs: 0,
	out: { ...OUT },
	preProcesses: [],
	...over
});

const ADD_ONE = [{ processName: 'Add', processArgs: { value: 1 } }];

describe('Cosinor: a failed fit with a pre-process', () => {
	it('fixed period: the same warnings as without the pre-process, and no throw', async () => {
		expect(appConsts.processMap.get('Add')?.func).toBeTypeOf('function');
		const [plain, plainValid] = await cosinor(args());
		expect(plainValid).toBe(false);
		expect(plain.warnings.some((w) => w.includes('produced no usable numbers'))).toBe(true);

		const [withPre, withPreValid] = await cosinor(args({ preProcesses: ADD_ONE }));
		expect(withPreValid).toBe(false);
		expect(withPre.warnings).toEqual(plain.warnings);
		expect(withPre.y_results[yId].yOutData).toBeNull();
	});

	it('a failed series beside a good one: the x output is the good series', async () => {
		// a (the smaller column id) has values only on whole periods, so its fit fails; b fits.
		// The x output used to come from a (Object.keys order): 8 rows, beside b's 29-row curve.
		const hours = Array.from({ length: 29 }, (_, i) => 6 * i);
		const xMixed = numberColumn('h6', hours);
		const a = numberColumn(
			'a',
			hours.map((h, i) => (h % 24 === 0 ? 20 + 0.1 * i : null))
		);
		const b = numberColumn(
			'b',
			hours.map((h) => 25 + 6 * Math.cos((2 * Math.PI * (h - 9)) / 24))
		);
		const outX = numberColumn('cosinorx', []);
		const outA = numberColumn('cosinory_a', [1, 2, 3]);
		const outB = numberColumn('cosinory_b', []);
		const out = { ...OUT, cosinorx: outX, ['cosinory_' + a]: outA, ['cosinory_' + b]: outB };
		const [, ok] = await cosinor(args({ xIN: xMixed, yIN: [a, b], out, preProcesses: ADD_ONE }));
		expect(ok).toBe(true);
		const read = (id) => core.data.find((c) => c.id === id).getData();
		expect(read(outX)).toEqual(hours);
		expect(read(outB)).toHaveLength(hours.length);
		// The failed series' curve is emptied, not left from an earlier run.
		expect(read(outA)).toEqual([]);
	});

	it('a fit that succeeds still has the pre-process applied to its curve', async () => {
		const hours = Array.from({ length: 48 }, (_, i) => i);
		const xGood = numberColumn('h', hours);
		const yGood = numberColumn(
			'v',
			hours.map((h) => 10 + 3 * Math.cos((2 * Math.PI * h) / 24))
		);
		const base = { xIN: xGood, yIN: [yGood] };
		const [plain, ok] = await cosinor(args(base));
		expect(ok).toBe(true);
		const [shifted] = await cosinor(args({ ...base, preProcesses: ADD_ONE }));
		const a = plain.y_results[yGood].yOutData;
		const b = shifted.y_results[yGood].yOutData;
		expect(b).toHaveLength(a.length);
		b.forEach((v, i) => expect(v).toBeCloseTo(a[i] + 1, 9));
	});
});
