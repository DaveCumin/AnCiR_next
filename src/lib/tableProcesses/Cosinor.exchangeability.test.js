// @ts-nocheck
// Review finding FIT-5 on the Cosinor node. Both the zero-amplitude F-test and the shuffle
// permutation test assume independent (exchangeable) observations; on AR(1) noise with no
// rhythm they reject at 0.05 in about a third of records. Wave 1 added the block scheme
// and the residual-autocorrelation warning to Rectangular wave and Double logistic; these
// pin the same on Cosinor (real maths, no mocks of cosinor.js).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockColumns = {};
vi.mock('$lib/core/core.svelte', () => ({ core: { rawData: { set: vi.fn() } } }));
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: (id) => mockColumns[id] }));
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/AttributeSelect.svelte', () => ({ default: {} }));

import { cosinor, definition } from './Cosinor.svelte';

function lcg(seed) {
	let s = seed;
	const rnd = () => {
		s = (1103515245 * s + 12345) % 2147483648;
		return s / 2147483648;
	};
	return () => {
		const u = rnd() || 1e-12;
		return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
	};
}
const N = 240; // ten days hourly
const t = Array.from({ length: N }, (_, i) => i);
const gauss = lcg(11);
const white = t.map(() => gauss());
/** AR(1) noise, phi = 0.8: no rhythm, strongly autocorrelated. */
const red = (() => {
	const g = lcg(5);
	const out = [];
	let e = 0;
	for (let i = 0; i < N; i++) out.push((e = 0.8 * e + g()));
	return out;
})();

const args = (yIN, over) => ({
	xIN: 1,
	yIN: [yIN],
	Ncurves: 1,
	outputX: -1,
	out: { cosinorx: -1 },
	useFixedPeriod: true,
	fixedPeriod: 24,
	nHarmonics: 1,
	alpha: 0.05,
	referenceHrs: 0,
	...over
});

beforeEach(() => {
	mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t, name: 'time' };
	mockColumns[2] = { getData: () => white, name: 'white' };
	mockColumns[3] = { getData: () => red, name: 'red' };
});

describe('Cosinor: exchangeability (FIT-5)', () => {
	it('defaults the permutation scheme to shuffle', () => {
		expect(definition.defaults.get('permutationScheme')?.val).toBe('shuffle');
	});

	it('warns that the F-test p assumes independence when the residuals are autocorrelated', async () => {
		const [r] = await cosinor(args(3));
		const w = r.warnings.filter((s) => /autocorrelated/.test(s));
		expect(w).toHaveLength(1);
		expect(w[0]).toMatch(/^The F-test p-value for "red" assumes independent/);
	});

	it('does not warn on white noise', async () => {
		const [r] = await cosinor(args(2));
		expect(r.warnings.some((s) => /autocorrelated/.test(s))).toBe(false);
	});

	it('names both tests when the shuffle permutation test ran too', async () => {
		const [r] = await cosinor(args(3, { permuteTest: true, nPermutations: 19 }));
		const w = r.warnings.filter((s) => /autocorrelated/.test(s));
		expect(w).toHaveLength(1);
		expect(w[0]).toMatch(/^The F-test and permutation p-values for "red" assume/);
		expect(r.y_results[3].permScheme).toBe('shuffle');
	});

	it('the free-period fit (no F-test) warns only about a shuffle permutation test', async () => {
		const [off] = await cosinor(args(3, { useFixedPeriod: false }));
		expect(off.warnings.some((s) => /autocorrelated/.test(s))).toBe(false);
		const [on] = await cosinor(
			args(3, { useFixedPeriod: false, permuteTest: true, nPermutations: 9 })
		);
		const w = on.warnings.filter((s) => /autocorrelated/.test(s));
		expect(w).toHaveLength(1);
		expect(w[0]).toMatch(/^The permutation p-value for "red"/);
	});

	it('runs the block scheme with one-period blocks', async () => {
		const [r] = await cosinor(
			args(3, { permuteTest: true, nPermutations: 19, permutationScheme: 'block' })
		);
		const yr = r.y_results[3];
		expect(yr.permScheme).toBe('block');
		expect(yr.permBlockLength).toBe(24);
		expect(Number.isFinite(yr.pValue)).toBe(true);
		// The block permutation is valid here; only the F-test beside it is flagged.
		const w = r.warnings.filter((s) => /autocorrelated/.test(s));
		expect(w).toHaveLength(1);
		expect(w[0]).toMatch(/^The F-test p-value for "red"/);
	});

	it('says when the block test cannot run (under two periods of data)', async () => {
		const short = t.slice(0, 40);
		mockColumns[4] = { type: 'number', getData: () => short, hoursSinceStart: short };
		mockColumns[5] = { getData: () => red.slice(0, 40), name: 'short' };
		const [r] = await cosinor(
			args(5, { xIN: 4, permuteTest: true, nPermutations: 9, permutationScheme: 'block' })
		);
		expect(r.warnings.some((s) => /block permutation test for "short" did not run/.test(s))).toBe(
			true
		);
	});
});
