import { test, expect } from '@playwright/test';
import path from 'node:path';
import { openApp } from './helpers.js';

// The Wavelet (CWT) scalogram drew its axis titles and colour legend at fixed pixel sizes
// while a workflow node shrinks the plot's padding with its type, so in a node the legend
// and the axis titles were pushed past the SVG edge and cut off. The legend is now the
// shared colour-scale legend (ColourScale.svelte), labelled with the real power range.

const DEMO = path.resolve('static/sessions/demos/demo-cwt-period-change.json');

async function loadDemo(page) {
	await openApp(page);
	await page.locator('button.primary-card', { hasText: 'Import data' }).click();
	const [chooser] = await Promise.all([
		page.waitForEvent('filechooser'),
		page.locator('button.dialog-button', { hasText: /Choose File|Change file/ }).click()
	]);
	await chooser.setFiles(DEMO);
	await expect(page.getByText('Wavelet scalogram').first()).toBeVisible({ timeout: 30000 });
}

/** Text of every <text> in the scalogram SVG that pokes outside the SVG's box. */
function clippedLabels(page) {
	return page.evaluate(() => {
		const svg = document.querySelector('svg[id^="plot"]');
		const r = svg.getBoundingClientRect();
		return [...svg.querySelectorAll('text')]
			.filter((t) => {
				const b = t.getBoundingClientRect();
				return (
					b.width > 0 &&
					(b.left < r.left - 0.5 ||
						b.right > r.right + 0.5 ||
						b.top < r.top - 0.5 ||
						b.bottom > r.bottom + 0.5)
				);
			})
			.map((t) => t.textContent);
	});
}

test('CWT legend and axis titles fit inside the plot, in a node and in the workspace', async ({
	page
}) => {
	await loadDemo(page);
	const svg = page.locator('svg[id^="plot"]').first();
	for (const label of ['Power', 'Period (h)', 'Time (h)']) {
		await expect(svg.getByText(label, { exact: true })).toBeAttached();
	}
	expect(await clippedLabels(page)).toEqual([]);

	await page.getByTestId('nav-workspace-view').click();
	await expect(page.locator('svg[id^="plot"]').first().getByText('Power')).toBeVisible();
	expect(await clippedLabels(page)).toEqual([]);
});

// REPORTED (2026-10-22): with Rectify off the raw power labels ("36800") are wider than the
// 0.6 em a character the key estimated, so the turned "Power" title overlapped them by about
// 2 px and the key, clamped into the stored 70 px of right padding, sat on the plot frame.
// The key now measures its text and the plot reserves the room it takes beside the plot.
test('raw power labels clear the Power title, and the key clears the plot', async ({ page }) => {
	await loadDemo(page);
	await page.getByTestId('nav-workspace-view').click();
	const svg = page.locator('svg[id^="plot"]').first();
	await expect(svg.getByText('Power')).toBeVisible();
	await page.evaluate(() => {
		window.__core.plots.find((p) => p.type === 'cwt').plot.rectify = false;
	});
	await expect(svg.locator('text.colour-scale-tick').first()).toHaveText(/^\d{4,}$/);
	const m = await page.evaluate(() => {
		const svg = document.querySelector('svg[id^="plot"]');
		const key = svg.querySelector('g.colour-scale');
		const ticks = [...key.querySelectorAll('text.colour-scale-tick')];
		const title = key.querySelector('text.colour-scale-label').getBoundingClientRect();
		const bar = key.querySelector('rect').getBoundingClientRect();
		const frame = [...svg.querySelectorAll('rect[fill="none"]')]
			.map((r) => r.getBoundingClientRect())
			.sort((a, b) => b.width - a.width)[0];
		return {
			tickRight: Math.max(...ticks.map((t) => t.getBoundingClientRect().right)),
			titleLeft: title.left,
			barLeft: bar.left,
			frameRight: frame.right
		};
	});
	expect(m.titleLeft).toBeGreaterThanOrEqual(m.tickRight - 0.5);
	expect(m.barLeft).toBeGreaterThan(m.frameRight + 4);
});
