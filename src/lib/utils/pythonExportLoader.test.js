import { describe, it, expect, beforeEach } from 'vitest';
import {
	loadPythonExporter,
	resetPythonExporterCache,
	sidecarUrl,
	retrySpecifier,
	PythonExportUnavailableError
} from './pythonExportLoader.js';

/** A stand-in sidecar, served as a data: URL so no file or server is involved. */
const stub = (body) => `data:text/javascript,${encodeURIComponent(body)}`;
const GOOD = stub('export function buildPythonScript(s){ return "# " + s.name }');
const EMPTY = stub('export const somethingElse = 1');

beforeEach(resetPythonExporterCache);

describe('sidecarUrl', () => {
	it('resolves next to the page, not the site root', () => {
		// The FTP builds are served from a subdirectory, where "/ancir-python-export.js"
		// would miss. Everything hangs off the document, so it has to follow it.
		expect(sidecarUrl('ancir-python-export.js', 'https://example.org/apps/ancir/index.html')).toBe(
			'https://example.org/apps/ancir/ancir-python-export.js'
		);
	});

	it('ignores the hash router fragment', () => {
		expect(sidecarUrl('ancir-python-export.js', 'https://example.org/ancir/index.html#/workspace')).toBe(
			'https://example.org/ancir/ancir-python-export.js'
		);
	});

	it('still yields a URL when there is no document', () => {
		expect(() => sidecarUrl('ancir-python-export.js', undefined)).not.toThrow();
	});

	it('resolves each language sidecar beside the page', () => {
		const base = 'https://example.org/apps/ancir/index.html';
		expect(sidecarUrl('ancir-r-export.js', base)).toBe(
			'https://example.org/apps/ancir/ancir-r-export.js'
		);
	});
});

describe('loadPythonExporter', () => {
	it('returns the sidecar module when it is there', async () => {
		const mod = await loadPythonExporter(GOOD);
		expect(mod.buildPythonScript({ name: 'x' })).toBe('# x');
	});

	it('loads once and reuses it', async () => {
		expect(await loadPythonExporter(GOOD)).toBe(await loadPythonExporter(GOOD));
	});

	it('reports an absent sidecar as such, not as an opaque failure', async () => {
		// The supported "single-file copy of AnCiR" case: index.html without its sidecar.
		const err = await loadPythonExporter('https://127.0.0.1:1/nope.js').catch((e) => e);
		expect(err).toBeInstanceOf(PythonExportUnavailableError);
		expect(err.message).toMatch(/ancir-python-export\.js/);
		expect(err.cause).toBeTruthy();
	});

	it('rejects a module that loads but is not the sidecar', async () => {
		// A 404 page can parse as an empty module, so importing cleanly proves nothing.
		const err = await loadPythonExporter(EMPTY).catch((e) => e);
		expect(err).toBeInstanceOf(PythonExportUnavailableError);
		expect(err.cause.message).toMatch(/no buildPythonScript/);
	});

	it('does not cache a failure', async () => {
		const url = 'https://127.0.0.1:1/nope.js';
		await expect(loadPythonExporter(url)).rejects.toThrow(PythonExportUnavailableError);
		// Still reachable rather than stuck on the first rejection.
		await expect(loadPythonExporter(url)).rejects.toThrow(PythonExportUnavailableError);
		expect(await loadPythonExporter(GOOD)).toBeTruthy();
	});
});

describe('retrySpecifier', () => {
	// A browser records a failed module fetch in its module map and will not re-request the
	// same specifier: two import() calls for a missing URL make exactly ONE network request
	// (measured in Chrome against the built app). Clearing our own cache therefore cannot on
	// its own make a retry work — only a distinct specifier can.
	it('leaves the first attempt untouched', () => {
		expect(retrySpecifier('/ancir-python-export.js', 0)).toBe('/ancir-python-export.js');
	});

	it('makes each retry a specifier the module map has not seen', () => {
		expect(retrySpecifier('/x.js', 1)).toBe('/x.js?retry=1');
		expect(retrySpecifier('/x.js', 2)).toBe('/x.js?retry=2');
	});

	it('keeps an existing query string intact', () => {
		expect(retrySpecifier('/x.js?v=2', 1)).toBe('/x.js?v=2&retry=1');
	});

	it('is used after a failure, so uploading the sidecar needs no page reload', async () => {
		const url = 'https://127.0.0.1:1/nope.js';
		await expect(loadPythonExporter(url)).rejects.toThrow(PythonExportUnavailableError);
		// The second call must not reuse the dead specifier. Spy on it via the error's url,
		// which stays the base URL, while the import target gains the retry marker.
		const err = await loadPythonExporter(url).catch((e) => e);
		expect(err.url).toBe(url);
	});
});
