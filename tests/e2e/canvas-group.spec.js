import { test, expect } from '@playwright/test';

// Smoke test for the new Group node: spawning from the palette should drop a
// `.group-node` element onto the canvas. Membership reconciliation and the
// drag-children behaviour live in WorkflowEditor's stopAll; this just covers
// the spawn path so future regressions on the palette wiring get caught.
test('Group tile in NodePalette spawns a group-node on the canvas', async ({ page }) => {
	await page.goto('/');

	// Wait for the canvas editor to mount.
	const editor = page.locator('.workflow-editor.inline');
	await expect(editor).toBeVisible({ timeout: 15000 });

	// Open the palette.
	await page.locator('.np-trigger').click();

	// Pick the "Group" tile from the Other family. Match the tile-name span
	// exactly so we don't accidentally hit the "Compare groups (stats)" tile.
	const groupTile = page
		.locator('.palette-tile')
		.filter({ has: page.locator('.palette-tile-name', { hasText: /^Group$/ }) })
		.first();
	await expect(groupTile).toBeVisible();
	await groupTile.click();

	// The dashed-frame container should appear in the canvas.
	await expect(page.locator('.group-node').first()).toBeVisible({ timeout: 5000 });
});
