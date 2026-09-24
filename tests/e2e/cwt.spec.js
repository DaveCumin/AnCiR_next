import { test, expect } from '@playwright/test';
import path from 'node:path';
import { openApp } from './helpers.js';

// The Wavelet (CWT) scalogram drew its axis titles and colour legend at fixed pixel sizes
// while a workflow node shrinks the plot's padding with its type, so in a node the legend
// ("max", "Power") and the axis titles were pushed past the SVG edge and cut off.

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
	for (const label of ['max', 'Power', 'Period (hrs)', 'Time']) {
		await expect(svg.getByText(label, { exact: true })).toBeAttached();
	}
	expect(await clippedLabels(page)).toEqual([]);

	await page.getByTestId('nav-workspace-view').click();
	await expect(page.locator('svg[id^="plot"]').first().getByText('Power')).toBeVisible();
	expect(await clippedLabels(page)).toEqual([]);
});
