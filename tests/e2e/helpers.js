import { expect } from '@playwright/test';

// Shared steps for the e2e specs.
//
// The app registers its keyboard shortcuts in onMount, after the node maps have
// loaded, and an empty session opens behind the start screen (a modal overlay).
// Pressing a shortcut straight after page.goto() raced that load and was sometimes
// dropped, so every spec waits for the start screen first.

/** Open the app and wait until it has finished loading (start screen shown). */
export async function openApp(page) {
	await page.goto('/');
	await expect(page.locator('button.primary-card').first()).toBeVisible({ timeout: 30000 });
}

/** Dismiss the start screen to the empty canvas. */
export async function startBlankCanvas(page) {
	await openApp(page);
	await page.locator('button.primary-card', { hasText: 'Start with a blank canvas' }).click();
	await expect(page.locator('[aria-labelledby="start-heading"]')).toHaveCount(0);
}

/** Build the built-in sample session (Cmd/Ctrl+Shift+X) and wait for its nodes. */
export async function loadSampleData(page) {
	await openApp(page);
	await page.keyboard.press('ControlOrMeta+Shift+X');
	await expect(page.locator('.workflow-node').first()).toBeVisible({ timeout: 30000 });
	await expect(page.locator('[aria-labelledby="start-heading"]')).toHaveCount(0);
}

/**
 * Console errors that are not the app's: the page loads Cloudflare Web Analytics,
 * whose beacon fails CORS on localhost ("Failed to load resource: net::ERR_FAILED").
 */
export function isThirdPartyNoise(msg) {
	return /cloudflareinsights\.com/.test(`${msg.location()?.url ?? ''} ${msg.text()}`);
}
