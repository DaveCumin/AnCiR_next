// Panel labels are sentence case with no trailing colon (UI-22, 2026-10-03 review).
//
// The panels said "Log Scale" beside "Log scale", "Render as:" beside "Colormap", "Y-Axis"
// beside "Y-axis", often in one panel. The rule, for every static label in a control panel, a
// node panel or a dialog: the first word starts with a capital, later words are lower case
// unless they are an acronym (FFT, RMSE, R², DPI), a single letter (X, Y, N), an axis
// ("Y-axis") or a proper name in PROPER_NOUNS; and no label ends with a colon. A few labels are
// symbols and start lower case on purpose (x, y, k1, alpha); they are in LOWER_START.
//
// Only label SHAPES are scanned (prose and tooltips are sentences anyway). In .svelte files:
//   label="..." on any element or component (ControlInput, StoreValueButton, optgroup...),
//   title="..." on a component that renders it as a section title (Axis, Line, Box,
//   FigureStyleControls) and those components' own `title = '...'` defaults,
//   <span class="ci-label">...</span>, <summary>...</summary>, the <p> that opens a
//   .control-input / section title, a panel header's <p> (class *banner / *heading / *header),
//   a node's .tableProcess-label, a checkbox's <span>, the
//   <h2>/<h3> of a file that renders a <Modal>, a button's static text and the string literals
//   of a button whose text is one {expression}, <option> text, optionsDisplay={[...]}, and a
//   readout's "<strong>Label:</strong>" (the colon there is the separator, so it is dropped).
// In .svelte and .js files: `label: '...'` in descriptor objects and label tables, the string
//   values of a `const ..._LABELS = {...}` table, and `...Display = [...]` option-name arrays.
// Option text, option-name arrays, readouts, `label:` values and label tables are often
// fragments read inside a sentence ("Permute [single values]", "where x [equals] ..."), so for
// those shapes only the capitals and the colon are checked, not the first letter (lowerOk).
// Node display names (`displayName = 'Bin Data'`) are the nodes' proper names and are not
// scanned; a label that names a node lists it in PROPER_NOUNS. lib/tours is prose and skipped.
// Comments are stripped first. PROPER_NOUNS and LOWER_START must each still be used (a stale
// entry fails), and KNOWN_OFFENDERS (labels in files this change could not touch) only shrinks.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join, resolve, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, '..', '..'); // src/

function sourceFiles(dir = srcRoot, out = []) {
	for (const entry of readdirSync(dir)) {
		if (entry === 'node_modules' || entry.startsWith('.')) continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			// Tours are prose (step titles and bodies are sentences); tests hold fixtures.
			if (entry !== 'tours' && entry !== '_tests') sourceFiles(full, out);
		} else if (
			/\.(svelte|js)$/.test(entry) &&
			!/\.(test|spec)\./.test(entry) &&
			!entry.includes('conflicted')
		)
			out.push(full);
	}
	return out;
}

const stripComments = (text) =>
	text
		.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
		.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, (m) => m.replace(/[^\n]/g, ' '))
		.replace(/(^|[\s;,{}()[\]])\/\/(?!\/).*$/gm, '$1');

/** The quoted string literals in a stretch of code. */
const literals = (code) =>
	[...code.matchAll(/'([^'\n]*)'|"([^"\n]*)"/g)].map((m) => m[1] ?? m[2]).filter(Boolean);

// { re, lit?: capture is code (check its string literals), lowerOk?, js?: also in .js }
const SHAPES = [
	{ re: /(?<![\w:-])label="([^"{}]+)"/g },
	{ re: /<(?:Axis|Line|Box|FigureStyleControls)\b[^>]*?\btitle="([^"{}]+)"/g },
	{ re: /class="ci-label"[^>]*>\s*([^<{}]+?)\s*</g },
	{ re: /<summary\b[^>]*>\s*([^<{}]+?)\s*<\/summary>/g },
	{ re: /class="control-input[^"]*"[^>]*>\s*<p>\s*([^<{}]+?)\s*<\/p>/g },
	{
		re: /class="(?:control-component-title|control-data-title)[^"]*"[^>]*>\s*(?:<div[^>]*>\s*)?(?:<span[^>]*>[\s\S]*?<\/span>\s*)?<p>\s*([^<{}]+?)\s*<\/p>/g
	},
	// A panel or window header: <div class="control-banner"><p>Control panel</p>.
	{
		re: /class="[^"]*\b(?:banner|heading|header)\b[^"]*"(?:=>|[^>])*>\s*<p>\s*([^<{}]+?)\s*<\/p>/g
	},
	{ re: /class="tableProcess-label"[^>]*>\s*<span>\s*([^<{}]+?)\s*<\/span>/g },
	{
		re: /<label\b[^>]*>\s*<input[^>]*>\s*<span(?![^>]*class="unit")[^>]*>\s*([^<{}]+?)\s*<\/span>/g
	},
	// A button's own text: the last text before </button> (a leading "+ " is dropped).
	{ re: />\s*([^<>{}]*?[A-Za-z][^<>{}]*?)\s*<\/button\b/g },
	// A button whose text is one expression: {busy ? 'Saving' : 'Confirm import'}.
	{ re: />\s*\{([^{}]*)\}\s*<\/button\b/g, lit: true },
	{ re: /<option\b[^>]*>\s*([^<>{}]+?)\s*<\/option>/g, lowerOk: true },
	{ re: /\boptionsDisplay=\{\[([^\]]*)\]/g, lit: true, lowerOk: true },
	{ re: /<strong>\s*([^<>{}:]*?[A-Za-z][^<>{}:]*?):\s*(?:<\/strong>|\{)/g, lowerOk: true },
	{ re: /(?<![\w$-])label:\s*('[^'\n]*'|"[^"\n]*")/g, lit: true, lowerOk: true, js: true },
	{ re: /\b\w*Display\s*=\s*\[([^\]]*)\]/g, lit: true, lowerOk: true, js: true }
];
const MODAL_HEADINGS = { re: /<h[23]\b[^>]*>\s*([^<{}]+?)\s*<\/h[23]>/g };
/** The section-title components' own default title. */
const TITLE_DEFAULT = { re: /^\s*title = '([^'\n]+)'/gm };
const SECTION_TITLE_FILES = new Set([
	'Axis.svelte',
	'Line.svelte',
	'Box.svelte',
	'FigureStyleControls.svelte'
]);

/** The string values of every `const X_LABELS = { ... }` table (to its closing brace). */
function labelTableValues(text) {
	const out = [];
	const head = /^([ \t]*)(?:export\s+)?const\s+[A-Z_]*LABELS\s*=\s*(?:Object\.freeze\()?\{/gm;
	for (const m of text.matchAll(head)) {
		const from = m.index + m[0].length;
		const close = text.indexOf(`\n${m[1]}}`, from);
		const body = text.slice(from, close < 0 ? undefined : close);
		for (const v of body.matchAll(/:\s*('[^'\n]*'|"[^"\n]*")/g)) out.push(...literals(v[1]));
	}
	return out;
}

/**
 * Proper names and fixed terms that keep their capitals inside a label: people (test and
 * method names), products, a node's name where a label names the node ("+ Add Bin Data"), and
 * the periodogram's Qp statistic.
 */
export const PROPER_NOUNS = new Set([
	'Watson-Williams',
	'Mann-Whitney',
	'Kruskal-Wallis',
	'Tukey-Kramer',
	'Lomb-Scargle',
	'Savitzky-Golay',
	'Shapiro-Wilk',
	"D'Agostino-Pearson",
	'Jarque-Bera',
	'Benjamini-Hochberg',
	'Benjamini-Yekutieli',
	'Holm',
	'Mexican',
	'AnCiR',
	'Python',
	'Bin Data',
	'Qp'
]);

/**
 * Labels that are symbols (or, in Crossing's rule builder, the connectives "and" / "+ or
 * group" that read inside the rule), written lower case on purpose.
 */
export const LOWER_START = new Set([
	'x',
	'k1',
	'k2',
	'alpha',
	'p',
	'p-value',
	'p-values',
	't-stat',
	'a',
	'b',
	'random()',
	'and',
	'or'
]);

/** file (relative to src/) -> labels there that break the rule; shrink-only. */
const KNOWN_OFFENDERS = {};

const ACRONYM = /^[A-Z][A-Z0-9²]+s?$/;
// "PN" stands in for a proper noun (labelProblem); "A_p" is a symbol with a subscript;
// "IS/IV/RA" is a list of acronyms.
const allowedWord = (w) =>
	w.split('/').every((p) => ACRONYM.test(p) || /^[A-Z]$/.test(p)) ||
	/\d/.test(w) ||
	/^[XY]-axis$/.test(w) ||
	/^PN\b/.test(w) ||
	/_/.test(w);

/** Why `label` breaks the rule, or null. */
export function labelProblem(label, { lowerOk = false } = {}) {
	const s = label.trim();
	if (/:$/.test(s)) return 'ends with a colon';
	for (const name of PROPER_NOUNS)
		if (s.includes(name)) return labelProblem(s.replace(name, 'PN'), { lowerOk });
	const raw = s.split(/\s+/);
	const words = raw.map((w) => w.replace(/^[("'“]+|[)"'”,.;?!]+$/g, ''));
	if (!lowerOk && /^[a-z]/.test(raw[0] ?? '') && !LOWER_START.has(raw[0]))
		return 'starts lower case';
	const caps = words.slice(1).filter((w) => /^[A-Z]/.test(w) && !allowedWord(w));
	if (caps.length) return `capitalised: ${caps.join(', ')}`;
	// After a hyphen too: "Y-Axis", "Z-Score" (an acronym part, "Q-Q", is fine).
	const hyph = words.filter((w) =>
		w
			.split('-')
			.slice(1)
			.some((p) => /^[A-Z][a-z]/.test(p))
	);
	return hyph.length ? `capitalised after a hyphen: ${hyph.join(', ')}` : null;
}

/** Every static label in the app: `{ file, label, lowerOk }`. */
export function collectLabels() {
	const out = [];
	for (const f of sourceFiles()) {
		const text = stripComments(readFileSync(f, 'utf8'));
		const file = relative(srcRoot, f);
		const svelte = f.endsWith('.svelte');
		const push = (label, lowerOk = false) => {
			// A leading "+ " (Add buttons), "×" or "‹" is a symbol, not the first word.
			const l = label.trim().replace(/^[+×✕‹]\s+/, '');
			if (l) out.push({ file, label: l, lowerOk });
		};
		const shapes = SHAPES.filter((s) => svelte || s.js);
		if (svelte && /<Modal\b/.test(text)) shapes.push(MODAL_HEADINGS);
		if (SECTION_TITLE_FILES.has(basename(f))) shapes.push(TITLE_DEFAULT);
		for (const { re, lit, lowerOk } of shapes)
			for (const m of text.matchAll(re))
				for (const l of lit ? literals(m[1]) : [m[1]]) push(l, lowerOk);
		for (const l of labelTableValues(text)) push(l, true);
	}
	return out;
}

const problem = ({ label, lowerOk }) => labelProblem(label, { lowerOk });

describe('panel labels are sentence case with no colon (UI-22)', () => {
	const labels = collectLabels();

	it('finds the labels', () => {
		expect(labels.length).toBeGreaterThan(300);
	});

	it('every label follows the rule (or is a known offender)', () => {
		const bad = labels
			.filter(problem)
			.filter(({ file, label }) => !(KNOWN_OFFENDERS[file] ?? []).includes(label))
			.map((x) => `${x.file}: "${x.label}" (${problem(x)})`);
		expect(bad).toEqual([]);
	});

	it('KNOWN_OFFENDERS only shrinks: every entry still breaks the rule', () => {
		const stale = Object.entries(KNOWN_OFFENDERS).flatMap(([file, list]) =>
			list.filter((l) => !labels.some((x) => x.file === file && x.label === l && problem(x)))
		);
		expect(stale).toEqual([]);
	});

	it('every PROPER_NOUNS and LOWER_START entry is still used by a label', () => {
		const used = (w) => labels.some(({ label }) => label.includes(w));
		const firsts = new Set(labels.map(({ label }) => label.split(/\s+/)[0]));
		expect([...PROPER_NOUNS].filter((w) => !used(w))).toEqual([]);
		expect([...LOWER_START].filter((w) => !firsts.has(w))).toEqual([]);
	});

	it('the rule itself', () => {
		expect(labelProblem('Log scale')).toBeNull();
		expect(labelProblem('Log Scale')).toMatch(/capitalised/);
		expect(labelProblem('Render as:')).toMatch(/colon/);
		expect(labelProblem('Y-axis (magnitude)')).toBeNull();
		expect(labelProblem('Left Y-axis')).toBeNull();
		expect(labelProblem('Y-Axis')).toMatch(/hyphen/);
		expect(labelProblem('Q-Q plot')).toBeNull();
		expect(labelProblem('Peak period (h)')).toBeNull();
		expect(labelProblem('IQR multiplier')).toBeNull();
		expect(labelProblem('position')).toMatch(/lower case/);
		expect(labelProblem('x (time)')).toBeNull();
		expect(labelProblem('Confirm Import')).toMatch(/capitalised: Import/);
		expect(labelProblem('Peak period')).toBeNull();
		expect(labelProblem('Std Dev')).toMatch(/capitalised: Dev/);
		expect(labelProblem('Welch T-test')).toMatch(/T-test/);
		expect(labelProblem('Kruskal-Wallis (+ pairwise Mann-Whitney)')).toBeNull();
		expect(labelProblem('Significant (1 = yes, Holm-adjusted)')).toBeNull();
		expect(labelProblem('Nonparametric (IS/IV/RA)')).toBeNull();
		expect(labelProblem('Z-Score')).toMatch(/hyphen/);
		// Option text and table values may be a fragment read inside a sentence.
		expect(labelProblem('single values', { lowerOk: true })).toBeNull();
		expect(labelProblem('single Values', { lowerOk: true })).toMatch(/capitalised/);
	});

	it('scans the shapes that held Title Case labels before v82.33', () => {
		const has = (file, label) => labels.some((x) => x.file.endsWith(file) && x.label === label);
		// button text from an expression, option text, `label:` values, readouts, Line titles,
		// optionsDisplay arrays, *Display consts and _LABELS tables.
		expect(has('ImportData.svelte', 'Confirm import')).toBe(true);
		expect(has('BinnedData.svelte', 'Std dev')).toBe(true);
		expect(has('ColumnFunctions.svelte', 'Std dev')).toBe(true);
		expect(has('Periodogram.svelte', 'Peak period')).toBe(true);
		expect(has('Correlogram.svelte', 'Confidence bounds')).toBe(true);
		expect(has('SmoothedData.svelte', 'Moving average')).toBe(true);
		expect(has('OutlierRemoval.svelte', 'Z-score')).toBe(true);
		expect(has('Legend.svelte', 'Top right')).toBe(true);
		expect(has('core/outputLabels.js', 'Peak period (h)')).toBe(true);
		expect(has('JoinData.svelte', 'Add Bin Data')).toBe(true);
		expect(has('ControlDisplay.svelte', 'Control panel')).toBe(true);
	});
});
