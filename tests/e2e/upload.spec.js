import { test, expect } from '@playwright/test';
import { loadSampleData, isThirdPartyNoise } from './helpers.js';

test('cmd-shift-x loads sample data and renders SVG without console errors', async ({ page }) => {
	const consoleErrors = [];
	page.on('console', (msg) => {
		if (msg.type() === 'error' && !isThirdPartyNoise(msg)) consoleErrors.push(msg.text());
	});
	page.on('pageerror', (e) => consoleErrors.push(String(e)));

	// Trigger the built-in sample-data loader (Cmd+Shift+X / Ctrl+Shift+X)
	await loadSampleData(page);

	// Wait for a plot SVG to appear (the sample session includes an actogram)
	await expect(page.locator('g.actogram').first()).toBeAttached({ timeout: 15000 });

	expect(consoleErrors).toHaveLength(0);
});
