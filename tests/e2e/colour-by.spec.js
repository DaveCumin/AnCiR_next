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

// ---- Phase 2: Colour by on Q-Q, Mean ± SEM and Circular phase (plan section 3.12) ----
// Each on its shipped demo, as a user does it: switch Colour by on in the series' panel, drag a
// column onto the series' new colour port on the canvas, and read the figure. Each checks that
// the colours follow the right rows (or groups) in the real browser, that the colour bar sits
// clear of the legend (and of the clock's hour labels) inside the figure, and that undo takes
// the wire back.

/** Select the plot in the workspace and open its Data tab. */
async function openData(page, svg) {
	await svg.click({ position: { x: 5, y: 5 } });
	await page.waitForTimeout(400);
	if (!(await page.locator('text=Properties').first().isVisible())) {
		await page.mouse.click(1483, 443); // the panel's open tab on the right edge
	}
	await page.getByRole('tab', { name: 'Data' }).click();
	await page.waitForTimeout(500);
}

/** Open the plot's Data tab in the workspace and switch Colour by on for its first series. */
async function colourFirstSeries(page, id) {
	await page.click('[data-testid=nav-workspace-view]');
	await page.waitForTimeout(1200);
	const svg = page.locator(`svg[id="plot${id}"]`);
	await openData(page, svg);
	const before = await page.evaluate(() => window.__history.undoStack.length);
	await page.getByRole('checkbox', { name: 'Colour points by a column' }).first().check();
	await page.waitForTimeout(500);
	expect(await page.evaluate(() => window.__history.undoStack.length)).toBe(before + 1);
	return { svg, before };
}

/** Drag the column `colId` from its data node onto the series' colour port. */
async function wireColumn(page, id, colId) {
	await page.click('[data-testid=nav-workflow-view]');
	await page.waitForTimeout(1200);
	const port = page.locator(`[data-node-id="plot_${id}"][data-port-name="enc1_colour"]`);
	await expect(port).toHaveCount(1);
	// A raw column's own data node (its `column` output), as the demo's columns are.
	const from = page.locator(
		`[data-node-id="data_${colId}"][data-port-name="column"][data-port-dir="out"]`
	);
	await dragWire(page, from, port);
	await page.click('[data-testid=nav-workspace-view]');
	await page.waitForTimeout(1500);
}

/** The colour bar lies inside the figure and clear of the series legend. */
async function barClear(svg) {
	const bar = svg.locator('.colour-scale');
	await expect(bar).toHaveCount(1);
	const barBox = await bar.boundingBox();
	const svgBox = await svg.boundingBox();
	expect(barBox.x).toBeGreaterThanOrEqual(svgBox.x - 0.5);
	expect(barBox.y).toBeGreaterThanOrEqual(svgBox.y - 0.5);
	expect(barBox.x + barBox.width).toBeLessThanOrEqual(svgBox.x + svgBox.width + 0.5);
	expect(barBox.y + barBox.height).toBeLessThanOrEqual(svgBox.y + svgBox.height + 0.5);
	const legend = svg.locator('g.plot-legend').first();
	if (await legend.count()) {
		const l = await legend.boundingBox();
		const overlap =
			barBox.x < l.x + l.width &&
			l.x < barBox.x + barBox.width &&
			barBox.y < l.y + l.height &&
			l.y < barBox.y + barBox.height;
		expect(overlap).toBe(false);
	}
	return barBox;
}

const shot = async (svg, name) => {
	if (process.env.E2E_SHOTS) await svg.screenshot({ path: `${process.env.E2E_SHOTS}/${name}.png` });
};

test('Q-Q: each sorted sample keeps its own row’s colour', async ({ page }) => {
	await load(page, 'demo-qqplot-normality');
	const { id, normal, skewed } = await page.evaluate(() => {
		const p = window.__core.plots.find((q) => q.type === 'qqplot');
		return { id: p.id, normal: p.plot.data[0].column.refId, skewed: p.plot.data[1].column.refId };
	});
	const { svg, before } = await colourFirstSeries(page, id);
	// Colour the normal sample by itself: the colour order IS the sort order, so the drawn
	// samples' colours must rise with their y (a mark coloured by its position would not care,
	// so pair it with a check against the rows).
	await wireColumn(page, id, normal);
	const state = await page.evaluate((pid) => {
		const d = window.__core.plots.find((q) => q.id === pid).plot.data[0];
		const rows = d.qq.order;
		const vals = d.colourEncoded.values;
		return {
			refId: d.colourBy.refId,
			// Each mark's colour value is its own row's.
			follows: rows.every((r, k) => d.colourMarkValues[k] === vals[r]),
			// Sorted by value and coloured by the same value: never decreasing.
			monotone: [...d.colourIdx].every((b, k, a) => k === 0 || b >= a[k - 1])
		};
	}, id);
	expect(state).toEqual({ refId: normal, follows: true, monotone: true });
	const buckets = svg.locator('path[data-colour-bucket]');
	expect(await buckets.count()).toBeGreaterThan(10);
	// The lowest sample is in the first colour, the highest in the last.
	const ends = await buckets.evaluateAll((ps) => {
		const pts = ps.flatMap((p) =>
			[...p.getAttribute('d').matchAll(/M([-\d.e]+) ([-\d.e]+)m/g)].map((m) => ({
				y: Number(m[2]),
				key: p.getAttribute('data-colour-bucket')
			}))
		);
		pts.sort((a, b) => a.y - b.y);
		return { top: pts[0].key, bottom: pts[pts.length - 1].key };
	});
	expect(ends).toEqual({ top: 'b63', bottom: 'b0' });
	await barClear(svg);
	await shot(svg, 'e2e-qq');
	void skewed;
	await page.keyboard.press('ControlOrMeta+z');
	await page.waitForTimeout(800);
	expect(await page.evaluate(() => window.__history.undoStack.length)).toBe(before + 1);
	await expect(svg.locator('.colour-scale')).toHaveCount(0);
});

test('Mean ± SEM: each group mean in its group’s mean colour, the line too', async ({ page }) => {
	await load(page, 'demo-meansem-by-day');
	const { id, day } = await page.evaluate(() => {
		const p = window.__core.plots.find((q) => q.type === 'meansem');
		return { id: p.id, day: p.plot.data[0].x.refId };
	});
	const { svg } = await colourFirstSeries(page, id);
	await wireColumn(page, id, day);
	// Coloured by its own grouping column, each group's colour value is the day itself.
	const state = await page.evaluate((pid) => {
		const d = window.__core.plots.find((q) => q.id === pid).plot.data[0];
		return {
			groups: d.stats.length,
			sameAsKey: d.stats.every((s, k) => Number(s.x) === d.colourMarkValues[k])
		};
	}, id);
	expect(state.sameAsKey).toBe(true);
	const buckets = svg.locator('path[data-colour-bucket]');
	expect(await buckets.count()).toBe(state.groups);
	// Error bars keep their colour.
	const errs = await svg
		.locator('line[stroke-width]')
		.evaluateAll((ls) => [...new Set(ls.map((l) => l.getAttribute('stroke')))]);
	expect(errs.length).toBe(1);
	await barClear(svg);

	// The connecting line, coloured too: one segment per pair of neighbouring means.
	await openData(page, svg);
	await page.getByRole('button', { name: 'Show connecting line', exact: true }).first().click();
	await page.waitForTimeout(300);
	await page.getByRole('checkbox', { name: 'Colour the line by the same column' }).first().check();
	await page.waitForTimeout(600);
	const segs = await svg
		.locator('path[data-line-colour-bucket]')
		.evaluateAll((ps) =>
			ps.reduce((n, p) => n + (p.getAttribute('d').match(/M/g)?.length ?? 0), 0)
		);
	expect(segs).toBe(state.groups - 1);
	await shot(svg, 'e2e-meansem');
});

test('Circular phase: every dot keeps its own row’s colour through the placement', async ({
	page
}) => {
	await load(page, 'demo-circular-phase-two-groups');
	const { id, phaseA } = await page.evaluate(() => {
		const p = window.__core.plots.find((q) => q.type === 'circularphase');
		return { id: p.id, phaseA: p.plot.data[0].y.refId };
	});
	const { svg } = await colourFirstSeries(page, id);
	// Group A coloured by its own phase: every dot's colour must match where it sits on the
	// clock, in every placement (stack and bin reorder the dots).
	await wireColumn(page, id, phaseA);
	for (const placement of ['stack', 'bin', 'rim']) {
		const bad = await page.evaluate(
			async ({ pid, placement }) => {
				const p = window.__core.plots.find((q) => q.id === pid);
				p.plot.placement = placement;
				await new Promise((r) => setTimeout(r, 300));
				const d = p.plot.data[0];
				const svgEl = document.getElementById('plot' + pid);
				const ring = svgEl.querySelector('circle');
				const cx = Number(ring.getAttribute('cx'));
				const cy = Number(ring.getAttribute('cy'));
				const period = p.plot.displayPeriod;
				const bw = period / Math.max(1, Math.round(period / p.plot.binWidth));
				const vals = d.colourMarkValues;
				let wrong = 0;
				let seen = 0;
				for (const path of svgEl.querySelectorAll('path[data-colour-bucket]')) {
					const key = path.getAttribute('data-colour-bucket');
					for (const m of path.getAttribute('d').matchAll(/M([-\d.e]+) ([-\d.e]+)m/g)) {
						let th = Math.atan2(Number(m[1]) - cx, -(Number(m[2]) - cy));
						if (th < 0) th += 2 * Math.PI;
						const at = (th / (2 * Math.PI)) * period;
						// The rows whose phase lands here (the bin centre when binned).
						const rows = [...vals.keys()].filter((r) => {
							const v = d.placeValues[r];
							const want = placement === 'bin' ? (Math.floor(v / bw) + 0.5) * bw : v;
							const diff = Math.abs(((want - at + period / 2) % period) - period / 2);
							return diff < 1e-3;
						});
						seen++;
						if (!rows.some((r) => `b${d.colourIdx[r]}` === key)) wrong++;
					}
				}
				return { wrong, seen };
			},
			{ pid: id, placement }
		);
		expect(bad.seen, placement).toBeGreaterThan(5);
		expect(bad.wrong, placement).toBe(0);
		await shot(svg, `e2e-circular-${placement}`);
	}
	// Beside the clock, past its right-hand hour label, clear of the legend.
	const barBox = await barClear(svg);
	// The outer ring is the largest circle; its "6" label reaches about 21 px past it.
	const ringRight = await svg.evaluate((el) => {
		const rings = [...el.querySelectorAll('circle')];
		const outer = rings.reduce((a, b) =>
			Number(b.getAttribute('r')) > Number(a.getAttribute('r')) ? b : a
		);
		const r = outer.getBoundingClientRect();
		return r.x + r.width;
	});
	expect(barBox.x).toBeGreaterThan(ringRight + 20);
});

// ---- Phase 3: Size by (plan section 3.7), on every host -----------------------------------
// The hysteresis demo ships sized by humidity; the other hosts are sized here as a user does it
// (switch Size by on in the series' panel, drag a column onto the new size port). Each checks
// in the real browser that every point is drawn at its exact radius, the largest layer first,
// that the size key, the colour bar and the legend do not overlap and stay inside the figure,
// and that the size panel's edits are single undo steps.

/** Every sized marker drawn: { r, layer } read from circle paths (`m-r 0`). */
const sizedMarks = (svg) =>
	svg.locator('path[data-size-layer]').evaluateAll((ps) =>
		ps.flatMap((p) =>
			[...p.getAttribute('d').matchAll(/M([-\d.e]+) ([-\d.e]+)m-([-\d.e]+) 0/g)].map((m) => ({
				x: Number(m[1]),
				y: Number(m[2]),
				r: Number(m[3]),
				layer: Number(p.getAttribute('data-size-layer'))
			}))
		)
	);

/** The size key, the colour bar and the legend: inside the figure, no two overlapping. */
async function keysClear(svg) {
	const svgBox = await svg.boundingBox();
	const boxes = {};
	for (const [name, sel] of [
		['size', 'g.size-key'],
		['bar', '.colour-scale'],
		['legend', 'g.plot-legend']
	]) {
		const loc = svg.locator(sel).first();
		if (await loc.count()) boxes[name] = await loc.boundingBox();
	}
	expect(boxes.size).toBeTruthy();
	for (const b of Object.values(boxes)) {
		expect(b.x).toBeGreaterThanOrEqual(svgBox.x - 0.5);
		expect(b.y).toBeGreaterThanOrEqual(svgBox.y - 0.5);
		expect(b.x + b.width).toBeLessThanOrEqual(svgBox.x + svgBox.width + 0.5);
		expect(b.y + b.height).toBeLessThanOrEqual(svgBox.y + svgBox.height + 0.5);
	}
	const names = Object.keys(boxes);
	for (let i = 0; i < names.length; i++) {
		for (let j = i + 1; j < names.length; j++) {
			const a = boxes[names[i]];
			const b = boxes[names[j]];
			const overlap =
				a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
			expect(overlap, `${names[i]} vs ${names[j]}`).toBe(false);
		}
	}
	return boxes;
}

test('the hysteresis loop sized by humidity: exact radii, largest first, a size key', async ({
	page
}) => {
	await load(page, 'demo-workflow-colour-by-hysteresis');
	await page.click('[data-testid=nav-workspace-view]');
	await page.waitForTimeout(1500);
	const loop = await page.evaluate(() => {
		const p = window.__core.plots.find((q) => q.name.startsWith('Hive against air'));
		const d = p.plot.data[0];
		return {
			id: p.id,
			radii: [...d.sizeRadii.r],
			range: d.sizeRadiusRange,
			title: d.sizeTitle,
			humidity: d.sizeBy.refId
		};
	});
	expect(loop.range).toEqual({ rMin: 1.5, rMax: 6 });
	const svg = page.locator(`svg[id="plot${loop.id}"]`);
	await svg.scrollIntoViewIfNeeded();
	const marks = await sizedMarks(svg);
	expect(marks.length).toBeGreaterThan(50);
	// Every drawn radius is one the scale computed (to the path's printed precision).
	const want = new Set(loop.radii.map((r) => r.toFixed(6)));
	for (const m of marks) expect(want.has(m.r.toFixed(6)), String(m.r)).toBe(true);
	expect(Math.max(...marks.map((m) => m.r))).toBeCloseTo(6, 6);
	expect(Math.min(...marks.map((m) => m.r))).toBeCloseTo(1.5, 6);
	// Largest layer first in the DOM.
	const layers = marks.map((m) => m.layer);
	expect(layers).toEqual([...layers].sort((a, b) => b - a));
	// The key: three reference circles under the title, beside the colour bar.
	const key = svg.locator('g.size-key');
	await expect(key).toHaveCount(1);
	expect(await key.locator('g.size-key-row').count()).toBeGreaterThanOrEqual(3);
	const title = (await key.locator('.size-key-title').allTextContents()).join(' ');
	expect(title).toBe(loop.title);
	const boxes = await keysClear(svg);
	expect(boxes.size.y).toBeGreaterThanOrEqual(boxes.bar.y + boxes.bar.height - 0.5);
	await shot(svg, 'e2e-size-loop');

	// The panel: Largest is one undo step and redraws every point; undo restores it.
	await openData(page, svg);
	await expect(
		page.getByRole('checkbox', { name: 'Size points by a column' }).first()
	).toBeChecked();
	const before = await page.evaluate(() => window.__history.undoStack.length);
	const largest = page.getByLabel('Largest (px)').first();
	await largest.fill('9');
	await largest.press('Enter');
	await page.waitForTimeout(600);
	expect(await page.evaluate(() => window.__history.undoStack.length)).toBe(before + 1);
	expect(Math.max(...(await sizedMarks(svg)).map((m) => m.r))).toBeCloseTo(9, 6);
	await page.keyboard.press('Escape');
	await svg.click({ position: { x: 5, y: 5 } });
	await page.keyboard.press('ControlOrMeta+z');
	await page.waitForTimeout(800);
	expect(Math.max(...(await sizedMarks(svg)).map((m) => m.r))).toBeCloseTo(6, 6);

	// Off, then on again and wired on the canvas through the series' size port.
	await openData(page, svg);
	await page.getByRole('checkbox', { name: 'Size points by a column' }).first().uncheck();
	await page.waitForTimeout(500);
	await expect(svg.locator('path[data-size-layer]')).toHaveCount(0);
	await expect(svg.locator('g.size-key')).toHaveCount(0);
	await page.getByRole('checkbox', { name: 'Size points by a column' }).first().check();
	await page.waitForTimeout(500);
	await page.click('[data-testid=nav-workflow-view]');
	await page.waitForTimeout(1200);
	const port = page.locator(`[data-node-id="plot_${loop.id}"][data-port-name="enc1_size"]`);
	await expect(port).toHaveCount(1);
	const out = await page.evaluate((col) => {
		const tp = window.__core.tableProcesses.find((t) =>
			Object.values(t.args.out ?? {}).includes(col)
		);
		return { tp: tp.id };
	}, loop.humidity);
	await dragWire(
		page,
		page.locator(
			`[data-node-id="tableprocess_${out.tp}"][data-port-name="col_${loop.humidity}"][data-port-dir="out"]`
		),
		port
	);
	expect(
		await page.evaluate((pid) => {
			const d = window.__core.plots.find((q) => q.id === pid).plot.data[0];
			return d.sizeBy.refId;
		}, loop.id)
	).toBe(loop.humidity);
	await page.click('[data-testid=nav-workspace-view]');
	await page.waitForTimeout(1500);
	expect((await sizedMarks(svg)).length).toBe(marks.length);
});

/** Switch Size by on for the plot's first series and wire `colId` into its size port. */
async function sizeFirstSeries(page, id, colId) {
	await page.click('[data-testid=nav-workspace-view]');
	await page.waitForTimeout(1200);
	const svg = page.locator(`svg[id="plot${id}"]`);
	await openData(page, svg);
	const before = await page.evaluate(() => window.__history.undoStack.length);
	await page.getByRole('checkbox', { name: 'Size points by a column' }).first().check();
	await page.waitForTimeout(500);
	expect(await page.evaluate(() => window.__history.undoStack.length)).toBe(before + 1);
	await page.click('[data-testid=nav-workflow-view]');
	await page.waitForTimeout(1200);
	const port = page.locator(`[data-node-id="plot_${id}"][data-port-name="enc1_size"]`);
	await expect(port).toHaveCount(1);
	await dragWire(
		page,
		page.locator(`[data-node-id="data_${colId}"][data-port-name="column"][data-port-dir="out"]`),
		port
	);
	await page.click('[data-testid=nav-workspace-view]');
	await page.waitForTimeout(1500);
	return svg;
}

// The size column: [series, field] of a column already in the plot (the second Q-Q sample,
// the Mean +/- SEM values, the Circular phase group A phases).
for (const [host, demo, type, [series, field]] of [
	['Q-Q', 'demo-qqplot-normality', 'qqplot', [1, 'column']],
	['Mean ± SEM', 'demo-meansem-by-day', 'meansem', [0, 'y']],
	['Circular phase', 'demo-circular-phase-two-groups', 'circularphase', [0, 'y']]
]) {
	test(`${host}: sized points at their rows’ exact radii, with a size key clear of the rest`, async ({
		page
	}) => {
		await load(page, demo);
		const { id, col } = await page.evaluate(
			({ type, series, field }) => {
				const p = window.__core.plots.find((q) => q.type === type);
				return { id: p.id, col: p.plot.data[series][field].refId };
			},
			{ type, series, field }
		);
		const svg = await sizeFirstSeries(page, id, col);
		const radii = await page.evaluate((pid) => {
			const d = window.__core.plots.find((q) => q.id === pid).plot.data[0];
			return [...d.sizeRadii.r];
		}, id);
		const marks = await sizedMarks(svg);
		expect(marks.length).toBeGreaterThan(2);
		const want = new Set(radii.map((r) => r.toFixed(6)));
		for (const m of marks) expect(want.has(m.r.toFixed(6)), String(m.r)).toBe(true);
		const layers = marks.map((m) => m.layer);
		expect(layers).toEqual([...layers].sort((a, b) => b - a));
		await keysClear(svg);
		await shot(svg, `e2e-size-${type}`);
	});
}
