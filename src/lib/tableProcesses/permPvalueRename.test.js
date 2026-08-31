// RectangularWave and DoubleLogistic renamed their permutation-p out-key from
// the bare `pvalue` to `perm_pvalue` (v72.25).
//
// WHY: Cosinor's `pvalue` port became the ANALYTIC F-test p, with the
// permutation p split onto a new `perm_pvalue` port (Cosinor.pvalue.test.js
// pins that contract). For these two nonlinear fits the permutation test is
// the ONLY p they emit — their panels already label it "Permutation p", and no
// canonical analytic test exists — so leaving it on the bare name `pvalue`
// would make the same column name mean different tests on different nodes.
//
// THE LOAD-BEARING PART: saved sessions and the bundled demos bake `pvalue`
// into `args.out` with a real column id. Rekeying is the classic orphaning
// hazard (metricOutputs.js), so the migration must carry the SAME column id
// across to the new key — wires anchor on `col_<colId>` ports, so identity is
// what keeps downstream consumers attached — never delete-and-recreate.
// This file pins: the engine writes the permutation p under the new key, old
// args migrate in place (component path and headless/func path), the column id
// survives, and the committed demo JSONs (real old-shape sessions) migrate.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const { mockColumns, rawData } = vi.hoisted(() => ({
	mockColumns: {},
	rawData: new Map()
}));
vi.mock('$lib/core/core.svelte', () => ({
	core: { rawData },
	appConsts: { processMap: new Map() },
	pushObj: vi.fn()
}));
vi.mock('$lib/core/core.svelte.js', () => ({
	core: { rawData },
	appConsts: { processMap: new Map() },
	pushObj: vi.fn()
}));
vi.mock('$lib/core/Column.svelte', () => ({
	getColumnById: (id) => mockColumns[id],
	removeColumn: vi.fn(),
	Column: class {
		constructor() {
			this.id = -1;
			this.name = '';
			this.type = 'number';
			this.data = -1;
		}
	}
}));
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/ColumnSelector.svelte', () => ({ default: {} }));

// The fit KERNELS are mocked (fast, like RectangularWave.test.js /
// DoubleLogistic.test.js): what this file pins is key ROUTING — which out-key
// the permutation p reaches — not the nonlinear maths, and the real fits make
// the permutation loop take tens of seconds. fitPermutationPValue itself stays
// REAL (it sees these same mocks through fitCurveModel), so the p on the port
// is genuinely the permutation machinery's output, not a planted number.
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
		parameters: { T: 24, M: 50, A: 25, k1: 0.5, k2: 0.5, t1: 6, t2: 18 },
		rmse: 0.3,
		rSquared: 0.96
	})),
	evaluateDoubleLogisticAtPoints: vi.fn((params, periodic, points) => points.map(() => params.M))
}));
import { rectangularwave } from './RectangularWave.svelte';
import { doublelogistic } from './DoubleLogistic.svelte';
import { migrateRenamedOutKey } from './tpArgHelpers.js';
import { migrateRenamedMetricOut } from './metricOutputs.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');

const N = 48;
const t = Array.from({ length: N }, (_, i) => i);
/** Strong square-ish 24 h rhythm with deterministic ripple. */
const y = t.map((ti) => (ti % 24 < 12 ? 75 : 25) + Math.sin(ti * 1.7) * 2);

const wire = (ids) => {
	for (const id of ids) {
		mockColumns[id] = { getData: () => rawData.get(id) ?? [] };
	}
};

beforeEach(() => {
	rawData.clear();
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
	mockColumns[2] = { getData: () => y };
});

const permArgs = {
	permuteTest: true,
	nPermutations: 19, // tiny but real — resolution is enough to assert finiteness
	permutationSeed: 12345,
	permutationStatistic: 'rSquared',
	preProcesses: []
};

describe('RectangularWave: permutation p lands on the perm_pvalue port', () => {
	it('new-shape args: perm_pvalue carries the permutation p; no `pvalue` port exists', () => {
		wire([50, 51, 60, 61, 62]);
		const args = {
			xIN: 1,
			yIN: [2],
			outputX: -1,
			...permArgs,
			out: { rectwavex: 50, rectwavey_2: 51, perm_pvalue: 60, r2: 61, rmse: 62 }
		};
		const [result, valid] = rectangularwave(args);
		expect(valid).toBe(true);
		const yr = result.y_results[2];
		expect(Number.isFinite(yr.pValue)).toBe(true);
		expect(rawData.get(60)).toEqual([yr.pValue]);
		expect(args.out.pvalue).toBeUndefined();
	});

	it('permutations OFF: the port says "not computed" (NaN), never 0/1', () => {
		wire([50, 51, 60, 61, 62]);
		const args = {
			xIN: 1,
			yIN: [2],
			outputX: -1,
			...permArgs,
			permuteTest: false,
			out: { rectwavex: 50, rectwavey_2: 51, perm_pvalue: 60, r2: 61, rmse: 62 }
		};
		const [, valid] = rectangularwave(args);
		expect(valid).toBe(true);
		expect(rawData.get(60)).toHaveLength(1);
		expect(Number.isNaN(rawData.get(60)[0])).toBe(true);
	});

	it('OLD-shape args (saved session): the func itself migrates the key and writes into the SAME column id', () => {
		wire([50, 51, 60, 61, 62]);
		const args = {
			xIN: 1,
			yIN: [2],
			outputX: -1,
			...permArgs,
			// Pre-rename session: the permutation p lived on the bare `pvalue` key.
			out: { rectwavex: 50, rectwavey_2: 51, pvalue: 60, r2: 61, rmse: 62 }
		};
		const [result, valid] = rectangularwave(args);
		expect(valid).toBe(true);
		// Key migrated in place — same column id, old key gone, nothing duplicated.
		expect(args.out.perm_pvalue).toBe(60);
		expect('pvalue' in args.out).toBe(false);
		// The wired column (id 60 — what any downstream `col_60` wire resolves to)
		// received the permutation p.
		expect(rawData.get(60)).toEqual([result.y_results[2].pValue]);
		expect(Number.isFinite(rawData.get(60)[0])).toBe(true);
	});
});

describe('DoubleLogistic: permutation p lands on the perm_pvalue port', () => {
	it('OLD-shape args migrate; perm p reaches the same column id', async () => {
		wire([70, 71, 80, 81, 82]);
		const args = {
			xIN: 1,
			yIN: [2],
			outputX: -1,
			fixPeriod: true,
			fixedPeriod: 24,
			...permArgs,
			out: { dlogx: 70, dlogy_2: 71, pvalue: 80, r2: 81, rmse: 82 }
		};
		const [result, valid] = await doublelogistic(args);
		expect(valid).toBe(true);
		expect(args.out.perm_pvalue).toBe(80);
		expect('pvalue' in args.out).toBe(false);
		expect(rawData.get(80)).toEqual([result.y_results[2].pValue]);
		expect(Number.isFinite(rawData.get(80)[0])).toBe(true);
	});

	it('permutations OFF (new shape): NaN on the port', async () => {
		wire([70, 71, 80, 81, 82]);
		const args = {
			xIN: 1,
			yIN: [2],
			outputX: -1,
			fixPeriod: true,
			fixedPeriod: 24,
			...permArgs,
			permuteTest: false,
			out: { dlogx: 70, dlogy_2: 71, perm_pvalue: 80, r2: 81, rmse: 82 }
		};
		const [, valid] = await doublelogistic(args);
		expect(valid).toBe(true);
		expect(Number.isNaN(rawData.get(80)[0])).toBe(true);
	});
});

describe('migrateRenamedMetricOut (component path): column identity and name', () => {
	it('renames the key, keeps the column id, and follows the SEEDED default name', () => {
		mockColumns[60] = { name: 'pvalue_7' };
		const p = { id: 7, args: { out: { rectwavex: 50, pvalue: 60 } } };
		expect(migrateRenamedMetricOut(p, 'pvalue', 'perm_pvalue')).toBe(true);
		expect(p.args.out.perm_pvalue).toBe(60);
		expect('pvalue' in p.args.out).toBe(false);
		expect(mockColumns[60].name).toBe('perm_pvalue_7');
		// Idempotent: a second load does nothing.
		expect(migrateRenamedMetricOut(p, 'pvalue', 'perm_pvalue')).toBe(false);
	});

	it('leaves a USER-chosen column name alone', () => {
		mockColumns[60] = { name: 'my significance' };
		const p = { id: 7, args: { out: { pvalue: 60 } } };
		migrateRenamedMetricOut(p, 'pvalue', 'perm_pvalue');
		expect(p.args.out.perm_pvalue).toBe(60);
		expect(mockColumns[60].name).toBe('my significance');
	});

	it('does not clobber an already-migrated session that somehow carries both keys', () => {
		const p = { id: 7, args: { out: { pvalue: 60, perm_pvalue: 61 } } };
		expect(migrateRenamedMetricOut(p, 'pvalue', 'perm_pvalue')).toBe(false);
		expect(p.args.out.perm_pvalue).toBe(61);
	});
});

describe('the committed demos are real old-shape sessions and they migrate', () => {
	// These two demo JSONs bake `pvalue: <colId>` (they predate the rename), so
	// they double as fixtures for the exact bytes an end user's saved session
	// holds. On load the component runs migrateRenamedMetricOut; this asserts
	// the pure key step on the REAL session args, id preserved.
	const CASES = [
		['demo-tp-rectangularwave.json', 'RectangularWave'],
		['demo-tp-doublelogistic.json', 'DoubleLogistic']
	];
	for (const [file, name] of CASES) {
		it(`${file}: pvalue out-key re-keys to perm_pvalue with the same column id`, () => {
			const session = JSON.parse(readFileSync(join(repo, 'static/sessions/demos', file), 'utf8'));
			const tp = (session.tableProcesses ?? []).find((x) => x.name === name);
			expect(tp, `${file} should contain a ${name} node`).toBeTruthy();
			const oldId = tp.args.out.pvalue ?? tp.args.out.perm_pvalue;
			expect(oldId).toBeGreaterThanOrEqual(0);
			migrateRenamedOutKey(tp.args, 'pvalue', 'perm_pvalue');
			expect(tp.args.out.perm_pvalue).toBe(oldId);
			expect('pvalue' in tp.args.out).toBe(false);
			// The column itself still exists in the session under that id, so a
			// downstream `col_<id>` wire (the graph's port naming) still resolves.
			const colIds = new Set(
				(session.data ?? session.columns ?? []).map((c) => c.id).filter((v) => v != null)
			);
			if (colIds.size > 0) expect(colIds.has(oldId)).toBe(true);
		});
	}
});
