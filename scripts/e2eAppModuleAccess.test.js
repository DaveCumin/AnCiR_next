// The e2e specs reach the app's modules ONLY through the dev-only window.__modules
// (src/lib/core/devModules.js). A page-side `import('/src/...')` loads a second copy of the
// module once Vite has hot-updated it (the app then imports it as `?t=<timestamp>`), and the
// spec reads state the app never writes: facet-migration (c) to (e) failed that way.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const E2E = join(ROOT, 'tests/e2e');
const specs = readdirSync(E2E)
	.filter((f) => f.endsWith('.js'))
	.map((f) => ({ file: f, text: readFileSync(join(E2E, f), 'utf8') }));

const devModulesSrc = readFileSync(join(ROOT, 'src/lib/core/devModules.js'), 'utf8');
const exposed = new Set(
	(devModulesSrc.match(/export const devModules = \{([^}]*)\}/)?.[1] ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
);

describe('e2e specs read app modules through window.__modules', () => {
	it('no spec imports an app module from inside the page', () => {
		// A dynamic import of a /src/ URL (any quote style). Node-side static imports of
		// ../../src/... are pure helpers run in the test process, not the page, and are fine.
		const offenders = specs.flatMap(({ file, text }) =>
			[...text.matchAll(/import\(\s*(?:\/\*[^*]*\*\/\s*)?['"`]\/src\//g)].map(
				(m) => `${file}:${text.slice(0, m.index).split('\n').length}`
			)
		);
		expect(offenders).toEqual([]);
	});

	it('every window.__modules name a spec uses is published by devModules.js', () => {
		expect(exposed.size).toBeGreaterThan(0);
		const used = new Set(
			specs.flatMap(({ text }) => [...text.matchAll(/__modules\.(\w+)/g)].map((m) => m[1]))
		);
		expect([...used].filter((n) => !exposed.has(n))).toEqual([]);
	});

	it('+page.svelte publishes window.__modules only inside the DEV guard', () => {
		const page = readFileSync(join(ROOT, 'src/routes/+page.svelte'), 'utf8');
		// The guarded block runs from its `if` to the first line that closes it at the same indent.
		const block =
			page.match(/\n(\t*)if \(import\.meta\.env\.DEV && [^\n]*\{\n([\s\S]*?)\n\1\}/)?.[2] ?? '';
		expect(block).toContain('window.__modules = devModules;');
		// And assigned nowhere else.
		expect(page.split('window.__modules =').length - 1).toBe(1);
	});
});
