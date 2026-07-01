import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mirror the Cosinor test setup: mock the core write-path and column lookup, and
// the Svelte input components the module script imports. computeNPCRA (npcra.js)
// is pure and separately tested — we use the REAL implementation here so this is
// a genuine end-to-end check of the table-process wrapper.
const mockColumns = {};
vi.mock('$lib/core/core.svelte', () => ({ core: { rawData: { set: vi.fn() } } }));
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: (id) => mockColumns[id] }));
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/ControlInput.svelte', () => ({ default: {} }));

import { nonparametricRA, evaluateNPCRA, definition } from './NonparametricRA.svelte';

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
});

// A clean 7-day rest–activity rhythm at 1 h resolution: high (100) for the 10 h
// "active" window each day, low (10) otherwise. Perfectly periodic → high IS,
// low IV, M10 ≫ L5, RA = (100 − 10)/(100 + 10) ≈ 0.818.
function restActivity(days = 7) {
	const t = [];
	const y = [];
	for (let h = 0; h < days * 24; h++) {
		t.push(h);
		const hourOfDay = h % 24;
		y.push(hourOfDay >= 8 && hourOfDay < 18 ? 100 : 10);
	}
	return { t, y };
}

const previewOut = { npcrax: -1 };

describe('NonparametricRA — definition', () => {
	it('declares the expected id, inputs and scalar output ports', () => {
		expect(definition.displayName).toBe('Nonparametric RA');
		expect(definition.nodeSpec.id).toBe('tableprocess.nonparametricra');
		const inNames = definition.nodeSpec.inputs.map((i) => i.name);
		expect(inNames).toEqual(['xIN', 'yIN']);
		const outNames = definition.nodeSpec.outputs.map((o) => o.name);
		for (const key of ['IS', 'IV', 'RA', 'M10', 'L5', 'M10onset', 'L5onset']) {
			expect(outNames).toContain(key);
		}
		expect(definition.xOutKey).toBe('npcrax');
		expect(definition.yOutKeyPrefix).toBe('npcray_');
	});
});

describe('NonparametricRA — nonparametricRA()', () => {
	it('returns invalid when yIN is -1', async () => {
		const [, valid] = await nonparametricRA({ xIN: -1, yIN: -1, out: previewOut });
		expect(valid).toBe(false);
	});

	it('returns invalid when there are no y columns', async () => {
		const { t } = restActivity();
		mockColumns[1] = { type: 'number', getData: () => t };
		const [, valid] = await nonparametricRA({ xIN: 1, yIN: [], out: previewOut });
		expect(valid).toBe(false);
	});

	it('computes IS/IV/RA/M10/L5 for a clean rest–activity rhythm', async () => {
		const { t, y } = restActivity(7);
		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { getData: () => y };

		const [result, valid] = await nonparametricRA({
			xIN: 1,
			yIN: [2],
			epochHours: 1,
			period: 24,
			mWindow: 10,
			lWindow: 5,
			out: previewOut
		});

		expect(valid).toBe(true);
		const res = result.perY[2];
		expect(res).toBeTruthy();
		// M10 sits in the active window, L5 in the rest window.
		expect(res.M10).toBeCloseTo(100, 5);
		expect(res.L5).toBeCloseTo(10, 5);
		expect(res.M10).toBeGreaterThan(res.L5);
		// RA = (M10 − L5)/(M10 + L5).
		expect(res.RA).toBeCloseTo((res.M10 - res.L5) / (res.M10 + res.L5), 6);
		// A perfectly repeating pattern is maximally stable and minimally variable.
		expect(res.IS).toBeGreaterThan(0.9);
		expect(res.IV).toBeGreaterThanOrEqual(0);
		expect(res.IV).toBeLessThan(1);
		// M10 onset should land inside the active window (08:00–18:00).
		expect(res.M10onset).toBeGreaterThanOrEqual(8);
		expect(res.M10onset).toBeLessThanOrEqual(18);
	});

	it('handles multiple y inputs, one result per series in yIN order', async () => {
		const { t, y } = restActivity(5);
		const yFlat = t.map(() => 42); // constant → degenerate but must not throw
		mockColumns[1] = { type: 'number', getData: () => t };
		mockColumns[2] = { getData: () => y };
		mockColumns[3] = { getData: () => yFlat };

		const { perY, anyValid, yINs } = evaluateNPCRA({
			xIN: 1,
			yIN: [2, 3],
			epochHours: 1,
			period: 24,
			mWindow: 10,
			lWindow: 5,
			out: previewOut
		});

		expect(anyValid).toBe(true);
		expect(yINs).toEqual([2, 3]);
		expect(perY[2]).toBeTruthy();
		expect(perY[3]).toBeTruthy();
		// Flat series: M10 === L5, so RA is 0 (or NaN if the denominator is 0).
		expect(perY[3].M10).toBeCloseTo(perY[3].L5, 6);
	});

	it('returns anyValid=false when the x column is empty', async () => {
		mockColumns[1] = { type: 'number', getData: () => [] };
		mockColumns[2] = { getData: () => [] };
		const { anyValid } = evaluateNPCRA({ xIN: 1, yIN: [2], out: previewOut });
		expect(anyValid).toBe(false);
	});
});
