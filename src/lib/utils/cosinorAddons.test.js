import { describe, it, expect } from 'vitest';
import {
	wrapToPeriod,
	bathyphase,
	phaseAngleOfEntrainment,
	circadianFunctionIndex
} from './cosinorAddons.js';

describe('wrapToPeriod', () => {
	it('leaves values already in range unchanged', () => {
		expect(wrapToPeriod(8, 24)).toBe(8);
		expect(wrapToPeriod(0, 24)).toBe(0);
	});
	it('wraps values above the period', () => {
		expect(wrapToPeriod(30, 24)).toBe(6);
		expect(wrapToPeriod(48, 24)).toBe(0);
	});
	it('wraps negative values into [0, period)', () => {
		expect(wrapToPeriod(-2, 24)).toBe(22);
		expect(wrapToPeriod(-24, 24)).toBe(0);
	});
	it('returns NaN for invalid inputs', () => {
		expect(wrapToPeriod(NaN, 24)).toBeNaN();
		expect(wrapToPeriod(8, 0)).toBeNaN();
		expect(wrapToPeriod(8, -24)).toBeNaN();
	});
});

describe('bathyphase', () => {
	it('is exactly half a period after the acrophase', () => {
		expect(bathyphase(8, 24)).toBeCloseTo(20, 12);
		expect(bathyphase(0, 24)).toBeCloseTo(12, 12);
	});
	it('wraps past the period boundary', () => {
		expect(bathyphase(20, 24)).toBeCloseTo(8, 12); // 20 + 12 = 32 → 8
		expect(bathyphase(18, 24)).toBeCloseTo(6, 12);
	});
	it('works for non-24 h periods', () => {
		expect(bathyphase(1, 25)).toBeCloseTo(13.5, 12);
		expect(bathyphase(15, 20)).toBeCloseTo(5, 12); // 15 + 10 = 25 → 5
	});
	it('applying it twice returns to the acrophase', () => {
		const a = 8;
		expect(bathyphase(bathyphase(a, 24), 24)).toBeCloseTo(a, 12);
	});
	it('returns NaN for invalid inputs', () => {
		expect(bathyphase(NaN, 24)).toBeNaN();
		expect(bathyphase(8, 0)).toBeNaN();
	});
});

describe('phaseAngleOfEntrainment', () => {
	it('is zero when the acrophase matches the reference', () => {
		expect(phaseAngleOfEntrainment(8, 8, 24)).toBeCloseTo(0, 12);
	});
	it('gives the signed difference for near references', () => {
		expect(phaseAngleOfEntrainment(8, 6, 24)).toBeCloseTo(2, 12);
		expect(phaseAngleOfEntrainment(6, 8, 24)).toBeCloseTo(-2, 12);
	});
	it('folds onto the shortest signed arc (−P/2, P/2]', () => {
		// acrophase 2, reference 22: raw diff -20, shortest arc is +4.
		expect(phaseAngleOfEntrainment(2, 22, 24)).toBeCloseTo(4, 12);
		// acrophase 23, reference 1: raw diff 22, shortest arc is -2.
		expect(phaseAngleOfEntrainment(23, 1, 24)).toBeCloseTo(-2, 12);
	});
	it('returns exactly +P/2 at the antiphase boundary (not −P/2)', () => {
		expect(phaseAngleOfEntrainment(12, 0, 24)).toBeCloseTo(12, 12);
	});
	it('defaults the reference to 0', () => {
		expect(phaseAngleOfEntrainment(3)).toBeCloseTo(3, 12);
	});
	it('returns NaN for invalid inputs', () => {
		expect(phaseAngleOfEntrainment(NaN, 0, 24)).toBeNaN();
		expect(phaseAngleOfEntrainment(8, 0, 0)).toBeNaN();
	});
});

describe('circadianFunctionIndex', () => {
	it('returns 1 for a perfect rhythm (IS=1, IV=0, RA=1)', () => {
		const { CFI, components } = circadianFunctionIndex({ IS: 1, IV: 0, RA: 1 });
		expect(CFI).toBeCloseTo(1, 12);
		expect(components).toEqual({ IS: 1, IVcomplement: 1, RA: 1 });
	});
	it('returns 0 for the worst case (IS=0, IV=2, RA=0)', () => {
		expect(circadianFunctionIndex({ IS: 0, IV: 2, RA: 0 }).CFI).toBeCloseTo(0, 12);
	});
	it('averages the three normalised components', () => {
		// IS=0.5, IVcomplement=(2-1)/2=0.5, RA=0.5 → 0.5
		expect(circadianFunctionIndex({ IS: 0.5, IV: 1, RA: 0.5 }).CFI).toBeCloseTo(0.5, 12);
		// IS=0.9, IVcomplement=(2-0.4)/2=0.8, RA=0.7 → mean = 0.8
		expect(circadianFunctionIndex({ IS: 0.9, IV: 0.4, RA: 0.7 }).CFI).toBeCloseTo(0.8, 12);
	});
	it('clamps out-of-range IV and RA into [0,1]', () => {
		// IV=3 → (2-3)/2 = -0.5 → clamped to 0
		const r = circadianFunctionIndex({ IS: 1, IV: 3, RA: 1 });
		expect(r.components.IVcomplement).toBe(0);
		expect(r.CFI).toBeCloseTo(2 / 3, 12);
	});
	it('propagates NaN when any component is missing', () => {
		expect(circadianFunctionIndex({ IS: NaN, IV: 0, RA: 1 }).CFI).toBeNaN();
		expect(circadianFunctionIndex({ IS: 1, IV: NaN, RA: 1 }).CFI).toBeNaN();
		expect(circadianFunctionIndex({}).CFI).toBeNaN();
		expect(circadianFunctionIndex().CFI).toBeNaN();
	});
});
