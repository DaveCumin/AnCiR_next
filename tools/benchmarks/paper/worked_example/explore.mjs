// Exploratory: load an original session into the running dev app and dump state.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const [,, sessionPath, base = 'http://localhost:5173/'] = process.argv;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 300)); });
await page.route('http://session.local/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: fs.readFileSync(sessionPath) }));
await page.goto(base + '?loadFromURL=' + encodeURIComponent('http://session.local/s.json'));
await page.waitForFunction(() => window.__core && window.__core.plots.length > 0, null, { timeout: 60000 });
await page.waitForTimeout(8000);
const info = await page.evaluate(() => {
  const c = window.__core;
  return {
    data: c.data.map((d) => ({ id: d.id, name: d.name, type: d.type, n: d.getData()?.length })),
    tables: (c.tables ?? []).map((t) => ({ id: t.id, name: t.name, procs: t.processes?.map((p) => ({ name: p.name, args: JSON.parse(JSON.stringify(p.args ?? {})) })) })),
    tableProcesses: (c.tableProcesses ?? []).map((p) => ({ id: p.id, name: p.name, args: JSON.parse(JSON.stringify(p.args ?? {})) })),
    plots: c.plots.map((p) => ({ id: p.id, name: p.name, type: p.type, keys: Object.keys(p.plot), data: (p.plot.data ?? []).map((d) => ({ keys: Object.keys(d), x: d.x?.refId, y: d.y?.refId, method: d.method, binSize: d.binSize, peak: d.peak ? JSON.parse(JSON.stringify(d.peak)) : null, visiblePeak: d.visiblePeak ? JSON.parse(JSON.stringify(d.visiblePeak)) : null, markers: (d.phaseMarkers ?? []).map((m) => ({ type: m.type, reg: JSON.parse(JSON.stringify(m.linearRegression ?? null)), n: m.markers?.length })) })) }))
  };
});
fs.writeFileSync(process.env.OUT || "/dev/stdout", JSON.stringify(info, null, 1));
console.log(Object.keys(await page.evaluate(() => Object.fromEntries(Object.keys(window.__core).map(k=>[k,1])))));
await browser.close();
