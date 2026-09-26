// A guard that the facet CHILD model stays gone.
//
// Until v76.4 a faceted plot was a generator plus N real child plots in core.plots, keyed by
// `facetParent` / `facetKey` and kept in step by `syncFacetChildren` /
// `syncFacetOverlays` / `reconcileAllFacets` in Plot.svelte, with `facetSetFor` resolving a
// child's siblings for link zoom. Facets are views now (core/facetPanels.svelte.js,
// plan docs/plans/2026-09-26-facets-as-views.md, section 3), and every one of those names is
// dead. The only code allowed to know them is the one-way session migration, which READS
// the legacy fields off old JSON, plus its tests and the captured legacy fixtures.
//
// A grep guard rather than a behavioural test because the failure mode is a re-introduction
// under review ("the child had a facetParent, so I filtered on it"), which no behavioural
// test would notice. Shrink-only, modelled on listenerHygiene.guard.test.js: ALLOWED only
// ever loses entries; a new file that needs a legacy name is a regression, not a TODO.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, '..', '..'); // src/

const LEGACY_NAMES = [
	'facetParent',
	'facetKey',
	'syncFacetChildren',
	'reconcileAllFacets',
	'syncFacetOverlays',
	'facetSetFor'
];

/**
 * Files (relative to src/) that may mention a legacy name, each with its reason. The
 * migration and its tests read the legacy fields off old session JSON; the fixtures ARE
 * old session JSON, captured from v76.4 and never to be edited. Nothing else.
 */
const ALLOWED = {
	'lib/core/facetMigration.js': 'reads facetParent/facetKey off legacy session JSON (one way)',
	'lib/core/facetMigration.test.js': 'builds legacy JSON to drive the migration',
	'lib/components/iconActions/importJson.facetMigration.test.js':
		'drives the migration through the real import path with legacy JSON',
	'test/fixtures/README.md': 'documents the captured v76.4 fixtures, including their keys',
	'lib/plots/plotFromJSONRobustness.test.js':
		'asserts the wrapper IGNORES a stray legacy field on load (plan 2.4), so it must name it',
	'test/fixtures/facet-eda-children.json': 'captured v76.4 session (legacy children)',
	'test/fixtures/facet-scatter-edited-children.json': 'captured v76.4 session (legacy children)',
	'test/fixtures/facet-actogram-markers.json': 'captured v76.4 session (legacy children)',
	'test/fixtures/facet-reordered-children.json': 'captured v76.4 session (legacy children)',
	// This guard names every legacy identifier by construction.
	'lib/core/facetChildModelGone.test.js': 'the guard itself'
};

// Walked rather than globbed, like the other guards (node:fs globSync needs Node 22+, and a
// guard that silently scans nothing on an older runtime is worse than none).
function sourceFiles(dir = srcRoot, out = []) {
	for (const entry of readdirSync(dir)) {
		if (entry === 'node_modules' || entry.startsWith('.')) continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			sourceFiles(full, out);
			continue;
		}
		if (!/\.(svelte|js|ts|json|md|html)$/.test(entry)) continue;
		out.push(full);
	}
	return out;
}

const hitsIn = (text) => LEGACY_NAMES.filter((name) => text.includes(name));

describe('the facet child model stays gone', () => {
	it('finds source files to scan (guards against the walk matching nothing)', () => {
		expect(sourceFiles().length).toBeGreaterThan(200);
	});

	it('no file under src/ names a legacy identifier, except the migration, its tests and the fixtures', () => {
		const offenders = [];
		for (const file of sourceFiles()) {
			const rel = relative(srcRoot, file);
			if (ALLOWED[rel]) continue;
			const text = readFileSync(file, 'utf8');
			const hits = hitsIn(text);
			if (hits.length === 0) continue;
			text.split('\n').forEach((line, i) => {
				const names = hitsIn(line);
				if (names.length) offenders.push(`${rel}:${i + 1}  [${names.join(', ')}]  ${line.trim()}`);
			});
		}
		expect(
			offenders,
			'These files name a facet child-model identifier that was deleted in the facets-as-views\n' +
				'change. Panels are views (core/facetPanels.svelte.js): resolve them with panelsFor /\n' +
				'plotRefs, never by a parent id on a plot. Only the migration may read the legacy\n' +
				'fields, and only off session JSON.\n\n' +
				offenders.join('\n')
		).toEqual([]);
	});

	it('the allow list only ever shrinks: every entry still mentions a legacy name', () => {
		// A stale entry means a file stopped needing the exemption without giving it up, which
		// would let a later reintroduction in that file hide behind it.
		const stale = [];
		for (const rel of Object.keys(ALLOWED)) {
			const text = readFileSync(resolve(srcRoot, rel), 'utf8');
			if (hitsIn(text).length === 0) stale.push(rel);
		}
		expect(
			stale,
			'Stale ALLOWED entries: these files no longer mention a legacy name, so delete them\n' +
				'from the list.\n\n' +
				stale.join('\n')
		).toEqual([]);
	});
});
