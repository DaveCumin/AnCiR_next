// A guard against re-introducing the null trap, anywhere in the node layer.
//
// `isNaN(null)` is FALSE and `Number(null)` is 0. So a validity filter written as
// `isNaN(v)` KEEPS null rows and the analysis then consumes them as zeros. Split and Filter
// emit full-length segments padded with null, so this silently halved fits and turned a 24 h
// free-period estimate into ~234 h (see utils/validPairs.js for the measurements).
//
// The behavioural tests for each node prove the current code is right. THIS test is about the
// next node: it scans source for the dangerous shape, so a new analysis written by copying an
// old one can't quietly bring the bug back. Static, so it costs nothing and needs no fixture.
//
// Every check is PER OPERAND. The first version judged the whole line (and the lines around
// it), so `!isNaN(v) && x[i] != null && !isNaN(x[i])` passed because SOME operand had a null
// check, while `v` (RemoveTrend's X) had none and a missing X was fitted at x = 0 (STAT-4).
//
// If a match here is genuinely safe, don't weaken the rule — annotate the line with
// `isNaN-ok:` (or `Number-ok:`) and a short reason, which is greppable and reviewable.
//
// Existing offenders in files this change did not own are held in per-file BUDGETS (a
// shrink-only ratchet): a NEW offender anywhere fails, and fixing or annotating one fails until
// its budget is lowered, so the list can only shrink and every commit stays green.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const libRoot = resolve(here, '..');

/** Source files where a data-row filter could plausibly live. */
function sourceFiles() {
	return globSync('{tableProcesses,processes,plots,utils,components/plotbits}/**/*.{svelte,js}', {
		cwd: libRoot
	})
		.filter((p) => !p.endsWith('.test.js'))
		.map((p) => resolve(libRoot, p));
}

/** Comments describe the trap (this file, validPairs.js); they don't implement it. */
const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);

/**
 * `parseFloat`/`Number.parseFloat` returns NaN for junk and NEVER null, so `!isNaN(parseFloat(x))`
 * is the correct idiom there — the trap needs a null to exist in the first place.
 */
const isParseFloatIdiom = (line) => /parseFloat/.test(line);

/** A call to the GLOBAL isFinite (not Number.isFinite / math.isfinite / a method). */
const bareIsFinite = /(^|[^.\w])isFinite\(/;

/**
 * Does this line look like it is filtering DATA ROWS (as opposed to validating a scalar
 * parameter, where a null would be caught by other means)? The signals are array iteration
 * and indexing.
 */
const looksLikeRowFilter = (line) =>
	/\.filter\(/.test(line) || /\[[ijk]\]/.test(line) || /\.map\(\s*\(\s*\w+\s*,\s*i\s*\)/.test(line);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The argument text of every `isNaN(...)` / `Number.isNaN(...)` call on the line. */
export function isNaNOperands(line) {
	const out = [];
	const re = /(?<![\w$])isNaN\(/g;
	let m;
	while ((m = re.exec(line))) {
		let depth = 1;
		let j = m.index + m[0].length;
		const start = j;
		while (j < line.length && depth > 0) {
			if (line[j] === '(') depth++;
			else if (line[j] === ')') depth--;
			j++;
		}
		out.push(line.slice(start, depth === 0 ? j - 1 : j).trim());
	}
	return out;
}

/** The value an operand tests: `Number(x[i])` and `+x` both test `x[i]` / `x`. */
export function coreOperand(op) {
	let c = op.trim();
	for (;;) {
		if (c.startsWith('+')) c = c.slice(1).trim();
		else if (/^Number\(.*\)$/s.test(c)) c = c.slice(7, -1).trim();
		else return c;
	}
}

/**
 * How well is THIS operand guarded in the surrounding statement?
 *   'full': the house rule (isInvalidValue), Number.isFinite (rejects null and strings) or a
 *           typeof-number check;
 *   'null': only a null/undefined comparison, which still lets '' and ' ' through (isNaN('')
 *           is false and Number('') is 0: ROB-8);
 *   'none'.
 * The GLOBAL isFinite is NOT a guard: it coerces, so isFinite(null) and isFinite('') are TRUE.
 */
export function operandGuard(operand, context) {
	const o = escapeRe(operand);
	if (
		new RegExp(
			`isInvalidValue\\(\\s*${o}\\s*\\)|Number\\.isFinite\\(\\s*(?:Number\\(\\s*)?${o}\\s*\\)|typeof\\s+${o}\\s*===?\\s*'number'`
		).test(context)
	)
		return 'full';
	if (
		new RegExp(`${o}\\s*[!=]==?\\s*null|null\\s*[!=]==?\\s*${o}|${o}\\s*!==\\s*undefined`).test(
			context
		)
	)
		return 'null';
	return 'none';
}

/** `Number(a[i])` with a plain array name and a plain index: a data cell converted to a number. */
const NUMBER_OF_CELL = /Number\(\s*([A-Za-z_$][\w$]*\[[A-Za-z_$][\w$]*\])\s*\)/g;

/**
 * Is the cell guarded before it is converted? Its own null/house-rule check, or rows already
 * selected by the shared filters (validPairs / validValues / validEnds) in the statement.
 */
export function cellGuarded(cell, context) {
	if (operandGuard(cell, context) !== 'none') return true;
	return /validPairs\(|validValues\(|validEnds\(/.test(context);
}

/** Scan every source file; `visit(file, lines, i, line)` returns offender strings for a line. */
function scan(visit) {
	const offenders = [];
	for (const file of sourceFiles()) {
		const lines = readFileSync(file, 'utf8').split('\n');
		lines.forEach((line, i) => {
			if (isComment(line)) return;
			for (const o of visit(lines, i, line)) offenders.push({ file: relative(libRoot, file), o });
		});
	}
	return offenders;
}

/** A multi-line condition is normal formatting, so judge the surrounding statement. */
const statement = (lines, i, before = 4, after = 4) =>
	lines.slice(Math.max(0, i - before), i + after + 1).join('\n');

function isNaNOffenders(level) {
	return scan((lines, i, line) => {
		if (!/isNaN\(/.test(line) || isParseFloatIdiom(line) || /isNaN-ok:/.test(line)) return [];
		if (!looksLikeRowFilter(line)) return [];
		const context = statement(lines, i);
		return isNaNOperands(line)
			.map(coreOperand)
			.filter((op) => operandGuard(op, context) === level)
			.map((op) => `${i + 1} [${op}] ${line.trim()}`);
	});
}

function numberOfCellOffenders() {
	return scan((lines, i, line) => {
		if (/Number-ok:/.test(line)) return [];
		const context = statement(lines, i, 6, 2);
		return [...line.matchAll(NUMBER_OF_CELL)]
			.map((m) => m[1])
			.filter((cell) => !cellGuarded(cell, context))
			.map((cell) => `${i + 1} [${cell}] ${line.trim()}`);
	});
}

/**
 * Compare offenders against per-file budgets. Over budget: a new offender (fix it). Under
 * budget: one was fixed or annotated (lower the budget, so it cannot come back).
 */
function checkBudgets(offenders, budgets) {
	const byFile = {};
	for (const { file, o } of offenders) (byFile[file] ??= []).push(o);
	const problems = [];
	for (const [file, list] of Object.entries(byFile)) {
		const budget = budgets[file] ?? 0;
		if (list.length > budget)
			problems.push(`${file}: ${list.length} > budget ${budget}\n    ${list.join('\n    ')}`);
	}
	for (const [file, budget] of Object.entries(budgets)) {
		const n = byFile[file]?.length ?? 0;
		if (n < budget) problems.push(`${file}: ${n} < budget ${budget} (lower the budget)`);
	}
	return problems;
}

// Bare isNaN() operands with NO null guard, in files outside this change. Each needs an audit:
// most operate on arrays already cleaned to NaN (then annotate `isNaN-ok:`), some may be real.
const BARE_ISNAN_BUDGET = {
	'plots/Actogram/onsetUnwrap.js': 1,
	'utils/correlogram.js': 4,
	'utils/periodogram.js': 8
};

// isNaN() operands guarded ONLY against null: '' and ' ' still pass (isNaN('') is false) and
// are then read as 0, or concatenated if numeric strings are kept as strings (ROB-8). Fix with
// isInvalidValue / validPairs / validValues, then lower the budget.
const NULL_ONLY_BUDGET = {
	'components/plotbits/helpers/wrangleData.js': 4,
	'plots/Actogram/Actogram.svelte': 7,
	'plots/Actogram/PhaseMarker.svelte': 2,
	'plots/Correlogram/Correlogram.svelte': 2,
	'plots/Periodogram/Periodogram.svelte': 3,
	'plots/Scatterplot/Scatterplot.svelte': 3,
	'tableProcesses/Split.svelte': 1
};

// `Number(a[i])` on a cell with no guard in the statement. Number(null) and Number('') are 0.
const NUMBER_OF_CELL_BUDGET = {
	'utils/crossCorrelation.js': 2,
	'utils/filters.js': 2,
	'utils/trendfit.js': 3,
	'processes/FilterByOtherCol.svelte': 1,
	'tableProcesses/Crossing.svelte': 2
};

describe('no bare isNaN() row filters (the null trap)', () => {
	it('finds source files to scan (guards against the glob silently matching nothing)', () => {
		expect(sourceFiles().length).toBeGreaterThan(50);
	});

	it('every isNaN() operand in a row filter is itself null-guarded', () => {
		const problems = checkBudgets(isNaNOffenders('none'), BARE_ISNAN_BUDGET);
		expect(
			problems,
			`Bare isNaN() row filter operand(s) found. isNaN(null) is false, so these KEEP null rows\n` +
				`and the analysis fits them as zeros. Each operand needs its own guard: use\n` +
				`validPairs()/validValues() from utils/validPairs.js, or isInvalidValue() from\n` +
				`utils/stats.js. If a hit is genuinely safe, annotate the line with "isNaN-ok: <reason>".\n\n` +
				problems.join('\n')
		).toEqual([]);
	});

	it('no new isNaN() row filter is guarded only against null (blanks still pass)', () => {
		const problems = checkBudgets(isNaNOffenders('null'), NULL_ONLY_BUDGET);
		expect(
			problems,
			`isNaN() row filter operand(s) guarded only by a null check. isNaN('') and isNaN(' ')\n` +
				`are false, so blank cells pass and are read as 0 (Number('') === 0), and numeric\n` +
				`strings pass as STRINGS (a later sum concatenates them). Use isInvalidValue() and\n` +
				`Number(), or validPairs()/validValues().\n\n` +
				problems.join('\n')
		).toEqual([]);
	});

	it('no Number(cell) on a data cell that was never checked for missing', () => {
		const problems = checkBudgets(numberOfCellOffenders(), NUMBER_OF_CELL_BUDGET);
		expect(
			problems,
			`Number(a[i]) on an unguarded cell. Number(null), Number('') and Number(' ') are 0, so\n` +
				`a missing value becomes a real zero (NPCRA read a null-padded segment as zeros:\n` +
				`ROB-6). Check the cell with isInvalidValue() first, or select rows with validPairs().\n` +
				`If a hit is genuinely safe, annotate the line with "Number-ok: <reason>".\n\n` +
				problems.join('\n')
		).toEqual([]);
	});

	it('no row filter uses the global isFinite() (isFinite(null) is true)', () => {
		const offenders = scan((lines, i, line) => {
			if (!bareIsFinite.test(line)) return [];
			if (/isFinite-ok:/.test(line)) return [];
			if (!looksLikeRowFilter(line)) return [];
			return [`${i + 1}  ${line.trim()}`];
		}).map(({ file, o }) => `${file}:${o}`);
		expect(
			offenders,
			`Global isFinite() row filter(s) found. isFinite(null) and isFinite('') are TRUE, so\n` +
				`these KEEP missing rows and the analysis reads them as zeros. Use validPairs() /\n` +
				`validValues() from utils/validPairs.js, isInvalidValue() from utils/stats.js, or\n` +
				`Number.isFinite(). If a hit is genuinely safe, annotate it with "isFinite-ok: <reason>".\n\n` +
				offenders.join('\n')
		).toEqual([]);
	});

	it('the global-isFinite scan bites on the shape it forbids', () => {
		expect(bareIsFinite.test('.filter((p) => isFinite(p.x) && isFinite(p.y))')).toBe(true);
		expect(looksLikeRowFilter('.filter((p) => isFinite(p.x) && isFinite(p.y))')).toBe(true);
		expect(bareIsFinite.test('.filter((v) => Number.isFinite(v))')).toBe(false);
	});
});

describe('the per-operand checks bite on the shapes they forbid', () => {
	it("RemoveTrend's old filter: x[i] is null-guarded but v (the X) is not (STAT-4)", () => {
		const line = '.map((v, i) => (!isNaN(v) && x[i] != null && !isNaN(x[i]) ? i : -1))';
		const ops = isNaNOperands(line).map(coreOperand);
		expect(ops).toEqual(['v', 'x[i]']);
		expect(operandGuard('v', line)).toBe('none');
		expect(operandGuard('x[i]', line)).toBe('null');
	});

	it("SmoothedData's old filter is null-only on both operands (ROB-8)", () => {
		const line = '.filter((d) => d.x != null && d.y != null && !isNaN(d.x) && !isNaN(d.y));';
		for (const op of isNaNOperands(line).map(coreOperand)) {
			expect(operandGuard(op, line)).toBe('null');
		}
	});

	it('the house rule and Number.isFinite count as full guards; global isFinite does not', () => {
		expect(operandGuard('y[i]', 'if (isInvalidValue(y[i]) || isNaN(y[i])) continue;')).toBe('full');
		expect(operandGuard('v', '.filter((v) => Number.isFinite(v) && !isNaN(v))')).toBe('full');
		expect(operandGuard('v', '.filter((v) => isFinite(v) && !isNaN(v))')).toBe('none');
		expect(coreOperand('Number(xData[i])')).toBe('xData[i]');
		expect(coreOperand('+sa')).toBe('sa');
	});

	it("NPCRA's old pairing: Number(y[i]) with only t[i] checked (ROB-6)", () => {
		const context =
			'if (isInvalidValue(t[i])) continue;\nconst ti = Number(t[i]);\n' +
			'if (Number.isFinite(ti)) pairs.push([ti, Number(y[i])]);';
		expect(cellGuarded('t[i]', context)).toBe(true);
		expect(cellGuarded('y[i]', context)).toBe(false);
		expect(cellGuarded('y[i]', 'const { tt } = validPairs(t, y);\nNumber(y[i])')).toBe(true);
	});

	it('the budgets bite: one offender over budget fails, one under budget fails', () => {
		const offs = [
			{ file: 'a.js', o: '1' },
			{ file: 'a.js', o: '2' }
		];
		expect(checkBudgets(offs, { 'a.js': 2 })).toEqual([]);
		expect(checkBudgets(offs, { 'a.js': 1 })).toHaveLength(1);
		expect(checkBudgets(offs, { 'a.js': 3 })).toHaveLength(1);
		expect(checkBudgets([], { 'a.js': 1 })).toHaveLength(1);
	});
});
