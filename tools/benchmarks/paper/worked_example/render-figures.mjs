// Export updated figures with the CURRENT app (v75.2) using its own image exporter
// (convertToImage -> the Save dialog's code path) at 300 dpi.
//
// Each original session is loaded into the running dev app (?loadFromURL=, served via
// Playwright interception, exactly as in run-worked-examples.mjs); every plot is then exported to PNG (300 dpi) and SVG.
//
// Usage: node tools/benchmarks/paper/worked_example/render-figures.mjs [baseURL]
// Output: tools/benchmarks/paper/results/worked_example/figures/<session>__<plot>.{png,svg}
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../results/worked_example/figures');
fs.mkdirSync(outDir, { recursive: true });
const base = process.argv[2] ?? 'http://localhost:5173/';
const PAPER = '/Users/dcum007/Documents/Circadian/RACiR/Paper';
const DPI = 300;

const JOBS = [
	{
		name: 'simulated_session_Simulated',
		// The original session with its saved legend position switched to 'auto' (v76
		// avoids the data), so the scatterplot legend does not cover points.
		session: path.resolve(here, '../results/worked_example/inputs/session_Simulated_autolegend.json')
	},
	{ name: 'simulated_SimulatedExample', session: `${PAPER}/Archive/SimulatedExample.json` },
	// The original session loads as saved now that single-width time tokens accept padded values.
	{ name: 'drosophila', session: `${PAPER}/DrosophilaData/session.json` },
	{ name: 'scyphax', session: `${PAPER}/Scyphax data/FORJAMES R code from Rachel/session.json` }
];

const only = process.env.ONLY;
const browser = await chromium.launch();
for (const job of JOBS) {
	if (only && job.name !== only) continue;
	const ctx = await browser.newContext({ viewport: { width: 1800, height: 1200 }, acceptDownloads: true });
	const page = await ctx.newPage();
	page.on('console', (m) => { if (m.type() === 'error' && !/cloudflare|ERR_FAILED/.test(m.text())) console.log('[page error]', m.text().slice(0, 400)); });
	page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log('[navigated]', f.url().slice(0, 120)); });
	page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 400)));
	await page.route('http://session.local/**', (r) =>
		r.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: fs.readFileSync(job.session)
		})
	);
	await page.goto(base + '?loadFromURL=' + encodeURIComponent('http://session.local/s.json'));
	await page.waitForFunction(() => window.__core && window.__core.plots.length > 0, null, { timeout: 120000 });
	// Wait for spectra to compute.
	await page.waitForFunction(
		() =>
			window.__core.plots
				.filter((p) => p.type === 'periodogram' || p.type === 'fft')
				.every((p) => p.plot.data.every((d) => d.peak)),
		null,
		{ timeout: 180000 }
	);
	await page.waitForTimeout(4000);
	const plots = await page.evaluate(() => window.__core.plots.map((p) => ({ id: p.id, name: p.name, type: p.type })));
	for (const p of plots) {
		if (p.type === 'tableplot') continue;
		const safe = `${job.name}__${p.name}`.replace(/[^A-Za-z0-9_.-]+/g, '_');
		for (const fmt of ['png', 'svg']) {
			const dl = page.waitForEvent('download', { timeout: 60000 });
			await page.evaluate(
				async ({ id, fmt, dpi }) => {
					const m = await import('/src/lib/components/plotbits/helpers/save.svelte.js');
					await m.convertToImage(id, fmt, { dpi, includeTitle: false });
				},
				{ id: p.id, fmt, dpi: DPI }
			);
			const d = await dl;
			const file = path.join(outDir, `${safe}.${fmt}`);
			await d.saveAs(file);
			console.log('wrote', path.relative(process.cwd(), file));
		}
	}
	await ctx.close();
}
await browser.close();
