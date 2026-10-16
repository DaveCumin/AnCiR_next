// Hours are written "h" in every label (UI-10).
//
// The app used to say "hrs", "hr", "hours" and "h" for the same unit, often in one panel:
// "Bin size (hrs)" beside "Bin start (hr)", an axis titled "Period (hours)" over a peak read
// "24.00 hrs", "cycles/hr" next to "Period (h)". The rule: a unit in a label, a unit suffix after
// a value, an axis title or a placeholder is "h" (and per hour is "/h"). Prose sentences may still
// say "hours" where it reads naturally, so the guard only looks for the label SHAPES:
//
//   " (hrs)", " (hr)", " (hours)", " (hrs; ...)"   a parenthesised unit after a word
//   "{value} hrs", "24 hr"                          a unit suffix after a value
//   "cycles/hr", "per hr"                           a rate
//   'hrs' / "hr" as a quoted string                 a unit key shown in a select
//
// Comments are stripped first, and a call like `wrap(hrs)` is not a label (no space before the
// parenthesis). EXPORT_HEADERS is not a ratchet: those are column headers of the CSV a plot
// downloads, a file contract the Python export mirrors (tools/test_plot_data_export.py), so they
// keep their spelling on purpose. KNOWN_OFFENDERS is a ratchet and only ever shrinks.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, '..', '..'); // src/

function sourceFiles(dir = srcRoot, out = []) {
	for (const entry of readdirSync(dir)) {
		if (entry === 'node_modules' || entry.startsWith('.')) continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			sourceFiles(full, out);
			continue;
		}
		if (!/\.(svelte|js)$/.test(entry)) continue;
		if (entry.includes('.test.') || entry.includes('.spec.') || entry.includes('conflicted'))
			continue;
		out.push(full);
	}
	return out;
}

/** Blank out comments, keeping line numbers. A `//` only starts a comment after whitespace or
 *  at line start, so a URL inside a string ('https://...') is kept. */
export function stripComments(text) {
	const blank = (m) => m.replace(/[^\n]/g, ' ');
	return text
		.replace(/<!--[\s\S]*?-->/g, blank)
		.replace(/\/\*[\s\S]*?\*\//g, blank)
		.replace(/(^|[ \t])\/\/[^\n]*/gm, (m, lead) => lead + ' '.repeat(m.length - lead.length));
}

export const LABEL_UNIT_RULES = [
	{ name: 'parenthesised unit', re: /\s\((?:hrs?|hours?)\s*[);]/gi },
	{ name: 'value + unit', re: /(?:\}|\d)\s?hrs?\b/g },
	{ name: 'rate', re: /(?:cycles\/|per\s)hr\b/g },
	{ name: 'quoted unit key', re: /(['"`])hrs?\1/g }
];

/** Every label-unit hit in one file's text: `{ line, rule, text }`. */
export function findHourUnitLabels(text) {
	const hits = [];
	const clean = stripComments(text);
	const lines = clean.split('\n');
	lines.forEach((line, i) => {
		for (const { name, re } of LABEL_UNIT_RULES) {
			for (const m of line.matchAll(re)) hits.push({ line: i + 1, rule: name, text: m[0].trim() });
		}
	});
	return hits;
}

/** CSV download headers: a file format, not a label (see the header comment). path -> count. */
const EXPORT_HEADERS = {
	// 'BinStart (hrs)', 'BinEnd (hrs)'
	'lib/plots/Actogram/Actogram.svelte': 2,
	// 'Frequency (cycles/hr)', 'Period (hours)'
	'lib/plots/FFT/FFT.svelte': 2,
	// 'Lag (hours)'
	'lib/plots/Correlogram/Correlogram.svelte': 1,
	// 'Period (hours)'
	'lib/plots/Periodogram/Periodogram.svelte': 1,
	// The legacy auto labels a saved FFT may carry ('Period (hours)', 'Frequency (cycles/hr)'),
	// recognised so the label keeps following the mode; never drawn.
	'lib/plots/FFT/fftAxis.js': 2
};

/** Shrink-only ratchet: path -> count of label units still to convert. Empty today. */
const KNOWN_OFFENDERS = {};

const files = sourceFiles();
const hitsByFile = new Map();
for (const f of files) {
	const hits = findHourUnitLabels(readFileSync(f, 'utf8'));
	if (hits.length) hitsByFile.set(relative(srcRoot, f).split('\\').join('/'), hits);
}

describe('hour units in labels are "h" (UI-10)', () => {
	it('scans the source tree (a guard that scans nothing proves nothing)', () => {
		expect(files.length).toBeGreaterThan(300);
		expect(files.some((f) => f.endsWith('RhythmicityAnalysis.svelte'))).toBe(true);
	});

	it('the rules catch every old spelling and leave prose and code alone', () => {
		const bad = [
			'<ControlInput label="Bin size (hrs)">',
			'<p>Bin start (hr)</p>',
			"label: 'Period (hours)'",
			'label="Max lag (hrs; 0 = half range)"',
			'<strong>Peak: {p.toFixed(2)} hrs</strong>',
			'every 24 hr',
			'Frequency (cycles/hr)',
			"units={{ default: 'hrs', hrs: 1 }}"
		];
		for (const s of bad) expect(findHourUnitLabels(s), s).not.toEqual([]);
		const fine = [
			'<ControlInput label="Bin size (h)">',
			'Phases are hours after the first sample.',
			'return wrapToPeriod(hrs, periodHrs);',
			'const hrs = 24; // 24 hrs per day',
			'<!-- Period (hours) -->',
			"const url = 'https://example.org/hr'",
			"options: ['hours', 'degrees', 'radians']"
		];
		for (const s of fine) expect(findHourUnitLabels(s), s).toEqual([]);
	});

	it('no label spells hours other than "h" outside the export headers and the ratchet', () => {
		const report = [];
		for (const [file, hits] of hitsByFile) {
			const allowed = (EXPORT_HEADERS[file] ?? 0) + (KNOWN_OFFENDERS[file] ?? 0);
			if (hits.length > allowed)
				report.push(
					`${file}: ${hits.map((h) => `line ${h.line} ${h.rule} "${h.text}"`).join('; ')}`
				);
		}
		expect(report, report.join('\n')).toEqual([]);
	});

	it('the allowlists only shrink: every entry still matches exactly what is there', () => {
		const stale = [];
		for (const [file, n] of Object.entries({ ...EXPORT_HEADERS })) {
			const have = hitsByFile.get(file)?.length ?? 0;
			const want = n + (KNOWN_OFFENDERS[file] ?? 0);
			if (have < want) stale.push(`${file}: allowlisted ${want}, found ${have}; lower the entry`);
		}
		for (const [file, n] of Object.entries(KNOWN_OFFENDERS)) {
			if (file in EXPORT_HEADERS) continue;
			const have = hitsByFile.get(file)?.length ?? 0;
			if (have < n) stale.push(`${file}: ratchet ${n}, found ${have}; lower the entry`);
		}
		expect(stale, stale.join('\n')).toEqual([]);
	});
});
