// @ts-nocheck
// Moving Analysis, double logistic: windows whose fit cannot pin down the active period
// are counted in one warning per series (decision 2026-11-01). Real fits, no mocks of the maths.
import { describe, it, expect, vi } from 'vitest';

const mockColumns = {};
vi.mock('$lib/core/core.svelte', () => ({
	core: { rawData: { set: vi.fn(), get: vi.fn(), has: vi.fn() } },
	appConsts: { processMap: new Map() }
}));
vi.mock('$lib/core/Column.svelte', () => ({
	Column: class {},
	getColumnById: (id) => mockColumns[id],
	removeColumn: vi.fn()
}));
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/ColumnSelector.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/AttributeSelect.svelte', () => ({ default: {} }));
vi.mock('$lib/components/plotbits/Table.svelte', () => ({ default: {} }));
vi.mock('$lib/components/LoadingSpinner.svelte', () => ({ default: {} }));

import { movinganalysis } from './MovingAnalysis.svelte';

const t = Array.from({ length: 240 }, (_, i) => i);
const args = {
	xIN: 1,
	yIN: [2],
	windowSize: 96,
	stepSize: 24,
	binLabel: 'center',
	analysis: 'doublelogistic',
	dlPeriodic: true,
	useFixedPeriod: true,
	fixedPeriod: 24,
	out: { movex: -1 }
};
const run = (y) => {
	mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
	mockColumns[2] = { type: 'number', getData: () => y, name: 'y' };
	return movinganalysis(args);
};

describe('Moving Analysis double logistic reliability warning', { timeout: 60000 }, () => {
	it('a cosine: every window is too gradual, counted once', async () => {
		const [res, valid] = await run(t.map((i) => 10 + 4 * Math.cos((2 * Math.PI * i) / 24)));
		expect(valid).toBe(true);
		const w = res.warnings.filter((s) => s.includes('pin down the active period'));
		expect(w).toHaveLength(1);
		expect(w[0]).toMatch(
			/^The rise and fall are too gradual to pin down the active period in 6 of 6 fitted windows/
		);
		expect(w[0]).toContain('treat the onset and offset in those windows as unreliable');
	});
	it('a clean square wave: no warning', async () => {
		const [res] = await run(t.map((i) => ((i + 18) % 24 < 12 ? 15 : 5)));
		expect(res.warnings.some((s) => s.includes('pin down the active period'))).toBe(false);
	});
});
