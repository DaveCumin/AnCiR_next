// End-to-end browser benchmark (Playwright + Chromium) against a running AnCiR server.
//
//   node tools/benchmarks/paper/scaling/browser/run-browser.mjs \
//        --base http://localhost:4317 --sizes 10000,20000 --cases import-raw,import-binned,actogram,periodogram
//
// Each (case, N) runs in a FRESH browser context/tab and drives the real UI the way a
// user does: Start screen -> "Import data" -> "Choose File" (OS file chooser) ->
// preview -> (binning checkbox) -> "Confirm Import". Session cases load an AnCiR
// session .json through the same file chooser (the importer sniffs JSON sessions).
//
// Timing uses the page clock (performance.now()). "Settled" = the last DOM mutation or
// long task before a 1.5 s quiet window, i.e. when the UI stopped changing. Long tasks
// (>50 ms main-thread blocks) are collected with PerformanceObserver.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, '../.data');
const resultsDir = path.resolve(here, '../../results');
const shotsDir = path.resolve(here, '../.cache/shots');
fs.mkdirSync(resultsDir, { recursive: true });
fs.mkdirSync(shotsDir, { recursive: true });

const arg = (name, dflt) => {
	const i = process.argv.indexOf(name);
	return i > 0 ? process.argv[i + 1] : dflt;
};
const BASE = arg('--base', 'http://localhost:4317');
const SIZES = arg('--sizes', '10000,20000,100000,250000,500000,1000000').split(',').map(Number);
const CASES = arg('--cases', 'import-raw,import-binned,actogram,periodogram').split(',');
const REPS = Number(arg('--reps', '1'));
const OUT = arg('--out', 'browser-e2e');
const STEP_TIMEOUT = Number(arg('--timeout', '600000'));
const QUIET_MS = 1500;

// Installed in every page before app code runs.
const INIT = () => {
	window.__bench = { longtasks: [], lastActivity: performance.now(), mutations: 0 };
	try {
		new PerformanceObserver((list) => {
			for (const e of list.getEntries()) {
				window.__bench.longtasks.push({ start: e.startTime, duration: e.duration });
				window.__bench.lastActivity = Math.max(window.__bench.lastActivity, e.startTime + e.duration);
			}
		}).observe({ type: 'longtask', buffered: true });
	} catch {}
	const startMO = () => {
		new MutationObserver((recs) => {
			window.__bench.mutations += recs.length;
			window.__bench.lastActivity = performance.now();
		}).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
	};
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startMO);
	else startMO();
	window.__benchQuiet = (quietMs, sinceT) =>
		new Promise((resolve) => {
			const tick = () => {
				const now = performance.now();
				if (now - window.__bench.lastActivity >= quietMs && now - sinceT >= quietMs) {
					resolve(window.__bench.lastActivity);
				} else setTimeout(tick, 100);
			};
			tick();
		});
	window.__benchLongtasks = (t0, t1) => {
		const lt = window.__bench.longtasks.filter((e) => e.start >= t0 - 1 && e.start <= t1 + 1);
		const tbt = lt.reduce((s, e) => s + Math.max(0, e.duration - 50), 0);
		const max = lt.reduce((m, e) => Math.max(m, e.duration), 0);
		return { count: lt.length, max_ms: Math.round(max), tbt_ms: Math.round(tbt) };
	};
};

const now = (page) => page.evaluate(() => performance.now());
const quiet = (page, since) =>
	page.evaluate(([q, s]) => window.__benchQuiet(q, s), [QUIET_MS, since]);
// A worker computation mutates nothing while it runs (the periodogram spinner is a CSS
// animation with no progress text off-thread), so a quiet window alone can fire too
// early. Settle = quiet AND no "Calculating..." overlay; repeat until both hold.
async function settle(page, since) {
	for (;;) {
		const s = await quiet(page, since);
		const spinner = page.getByText(/Calculating/i).first();
		if (!(await spinner.isVisible().catch(() => false))) return s;
		await spinner.waitFor({ state: 'hidden', timeout: STEP_TIMEOUT });
	}
}
const lt = (page, a, b) => page.evaluate(([x, y]) => window.__benchLongtasks(x, y), [a, b]);

async function heapMB(cdp) {
	try {
		const { usedSize } = await cdp.send('Runtime.getHeapUsage');
		return Math.round(usedSize / 1048576);
	} catch {
		return null;
	}
}

/** Poll JS heap in the background, keeping the max seen. */
function heapSampler(cdp) {
	let max = 0;
	let stop = false;
	(async () => {
		while (!stop) {
			const m = await heapMB(cdp);
			if (m != null) max = Math.max(max, m);
			await new Promise((r) => setTimeout(r, 250));
		}
	})();
	return () => {
		stop = true;
		return max;
	};
}

async function openImportModal(page) {
	await page.goto(BASE + '/', { waitUntil: 'load' });
	const importBtn = page.locator('button.primary-card', { hasText: 'Import data' });
	await importBtn.waitFor({ state: 'visible', timeout: 60000 });
	await page.waitForTimeout(500);
	await importBtn.click();
	await page.locator('h2', { hasText: 'Import Data' }).waitFor({ state: 'visible', timeout: 30000 });
}

async function chooseFile(page, file) {
	const [chooser] = await Promise.all([
		page.waitForEvent('filechooser'),
		page.locator('button.dialog-button', { hasText: /Choose File|Change file/ }).click()
	]);
	const t0 = await now(page);
	await chooser.setFiles(file);
	return t0;
}

async function runImport(page, cdp, N, binned) {
	const file = path.join(dataDir, `csv-${N}.csv`);
	const rec = { file_mb: +(fs.statSync(file).size / 1048576).toFixed(1) };
	await openImportModal(page);
	const stopHeap = heapSampler(cdp);

	// Phase 1: choose file -> preview ready (Confirm Import button enabled)
	const t0 = await chooseFile(page, file);
	await page.locator('#confirmImport').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
	const t1 = await now(page);
	rec.preview_ms = Math.round(t1 - t0);
	rec.preview_longtasks = await lt(page, t0, t1);

	const binBox = page.locator('.binning-panel input[type="checkbox"]');
	rec.binning_offered = (await binBox.count()) > 0;
	if (rec.binning_offered) {
		rec.binning_default_on = await binBox.isChecked();
		if (binned && !(await binBox.isChecked())) await binBox.check();
		if (!binned && (await binBox.isChecked())) await binBox.uncheck();
	}
	rec.binned = rec.binning_offered ? binned : false;
	if (rec.binned) {
		rec.binning_estimate = await page
			.locator('.binning-estimate')
			.innerText({ timeout: 5000 })
			.catch(() => null);
	}

	// Phase 2: Confirm Import -> modal closed + data nodes on canvas -> UI settled
	const t2 = await now(page);
	await page.locator('#confirmImport').click();
	// Modal gone (the <dialog> is removed when the import finishes) and the new
	// data node is on the canvas.
	await page.waitForFunction(() => !document.querySelector('dialog'), null, { timeout: STEP_TIMEOUT, polling: 50 });
	await page.locator('[data-node-id]').first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
	const t3 = await now(page);
	const settled = await settle(page, t3);
	rec.confirm_to_node_visible_ms = Math.round(t3 - t2);
	rec.confirm_to_settled_ms = Math.round(settled - t2);
	rec.total_file_to_settled_ms = Math.round(settled - t0);
	rec.import_longtasks = await lt(page, t2, settled);
	rec.node_ports = await page.locator('[data-node-id]').count();
	rec.heap_peak_sampled_mb = stopHeap();
	rec.heap_settled_mb = await heapMB(cdp);
	return rec;
}

const PLOT_TITLE = { actogram: 'Activity actogram', periodogram: 'Activity periodogram' };

async function runSession(page, cdp, N, kind) {
	const file = path.join(dataDir, `session-${kind}-${N}.json`);
	const rec = { file_mb: +(fs.statSync(file).size / 1048576).toFixed(1) };
	await openImportModal(page);
	const stopHeap = heapSampler(cdp);
	const t0 = await chooseFile(page, file);
	// Wait for the session's nodes (and, for plot sessions, the plot node) to appear,
	// then for the UI to settle (the periodogram computes asynchronously in a worker,
	// so its line is drawn later).
	const marker = PLOT_TITLE[kind] ? page.getByText(PLOT_TITLE[kind]).first() : page.getByText(/rows total/).first();
	await marker.waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
	const t1 = await now(page);
	const settled = await settle(page, t0);
	rec.first_node_ms = Math.round(t1 - t0);
	rec.file_to_settled_ms = Math.round(settled - t0);
	rec.longtasks = await lt(page, t0, settled);
	rec.heap_peak_sampled_mb = stopHeap();
	rec.heap_settled_mb = await heapMB(cdp);
	rec.svg_marks = await page.evaluate(() => document.querySelectorAll('svg path, svg rect, svg circle').length);
	rec.rows_total_text = await page
		.getByText(/rows total/)
		.first()
		.innerText({ timeout: 2000 })
		.catch(() => null);
	rec.spinner_still_visible = await page
		.getByText(/Calculating/i)
		.first()
		.isVisible()
		.catch(() => false);

	// Interactive update: select the plot node, open the control panel (its chevron
	// button, as a user does) and change ONE parameter; time until the UI settles again.
	if (PLOT_TITLE[kind]) {
		await page.getByText(PLOT_TITLE[kind]).first().click();
		await page.locator('.open-control-panel-icon-container button').click({ timeout: 30000 });
		const label = kind === 'actogram' ? 'Period' : 'Period Step';
		const input = page.getByLabel(label, { exact: true }).first();
		await input.waitFor({ state: 'visible', timeout: 30000 });
		await settle(page, await now(page));
		const newVal = kind === 'actogram' ? '24.5' : '0.2';
		const t2 = await now(page);
		await input.fill(newVal);
		const settled2 = await settle(page, t2);
		rec.update_param = `${label} -> ${newVal}`;
		rec.update_to_settled_ms = Math.round(settled2 - t2);
		rec.update_longtasks = await lt(page, t2, settled2);
	}
	return rec;
}

async function main() {
	const browser = await chromium.launch({
		headless: true,
		args: ['--enable-precise-memory-info']
	});
	const meta = {
		date: new Date().toISOString(),
		chromium: browser.version(),
		playwright: JSON.parse(
			fs.readFileSync(path.resolve(here, '../../../../../node_modules/@playwright/test/package.json'), 'utf8')
		).version,
		node: process.version,
		cpu: os.cpus()[0]?.model,
		totalmem_gb: Math.round(os.totalmem() / 2 ** 30),
		base: BASE,
		quiet_ms: QUIET_MS
	};
	console.log(meta);
	const outFile = path.join(resultsDir, `${OUT}.json`);
	const results = fs.existsSync(outFile) && process.argv.includes('--append')
		? JSON.parse(fs.readFileSync(outFile, 'utf8')).results
		: [];
	const save = () => fs.writeFileSync(outFile, JSON.stringify({ meta, results }, null, 2));

	for (const c of CASES) {
		for (const N of SIZES) {
			for (let rep = 0; rep < REPS; rep++) {
				const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
				await context.addInitScript(INIT);
				// The deployed page loads Cloudflare analytics; block it so it adds no noise.
				await context.route(/cloudflareinsights\.com/, (r) => r.abort());
				const page = await context.newPage();
				const cdp = await context.newCDPSession(page);
				await cdp.send('Performance.enable').catch(() => {});
				const errors = [];
				let crashed = false;
				page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
				page.on('console', (m) => {
					if (m.type() === 'error') errors.push(m.text().slice(0, 300));
				});
				page.on('crash', () => (crashed = true));
				const rec = { case: c, N, rep };
				const tWall = Date.now();
				try {
					if (c === 'import-raw') Object.assign(rec, await runImport(page, cdp, N, false));
					else if (c === 'import-binned') Object.assign(rec, await runImport(page, cdp, N, true));
					else if (c === 'actogram' || c === 'periodogram' || c === 'dataonly') Object.assign(rec, await runSession(page, cdp, N, c));
					else throw new Error('unknown case ' + c);
					rec.ok = true;
				} catch (e) {
					rec.ok = false;
					rec.error = String(e?.message ?? e).split('\n')[0].slice(0, 300);
				}
				rec.crashed = crashed;
				rec.wall_s = Math.round((Date.now() - tWall) / 100) / 10;
				rec.errors = errors.slice(0, 5);
				try {
					await page.screenshot({ path: path.join(shotsDir, `${c}-${N}-r${rep}.png`), timeout: 60000 });
				} catch {}
				await context.close().catch(() => {});
				results.push(rec);
				save();
				console.log(JSON.stringify(rec));
				if (!rec.ok || crashed) break;
			}
			const last = results[results.length - 1];
			if (!last.ok || last.crashed) {
				console.log(`  -> stopping case ${c} after N=${N}`);
				break;
			}
		}
	}
	await browser.close();
	save();
	console.log('wrote', outFile);
}

main();
