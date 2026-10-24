import { test, expect } from '@playwright/test';
import path from 'node:path';
import { openApp } from './helpers.js';

// REPORTED (2026-10-22): the canvas preview of the Join Data demo's plot cut its left y-axis
// title in half (and the right one off), and the correlation heatmap and pairs plot previews
// cut "activity" short. A node draws the figure's padding scaled to its type, and a session
// opened straight into the canvas carries a padding nobody measured. The node now measures what
// its own drawing needs (viewBox.js fitViewPadding) and never draws a side with less.

async function loadDemo(page, file) {
	await openApp(page);
	await page.locator('button.primary-card', { hasText: 'Import data' }).click();
	const [chooser] = await Promise.all([
		page.waitForEvent('filechooser'),
		page.locator('button.dialog-button', { hasText: /Choose File|Change file/ }).click()
	]);
	await chooser.setFiles(path.resolve('static/sessions/demos', file));
	await expect(page.locator('.plot-preview-panel svg text').first()).toBeAttached({
		timeout: 30000
	});
}

/** Text in a canvas plot preview that runs past the preview's edges. */
const clippedText = (page) =>
	page.evaluate(() => {
		const out = [];
		for (const panel of document.querySelectorAll('.plot-preview-panel')) {
			const p = panel.getBoundingClientRect();
			for (const t of panel.querySelectorAll('svg text')) {
				const b = t.getBoundingClientRect();
				if (!(b.width > 0) || !t.textContent.trim()) continue;
				if (
					b.left < p.left - 1 ||
					b.right > p.right + 1 ||
					b.top < p.top - 1 ||
					b.bottom > p.bottom + 1
				)
					out.push(t.textContent);
			}
		}
		return out;
	});

for (const demo of [
	'demo-tp-joindata.json',
	'demo-correlationheatmap-matrix.json',
	'demo-pairsplot-matrix.json'
]) {
	test(`the canvas preview keeps all its text inside (${demo})`, async ({ page }) => {
		await loadDemo(page, demo);
		await expect.poll(() => clippedText(page), { timeout: 10000 }).toEqual([]);
	});
}
