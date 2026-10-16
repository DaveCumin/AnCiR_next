import { test, expect } from '@playwright/test';

// Size limits that used to fail silently, crossed in a real browser (the unit tests cover the
// maths; these cover what the browser does with it):
//   - a table of 1,000,000 rows scrolls to its last row (the scroll spacer used to pass
//     Chrome's 33.5 million px element-height cap, so rows past about 762,000 of 44 px were
//     unreachable; virtualScroll.js);
//   - an actogram with more rows than its plot is tall draws (a year of 1 min data in a
//     canvas node used to be blank: the row gaps ate the whole height), and one past the
//     20,000-row limit says why on the plot instead of staying blank.
//
// Dev-server only (state and modules through the dev-only window.__core and Vite's module
// URLs):  E2E_BASE_URL=http://localhost:5173 pnpm test:e2e tests/e2e/size-limits.spec.js

test.use({ viewport: { width: 1400, height: 1000 } });

async function blankCanvas(page) {
	await page.goto('/');
	await page.waitForFunction(() => window.__core, null, { timeout: 60_000 });
	await page.locator('button.primary-card', { hasText: 'Start with a blank canvas' }).click();
	// Import the app's own module instances (the URLs the page loaded), not second copies.
	await page.evaluate(() => {
		window.__imp = (path) => {
			const u = performance
				.getEntriesByType('resource')
				.map((e) => e.name)
				.find((n) => n.includes(path + '?') || n.endsWith(path));
			return import(/* @vite-ignore */ u ?? path);
		};
	});
}

/** Push a number or time column and return its id. */
async function addColumns(page, specs) {
	return page.evaluate(async (specs) => {
		const { Column } = await window.__imp('/src/lib/core/Column.svelte');
		const { pushObj, core } = await window.__imp('/src/lib/core/core.svelte.js');
		return specs.map(({ name, type, n, start, step, pattern }) => {
			const c = new Column({ type, data: -1 });
			c.customName = name;
			core.rawData.set(
				c.id,
				Array.from({ length: n }, (_, i) =>
					pattern === 'activity'
						? ((i * step) % 24 > 6 && (i * step) % 24 < 18 ? 40 : 4) + (i % 7)
						: start + i * step
				)
			);
			c.data = c.id;
			pushObj(c);
			return c.id;
		});
	}, specs);
}

async function addPlot(page, type, plot, series = []) {
	await page.evaluate(
		async ({ type, plot, series }) => {
			const { Plot } = await window.__imp('/src/lib/core/Plot.svelte');
			const { pushObj } = await window.__imp('/src/lib/core/core.svelte.js');
			const p = new Plot({ type, name: type, x: 300, y: 60, width: 500, height: 500, plot });
			for (const [x, y] of series) p.plot.addData({ x: { refId: x }, y: { refId: y } });
			pushObj(p);
		},
		{ type, plot, series }
	);
}

test('a 1,000,000-row table scrolls to its last row', async ({ page }) => {
	await blankCanvas(page);
	const [id] = await addColumns(page, [
		{ name: 'row', type: 'number', n: 1_000_000, start: 0, step: 1 }
	]);
	await addPlot(page, 'tableplot', { columnRefs: [id], showCol: [true] });
	const list = page.locator('.vlist').first();
	await expect(list).toBeVisible({ timeout: 30_000 });
	const r = await list.evaluate(async (el) => {
		el.scrollTop = el.scrollHeight;
		el.dispatchEvent(new Event('scroll'));
		await new Promise((res) => setTimeout(res, 500));
		const box = el.getBoundingClientRect();
		const rows = [...el.querySelectorAll('.vlist-row')].filter((rw) => {
			const q = rw.getBoundingClientRect();
			return q.bottom > box.top + 1 && q.top < box.bottom - 1;
		});
		return { scrollHeight: el.scrollHeight, last: rows.at(-1)?.textContent.trim() ?? '' };
	});
	expect(r.scrollHeight).toBeLessThanOrEqual(10_000_000);
	expect(Number(r.last)).toBe(999_999);
});

test('an actogram with more rows than pixels draws; past 20,000 rows it says why', async ({
	page
}) => {
	await blankCanvas(page);
	// A year of 1 min samples: 365 rows in a canvas node a few hundred px tall.
	const t0 = Date.UTC(2026, 0, 5);
	const [t, y] = await addColumns(page, [
		{ name: 't', type: 'time', n: 525_600, start: t0, step: 60_000 },
		{ name: 'activity', type: 'number', n: 525_600, step: 1 / 60, pattern: 'activity' }
	]);
	await addPlot(page, 'actogram', { data: [] }, [[t, y]]);
	const image = page.locator('svg image.actogram-raster');
	await expect(image).toHaveCount(1, { timeout: 30_000 });
	const box = await image.boundingBox();
	expect(box.height).toBeGreaterThan(100);
	expect(await image.getAttribute('href')).toMatch(/^data:image\/png;base64,/);

	// Plain numbers read as hours: 480,024 one-second samples need 20,001 rows of 24 h.
	await page.evaluate(() => (window.__core.plots = []));
	const [ts, ys] = await addColumns(page, [
		{ name: 'seconds', type: 'number', n: 480_024, start: 0, step: 1 },
		{ name: 'activity', type: 'number', n: 480_024, step: 1, pattern: 'activity' }
	]);
	await addPlot(page, 'actogram', { data: [] }, [[ts, ys]]);
	await expect(page.locator('.actogram-refused')).toContainText(
		'Not drawn: the data span 20,001 periods of 24 h'
	);
});
