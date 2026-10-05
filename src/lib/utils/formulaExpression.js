// FormulaColumn expression language: a fixed grammar, parsed and evaluated here.
//
// Why this exists (review SEC-1, STAT-8). The node used to glue its tokens into a string and
// compile it with `new Function`, so a session file (or a `?loadFromURL=` link, or a session
// minted by the AI Worker) could carry any JavaScript and run it on load. It also meant `x^2`
// was bitwise XOR and the documented `log(x)` threw. Nothing here compiles or evaluates source:
// the text is tokenised, parsed into a small tree, and the tree is walked. Anything outside the
// grammar is refused with a message, never silently turned into a number.
//
// Pure and dependency-free on purpose: the app node imports it, and so does the Worker's session
// normalizer (mcp/src/emit/normalizer.js), so a malicious formula is refused in both places by
// the same code. The Python runtime (tools/ancir_runtime.py) must implement this same grammar and
// these semantics exactly; so must R if it ever gains the node.
//
// GRAMMAR (whitespace is ignored between tokens)
//   expr    := term   (('+' | '-') term)*            left-associative
//   term    := unary  (('*' | '/' | '%') unary)*     left-associative
//   unary   := ('-' | '+') unary | power
//   power   := primary ('^' unary)?                  right-associative; binds tighter than unary
//                                                    minus on its left: -2^2 = -4, 2^-1 = 0.5,
//                                                    2^3^2 = 2^9 = 512
//   primary := NUMBER | COLUMN | STORED | CONSTANT | FUNC '(' args ')' | '(' expr ')'
//   args    := expr (',' expr)*
// NUMBER    decimal literal: 12, 1.5, .5, 3., 1e-3, 2.5E4 (no sign; a leading '-' is unary minus)
// COLUMN    a {type:'col', id} token: the value of that column in the current row
// STORED    a {type:'stored', key} token: that stored value (a scalar, the same in every row)
// CONSTANT  every JS Math constant, bare or with the Math. prefix, in its JS spelling: E, LN10,
//           LN2, LOG10E, LOG2E, PI, SQRT1_2, SQRT2 (so PI, Math.PI, LN2 and Math.LN2 all work).
//           The lower-case pi and e are also accepted bare (not after Math.: Math.pi is refused,
//           as in JS). Bare upper-case names are safe to allow because the list is fixed; no
//           other spelling (ln2, Sqrt2, Math.ln2) is accepted.
// FUNC      every function of the JS Math object (ES2024), bare in lower case or with the Math.
//           prefix, with the arity the spec gives it:
//             no argument      random
//             1 argument       abs acos acosh asin asinh atan atanh cbrt ceil clz32 cos cosh exp
//                              expm1 floor fround log(natural) log10 log1p log2 round sign sin
//                              sinh sqrt tan tanh trunc
//             2 arguments      atan2(y, x)  imul(a, b)  pow(x, y)
//             1 or more        hypot  max  min
//           The spec lets hypot, max and min take no argument at all; that is refused here (min()
//           and max() are always +-Infinity, so missing, and hypot() is the constant 0), as it was
//           for min and max before. Math.f16round and Math.sumPrecise (ES2025/26) are not in the
//           list: not every browser the app supports has them, and the ports would need their own
//           float16 and exact-summation code for no use a formula has.
//
// SEMANTICS (per row)
//   - A missing operand (null, undefined, blank or whitespace-only string, NaN, +-Infinity, or a
//     string that is not a number) makes the row's result missing (null). Numeric strings
//     ('1.5') count as numbers, booleans as 1 and 0. Missing never becomes 0.
//   - Rows: the FIRST column token's length sets the row count; a column shorter than that
//     reads as missing past its end. A stored value is the same in every row.
//   - Arithmetic is IEEE double. `%` is the remainder with the sign of the DIVIDEND (JS `%`,
//     C fmod), so -7 % 3 = -1. Every function is exactly the JS Math function: `round(x)` rounds
//     halves up, toward +infinity (round(2.5) = 3, round(-2.5) = -2); it is NOT banker's
//     rounding. `sign`, `trunc`, `round` and `ceil` keep the signed zero (sign(-0) = -0).
//     `cbrt(-8)` = -2 (the real root, where (-8)^(1/3) is missing). `atan2(y, x)` takes y first.
//     `clz32`, `imul` and `fround` work on the 32-bit integer / float32 forms: clz32(0) = 32,
//     clz32(-1) = 0, imul(2^31 - 1, 2) = -2 (wraps), fround(0.1) = 0.10000000149011612.
//     Trig functions take radians.
//   - `random()` is seeded, never Math.random: a uniform draw in [0, 1) from the app's seeded
//     generator (permutationTest.js createSeededRNG, @stdlib minstd-shuffle) seeded by the node's
//     `seed` argument (FormulaColumn: default 12345, stored in the session). Draws are taken row
//     by row and, within a row, left to right in the formula; every random() in the formula
//     draws once in every row, even a row whose result is missing, so a gap never shifts the
//     values of later rows. The same session therefore gives the same numbers on every
//     recompute and in the Python and R ports, which reproduce the generator exactly.
//   - Any operation whose value is not finite (x/0, log(0), sqrt(-1), (-8)^(1/3), overflow) is
//     missing (null) from that step on, never Infinity or NaN: min(1/0, 3) is missing.
//   - A NUMBER literal too large for a double (1e999) is missing as well.
//   - Errors (refused formulas): an unknown character, an unknown name, a name used without
//     '(' when it is a function (or with '(' when it is a constant), a wrong argument count,
//     unbalanced parentheses, a missing operand or operator, a name followed by '.' (other than
//     the Math. prefix), an empty formula, more than 200 levels of nesting, more than 2000
//     lexemes. A refused formula produces no output at all (the node is invalid and says why).

/**
 * Functions allowed in a formula, with their arity: a number, or [min, max] (max Infinity).
 * `fn` is the JS Math function itself, so the semantics are JS's by construction. `random` has no
 * `fn`: it draws from the seeded generator the caller passes in (evaluateFormula env.random).
 */
const FUNCTIONS = {
	abs: { arity: 1, fn: Math.abs },
	acos: { arity: 1, fn: Math.acos },
	acosh: { arity: 1, fn: Math.acosh },
	asin: { arity: 1, fn: Math.asin },
	asinh: { arity: 1, fn: Math.asinh },
	atan: { arity: 1, fn: Math.atan },
	atan2: { arity: 2, fn: Math.atan2 }, // atan2(y, x)
	atanh: { arity: 1, fn: Math.atanh },
	cbrt: { arity: 1, fn: Math.cbrt },
	ceil: { arity: 1, fn: Math.ceil },
	clz32: { arity: 1, fn: Math.clz32 },
	cos: { arity: 1, fn: Math.cos },
	cosh: { arity: 1, fn: Math.cosh },
	exp: { arity: 1, fn: Math.exp },
	expm1: { arity: 1, fn: Math.expm1 },
	floor: { arity: 1, fn: Math.floor },
	fround: { arity: 1, fn: Math.fround },
	hypot: { arity: [1, Infinity], fn: Math.hypot },
	imul: { arity: 2, fn: Math.imul },
	log: { arity: 1, fn: Math.log },
	log10: { arity: 1, fn: Math.log10 },
	log1p: { arity: 1, fn: Math.log1p },
	log2: { arity: 1, fn: Math.log2 },
	max: { arity: [1, Infinity], fn: Math.max },
	min: { arity: [1, Infinity], fn: Math.min },
	pow: { arity: 2, fn: Math.pow },
	random: { arity: 0, fn: null },
	round: { arity: 1, fn: Math.round }, // halves go up: round(2.5) = 3, round(-2.5) = -2
	sign: { arity: 1, fn: Math.sign },
	sin: { arity: 1, fn: Math.sin },
	sinh: { arity: 1, fn: Math.sinh },
	sqrt: { arity: 1, fn: Math.sqrt },
	tan: { arity: 1, fn: Math.tan },
	tanh: { arity: 1, fn: Math.tanh },
	trunc: { arity: 1, fn: Math.trunc }
};

// The JS Math constants, in their JS spelling. Accepted bare and after `Math.`.
const MATH_CONSTANTS = {
	E: Math.E,
	LN10: Math.LN10,
	LN2: Math.LN2,
	LOG10E: Math.LOG10E,
	LOG2E: Math.LOG2E,
	PI: Math.PI,
	SQRT1_2: Math.SQRT1_2,
	SQRT2: Math.SQRT2
};
// Bare names: the JS constants plus the lower-case pi and e the grammar always had.
const CONSTANTS = { pi: Math.PI, e: Math.E, ...MATH_CONSTANTS };

export const FORMULA_FUNCTIONS = Object.freeze(Object.keys(FUNCTIONS));
export const FORMULA_CONSTANTS = Object.freeze(Object.keys(CONSTANTS));
/** name -> arity (a number, or [min, max] with max Infinity), for docs and tests. */
export const FORMULA_ARITY = Object.freeze(
	Object.fromEntries(Object.entries(FUNCTIONS).map(([k, v]) => [k, v.arity]))
);

const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

export class FormulaError extends Error {
	constructor(message) {
		super(message);
		this.name = 'FormulaError';
	}
}

const MAX_LEXEMES = 2000;

const NUMBER_RE = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*/;

/** Short, safe rendering of offending text for an error message. */
function show(s) {
	// Control characters render as '?' so a message never carries invisible text.
	let t = [...String(s)].map((c) => (c < ' ' || c === '\u007f' ? '?' : c)).join('');
	if (t.length > 20) t = `${t.slice(0, 20)}...`;
	return t.includes('"') && !t.includes("'") ? `'${t}'` : `"${t}"`;
}

/**
 * Lex a FormulaColumn token list into a flat list of lexemes.
 * @param {Array<{type:string, value?:string, id?:number, key?:string}>} tokens
 */
function lex(tokens) {
	const out = [];
	for (const tok of tokens ?? []) {
		if (!tok || typeof tok !== 'object') throw new FormulaError('Malformed formula token.');
		if (tok.type === 'col') {
			out.push({ t: 'col', id: tok.id });
			continue;
		}
		if (tok.type === 'stored') {
			out.push({ t: 'stored', key: tok.key });
			continue;
		}
		if (tok.type !== 'text')
			throw new FormulaError(`Unknown formula token type ${show(tok.type)}.`);
		const src = tok.value ?? '';
		if (typeof src !== 'string') throw new FormulaError('Formula text must be a string.');
		let i = 0;
		while (i < src.length) {
			const ch = src[i];
			if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
				i++;
				continue;
			}
			const rest = src.slice(i);
			let m = NUMBER_RE.exec(rest);
			if (m) {
				// A number glued to a name ("2x", "1e") is not a number we can read.
				const glued = NAME_RE.exec(rest.slice(m[0].length));
				if (glued) {
					throw new FormulaError(
						`Cannot read ${show(m[0] + glued[0])}: put an operator between a number and a name.`
					);
				}
				out.push({ t: 'num', v: Number(m[0]) });
				i += m[0].length;
				continue;
			}
			m = NAME_RE.exec(rest);
			if (m) {
				let name = m[0];
				let len = name.length;
				let math = false;
				if (name === 'Math' && rest[len] === '.') {
					const m2 = NAME_RE.exec(rest.slice(len + 1));
					if (!m2) throw new FormulaError('Expected a function name after "Math.".');
					name = m2[0];
					len += 1 + m2[0].length;
					math = true;
				}
				if (rest[len] === '.')
					throw new FormulaError(
						`${show(rest.slice(0, len + 1))} is not allowed: a formula cannot reach into names with ".".`
					);
				out.push({ t: 'name', name, math, text: rest.slice(0, len) });
				i += len;
				continue;
			}
			if ('+-*/%^(),'.includes(ch)) {
				out.push({ t: 'op', v: ch });
				i++;
				continue;
			}
			throw new FormulaError(
				`Unexpected character ${show(ch)}. A formula can use numbers, columns ($), stored values (#), + - * / % ^ ( ) and the functions ${FORMULA_FUNCTIONS.join(', ')}.`
			);
		}
	}
	return out;
}

function describe(lx) {
	if (!lx) return 'the end of the formula';
	if (lx.t === 'num') return `the number ${lx.v}`;
	if (lx.t === 'name') return show(lx.text);
	if (lx.t === 'col') return 'a column';
	if (lx.t === 'stored') return 'a stored value';
	return show(lx.v);
}

/**
 * Parse a FormulaColumn token list into an expression tree. Throws FormulaError when the
 * formula is outside the grammar.
 * @returns {object} AST node
 */
export function parseFormula(tokens) {
	const lx = lex(tokens);
	if (lx.length === 0) throw new FormulaError('The formula is empty.');
	// Size limit: the evaluator walks the tree recursively, and a left-associative chain
	// (a + b + c + ...) is as deep as it is long.
	if (lx.length > MAX_LEXEMES)
		throw new FormulaError(`The formula is too long (over ${MAX_LEXEMES} parts).`);
	let pos = 0;
	const peek = () => lx[pos];
	const isOp = (v) => lx[pos]?.t === 'op' && lx[pos].v === v;
	const expectOp = (v) => {
		if (!isOp(v)) throw new FormulaError(`Expected ${show(v)} but found ${describe(peek())}.`);
		pos++;
	};

	// Nesting limit, so a hostile file cannot overflow the stack with "((((...".
	const MAX_DEPTH = 200;
	let depth = 0;
	function expr() {
		if (++depth > MAX_DEPTH) throw new FormulaError('The formula is nested too deeply.');
		let node = term();
		while (isOp('+') || isOp('-')) {
			const op = lx[pos++].v;
			node = { k: 'bin', op, a: node, b: term() };
		}
		depth--;
		return node;
	}
	function term() {
		let node = unary();
		while (isOp('*') || isOp('/') || isOp('%')) {
			const op = lx[pos++].v;
			node = { k: 'bin', op, a: node, b: unary() };
		}
		return node;
	}
	function unary() {
		if (isOp('-') || isOp('+')) {
			const op = lx[pos++].v;
			if (++depth > MAX_DEPTH) throw new FormulaError('The formula is nested too deeply.');
			const a = unary();
			depth--;
			return op === '-' ? { k: 'neg', a } : a;
		}
		return power();
	}
	function power() {
		const base = primary();
		if (isOp('^')) {
			pos++;
			if (++depth > MAX_DEPTH) throw new FormulaError('The formula is nested too deeply.');
			const b = unary();
			depth--;
			return { k: 'bin', op: '^', a: base, b };
		}
		return base;
	}
	function primary() {
		const tok = peek();
		if (!tok) throw new FormulaError('The formula ends where a value was expected.');
		if (tok.t === 'num') {
			pos++;
			return { k: 'num', v: tok.v };
		}
		if (tok.t === 'col') {
			pos++;
			return { k: 'col', id: tok.id };
		}
		if (tok.t === 'stored') {
			pos++;
			return { k: 'stored', key: tok.key };
		}
		if (tok.t === 'name') {
			pos++;
			const fnTable = FUNCTIONS;
			const constTable = tok.math ? MATH_CONSTANTS : CONSTANTS;
			if (isOp('(')) {
				if (!own(fnTable, tok.name))
					throw new FormulaError(
						`Unknown function ${show(tok.text)}. Allowed: ${FORMULA_FUNCTIONS.join(', ')}.`
					);
				pos++;
				const args = [];
				if (!isOp(')')) {
					args.push(expr());
					while (isOp(',')) {
						pos++;
						args.push(expr());
					}
				}
				expectOp(')');
				const ar = fnTable[tok.name].arity;
				const [lo, hi] = Array.isArray(ar) ? ar : [ar, ar];
				if (args.length < lo || args.length > hi) {
					const want = lo === hi ? `${lo}` : hi === Infinity ? `at least ${lo}` : `${lo} to ${hi}`;
					const one = want === '1' || want === 'at least 1';
					throw new FormulaError(
						`${tok.name}() takes ${want} argument${one ? '' : 's'}, not ${args.length}.`
					);
				}
				return { k: 'call', fn: tok.name, args };
			}
			if (own(constTable, tok.name)) return { k: 'num', v: constTable[tok.name] };
			if (own(fnTable, tok.name))
				throw new FormulaError(`${show(tok.text)} is a function: write ${tok.text}(...).`);
			throw new FormulaError(
				`Unknown name ${show(tok.text)}. Use $ to insert a column and # for a stored value.`
			);
		}
		if (isOp('(')) {
			pos++;
			const inner = expr();
			expectOp(')');
			return inner;
		}
		throw new FormulaError(`Expected a value but found ${describe(tok)}.`);
	}

	const tree = expr();
	if (pos < lx.length) {
		const tok = peek();
		if (tok.t === 'op' && tok.v === ')') throw new FormulaError('Unbalanced ")" in the formula.');
		throw new FormulaError(`Unexpected ${describe(tok)}: an operator is missing.`);
	}
	return tree;
}

/**
 * Validate a FormulaColumn token list without evaluating it (the Worker normalizer uses this).
 * Checks token shapes as well as the grammar.
 * @returns {string|null} an error message, or null when the formula is valid
 */
export function validateFormulaTokens(tokens) {
	if (!Array.isArray(tokens)) return 'tokens must be an array';
	for (const t of tokens) {
		if (!t || typeof t !== 'object') return 'every token must be an object';
		if (t.type === 'col') {
			if (!Number.isInteger(t.id)) return 'a column token needs an integer column id';
		} else if (t.type === 'stored') {
			if (typeof t.key !== 'string' || !t.key) return 'a stored-value token needs a key';
		} else if (t.type === 'text') {
			if (t.value != null && typeof t.value !== 'string')
				return 'text token value must be a string';
		} else {
			return `unknown token type ${show(t.type)}`;
		}
	}
	try {
		parseFormula(tokens);
		return null;
	} catch (e) {
		if (e instanceof FormulaError) return e.message;
		throw e;
	}
}

/**
 * Read one operand cell: a finite number, or null when it is missing. Numbers, numeric strings
 * (Number() syntax, so '1.5', ' 2 ', '1e3', '0x10') and booleans (true 1, false 0) are values;
 * null, undefined, blank strings, NaN, +-Infinity, non-numeric strings and objects are missing.
 */
export function formulaCell(v) {
	if (v == null) return null;
	if (typeof v === 'number') return Number.isFinite(v) ? v : null;
	if (typeof v === 'string') {
		if (v.trim() === '') return null;
		const n = Number(v);
		return Number.isFinite(n) ? n : null;
	}
	if (typeof v === 'boolean') return v ? 1 : 0;
	return null;
}

/** The seed a FormulaColumn uses when its `seed` arg is absent or unusable. */
export const FORMULA_DEFAULT_SEED = 12345;

/**
 * The seed random() is drawn with: a finite, non-zero number (or numeric string) as given, else
 * FORMULA_DEFAULT_SEED. Absent (sessions saved before the arg existed), null, '', 0, NaN,
 * +-Infinity, booleans and other values all give the default, so `Number(null) === 0` can never
 * pick a seed. The generator (createSeededRNG) then truncates and wraps it into its range.
 */
export function formulaSeed(v) {
	let n = NaN;
	if (typeof v === 'number') n = v;
	else if (typeof v === 'string' && v.trim() !== '') n = Number(v);
	return Number.isFinite(n) && n !== 0 ? n : FORMULA_DEFAULT_SEED;
}

/**
 * True when the parsed formula calls random() anywhere (so the node needs, and shows, a seed).
 * @param {object} ast from parseFormula
 */
export function formulaUsesRandom(ast) {
	// Iterative: a 2000-lexeme left chain is about 1000 levels deep.
	const stack = [ast];
	while (stack.length) {
		const node = stack.pop();
		if (!node) continue;
		if (node.k === 'call') {
			if (node.fn === 'random') return true;
			stack.push(...node.args);
		} else if (node.k === 'neg') stack.push(node.a);
		else if (node.k === 'bin') stack.push(node.a, node.b);
	}
	return false;
}

/**
 * Evaluate a parsed formula for every row.
 * @param {object} ast from parseFormula
 * @param {{ column: (id:number) => ArrayLike<unknown>, stored: (key:string) => unknown,
 *   random?: () => number }} env  `random` is the seeded generator random() draws from (one
 *   uniform [0, 1) value per call, e.g. createSeededRNG(seed)); it is required when the formula
 *   uses random(), and Math.random is never used in its place.
 * @param {number} n number of rows
 * @returns {(number|null)[]}
 */
export function evaluateFormula(ast, env, n) {
	const draw = env.random;
	if (typeof draw !== 'function' && formulaUsesRandom(ast))
		throw new FormulaError('random() needs a seeded generator.');
	const colCache = new Map();
	const storedCache = new Map();
	const colData = (id) => {
		if (!colCache.has(id)) colCache.set(id, env.column(id) ?? []);
		return colCache.get(id);
	};
	const storedVal = (key) => {
		if (!storedCache.has(key)) storedCache.set(key, formulaCell(env.stored(key)));
		return storedCache.get(key);
	};

	// Returns a finite number, or null for missing. Missing propagates through every operator,
	// and any step that produces a non-finite value (1/0, log(0), sqrt(-1), (-8)^(1/3), exp(1000))
	// is missing from that step on, so min(1/0, 3) is missing, not 3. Checking every step (not
	// only the row's final value) keeps the ports simple: Python and R raise or return Inf/NaN in
	// different places, and "any non-finite step is missing" means the same thing in all three.
	function ev(node, i) {
		const v = step(node, i);
		return v != null && Number.isFinite(v) ? v : null;
	}
	function step(node, i) {
		switch (node.k) {
			case 'num':
				return node.v;
			case 'col':
				return formulaCell(colData(node.id)[i]);
			case 'stored':
				return storedVal(node.key);
			case 'neg': {
				const a = ev(node.a, i);
				return a == null ? null : -a;
			}
			case 'bin': {
				const a = ev(node.a, i);
				const b = ev(node.b, i);
				if (a == null || b == null) return null;
				switch (node.op) {
					case '+':
						return a + b;
					case '-':
						return a - b;
					case '*':
						return a * b;
					case '/':
						return a / b;
					case '%':
						return a % b;
					case '^':
						return Math.pow(a, b);
				}
				throw new FormulaError(`Unknown operator ${show(node.op)}.`);
			}
			case 'call': {
				if (node.fn === 'random') return draw();
				const vals = node.args.map((x) => ev(x, i));
				if (vals.some((v) => v == null)) return null;
				return FUNCTIONS[node.fn].fn(...vals);
			}
		}
		throw new FormulaError('Malformed formula tree.');
	}

	const out = new Array(n);
	for (let i = 0; i < n; i++) {
		out[i] = ev(ast, i);
	}
	return out;
}
