// Probe: load a session and evaluate an expression against window.__core (debug helper).
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const [,, sessionPath, expr, base = 'http://localhost:5173/'] = process.argv;
const browser = await chromium.launch();
const page = await browser.newPage();
await page.route('http://session.local/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: fs.readFileSync(sessionPath) }));
await page.goto(base + '?loadFromURL=' + encodeURIComponent('http://session.local/s.json'));
await page.waitForFunction(() => window.__core && window.__core.plots.length > 0, null, { timeout: 120000 });
await page.waitForTimeout(6000);
console.log(JSON.stringify(await page.evaluate(`(async () => { const core = window.__core; const col = (id) => core.data.find((d) => d.id === id); ${expr} })()`), null, 0));
await browser.close();
