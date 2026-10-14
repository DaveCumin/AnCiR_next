// @ts-nocheck
// Pins the claim behind decision Q2 of the "fold Data View into Table" plan (2026-10-15): the
// permutations table's `observed_statistic` and `p_value` columns are NOT offered as Table
// output ports because each is already one value per series on the node's own ports. For
// Cosinor, Double logistic and Rectangular wave at the default statistic (R²), per series:
//   observed_statistic === the node's R² port (`rsquared` on Cosinor, `r2` on the other two)
//   p_value            === the node's `perm_pvalue` port
// If a change ever breaks either equality, the Table needs those two ports after all.
//
// Runs each node's headless compute (the function its component and the MCP engine call) on
// two series, with real columns in core.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { core, appConsts, pushObj } from '$lib/core/core.svelte.js';
import { Column, getColumnById } from '$lib/core/Column.svelte';
import { loadProcesses } from '$test/processRegistry.js';
import { setWorkerFactory } from '$lib/workers/workerPool.js';
import { permutationTableData, PERMUTATION_TABLE_OUTPUTS } from './permutationSupport.js';

const { cosinor } = await import('./Cosinor.svelte');
const { doublelogistic } = await import('./DoubleLogistic.svelte');
const { rectangularwave } = await import('./RectangularWave.svelte');

class ThrowOnPost {
	postMessage() {
		throw new Error('synchronous compute in tests');
	}
	terminate() {}
}

const t = Array.from({ length: 96 }, (_, i) => i);
// Two rhythms of different strength, with deterministic wobble, so R² and p differ by series.
const ys = {
	strong: t.map((v) => 10 + 4 * Math.cos((2 * Math.PI * v) / 24) + 0.5 * Math.sin(v * 1.7)),
	weak: t.map((v) => 10 + 0.6 * Math.cos((2 * Math.PI * (v - 5)) / 24) + Math.sin(v * 2.3))
};

function column(name, data) {
	const col = new Column({ type: 'number', data: -1 });
	col.customName = name;
	if (data) {
		core.rawData.set(col.id, data);
		col.data = col.id;
	}
	pushObj(col);
	return col.id;
}

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	setWorkerFactory(() => new ThrowOnPost());
});
beforeEach(() => {
	core.data = [];
	core.tableProcesses = [];
	core.rawData = new Map();
});

const NODES = [
	{
		name: 'Cosinor',
		r2Key: 'rsquared',
		run: cosinor,
		xOut: 'cosinorx',
		args: { useFixedPeriod: true, fixedPeriod: 24 },
		yResults: (res) => res[0].y_results
	},
	{
		name: 'Double logistic',
		r2Key: 'r2',
		run: doublelogistic,
		xOut: 'dlogx',
		args: { fixPeriod: true, fixedPeriod: 24 },
		yResults: (res) => res[0].y_results
	},
	{
		name: 'Rectangular wave',
		r2Key: 'r2',
		run: rectangularwave,
		xOut: 'rectwavex',
		args: { fixOmega: true, fixedPeriod: 24 },
		yResults: (res) => res[0].y_results
	}
];

describe.each(NODES)(
	'$name: the permutations table repeats values the node already outputs',
	(n) => {
		it('observed_statistic is the R² port and p_value is perm_pvalue, per series', async () => {
			const x = column('time', t);
			const yIds = Object.entries(ys).map(([name, data]) => column(name, data));
			const out = {
				[n.xOut]: column('x out'),
				[n.r2Key]: column('r2 out'),
				perm_pvalue: column('p out')
			};
			const args = {
				xIN: x,
				yIN: yIds,
				outputX: -1,
				permuteTest: true,
				nPermutations: 39,
				permutationSeed: 11,
				...n.args,
				out
			};
			const res = await n.run(args);
			const yResults = n.yResults(res);
			const entries = yIds.map((id) => ({ name: getColumnById(id).name, result: yResults[id] }));
			const { headers, rows } = permutationTableData(entries);
			const at = (h) => headers.indexOf(h);
			const r2Port = core.rawData.get(out[n.r2Key]);
			const pPort = core.rawData.get(out.perm_pvalue);
			expect(r2Port).toHaveLength(2);
			expect(pPort).toHaveLength(2);

			yIds.forEach((id, i) => {
				const seriesRows = rows.filter((r) => r[at('series')] === getColumnById(id).name);
				expect(seriesRows).toHaveLength(39);
				expect(seriesRows.every((r) => r[at('statistic')] === 'rSquared')).toBe(true);
				for (const r of seriesRows) {
					expect(r[at('observed_statistic')]).toBeCloseTo(r2Port[i], 12);
					expect(r[at('p_value')]).toBe(pPort[i]);
				}
			});
			// The two series differ, so the equality is per series and not one shared value.
			expect(r2Port[0]).not.toBeCloseTo(r2Port[1], 3);
			// And those two columns are exactly the ones the Table does not offer as ports.
			const declared = PERMUTATION_TABLE_OUTPUTS.map((o) => o.key);
			expect(declared).not.toContain('observed_statistic');
			expect(declared).not.toContain('p_value');
		});
	}
);
