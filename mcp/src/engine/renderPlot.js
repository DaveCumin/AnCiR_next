// Headless plot rasterisation: render a real AnCiR plot component to PNG (and SVG)
// using a short-lived Vite dev server + Playwright/Chromium. This is the faithful
// path the README always intended — the components run in a real browser exactly as
// in the GUI (onMount, axis auto-scaling, scoped styles), so the image matches.
//
// In-process (vite-node/happy-dom) rendering is NOT possible: client `mount()` is
// unavailable under SSR and server `render()` trips `effect_orphan` on the plots'
// onMount usage. A browser is required; Chromium ships with the app's Playwright.
import { fileURLToPath } from 'node:url';

const VITE_CONFIG = fileURLToPath(new URL('../../vite.config.js', import.meta.url));
const RENDER_URL_PATH = '/src/render/index.html';

/**
 * @param {{columns:Array<{id:number,name:string,type:string,values:number[]}>,
 *   plot:{type:string, inputs:object|number[]}, width:number, height:number}} payload
 * @param {{outBase:string}} opts  outBase: absolute path prefix; `.png`/`.svg` appended.
 * @returns {Promise<{png:string, svg:string, bytes:number, width:number, height:number}>}
 */
export async function renderPlot(payload, { outBase }) {
	const { createServer } = await import('vite');
	const { chromium } = await import('playwright');

	const server = await createServer({
		configFile: VITE_CONFIG,
		// Reuse the mcp workspace as root so /src/render/* + $lib resolve; quiet logs.
		root: fileURLToPath(new URL('../../', import.meta.url)),
		logLevel: 'error',
		server: { port: 0 }
	});
	await server.listen();
	const address = server.httpServer.address();
	const port = typeof address === 'object' && address ? address.port : server.config.server.port;
	const url = `http://localhost:${port}${RENDER_URL_PATH}`;

	const browser = await chromium.launch();
	try {
		const page = await browser.newPage({
			viewport: { width: (payload.width ?? 700) + 60, height: (payload.height ?? 420) + 60 },
			deviceScaleFactor: 2 // crisp PNG
		});
		await page.addInitScript((d) => {
			window.__ANCIR_RENDER__ = d;
		}, payload);
		await page.goto(url, { waitUntil: 'load' });
		await page.waitForFunction(() => window.__ancirReady || window.__ancirError, null, {
			timeout: 30000
		});
		const err = await page.evaluate(() => window.__ancirError);
		if (err) throw new Error(`render page failed: ${err}`);
		await page.locator('#app svg').first().waitFor({ state: 'attached', timeout: 10000 });

		const png = `${outBase}.png`;
		const svgPath = `${outBase}.svg`;

		// Rasterise through AnCiR's own export function (convertToImage), so the
		// output is byte-for-byte what the GUI's export buttons produce. Each call
		// triggers a browser download (link.click()); catch it with Playwright.
		const exportVia = async (filetype, dest) => {
			const [download] = await Promise.all([
				page.waitForEvent('download', { timeout: 30000 }),
				page.evaluate((ft) => window.__ancirExport(ft), filetype)
			]);
			await download.saveAs(dest);
		};
		await exportVia('png', png);
		await exportVia('svg', svgPath);

		const { statSync } = await import('node:fs');
		return {
			png,
			svg: svgPath,
			pngBytes: statSync(png).size,
			svgBytes: statSync(svgPath).size,
			width: payload.width,
			height: payload.height
		};
	} finally {
		await browser.close();
		await server.close();
	}
}
