import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	buildSidecar,
	assertSelfContained,
	GENERATOR_SRC,
	RUNTIME_SRC
} from './buildPythonExport.mjs';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('assertSelfContained', () => {
	it('accepts the real generator', () => {
		expect(assertSelfContained(read(GENERATOR_SRC))).toContain('sessionToPython');
	});

	it('is not fooled by the Python imports inside the template literals', () => {
		// pythonExport.js emits "import numpy as np" as DATA. Treating that as a JS import
		// would make the guard fire on every build, so it must key on JS syntax only.
		const src = read(GENERATOR_SRC);
		expect(src).toContain('import numpy as np');
		expect(() => assertSelfContained(src)).not.toThrow();
	});

	it('refuses a generator that grew a real JS import', () => {
		// The whole sidecar rests on the generator being inlinable verbatim. If that stops
		// being true the build must break, not the user's first click on "export Python".
		const src = `import { x } from './x.js';\nexport function sessionToPython() {}`;
		expect(() => assertSelfContained(src)).toThrow(/no longer be inlined/);
	});

	it('refuses a generator that stopped exporting sessionToPython', () => {
		expect(() => assertSelfContained('export function somethingElse() {}')).toThrow(
			/no longer exports/
		);
	});
});

describe('buildSidecar', () => {
	const sidecar = buildSidecar(read(GENERATOR_SRC), read(RUNTIME_SRC));

	it('embeds the runtime so the sidecar needs no second fetch', () => {
		expect(sidecar).toContain('class KahanSum'); // a distinctive runtime symbol
		expect(sidecar).toContain('ANCIR_PYTHON_RUNTIME');
	});

	it('exports the baked-in entry point', () => {
		expect(sidecar).toMatch(/export function buildPythonScript\(session\)/);
	});

	it('exports the multi-file entry point with the app version baked in', () => {
		expect(sidecar).toMatch(/export function buildPythonExportFiles\(session, opts\)/);
		// Default 'dev' here (no version passed); writeSidecar passes package.json's.
		expect(sidecar).toContain(`const ANCIR_APP_VERSION = "dev";`);
	});

	it('stamps the real package.json version when one is given', () => {
		const stamped = buildSidecar(read(GENERATOR_SRC), '# rt', '72.99');
		expect(stamped).toContain(`const ANCIR_APP_VERSION = "72.99";`);
	});

	it('refuses a generator that stopped exporting sessionToPythonFiles', () => {
		expect(() => assertSelfContained('export function sessionToPython() {}')).toThrow(
			/sessionToPythonFiles/
		);
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
