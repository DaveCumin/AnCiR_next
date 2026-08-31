// Integration test: enabling the permutation test on the dedicated fit nodes
// (Cosinor, Rectangular wave, Double logistic) populates their wireable
// permutation-p output column with a real p-value. Uses the actual classes +
// fits (no mocks). Since v72.25 that port is `perm_pvalue` on all three nodes:
// Cosinor's `pvalue` now carries the analytic F-test p (Cosinor.pvalue.test.js),
// and RectangularWave/DoubleLogistic renamed their only p to match.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { TableProcess } from '$lib/core/TableProcess.svelte';
import { loadProcesses } from '$lib/processes/processMap.js';
import { loadPlots } from '$lib/plots/plotMap.js';
import { loadTableProcesses } from '$lib/tableProcesses/tableProcessMap.js';

const seq = (n, f) => Array.from({ length: n }, (_, i) => f(i));

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
}, 60000);

beforeEach(() => {
	core.data = [];
	core.tableProcesses = [];
	core.rawData = new Map();
});

function mkCol(values) {
	const c = new Column({ type: 'number', data: -1 });
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

async function runWithPermutation(name, args, yValues) {
	const xId = mkCol(seq(yValues.length, (i) => i));
	const yId = mkCol(yValues);
	const tp = new TableProcess(
		{
			name,
			args: {
				...args,
				xIN: xId,
				yIN: [yId],
				permuteTest: true,
				nPermutations: 99,
				permutationSeed: 7,
				permutationStatistic: 'rSquared'
			}
		},
		null
	);
	await tp.doProcess();
	const pId = tp.args.out.perm_pvalue;
	const pData = pId != null && pId >= 0 ? core.rawData.get(pId) : null;
	return pData?.[0];
}

describe('dedicated fit nodes — permutation pvalue output', () => {
	it('Cosinor flags a 24h rhythm as significant', { timeout: 60000 }, async () => {
		const y = seq(96, (i) => 5 + 10 * Math.cos((2 * Math.PI * i) / 24));
		const p = await runWithPermutation(
			'Cosinor',
			{
				Ncurves: 1,
				outputX: -1,
				useFixedPeriod: true,
				fixedPeriod: 24,
				nHarmonics: 1,
				alpha: 0.05,
				out: { cosinorx: -1, period: -1, amplitude: -1, rsquared: -1, pvalue: -1, perm_pvalue: -1 }
			},
			y
		);
		expect(Number.isFinite(p)).toBe(true);
		expect(p).toBeLessThan(0.05);
	});

	it('Rectangular wave flags a square wave as significant', { timeout: 60000 }, async () => {
		const y = seq(96, (i) => (i % 24 < 12 ? 80 : 20));
		const p = await runWithPermutation(
			'RectangularWave',
			{
				outputX: -1,
				fixOmega: true,
				fixedPeriod: 24,
				fixKappa: false,
				fixDutyCycle: false,
				out: { rectwavex: -1, perm_pvalue: -1 }
			},
			y
		);
		expect(Number.isFinite(p)).toBe(true);
		expect(p).toBeLessThan(0.05);
	});

	it('Double logistic flags a logistic rise/fall as significant', { timeout: 60000 }, async () => {
		const y = seq(48, (i) => 25 + 50 / (1 + Math.exp(-(i - 12))) - 50 / (1 + Math.exp(-(i - 36))));
		const p = await runWithPermutation(
			'DoubleLogistic',
			{
				outputX: -1,
				fixK1: false,
				fixedK1: 0.5,
				fixK2: false,
				fixedK2: 0.5,
				fixPeriod: false,
				fixedPeriod: 24,
				out: { dlogx: -1, perm_pvalue: -1 }
			},
			y
		);
		expect(Number.isFinite(p)).toBe(true);
		expect(p).toBeLessThan(0.05);
	});
});

// The panel and the "View stats" table read the fit RESULT, not the output
// column, so a p-value that only reaches the port is invisible to the user who
// ticked the box. Assert it rides along on each y result too.
describe('dedicated fit nodes — permutation pvalue on the fit result', () => {
	async function fitResultFor(name, args, yValues) {
		const xId = mkCol(seq(yValues.length, (i) => i));
		const yId = mkCol(yValues);
		const func = appConsts.tableProcessMap.get(name).func;
		const [result] = await func({
			...args,
			xIN: xId,
			yIN: [yId],
			permuteTest: true,
			nPermutations: 99,
			permutationSeed: 7,
			permutationStatistic: 'rSquared'
		});
		return result.y_results[yId];
	}

	it('Cosinor puts pValue/significant on the y result', { timeout: 60000 }, async () => {
		const y = seq(96, (i) => 5 + 10 * Math.cos((2 * Math.PI * i) / 24));
		const yr = await fitResultFor(
			'Cosinor',
			{
				Ncurves: 1,
				outputX: -1,
				useFixedPeriod: true,
				fixedPeriod: 24,
				nHarmonics: 1,
				alpha: 0.05,
				out: { cosinorx: -1, pvalue: -1 }
			},
			y
		);
		expect(Number.isFinite(yr.pValue)).toBe(true);
		expect(yr.pValue).toBeLessThan(0.05);
		expect(yr.significant).toBe(true);
	});

	it('Rectangular wave puts pValue/significant on the y result', { timeout: 60000 }, async () => {
		const y = seq(96, (i) => (i % 24 < 12 ? 80 : 20));
		const yr = await fitResultFor(
			'RectangularWave',
			{
				outputX: -1,
				fixOmega: true,
				fixedPeriod: 24,
				fixKappa: false,
				fixDutyCycle: false,
				out: { rectwavex: -1, perm_pvalue: -1 }
			},
			y
		);
		expect(Number.isFinite(yr.pValue)).toBe(true);
		expect(yr.significant).toBe(true);
	});

	it('Double logistic puts pValue/significant on the y result', { timeout: 60000 }, async () => {
		const y = seq(48, (i) => 25 + 50 / (1 + Math.exp(-(i - 12))) - 50 / (1 + Math.exp(-(i - 36))));
		const yr = await fitResultFor(
			'DoubleLogistic',
			{
				outputX: -1,
				fixK1: false,
				fixedK1: 0.5,
				fixK2: false,
				fixedK2: 0.5,
				fixPeriod: false,
				fixedPeriod: 24,
				out: { dlogx: -1, perm_pvalue: -1 }
			},
			y
		);
		expect(Number.isFinite(yr.pValue)).toBe(true);
		expect(yr.significant).toBe(true);
	});
});
