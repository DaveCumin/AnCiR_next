import { describe, it, expect } from 'vitest';
import {
	isNumericLike,
	deriveLabelFromName,
	deriveLabelsFromNames,
	hasReplicatePattern,
	detectLabelRow,
	extractRowAsLabels,
	stripRowFromColumns
} from './importLabels.js';

describe('isNumericLike', () => {
	it('accepts numbers and numeric strings', () => {
		expect(isNumericLike(3)).toBe(true);
		expect(isNumericLike('3.5')).toBe(true);
		expect(isNumericLike(' -2 ')).toBe(true);
		expect(isNumericLike('1e3')).toBe(true);
	});
	it('rejects empty, null, and non-numeric text', () => {
		expect(isNumericLike('')).toBe(false);
		expect(isNumericLike('   ')).toBe(false);
		expect(isNumericLike(null)).toBe(false);
		expect(isNumericLike('WT')).toBe(false);
		expect(isNumericLike(NaN)).toBe(false);
	});
});

describe('deriveLabelFromName', () => {
	it('strips trailing replicate tokens with separators', () => {
		expect(deriveLabelFromName('WT_1')).toBe('WT');
		expect(deriveLabelFromName('LL 12')).toBe('LL');
		expect(deriveLabelFromName('S-03')).toBe('S');
		expect(deriveLabelFromName('cond.4')).toBe('cond');
	});
	it('strips trailing digits without a separator', () => {
		expect(deriveLabelFromName('Sample10')).toBe('Sample');
		expect(deriveLabelFromName('LL1')).toBe('LL');
	});
	it('leaves names without trailing digits unchanged', () => {
		expect(deriveLabelFromName('WT')).toBe('WT');
		expect(deriveLabelFromName('Time')).toBe('Time');
	});
	it('returns original when stripping would empty the name', () => {
		expect(deriveLabelFromName('42')).toBe('42');
		expect(deriveLabelFromName('  ')).toBe('');
	});
});

describe('deriveLabelsFromNames / hasReplicatePattern', () => {
	it('maps each name to its derived label', () => {
		expect(deriveLabelsFromNames(['WT_1', 'WT_2', 'LL_1'])).toEqual({
			WT_1: 'WT',
			WT_2: 'WT',
			LL_1: 'LL'
		});
	});
	it('detects a replicate pattern when >=2 names collapse to one label', () => {
		expect(hasReplicatePattern(['WT_1', 'WT_2', 'LL_1'])).toBe(true);
	});
	it('is false when no two names share a stripped label', () => {
		expect(hasReplicatePattern(['WT_1', 'LL_2', 'DD_3'])).toBe(false);
	});
	it('is false when nothing gets stripped', () => {
		expect(hasReplicatePattern(['alpha', 'beta', 'gamma'])).toBe(false);
	});
});

describe('detectLabelRow', () => {
	const headers = ['Time', 'A', 'B', 'C'];

	it('flags a text first row above numeric data', () => {
		const data = {
			Time: [0, 1, 2, 3],
			A: ['WT', 10, 11, 12],
			B: ['WT', 20, 21, 22],
			C: ['LL', 30, 31, 32]
		};
		const res = detectLabelRow(data, headers);
		expect(res).not.toBeNull();
		expect(res.rowIndex).toBe(0);
		// Time is numeric throughout, so it is also a data candidate; the 3 text
		// first-row cells (A/B/C) are the majority that trips detection.
		expect(res.dataCandidates).toEqual(['Time', 'A', 'B', 'C']);
	});

	it('returns null when the first row is numeric like the rest', () => {
		const data = {
			Time: [0, 1, 2, 3],
			A: [9, 10, 11, 12],
			B: [19, 20, 21, 22],
			C: [29, 30, 31, 32]
		};
		expect(detectLabelRow(data, headers)).toBeNull();
	});

	it('returns null with fewer than two numeric data columns', () => {
		const data = {
			Time: ['t0', 't1', 't2'],
			A: ['x', 'y', 'z']
		};
		expect(detectLabelRow(data, ['Time', 'A'])).toBeNull();
	});
});

describe('extractRowAsLabels', () => {
	it('pulls the given row into a name->string map, trimming and blanking nulls', () => {
		const data = { A: [' WT ', 1], B: [null, 2], C: ['LL', 3] };
		expect(extractRowAsLabels(data, ['A', 'B', 'C'], 0)).toEqual({
			A: 'WT',
			B: '',
			C: 'LL'
		});
	});
});

describe('stripRowFromColumns', () => {
	it('removes the row from every column without mutating the input', () => {
		const data = { A: [1, 2, 3], B: [4, 5, 6] };
		const out = stripRowFromColumns(data, 1);
		expect(out).toEqual({ A: [1, 3], B: [4, 6] });
		expect(data).toEqual({ A: [1, 2, 3], B: [4, 5, 6] }); // unchanged
	});
	it('is a no-op copy for out-of-range indices', () => {
		const data = { A: [1, 2] };
		expect(stripRowFromColumns(data, 9)).toEqual({ A: [1, 2] });
	});
});
