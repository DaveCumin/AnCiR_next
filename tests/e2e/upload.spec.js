import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.resolve(__dirname, '../../test/testData.csv');

test('upload testData.csv renders actogram SVG without console errors', async ({ page }) => {
	const consoleErrors = [];
	page.on('console', (msg) => {
		if (msg.type() === 'error') consoleErrors.push(msg.text());
	});

	await page.goto('/');

	// Locate the file input and upload the CSV
	const fileInput = page.locator('input[type="file"]');
	await fileInput.setInputFiles(CSV_PATH);

	// Wait for an SVG to appear (actogram render)
	const svg = page.locator('svg').first();
	await expect(svg).toBeVisible({ timeout: 15000 });

	expect(consoleErrors).toHaveLength(0);
});
