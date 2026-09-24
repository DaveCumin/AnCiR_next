import { test, expect } from '@playwright/test';
import { loadSampleData } from './helpers.js';

// Regression for the ControlPanel `.newplotconstant` overlay that used to cover
// NodePalette in canvas view, blocking every click on the palette and on plot
// nodes. Now the overlay only renders in `view === 'plots'`.
test('NodePalette is clickable in canvas view and picking a plot spawns a plot node', async ({
	page
}) => {
	// At least one workflow node should render once sample data loads
	await loadSampleData(page);

	// The sample session already has "A Scatterplot"; the new one is titled exactly
	// "Scatterplot". (Counting nodes is unreliable: the sample's nodes mount in batches.)
	const spawned = page
		.locator('.workflow-node')
		.filter({ has: page.locator('.node-label', { hasText: /^Scatterplot$/ }) });
	await expect(spawned).toHaveCount(0);

	// Trigger should be reachable with a normal click (no overlay intercepting)
	await page.locator('.np-trigger').click();

	// Pick a Plot-family tile (Scatterplot is always registered).
	const scatterTile = page.locator('.np-item', { hasText: 'Scatterplot' }).first();
	await expect(scatterTile).toBeVisible();
	await scatterTile.click();

	// Picking a plot spawns it straight onto the canvas (no modal; its x/y inputs
	// are wired on the canvas), in view where the user is looking.
	await expect(spawned).toHaveCount(1, { timeout: 5000 });
	await expect(spawned).toBeInViewport();
});
