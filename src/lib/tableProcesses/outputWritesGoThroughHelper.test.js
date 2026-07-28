// Output columns must be written through writeOutputColumn, never by assigning
// into core.rawData directly.
//
// WHY THIS EXISTS
//
// writeOutputColumn is the one place that knows whether a write actually changes
// anything. It compares the data and skips a no-op write, which is what stops a
// node that recomputed and produced identical output from stamping a fresh
// crypto.randomUUID() on its columns and invalidating the entire chain below it.
// A direct `core.rawData.set(...)` bypasses that comparison, so any node still
// doing it re-triggers everything downstream on every single run.
//
// It is also the only place that gets the reactive bookkeeping right. A bare
// `core.rawData.set(id, [])` looks like it clears a column, but getDataHash does
// not read rawData: the hash is unchanged, Column.getData() keeps returning its
// cached array, and consumers carry on using the old values. FormulaColumn's
// clear-on-invalid path did exactly this and silently did nothing.
//
// A direct write is therefore either a missing invalidation or a spurious one.
// Neither is ever what you want, so this is a blanket ban with named exemptions.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Files allowed to write core.rawData directly, each with its reason. Adding an
 * entry should be a deliberate decision, not a way to quiet the test.
 */
const ALLOWED = {
	// (none — every table process writes through the helper)
};

/** Strip comments so prose describing a direct write is not mistaken for one. */
function stripComments(src) {
	return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const files = readdirSync(here)
	.filter((f) => f.endsWith('.svelte'))
	.map((f) => ({ name: f, src: stripComments(readFileSync(join(here, f), 'utf8')) }));

describe('table processes write output columns through the shared helper', () => {
	it('found the node files to check', () => {
		// Guard against the reader going blind and every assertion below passing
		// vacuously, which is how an earlier audit in this area reported success
		// while matching nothing at all.
		expect(files.length).toBeGreaterThan(30);
	});

	it('no node assigns into core.rawData directly', () => {
		const offenders = files
			.filter(({ name }) => !ALLOWED[name])
			.filter(({ src }) => /\b(?:core|coreState)\.rawData\.set\(/.test(src))
			.map(({ name }) => name);
		expect(
			offenders,
			`these nodes write core.rawData directly instead of calling writeOutputColumn: ` +
				`${offenders.join(', ')}. A direct write skips the "did anything actually change?" ` +
				`comparison, so identical output still invalidates everything downstream — and a ` +
				`direct write with no hash stamp does not invalidate anything at all.`
		).toEqual([]);
	});

	it('every exemption names a file that exists', () => {
		const known = new Set(files.map((f) => f.name));
		const stale = Object.keys(ALLOWED).filter((f) => !known.has(f));
		expect(stale, `exemptions for files that no longer exist: ${stale}`).toEqual([]);
	});

	it('a node that calls the helper imports it', () => {
		// A missing import is a runtime ReferenceError on a path that may only run
		// for a wired output column, so it can survive a green unit run.
		const broken = files
			.filter(({ src }) => /\bwriteOutputColumn\(/.test(src))
			.filter(({ src }) => !/import\s*\{[^}]*writeOutputColumn[^}]*\}/.test(src))
			.map(({ name }) => name);
		expect(broken, `call writeOutputColumn without importing it: ${broken.join(', ')}`).toEqual([]);
	});
});
