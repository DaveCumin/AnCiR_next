// A permutation test whose OBSERVED fit fails (fitCurveModel returns null) must not throw: the
// node shows its normal failed-fit warning and perm_pvalue is NaN, as in the Python and R
// ports. It used to throw "Cannot read properties of null (reading 'rSquared')" from
// permutationTest's getStatistic, so Cosinor (which runs the test even for a series whose fit
// failed) errored instead of evaluating. Real classes and fits, no mocks.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { TableProcess } from '$lib/core/TableProcess.svelte';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';
import { permutationTest, permutationTestAsync } from '$lib/utils/permutationTest.js';
import { fitPermutationPValue } from '$lib/utils/fitFunction.js';

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
});

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

// x only on whole 24 h periods: every sine column of the fixed 24 h cosinor is zero, so the
// normal equations are singular and fitCosinorFixed returns null.
const T = Array.from({ length: 10 }, (_, i) => i * 24);
const Y = T.map((_, i) => i % 3);
const FIXED = { useFixedPeriod: true, fixedPeriod: 24 };

describe('permutation test with a failed observed fit', () => {
	it('permutationTest reports an error result instead of throwing', () => {
		const res = permutationTest(T, Y, () => null, { nPermutations: 9 });
		expect(res.error).toBe(true);
		expect(Number.isNaN(res.pValue)).toBe(true);
		expect(res.permutedStats).toEqual([]);
	});

	it('permutationTestAsync (the Fit waveform model panel) does the same', async () => {
		const res = await permutationTestAsync(T, Y, () => null, { nPermutations: 9 });
		expect(res.error).toBe(true);
		expect(Number.isNaN(res.pValue)).toBe(true);
		expect(res.permutedStats).toEqual([]);
	});

	it('fitPermutationPValue gives NaN, not a throw', () => {
		const res = fitPermutationPValue(T, Y, 'cosinor', FIXED, {
			permuteTest: true,
			nPermutations: 9
		});
		expect(Number.isNaN(res.pValue)).toBe(true);
		expect(res.permutedStats).toEqual([]);
	});

	function cosinorNode(permuteTest) {
		const xId = mkCol(T);
		const yId = mkCol(Y);
		const tp = new TableProcess(
			{
				name: 'Cosinor',
				args: {
					xIN: xId,
					yIN: [yId],
					Ncurves: 1,
					outputX: -1,
					...FIXED,
					nHarmonics: 1,
					alpha: 0.05,
					permuteTest,
					nPermutations: 9,
					out: { cosinorx: -1, rsquared: -1, perm_pvalue: -1 }
				}
			},
			null
		);
		return { tp, yId };
	}

	it('the Cosinor node evaluates, warns that the fit failed and writes perm_pvalue NaN', async () => {
		const def = appConsts.tableProcessMap.get('Cosinor');
		const { tp, yId } = cosinorNode(true);
		const [plain] = await def.func({ ...tp.args, permuteTest: false });
		const [result] = await def.func(tp.args);
		const yr = result.y_results[yId];
		expect(Number.isNaN(yr.pValue)).toBe(true);
		expect(yr.permStats).toEqual([]);
		// The normal failed-fit warning, exactly as without the permutation test.
		expect(result.warnings.some((w) => w.includes('The cosinor fit'))).toBe(true);
		expect(result.warnings).toEqual(plain.warnings);
		await tp.doProcess();
		const pId = tp.args.out.perm_pvalue;
		const p = pId >= 0 ? core.rawData.get(pId)?.[0] : undefined;
		expect(p === undefined || Number.isNaN(p)).toBe(true);
	});
});
