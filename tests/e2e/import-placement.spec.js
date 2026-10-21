import { test, expect } from '@playwright/test';
import { openApp, isThirdPartyNoise } from './helpers.js';

// Every import used to land its table at the same canvas spot (80, 80), so a second import
// covered the first and hid it, and after a pan the new table appeared off screen. Each
// import now lands in free space at the top left of the visible canvas.

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

async function importFiles(page, names, { fromStart = false } = {}) {
	if (fromStart) {
		await page.locator('button.primary-card', { hasText: 'Import data' }).click();
	} else {
		// The canvas palette's Import entry.
		await page.getByTestId('palette-trigger').click();
		await page.getByTestId('palette-item-import-file').click();
	}
	await page.locator('#fileInput').setInputFiles(names.map(file));
	await expect(page.locator('#confirmImport')).toBeVisible({ timeout: 30000 });
	const before = await page.locator('.workflow-node-wrapper').count();
	await page.locator('#confirmImport').click();
	await expect(page.locator('dialog[open]')).toHaveCount(0, { timeout: 30000 });
	await expect(page.locator('.workflow-node-wrapper')).toHaveCount(before + 1, { timeout: 30000 });
}

/** Every canvas node's on-screen box. */
function nodeBoxes(page) {
	return page.evaluate(() =>
		[...document.querySelectorAll('.workflow-node-wrapper')].map((el) => {
			const r = el.getBoundingClientRect();
			return { id: el.dataset.nodeId, x: r.x, y: r.y, w: r.width, h: r.height };
		})
	);
}

function overlapping(boxes) {
	const out = [];
	for (let i = 0; i < boxes.length; i++) {
		for (let j = i + 1; j < boxes.length; j++) {
			const a = boxes[i];
			const b = boxes[j];
			if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
				out.push(`${a.id} covers ${b.id}`);
			}
		}
	}
	return out;
}

async function visibleIn(page, box) {
	const vp = await page.locator('.canvas-viewport').boundingBox();
	return (
		box.x >= vp.x &&
		box.y >= vp.y &&
		box.x + box.w <= vp.x + vp.width &&
		box.y + box.h <= vp.y + vp.height
	);
}

test.describe('imported tables land in free canvas space', () => {
	test.beforeEach(async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		const errors = [];
		page.on('console', (m) => {
			if (m.type() === 'error' && !isThirdPartyNoise(m)) errors.push(m.text());
		});
		page.on('pageerror', (e) => errors.push(String(e)));
		page.errors = errors;
	});

	test('a second and third import do not cover the first', async ({ page }) => {
		await openApp(page);
		await importFiles(page, ['first'], { fromStart: true });
		const [first] = await nodeBoxes(page);
		await importFiles(page, ['second']);
		await importFiles(page, ['third']);
		const boxes = await nodeBoxes(page);
		expect(boxes).toHaveLength(3);
		expect(overlapping(boxes)).toEqual([]);
		// The first import stays where it always landed; the others are on screen too.
		expect(boxes.find((b) => b.id === first.id)).toEqual(first);
		for (const b of boxes) expect(await visibleIn(page, b), b.id).toBe(true);
		expect(page.errors).toEqual([]);
	});

	test('several files imported in one go land clear of an earlier import', async ({ page }) => {
		await openApp(page);
		await importFiles(page, ['first'], { fromStart: true });
		await importFiles(page, ['partA', 'partB']);
		const boxes = await nodeBoxes(page);
		expect(boxes).toHaveLength(2);
		expect(overlapping(boxes)).toEqual([]);
		expect(page.errors).toEqual([]);
	});

	test('an import after a pan lands in view, clear of the first', async ({ page }) => {
		await openApp(page);
		await importFiles(page, ['first'], { fromStart: true });
		// Drag the empty canvas up and to the left, taking the first table off screen.
		const vp = await page.locator('.canvas-viewport').boundingBox();
		await page.mouse.move(vp.x + vp.width - 120, vp.y + vp.height - 120);
		await page.mouse.down();
		await page.mouse.move(vp.x + vp.width - 620, vp.y + vp.height - 520, { steps: 10 });
		await page.mouse.up();
		const [first] = await nodeBoxes(page);
		expect(await visibleIn(page, first)).toBe(false);

		await importFiles(page, ['second']);
		const boxes = await nodeBoxes(page);
		const added = boxes.find((b) => b.id !== first.id);
		expect(await visibleIn(page, added)).toBe(true);
		expect(overlapping(boxes)).toEqual([]);
		expect(page.errors).toEqual([]);
	});
});
