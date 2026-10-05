#!/usr/bin/env node
// Layout check for the handbook animations, in a real browser (layout cannot
// be measured in a DOM emulator).
//
// Inline (handbook.html): at every width from phone to desktop, and with a
// larger root font size (a reader's browser setting), every animation's
// figures keep a usable height and nothing inside the .anim-embed box is
// clipped. Regression guard for figures collapsing to 0 px: the embed had a
// fixed height and the figures took only what the text and controls left over,
// so wrapped captions or controls squeezed them to nothing.
//
// Standalone (animations/*.html): at a small frame and a full-HD window, the
// page does not overflow, the graphic is drawn at a non-zero size, scales with
// the window, and the buttons stay a clickable size.
//
// Usage: node scripts/check-anim-layout.mjs [buildDir]   (default: build/)
//   alias: pnpm --filter chronobiology-handbook check:layout
// Run after `pnpm --filter chronobiology-handbook build`. Exits 1 on failure.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILD = resolve(HERE, '..', process.argv[2] ?? 'build');

// The smallest canvas height (CSS px) a handbook figure may have. app.css
// gives .anim-embed canvas this as its min-height.
const MIN_INLINE_CANVAS = 80;
// Smallest clickable control height in a standalone page (CSS px).
const MIN_BUTTON = 28;

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.json': 'application/json',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.woff2': 'font/woff2'
};

async function serve(root) {
	const server = createServer(async (req, res) => {
		const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
		const file = join(root, path.endsWith('/') ? `${path}index.html` : path);
		if (!file.startsWith(root)) return res.writeHead(403).end();
		try {
			if (!(await stat(file)).isFile()) throw new Error('not a file');
			res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
			res.end(await readFile(file));
		} catch {
			res.writeHead(404).end();
		}
	});
	await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
	return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

const failures = [];
const fail = (msg) => failures.push(msg);

async function checkInline(browser, origin) {
	const cases = [
		{ width: 1400, height: 900, font: null },
		{ width: 900, height: 900, font: null },
		{ width: 600, height: 900, font: null },
		{ width: 375, height: 812, font: null },
		{ width: 1400, height: 900, font: '24px' },
		{ width: 375, height: 812, font: '20px' }
	];
	for (const c of cases) {
		const page = await browser.newPage({ viewport: { width: c.width, height: c.height } });
		await page.goto(`${origin}/handbook.html`, { waitUntil: 'load' });
		if (c.font) await page.addStyleTag({ content: `html { font-size: ${c.font} !important; }` });
		await page.waitForTimeout(400);
		const embeds = await page.evaluate(() =>
			[...document.querySelectorAll('.anim-embed')].map((e) => ({
				name: (e.querySelector('h3')?.textContent ?? 'SVG animation').trim().slice(0, 40),
				clipped: e.scrollHeight - e.clientHeight,
				canvases: [...e.querySelectorAll('canvas')].map((cv) => cv.getBoundingClientRect().height)
			}))
		);
		if (embeds.length < 10) fail(`inline ${c.width}px: only ${embeds.length} animations found`);
		const tag = `inline ${c.width}px${c.font ? ` root ${c.font}` : ''}`;
		for (const e of embeds) {
			const small = e.canvases.filter((h) => h < MIN_INLINE_CANVAS - 0.5);
			if (small.length)
				fail(`${tag}: "${e.name}" figure heights ${e.canvases.map(Math.round).join(', ')} px`);
			if (e.clipped > 1) fail(`${tag}: "${e.name}" content clipped by ${e.clipped} px`);
		}
		await page.close();
	}
}

async function checkStandalone(browser, origin) {
	const index = await browser.newPage();
	await index.goto(`${origin}/animations/index.html`);
	const slugs = await index.$$eval('a[href$=".html"]', (as) => [
		...new Set(as.map((a) => a.getAttribute('href')).filter((h) => !h.includes('/')))
	]);
	await index.close();
	if (slugs.length < 10) fail(`standalone: only ${slugs.length} pages listed in the index`);

	for (const slug of slugs) {
		const areas = [];
		for (const [w, h] of [
			[800, 450],
			[1920, 1080]
		]) {
			const page = await browser.newPage({ viewport: { width: w, height: h } });
			await page.goto(`${origin}/animations/${slug}`, { waitUntil: 'load' });
			await page.waitForTimeout(400);
			const m = await page.evaluate(() => {
				const embed = document.querySelector('.anim-embed');
				const graphic = [...document.querySelectorAll('canvas, svg[viewBox]')];
				const buttons = [...document.querySelectorAll('.controls .btn')].filter(
					(b) => b.getClientRects().length > 0
				);
				return {
					overflow: document.documentElement.scrollHeight - innerHeight,
					embedH: embed?.getBoundingClientRect().height ?? 0,
					area: graphic.reduce((s, g) => {
						const r = g.getBoundingClientRect();
						return s + r.width * r.height;
					}, 0),
					zero: graphic.filter((g) => g.getBoundingClientRect().height < 1).length,
					minButton: Math.min(...buttons.map((b) => b.getBoundingClientRect().height))
				};
			});
			const tag = `standalone ${slug} ${w}x${h}`;
			if (m.overflow > 1) fail(`${tag}: page overflows by ${m.overflow} px`);
			if (Math.abs(m.embedH - h) > 1) fail(`${tag}: animation box ${m.embedH} px, window ${h}`);
			if (m.zero) fail(`${tag}: ${m.zero} figure(s) have 0 height`);
			if (m.minButton < MIN_BUTTON) fail(`${tag}: a button is only ${m.minButton} px tall`);
			areas.push(m.area);
			await page.close();
		}
		if (!(areas[1] > areas[0] * 2))
			fail(`standalone ${slug}: graphic does not grow with the window`);
	}
	return slugs.length;
}

const { server, origin } = await serve(BUILD);
const browser = await chromium.launch();
try {
	await checkInline(browser, origin);
	const n = await checkStandalone(browser, origin);
	if (failures.length) {
		console.error(`Animation layout check FAILED (${failures.length}):`);
		for (const f of failures) console.error(`  ✗ ${f}`);
		process.exitCode = 1;
	} else {
		console.log(
			`Animation layout check passed: inline at 6 sizes, ${n} standalone pages at 2 sizes.`
		);
	}
} finally {
	await browser.close();
	server.close();
}
