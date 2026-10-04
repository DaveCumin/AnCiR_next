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
// CONSTANT  pi, e (also Math.PI, Math.E)
// FUNC      abs sqrt log(natural) log10 exp sin cos tan floor ceil round (1 argument each),
//           pow (2 arguments), min max (1 or more arguments). A `Math.` prefix is accepted as an
//           alias (Math.sqrt, Math.log, ...) so formulas written for the old evaluator still work.
//
// SEMANTICS (per row)
//   - A missing operand (null, undefined, blank or whitespace-only string, NaN, +-Infinity, or a
//     string that is not a number) makes the row's result missing (null). Numeric strings
//     ('1.5') count as numbers, booleans as 1 and 0. Missing never becomes 0.
//   - Rows: the FIRST column token's length sets the row count; a column shorter than that
//     reads as missing past its end. A stored value is the same in every row.
//   - Arithmetic is IEEE double. `%` is the remainder with the sign of the DIVIDEND (JS `%`,
//     C fmod), so -7 % 3 = -1. `round(x)` rounds halves up, toward +infinity (round(2.5) = 3,
//     round(-2.5) = -2), like JS Math.round; it is NOT banker's rounding.
//     Trig functions take radians.
//   - Any operation whose value is not finite (x/0, log(0), sqrt(-1), (-8)^(1/3), overflow) is
//     missing (null) from that step on, never Infinity or NaN: min(1/0, 3) is missing.
//   - A NUMBER literal too large for a double (1e999) is missing as well.
//   - Errors (refused formulas): an unknown character, an unknown name, a name used without
//     '(' when it is a function (or with '(' when it is a constant), a wrong argument count,
//     unbalanced parentheses, a missing operand or operator, a name followed by '.' (other than
//     the Math. prefix), an empty formula, more than 200 levels of nesting, more than 2000
//     lexemes. A refused formula produces no output at all (the node is invalid and says why).

/** Functions allowed in a formula, with their arity: a number, or [min, max] (max Infinity). */
const FUNCTIONS = {
	abs: { arity: 1, fn: Math.abs },
	sqrt: { arity: 1, fn: Math.sqrt },
	log: { arity: 1, fn: Math.log },
	log10: { arity: 1, fn: Math.log10 },
	exp: { arity: 1, fn: Math.exp },
	sin: { arity: 1, fn: Math.sin },
	cos: { arity: 1, fn: Math.cos },
	tan: { arity: 1, fn: Math.tan },
	floor: { arity: 1, fn: Math.floor },
	ceil: { arity: 1, fn: Math.ceil },
	round: { arity: 1, fn: Math.round }, // halves go up: round(2.5) = 3, round(-2.5) = -2
	pow: { arity: 2, fn: Math.pow },
	min: { arity: [1, Infinity], fn: Math.min },
	max: { arity: [1, Infinity], fn: Math.max }
};

const CONSTANTS = { pi: Math.PI, e: Math.E };
// `Math.`-prefixed spellings the old evaluator accepted (JS capitalisation for the constants).
const MATH_CONSTANTS = { PI: Math.PI, E: Math.E };

export const FORMULA_FUNCTIONS = Object.freeze(Object.keys(FUNCTIONS));
export const FORMULA_CONSTANTS = Object.freeze(Object.keys(CONSTANTS));

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
					throw new FormulaError(
						`${tok.name}() takes ${want} argument${want === '1' ? '' : 's'}, not ${args.length}.`
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

/**
 * Evaluate a parsed formula for every row.
 * @param {object} ast from parseFormula
 * @param {{ column: (id:number) => ArrayLike<unknown>, stored: (key:string) => unknown }} env
 * @param {number} n number of rows
 * @returns {(number|null)[]}
 */
export function evaluateFormula(ast, env, n) {
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
