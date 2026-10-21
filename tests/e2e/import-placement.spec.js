import { test, expect } from '@playwright/test';
import { openApp, startBlankCanvas, isThirdPartyNoise } from './helpers.js';

// Every new canvas node (an imported table, a palette plot, analysis or transform) lands in
// the middle of the canvas view, at the current pan and zoom, so the user sees what they just
// added. A node added where another already sits steps CASCADE_STEP canvas px down and right
// (canvasPlacement.js), so two adds in a row never sit exactly on top of each other.

const CASCADE_STEP = 24;

function csv(columns, rows = 48) {
	const head = ['DateTime', ...columns];
	const out = [head.join(',')];
	const t0 = Date.UTC(2024, 0, 1);
	for (let i = 0; i < rows; i++) {
		const t = new Date(t0 + i * 30 * 60000).toISOString().replace('T', ' ').slice(0, 19);
		out.push([t, ...columns.map((_, j) => (i * (j + 3)) % 17)].join(','));
	}
	return Buffer.from(out.join('\n'));
}

const FILES = {
	first: csv(['Activity', 'Light']),
	second: csv(['Temp', 'Steps', 'Wheel']),
	third: csv(['Heart']),
	partA: csv(['Activity']),
	partB: csv(['Activity'])
};
const file = (name) => ({ name: `${name}.csv`, mimeType: 'text/csv', buffer: FILES[name] });

/** Ids of the canvas nodes on screen now. */
function nodeIds(page) {
	return page.evaluate(() =>
		[...document.querySelectorAll('.workflow-node-wrapper')].map((el) => el.dataset.nodeId)
	);
}

/** Run `add`, then return the ids of the nodes it created. */
async function added(page, add, count = 1) {
	const before = await nodeIds(page);
	await add();
	await expect(page.locator('.workflow-node-wrapper')).toHaveCount(before.length + count, {
		timeout: 30000
	});
	// The second placement pass (by drawn size) runs a tick after the node renders.
	await page.waitForTimeout(300);
	return (await nodeIds(page)).filter((id) => !before.includes(id));
}

async function importFiles(page, names, { fromStart = false } = {}) {
	return added(page, async () => {
		if (fromStart) {
			await page.locator('button.primary-card', { hasText: 'Import data' }).click();
		} else {
			// The canvas palette's Import entry.
			await page.getByTestId('palette-trigger').click();
			await page.getByTestId('palette-item-import-file').click();
		}
		await page.locator('#fileInput').setInputFiles(names.map(file));
		await expect(page.locator('#confirmImport')).toBeVisible({ timeout: 30000 });
		await page.locator('#confirmImport').click();
		await expect(page.locator('dialog[open]')).toHaveCount(0, { timeout: 30000 });
	});
}

function pick(page, type) {
	return added(page, async () => {
		await page.getByTestId('palette-trigger').click();
		await page.getByTestId(`palette-item-${type}`).click();
	});
}

/** A canvas node's on-screen box and centre. */
async function nodeBox(page, id) {
	const r = await page.locator(`.workflow-node-wrapper[data-node-id="${id}"]`).boundingBox();
	return { ...r, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
}

/** The canvas element's box, its centre, and the zoom (screen px per canvas px). */
async function view(page) {
	const r = await page.locator('.canvas-viewport').boundingBox();
	const z = await page.evaluate(
		() =>
			Number(
				/scale\(([\d.]+)\)/.exec(
					document.querySelector('.canvas-viewport > .canvas-inner')?.style.transform ?? ''
				)?.[1]
			) || null
	);
	return { ...r, cx: r.x + r.width / 2, cy: r.y + r.height / 2, z };
}

function fullyVisible(v, b) {
	return (
		b.x >= v.x && b.y >= v.y && b.x + b.width <= v.x + v.width && b.y + b.height <= v.y + v.height
	);
}

/** Drag the empty canvas by (dx, dy) screen px, from near its top right corner. */
async function pan(page, dx, dy) {
	const v = await view(page);
	await page.mouse.move(v.x + v.width - 60, v.y + 60);
	await page.mouse.down();
	await page.mouse.move(v.x + v.width - 60 + dx, v.y + 60 + dy, { steps: 10 });
	await page.mouse.up();
}

/** Ctrl+wheel (a pinch) at the view centre: `ticks` > 0 zooms out, < 0 in. */
async function zoom(page, ticks) {
	const v = await view(page);
	await page.mouse.move(v.cx, v.cy);
	await page.keyboard.down('Control');
	for (let i = 0; i < Math.abs(ticks); i++) {
		await page.mouse.wheel(0, ticks > 0 ? 100 : -100);
		await page.waitForTimeout(40);
	}
	await page.keyboard.up('Control');
	await page.waitForTimeout(200);
}

/** The node's centre is `steps` cascade steps down and right of the view centre (1 px slack). */
function expectCentred(v, b, steps = 0, zoomLevel = 1) {
	const d = steps * CASCADE_STEP * zoomLevel;
	expect(Math.abs(b.cx - (v.cx + d)), `x centre ${b.cx} vs ${v.cx + d}`).toBeLessThanOrEqual(1);
	expect(Math.abs(b.cy - (v.cy + d)), `y centre ${b.cy} vs ${v.cy + d}`).toBeLessThanOrEqual(1);
}

test.describe('new nodes land in the middle of the canvas view', () => {
	test.beforeEach(async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		const errors = [];
		page.on('console', (m) => {
			if (m.type() === 'error' && !isThirdPartyNoise(m)) errors.push(m.text());
		});
		page.on('pageerror', (e) => errors.push(String(e)));
		page.errors = errors;
	});

	test('imports one after another cascade from the view centre, one step each', async ({
		page
	}) => {
		await openApp(page);
		const [first] = await importFiles(page, ['first'], { fromStart: true });
		const v = await view(page);
		const firstBox = await nodeBox(page, first);
		expectCentred(v, firstBox, 0, v.z ?? 1);
		const [second] = await importFiles(page, ['second']);
		const [third] = await importFiles(page, ['third']);
		const z = v.z ?? 1;
		expectCentred(v, await nodeBox(page, second), 1, z);
		expectCentred(v, await nodeBox(page, third), 2, z);
		// The first import stays where it landed; all three are on screen.
		expect(await nodeBox(page, first)).toEqual(firstBox);
		for (const id of [first, second, third]) {
			expect(fullyVisible(v, await nodeBox(page, id)), id).toBe(true);
		}
		expect(page.errors).toEqual([]);
	});

	test('several files imported in one go step off an earlier import', async ({ page }) => {
		await openApp(page);
		const [first] = await importFiles(page, ['first'], { fromStart: true });
		const [both] = await importFiles(page, ['partA', 'partB']);
		const v = await view(page);
		const a = await nodeBox(page, first);
		const b = await nodeBox(page, both);
		expectCentred(v, b, 1, v.z ?? 1);
		expect(fullyVisible(v, a) && fullyVisible(v, b)).toBe(true);
		expect(page.errors).toEqual([]);
	});

	test('after a pan and a zoom out, palette adds cascade from the new view centre', async ({
		page
	}) => {
		await openApp(page);
		const [first] = await importFiles(page, ['first'], { fromStart: true });
		await pan(page, -500, 300);
		await zoom(page, 3);
		const v = await view(page);
		expect(v.z).toBeLessThan(1);
		// The first table is no longer at the view centre, so the next add takes it exactly.
		expect(fullyVisible(v, await nodeBox(page, first))).toBe(true);
		const [imported] = await importFiles(page, ['second']);
		const [plot] = await pick(page, 'scatterplot');
		const [analysis] = await pick(page, 'Cosinor');
		const [transform] = await pick(page, 'Add');
		const ids = [imported, plot, analysis, transform];
		for (let i = 0; i < ids.length; i++) {
			const b = await nodeBox(page, ids[i]);
			expectCentred(v, b, i, v.z);
			expect(fullyVisible(v, b), ids[i]).toBe(true);
		}
		expect(page.errors).toEqual([]);
	});

	test('zoomed in, a node taller than the view keeps its header on screen', async ({ page }) => {
		await openApp(page);
		await importFiles(page, ['first'], { fromStart: true });
		await zoom(page, -6);
		const v = await view(page);
		expect(v.z).toBeGreaterThan(1.5);
		const [analysis] = await pick(page, 'Cosinor');
		const b = await nodeBox(page, analysis);
		// Taller than the view, so pinned just below its top edge, centred across.
		expect(b.height).toBeGreaterThan(v.height);
		expect(b.y).toBeGreaterThanOrEqual(v.y);
		expect(b.y - v.y).toBeLessThan(40);
		expect(Math.abs(b.cx - v.cx)).toBeLessThanOrEqual(1);
		expect(page.errors).toEqual([]);
	});

	test('a paste keeps the copied layout and lands as one block in the middle of the view', async ({
		page
	}) => {
		await startBlankCanvas(page);
		const [note] = await pick(page, 'note');
		await pan(page, -450, 0);
		const [plot] = await pick(page, 'scatterplot');
		const a = await nodeBox(page, note);
		const b = await nodeBox(page, plot);
		// Select both by their headers, copy, move the view, paste.
		await page.mouse.click(a.cx, a.y + 7);
		await page.keyboard.down('Shift');
		await page.mouse.click(b.cx, b.y + 7);
		await page.keyboard.up('Shift');
		await page.keyboard.press('ControlOrMeta+c');
		await pan(page, -300, 250);
		const pasted = await added(page, () => page.keyboard.press('ControlOrMeta+v'), 2);
		const boxes = await Promise.all(pasted.map((id) => nodeBox(page, id)));
		const [pa, pb] = boxes[0].width === a.width ? boxes : [boxes[1], boxes[0]];
		expect(pb.x - pa.x).toBeCloseTo(b.x - a.x, 0);
		expect(pb.y - pa.y).toBeCloseTo(b.y - a.y, 0);
		const v = await view(page);
		const x0 = Math.min(pa.x, pb.x);
		const x1 = Math.max(pa.x + pa.width, pb.x + pb.width);
		const y0 = Math.min(pa.y, pb.y);
		const y1 = Math.max(pa.y + pa.height, pb.y + pb.height);
		expect(Math.abs((x0 + x1) / 2 - v.cx)).toBeLessThanOrEqual(1);
		expect(Math.abs((y0 + y1) / 2 - v.cy)).toBeLessThanOrEqual(1);
		expect(page.errors).toEqual([]);
	});

	test('uncombining a composite puts its nodes back where they were, not at the view centre', async ({
		page
	}) => {
		await startBlankCanvas(page);
		const [first] = await pick(page, 'Cosinor');
		await pan(page, -450, 0);
		const [second] = await pick(page, 'Cosinor');
		const a = await nodeBox(page, first);
		const b = await nodeBox(page, second);
		await page.mouse.click(a.cx, a.y + 8);
		await page.keyboard.down('Shift');
		await page.mouse.click(b.cx, b.y + 8);
		await page.keyboard.up('Shift');
		await page.keyboard.press('ControlOrMeta+g');
		await expect(page.locator('.workflow-node-wrapper')).toHaveCount(1);
		await page.keyboard.press('ControlOrMeta+Shift+g');
		await expect(page.locator('.workflow-node-wrapper')).toHaveCount(2);
		await page.waitForTimeout(300);
		for (const [id, was] of [
			[first, a],
			[second, b]
		]) {
			const now = await nodeBox(page, id);
			expect([now.x, now.y], id).toEqual([was.x, was.y]);
		}
		expect(page.errors).toEqual([]);
	});
});
