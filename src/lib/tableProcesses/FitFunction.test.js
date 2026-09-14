// FitFunction ("Fit waveform model") metric output ports.
//
// Until v72.29 this was the ONLY fit node with ZERO metric ports — R² and RMSE
// existed solely as StoreValueButton scrapes, so its results could not feed
// downstream analysis (2026-08-11 fit-node consolidation scope). This file pins
// the new contract:
//
//   • the shared core (r2 / rmse / perm_pvalue) exists for every model, keyed
//     exactly like RectangularWave / DoubleLogistic so the same column name
//     means the same quantity on every fit node;
//   • the per-model parameter set (getFitMetricKeys) follows the dedicated
//     nodes' key names where the quantity is identical (period / mesor /
//     amplitude / acrophase as on Cosinor);
//   • perm_pvalue is STRICTLY the permutation test's empirical p — the cosinor
//     fixed-period fit's analytic pF also lands on fitResult.pValue, and must
//     never leak onto this port when the test did not run;
//   • old sessions gain the ports via syncMetricOutColumns backfill, and a
//     model switch deletes the parameter keys that no longer apply while the
//     shared core keeps its column ids (downstream wires anchor on col_<id>).
//
// The fit KERNELS are mocked (fast, like permPvalueRename.test.js): what this
// file pins is key ROUTING and value extraction, not the nonlinear maths.
// fitPermutationPValue stays REAL, so the p on the port is genuinely the
// permutation machinery's output.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockColumns, rawData, tableProcesses } = vi.hoisted(() => ({
	mockColumns: {},
	rawData: new Map(),
	tableProcesses: []
}));
vi.mock('$lib/core/core.svelte', () => ({
	core: { rawData, tableProcesses },
	appConsts: { processMap: new Map() },
	pushObj: vi.fn((obj) => {
		mockColumns[obj.id] = obj;
	})
}));
vi.mock('$lib/core/core.svelte.js', () => ({
	core: { rawData, tableProcesses },
	appConsts: { processMap: new Map() },
	pushObj: vi.fn((obj) => {
		mockColumns[obj.id] = obj;
	})
}));
vi.mock('$lib/core/Column.svelte', () => {
	let nextId = 500;
	return {
		getColumnById: (id) => mockColumns[id],
		removeColumn: vi.fn((id) => {
			delete mockColumns[id];
		}),
		Column: class {
			constructor() {
				this.id = nextId++;
				this.name = '';
				this.type = 'number';
				this.data = -1;
			}
		}
	};
});
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/ColumnSelector.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/AttributeSelect.svelte', () => ({ default: {} }));

vi.mock('$lib/utils/cosinor.js', () => ({
	fitCosinorFixed: vi.fn((tt, yy) => ({
		fitted: yy.map((v) => v * 0.9),
		M: 40,
		harmonics: [{ k: 1, amplitude: 12, acrophase_hrs: 5, beta: 1, gamma: 0 }],
		RMSE: 0.5,
		R2: 0.9,
		pF: 0.01
	})),
	fitCosineCurves: vi.fn((tt, yy) => ({
		fitted: yy.map((v) => v * 0.9),
		parameters: {
			O: 40,
			cosines: [{ amplitude: 12, frequency: (2 * Math.PI) / 24, phase: -Math.PI / 2 }]
		},
		rmse: 0.6,
		rSquared: 0.85
	})),
	evaluateCosinorAtPoints: vi.fn((params, points) => points.map(() => 40))
}));
vi.mock('$lib/utils/rectwave.js', () => ({
	fitRectangularWave: vi.fn((tt, yy) => ({
		fitted: yy.map((v) => v * 0.9),
		parameters: { period: 24, acrophase: 12, dutyCycle: 0.5, kappa: 5, M: 50, A: 25 },
		period: 24,
		acrophase: 12,
		rmse: 0.5,
		rSquared: 0.95
	})),
	evaluateRectWaveAtPoints: vi.fn((params, points) => points.map(() => params.M))
}));
vi.mock('$lib/utils/doublelogistic.js', () => ({
	fitDoubleLogistic: vi.fn((tt, yy) => ({
		fitted: yy.map((v) => v * 0.9),
		parameters: { T: 24, M: 50, A: 25, k1: 0.5, k2: 0.7, t1: 6, t2: 18 },
		onsetPhase: 6,
		offsetPhase: 18,
		dutyCycle: 0.5,
		rmse: 0.3,
		rSquared: 0.96
	})),
	evaluateDoubleLogisticAtPoints: vi.fn((params, periodic, points) => points.map(() => params.M))
}));

import {
	fitFunction,
	definition,
	FIT_METRIC_KEYS_ALL,
	getFitMetricKeys,
	fitMetricValue
} from './FitFunction.svelte';
import { syncMetricOutColumns } from './metricOutputs.js';
import { wrapToPeriod } from '$lib/utils/cosinorAddons.js';

const N = 48;
const t = Array.from({ length: N }, (_, i) => i);
const y = t.map((ti) => 40 + 12 * Math.cos((2 * Math.PI * ti) / 24) + Math.sin(ti * 1.7));

const wire = (ids) => {
	for (const id of ids) {
		mockColumns[id] = { getData: () => rawData.get(id) ?? [] };
	}
};

/** A fully wired out map for the given model, ids 100+. */
function wiredOut(model) {
	const out = { fitx: 100, fity_2: 101, resid_2: 102, permstats_2: 103 };
	let id = 110;
	for (const key of getFitMetricKeys({ model })) out[key] = id++;
	wire(Object.values(out));
	return out;
}

const baseArgs = {
	xIN: 1,
	yIN: [2],
	outputX: -1,
	useFixedPeriod: true,
	fixedPeriod: 24,
	Ncurves: 1,
	nHarmonics: 1,
	alpha: 0.05,
	permuteTest: false,
	nPermutations: 19,
	permutationSeed: 12345,
	permutationStatistic: 'rSquared',
	preProcesses: []
};

beforeEach(() => {
	rawData.clear();
	tableProcesses.length = 0;
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
	mockColumns[2] = { getData: () => y };
});

describe('FitFunction — port declaration', () => {
	it('declares the shared core + per-model parameter metrics in nodeSpec', () => {
		const outs = definition.nodeSpec.outputs;
		const metricNames = outs.filter((o) => o.metric === true).map((o) => o.name);
		expect(metricNames.sort()).toEqual([...FIT_METRIC_KEYS_ALL].sort());
		// The series outputs are untouched.
		expect(outs.map((o) => o.name)).toEqual(
			expect.arrayContaining(['fitx', 'fity_*', 'resid_*', 'permstats_*'])
		);
	});

	it('seeds the default-model (cosinor) keys in the defaults out template', () => {
		const outTemplate = definition.defaults.get('out');
		expect(Object.keys(outTemplate).sort()).toEqual(
			['fitx', ...getFitMetricKeys({ model: 'cosinor' })].sort()
		);
	});

	it('getFitMetricKeys: shared core for every model, plus the model parameters', () => {
		for (const model of ['cosinor', 'rectangular', 'doublelogistic']) {
			const keys = getFitMetricKeys({ model });
			expect(keys).toEqual(expect.arrayContaining(['r2', 'rmse', 'perm_pvalue']));
			for (const k of keys) expect(FIT_METRIC_KEYS_ALL).toContain(k);
		}
		expect(getFitMetricKeys({ model: 'cosinor' })).toContain('acrophase');
		expect(getFitMetricKeys({ model: 'cosinor' })).not.toContain('kappa');
		expect(getFitMetricKeys({ model: 'rectangular' })).toEqual(
			expect.arrayContaining(['duty_cycle', 'kappa'])
		);
		expect(getFitMetricKeys({ model: 'doublelogistic' })).toEqual(
			expect.arrayContaining(['onset', 'offset', 'k1', 'k2', 'duty_cycle'])
		);
		expect(getFitMetricKeys({ model: 'doublelogistic' })).not.toContain('acrophase');
	});
});

describe('FitFunction — datum → metric mapping (values on the ports)', () => {
	it('cosinor (fixed period): Cosinor-convention values, one per y, in yIN order', async () => {
		const out = wiredOut('cosinor');
		mockColumns[3] = { getData: () => y.map((v) => v + 1) };
		out.fity_3 = 104;
		out.resid_3 = 105;
		out.permstats_3 = 106;
		wire([104, 105, 106]);
		const args = { ...baseArgs, yIN: [2, 3], model: 'cosinor', out };
		const [, valid] = await fitFunction(args);
		expect(valid).toBe(true);
		expect(rawData.get(out.r2)).toEqual([0.9, 0.9]);
		expect(rawData.get(out.rmse)).toEqual([0.5, 0.5]);
		expect(rawData.get(out.period)).toEqual([24, 24]);
		expect(rawData.get(out.mesor)).toEqual([40, 40]);
		expect(rawData.get(out.amplitude)).toEqual([12, 12]);
		// fixedStats reports the classical acrophase (5 h); the port carries the
		// PEAK time wrapped into [0, period), Cosinor's convention.
		expect(rawData.get(out.acrophase)).toEqual([wrapToPeriod(-5, 24), wrapToPeriod(-5, 24)]);
		expect(rawData.get(out.acrophase)[0]).toBe(19);
	});

	it('cosinor (free period): period/mesor/amplitude/acrophase from the first cosine', async () => {
		const out = wiredOut('cosinor');
		const args = { ...baseArgs, model: 'cosinor', useFixedPeriod: false, out };
		const [, valid] = await fitFunction(args);
		expect(valid).toBe(true);
		expect(rawData.get(out.r2)).toEqual([0.85]);
		expect(rawData.get(out.rmse)).toEqual([0.6]);
		expect(rawData.get(out.period)[0]).toBeCloseTo(24, 10);
		expect(rawData.get(out.mesor)).toEqual([40]);
		expect(rawData.get(out.amplitude)).toEqual([12]);
		// A·cos(ωt + φ) with φ = −π/2 peaks at t = 6 h.
		expect(rawData.get(out.acrophase)[0]).toBeCloseTo(6, 10);
	});

	it('rectangular: period/acrophase/mesor/amplitude/duty_cycle/kappa', async () => {
		const out = wiredOut('rectangular');
		const args = { ...baseArgs, model: 'rectangular', out };
		const [, valid] = await fitFunction(args);
		expect(valid).toBe(true);
		expect(rawData.get(out.r2)).toEqual([0.95]);
		expect(rawData.get(out.rmse)).toEqual([0.5]);
		expect(rawData.get(out.period)).toEqual([24]);
		expect(rawData.get(out.acrophase)).toEqual([12]);
		expect(rawData.get(out.mesor)).toEqual([50]);
		expect(rawData.get(out.amplitude)).toEqual([25]);
		expect(rawData.get(out.duty_cycle)).toEqual([0.5]);
		expect(rawData.get(out.kappa)).toEqual([5]);
	});

	it('double logistic: onset/offset/k1/k2/period/duty_cycle', async () => {
		const out = wiredOut('doublelogistic');
		const args = { ...baseArgs, model: 'doublelogistic', periodic: true, out };
		const [, valid] = await fitFunction(args);
		expect(valid).toBe(true);
		expect(rawData.get(out.r2)).toEqual([0.96]);
		expect(rawData.get(out.rmse)).toEqual([0.3]);
		expect(rawData.get(out.period)).toEqual([24]);
		expect(rawData.get(out.mesor)).toEqual([50]);
		expect(rawData.get(out.amplitude)).toEqual([25]);
		expect(rawData.get(out.onset)).toEqual([6]);
		expect(rawData.get(out.offset)).toEqual([18]);
		expect(rawData.get(out.k1)).toEqual([0.5]);
		expect(rawData.get(out.k2)).toEqual([0.7]);
		expect(rawData.get(out.duty_cycle)).toEqual([0.5]);
	});

	it('a y column that fails to pair (all-null) gets NaN, not a shifted slot', async () => {
		const out = wiredOut('cosinor');
		mockColumns[3] = { getData: () => y.map(() => null) };
		out.fity_3 = 104;
		wire([104]);
		const args = { ...baseArgs, yIN: [2, 3], model: 'cosinor', out };
		const [, valid] = await fitFunction(args);
		expect(valid).toBe(true);
		expect(rawData.get(out.r2)).toHaveLength(2);
		expect(rawData.get(out.r2)[0]).toBe(0.9);
		expect(Number.isNaN(rawData.get(out.r2)[1])).toBe(true);
	});
});

describe('FitFunction — perm_pvalue is strictly the permutation p', () => {
	it('permutations OFF: NaN on the port even though the cosinor fixed fit carries an analytic pF', async () => {
		const out = wiredOut('cosinor');
		const args = { ...baseArgs, model: 'cosinor', out };
		const [result, valid] = await fitFunction(args);
		expect(valid).toBe(true);
		// The analytic F-test p IS on the fit result…
		expect(result.y_results[2].fitResult.pValue).toBe(0.01);
		// …but must not leak onto the permutation port.
		expect(Number.isNaN(rawData.get(out.perm_pvalue)[0])).toBe(true);
	});

	it('permutations ON (headless func): a real permutation p and the null distribution', async () => {
		const out = wiredOut('cosinor');
		const args = { ...baseArgs, model: 'cosinor', permuteTest: true, out };
		const [result, valid] = await fitFunction(args);
		expect(valid).toBe(true);
		const p = rawData.get(out.perm_pvalue)[0];
		expect(Number.isFinite(p)).toBe(true);
		expect(p).toBe(result.y_results[2].fitResult.pValue);
		expect(rawData.get(out.permstats_2)).toHaveLength(19);
	});
});

describe('FitFunction — backfill and model-switch reconcile (old sessions)', () => {
	function committedTP(model) {
		const p = {
			id: 9,
			parent: null,
			args: { model, out: { fitx: 50, fity_2: 51, resid_2: 52, permstats_2: 53 } }
		};
		tableProcesses.push({ id: p.id });
		wire([50, 51, 52, 53]);
		return p;
	}
	const sync = (p) =>
		syncMetricOutColumns(p, getFitMetricKeys(p.args), (k) => FIT_METRIC_KEYS_ALL.includes(k));

	it('an old-shape session (no metric keys) gains the current model set on sync', () => {
		const p = committedTP('cosinor');
		expect(sync(p)).toBe(true);
		for (const key of getFitMetricKeys(p.args)) {
			expect(p.args.out[key]).toBeGreaterThanOrEqual(500);
			expect(mockColumns[p.args.out[key]].name).toBe(`${key}_9`);
		}
		// Series outputs untouched.
		expect(p.args.out.fitx).toBe(50);
		expect(p.args.out.fity_2).toBe(51);
		// Idempotent: nothing to do the second time.
		expect(sync(p)).toBe(false);
	});

	it('a model switch swaps the parameter keys but keeps the shared core columns', () => {
		const p = committedTP('cosinor');
		sync(p);
		const coreIds = { r2: p.args.out.r2, rmse: p.args.out.rmse, perm: p.args.out.perm_pvalue };
		const acroId = p.args.out.acrophase;

		p.args.model = 'doublelogistic';
		expect(sync(p)).toBe(true);
		// Shared core: same column ids, downstream wires survive.
		expect(p.args.out.r2).toBe(coreIds.r2);
		expect(p.args.out.rmse).toBe(coreIds.rmse);
		expect(p.args.out.perm_pvalue).toBe(coreIds.perm);
		// acrophase means nothing for a double logistic: deleted, not rebound.
		expect('acrophase' in p.args.out).toBe(false);
		expect(mockColumns[acroId]).toBeUndefined();
		for (const key of ['onset', 'offset', 'k1', 'k2', 'duty_cycle']) {
			expect(p.args.out[key]).toBeGreaterThanOrEqual(500);
		}
	});
});

describe('FitFunction — round-trip', () => {
	it('args survive a JSON round-trip and produce identical metric writes', async () => {
		const out = wiredOut('rectangular');
		const args = { ...baseArgs, model: 'rectangular', out };
		await fitFunction(args);
		const firstWrites = Object.fromEntries(
			getFitMetricKeys(args).map((k) => [k, rawData.get(out[k])])
		);

		const revived = JSON.parse(JSON.stringify(args));
		rawData.clear();
		wire(Object.values(out));
		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { getData: () => y };
		const [, valid] = await fitFunction(revived);
		expect(valid).toBe(true);
		for (const k of getFitMetricKeys(args)) {
			expect(rawData.get(out[k])).toEqual(firstWrites[k]);
		}
	});

	it('fitMetricValue returns NaN for a missing fit result (never throws)', () => {
		for (const key of FIT_METRIC_KEYS_ALL) {
			expect(Number.isNaN(fitMetricValue(key, 'cosinor', null))).toBe(true);
			expect(Number.isNaN(fitMetricValue(key, 'rectangular', undefined))).toBe(true);
		}
	});
});
