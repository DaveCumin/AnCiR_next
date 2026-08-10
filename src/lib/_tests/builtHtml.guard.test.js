// Guards the BUILT build/index.html against a broken src/app.html template.
//
// SvelteKit substitutes the app template with String.replace('%sveltekit.head%', head),
// which replaces only the FIRST occurrence. In v72.17 an explanatory comment in
// src/app.html happened to contain the literal placeholder token in its TEXT, so the
// entire document head was injected INSIDE that comment: the real head tags were
// swallowed (page rendered unstyled, no console errors) and the genuine placeholder
// further down survived as literal text, visible on screen. 3378 unit tests stayed
// green because nothing in the suite ever looks at the built HTML.
//
// If this fails: check src/app.html for a stray `%sveltekit.*%` token inside a comment
// or attribute, fix it, and rebuild.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Vitest runs with the project root as cwd.
const BUILT_HTML = resolve(process.cwd(), 'build/index.html');

const hasBuild = existsSync(BUILT_HTML);
const describeBuilt = hasBuild ? describe : describe.skip;

if (!hasBuild) {
	// Fresh clones / CI jobs that never run `npm run build` must not be blocked.
	console.info(
		`[builtHtml.guard] skipped: ${BUILT_HTML} does not exist (run \`npm run build\` to enable this guard).`
	);
}

// Tags SvelteKit injects at the head placeholder. None of these is ever legitimately
// commented out (app.html DOES carry a commented-out `<link rel="icon">` example, which
// is why this list is specific rather than a blanket `<link`).
const INJECTED_HEAD_TAGS = ['<style', '<link rel="stylesheet"', '<link rel="modulepreload"'];

/** Returns the injected head tags that are sitting inside an HTML comment. */
export function headTagsInsideComments(source) {
	const swallowed = [];
	let cursor = 0;
	for (;;) {
		const open = source.indexOf('<!--', cursor);
		if (open === -1) break;
		const close = source.indexOf('-->', open + 4);
		const region = source.slice(open, close === -1 ? source.length : close + 3);
		for (const tag of INJECTED_HEAD_TAGS) {
			if (region.includes(tag)) swallowed.push(tag);
		}
		if (close === -1) break;
		cursor = close + 3;
	}
	return swallowed;
}

/** Returns any `%sveltekit.*%` template token left unsubstituted. */
export function strayTemplateTokens(source) {
	return source.match(/%sveltekit\.[a-z.]*%?/g) ?? [];
}

// These run everywhere, build or no build, so the detection logic itself can never
// rot into a vacuous pass. The fixture reproduces the v72.17 failure exactly.
describe('broken-template detection (fixture)', () => {
	const BROKEN = [
		'<head>',
		'<!-- the placeholder %sveltekit' + '.head% is empty in the shipped file',
		'<style>:root{--x:1}</style><link rel="stylesheet" href="/a.css"> -->',
		'<title>x</title>',
		'%sveltekit' + '.head%',
		'</head>'
	].join('\n');

	it('flags injected head tags swallowed by a comment', () => {
		expect(headTagsInsideComments(BROKEN)).toContain('<style');
	});

	it('flags the surviving literal template token', () => {
		expect(strayTemplateTokens(BROKEN).length).toBeGreaterThan(0);
	});
});

describeBuilt('built build/index.html', () => {
	const html = () => readFileSync(BUILT_HTML, 'utf8');

	it('contains no unsubstituted %sveltekit.* template token', () => {
		// Any surviving token means the placeholder SvelteKit meant to replace was not
		// the one it found first — i.e. the template contains a duplicate/literal token.
		expect(strayTemplateTokens(html())).toEqual([]);
	});

	it('has balanced HTML comments', () => {
		const source = html();
		const opens = source.split('<!--').length - 1;
		const closes = source.split('-->').length - 1;
		expect({ opens, closes }).toEqual({ opens: closes, closes });
	});

	it('does not hide injected <style>/<link> tags inside an HTML comment', () => {
		expect(headTagsInsideComments(html())).toEqual([]);
	});
});
