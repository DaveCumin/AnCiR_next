// The permutation p-value is the tail of a distribution the node computes in full. These cover
// the helpers that let the user see and export that distribution rather than just its summary.
import { describe, it, expect } from 'vitest';
import {
	attachPermutation,
	hasPermutationDetail,
	permutationTableData
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
			'p_value'
		]);
		expect(rows).toHaveLength(4);
		expect(rows[0]).toEqual(['a', 'rSquared', 1, 0.1, 0.94, 0.002]);
		expect(rows[2]).toEqual(['a', 'rSquared', 3, 0.3, 0.94, 0.002]);
		expect(rows[3]).toEqual(['b', 'rSquared', 1, 0.5, 0.94, 0.002]);
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
