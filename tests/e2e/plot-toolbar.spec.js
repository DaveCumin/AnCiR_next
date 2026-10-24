import { test, expect } from '@playwright/test';
import path from 'node:path';
import { openApp } from './helpers.js';

// REPORTED (2026-10-22, with review item UI-19): in the workspace the selected plot's
// floating toolbar (zoom, reset, save) sat over the plot's top-right corner, on its legend,
// whenever there was no room above the card (a plot at the top of the view, or maximised).
// It is now docked in the card's header. Maximise filled the canvas origin, off screen once
// the view was panned, and ran under the add-plot button, the control panel's toggle and the
// zoom card on the right; it now fills the visible view short of that strip.

const DEMO = path.resolve('static/sessions/demos/demo-scatter-rhythm.json');

async function loadDemo(page) {
	await openApp(page);
	await page.locator('button.primary-card', { hasText: 'Import data' }).click();
	const [chooser] = await Promise.all([
		page.waitForEvent('filechooser'),
		page.locator('button.dialog-button', { hasText: /Choose File|Change file/ }).click()
	]);
	await chooser.setFiles(DEMO);
	await expect(page.locator('.workflow-node').first()).toBeVisible({ timeout: 30000 });
	await page.getByTestId('nav-workspace-view').click();
}

const box = (loc) => loc.evaluate((el) => el.getBoundingClientRect().toJSON());
const overlaps = (a, b) =>
	a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

for (const width of [1024, 1600]) {
	test(`the selected plot's actions never cover it (${width} px wide)`, async ({ page }) => {
		await page.setViewportSize({ width, height: 800 });
		await loadDemo(page);
		// The card at the very top of the view: no room above it.
		await page.evaluate(() => {
			const p = window.__core.plots[0];
			window.__appState.canvasOffset = { x: 40, y: 10 - p.y * window.__appState.canvasScale };
		});
		const card = page.locator('section.draggable').first();
		await card.locator('.plot-header').click({ position: { x: 120, y: 10 } });

		const toolbar = page.getByRole('toolbar', { name: 'Plot actions' });
		await expect(toolbar.getByRole('button', { name: 'Save plot' })).toBeVisible();
		// In the header, clear of the plot itself.
		const header = await box(card.locator('.plot-header'));
		const content = await box(card.locator('.plot-content'));
		const bar = await box(toolbar);
		expect(bar.top).toBeGreaterThanOrEqual(header.top);
		expect(bar.bottom).toBeLessThanOrEqual(header.bottom);
		expect(overlaps(bar, content)).toBe(false);

		// Maximised: the card fills the visible view, short of the right-hand chrome.
		await card.getByRole('button', { name: 'Maximise' }).click();
		const max = await box(card);
		const canvas = await box(page.locator('.canvas-viewport'));
		expect(max.left).toBeGreaterThanOrEqual(canvas.left - 1);
		expect(max.top).toBeGreaterThanOrEqual(-1);
		expect(max.bottom).toBeLessThanOrEqual(800 + 1);
		expect(max.width).toBeGreaterThan(canvas.width - 100);
		for (const name of ['Add a plot', 'Open control panel', 'Zoom in']) {
			const chrome = await box(page.getByRole('button', { name }).first());
			expect(overlaps(chrome, max), name).toBe(false);
		}
	});
}
