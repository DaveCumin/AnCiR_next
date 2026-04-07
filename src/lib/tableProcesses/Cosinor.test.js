import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockColumns = {};
vi.mock('$lib/core/core.svelte', () => ({ core: { rawData: { set: vi.fn() } } }));
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: (id) => mockColumns[id] }));
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/AttributeSelect.svelte', () => ({ default: {} }));
vi.mock('$lib/utils/cosinor.js', () => ({
	fitCosineCurves: vi.fn(() => ({
		fitted: [1, 2, 3],
		parameters: { cosines: [{ amplitude: 1, frequency: 0.26, acrophase: 0 }] },
		rmse: 0.1,
		rSquared: 0.99
	})),
	evaluateCosinorAtPoints: vi.fn((pts) => pts.map(() => 1)),
	fitCosinorFixed: vi.fn(() => ({
		fitted: [1, 2, 3],
		M: 0,
		harmonics: [{ k: 1, amplitude: 1, acrophase_rad: 0, beta: 1, gamma: 0 }],
		rmse: 0.1,
		rSquared: 0.99,
		stats: {}
	}))
}));

import { cosinor } from './Cosinor.svelte';

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
});

const preview = { cosinorx: -1, cosinory: -1 };

describe('cosinor', () => {
	it('returns invalid when inputs are -1', () => {
		const [, valid] = cosinor({ xIN: -1, yIN: -1, Ncurves: 1, outputX: -1, out: preview, useFixedPeriod: false, fixedPeriod: 24, nHarmonics: 1, alpha: 0.05 });
		expect(valid).toBe(false);
	});

	it('runs with auto-fit mode and returns valid', () => {
		const t = Array.from({ length: 48 }, (_, i) => i);
		const y = t.map((ti) => Math.cos((2 * Math.PI * ti) / 24));
		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { getData: () => y };

		const [, valid] = cosinor({
			xIN: 1, yIN: 2, Ncurves: 1, outputX: -1,
			out: preview, useFixedPeriod: false,
			fixedPeriod: 24, nHarmonics: 1, alpha: 0.05
		});
		expect(valid).toBe(true);
	});

	it('runs with fixed-period mode and returns valid', () => {
		const t = Array.from({ length: 48 }, (_, i) => i);
		const y = t.map((ti) => Math.cos((2 * Math.PI * ti) / 24));
		mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
		mockColumns[2] = { getData: () => y };

		const [, valid] = cosinor({
			xIN: 1, yIN: 2, Ncurves: 0, outputX: -1,
			out: preview, useFixedPeriod: true,
			fixedPeriod: 24, nHarmonics: 1, alpha: 0.05
		});
		expect(valid).toBe(true);
	});
});
