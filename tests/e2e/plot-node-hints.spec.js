import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { openApp } from './helpers.js';

// UI-20: a plot node's trailing empty slots (the next series' x / y* pair, the "Line" drop
// port) say what a drop there does, in a dimmed hint that fits the node (a short form on a
// narrow node, never clipped); the `*` on a port is explained in its tooltip (portLabels.js).

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
		name: 'hints.json',
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(session))
	});
	await expect(page.locator('.workflow-node-wrapper').first()).toBeVisible({ timeout: 30000 });
	await expect(page.locator('.series-header.new-slot').first()).toBeVisible();
}

/** Each hint's visible text, and whether it fits its row unclipped. */
const hints = (page) =>
	page.$$eval('.series-header.new-slot', (els) =>
		els.map((e) => ({
			text: e.innerText.trim(),
			fits: [...e.children].every((c) => c.scrollWidth <= c.clientWidth + 0.5)
		}))
	);

test('the trailing series and line slots are hints that fit; the * is explained', async ({
	page
}) => {
	await page.setViewportSize({ width: 1500, height: 1100 });
	await loadSession(page, demo());
	expect(await hints(page)).toEqual([
		{ text: '+ Drop a column to add a series', fits: true },
		{ text: '+ Drop a column to add a line', fits: true }
	]);
	// Dimmer than the port labels, but readable.
	const [hint, label] = await page.evaluate(() => [
		getComputedStyle(document.querySelector('.series-header.new-slot')).color,
		getComputedStyle(document.querySelector('.workflow-node .port-label')).color
	]);
	expect(hint).not.toBe(label);

	// Keyboard focus shows the tooltip (tooltip.js); the empty pair's y* explains both.
	await page.mouse.move(1, 1); // no hover tooltip in the way
	const empty = page.locator('.port-dot[data-port-dir="in"][aria-label*="starts series"]');
	await empty.first().focus(); // the empty pair's x, then Tab (keyboard focus) to its y*
	await page.keyboard.press('Tab');
	await expect(empty.last()).toBeFocused();
	await expect(page.locator('.app-tooltip')).toHaveText(
		/^Input: y\*\. Drop columns here to start series \d+\. The \* means it takes one or more columns\.$/
	);
});

test('on a narrow plot node the hints switch to their short form', async ({ page }) => {
	await page.setViewportSize({ width: 1500, height: 1100 });
	const s = demo();
	for (const [id, v] of Object.entries(s.nodeLayout))
		if (id.startsWith('plot_')) Object.assign(v, { w: 180, h: 180 });
	await loadSession(page, s);
	expect(await hints(page)).toEqual([
		{ text: '+ New series', fits: true },
		{ text: '+ New line', fits: true }
	]);
});
