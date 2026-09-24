import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Heavy analyses (periodogram, cosinor, fits, smoothing, moving analysis) run in a
// Web Worker pool. The shipped app is a single-file build (bundleStrategy 'inline'),
// which once resolved the worker URL against index.html, 404'd, and silently ran
// everything on the main thread. These tests load a periodogram session in the
// production build (served over http AND opened from disk as the offline download)
// and check that a worker actually computed it.

const TEMPLATE = path.resolve('static/sessions/demos/demo-periodogram-rhythm.json');
const OFFLINE_HTML = pathToFileURL(path.resolve('build/index.html')).href;
const ROWS = 3000; // well above the worker gate's input-length threshold

/** The shipped periodogram demo with its data replaced by ROWS rows of a 24 h rhythm. */
function writeSession(file) {
	const s = JSON.parse(fs.readFileSync(TEMPLATE, 'utf8'));
	const [xId, yId] = s.data.map((c) => String(c.data));
	const hours = Array.from({ length: ROWS }, (_, i) => i / 6); // 10-min samples
	s.rawData = {
		[xId]: hours,
		[yId]: hours.map(
			(h, i) => Math.round((50 + 40 * Math.sin((2 * Math.PI * h) / 24) + (i % 7)) * 1000) / 1000
		)
	};
	fs.writeFileSync(file, JSON.stringify(s));
	return file;
}

function watch(page) {
	const seen = { workers: 0, fallbackWarnings: [], errors: [] };
	page.on('worker', () => seen.workers++);
	page.on('console', (msg) => {
		const text = msg.text();
		if (msg.type() === 'warning' && text.startsWith('[AnCiR]')) seen.fallbackWarnings.push(text);
		if (
			msg.type() === 'error' &&
			!text.includes('cloudflareinsights') &&
			!text.includes('ERR_FAILED')
		) {
			seen.errors.push(text);
		}
	});
	page.on('pageerror', (e) => seen.errors.push(String(e)));
	return seen;
}

async function loadPeriodogramSession(page, url, sessionFile) {
	await page.goto(url);
	const importBtn = page.locator('button.primary-card', { hasText: 'Import data' });
	await expect(importBtn).toBeVisible({ timeout: 30000 });
	await importBtn.click();
	const [chooser] = await Promise.all([
		page.waitForEvent('filechooser'),
		page.locator('button.dialog-button', { hasText: /Choose File|Change file/ }).click()
	]);
	await chooser.setFiles(sessionFile);
	await expect(page.getByText('Activity periodogram').first()).toBeVisible({ timeout: 30000 });
	// The spectrum line is drawn once the computation (worker or fallback) resolves.
	await expect(page.getByText(/Calculating/i)).toHaveCount(0, { timeout: 30000 });
	await expect(page.locator('[data-node-id] svg path').first()).toBeVisible();
	await expect(page.getByText(`${ROWS} rows total`).first()).toBeVisible();
}

test('periodogram runs in a Web Worker in the production build', async ({ page }, testInfo) => {
	const seen = watch(page);
	await loadPeriodogramSession(page, '/', writeSession(testInfo.outputPath('session.json')));
	// The calculation is debounced, so the pool may start just after the plot appears.
	await expect.poll(() => seen.workers).toBeGreaterThan(0);
	expect(seen.fallbackWarnings).toEqual([]);
	expect(seen.errors).toEqual([]);
});

test('the offline single-file HTML (file://) also computes in a Web Worker', async ({
	page
}, testInfo) => {
	const seen = watch(page);
	await loadPeriodogramSession(
		page,
		OFFLINE_HTML,
		writeSession(testInfo.outputPath('session.json'))
	);
	await expect.poll(() => seen.workers).toBeGreaterThan(0);
	expect(seen.fallbackWarnings).toEqual([]);
});

test('when workers cannot start, it warns once and still computes on the main thread', async ({
	page
}, testInfo) => {
	await page.addInitScript(() => {
		window.Worker = class {
			constructor() {
				throw new Error('SecurityError: workers blocked for this test');
			}
		};
	});
	const seen = watch(page);
	await loadPeriodogramSession(page, '/', writeSession(testInfo.outputPath('session.json')));
	await expect.poll(() => seen.fallbackWarnings.length).toBe(1);
	expect(seen.workers).toBe(0);
	expect(seen.fallbackWarnings[0]).toMatch(/Web Workers are unavailable.*workers blocked/);
});

// The offline download ships without the example library (sessions/), and browsers
// refuse fetch() from file:// (WebKit even reports it as an uncaught error). The app
// must say so plainly instead of erroring.
test('the offline single-file HTML explains that example sessions need the hosted version', async ({
	page
}) => {
	const errors = [];
	page.on('pageerror', (e) => errors.push(String(e)));
	page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
	await page.goto(OFFLINE_HTML);

	const note = page.getByTestId('examples-unavailable');
	await expect(note).toContainText('Example sessions need an internet connection');
	await expect(note.getByRole('link', { name: 'Open the hosted version' })).toHaveAttribute(
		'href',
		'https://ancir.pages.dev'
	);

	// The full library (Load session > Examples) says the same.
	await page.locator('button.primary-card', { hasText: 'Start with a blank canvas' }).click();
	await page.getByTestId('nav-load-session').click();
	await page.getByRole('tab', { name: 'Examples', exact: true }).click();
	await expect(page.getByTestId('examples-unavailable').last()).toContainText(
		'not included in the downloaded offline file'
	);

	expect(errors).toEqual([]);
});
