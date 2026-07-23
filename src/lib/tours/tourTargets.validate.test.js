import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Tours point at the UI by CSS selector, so removing a component silently breaks them: the ring
// simply lands nowhere and the step is unfollowable. That has now happened twice — `.add-data-cta`
// and `.add-data-menu` were left behind in two tours when the canvas "add data" prompt was
// removed. This walks every literal selector a tour uses and checks the UI still defines it.
const TOURS = join(process.cwd(), 'src', 'lib', 'tours');
const SRC = join(process.cwd(), 'src');

function walk(dir, out = []) {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, e.name);
		if (e.isDirectory()) walk(p, out);
		else if (/\.(svelte|js)$/.test(e.name) && !/\.test\.js$/.test(e.name)) out.push(p);
	}
	return out;
}
const allFiles = walk(SRC).filter((f) => !f.includes(`${'tours'}`));
const allText = allFiles.map((f) => readFileSync(f, 'utf8')).join('\n');

/**
 * Only components something actually IMPORTS count as "the UI". A file left on disk but wired to
 * nothing defines no live selector, and counting it is what made the first version of this test
 * useless: `AddDataPrompt.svelte` was unreferenced but still present, so the dead `.add-data-cta`
 * selector it declares looked alive. Routes are entry points and always count.
 */
const isLive = (file) => {
	const base = file.split('/').pop();
	if (/^\+(page|layout)\.svelte$/.test(base)) return true;
	const name = base.replace(/\.(svelte|js)$/, '');
	return new RegExp(`import\\s+[^;]*from\\s+['"\`][^'"\`]*${name}(\\.svelte|\\.js)?['"\`]`).test(allText);
};
const uiSource = allFiles
	.filter(isLive)
	.map((f) => readFileSync(f, 'utf8'))
	.join('\n');

const tourFiles = readdirSync(TOURS).filter((f) => f.endsWith('.js') && !f.includes('.test.'));

/** Literal class selectors (`.foo`, `.foo-bar`) and [data-tour="x"] hooks used in a tour. */
function selectorsIn(src) {
	const found = new Set();
	for (const m of src.matchAll(/['"`](\.[a-z][a-z0-9-]*(?:\s*\.[a-z][a-z0-9-]*)*)['"`]/gi)) {
		for (const cls of m[1].split(/\s+/)) found.add(cls);
	}
	for (const m of src.matchAll(/\[data-tour=['"]([a-z0-9-]+)['"]\]/gi)) found.add(`[data-tour=${m[1]}]`);
	return [...found];
}

describe('tour targets still exist in the UI', () => {
	it('finds the tour files', () => {
		expect(tourFiles.length).toBeGreaterThan(3);
	});

	it.each(tourFiles)('%s points only at selectors the UI defines', (file) => {
		const selectors = selectorsIn(readFileSync(join(TOURS, file), 'utf8'));
		const dead = selectors.filter((sel) => {
			if (sel.startsWith('[data-tour=')) {
				const name = sel.slice('[data-tour='.length, -1);
				return !uiSource.includes(`data-tour="${name}"`);
			}
			// A class is "defined" if it is used as a class anywhere in the app source.
			const cls = sel.slice(1);
			return !new RegExp(`class(?:Name)?=["'\`][^"'\`]*\\b${cls}\\b`).test(uiSource) &&
				!uiSource.includes(`class:${cls}`);
		});
		expect(dead).toEqual([]);
	});
});
