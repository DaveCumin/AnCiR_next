import { test, expect } from '@playwright/test';

/**
 * SVG structural tests for the Actogram plot.
 *
 * After loading sample data (Meta+Shift+S), the app renders an Actogram.
 * These tests verify the SVG DOM structure produced by Svelte + D3:
 *   - The top x-axis group (class "axis-top") is rendered
 *   - D3 has populated the axis with tick <g> elements and text labels
 *   - The axis domain path is present
 *   - The SVG has a non-zero bounding box
 */

test.describe('Actogram SVG structure', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await page.keyboard.press('Meta+Shift+S');

		// Wait for SVG to appear
		await expect(page.locator('svg').first()).toBeVisible({ timeout: 15000 });

		// Wait for D3 to populate the top x-axis with at least one tick label
		await page
			.locator('g.axis-top .tick text')
			.first()
			.waitFor({ state: 'attached', timeout: 10000 });
	});

	test('SVG element has non-zero dimensions', async ({ page }) => {
		const svg = page.locator('svg').first();
		const box = await svg.boundingBox();
		expect(box).not.toBeNull();
		expect(box.width).toBeGreaterThan(0);
		expect(box.height).toBeGreaterThan(0);
	});

	test('x-axis group (axis-top) is present in the SVG', async ({ page }) => {
		const axisGroup = page.locator('svg g.axis-top');
		await expect(axisGroup.first()).toBeAttached();
	});

	test('x-axis has tick elements with text labels', async ({ page }) => {
		const ticks = page.locator('svg g.axis-top .tick text');
		const count = await ticks.count();
		expect(count).toBeGreaterThan(0);

		// Each visible tick label should contain non-empty text
		const firstLabel = await ticks.first().textContent();
		expect(firstLabel?.trim().length).toBeGreaterThan(0);
	});

	test('x-axis has domain path (axis line rendered by D3)', async ({ page }) => {
		const domainPath = page.locator('svg g.axis-top path.domain');
		await expect(domainPath.first()).toBeAttached();
	});
});
