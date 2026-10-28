// Headless plot rasterisation: render a real AnCiR plot component to PNG (and SVG)
// using a short-lived Vite dev server + Playwright/Chromium. This is the faithful
// path the README always intended — the components run in a real browser exactly as
// in the GUI (onMount, axis auto-scaling, scoped styles), so the image matches.
//
// In-process (vite-node/happy-dom) rendering is NOT possible: client `mount()` is
// unavailable under SSR and server `render()` trips `effect_orphan` on the plots'
// onMount usage. A browser is required; Chromium ships with the app's Playwright.
import { fileURLToPath } from 'node:url';

// Resolved when a render starts, not at import: under vitest `import.meta.url` is not a file:
// URL, and resolving it at the top level made the module unimportable there.
const mcpPath = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const RENDER_URL_PATH = '/src/render/index.html';

/**
 * What the mounted plot has drawn, evaluated IN the render page (Playwright serialises it, so
 * it must stay self-contained): 'svg' once the svg the GUI's export reads (`#plot<id>`) exists;
 * 'html' for a plot that has drawn elements and no svg at all (the Table, a CSS grid of divs);
 * else null (nothing yet). A chart part-way through mounting has an svg or nothing, never only
 * html, so it is not mistaken for an HTML plot.
 * @returns {'svg'|'html'|null}
 */
export function drawnKind() {
	const id = window.__ancirPlotId;
	if (id != null && document.getElementById('plot' + id)) return 'svg';
	const app = document.getElementById('app');
	if (!app || app.querySelector('svg')) return null;
	return app.querySelector('*') ? 'html' : null;
}

/**
 * @param {{columns:Array<{id:number,name:string,type:string,values:number[]}>,
 *   plot:{type:string, inputs:object|number[]}, width:number, height:number}} payload
 * @param {{outBase:string}} opts  outBase: absolute path prefix; `.png`/`.svg` appended.
 * @returns {Promise<{png:string, svg:string|null, pngBytes:number, svgBytes?:number,
 *   width:number, height:number, note?:string}>}  svg is null for a plot that draws HTML
 *   (tableplot): it has no svg to export, so the PNG is a screenshot of the element.
 */
export async function renderPlot(payload, { outBase }) {
	const { createServer } = await import('vite');
	const { chromium } = await import('playwright');

	const server = await createServer({
		configFile: mcpPath('../../vite.config.js'),
		// Reuse the mcp workspace as root so /src/render/* + $lib resolve; quiet logs.
		root: mcpPath('../../'),
		logLevel: 'error',
		server: { port: 0 },
		// Its OWN dependency cache. The render page's first visit to a plot type with a new
		// dependency (d3-shape, say) makes Vite re-optimise and rewrite its deps folder; in the
		// shared node_modules/.vite that deleted files the MCP server's own vite-node was still
		// importing, and the server died mid-render ("ViteNodeServer: .../deps/svelte.js not found").
		cacheDir: mcpPath('../../node_modules/.vite-render'),
		// The browser needs its CommonJS dependencies (@stdlib, ...) pre-bundled, so discovery
		// stays on here (vite.config.js turns it off for vite-node, which runs in Node).
		optimizeDeps: { noDiscovery: false }
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
		// Wait for what this plot actually draws. A chart draws the svg the GUI's export reads
		// (`#plot<id>`, convertToImage); a Table draws HTML and no svg at all, so waiting for
		// `#app svg` timed out on every tableplot. Whichever appears first decides the path.
		const handle = await page
			.waitForFunction(drawnKind, null, { timeout: 10000 })
			.catch(async () => {
				const seen = await page.evaluate(() =>
					(document.getElementById('app')?.innerHTML ?? '').replace(/\s+/g, ' ').slice(0, 300)
				);
				throw new Error(
					`${payload.plot.type} drew neither its export svg nor HTML within 10 s. Page: ${seen || '(empty)'}`
				);
			});
		const drawn = await handle.jsonValue();

		const png = `${outBase}.png`;
		const svgPath = `${outBase}.svg`;
		const { statSync } = await import('node:fs');

		if (drawn === 'html') {
			// The GUI has no image export for an HTML plot (its export reads an svg), so this is
			// the browser's picture of the rendered element. PNG only: there is no svg to save.
			// Sized like the plot's node on the canvas (width x height, the table scrolling inside),
			// not as tall as every row.
			await page.evaluate(
				({ w, h }) =>
					Object.assign(document.getElementById('app').style, {
						width: `${w}px`,
						height: `${h}px`,
						overflow: 'hidden'
					}),
				{ w: payload.width ?? 700, h: payload.height ?? 420 }
			);
			await page.locator('#app').screenshot({ path: png });
			return {
				png,
				svg: null,
				pngBytes: statSync(png).size,
				width: payload.width,
				height: payload.height,
				note: `${payload.plot.type} draws HTML, not svg: PNG only.`
			};
		}

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
