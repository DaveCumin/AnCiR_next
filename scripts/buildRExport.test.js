import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	buildSidecar,
	assertSelfContained,
	GENERATOR_SRC,
	RUNTIME_SRC
} from './buildRExport.mjs';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('assertSelfContained', () => {
	it('accepts the real generator', () => {
		expect(assertSelfContained(read(GENERATOR_SRC))).toContain('sessionToR');
	});

	it('is not fooled by R source sitting inside the template literals', () => {
		// The Python generator has the sharper version of this hazard — it emits the literal
		// text "import numpy as np" — and R has no `import` statement at all. The guard is
		// still asserted here so that embedding R that happens to start a line with a JS
		// keyword cannot quietly start failing every build.
		const src = read(GENERATOR_SRC);
		expect(src).toContain('main <- function()');
		expect(() => assertSelfContained(src)).not.toThrow();
	});

	it('refuses a generator that grew a real JS import', () => {
		// The whole sidecar rests on the generator being inlinable verbatim. If that stops
		// being true the build must break, not the user's first click on "export Python".
		const src = `import { x } from './x.js';\nexport function sessionToR() {}`;
		expect(() => assertSelfContained(src)).toThrow(/no longer be inlined/);
	});

	it('refuses a generator that stopped exporting sessionToR', () => {
		expect(() => assertSelfContained('export function somethingElse() {}')).toThrow(
			/no longer exports/
		);
	});
});

describe('buildSidecar', () => {
	const sidecar = buildSidecar(read(GENERATOR_SRC), read(RUNTIME_SRC));

	it('embeds the runtime so the sidecar needs no second fetch', () => {
		expect(sidecar).toContain('compute_npcra'); // a distinctive runtime symbol
		expect(sidecar).toContain('ANCIR_R_RUNTIME');
	});

	it('exports the baked-in entry point', () => {
		expect(sidecar).toMatch(/export function buildRScript\(session\)/);
	});

	it('stays dependency-free, so a browser can load it straight from static/', () => {
		const jsImport = /^\s*import\s+(?:[\w*{][^\n]*\sfrom\s+)?['"]/m;
		expect(jsImport.test(sidecar)).toBe(false);
	});

	it('escapes the runtime rather than pasting it into source', () => {
		// The runtime contains backticks, backslashes and ${...} in its docstrings; pasting it
		// raw would produce a syntactically broken module.
		expect(() => new Function(sidecar.replace(/^export /gm, ''))).not.toThrow();
	});
});
