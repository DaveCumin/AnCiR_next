// @vitest-environment node
//
// A guard against Svelte compiler warnings creeping back.
//
// On 2026-10-17 the app compiled with 108 Svelte warnings (and one dead component that did not
// compile at all). Most were accessibility warnings, but they also hid real bugs: a number box
// that showed nothing after its units changed (state_referenced_locally) and a svelte-ignore that
// silently ignored only its first code. Nobody reads 100 warnings, so a new one went unnoticed;
// this test makes the count zero and keeps it there.
//
// It compiles every .svelte component and every .svelte.js / .svelte.ts module under src/ with
// the Svelte compiler and the project's compilerOptions (svelte.config.js), the same analysis
// vite-plugin-svelte runs, and fails on any warning that KNOWN_WARNINGS does not list.
//
// Fix a warning for real: a button instead of a clickable div, a <label for>, role="presentation"
// on a pointer-only surface whose controls are reachable another way, $derived or untrack() for
// a value read once. A svelte-ignore is only for a genuine false positive, and every one must be
// listed in ALLOWED_IGNORES with its reason, so an ignore cannot slip in unreviewed either.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';
import { compile, compileModule } from 'svelte/compiler';
import svelteConfig from '../../../svelte.config.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const srcRoot = join(repoRoot, 'src');

/**
 * Warnings that exist today and have not been fixed yet, as `<path from src/>|<code>` with a
 * reason. A ratchet, not an exemption: it only ever shrinks, and a stale entry fails the test.
 * @type {Record<string, string>}
 */
const KNOWN_WARNINGS = {};

/**
 * Every svelte-ignore in the app, as `<path from src/>` → { codes, reason }. Each is a genuine
 * false positive of a Svelte rule, not a warning nobody fixed.
 */
const ALLOWED_IGNORES = {
	'lib/components/reusables/Draggable.svelte': {
		codes: ['a11y_no_noninteractive_tabindex', 'a11y_no_noninteractive_element_interactions'],
		reason:
			'The plot card is a focusable role="group" selected with Enter/Space. A focusable group ' +
			'is how ARIA expresses a selectable container of other controls (a button role cannot ' +
			'hold the header buttons), but Svelte counts every group as non-interactive.'
	},
	'lib/tableProcesses/BlankColumn.svelte': {
		codes: ['a11y_no_noninteractive_tabindex', 'a11y_no_noninteractive_element_interactions'],
		reason:
			'The Enter Data height handle is a focusable role="separator" (the WAI-ARIA window ' +
			'splitter, operable with the arrow keys). A focusable separator is a widget in ARIA, ' +
			'but Svelte counts every separator as non-interactive.'
	}
};

// Walked rather than globbed, matching the other guards here. pCloud's "[conflicted]" copies
// are sync debris, never source.
function svelteSources(dir = srcRoot, out = []) {
	for (const entry of readdirSync(dir)) {
		if (entry === 'node_modules' || entry.startsWith('.') || entry.includes('conflicted')) continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			svelteSources(full, out);
			continue;
		}
		// vite-plugin-svelte compiles `*.svelte` as components and any `.js`/`.ts` file with a
		// `.svelte.` infix (state modules and their tests) as runes modules.
		if (entry.endsWith('.svelte') || (entry.includes('.svelte.') && /\.[jt]s$/.test(entry))) {
			out.push(full);
		}
	}
	return out;
}

const { compilerOptions = {} } = svelteConfig;
// A module takes only the options that apply to it (compileModule rejects component ones).
const { dev, experimental, warningFilter } = compilerOptions;
const moduleOptions = Object.fromEntries(
	Object.entries({ dev, experimental, warningFilter }).filter(([, v]) => v !== undefined)
);

/** @returns {{ key: string, detail: string }[]} every warning, or a compile error, per file */
function compileAll() {
	const found = [];
	for (const file of svelteSources()) {
		const rel = relative(srcRoot, file);
		const source = readFileSync(file, 'utf8');
		let warnings;
		try {
			warnings = file.endsWith('.svelte')
				? compile(source, { ...compilerOptions, filename: rel, generate: false }).warnings
				: compileModule(source, { ...moduleOptions, filename: rel, generate: false }).warnings;
		} catch (error) {
			const err = /** @type {any} */ (error);
			found.push({
				key: `${rel}|compile_error`,
				detail: `${rel}:${err.start?.line ?? '?'}  compile error: ${err.message.split('\n')[0]}`
			});
			continue;
		}
		for (const w of warnings) {
			found.push({
				key: `${rel}|${w.code}`,
				detail: `${rel}:${w.start?.line ?? '?'}  ${w.code}: ${w.message.split('\n')[0]}`
			});
		}
	}
	return found;
}

// Compiled once and shared by the tests below (about a second for the whole app).
let cached;
const allWarnings = () => (cached ??= compileAll());

describe('Svelte compiler warnings', () => {
	it('finds Svelte sources to compile (guards against the walk matching nothing)', () => {
		const files = svelteSources();
		expect(files.filter((f) => f.endsWith('.svelte')).length).toBeGreaterThan(150);
		expect(files.some((f) => /\.svelte\.[jt]s$/.test(f))).toBe(true);
		expect(files.some((f) => /\.svelte\.test\.[jt]s$/.test(f))).toBe(true);
	});

	it('every component and module compiles without a warning', () => {
		const unexpected = allWarnings()
			.filter((w) => !(w.key in KNOWN_WARNINGS))
			.map((w) => w.detail);
		expect(
			unexpected,
			'Svelte compiler warnings (fix them for real; a svelte-ignore needs a genuine false\n' +
				'positive and an ALLOWED_IGNORES entry in this file):\n\n' +
				unexpected.join('\n')
		).toEqual([]);
	});

	it('the known-warning list only ever shrinks', () => {
		const live = new Set(allWarnings().map((w) => w.key));
		const stale = Object.keys(KNOWN_WARNINGS).filter((k) => !live.has(k));
		expect(
			stale,
			'Stale KNOWN_WARNINGS entries: these warnings are gone, so delete them from the list.\n\n' +
				stale.join('\n')
		).toEqual([]);
	});

	it('every svelte-ignore is a reviewed false positive', () => {
		const IGNORE = /svelte-ignore\s+([^\n]*?)\s*(?:-->|\*\/|$)/gm;
		const unexpected = [];
		const seen = new Set();
		for (const file of svelteSources()) {
			const rel = relative(srcRoot, file);
			for (const m of readFileSync(file, 'utf8').matchAll(IGNORE)) {
				const codes = m[1].split(/[\s,]+/).filter((c) => /^[a-z0-9_-]+$/.test(c));
				const allowed = ALLOWED_IGNORES[rel]?.codes ?? [];
				for (const code of codes) {
					if (allowed.includes(code)) seen.add(`${rel}|${code}`);
					else unexpected.push(`${rel}  svelte-ignore ${code}`);
				}
			}
		}
		expect(
			unexpected,
			'Unreviewed svelte-ignore comments. Fix the warning instead, or, for a genuine false\n' +
				'positive, add the file and code to ALLOWED_IGNORES with the reason:\n\n' +
				unexpected.join('\n')
		).toEqual([]);
		const stale = Object.entries(ALLOWED_IGNORES).flatMap(([rel, { codes }]) =>
			codes.filter((c) => !seen.has(`${rel}|${c}`)).map((c) => `${rel}|${c}`)
		);
		expect(stale, 'Stale ALLOWED_IGNORES entries:\n\n' + stale.join('\n')).toEqual([]);
	});

	it('a svelte-ignore with several codes separates them with commas', () => {
		// In runes mode only a comma continues the list: everything after the first code that is
		// not followed by one is read as prose. `svelte-ignore a b` therefore ignores only `a`,
		// and Draggable's plot card carried that for months with `b` still warning.
		const offenders = [];
		for (const file of svelteSources()) {
			const rel = relative(srcRoot, file);
			for (const m of readFileSync(file, 'utf8').matchAll(
				/svelte-ignore\s+[a-z0-9_-]+(?:\s*,\s*[a-z0-9_-]+)*\s+[a-z0-9]+_[a-z0-9_]+/g
			)) {
				offenders.push(`${rel}  ${m[0]}`);
			}
		}
		expect(offenders, 'Comma-separate svelte-ignore codes:\n\n' + offenders.join('\n')).toEqual([]);
	});
});
