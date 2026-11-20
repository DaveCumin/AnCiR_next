// @vitest-environment happy-dom
//
// Direct links to a handbook section work (handbook.html#ch13, as well as the #/#ch13 that a
// click on a contents card produces). The handbook uses SvelteKit's hash router, which reads the
// whole hash as the route, so a bare "#ch13" asked for a page called "ch13" and showed a 404.
// handbook/src/app.html rewrites a bare section hash to "#/#<id>" before the router starts, and
// again on a later hashchange. This runs that inline script against a stubbed location, from
// the root suite because the handbook package has no test runner of its own (like
// handbookAccessibility.test.js).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const appHtml = readFileSync(join(here, '..', '..', '..', 'handbook', 'src', 'app.html'), 'utf8');

/** The inline script(s) in app.html, without the <script> tags. */
const inlineScripts = [...appHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

const listeners = [];
function run(hash) {
	history.replaceState(null, '', `/handbook.html${hash}`);
	const add = window.addEventListener.bind(window);
	window.addEventListener = (type, fn, opts) => {
		listeners.push([type, fn, opts]);
		add(type, fn, opts);
	};
	try {
		for (const code of inlineScripts) new Function(code)();
	} finally {
		window.addEventListener = add;
	}
	return location.hash;
}

describe('handbook deep links (app.html)', () => {
	beforeEach(() => {
		document.body.innerHTML = '<section id="ch13"></section><section id="ch7"></section>';
	});
	afterEach(() => {
		for (const [type, fn, opts] of listeners.splice(0)) window.removeEventListener(type, fn, opts);
	});

	it('has exactly one inline boot script (the deep-link rewrite)', () => {
		expect(inlineScripts).toHaveLength(1);
	});

	it('rewrites a bare section hash to the router form before the router starts', () => {
		expect(run('#ch13')).toBe('#/#ch13');
		expect(location.pathname).toBe('/handbook.html');
		expect(run('#node-reference')).toBe('#/#node-reference');
	});

	it('leaves router hashes, an empty hash and non-section hashes alone', () => {
		expect(run('#/#ch13')).toBe('#/#ch13');
		expect(run('#/')).toBe('#/');
		expect(run('')).toBe('');
		expect(run('#1abc')).toBe('#1abc');
		expect(run('#a b')).toBe('#a%20b');
	});

	it('rewrites a bare hash that arrives later (a typed or pasted link)', () => {
		run('#/');
		history.replaceState(null, '', '/handbook.html#ch7');
		window.dispatchEvent(new HashChangeEvent('hashchange'));
		expect(location.hash).toBe('#/#ch7');
	});
});
