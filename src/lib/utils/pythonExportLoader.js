/**
 * Load the Python-export sidecar on demand.
 *
 * The exporter and its ~198 KB Python runtime live in `static/ancir-python-export.js`
 * rather than in the bundle: AnCiR inlines everything into a single index.html, so an
 * ordinary lazy `import()` would still be paid for on first paint by every visitor,
 * including the majority who never export Python. See scripts/buildPythonExport.mjs.
 *
 * The trade is that the sidecar is a SEPARATE FILE, and a deploy that publishes only
 * index.html will not carry it. That is not a hypothetical: this repo tracks just
 * build/index.html, and there are two FTP commands (a routine one and `uploadall`).
 * So "sidecar missing" is a supported state, not a bug — it has to fail in a way that
 * tells the user what to do rather than throwing a bare TypeError.
 */

/** Resolved lazily and cached per URL, so the second export in a session costs nothing. */
let cache = new Map();

/** Failed attempts per URL, which is what makes the retry specifier below distinct. */
let attempts = new Map();

/**
 * The specifier to import on attempt `n` (0 = first try).
 *
 * A dynamic import that fails is remembered by the browser's MODULE MAP, and re-importing
 * the same specifier rejects again without ever re-requesting it. Measured, not assumed:
 * two `import()` calls for a missing URL produce exactly one network request. So clearing
 * our own cache is not enough to let a retry work — the retry has to ask for a URL the
 * module map has not seen, or a user who uploads the sidecar would have to reload the page
 * before the button worked.
 */
export function retrySpecifier(url, attempt) {
	if (!attempt) return url;
	return url + (url.includes('?') ? '&' : '?') + `retry=${attempt}`;
}

/** Thrown when the sidecar cannot be fetched, so callers can tell it from a real error. */
export class PythonExportUnavailableError extends Error {
	constructor(url, cause) {
		super(
			`Python export needs "ancir-python-export.js" alongside this page, and it could not ` +
				`be loaded from ${url}. If you are running a single-file copy of AnCiR, that file ` +
				`was not deployed with it.`
		);
		this.name = 'PythonExportUnavailableError';
		this.url = url;
		this.cause = cause;
	}
}

/**
 * Resolve the sidecar against the DOCUMENT, not the site root.
 *
 * An absolute "/ancir-python-export.js" breaks the moment AnCiR is served from a
 * subdirectory, which is exactly how the FTP builds are hosted. Resolving against
 * document.baseURI keeps it next to whatever index.html the user actually opened; the
 * hash router's fragment drops out of URL resolution, so "#/workspace" is harmless.
 */
export function sidecarUrl(baseURI = globalThis.document?.baseURI) {
	return new URL('ancir-python-export.js', baseURI ?? 'http://localhost/').href;
}

/**
 * @param {string} [url] where to load the sidecar from. Defaults to next to the page;
 *   an override lets a host serve it from elsewhere (and lets the tests point at a stub).
 * @returns {Promise<{buildPythonScript: (session: unknown) => string}>}
 * @throws {PythonExportUnavailableError} when the sidecar is absent or unloadable.
 */
export function loadPythonExporter(url = sidecarUrl()) {
	const hit = cache.get(url);
	if (hit) return hit;
	const specifier = retrySpecifier(url, attempts.get(url) ?? 0);
	const promise = (async () => {
		let mod;
		try {
			// @vite-ignore: this URL is resolved at runtime on purpose. Without the hint Vite
			// would try to bundle the sidecar back into index.html, undoing the whole point.
			mod = await import(/* @vite-ignore */ specifier);
		} catch (cause) {
			throw new PythonExportUnavailableError(url, cause);
		}
		if (typeof mod?.buildPythonScript !== 'function') {
			// A 404 that serves an HTML error page can still parse as a module and import
			// cleanly, so a resolved import is not on its own proof that we got the sidecar.
			throw new PythonExportUnavailableError(url, new Error('no buildPythonScript export'));
		}
		return mod;
	})().catch((err) => {
		// Drop the cached promise AND count the failure, so the next call retries against a
		// specifier the module map has not already written off.
		cache.delete(url);
		attempts.set(url, (attempts.get(url) ?? 0) + 1);
		throw err;
	});
	cache.set(url, promise);
	return promise;
}

/** Test seam: drop the cached modules so each case starts from a clean slate. */
export function resetPythonExporterCache() {
	cache = new Map();
	attempts = new Map();
}
