// The Cloudflare Web Analytics beacon in src/app.html must load only on the public site.
// This runs the exact inline script from app.html against a fake location and document,
// so the guard tested here is the one that ships (no duplicated copy to drift).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const html = readFileSync(join(process.cwd(), 'src', 'app.html'), 'utf8');
const beaconScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
	.map((m) => m[1])
	.find((src) => src.includes('cloudflareinsights'));

/** Run the inline script for a URL; return true when it appended the beacon. */
function injectsBeacon(url) {
	const u = new URL(url);
	const location = { protocol: u.protocol, hostname: u.hostname };
	const appended = [];
	const document = {
		createElement: () => ({ setAttribute() {} }),
		body: { appendChild: (el) => appended.push(el) }
	};
	new Function('location', 'document', beaconScript)(location, document);
	return appended.length > 0;
}

describe('app.html analytics beacon guard', () => {
	it('finds the beacon script in app.html', () => {
		expect(beaconScript).toBeTruthy();
	});

	it.each([
		'https://ancir.pages.dev/',
		'https://ancir.pages.dev/handbook.html',
		'http://example.org/'
	])('loads on a public host: %s', (url) => {
		expect(injectsBeacon(url)).toBe(true);
	});

	it.each([
		'http://localhost:5173/',
		'http://LOCALHOST/',
		'http://127.0.0.1:4173/',
		'http://127.1.2.3/',
		'http://[::1]:5173/',
		'http://0.0.0.0:5173/',
		'http://ancir.localhost/',
		'http://ancir.test/',
		'http://10.0.0.5:5173/',
		'http://192.168.1.20:5173/',
		'http://172.16.0.1/',
		'http://172.31.255.254/'
	])('skips a local host: %s', (url) => {
		expect(injectsBeacon(url)).toBe(false);
	});

	it('does not treat lookalike public hosts as local', () => {
		expect(injectsBeacon('https://localhost.example.com/')).toBe(true);
		expect(injectsBeacon('https://test.example.com/')).toBe(true);
		expect(injectsBeacon('https://ancir.test.example.com/')).toBe(true);
		expect(injectsBeacon('https://10.0.0.5.example.com/')).toBe(true);
		expect(injectsBeacon('https://notlocalhost/')).toBe(true);
		expect(injectsBeacon('http://172.32.0.1/')).toBe(true);
		expect(injectsBeacon('http://11.0.0.1/')).toBe(true);
	});

	it('skips file:// (the offline download)', () => {
		expect(injectsBeacon('file:///Users/me/Downloads/index.html')).toBe(false);
	});
});
