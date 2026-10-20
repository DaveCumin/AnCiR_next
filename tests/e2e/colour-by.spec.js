import { test, expect } from '@playwright/test';

// Colour by on Scatterplot points (colour-by plan 2026-10-20, phase 1b), as a user does it on
// a shipped demo: switch Colour by on in the panel, drag the time column onto the series' new
// colour port on the canvas, and read the figure. Runs against a dev server (E2E_BASE_URL): it
// reads the session through the dev-only `window.__core` / `window.__history`.
//
// demo-tp-joindata: hourly ambient and hive temperatures on one binned time column, the
// MSPB-style case the feature is for. Colouring by the binned time reads it as hour of day.

test.use({ viewport: { width: 1500, height: 950 } });

async function load(page, demo) {
	await page.routeWebSocket(/.*/, () => {}); // no live reload mid-test
	await page.goto(`/?loadFromURL=${encodeURIComponent(`/sessions/demos/${demo}.json`)}`);
	await page.waitForFunction(
		() =>
			window.__core && window.__core.plots.length > 0 && !window.__appState.loadingState.isLoading,
		null,
		{ timeout: 60_000 }
	);
	await page.waitForTimeout(800);
}

const scatter = (page) =>
	page.evaluate(() => {
		const p = window.__core.plots.find((q) => q.type === 'scatterplot');
		return JSON.parse(JSON.stringify({ id: p.id, data: p.plot.data }));
	});

/** Drag a wire from one port dot to another, as a user does (pointer down, move, up). */
async function dragWire(page, from, to) {
	await from.scrollIntoViewIfNeeded();
	const a = await from.boundingBox();
	const b = await to.boundingBox();
	await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
	await page.mouse.down();
	for (let k = 1; k <= 12; k++) {
		await page.mouse.move(
			a.x + a.width / 2 + ((b.x - a.x) * k) / 12,
			a.y + a.height / 2 + ((b.y - a.y) * k) / 12
		);
	}
	await page.mouse.up();
	await page.waitForTimeout(800);
}

test('colour a series by the hour of day of a wired time column', async ({ page }) => {
	await load(page, 'demo-tp-joindata');
	const { id } = await scatter(page);

	// Workspace: select the plot, open its Data tab.
	await page.click('[data-testid=nav-workspace-view]');
	await page.waitForTimeout(1200);
	const svg = page.locator(`svg[id="plot${id}"]`);
	await svg.click({ position: { x: 5, y: 5 } });
	await page.waitForTimeout(400);
	if (!(await page.locator('text=Properties').first().isVisible())) {
		await page.mouse.click(1483, 443); // the panel's open tab on the right edge
	}
	await page.getByRole('tab', { name: 'Data' }).click();
	await page.waitForTimeout(500);

	// The demo draws lines only; Colour by colours points, so show them first.
	await page.getByRole('button', { name: 'Show points', exact: true }).first().click();
	await page.waitForTimeout(300);
	const before = await page.evaluate(() => window.__history.undoStack.length);
	await page.getByRole('checkbox', { name: 'Colour points by a column' }).first().check();
	await page.waitForTimeout(500);
	expect(await page.evaluate(() => window.__history.undoStack.length)).toBe(before + 1);
	const on = await scatter(page);
	expect(on.data[0].colourEncoding).toMatchObject({ id: 1, mode: 'auto', colormap: 'auto' });
	expect(on.data[0].colourBy.refId).toBe(-1);

	// Canvas: the series has a colour port; wire Bin Data's time output into it.
	await page.click('[data-testid=nav-workflow-view]');
	await page.waitForTimeout(1200);
	const port = page.locator(`[data-node-id="plot_${id}"][data-port-name="enc1_colour"]`);
	await expect(port).toHaveCount(1);
	const timeOut = await page.evaluate(() => {
		const tp = window.__core.tableProcesses.find((t) => t.name === 'BinnedData');
		return { tp: tp.id, col: tp.args.out.binnedx };
	});
	await dragWire(
		page,
		page.locator(
			`[data-node-id="tableprocess_${timeOut.tp}"][data-port-name="col_${timeOut.col}"][data-port-dir="out"]`
		),
		port
	);
	const wired = await scatter(page);
	expect(wired.data[0].colourBy.refId).toBe(timeOut.col);
	expect(await page.evaluate(() => window.__history.undoStack.length)).toBe(before + 2);

	// The figure: coloured points in several buckets, and the colour bar names the hour.
	await page.click('[data-testid=nav-workspace-view]');
	await page.waitForTimeout(1500);
	const buckets = svg.locator('path[data-colour-bucket]');
	expect(await buckets.count()).toBeGreaterThan(10);
	const fills = await buckets.evaluateAll((ps) => ps.map((p) => p.getAttribute('fill')));
	expect(new Set(fills).size).toBe(fills.length);
	const bar = svg.locator('.colour-scale');
	await expect(bar).toHaveCount(1);
	await expect(bar.locator('.colour-scale-label')).toHaveText('Hour of day (UTC)');
	expect(await bar.locator('.colour-scale-tick').allTextContents()).toEqual([
		'24',
		'18',
		'12',
		'6',
		'0'
	]);
	// The bar sits beside the plot, clear of the legend and of the plot area.
	const barBox = await bar.boundingBox();
	const legendBox = await svg.locator('g.plot-legend').first().boundingBox();
	expect(legendBox).not.toBeNull();
	{
		const overlap =
			barBox.x < legendBox.x + legendBox.width &&
			legendBox.x < barBox.x + barBox.width &&
			barBox.y < legendBox.y + legendBox.height &&
			legendBox.y < barBox.y + barBox.height;
		expect(overlap).toBe(false);
	}
	const svgBox = await svg.boundingBox();
	expect(barBox.x + barBox.width).toBeLessThanOrEqual(svgBox.x + svgBox.width + 0.5);

	// One undo takes the wire back: the points return to the series colour, the bar goes.
	await page.keyboard.press('ControlOrMeta+z');
	await page.waitForTimeout(800);
	expect((await scatter(page)).data[0].colourBy.refId).toBe(-1);
	await expect(svg.locator('.colour-scale')).toHaveCount(0);
	expect(await svg.locator('path[data-colour-bucket]').count()).toBe(0);
});

// Phase 1c: coloured LINES. The hysteresis demo (generateDemos, workflow colour-by-hysteresis):
// hive against air temperature, points and line coloured by hour of day, with a logger outage
// on day 3 that leaves blank hours. The line must break there, and "Colour the line too" is one
// undo step that switches the line back to the series colour.
test('a hysteresis loop with a coloured line that breaks at a gap', async ({ page }) => {
	await load(page, 'demo-workflow-colour-by-hysteresis');
	await page.click('[data-testid=nav-workspace-view]');
	await page.waitForTimeout(1500);
	const loop = await page.evaluate(() => {
		const p = window.__core.plots.find((q) => q.name.startsWith('Hive against air'));
		const d = p.plot.data[0];
		const xs = d.xData;
		const ys = d.yData;
		const ok = (i) => xs[i] != null && ys[i] != null && !isNaN(xs[i]) && !isNaN(ys[i]);
		let joins = 0;
		let gaps = 0;
		for (let i = 1; i < Math.min(xs.length, ys.length); i++) {
			if (ok(i - 1) && ok(i)) joins++;
			if (!ok(i)) gaps++;
		}
		return { id: p.id, joins, gaps, colourLine: d.colourEncoding.colourLine };
	});
	expect(loop.colourLine).toBe(true);
	expect(loop.gaps).toBeGreaterThan(0); // the outage is in the data
	const svg = page.locator(`svg[id="plot${loop.id}"]`);
	await svg.scrollIntoViewIfNeeded();
	const lineBuckets = svg.locator('path[data-line-colour-bucket]');
	expect(await lineBuckets.count()).toBeGreaterThan(10);
	// One M/L pair per join of two valid rows: none across the gap.
	const segments = await lineBuckets.evaluateAll((ps) =>
		ps.reduce((n, p) => n + (p.getAttribute('d').match(/M/g)?.length ?? 0), 0)
	);
	expect(segments).toBe(loop.joins);
	// Solid, round caps; the points are coloured too, and one colour bar serves both.
	for (const cap of await lineBuckets.evaluateAll((ps) =>
		ps.map((p) => p.getAttribute('stroke-linecap'))
	))
		expect(cap).toBe('round');
	expect(await svg.locator('path[data-colour-bucket]').count()).toBeGreaterThan(10);
	await expect(svg.locator('.colour-scale')).toHaveCount(1);
	await expect(svg.locator('.colour-scale .colour-scale-label')).toHaveText('Hour of day (UTC)');
	if (process.env.E2E_SHOTS)
		await svg.screenshot({ path: `${process.env.E2E_SHOTS}/e2e-loop.png` });

	// The panel: "Colour the line too" off is ONE undo step; the line returns to one path.
	await svg.click({ position: { x: 5, y: 5 } });
	await page.waitForTimeout(400);
	if (!(await page.locator('text=Properties').first().isVisible())) {
		await page.mouse.click(1483, 443);
	}
	await page.getByRole('tab', { name: 'Data' }).click();
	await page.waitForTimeout(500);
	const box = page.getByRole('checkbox', { name: 'Colour the line by the same column' }).first();
	await expect(box).toBeChecked();
	const before = await page.evaluate(() => window.__history.undoStack.length);
	await box.uncheck();
	await page.waitForTimeout(500);
	expect(await page.evaluate(() => window.__history.undoStack.length)).toBe(before + 1);
	await expect(svg.locator('path[data-line-colour-bucket]')).toHaveCount(0);
	// Undo brings the coloured line back.
	await page.keyboard.press('ControlOrMeta+z');
	await page.waitForTimeout(800);
	expect(await svg.locator('path[data-line-colour-bucket]').count()).toBeGreaterThan(10);
});
