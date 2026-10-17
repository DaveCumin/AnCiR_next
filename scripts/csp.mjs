// Content-Security-Policy and security headers for the shipped single-file app (SEC-4).
//
// Usage: node scripts/csp.mjs [buildDir]          (buildDir defaults to $ANCIR_BUILD_DIR, else build)
//
// Runs as the LAST step of `build` (after `vite build`, before the postbuild deploys), so the
// file it rewrites is the file that is uploaded. It:
//   1. hashes every inline <script> in <buildDir>/index.html (SHA-256, base64);
//   2. injects ONE <meta http-equiv="Content-Security-Policy"> and ONE
//      <meta name="referrer"> right after <meta charset>, replacing any earlier copies,
//      so a second run is a no-op rather than a duplicate;
//   3. writes <buildDir>/_headers (Cloudflare Pages format) carrying the same policy as a real
//      response header plus the directives a <meta> policy cannot express.
//
// The hashes are computed from the final file, so they are always right for that build; there
// is nothing to update by hand when the bundle changes. Only a change to WHAT the app is
// allowed to load (a new external origin, a new kind of worker) needs an edit here.
// See docs/security-headers.md for the reasoning behind every directive.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildOutputDirs } from './buildOutput.js';

/** The external script origin the app loads: the Cloudflare Web Analytics beacon (src/app.html). */
export const BEACON_ORIGIN = 'https://static.cloudflareinsights.com';

/** Referrer-Policy value, used for both the header and the <meta name="referrer"> fallback. */
export const REFERRER_POLICY = 'no-referrer';

/**
 * Inline (no `src`) classic or module scripts in `html`, in document order, with the exact text
 * the browser hashes. Skips HTML comments, so a commented-out example tag is never hashed.
 * @param {string} html
 * @returns {string[]}
 */
export function inlineScripts(html) {
	const out = [];
	const openRe = /<script\b([^>]*)>/gi;
	let cursor = 0;
	for (;;) {
		const comment = html.indexOf('<!--', cursor);
		openRe.lastIndex = cursor;
		const m = openRe.exec(html);
		if (!m) break;
		if (comment !== -1 && comment < m.index) {
			const end = html.indexOf('-->', comment + 4);
			if (end === -1) break;
			cursor = end + 3;
			continue;
		}
		const bodyStart = m.index + m[0].length;
		const close = html.toLowerCase().indexOf('</script', bodyStart);
		if (close === -1) throw new Error('csp: unterminated <script> in index.html');
		const attrs = m[1];
		const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1]?.toLowerCase();
		const executable = !type || type === 'module' || /javascript|ecmascript/.test(type);
		if (!/\bsrc\s*=/i.test(attrs) && executable) out.push(html.slice(bodyStart, close));
		cursor = close + '</script'.length;
	}
	return out;
}

/** CSP source expression for one inline script. */
export function scriptHash(text) {
	return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
}

/**
 * The policy as ordered [directive, ...sources] rows.
 * `delivery: 'meta'` leaves out what a <meta> policy cannot carry or must not assume:
 * frame-ancestors (ignored in meta, with a console warning) and upgrade-insecure-requests (the
 * same index.html is also served from the FTP mirror and opened from file://, neither of which
 * is known to be https; on an http host it would upgrade the page's own same-origin requests).
 * @param {{ hashes: string[], delivery: 'meta' | 'header' }} opts
 * @returns {string[][]}
 */
export function cspDirectives({ hashes, delivery }) {
	const rows = [
		["default-src 'self'"],
		["script-src 'self'", ...hashes, BEACON_ORIGIN, "'report-sample'"],
		["style-src 'self' 'unsafe-inline'"],
		["img-src 'self' data: blob: https://zenodo.org"],
		["connect-src 'self' https:"],
		['worker-src blob:'],
		['child-src blob:'],
		["frame-src 'none'"],
		["object-src 'none'"],
		["base-uri 'none'"],
		["form-action 'none'"]
	];
	if (delivery === 'header') rows.push(["frame-ancestors 'none'"], ['upgrade-insecure-requests']);
	return rows;
}

/** Serialise directive rows into a policy string. */
export function cspString(opts) {
	return cspDirectives(opts)
		.map((r) => r.join(' '))
		.join('; ');
}

const CSP_META_RE = /[ \t]*<meta http-equiv="Content-Security-Policy"[^>]*>\n?/gi;
const REFERRER_META_RE = /[ \t]*<meta name="referrer"[^>]*>\n?/gi;
const CHARSET_RE = /<meta charset="[^"]*"\s*\/?>/i;

/**
 * Returns `html` with the CSP and referrer <meta> tags (re)injected right after <meta charset>,
 * plus the hashes and both policy strings.
 * @param {string} html
 */
export function injectCsp(html) {
	// Strip earlier copies from the <head> only: the inlined bundle is never touched.
	const headEnd = html.search(/<\/head>/i);
	if (headEnd === -1) throw new Error('csp: </head> not found in index.html');
	const stripped =
		html.slice(0, headEnd).replace(CSP_META_RE, '').replace(REFERRER_META_RE, '') +
		html.slice(headEnd);
	const scripts = inlineScripts(stripped);
	if (scripts.length === 0) throw new Error('csp: no inline <script> found in index.html');
	const hashes = [...new Set(scripts.map(scriptHash))];
	const metaPolicy = cspString({ hashes, delivery: 'meta' });
	const headerPolicy = cspString({ hashes, delivery: 'header' });
	const charset = CHARSET_RE.exec(stripped);
	if (!charset) throw new Error('csp: <meta charset> not found; the policy must precede scripts');
	const at = charset.index + charset[0].length;
	const tags =
		`\n\t\t<meta http-equiv="Content-Security-Policy" content="${metaPolicy}" />` +
		`\n\t\t<meta name="referrer" content="${REFERRER_POLICY}" />`;
	return {
		html: stripped.slice(0, at) + tags + stripped.slice(at),
		hashes,
		metaPolicy,
		headerPolicy
	};
}

/**
 * Cloudflare Pages `_headers` file. The full policy goes on the app page only: the handbook and
 * its animations are separate documents with their own inline scripts, and the animations are
 * built to be embedded in iframes, so they get only the policy-free headers.
 * @param {string} headerPolicy
 */
export function headersFile(headerPolicy) {
	const common = ['  X-Content-Type-Options: nosniff', `  Referrer-Policy: ${REFERRER_POLICY}`];
	const app = [`  Content-Security-Policy: ${headerPolicy}`];
	return [
		'# GENERATED by scripts/csp.mjs at build time; do not edit (see docs/security-headers.md).',
		'/*',
		...common,
		'',
		'/',
		...app,
		'',
		'/index.html',
		...app,
		''
	].join('\n');
}

/** Rewrites <dir>/index.html in place and writes <dir>/_headers. */
export function applyCsp(dir = 'build') {
	const htmlPath = join(dir, 'index.html');
	const result = injectCsp(readFileSync(htmlPath, 'utf8'));
	writeFileSync(htmlPath, result.html);
	writeFileSync(join(dir, '_headers'), headersFile(result.headerPolicy));
	return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		const { hashes } = applyCsp(process.argv[2] || buildOutputDirs(process.env).pages);
		console.log(
			`CSP: injected into index.html (${hashes.length} inline script hashes), wrote _headers.`
		);
	} catch (err) {
		console.error(`CSP injection FAILED: ${err.message}`);
		process.exit(1);
	}
}
