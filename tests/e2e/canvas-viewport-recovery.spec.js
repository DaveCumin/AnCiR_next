import { test, expect } from '@playwright/test';

// Regression for "I dont' see any nodes in the workflow view". The persisted
// pan/zoom from a previous session can put the entire canvas off-screen, so
// the user reloads and sees an empty grid. WorkflowEditor's mount-time
// sanity check should snap the viewport back to the origin when NO nodes
// would be visible at the persisted viewport.
test('off-screen persisted viewport auto-recovers so nodes are visible', async ({
	page,
	context
}) => {
	await context.clearCookies();
	await page.addInitScript(() => {
		try {
			localStorage.setItem(
				'ancir.canvas.viewport',
				JSON.stringify({ x: -8000, y: -8000, z: 1 })
			);
		} catch {
			// pass
		}
	});

	await page.goto('/');
	await page.keyboard.press('Meta+Shift+S');
	await page.waitForTimeout(2000);

	const allNodes = page.locator('.workflow-node');
	const total = await allNodes.count();
	expect(total).toBeGreaterThan(0);

	let visible = 0;
	for (let i = 0; i < total; i++) {
		const box = await allNodes.nth(i).boundingBox().catch(() => null);
		if (box && box.x > -10 && box.y > -10 && box.x < 1280 && box.y < 800) visible++;
	}
	expect(visible).toBeGreaterThan(0);
});
