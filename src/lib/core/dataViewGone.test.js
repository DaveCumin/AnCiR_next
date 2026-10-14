// A guard that the Data View plot stays gone.
//
// Until v81.16 a `dataview` plot showed a plot's computed data ("View data") or a node's result
// table ("View stats", "View permutations"), spawned by `showDataAsTable` /
// `showStaticDataAsTable` and drawn by plots/DataView. A Table does both jobs now
// (plots/Tableplot/tableSource.js; plan 2026-10-15 "fold Data View into Table"), and v82.0
// deleted the type. The only code allowed to know it is the one-way session migration, which
// READS `type: 'dataview'` off old JSON, plus its tests and the legacy fixtures.
//
// The `dataview` ICON is not the plot type and stays (Table draws with it), so the guard looks
// for the type in the places a plot type is used (a `type` comparison or key, a registry
// lookup) and for the deleted names, not for the bare word. Shrink-only, like
// facetChildModelGone.test.js: ALLOWED only ever loses entries.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, '..', '..'); // src/

const LEGACY = [
	// The type as a plot type: `type: 'dataview'`, `type === 'dataview'`, `"type": "dataview"`.
	/\btype["']?\s*(?:[!=]==?|:)\s*["']dataview["']/,
	// A registry lookup by the type.
	/plotMap\??\.(?:get|has|set)\(\s*["']dataview["']/,
	// Deleted names.
	/\bshowStaticDataAsTable\b/,
	/\bDataViewclass\b/,
	/\bDataView_(?:displayName|defaultDataInputs|controlHeaders)\b/,
	/plots\/DataView\//
];

/**
 * Files (relative to src/) that may name the legacy type, each with its reason. Nothing else.
 */
const ALLOWED = {
	'lib/core/dataViewMigration.js': "reads type 'dataview' off legacy session JSON (one way)",
	'lib/core/dataViewMigration.test.js': 'builds legacy JSON to drive the migration',
	'lib/core/nodeClipboard.pastePlot.svelte.test.js':
		'pastes a Data View copied in an older tab, which clearPlotInputs migrates',
	'lib/components/workflow/paletteHiddenPlots.svelte.test.js':
		'asserts the registry no longer has the type',
	'test/fixtures/dataview-legacy-handmade.json': 'legacy session with Data Views (hand-made)',
	'test/fixtures/dataview-v81.16-saved.json': 'legacy session with Data Views (saved by v81.16)',
	// This guard names every legacy identifier by construction.
	'lib/core/dataViewGone.test.js': 'the guard itself'
};

// Walked rather than globbed, like the other guards.
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

const hits = (text) => LEGACY.filter((re) => re.test(text));

// Same reasoning as facetChildModelGone.test.js: the walk is disk-bound and can pass the
// default limit in a loaded parallel run.
const GUARD_TIMEOUT_MS = 30_000;

describe('the Data View plot stays gone', { timeout: GUARD_TIMEOUT_MS }, () => {
	it('finds source files to scan (guards against the walk matching nothing)', () => {
		expect(sourceFiles().length).toBeGreaterThan(200);
	});

	it('no file under src/ uses the dataview plot type, except the migration, its tests and the fixtures', () => {
		const offenders = [];
		for (const file of sourceFiles()) {
			const rel = relative(srcRoot, file);
			if (ALLOWED[rel]) continue;
			const text = readFileSync(file, 'utf8');
			if (hits(text).length === 0) continue;
			text.split('\n').forEach((line, i) => {
				if (hits(line).length) offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
			});
		}
		expect(
			offenders,
			'These files use the Data View plot type, which was removed in v82.0. A Table shows a\n' +
				"plot's computed data or a node's results (plots/Tableplot/tableSource.js). Only the\n" +
				'migration (core/dataViewMigration.js) may read the legacy type, and only off session JSON.\n\n' +
				offenders.join('\n')
		).toEqual([]);
	});

	it('the allow list only ever shrinks: every entry still names the legacy type', () => {
		const stale = [];
		for (const rel of Object.keys(ALLOWED)) {
			const text = readFileSync(resolve(srcRoot, rel), 'utf8');
			if (hits(text).length === 0) stale.push(rel);
		}
		expect(
			stale,
			'Stale ALLOWED entries: these files no longer name the legacy type, so delete them\n' +
				'from the list.\n\n' +
				stale.join('\n')
		).toEqual([]);
	});
});
