// @ts-nocheck
// Guard: the columns a plot series reads are listed in ONE place, core/seriesChannelRefs.js.
//
// The list used to be hand-written in six places plus the Table picker, the node catalogue,
// the facet panels and the MCP session, and the copies drifted (column delete knew x/y/z but
// not `column`, so deleting any column emptied every Histogram). A new channel (colour by,
// size by) must reach every reader, which only works while there is one list. This test
// fails when a hand-written list comes back in app source (src/lib, src/routes, mcp/src;
// tests excluded, they may build series by hand).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const SCAN = ['src/lib', 'src/routes', 'mcp/src'];
const HELPER = 'src/lib/core/seriesChannelRefs.js';

// What a hand-written channel list looks like.
const PATTERNS = [
	// The vestigial z field, read by hand.
	{ name: 'z channel read', re: /\.z\??\.refId/ },
	// A literal list of series fields: ['x', 'y', 'z' ...], ['x', 'y', 'column' ...], 'z', 'column'.
	{ name: 'field list with z', re: /\[\s*['"]x['"]\s*,\s*['"]y['"]\s*,\s*['"]z['"]/ },
	{ name: 'field list with column', re: /\[\s*['"]x['"]\s*,\s*['"]y['"]\s*,\s*['"]column['"]/ },
	{ name: 'z and column listed', re: /['"]z['"]\s*,\s*['"]column['"]/ },
	// Two channels compared to one column in one expression (`dp?.x?.refId === id ||
	// dp?.y?.refId === id ...`): a membership test that must ask seriesReadsColumn.
	{
		name: 'channel-by-channel membership test',
		re: /\.x\??\.refId\s*===\s*[\w.]+\s*\|\|\s*[\w?.]*\.y\??\.refId\s*===/
	}
];

function sourceFiles(dir) {
	const out = [];
	for (const name of readdirSync(dir)) {
		if (name === 'node_modules' || name.includes('[conflicted]')) continue;
		const full = join(dir, name);
		if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
		else if (/\.(js|svelte)$/.test(name) && !/\.test\.js$/.test(name)) out.push(full);
	}
	return out;
}

function offenders(text) {
	// Comments may name the old fields when they explain history; only code counts.
	const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
	return PATTERNS.filter((p) => p.re.test(code)).map((p) => p.name);
}

describe('one list of series column channels', () => {
	it('the patterns catch the hand-written lists this replaced', () => {
		// The shapes that were in the code before v82.35 (one per old site).
		const old = [
			"for (const axis of ['x', 'y', 'z', 'column']) {",
			"['x', 'y', 'z'].forEach((axis) => {",
			"for (const field of ['x', 'y', 'column', 'time', 'values']) {",
			'if (dp?.z?.refId === columnId) dp.z.refId = -1;',
			'dp?.x?.refId === entry.colId ||\n\t\t\t\t\tdp?.y?.refId === entry.colId ||',
			"addPassthrough(dp?.z?.refId, 'z', seriesN, 'y');",
			'.flatMap((d) => [d.x?.refId, d.y?.refId, d.z?.refId])'
		];
		for (const line of old) expect(offenders(line), line).not.toEqual([]);
		// And leave ordinary single-channel reads alone.
		expect(offenders('const xRef = dp?.x?.refId ?? -1;')).toEqual([]);
		expect(offenders('const ref = parent?.y?.refId ?? parent?.column?.refId ?? null;')).toEqual([]);
		expect(offenders("// the old list was ['x', 'y', 'z', 'column']")).toEqual([]);
	});

	it('no app source outside the helper spells the list by hand', () => {
		const found = [];
		for (const dir of SCAN) {
			for (const file of sourceFiles(join(ROOT, dir))) {
				const rel = relative(ROOT, file);
				if (rel === HELPER) continue;
				const hits = offenders(readFileSync(file, 'utf8'));
				if (hits.length) found.push(`${rel}: ${hits.join(', ')}`);
			}
		}
		expect(found).toEqual([]);
	});
});
