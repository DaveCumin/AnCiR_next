import { describe, it, expect } from 'vitest';
import {
	parseFormula,
	evaluateFormula,
	validateFormulaTokens,
	formulaCell,
	FormulaError,
	FORMULA_FUNCTIONS
} from './formulaExpression.js';

const text = (value) => ({ type: 'text', value });
const col = (id) => ({ type: 'col', id });
const stored = (key) => ({ type: 'stored', key });

/** Evaluate a text-only formula once (one row, no columns). */
const calc = (src) =>
	evaluateFormula(parseFormula([text(src)]), { column: () => [], stored: () => null }, 1)[0];

/** Evaluate with columns and stored values. */
const run = (tokens, cols = {}, sv = {}, n) => {
	const len = n ?? Math.max(1, ...Object.values(cols).map((c) => c.length));
	return evaluateFormula(
		parseFormula(tokens),
		{ column: (id) => cols[id], stored: (k) => sv[k] },
		len
	);
};

const refuses = (src) => expect(() => parseFormula([text(src)])).toThrow(FormulaError);

describe('formulaExpression: numbers and operators', () => {
	it('reads decimal and exponent literals', () => {
		expect(calc('12')).toBe(12);
		expect(calc('1.5')).toBe(1.5);
		expect(calc('.5')).toBe(0.5);
		expect(calc('3.')).toBe(3);
		expect(calc('1e-3')).toBe(0.001);
		expect(calc('2.5E4')).toBe(25000);
	});

	it('follows the usual precedence: * / % before + -', () => {
		expect(calc('1 + 2 * 3')).toBe(7);
		expect(calc('(1 + 2) * 3')).toBe(9);
		expect(calc('10 - 4 - 3')).toBe(3); // left-associative
		expect(calc('100 / 10 / 5')).toBe(2); // left-associative
		expect(calc('2 * 3 % 4')).toBe(2); // (2*3) % 4
	});

	it('^ is power, right-associative, and binds tighter than * and unary minus', () => {
		expect(calc('2^3')).toBe(8);
		expect(calc('2^3^2')).toBe(512); // 2^(3^2), not (2^3)^2 = 64
		expect(calc('2*3^2')).toBe(18);
		expect(calc('-2^2')).toBe(-4); // -(2^2)
		expect(calc('(-2)^2')).toBe(4);
		expect(calc('2^-1')).toBe(0.5); // a sign is allowed in the exponent
		expect(calc('2^-1^2')).toBe(0.5); // 2^(-(1^2))
	});

	it('% takes the sign of the dividend (fmod), not the divisor', () => {
		expect(calc('7 % 3')).toBe(1);
		expect(calc('-7 % 3')).toBe(-1);
		expect(calc('7 % -3')).toBe(1);
		expect(calc('5.5 % 2')).toBe(1.5);
	});

	it('unary plus and repeated signs', () => {
		expect(calc('+3')).toBe(3);
		expect(calc('--3')).toBe(3);
		expect(calc('3 - -2')).toBe(5);
	});
});

describe('formulaExpression: functions and constants', () => {
	it('allows exactly the documented function list', () => {
		expect([...FORMULA_FUNCTIONS].sort()).toEqual(
			[
				'abs',
				'ceil',
				'cos',
				'exp',
				'floor',
				'log',
				'log10',
				'max',
				'min',
				'pow',
				'round',
				'sin',
				'sqrt',
				'tan'
			].sort()
		);
	});

	it('computes each function', () => {
		expect(calc('abs(-3)')).toBe(3);
		expect(calc('sqrt(16)')).toBe(4);
		expect(calc('log(e)')).toBeCloseTo(1, 15); // natural log
		expect(calc('log10(1000)')).toBeCloseTo(3, 15);
		expect(calc('exp(0)')).toBe(1);
		expect(calc('sin(pi/2)')).toBeCloseTo(1, 15);
		expect(calc('cos(0)')).toBe(1);
		expect(calc('tan(0)')).toBe(0);
		expect(calc('floor(-1.5)')).toBe(-2);
		expect(calc('ceil(-1.5)')).toBe(-1);
		expect(calc('pow(2, 10)')).toBe(1024);
		expect(calc('min(3, 1, 2)')).toBe(1);
		expect(calc('max(3)')).toBe(3);
		expect(calc('max(3, 7, 2)')).toBe(7);
	});

	it('round sends halves up (toward +infinity), not to even', () => {
		expect(calc('round(2.5)')).toBe(3);
		expect(calc('round(3.5)')).toBe(4);
		expect(calc('round(-2.5)')).toBe(-2);
		expect(calc('round(-2.6)')).toBe(-3);
	});

	it('accepts Math.-prefixed spellings from the old evaluator', () => {
		expect(calc('Math.sqrt(9)')).toBe(3);
		expect(calc('Math.log(1)')).toBe(0);
		expect(calc('Math.PI')).toBe(Math.PI);
		expect(calc('Math.E')).toBe(Math.E);
		expect(calc('Math.max(1, 2)')).toBe(2);
	});

	it('constants pi and e', () => {
		expect(calc('pi')).toBe(Math.PI);
		expect(calc('2*e')).toBe(2 * Math.E);
	});

	it('refuses wrong argument counts', () => {
		refuses('sqrt()');
		refuses('sqrt(1, 2)');
		refuses('pow(2)');
		refuses('min()');
		expect(() => parseFormula([text('pow(2)')])).toThrow(/pow\(\) takes 2 arguments, not 1/);
	});
});

describe('formulaExpression: refusals (SEC-1)', () => {
	it('refuses the reviewer payload shape', () => {
		expect(() => parseFormula([col(1), text('" + ((window.__pwned=1), 0) + "')])).toThrow(
			/Unexpected character/
		);
	});

	it('refuses anything outside the grammar', () => {
		for (const src of [
			'"a"',
			"'a'",
			'`a`',
			'a.b',
			'Math.random()',
			'Math.constructor',
			'constructor',
			'__proto__',
			'toString(1)',
			'hasOwnProperty(1)',
			'window',
			'globalThis',
			'x = 1',
			'1; 2',
			'[1]',
			'{}',
			'1 ? 2 : 3',
			'1 & 2',
			'1 | 2',
			'!1',
			'1 == 1',
			'1 < 2',
			'a => 1',
			'2x',
			'2pi',
			'Math.',
			'Math.pi',
			'PI',
			'sqrt',
			'pi(2)',
			'',
			'   ',
			'1 +',
			'* 2',
			'(1',
			'1)',
			'1 2',
			'f(1)',
			'1,2',
			'$x',
			'#k'
		]) {
			expect(() => parseFormula([text(src)]), src).toThrow(FormulaError);
		}
	});

	it('names the property access when a payload reaches into an object', () => {
		expect(() => parseFormula([text('window.__pwned')])).toThrow(/"window\." is not allowed/);
		expect(() => parseFormula([text('Math.constructor')])).toThrow(/Unknown name/);
	});

	it('refuses deep nesting and over-long formulas instead of overflowing the stack', () => {
		refuses('('.repeat(500) + '1' + ')'.repeat(500));
		refuses('-'.repeat(500) + '1');
		refuses(Array(300).fill('2').join('^'));
		refuses(Array(1500).fill('1').join('+'));
		expect(calc('('.repeat(50) + '1' + ')'.repeat(50))).toBe(1);
	});

	it('refuses two adjacent operands from chips (a missing operator)', () => {
		expect(() => parseFormula([col(1), col(2)])).toThrow(/operator is missing/);
		expect(() => parseFormula([col(1), text(' '), stored('k')])).toThrow(FormulaError);
	});
});

describe('formulaExpression: rows, columns, stored values and missing cells (STAT-6)', () => {
	it('evaluates per row across columns and a stored value', () => {
		const out = run(
			[col(1), text(' * '), stored('k'), text(' + '), col(2)],
			{ 1: [1, 2, 3], 2: [10, 20, 30] },
			{ k: 2 }
		);
		expect(out).toEqual([12, 24, 36]);
	});

	it('a missing operand anywhere makes that row null', () => {
		const out = run([text('max('), col(1), text(', 0) + 1')], {
			1: [1, null, undefined, '', '  ', NaN, 'abc', '2.5', -3]
		});
		expect(out).toEqual([2, null, null, null, null, null, null, 3.5, 1]);
	});

	it('missing propagates through unary minus, ^ and function calls', () => {
		expect(run([text('-'), col(1)], { 1: [null] })).toEqual([null]);
		expect(run([col(1), text('^2')], { 1: [null] })).toEqual([null]);
		expect(run([text('2^'), col(1)], { 1: [null] })).toEqual([null]);
		expect(run([text('pow('), col(1), text(', 0)')], { 1: [null] })).toEqual([null]);
	});

	it('0 is data, not missing', () => {
		expect(run([col(1), text(' + 1')], { 1: [0, '0'] })).toEqual([1, 1]);
	});

	it('a missing stored value makes every row null', () => {
		expect(run([col(1), text(' * '), stored('k')], { 1: [1, 2] }, { k: null })).toEqual([
			null,
			null
		]);
	});

	it('a non-finite result is null, never Infinity or NaN', () => {
		expect(run([col(1), text(' / 0')], { 1: [1, -1, 0] })).toEqual([null, null, null]);
		expect(run([text('log('), col(1), text(')')], { 1: [0, -1, 1] })).toEqual([null, null, 0]);
		expect(run([text('sqrt('), col(1), text(')')], { 1: [-4, 4] })).toEqual([null, 2]);
		expect(run([text('10^'), col(1)], { 1: [400] })).toEqual([null]);
	});

	it('a non-finite intermediate is missing too, so a function cannot hide it', () => {
		expect(calc('min(1/0, 3)')).toBeNull();
		expect(calc('0 * (1/0)')).toBeNull();
		expect(calc('(-8)^(1/3)')).toBeNull();
		expect(calc('exp(1000) - exp(1000)')).toBeNull();
		expect(calc('1e999 * 0')).toBeNull();
		expect(run([col(1), text(' + 1')], { 1: [Infinity, -Infinity, 1] })).toEqual([null, null, 2]);
	});

	it('a column shorter than the row count reads as missing past its end', () => {
		expect(run([col(1), text(' + '), col(2)], { 1: [1, 2, 3], 2: [10] }, {}, 3)).toEqual([
			11,
			null,
			null
		]);
	});

	it('formulaCell coerces numeric strings and booleans, and refuses everything else', () => {
		expect(formulaCell('1.5')).toBe(1.5);
		expect(formulaCell(true)).toBe(1);
		expect(formulaCell({})).toBeNull();
		expect(formulaCell([])).toBeNull();
	});
});

describe('validateFormulaTokens', () => {
	it('returns null for a valid formula', () => {
		expect(validateFormulaTokens([col(1), text(' + '), col(2)])).toBeNull();
		expect(validateFormulaTokens([text('log('), col(1), text(') ^ 2 * '), stored('k')])).toBeNull();
	});

	it('returns a message for bad shapes and bad grammar', () => {
		expect(validateFormulaTokens('x')).toMatch(/array/);
		expect(validateFormulaTokens([null])).toMatch(/object/);
		expect(validateFormulaTokens([{ type: 'col', id: 'time' }])).toMatch(/integer/);
		expect(validateFormulaTokens([{ type: 'stored' }])).toMatch(/key/);
		expect(validateFormulaTokens([{ type: 'code', value: '1' }])).toMatch(/unknown token type/);
		expect(validateFormulaTokens([{ type: 'text', value: 7 }])).toMatch(/string/);
		expect(validateFormulaTokens([col(1), text('" + ((window.__pwned=1), 0) + "')])).toMatch(
			/Unexpected character/
		);
	});
});
