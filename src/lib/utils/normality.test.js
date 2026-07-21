import { describe, it, expect } from 'vitest';
import { dAgostino, jarqueBera, normalityTest } from './normality.js';

// Reference values from scipy 1.x: stats.normaltest / stats.jarque_bera on the exact arrays below.
const NORMALISH = [2.1, -0.3, 1.4, 0.2, -1.1, 0.8, 0.05, 1.9, -0.7, 0.4, 1.2, -0.9, 0.6, -0.2, 0.9, 1.5, -1.3, 0.3, 0.7, -0.5, 0.1, -0.4, 1.1, -0.8, 0.5];
const SKEWED = [1, 1, 1, 1, 2, 2, 3, 10, 4, 5, 6, 7, 3, 2, 8, 1, 1, 9, 2, 1, 1, 2, 3, 1, 15];

describe('dAgostino (scipy normaltest parity)', () => {
	it('matches scipy on a near-normal sample', () => {
		const r = dAgostino(NORMALISH);
		expect(r.statistic).toBeCloseTo(0.914719, 5);
		expect(r.pvalue).toBeCloseTo(0.632953, 5);
		expect(r.n).toBe(25);
	});
	it('matches scipy on a right-skewed sample and flags non-normality', () => {
		const r = dAgostino(SKEWED);
		expect(r.statistic).toBeCloseTo(15.278061, 4);
		expect(r.pvalue).toBeCloseTo(0.000481, 5);
		expect(r.pvalue).toBeLessThan(0.05);
	});
	it('returns NaN below n=8', () => {
		const r = dAgostino([1, 2, 3, 4, 5]);
		expect(Number.isNaN(r.statistic)).toBe(true);
		expect(Number.isNaN(r.pvalue)).toBe(true);
	});
	it('returns NaN for a zero-variance column', () => {
		const r = dAgostino([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
		expect(Number.isNaN(r.statistic)).toBe(true);
	});
});

describe('jarqueBera (scipy jarque_bera parity)', () => {
	it('matches scipy on a near-normal sample', () => {
		const r = jarqueBera(NORMALISH);
		expect(r.statistic).toBeCloseTo(0.788088, 5);
		expect(r.pvalue).toBeCloseTo(0.674324, 5);
	});
	it('matches scipy on a right-skewed sample', () => {
		const r = jarqueBera(SKEWED);
		expect(r.statistic).toBeCloseTo(15.164743, 4);
		expect(r.pvalue).toBeCloseTo(0.000509, 5);
	});
	it('returns NaN below n=3', () => {
		expect(Number.isNaN(jarqueBera([1, 2]).statistic)).toBe(true);
	});
});

describe('normalityTest dispatch', () => {
	it('defaults to dagostino', () => {
		expect(normalityTest(NORMALISH).statistic).toBeCloseTo(dAgostino(NORMALISH).statistic, 10);
	});
	it('selects jarquebera', () => {
		expect(normalityTest(NORMALISH, 'jarquebera').statistic).toBeCloseTo(jarqueBera(NORMALISH).statistic, 10);
	});
	it('ignores invalid values (NaN/null) when cleaning', () => {
		const withGaps = [...NORMALISH.slice(0, 12), NaN, null, ...NORMALISH.slice(12)];
		expect(normalityTest(withGaps).statistic).toBeCloseTo(dAgostino(NORMALISH).statistic, 10);
	});
});
