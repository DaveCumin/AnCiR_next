// @ts-nocheck
import { describe, it, expect } from 'vitest';
import {
	REFUSE,
	WARN,
	nonPositiveSummary,
	checkLogarithmicDomain,
	checkExponentialDomain,
	checkPolynomialDegree,
	checkXVariation,
	checkTrendFitDomain,
	shouldRefuse,
	issueMessages,
	checkFitOutputFinite,
	checkFitResultsFinite
} from './fitDomain.js';
import { fitTrendSync } from './trendfit.js';

describe('nonPositiveSummary', () => {
	it('counts only finite entries and reports the first offender', () => {
		// null must NOT count as a zero: Number(null) === 0 would report an empty
		// cell as a domain violation.
		const s = nonPositiveSummary([3, 0, -2, null, NaN, 5]);
		expect(s.finite).toBe(4);
		expect(s.bad).toBe(2);
		expect(s.firstIndex).toBe(1);
		expect(s.firstValue).toBe(0);
	});

	it('ignores empty cells rather than reading them as zero', () => {
		expect(nonPositiveSummary([1, null, undefined, '', 2]).bad).toBe(0);
		expect(nonPositiveSummary([1, null, undefined, '', 2]).finite).toBe(2);
	});

	it('accepts numeric strings, because column data reaches here verbatim', () => {
		const s = nonPositiveSummary(['1', '0', '2']);
		expect(s.finite).toBe(3);
		expect(s.bad).toBe(1);
	});

	it('is clean for all-positive input and for empty input', () => {
		expect(nonPositiveSummary([1, 2, 3]).bad).toBe(0);
		expect(nonPositiveSummary([]).bad).toBe(0);
		expect(nonPositiveSummary(undefined).bad).toBe(0);
	});

	it('treats exact zero as a violation (Math.log(0) is -Infinity)', () => {
		expect(nonPositiveSummary([0, 1]).bad).toBe(1);
	});
});

describe('checkLogarithmicDomain', () => {
	it('passes when every x is positive', () => {
		expect(checkLogarithmicDomain([1, 2, 3])).toBeNull();
	});

	it('refuses on a single zero — one bad x poisons the whole fit', () => {
		const issue = checkLogarithmicDomain([0, 1, 2, 3]);
		expect(issue.tier).toBe(REFUSE);
		expect(issue.code).toBe('log-x-domain');
		expect(issue.count).toBe(1);
	});

	it('states the requirement, the actual data, and a remedy', () => {
		const issue = checkLogarithmicDomain([0, 0, 3, 4, 5], 'day');
		// requirement
		expect(issue.message).toContain('ln(x)');
		expect(issue.message).toContain('greater than 0');
		// what the data contains: the count, the total and where
		expect(issue.message).toContain('2 of 5');
		expect(issue.message).toContain('row 1');
		expect(issue.message).toContain('day');
		// remedy, named explicitly (the ChiSquared → Fisher pattern)
		expect(issue.message).toMatch(/Shift|filter|choose/);
		expect(issue.message).toContain('polynomial');
	});

	it('reports rows 1-based, matching what the user sees in the table', () => {
		expect(checkLogarithmicDomain([5, 6, -1]).message).toContain('row 3');
	});

	it('agrees with itself grammatically for a single offender', () => {
		expect(checkLogarithmicDomain([0, 1, 2]).message).toContain(
			'1 of 3 values in x is 0 or negative'
		);
		expect(checkLogarithmicDomain([0, 0, 2]).message).toContain(
			'2 of 3 values in x are 0 or negative'
		);
	});

	it('names negatives as well as zeros', () => {
		expect(checkLogarithmicDomain([-4, 1]).message).toContain('value -4');
	});
});

describe('checkExponentialDomain', () => {
	it('passes when every y is positive', () => {
		expect(checkExponentialDomain([0.5, 2, 30])).toBeNull();
	});

	it('refuses on non-positive y and names y, not x', () => {
		const issue = checkExponentialDomain([1, -3], 'counts');
		expect(issue.tier).toBe(REFUSE);
		expect(issue.code).toBe('log-y-domain');
		expect(issue.message).toContain('counts');
		expect(issue.message).toContain('log-transforming y');
		expect(issue.message).not.toContain('ln(x)');
	});

	it('warns that an offset changes the fitted a', () => {
		expect(checkExponentialDomain([0, 1]).message).toContain('changes the fitted a');
	});
});

describe('checkPolynomialDegree', () => {
	it('passes when there are more points than coefficients', () => {
		expect(checkPolynomialDegree(10, 2)).toBeNull();
	});

	it('passes at exact interpolation (n = degree + 1) — the sample-size warning owns that', () => {
		expect(checkPolynomialDegree(4, 3)).toBeNull();
	});

	it('refuses when n <= degree (rank-deficient: an arbitrary interpolant)', () => {
		const issue = checkPolynomialDegree(3, 3);
		expect(issue.tier).toBe(REFUSE);
		expect(issue.code).toBe('poly-degree');
		expect(issue.message).toContain('4 coefficients');
		expect(issue.message).toContain('Only 3 usable points');
		expect(issue.message).toContain('R² would be 1');
		expect(issue.message).toContain('Lower the degree');
	});

	it('never suggests a nonsensical degree below 1', () => {
		expect(checkPolynomialDegree(1, 5).message).toContain('at most 1');
	});

	it('ignores non-numeric input rather than inventing an issue', () => {
		expect(checkPolynomialDegree(NaN, 2)).toBeNull();
		expect(checkPolynomialDegree(5, undefined)).toBeNull();
	});
});

describe('checkXVariation', () => {
	it('passes when x varies', () => {
		expect(checkXVariation([1, 2, 3])).toBeNull();
	});

	it('refuses when every x is identical', () => {
		const issue = checkXVariation([7, 7, 7], 'hour');
		expect(issue.tier).toBe(REFUSE);
		expect(issue.code).toBe('x-constant');
		expect(issue.message).toContain('hour');
		expect(issue.message).toContain('(7)');
	});

	it('says nothing below two usable points — that is a sample-size matter', () => {
		expect(checkXVariation([7])).toBeNull();
		expect(checkXVariation([])).toBeNull();
	});
});

describe('checkTrendFitDomain — model routing', () => {
	const y = [1, 2, 3, 4];

	it('applies the x check only to the logarithmic model', () => {
		const x = [0, 1, 2, 3];
		expect(checkTrendFitDomain(x, y, 'logarithmic').map((i) => i.code)).toEqual(['log-x-domain']);
		expect(checkTrendFitDomain(x, y, 'linear')).toEqual([]);
		expect(checkTrendFitDomain(x, y, 'polynomial', 2)).toEqual([]);
	});

	it('applies the y check only to the exponential model', () => {
		const x = [1, 2, 3, 4];
		expect(checkTrendFitDomain(x, [1, 0, 3, 4], 'exponential').map((i) => i.code)).toEqual([
			'log-y-domain'
		]);
		expect(checkTrendFitDomain(x, [1, 0, 3, 4], 'linear')).toEqual([]);
		// the exponential model is indifferent to a zero in x
		expect(checkTrendFitDomain([0, 1, 2, 3], y, 'exponential')).toEqual([]);
	});

	it('applies the degree check only to the polynomial model', () => {
		expect(checkTrendFitDomain([1, 2], [1, 2], 'polynomial', 4).map((i) => i.code)).toEqual([
			'poly-degree'
		]);
		expect(checkTrendFitDomain([1, 2], [1, 2], 'linear')).toEqual([]);
	});

	it('applies the constant-x check to every model', () => {
		for (const model of ['linear', 'exponential', 'logarithmic', 'polynomial']) {
			const codes = checkTrendFitDomain([2, 2, 2], [1, 2, 3], model, 1).map((i) => i.code);
			expect(codes, model).toContain('x-constant');
		}
	});

	it('passes column names through to the messages', () => {
		const [issue] = checkTrendFitDomain([0, 1], [1, 2], 'logarithmic', 2, {
			xLabel: 'elapsed',
			yLabel: 'activity'
		});
		expect(issue.message).toContain('elapsed');
	});

	it('is silent on clean data for every model', () => {
		const x = [1, 2, 3, 4, 5, 6];
		const yy = [1, 2, 3, 4, 5, 6];
		for (const model of ['linear', 'exponential', 'logarithmic', 'polynomial']) {
			expect(checkTrendFitDomain(x, yy, model, 2), model).toEqual([]);
		}
	});
});

describe('shouldRefuse / issueMessages', () => {
	it('refuses on any REFUSE issue and not on WARN-only', () => {
		expect(shouldRefuse([{ tier: WARN }])).toBe(false);
		expect(shouldRefuse([{ tier: WARN }, { tier: REFUSE }])).toBe(true);
		expect(shouldRefuse([])).toBe(false);
		expect(shouldRefuse(undefined)).toBe(false);
	});

	it('extracts the message strings', () => {
		expect(issueMessages([{ message: 'a' }, { message: 'b' }])).toEqual(['a', 'b']);
		expect(issueMessages(undefined)).toEqual([]);
	});
});

describe('checkFitOutputFinite', () => {
	it('is silent for a finite fit', () => {
		expect(checkFitOutputFinite({ rSquared: 0.9, rmse: 1.2 })).toBeNull();
	});

	it('warns (not refuses) on NaN outputs and names the likely causes', () => {
		const issue = checkFitOutputFinite({ rSquared: NaN, rmse: NaN }, 'The cosinor fit');
		expect(issue.tier).toBe(WARN);
		expect(issue.code).toBe('fit-nonfinite');
		expect(issue.message).toContain('The cosinor fit');
		expect(issue.message).toContain('did not converge');
		expect(issue.message).toMatch(/fix a parameter|different model/);
	});

	it('catches a null result — the optimiser returning nothing at all', () => {
		const issue = checkFitOutputFinite(null, 'The rectangular-wave fit');
		expect(issue.code).toBe('fit-failed');
		expect(issue.message).toContain('not because the values are zero');
	});

	it('catches a half-NaN result (RMSE finite, R² not)', () => {
		expect(checkFitOutputFinite({ rSquared: NaN, rmse: 2 }).code).toBe('fit-nonfinite');
	});
});

// The bug that prompted this module, pinned against the REAL fit code so the
// checks cannot drift away from what actually goes NaN.
describe('the checks match what fitTrendSync actually does', () => {
	const y = Array.from({ length: 20 }, (_, i) => 3 + 2 * Math.log(i + 1));

	it('x starting at 0 makes every logarithmic output NaN, and the check catches it', () => {
		const x = Array.from({ length: 20 }, (_, i) => i); // 0..19, a Sequence Column
		const fit = fitTrendSync(x, y, 'logarithmic');
		expect(Number.isNaN(fit.rSquared)).toBe(true);
		expect(Number.isNaN(fit.rmse)).toBe(true);
		expect(Number.isNaN(fit.parameters.a)).toBe(true);
		expect(Number.isNaN(fit.parameters.b)).toBe(true);
		expect(checkTrendFitDomain(x, y, 'logarithmic')).toHaveLength(1);
	});

	it('x starting at 1 fits fine, and the check stays quiet', () => {
		const x = Array.from({ length: 20 }, (_, i) => i + 1); // 1..20
		const fit = fitTrendSync(x, y, 'logarithmic');
		expect(fit.rSquared).toBeGreaterThan(0.99);
		expect(checkTrendFitDomain(x, y, 'logarithmic')).toEqual([]);
	});

	it('a non-positive y makes the exponential fit NaN, and the check catches it', () => {
		const x = [1, 2, 3, 4, 5];
		const yy = [1, 2, 0, 4, 5];
		expect(Number.isNaN(fitTrendSync(x, yy, 'exponential').rSquared)).toBe(true);
		expect(checkTrendFitDomain(x, yy, 'exponential')).toHaveLength(1);
	});

	it('degree >= n gives a fake perfect fit (not NaN), and the check catches it', () => {
		// Measured, not assumed: the rank-deficient solve returns R² = 1 and an
		// arbitrary interpolating polynomial, which is why this tier is REFUSE.
		const x = [1, 2, 3];
		const yy = [5, 1, 9];
		const fit = fitTrendSync(x, yy, 'polynomial', 3);
		expect(fit.rSquared).toBeCloseTo(1, 12);
		expect(fit.rmse).toBeCloseTo(0, 10);
		expect(fit.parameters.coeffs).toHaveLength(4);
		expect(checkTrendFitDomain(x, yy, 'polynomial', 3)).toHaveLength(1);
	});

	it('constant x makes the linear fit non-finite, and the check catches it', () => {
		const x = [4, 4, 4, 4];
		const yy = [1, 2, 3, 4];
		expect(Number.isFinite(fitTrendSync(x, yy, 'linear').parameters.slope)).toBe(false);
		expect(checkTrendFitDomain(x, yy, 'linear')).toHaveLength(1);
	});
});

describe('checkFitResultsFinite', () => {
	it('reports only the columns that failed, and names them', () => {
		const msgs = checkFitResultsFinite(
			[
				{ label: '"activity"', result: { rSquared: 0.8, rmse: 1 } },
				{ label: '"temp"', result: { rSquared: NaN, rmse: NaN } },
				{ label: '"light"', result: null }
			],
			'The cosinor fit'
		);
		expect(msgs).toHaveLength(2);
		expect(msgs[0]).toContain('The cosinor fit for "temp"');
		expect(msgs[1]).toContain('The cosinor fit for "light"');
	});

	it('is silent when every fit is finite', () => {
		expect(
			checkFitResultsFinite([{ label: 'a', result: { rSquared: 1, rmse: 0 } }], 'The fit')
		).toEqual([]);
	});

	it('tolerates an empty or missing list', () => {
		expect(checkFitResultsFinite([])).toEqual([]);
		expect(checkFitResultsFinite(undefined)).toEqual([]);
		expect(checkFitResultsFinite([null, undefined])).toEqual([]);
	});
});
