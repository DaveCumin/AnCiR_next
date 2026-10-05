import { describe, it, expect } from 'vitest';
import {
	parseFormula,
	evaluateFormula,
	validateFormulaTokens,
	formulaCell,
	FormulaError,
	FORMULA_FUNCTIONS,
	FORMULA_CONSTANTS,
	FORMULA_ARITY,
	formulaUsesRandom
} from './formulaExpression.js';
import { createSeededRNG } from './permutationTest.js';

// Every function and constant of the JS Math object as of ES2024, the allow-list's target.
// (Math.f16round and Math.sumPrecise are newer and deliberately absent: see the header.)
const ALL_MATH_FUNCTIONS = [
	'abs',
	'acos',
	'acosh',
	'asin',
	'asinh',
	'atan',
	'atan2',
	'atanh',
	'cbrt',
	'ceil',
	'clz32',
	'cos',
	'cosh',
	'exp',
	'expm1',
	'floor',
	'fround',
	'hypot',
	'imul',
	'log',
	'log10',
	'log1p',
	'log2',
	'max',
	'min',
	'pow',
	'random',
	'round',
	'sign',
	'sin',
	'sinh',
	'sqrt',
	'tan',
	'tanh',
	'trunc'
];
const ALL_MATH_CONSTANTS = ['E', 'LN10', 'LN2', 'LOG10E', 'LOG2E', 'PI', 'SQRT1_2', 'SQRT2'];

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
	it('allows exactly the JS Math functions (no more, no fewer)', () => {
		expect([...FORMULA_FUNCTIONS].sort()).toEqual([...ALL_MATH_FUNCTIONS].sort());
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
			'Math.constructor',
			'Math.constructor()',
			'Math["sin"](1)',
			"Math['sin'](1)",
			'Math[0]',
			'this',
			'this.x',
			'Math.prototype',
			'Math.__proto__',
			'Math.Math',
			'Math.toString()',
			'Math.valueOf()',
			'math.sin(1)',
			'SIN(1)',
			'Sin(1)',
			'Math.SIN(1)',
			'Math.pI',
			'Math.ln2',
			'ln2',
			'sqrt2',
			'Math.random',
			'random',
			'random(1)',
			'Math.random(1)',
			'PI(1)',
			'Math.PI()',
			'E(2)',
			'f16round(1)',
			'Math.f16round(1)',
			'sumPrecise(1)',
			'Math.sumPrecise(1)',
			'Math.atan2(1)',
			'atan2(1, 2, 3)',
			'imul(1)',
			'hypot()',
			'eval(1)',
			'Function(1)',
			'require(1)',
			'process',
			'self',
			'Object',
			'Reflect',
			'Proxy',
			'Symbol',
			'Number(1)',
			'parseInt(1)',
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

	it('names what it refuses for the classic escape routes', () => {
		expect(() => parseFormula([text('Math.constructor')])).toThrow(
			/Unknown name "Math.constructor"/
		);
		expect(() => parseFormula([text('constructor')])).toThrow(/Unknown name "constructor"/);
		expect(() => parseFormula([text('__proto__')])).toThrow(/Unknown name "__proto__"/);
		expect(() => parseFormula([text('globalThis')])).toThrow(/Unknown name "globalThis"/);
		expect(() => parseFormula([text('this')])).toThrow(/Unknown name "this"/);
		expect(() => parseFormula([text('Math["sin"](1)')])).toThrow(/Unexpected character "\["/);
		// Inherited Object.prototype names are not in the allow-list even though a plain
		// object lookup would find them.
		for (const name of ['toString', 'valueOf', 'hasOwnProperty', 'constructor', '__proto__']) {
			expect(() => parseFormula([text(`${name}(1)`)]), name).toThrow(/Unknown function/);
			expect(() => parseFormula([text(`Math.${name}(1)`)]), name).toThrow(/Unknown function/);
			expect(() => parseFormula([text(name)]), name).toThrow(/Unknown name/);
			expect(() => parseFormula([text(`Math.${name}`)]), name).toThrow(/Unknown name/);
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

describe('formulaExpression: the full JS Math set', () => {
	it('exposes every Math constant, bare and with Math., and keeps pi and e', () => {
		expect([...FORMULA_CONSTANTS].sort()).toEqual([...ALL_MATH_CONSTANTS, 'e', 'pi'].sort());
		for (const c of ALL_MATH_CONSTANTS) {
			expect(calc(c), c).toBe(Math[c]);
			expect(calc(`Math.${c}`), `Math.${c}`).toBe(Math[c]);
		}
		expect(calc('pi')).toBe(Math.PI);
		expect(calc('e')).toBe(Math.E);
		expect(calc('2*SQRT2*SQRT1_2')).toBeCloseTo(2, 15);
	});

	it('has the arity of the Math spec for every function', () => {
		const want = {
			atan2: 2,
			imul: 2,
			pow: 2,
			random: 0,
			hypot: [1, Infinity],
			min: [1, Infinity],
			max: [1, Infinity]
		};
		for (const fn of ALL_MATH_FUNCTIONS) {
			expect(FORMULA_ARITY[fn], fn).toEqual(want[fn] ?? 1);
		}
	});

	it('refuses a wrong argument count for every function, bare and with Math.', () => {
		const arg = (k) => Array.from({ length: k }, (_, i) => `${i + 1}`).join(', ');
		for (const fn of ALL_MATH_FUNCTIONS) {
			const a = FORMULA_ARITY[fn];
			const [lo, hi] = Array.isArray(a) ? a : [a, a];
			for (const prefix of ['', 'Math.']) {
				if (lo > 0) refuses(`${prefix}${fn}(${arg(lo - 1)})`);
				if (hi !== Infinity) refuses(`${prefix}${fn}(${arg(hi + 1)})`);
				const args = arg(lo === 0 ? 0 : lo);
				expect(() => parseFormula([text(`${prefix}${fn}(${args})`)])).not.toThrow();
			}
		}
		expect(() => parseFormula([text('atan2(1)')])).toThrow(/atan2\(\) takes 2 arguments, not 1/);
		expect(() => parseFormula([text('random(1)')])).toThrow(/random\(\) takes 0 arguments, not 1/);
		expect(() => parseFormula([text('hypot()')])).toThrow(/hypot\(\) takes at least 1 argument/);
	});

	it('every one-argument function matches Math exactly where the result is finite', () => {
		const xs = [-1e10, -3.7, -1, -0.75, -0.5, 0, 0.25, 0.5, 0.9, 1, 1.5, 2, 2.5, 10, 700, 1e10];
		for (const fn of ALL_MATH_FUNCTIONS) {
			if (FORMULA_ARITY[fn] !== 1) continue;
			for (const x of xs) {
				const want = Math[fn](x);
				const got = run([text(`${fn}(`), col(1), text(')')], { 1: [x] })[0];
				const got2 = run([text(`Math.${fn}(`), col(1), text(')')], { 1: [x] })[0];
				if (Number.isFinite(want)) {
					expect(Object.is(got, want), `${fn}(${x}) = ${got}, Math gives ${want}`).toBe(true);
					expect(Object.is(got2, want), `Math.${fn}(${x})`).toBe(true);
				} else {
					expect(got, `${fn}(${x}) is not finite in JS, so missing`).toBeNull();
					expect(got2).toBeNull();
				}
			}
		}
	});

	it('inverse trig and hyperbolic domains: out of range is missing, never NaN', () => {
		expect(calc('acos(2)')).toBeNull();
		expect(calc('asin(-1.5)')).toBeNull();
		expect(calc('acosh(0.5)')).toBeNull();
		expect(calc('atanh(1)')).toBeNull(); // Infinity in JS
		expect(calc('atanh(-1)')).toBeNull();
		expect(calc('atanh(2)')).toBeNull(); // NaN in JS
		expect(calc('log1p(-1)')).toBeNull();
		expect(calc('log2(0)')).toBeNull();
		expect(calc('cosh(1000)')).toBeNull();
		expect(calc('sinh(-1000)')).toBeNull();
		expect(calc('expm1(1000)')).toBeNull();
		expect(calc('tanh(1000)')).toBe(1);
		expect(calc('acos(-1)')).toBe(Math.PI);
		expect(calc('log2(8)')).toBe(3);
		expect(calc('expm1(1e-10)')).toBe(Math.expm1(1e-10));
		expect(calc('log1p(1e-10)')).toBe(Math.log1p(1e-10));
	});

	it('atan2 takes (y, x) like JS, with the quadrant and signed-zero rules', () => {
		expect(calc('atan2(1, 1)')).toBe(Math.PI / 4);
		expect(calc('atan2(1, -1)')).toBe((3 * Math.PI) / 4);
		expect(calc('atan2(-1, -1)')).toBe((-3 * Math.PI) / 4);
		expect(calc('atan2(0, -1)')).toBe(Math.PI);
		expect(calc('atan2(0, -0)')).toBe(Math.PI); // -0 from unary minus
		expect(Object.is(calc('atan2(-0, 1)'), -0)).toBe(true);
		expect(calc('Math.atan2(2, 0)')).toBe(Math.PI / 2);
	});

	it('cbrt of a negative is the negative real root (not missing, unlike (-8)^(1/3))', () => {
		expect(calc('cbrt(-8)')).toBe(-2);
		expect(calc('cbrt(27)')).toBe(3);
		expect(calc('cbrt(-0.001)')).toBe(Math.cbrt(-0.001));
		expect(calc('(-8)^(1/3)')).toBeNull();
	});

	it('sign and trunc keep the JS signed zero', () => {
		expect(calc('sign(-3)')).toBe(-1);
		expect(calc('sign(0.001)')).toBe(1);
		expect(Object.is(calc('sign(0)'), 0)).toBe(true);
		expect(Object.is(calc('sign(-0)'), -0)).toBe(true);
		expect(Object.is(calc('trunc(-0.5)'), -0)).toBe(true);
		expect(calc('trunc(-2.7)')).toBe(-2);
		expect(calc('trunc(2.7)')).toBe(2);
		expect(Object.is(calc('round(-0.4)'), -0)).toBe(true);
	});

	it('clz32, imul and fround have the 32-bit behaviour of JS', () => {
		expect(calc('clz32(0)')).toBe(32);
		expect(calc('clz32(1)')).toBe(31);
		expect(calc('clz32(-1)')).toBe(0); // ToUint32(-1) = 0xFFFFFFFF
		expect(calc('clz32(0.5)')).toBe(32); // truncates first
		expect(calc('clz32(2^32)')).toBe(32); // wraps to 0
		expect(calc('clz32(2^32 + 2^31)')).toBe(0);
		expect(calc('clz32(1e20)')).toBe(Math.clz32(1e20));
		expect(calc('imul(2, 3)')).toBe(6);
		expect(calc('imul(-5, 12)')).toBe(-60);
		expect(calc('imul(2^31 - 1, 2)')).toBe(-2); // wraps
		expect(calc('imul(65537, 65537)')).toBe(Math.imul(65537, 65537));
		expect(calc('imul(4294967295, 5)')).toBe(-5);
		expect(calc('imul(3.9, 2.9)')).toBe(6); // ToInt32 truncates
		expect(calc('imul(1e20, 3)')).toBe(Math.imul(1e20, 3));
		expect(calc('fround(5.5)')).toBe(5.5);
		expect(calc('fround(5.05)')).toBe(Math.fround(5.05));
		expect(calc('fround(0.1)')).toBe(0.10000000149011612);
		expect(calc('fround(1e-46)')).toBe(0); // below the smallest float32 subnormal
		expect(calc('fround(1e-40)')).toBe(Math.fround(1e-40)); // a float32 subnormal
		// Just under halfway to 2^128 rounds down to the largest float32; exactly halfway is a
		// tie, which goes to even (2^128), so it overflows to Infinity and is missing.
		expect(calc('fround(3.4028235677973306e38)')).toBe(3.4028234663852886e38);
		expect(calc('fround(3.4028235677973366e38)')).toBeNull();
		expect(calc('fround(1e39)')).toBeNull(); // Infinity in JS
	});

	it('hypot is variadic, and any missing argument makes the row missing', () => {
		expect(calc('hypot(3, 4)')).toBe(5);
		expect(calc('hypot(-3)')).toBe(3);
		expect(calc('hypot(1, 2, 2)')).toBe(3);
		expect(calc('Math.hypot(3, 4, 12)')).toBe(13);
		expect(calc('hypot(1e200, 1e200)')).toBe(Math.hypot(1e200, 1e200)); // no overflow
		expect(calc('hypot(1e308, 1e308, 1e308, 1e308)')).toBeNull(); // Infinity
		expect(run([text('hypot('), col(1), text(', 4)')], { 1: [3, null, ''] })).toEqual([
			5,
			null,
			null
		]);
	});
});

describe('formulaExpression: random() is seeded and reproducible', () => {
	const rng = (seed) => createSeededRNG(seed);
	const runR = (src, n, seed) =>
		evaluateFormula(
			parseFormula([text(src)]),
			{ column: () => [], stored: () => null, random: rng(seed) },
			n
		);

	it('draws one value per row from the seeded generator, in [0, 1)', () => {
		const draws = (() => {
			const g = rng(12345);
			return Array.from({ length: 6 }, () => g());
		})();
		expect(runR('random()', 6, 12345)).toEqual(draws);
		expect(runR('Math.random()', 6, 12345)).toEqual(draws);
		for (const v of runR('random()', 200, 7)) expect(v >= 0 && v < 1).toBe(true);
	});

	it('the same seed reproduces, a different seed differs', () => {
		expect(runR('random()', 20, 99)).toEqual(runR('random()', 20, 99));
		expect(runR('random()', 20, 99)).not.toEqual(runR('random()', 20, 100));
	});

	it('several random() calls draw left to right within a row, row after row', () => {
		const g = rng(5);
		const d = Array.from({ length: 6 }, () => g());
		expect(runR('random() - 10 * random()', 3, 5)).toEqual([
			d[0] - 10 * d[1],
			d[2] - 10 * d[3],
			d[4] - 10 * d[5]
		]);
	});

	it('a missing row still consumes its draws, so later rows do not shift', () => {
		const g = rng(11);
		const d = Array.from({ length: 6 }, () => g());
		const out = evaluateFormula(
			parseFormula([col(1), text(' + random() + random()')]),
			{ column: () => [1, null, 3], stored: () => null, random: rng(11) },
			3
		);
		expect(out).toEqual([1 + d[0] + d[1], null, 3 + d[4] + d[5]]);
	});

	it('formulaUsesRandom reports whether a formula draws', () => {
		expect(formulaUsesRandom(parseFormula([text('1 + random()')]))).toBe(true);
		expect(formulaUsesRandom(parseFormula([text('max(1, 2 * Math.random())')]))).toBe(true);
		expect(formulaUsesRandom(parseFormula([text('-random()^2')]))).toBe(true);
		expect(formulaUsesRandom(parseFormula([text('1 + sin(2)')]))).toBe(false);
	});

	it('refuses to evaluate random() without a generator rather than using Math.random', () => {
		expect(() =>
			evaluateFormula(parseFormula([text('random()')]), { column: () => [], stored: () => null }, 1)
		).toThrow(FormulaError);
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
