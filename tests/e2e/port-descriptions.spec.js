import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { openApp } from './helpers.js';

// A port says what it expects or produces (core/portDescriptions.js): hovering its dot shows
// the description after the port's name, keyboard focus shows the same tooltip, and screen
// readers get the description through the dot's aria-describedby.

const demo = () =>
	JSON.parse(fs.readFileSync(path.resolve('static/sessions/demos/demo-tp-cosinor.json')));

async function loadSession(page, session) {
	await openApp(page);
	await page.locator('button.primary-card', { hasText: 'Import data' }).click();
	const [chooser] = await Promise.all([
		page.waitForEvent('filechooser'),
		page.locator('button.dialog-button', { hasText: /Choose File|Change file/ }).click()
	]);
	await chooser.setFiles({
		name: 'ports.json',
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(session))
	});
	await expect(page.locator('.workflow-node-wrapper').first()).toBeVisible({ timeout: 30000 });
}

/** The text of every element the focused element's aria-describedby names. */
const describedText = (page) =>
	page.evaluate(() =>
		(document.activeElement?.getAttribute('aria-describedby') ?? '')
			.split(/\s+/)
			.filter(Boolean)
			.map((id) => document.getElementById(id)?.textContent ?? '')
			.join(' ')
	);

test.beforeEach(async ({ page }) => {
	await page.setViewportSize({ width: 1500, height: 1100 });
	await loadSession(page, demo());
});

test('hovering a port shows what it expects, without covering the dot', async ({ page }) => {
	const xIn = page.locator('.port-dot[data-port-dir="in"][data-port-name="xIN"]').first();
	const dot = await xIn.boundingBox();
	await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
	const tip = page.locator('.app-tooltip');
	await expect(tip).toBeVisible();
	await expect(tip).toHaveText(
		/^Input: x\. One time column .*Required; nothing runs until it is wired\.$/
	);
	// Wraps at a readable measure, inside the viewport, clear of the dot it describes.
	const box = await tip.boundingBox();
	const rem = await page.evaluate(() =>
		parseFloat(getComputedStyle(document.documentElement).fontSize)
	);
	// 22rem of text (+page.svelte .tooltip max-width) plus 0.6rem of padding each side.
	expect(box.width).toBeLessThanOrEqual(23.2 * rem + 1);
	expect(box.height).toBeGreaterThan(box.width / 10); // wrapped onto several lines, not one long run
	expect(box.x + box.width).toBeLessThanOrEqual(1500);
	const covers =
		box.x < dot.x + dot.width &&
		box.x + box.width > dot.x &&
		box.y < dot.y + dot.height &&
		box.y + box.height > dot.y;
	expect(covers).toBe(false);
});

test('an output and a metric output say what the value means, with units', async ({ page }) => {
	const fit = page.locator('.port-dot[data-port-dir="out"][aria-label*="Cosinor fit: y"]').first();
	await fit.hover();
	await expect(page.locator('.app-tooltip')).toHaveText(
		/^Output: Cosinor fit: y\. The fitted cosinor .* in y units\./
	);
	await page.mouse.move(1, 1);
	const acro = page.locator('.port-dot.metric-port[aria-label*="Acrophase"]').first();
	await acro.scrollIntoViewIfNeeded();
	await acro.hover();
	await expect(page.locator('.app-tooltip')).toHaveText(
		/^Metric output: Acrophase .*Time of the fitted peak, .*One value per wired y column\.$/
	);
});

test('keyboard focus on a port shows the description and announces it', async ({ page }) => {
	await page.mouse.move(1, 1); // no hover tooltip in the way
	const xIn = page.locator('.port-dot[data-port-dir="in"][data-port-name="xIN"]').first();
	await xIn.focus();
	await page.keyboard.press('Tab'); // keyboard focus (focus-visible) on the next port, yIN
	const yIn = page.locator('.port-dot[data-port-dir="in"][data-port-name="yIN"]').first();
	await expect(yIn).toBeFocused();
	await expect(yIn).toHaveAttribute('aria-label', /input port y,/);
	const tip = page.locator('.app-tooltip');
	await expect(tip).toBeVisible();
	await expect(tip).toHaveText(/^Input: y\*\. Number columns, one or more; each is analysed/);
	// The same sentence reaches screen readers as the port's accessible description.
	expect(await describedText(page)).toMatch(/^Number columns, one or more; each is analysed/);
	await page.keyboard.press('Escape');
	await expect(tip).toBeHidden();
});
