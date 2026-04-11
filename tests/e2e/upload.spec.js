import { test, expect } from '@playwright/test';

test('cmd-shift-s loads sample data and renders SVG without console errors', async ({ page }) => {
	const consoleErrors = [];
	page.on('console', (msg) => {
		if (msg.type() === 'error' && !msg.text().includes('cloudflareinsights')) {
			consoleErrors.push(msg.text());
		}
	});

	await page.goto('/');

	// Trigger the built-in sample-data loader (Cmd+Shift+S / Ctrl+Shift+S)
	await page.keyboard.press('Meta+Shift+S');

	// Wait for an SVG to appear (actogram render)
	const svg = page.locator('svg').first();
	await expect(svg).toBeVisible({ timeout: 15000 });

	expect(consoleErrors).toHaveLength(0);
});
