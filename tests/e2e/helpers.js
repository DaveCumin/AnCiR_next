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

/**
 * Nothing in a side panel (e.g. the control panel's `.control-display`, which clips at
 * overflow-x: hidden) reaches past its right edge: no element box and no run of text,
 * except inside a box that itself scrolls or clips within the panel (a wide results table,
 * an ellipsised name). Fails with what overflows and by how much.
 */
export async function expectNoOverflow(panel) {
	const over = await panel.evaluate((el) => {
		const edge = el.getBoundingClientRect().right + 0.5;
		const clipped = (node) => {
			for (let p = node.parentElement; p && p !== el; p = p.parentElement)
				if (getComputedStyle(p).overflowX !== 'visible' && p.getBoundingClientRect().right <= edge)
					return true;
			return false;
		};
		const out = [];
		for (const e of el.querySelectorAll('*')) {
			const r = e.getBoundingClientRect();
			if (r.width > 0 && r.right > edge && !clipped(e))
				out.push(
					`${e.tagName}.${String(e.className).split(' ')[0]}: +${Math.round(r.right - edge)} px`
				);
		}
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		for (let t = walker.nextNode(); t; t = walker.nextNode()) {
			if (!t.textContent.trim()) continue;
			const range = document.createRange();
			range.selectNodeContents(t);
			const right = Math.max(-1, ...[...range.getClientRects()].map((q) => q.right));
			if (right > edge && !clipped(t))
				out.push(`text "${t.textContent.trim().slice(0, 30)}": +${Math.round(right - edge)} px`);
		}
		return out;
	});
	expect(over).toEqual([]);
}
