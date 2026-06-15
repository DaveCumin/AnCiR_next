import { test, expect } from '@playwright/test';

// Regression for the ControlPanel `.newplotconstant` overlay that used to cover
// NodePalette in canvas view, blocking every click on the palette and on plot
// nodes. Now the overlay only renders in `view === 'plots'`.
test('NodePalette is clickable in canvas view and picking a plot opens the modal', async ({
	page
}) => {
	await page.goto('/');
	await page.keyboard.press('Meta+Shift+S');

	// At least one workflow node should render once sample data loads
	await expect(page.locator('.workflow-node').first()).toBeVisible({ timeout: 15000 });

	// Trigger should be reachable with a normal click — no overlay intercepting
	await page.locator('.np-trigger').click();

	// Pick a Plot-family tile (Scatterplot is always registered).
	const scatterTile = page.locator('.np-item', { hasText: 'Scatterplot' }).first();
	await expect(scatterTile).toBeVisible();
	await scatterTile.click();

	// MakeNewPlot modal should now be open — pre-picked to Scatterplot, so the
	// "Options for Scatterplot" step is visible.
	await expect(page.locator('text=Options for Scatterplot').first()).toBeVisible({
		timeout: 5000
	});
});
