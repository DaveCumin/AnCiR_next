// The permutation p-value is the tail of a distribution the node computes in full. These cover
// the helpers that let the user see and export that distribution rather than just its summary.
import { describe, it, expect } from 'vitest';
import {
	attachPermutation,
	hasPermutationDetail,
	permutationTableData,
	permutationValidityWarnings,
	permutationSchemeLabel
} from '$lib/tableProcesses/permutationSupport.js';

const perm = {
	pValue: 0.002,
	significant: true,
	observedStat: 0.94,
	permutedStats: [0.1, 0.2, 0.3],
	statistic: 'rSquared'
};

describe('attachPermutation', () => {
	it('copies the whole outcome onto the y result', () => {
		const yr = attachPermutation({ fitResult: {} }, perm);
		expect(yr.pValue).toBe(0.002);
		expect(yr.significant).toBe(true);
		expect(yr.observedStat).toBe(0.94);
		expect(yr.permStats).toEqual([0.1, 0.2, 0.3]);
		expect(yr.permStatistic).toBe('rSquared');
	});

	it('carries the scheme, block length and residual autocorrelation (review FIT-5)', () => {
		const yr = attachPermutation(
			{},
			{ ...perm, scheme: 'block', blockLength: 24, residualLag1: 0.61, unavailable: null }
		);
		expect(yr.permScheme).toBe('block');
		expect(yr.permBlockLength).toBe(24);
		expect(yr.permResidualLag1).toBe(0.61);
		expect(yr.permUnavailable).toBeNull();
		// An older perm object with no scheme reads as the shuffle it was.
		expect(attachPermutation({}, perm).permScheme).toBe('shuffle');
	});

	it('leaves a test-disabled result inert rather than undefined', () => {
		const yr = attachPermutation({}, null);
		expect(Number.isNaN(yr.pValue)).toBe(true);
		expect(yr.significant).toBe(false);
		expect(yr.permStats).toEqual([]);
	});
});

describe('permutationTableData', () => {
	it('emits one tidy row per permutation per series', () => {
		const entries = [
			{ name: 'a', result: attachPermutation({}, perm) },
			{ name: 'b', result: attachPermutation({}, { ...perm, permutedStats: [0.5] }) }
		];
		const { headers, rows } = permutationTableData(entries);
		expect(headers).toEqual([
			'series',
			'statistic',
			'permutation',
			'permuted_statistic',
			'observed_statistic',
			'p_value',
			'scheme'
		]);
		expect(rows).toHaveLength(4);
		expect(rows[0]).toEqual(['a', 'rSquared', 1, 0.1, 0.94, 0.002, 'shuffle']);
		expect(rows[2]).toEqual(['a', 'rSquared', 3, 0.3, 0.94, 0.002, 'shuffle']);
		expect(rows[3]).toEqual(['b', 'rSquared', 1, 0.5, 0.94, 0.002, 'shuffle']);
	});

	it('skips series with no retained distribution', () => {
		const entries = [
			{ name: 'off', result: attachPermutation({}, null) },
			{ name: 'on', result: attachPermutation({}, perm) }
		];
		expect(permutationTableData(entries).rows.every((r) => r[0] === 'on')).toBe(true);
	});

	it('reports whether any series has a distribution to show', () => {
		expect(hasPermutationDetail([{ name: 'x', result: attachPermutation({}, null) }])).toBe(false);
		expect(hasPermutationDetail([{ name: 'x', result: attachPermutation({}, perm) }])).toBe(true);
		expect(hasPermutationDetail([])).toBe(false);
	});
});

// Review finding FIT-5: the shuffle test (and the cosinor F-test) assume exchangeable
// observations; on autocorrelated residuals both reject a true null far above 5%.
describe('permutationValidityWarnings', () => {
	// AR(1)-like residuals with lag-1 r near 0.9, and alternating ones near -1.
	const smooth = Array.from({ length: 100 }, (_, i) => Math.sin(i / 8));
	const alternating = Array.from({ length: 100 }, (_, i) => (i % 2 ? 1 : -1));

	it('warns for a shuffle test on strongly autocorrelated residuals', () => {
		const w = permutationValidityWarnings({ ...perm, scheme: 'shuffle' }, smooth, '"y"');
		expect(w).toHaveLength(1);
		expect(w[0]).toMatch(/permutation p-value for "y"/);
		expect(w[0]).toMatch(/autocorrelated/);
	});

	it('does not warn for negatively autocorrelated or for block-permuted residuals', () => {
		expect(permutationValidityWarnings({ ...perm, scheme: 'shuffle' }, alternating, 'y')).toEqual(
			[]
		);
		expect(permutationValidityWarnings({ ...perm, scheme: 'block' }, smooth, 'y')).toEqual([]);
	});

	it('says when the block test could not run', () => {
		const w = permutationValidityWarnings(
			{ ...perm, scheme: 'block', unavailable: 'the record holds fewer than two 24 h blocks' },
			smooth,
			'"y"'
		);
		expect(w).toHaveLength(1);
		expect(w[0]).toMatch(/block permutation test for "y" did not run: the record holds fewer/);
	});

	it('covers an analytic F-test too (no permutation run)', () => {
		const w = permutationValidityWarnings(null, smooth, '"y"', { fTest: true });
		expect(w).toHaveLength(1);
		expect(w[0]).toMatch(/^The F-test p-value for "y"/);
		const both = permutationValidityWarnings({ ...perm, scheme: 'shuffle' }, smooth, '"y"', {
			fTest: true
		});
		expect(both).toHaveLength(1);
		expect(both[0]).toMatch(/^The F-test and permutation p-values for "y" assume independent/);
		// Block permutation is valid, but the F-test beside it still is not.
		const fOnly = permutationValidityWarnings({ ...perm, scheme: 'block' }, smooth, '"y"', {
			fTest: true
		});
		expect(fOnly[0]).toMatch(/^The F-test p-value for "y"/);
	});

	it('is silent with no test at all', () => {
		expect(permutationValidityWarnings(null, smooth, 'y')).toEqual([]);
	});
});

describe('permutationSchemeLabel', () => {
	it('names the scheme for the readout', () => {
		expect(permutationSchemeLabel({ permScheme: 'shuffle' })).toBe('single values shuffled');
		expect(permutationSchemeLabel({ permScheme: 'block', permBlockLength: 24 })).toBe(
			'one-period blocks of 24 samples'
		);
		expect(permutationSchemeLabel({})).toBe('single values shuffled');
	});
});
