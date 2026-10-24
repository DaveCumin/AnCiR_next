import { test, expect } from '@playwright/test';
import path from 'node:path';
import { openApp } from './helpers.js';

// A node output's internal name (`joined_463_35`, `result_55`) is its stored identity; a person
// reads its display name ("temperature (A)", "Values"; core/columnLabels.js displayNameOf).
// REPORTED (2026-10-22): two places still printed the internal name: the Enter Data node's
// table header, and the Formula node's column list (typing `$`), which then inserted a token
// that read differently ("Binned: x") from the entry picked (`binnedx_36`).

async function loadDemo(page, file) {
	await openApp(page);
	await page.locator('button.primary-card', { hasText: 'Import data' }).click();
	const [chooser] = await Promise.all([
		page.waitForEvent('filechooser'),
		page.locator('button.dialog-button', { hasText: /Choose File|Change file/ }).click()
	]);
	await chooser.setFiles(path.resolve('static/sessions/demos', file));
	await expect(page.locator('.workflow-node').first()).toBeVisible({ timeout: 30000 });
}

/** The internal names of the session's node outputs that read differently from their name. */
const internalNames = (page) =>
	page.evaluate(() =>
		window.__core.data
			.filter((c) => c.refId == null && c.displayName && c.displayName !== c.name)
			.map((c) => c.name)
	);

test('the Enter Data table header reads the column display name', async ({ page }) => {
	await loadDemo(page, 'demo-tp-blankcolumn.json');
	await expect.poll(async () => (await internalNames(page)).length).toBeGreaterThan(0);
	const internal = await internalNames(page);
	const header = page.locator('.vt-h-val').first();
	await expect(header).toBeVisible();
	const text = await header.innerText();
	expect(internal).not.toContain(text);
	expect(internal).not.toContain(await header.getAttribute('title'));
});

test("the Formula node's column list reads display names", async ({ page }) => {
	await loadDemo(page, 'demo-workflow-join-data.json');
	await expect.poll(() => internalNames(page)).toContain('binnedx_36');
	const internal = await internalNames(page);
	await page.evaluate(() => {
		window.__appState.spawnNodeRequest = { tpType: 'FormulaColumn' };
	});
	const input = page.locator('.formula-editor-wrap input').first();
	await input.click();
	await input.press('$');
	const names = await page.locator('.ac-col-name').allInnerTexts();
	expect(names).toContain('Binned: x');
	expect(names.filter((n) => internal.includes(n))).toEqual([]);
	// The stored name still finds the column.
	await input.pressSequentially('binnedx_36');
	await expect(page.locator('.ac-col-name')).toHaveText(['Binned: x']);
});
