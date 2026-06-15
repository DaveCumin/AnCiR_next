import { test, expect } from '@playwright/test';

// Sanity check that Phase 3's canvas-default view boots cleanly:
// the workflow editor renders inline, FloatingActions + NodePalette mount,
// and the legacy fullscreen-modal close button is gone.
test('canvas-default view renders WorkflowEditor inline with floating actions', async ({
	page
}) => {
	await page.goto('/');

	// Workflow editor should be visible without needing to toggle anything
	const editor = page.locator('.workflow-editor.inline');
	await expect(editor).toBeVisible({ timeout: 15000 });

	// Inline mode hides the modal close-X (only the legacy fullscreen version has it)
	await expect(editor.locator('button.close-btn')).toHaveCount(0);

	// FloatingActions overlay (canvas-anchored undo/redo + session buttons)
	await expect(page.locator('.fa-layer')).toBeVisible();

	// NodePalette trigger "+" in the top-right
	await expect(page.locator('.np-trigger')).toBeVisible();
});
