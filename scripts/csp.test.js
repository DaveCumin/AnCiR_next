import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
	BEACON_ORIGIN,
	applyCsp,
	cspString,
	headersFile,
	injectCsp,
	inlineScripts,
	scriptHash
} from './csp.mjs';

const sha = (s) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;

// The shape of the shipped page: a commented-out tag, the beacon loader, then SvelteKit's
// bootstrap with the inlined bundle (which itself contains "<!--" and a "<script" string).
const BEACON_JS = "\n\t\t\tvar cf = document.createElement('script');\n\t\t";
const BOOT_JS = '\n\t\t\tconst s = "<!-- not a comment"; const t = "<scr" + "ipt>";\n\t\t';
const FIXTURE = [
	'<!doctype html>',
	'<html lang="en">',
	'\t<head>',
	'\t\t<meta charset="utf-8" />',
	'\t\t<!-- <script>commented()</script> -->',
	'\t\t<title>t</title>',
	'\t</head>',
	'\t<body>',
	`\t\t<script>${BEACON_JS}</script>`,
	'\t\t<script src="/external.js"></script>',
	'\t\t<script type="application/json">{"a":1}</script>',
	`\t\t<div style="display: contents"><script>${BOOT_JS}</script></div>`,
	'\t</body>',
	'</html>'
].join('\n');

const META_POLICY =
	"default-src 'self'; " +
	`script-src 'self' ${sha(BEACON_JS)} ${sha(BOOT_JS)} https://static.cloudflareinsights.com 'report-sample'; ` +
	"style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' data: blob: https://zenodo.org; " +
	"connect-src 'self' https:; " +
	'worker-src blob:; ' +
	'child-src blob:; ' +
	"frame-src 'none'; " +
	"object-src 'none'; " +
	"base-uri 'none'; " +
	"form-action 'none'";
const HEADER_POLICY = `${META_POLICY}; frame-ancestors 'none'; upgrade-insecure-requests`;

const count = (s, needle) => s.split(needle).length - 1;

describe('inlineScripts', () => {
	it('returns only executable inline scripts, in order, skipping comments, src and data blocks', () => {
		expect(inlineScripts(FIXTURE)).toEqual([BEACON_JS, BOOT_JS]);
	});

	it('throws on an unterminated script rather than hashing half a file', () => {
		expect(() => inlineScripts('<script>var a = 1;')).toThrow(/unterminated/);
	});
});

describe('injectCsp', () => {
	const out = injectCsp(FIXTURE);

	it('injects exactly one CSP meta tag and one referrer meta tag', () => {
		expect(count(out.html, 'http-equiv="Content-Security-Policy"')).toBe(1);
		expect(count(out.html, '<meta name="referrer" content="no-referrer" />')).toBe(1);
	});

	it('places the policy right after <meta charset>, before any script', () => {
		const at = out.html.indexOf('http-equiv="Content-Security-Policy"');
		expect(at).toBeGreaterThan(out.html.indexOf('<meta charset="utf-8" />'));
		expect(at).toBeLessThan(out.html.indexOf('<script'));
	});

	it('hashes the exact text of every inline script (SHA-256, base64)', () => {
		expect(out.hashes).toEqual([sha(BEACON_JS), sha(BOOT_JS)]);
		expect(scriptHash(BOOT_JS)).toBe(sha(BOOT_JS));
	});

	it('writes the specified policy: meta without the header-only directives', () => {
		expect(out.metaPolicy).toBe(META_POLICY);
		expect(out.headerPolicy).toBe(HEADER_POLICY);
		expect(out.html).toContain(
			`<meta http-equiv="Content-Security-Policy" content="${META_POLICY}" />`
		);
		expect(out.metaPolicy).not.toMatch(/frame-ancestors|upgrade-insecure-requests|unsafe-eval/);
	});

	it('changes nothing else in the document', () => {
		const removed = out.html
			.replace(/\n\t\t<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
			.replace(/\n\t\t<meta name="referrer"[^>]*>/, '');
		expect(removed).toBe(FIXTURE);
	});

	it('is idempotent: a second run replaces the tags instead of duplicating them', () => {
		const again = injectCsp(out.html);
		expect(again.html).toBe(out.html);
	});

	it('re-hashes when a script changes', () => {
		const changed = injectCsp(out.html.replace('var cf', 'var cg'));
		expect(changed.hashes[0]).toBe(sha(BEACON_JS.replace('var cf', 'var cg')));
		expect(count(changed.html, 'http-equiv="Content-Security-Policy"')).toBe(1);
	});

	it('refuses a page it cannot protect', () => {
		expect(() => injectCsp('<html><head></head><body></body></html>')).toThrow(/no inline/);
		expect(() => injectCsp('<html><head></head><body><script>1</script></body></html>')).toThrow(
			/charset/
		);
	});
});

describe('headersFile', () => {
	it('puts the full policy on the app page only, and the plain headers on every path', () => {
		const file = headersFile(HEADER_POLICY);
		expect(file).toContain(
			'/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n'
		);
		expect(file).toContain(`/\n  Content-Security-Policy: ${HEADER_POLICY}\n`);
		expect(file).toContain(`/index.html\n  Content-Security-Policy: ${HEADER_POLICY}\n`);
		expect(count(file, 'Content-Security-Policy:')).toBe(2);
	});
});

describe('applyCsp', () => {
	it('rewrites index.html and writes _headers in the given directory', () => {
		const dir = mkdtempSync(join(tmpdir(), 'csp-'));
		writeFileSync(join(dir, 'index.html'), FIXTURE);
		const { headerPolicy } = applyCsp(dir);
		expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe(injectCsp(FIXTURE).html);
		expect(readFileSync(join(dir, '_headers'), 'utf8')).toBe(headersFile(headerPolicy));
	});
});

describe('wiring', () => {
	it('runs as the last step of build, after vite build and so before the postbuild deploys', () => {
		const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
		expect(pkg.scripts.build).toMatch(/&& vite build && node scripts\/csp\.mjs$/);
		expect(pkg.scripts.postbuild).not.toMatch(/csp/);
	});

	it('the external script origin is the one src/app.html loads', () => {
		expect(readFileSync(resolve('src/app.html'), 'utf8')).toContain(`'${BEACON_ORIGIN}/`);
	});
});

// The real build output, when present. Whether or not the local build has been injected yet,
// the shipped page must have exactly the two inline scripts the policy expects, and the
// injector must accept it.
const BUILT = resolve('build/index.html');
describe.skipIf(!existsSync(BUILT))('built build/index.html', () => {
	it('injects cleanly, with one hash per inline script', () => {
		const html = readFileSync(BUILT, 'utf8');
		const out = injectCsp(html);
		expect(out.hashes).toHaveLength(inlineScripts(out.html).length);
		expect(count(out.html, 'http-equiv="Content-Security-Policy"')).toBe(1);
		if (html.includes('http-equiv="Content-Security-Policy"')) {
			// Already injected by the build: its policy must match its scripts.
			expect(html).toContain(`content="${out.metaPolicy}"`);
		}
	});

	it('its policy string is the one cspString builds', () => {
		const out = injectCsp(readFileSync(BUILT, 'utf8'));
		expect(out.metaPolicy).toBe(cspString({ hashes: out.hashes, delivery: 'meta' }));
	});
});
