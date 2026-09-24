import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

// Sanity check that Phase 3's canvas-default view boots cleanly:
// the workflow editor renders inline, the nav-rail actions + NodePalette mount,
// and the legacy fullscreen-modal close button is gone.
test('canvas-default view renders WorkflowEditor inline with rail actions', async ({ page }) => {
	await openApp(page);

	// Workflow editor should be visible without needing to toggle anything
	const editor = page.locator('.workflow-editor.inline');
	await expect(editor).toBeVisible({ timeout: 15000 });

	// Inline mode hides the modal close-X (only the legacy fullscreen version has it)
	await expect(editor.locator('button.close-btn')).toHaveCount(0);

	// Session and history actions live in the nav rail (they left the canvas's
	// FloatingActions overlay, which is no longer mounted, in the nav rail rework).
	for (const id of ['nav-load-session', 'nav-save-session', 'nav-undo', 'nav-redo']) {
		await expect(page.getByTestId(id)).toBeVisible();
	}

	// NodePalette trigger "+" in the top-right
	await expect(page.locator('.np-trigger')).toBeVisible();
});
