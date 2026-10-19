#!/usr/bin/env node
// Prose guard: the handbook source must contain no em-dashes.
//
// WHY THIS EXISTS
//
// The house style for AnCiR's writing is no em-dashes: a sentence that wants one
// is rewritten with a full stop, a semicolon, parentheses or a plain hyphen. In
// October 2026 the handbook still carried over 300 of them, added a few at a time
// by many hands, because nothing checked. This script is that check. It runs
// before every handbook build (see package.json), so a release cannot ship one.
//
// WHAT IT CHECKS
//
// Every text file under src/ and scripts/ (Svelte, JS, JSON, CSS, HTML), for the
// em-dash character itself and for the HTML entities that render as one (the
// named entity mdash and the numeric 8212 / x2014 forms). A JavaScript escape such
// as \u2014 inside a regular expression is code, not prose (it never renders), so
// it is allowed. This file spells the entities in pieces so it passes itself.
//
// Two files are excluded because nothing imports them (GenericSection.svelte and
// the sections_data.json it reads are the pre-Svelte chapter markup). The
// exclusion is only valid while that is true: if any other source file starts
// referring to one of them, this script fails and asks for it to be cleaned up.
//
// Usage:  node scripts/check-prose.mjs   (alias: pnpm --filter chronobiology-handbook check:prose)
// Exits 1 on any finding, else 0.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, relative, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = ['src', 'scripts'];
const TEXT_EXT = new Set(['.svelte', '.js', '.mjs', '.cjs', '.json', '.css', '.html', '.md']);
const AMP = '&';
const EM_DASH = new RegExp(`\\u2014|${AMP}mdash;|${AMP}#8212;|${AMP}#x2014;`, 'gi');

/** Unreferenced legacy files, with the reason they are allowed to keep old wording. */
const UNREFERENCED = {
	'src/lib/sections/GenericSection.svelte': 'legacy renderer for sections_data.json; not imported',
	'src/lib/sections_data.json': 'legacy chapter markup; read only by GenericSection.svelte'
};

function walk(dir, out = []) {
	for (const name of readdirSync(dir)) {
		// pCloud sync conflict copies are never source.
		if (name.includes('[conflicted]')) continue;
		const full = resolve(dir, name);
		if (statSync(full).isDirectory()) walk(full, out);
		else if (TEXT_EXT.has(extname(name))) out.push(full);
	}
	return out;
}

const files = SCAN_DIRS.flatMap((d) => walk(resolve(ROOT, d)));
const rel = (f) => relative(ROOT, f).split('\\').join('/');
const problems = [];

for (const file of files) {
	const r = rel(file);
	if (r in UNREFERENCED) continue;
	const lines = readFileSync(file, 'utf8').split('\n');
	lines.forEach((line, i) => {
		const hits = line.match(EM_DASH);
		if (hits)
			problems.push(`${r}:${i + 1}: em-dash (${hits.join(', ')}): ${line.trim().slice(0, 120)}`);
	});
}

// The exclusions hold only while the files stay unreferenced.
for (const excluded of Object.keys(UNREFERENCED)) {
	const name = basename(excluded);
	const stem = name.replace(/\.[^.]+$/, '');
	for (const file of files) {
		const r = rel(file);
		if (r === excluded || r in UNREFERENCED || r === 'scripts/check-prose.mjs') continue;
		const text = readFileSync(file, 'utf8');
		if (text.includes(name) || new RegExp(`/${stem}['"]`).test(text)) {
			problems.push(
				`${r} refers to ${excluded}, which this guard skips as unreferenced. Remove its em-dashes and drop it from UNREFERENCED in scripts/check-prose.mjs.`
			);
		}
	}
}

if (problems.length) {
	console.error(`Handbook prose check failed (${problems.length}):`);
	for (const p of problems) console.error('  ' + p);
	console.error(
		'Rewrite each sentence without the em-dash: a new sentence, a semicolon, parentheses or a plain hyphen.'
	);
	process.exit(1);
}
console.log(`Handbook prose check passed: no em-dashes in ${files.length} source files.`);
