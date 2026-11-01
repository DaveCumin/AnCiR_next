import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mirror the NonparametricRA test: mock the core write-path, column lookup and the Svelte input
// components the component imports, but use the REAL computeNPCRA / circadianFunctionIndex so this
// is a genuine end-to-end check of the table-process wrapper (invalid inputs, metric output ids,
// and the four per-y metric arrays). The maths itself is covered by npcra / cosinorAddons parity.
const mockColumns = {};
const writeCalls = [];
vi.mock('$lib/core/core.svelte', () => ({ core: { rawData: { set: vi.fn() } } }));
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: (id) => mockColumns[id] }));
vi.mock('$lib/tableProcesses/outputColumns.js', () => ({
	writeOutputColumn: (colId, values) => writeCalls.push({ colId, values })
}));
vi.mock('$lib/tableProcesses/metricOutputs.js', () => ({ syncMetricOutColumns: vi.fn() }));
vi.mock('$lib/components/inputs/ColumnSelector.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/ControlInput.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/StoreValueButton.svelte', () => ({ default: {} }));
vi.mock('$lib/components/LoadingSpinner.svelte', () => ({ default: {} }));

import { circadianfunctionindex, evaluateCFI, definition } from './CircadianFunctionIndex.svelte';

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	writeCalls.length = 0;
});

// A clean 7-day rest–activity rhythm (active 08:00–18:00) — high IS, RA ≈ 0.818.
function restActivity(days = 7) {
	const t = [];
	const y = [];
	for (let h = 0; h < days * 24; h++) {
		t.push(h);
		y.push(h % 24 >= 8 && h % 24 < 18 ? 100 : 10);
	}
	return { t, y };
}

const OUT = { CFI: 10, IS: 11, IV: 12, RA: 13 };

describe('CircadianFunctionIndex — definition', () => {
	it('declares the id, inputs and the four metric output ports', () => {
		expect(definition.displayName).toBe('Circadian Function Index');
		expect(definition.nodeSpec.id).toBe('tableprocess.circadianfunctionindex');
		expect(definition.nodeSpec.inputs.map((i) => i.name)).toEqual(['xIN', 'yIN']);
		const outs = definition.nodeSpec.outputs;
		expect(outs.map((o) => o.name)).toEqual(['CFI', 'IS', 'IV', 'RA']);
		expect(outs.every((o) => o.metric === true)).toBe(true);
	});
});

describe('CircadianFunctionIndex — invalid inputs', () => {
	it('is invalid when yIN is -1', async () => {
		const [, valid] = await circadianfunctionindex({ xIN: -1, yIN: -1, out: { ...OUT } });
		expect(valid).toBe(false);
	});

	it('is invalid when there are no y columns', async () => {
		mockColumns[1] = { type: 'number', getData: () => restActivity().t };
		const [, valid] = await circadianfunctionindex({ xIN: 1, yIN: [], out: { ...OUT } });
		expect(valid).toBe(false);
	});

	it('reports anyValid=false when the x column is empty', () => {
		mockColumns[1] = { type: 'number', getData: () => [] };
		mockColumns[2] = { getData: () => [] };
		expect(evaluateCFI({ xIN: 1, yIN: [2] }).anyValid).toBe(false);
	});

	it('writes no outputs when invalid', async () => {
		await circadianfunctionindex({ xIN: -1, yIN: -1, out: { ...OUT } });
		expect(writeCalls).toHaveLength(0);
	});
});

describe('CircadianFunctionIndex — computation + metric outputs', () => {
	it('computes CFI (0–1) and its IS/IV/RA components for a clean rhythm', async () => {
		const { t, y } = restActivity(7);
		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { getData: () => y };

		const [result, valid] = await circadianfunctionindex({ xIN: 1, yIN: [2], out: { ...OUT } });

		expect(valid).toBe(true);
		const r = result.perY[2];
		expect(r.CFI).toBeGreaterThanOrEqual(0);
		expect(r.CFI).toBeLessThanOrEqual(1);
		expect(r.IS).toBeGreaterThan(0.9); // perfectly periodic
		expect(r.RA).toBeCloseTo((100 - 10) / (100 + 10), 3); // ≈ 0.818
	});

	it('writes all four metric arrays to their output ids, one value per y in yIN order', async () => {
		const { t, y } = restActivity(5);
		const flat = t.map(() => 42); // degenerate second series — must not throw
		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { getData: () => y };
		mockColumns[3] = { getData: () => flat };

		await circadianfunctionindex({ xIN: 1, yIN: [2, 3], out: { ...OUT } });

		// One writeOutputColumn call per metric key, to the matching output column id.
		expect(writeCalls.map((c) => c.colId).sort((a, b) => a - b)).toEqual([10, 11, 12, 13]);
		for (const call of writeCalls) {
			expect(call.values).toHaveLength(2); // two y inputs, in order
		}
		const byId = Object.fromEntries(writeCalls.map((c) => [c.colId, c.values]));
		// CFI (id 10) column: [cfi(y2), cfi(y3)] in yIN order — the clean rhythm gives a finite CFI;
		// the degenerate flat series yields NaN (no variance → IS/IV undefined).
		expect(Number.isFinite(byId[10][0])).toBe(true);
		expect(byId[10][0]).toBeGreaterThan(0);
		expect(Number.isNaN(byId[10][1])).toBe(true);
	});
});

// FIT-8: CFI folds the same IS and IV NonparametricRA reports, so it carries the same
// warning when more than 10% of the epochs are empty (IS and IV then rest on a thinner
// record than the recording's length suggests).
describe('CircadianFunctionIndex: missing-epoch warning (FIT-8)', () => {
	const args = { xIN: 1, yIN: [2], epochHours: 1, period: 24, out: { ...OUT } };

	it('warns, naming the column and the share, when more than 10% of epochs are missing', async () => {
		const { t, y } = restActivity(10);
		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { name: 'wheel', getData: () => y.map((v, i) => (i % 5 === 2 ? null : v)) };
		const [result] = await circadianfunctionindex(args);
		const w = result.warnings.find((m) => /epochs have no data/.test(m));
		expect(w).toMatch(/"wheel"/);
		expect(w).toMatch(/20% of the 1 h epochs/);
	});

	it('does not warn at 10% or less', () => {
		const { t, y } = restActivity(10);
		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { name: 'wheel', getData: () => y.map((v, i) => (i % 10 === 2 ? null : v)) };
		expect(evaluateCFI(args).warnings).toEqual([]);
	});

	it('has an empty warnings list for a complete record', () => {
		const { t, y } = restActivity(10);
		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { name: 'wheel', getData: () => y };
		expect(evaluateCFI(args).warnings).toEqual([]);
	});
});

// Full days only (decision 2026-11-01, as NonparametricRA in v82.66): the CFI folds the
// IS, IV and RA it reports next to it, so it uses the same whole-day cut.
describe('CircadianFunctionIndex: full days only', () => {
	// 7.5 days whose extra half day is unlike the rest, so the partial day moves IS/IV/RA.
	function withPartialDay() {
		const { t, y } = restActivity(7);
		for (let h = 168; h < 180; h++) {
			t.push(h);
			y.push(55);
		}
		return { t, y };
	}

	it('defaults OFF (saved sessions), ON for a new node (newNodeArgs)', async () => {
		expect(definition.defaults.get('fullDays')?.val).toBe(false);
		expect(definition.newNodeArgs).toEqual({ fullDays: true });
		const { buildTableProcessDefaults } = await import('$lib/core/tpDefaults.js');
		expect(buildTableProcessDefaults({ defaults: definition.defaults, definition }).fullDays).toBe(
			true
		);
	});

	it('a partial-day record gives a different CFI with the option on and off', () => {
		const { t, y } = withPartialDay();
		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { getData: () => y };
		const on = evaluateCFI({ xIN: 1, yIN: [2], fullDays: true }).perY[2];
		const off = evaluateCFI({ xIN: 1, yIN: [2], fullDays: false }).perY[2];
		const absent = evaluateCFI({ xIN: 1, yIN: [2] }).perY[2];
		expect(Number.isFinite(on.CFI) && Number.isFinite(off.CFI)).toBe(true);
		expect(Math.abs(on.CFI - off.CFI)).toBeGreaterThan(1e-3);
		expect(on.IS).toBeCloseTo(1, 12); // the 7 clean days alone
		expect(absent.CFI).toBe(off.CFI);
	});

	it('ON folds exactly the IS/IV/RA of the trimmed record (as Nonparametric RA reports them)', async () => {
		const { computeNPCRA } = await import('$lib/utils/npcra.js');
		const { circadianFunctionIndex } = await import('$lib/utils/cosinorAddons.js');
		const { t, y } = withPartialDay();
		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { getData: () => y };
		const opts = { epochHours: 1, period: 24, mWindow: 10, lWindow: 5 };
		const trimmed = computeNPCRA(t, y, { ...opts, fullDays: true });
		const on = evaluateCFI({ xIN: 1, yIN: [2], ...opts, fullDays: true }).perY[2];
		expect(on.IS).toBe(trimmed.IS);
		expect(on.IV).toBe(trimmed.IV);
		expect(on.RA).toBe(trimmed.RA);
		expect(on.CFI).toBe(circadianFunctionIndex(trimmed).CFI);
		// ...and what the panel says was left out.
		expect(on.fullDaysKept).toBe(7);
		expect(on.droppedEpochs).toBe(12);
	});

	it('a record shorter than one period warns that nothing could be cut', () => {
		const t = Array.from({ length: 20 }, (_, i) => i);
		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { getData: () => t.map((h) => (h < 10 ? 100 : 10)) };
		const r = evaluateCFI({ xIN: 1, yIN: [2], fullDays: true });
		expect(r.warnings).toContain(
			'Full days only: the recording is shorter than one 24 h cycle, so there is no whole day to keep and every epoch is used.'
		);
		const off = evaluateCFI({ xIN: 1, yIN: [2], fullDays: false });
		expect(off.warnings.some((w) => w.startsWith('Full days only'))).toBe(false);
	});
});
