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
// If a match here is genuinely safe, don't weaken the rule — annotate the line with
// `isNaN-ok:` and a short reason, which is greppable and reviewable.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const libRoot = resolve(here, '..');

/** Source files where a data-row filter could plausibly live. */
function sourceFiles() {
	return globSync('{tableProcesses,processes,plots,utils}/**/*.{svelte,js}', {
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

/** Does this line guard against null/undefined as well as NaN? */
const isGuarded = (line) =>
	/==\s*null|!=\s*null|isInvalidValue|Number\.isFinite|isFinite\(|!==\s*undefined/.test(line) ||
	/isNaN-ok:/.test(line);

/**
 * Does this line look like it is filtering DATA ROWS (as opposed to validating a scalar
 * parameter, where a null would be caught by other means)? The signals are array iteration
 * and indexing.
 */
const looksLikeRowFilter = (line) =>
	/\.filter\(/.test(line) || /\[i\]/.test(line) || /\.map\(\s*\(\s*\w+\s*,\s*i\s*\)/.test(line);

describe('no bare isNaN() row filters (the null trap)', () => {
	it('finds source files to scan (guards against the glob silently matching nothing)', () => {
		expect(sourceFiles().length).toBeGreaterThan(50);
	});

	it('every isNaN() row filter also rejects null/undefined', () => {
		const offenders = [];
		for (const file of sourceFiles()) {
			const lines = readFileSync(file, 'utf8').split('\n');
			lines.forEach((line, i) => {
				if (!/isNaN\(/.test(line)) return;
				if (isComment(line)) return;
				if (isParseFloatIdiom(line)) return;
				// A multi-line condition is normal formatting, e.g.
				//     if (
				//         xData[i] != null &&
				//         !isNaN(Number(xData[i]))
				//     )
				// so judge the surrounding statement, not the single line. Without this the
				// scan flags correctly-guarded code (the Actogram does exactly the above).
				const context = lines.slice(Math.max(0, i - 4), i + 5).join('\n');
				if (isGuarded(context)) return;
				if (!looksLikeRowFilter(line)) return;
				offenders.push(`${relative(libRoot, file)}:${i + 1}  ${line.trim()}`);
			});
		}
		expect(
			offenders,
			`Bare isNaN() row filter(s) found. isNaN(null) is false, so these KEEP null rows and\n` +
				`the analysis fits them as zeros. Use validPairs()/validValues() from\n` +
				`utils/validPairs.js, or isInvalidValue() from utils/stats.js. If a hit is genuinely\n` +
				`safe, annotate the line with "isNaN-ok: <reason>".\n\n` +
				offenders.join('\n')
		).toEqual([]);
	});
});
