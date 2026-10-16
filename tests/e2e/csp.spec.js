import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// SEC-4: the shipped page runs under its Content-Security-Policy (scripts/csp.mjs) with no
// violation in the features that must work: start screen, an example from the library, a
// session whose analysis runs in a Web Worker (blob: worker), the canvas-rendered scalogram
// (a data:image/png <image>), saving a session, the Python export (dynamic import of the
// same-origin sidecar), the AI service and a ?loadFromURL= session on another https origin.
//
// It needs a BUILT page with the policy in it, so it only runs against E2E_BASE_URL, for
// example the build served with the generated headers (see docs/security-headers.md):
//   E2E_BASE_URL=https://ancir.example:8443 pnpm test:e2e tests/e2e/csp.spec.js
// Nothing here reaches a real external service: the AI Worker, the analytics beacon and the
// remote session are answered by page.route. The policy is enforced in the renderer BEFORE a
// request reaches the network layer, so a request that arrives at a route was allowed.
//
// The one tolerated violation is @stdlib/assert-has-generator-support, which probes with
// eval('"use strict"; (function* () {})') inside try/catch. Blocked, it reports "no generator
// support" and @stdlib picks the plain-function implementation of continued fractions and
// series sums; for the closures @stdlib passes they compute bit-identical results.

test.skip(!process.env.E2E_BASE_URL, 'needs E2E_BASE_URL pointing at a built copy of the app');
test.use({
	ignoreHTTPSErrors: true,
	acceptDownloads: true,
	viewport: { width: 1400, height: 900 }
});

const TOLERATED_SAMPLE = '"use strict"; (function* () {})';
const DEMOS = path.resolve('static/sessions/demos');
const NL_ORIGIN = 'https://ancir-nl.david-cumin.workers.dev';
const REMOTE_SESSION = 'https://csp-check.example/session.json';

/** The cosinor demo with 600 rows, above the worker gate (workerGate.js, 500 rows). */
function cosinorSession(file) {
	const s = JSON.parse(fs.readFileSync(path.join(DEMOS, 'demo-tp-cosinor.json'), 'utf8'));
	const seq = s.tableProcesses.find((tp) => tp.name === 'SequenceColumn');
	const cos = s.tableProcesses.find((tp) => tp.name === 'Cosinor');
	const n = 600;
	Object.assign(seq.args, { count: n, end: n - 1 });
	s.rawData[cos.args.xIN] = Array.from({ length: n }, (_, i) => i);
	s.rawData[cos.args.yIN[0]] = Array.from(
		{ length: n },
		(_, i) => Math.round((50 + 40 * Math.sin((2 * Math.PI * i) / 24) + (i % 7)) * 1000) / 1000
	);
	fs.writeFileSync(file, JSON.stringify(s));
	return file;
}

async function stubExternal(context) {
	const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
	await context.route('https://static.cloudflareinsights.com/**', (r) =>
		r.fulfill({ contentType: 'text/javascript', body: '/* beacon stub */' })
	);
	await context.route(`${NL_ORIGIN}/**`, (r) => {
		if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
		if (r.request().url().endsWith('/health'))
			return r.fulfill({ headers: cors, contentType: 'application/json', body: '{"ok":true}' });
		return r.fulfill({ status: 503, headers: cors, contentType: 'application/json', body: '{}' });
	});
	await context.route(REMOTE_SESSION, (r) =>
		r.fulfill({
			headers: cors,
			contentType: 'application/json',
			body: fs.readFileSync(path.join(DEMOS, 'demo-tp-formulacolumn.json'))
		})
	);
}

/** Collects every securitypolicyviolation in every document the page loads. */
async function recordViolations(page) {
	await page.addInitScript(() => {
		window.__cspViolations = [];
		document.addEventListener('securitypolicyviolation', (e) =>
			window.__cspViolations.push({
				directive: e.effectiveDirective,
				blocked: e.blockedURI,
				sample: e.sample
			})
		);
	});
	const seen = [];
	const drain = async () => {
		seen.push(...(await page.evaluate(() => window.__cspViolations.splice(0))));
		return seen.filter((v) => !(v.blocked === 'eval' && v.sample === TOLERATED_SAMPLE));
	};
	return drain;
}

async function importFile(page, file) {
	await page.goto('/');
	await page.locator('button.primary-card', { hasText: 'Import data' }).click();
	const [chooser] = await Promise.all([
		page.waitForEvent('filechooser'),
		page.locator('button.dialog-button', { hasText: /Choose File|Change file/ }).click()
	]);
	await chooser.setFiles(file);
}

test('the page carries the policy (header or meta) with no unsafe-eval', async ({ page }) => {
	const res = await page.goto('/');
	const isDevServer = (await res.text()).includes('/@vite/client');
	test.skip(isDevServer, 'the dev server serves no policy; point E2E_BASE_URL at a build');
	const header = res.headers()['content-security-policy'] ?? '';
	const meta =
		(await page
			.locator('meta[http-equiv="Content-Security-Policy"]')
			.getAttribute('content')
			.catch(() => null)) ?? '';
	expect(header || meta, 'no Content-Security-Policy on the page').not.toBe('');
	for (const policy of [header, meta].filter(Boolean)) {
		expect(policy).toMatch(/script-src [^;]*'sha256-/);
		expect(policy).not.toMatch(/unsafe-eval|script-src[^;]*'unsafe-inline'/);
		expect(policy).toMatch(/object-src 'none'/);
	}
});

test('the app works under its policy with no CSP violation', async ({ page, context }, info) => {
	await stubExternal(context);
	const violations = await recordViolations(page);
	let workers = 0;
	page.on('worker', () => workers++);

	// Start screen, then an example from the library (same-origin fetch).
	await page.goto('/');
	await expect(page.locator('button.primary-card').first()).toBeVisible({ timeout: 30000 });
	await page.locator('button.example-open').first().click();
	await expect(page.locator('.workflow-node').first()).toBeVisible({ timeout: 30000 });
	expect(await violations(), 'start screen + example').toEqual([]);

	// An analysis big enough to run in the blob: Web Worker.
	await importFile(page, cosinorSession(info.outputPath('cosinor.json')));
	await expect(page.getByText('Cosinor').first()).toBeVisible({ timeout: 30000 });
	await expect.poll(() => workers, { timeout: 20000 }).toBeGreaterThan(0);
	expect(await violations(), 'worker analysis').toEqual([]);

	// Save the session (blob: download) and export Python (sidecar dynamic import).
	await Promise.all([page.waitForEvent('download'), page.getByTestId('nav-save-session').click()]);
	await page.getByTestId('nav-settings').click();
	await Promise.all([
		page.waitForEvent('download', { timeout: 30000 }),
		page.locator('button', { hasText: 'Export session as Python' }).click()
	]);
	expect(await violations(), 'save + Python export').toEqual([]);

	// The canvas-rendered scalogram is a data:image/png <image>.
	await importFile(page, path.join(DEMOS, 'demo-cwt-period-change.json'));
	await expect(page.locator('svg image[href^="data:image/png"]').first()).toBeAttached({
		timeout: 30000
	});
	expect(await violations(), 'canvas plot').toEqual([]);

	// The AI service (connect-src to the Worker origin).
	await page.goto('/');
	await page.locator('button.primary-card', { hasText: 'Build a session with AI' }).click();
	await page.locator('textarea').first().fill('A cosinor fit of a 24 h rhythm');
	await Promise.all([
		page.waitForRequest((r) => r.url().startsWith(NL_ORIGIN) && r.method() === 'POST'),
		page
			.locator('button', { hasText: /^(Build|Generate|Send|Create)/ })
			.first()
			.click()
	]);
	expect(await violations(), 'AI request').toEqual([]);

	// A session from another https origin (connect-src https:).
	await page.goto(`/?loadFromURL=${encodeURIComponent(REMOTE_SESSION)}`);
	await expect(page.getByText(/Formula/).first()).toBeVisible({ timeout: 30000 });
	expect(await violations(), 'loadFromURL').toEqual([]);
});
