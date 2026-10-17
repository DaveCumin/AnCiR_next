// Panel labels are sentence case with no trailing colon (UI-22, 2026-10-03 review).
//
// The panels said "Log Scale" beside "Log scale", "Render as:" beside "Colormap", "Y-Axis"
// beside "Y-axis", often in one panel. The rule, for every static label in a control panel, a
// node panel or a dialog: the first word starts with a capital, later words are lower case
// unless they are an acronym (FFT, RMSE, R², DPI), a single letter (X, Y, N), an axis
// ("Y-axis") or a proper name in PROPER_NOUNS; and no label ends with a colon. A few labels are
// symbols and start lower case on purpose (x, y, k1, alpha); they are in LOWER_START.
//
// Only label SHAPES are scanned (prose and tooltips are sentences anyway):
//   <ControlInput label="...">, <Axis title="...">, <span class="ci-label">...</span>,
//   <summary>...</summary>, the <p> that opens a .control-input / section title, a node's
//   .tableProcess-label, and the <h2>/<h3> of a file that renders a <Modal>.
// Comments are stripped first. PROPER_NOUNS and LOWER_START must each still be used (a stale
// entry fails), and KNOWN_OFFENDERS (labels in files this change could not touch) only shrinks.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, '..', '..'); // src/

function svelteFiles(dir = srcRoot, out = []) {
	for (const entry of readdirSync(dir)) {
		if (entry === 'node_modules' || entry.startsWith('.')) continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) svelteFiles(full, out);
		else if (entry.endsWith('.svelte') && !entry.includes('conflicted')) out.push(full);
	}
	return out;
}

const stripComments = (text) => text.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));

const SHAPES = [
	/<ControlInput\b[^>]*?\blabel="([^"{}]+)"/g,
	/<Axis\b[^>]*?\btitle="([^"{}]+)"/g,
	/class="ci-label"[^>]*>\s*([^<{}]+?)\s*</g,
	/<summary\b[^>]*>\s*([^<{}]+?)\s*<\/summary>/g,
	/class="control-input[^"]*"[^>]*>\s*<p>\s*([^<{}]+?)\s*<\/p>/g,
	/class="(?:control-component-title|control-data-title)[^"]*"[^>]*>\s*(?:<div[^>]*>\s*)?(?:<span[^>]*>[\s\S]*?<\/span>\s*)?<p>\s*([^<{}]+?)\s*<\/p>/g,
	/class="tableProcess-label"[^>]*>\s*<span>\s*([^<{}]+?)\s*<\/span>/g,
	/<label\b[^>]*>\s*<input[^>]*>\s*<span(?![^>]*class="unit")[^>]*>\s*([^<{}]+?)\s*<\/span>/g
];
const MODAL_HEADINGS = /<h[23]\b[^>]*>\s*([^<{}]+?)\s*<\/h[23]>/g;

/** Proper names and fixed terms that keep their capitals inside a label. */
export const PROPER_NOUNS = new Set(['Watson-Williams']);

/** Labels that are symbols, written lower case on purpose. */
export const LOWER_START = new Set(['x', 'y', 'k1', 'k2', 'alpha', 'p-values', 'random()']);

/** file (relative to src/) -> labels there that break the rule; shrink-only. */
const KNOWN_OFFENDERS = {};

const ACRONYM = /^[A-Z][A-Z0-9²]+s?$/;
const allowedWord = (w) =>
	ACRONYM.test(w) || /^[A-Z]$/.test(w) || /\d/.test(w) || /^[XY]-axis$/.test(w);

/** Why `label` breaks the rule, or null. */
export function labelProblem(label) {
	const s = label.trim();
	if (/:$/.test(s)) return 'ends with a colon';
	for (const name of PROPER_NOUNS) if (s.includes(name)) return labelProblem(s.replace(name, 'P'));
	const raw = s.split(/\s+/);
	const words = raw.map((w) => w.replace(/^[("'“]+|[)"'”,.;?!]+$/g, ''));
	if (/^[a-z]/.test(raw[0] ?? '') && !LOWER_START.has(raw[0])) return 'starts lower case';
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

/** Every static label in the app: `{ file, label }`. */
export function collectLabels() {
	const out = [];
	for (const f of svelteFiles()) {
		const text = stripComments(readFileSync(f, 'utf8'));
		const file = relative(srcRoot, f);
		const shapes = /<Modal\b/.test(text) ? [...SHAPES, MODAL_HEADINGS] : SHAPES;
		for (const re of shapes)
			for (const m of text.matchAll(re)) out.push({ file, label: m[1].trim() });
	}
	return out;
}

describe('panel labels are sentence case with no colon (UI-22)', () => {
	const labels = collectLabels();

	it('finds the labels', () => {
		expect(labels.length).toBeGreaterThan(300);
	});

	it('every label follows the rule (or is a known offender)', () => {
		const bad = labels
			.filter(({ label }) => labelProblem(label))
			.filter(({ file, label }) => !(KNOWN_OFFENDERS[file] ?? []).includes(label))
			.map(({ file, label }) => `${file}: "${label}" (${labelProblem(label)})`);
		expect(bad).toEqual([]);
	});

	it('KNOWN_OFFENDERS only shrinks: every entry still breaks the rule', () => {
		const stale = Object.entries(KNOWN_OFFENDERS).flatMap(([file, list]) =>
			list.filter((l) => !labels.some((x) => x.file === file && x.label === l && labelProblem(l)))
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
	});
});
