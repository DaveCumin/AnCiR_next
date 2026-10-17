import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

// UI-25: the canvas can be wired from the keyboard alone (keyboardWiring.js). With nothing but
// key presses: Tab to an output port, Enter starts a wire (the live region says so), Tab moves
// among the inputs that can take it, Enter connects; one undo removes the wire again. Escape
// cancels a wire without touching the selection, Delete on an input removes its wires, and
// Enter on an input opens its column list with focus in it.

const DEMO = 'static/sessions/demos/demo-tp-cosinor.json';

async function loadDemo(page) {
	await openApp(page);
	await page.locator('button.primary-card', { hasText: 'Import data' }).click();
	const [chooser] = await Promise.all([
		page.waitForEvent('filechooser'),
		page.locator('button.dialog-button', { hasText: /Choose File|Change file/ }).click()
	]);
	await chooser.setFiles(DEMO);
	await expect(page.locator('.workflow-node-wrapper').first()).toBeVisible({ timeout: 30000 });
	await expect(page.locator('.port-dot[data-node-id^="plot_"]').first()).toBeVisible();
	await page.waitForTimeout(300);
}

/** The focused element as "nodeId:port:dir" when it is a port dot. */
const focused = (page) =>
	page.evaluate(() => {
		const a = document.activeElement;
		return a?.dataset?.portName
			? `${a.dataset.nodeId}:${a.dataset.portName}:${a.dataset.portDir}`
			: '';
	});

/** Press `key` until the focused port's "port:dir" matches `re` (fails after `max` presses). */
async function pressUntil(page, key, re, max = 150) {
	for (let i = 0; i < max; i++) {
		if (re.test(await focused(page))) return;
		await page.keyboard.press(key);
	}
	throw new Error(`never reached ${re} with ${key}; at "${await focused(page)}"`);
}

const wires = (page) => page.locator('path.edge-line:not(.reference)');
const status = (page) => page.getByTestId('wiring-status');

test('wire two nodes with the keyboard only, then undo it in one step', async ({ page }) => {
	await page.setViewportSize({ width: 1500, height: 1100 });
	await loadDemo(page);
	const before = await wires(page).count();

	// Tab to the Cosinor's Amplitude metric output.
	const amplitude = page.getByRole('button', {
		name: 'Cosinor: metric output port Amplitude, one value per series',
		exact: true
	});
	await expect(amplitude).toHaveCount(1);
	const ampId = await amplitude.evaluate((e) => `${e.dataset.nodeId}:${e.dataset.portName}:out`);
	await pressUntil(page, 'Tab', new RegExp(`^${ampId}$`));

	await page.keyboard.press('Enter');
	await expect(status(page)).toContainText('Connecting from Cosinor: Amplitude.');
	await expect(status(page)).toContainText('Escape cancels');
	await expect(page.locator('.workflow-editor.kb-wiring')).toHaveCount(1);
	await expect(amplitude).toHaveClass(/kb-wire-source/);
	// The Cosinor's own inputs are not offered.
	await expect(page.locator('.kb-wire-candidate[data-node-id^="tableprocess_"]')).toHaveCount(0);
	const candidates = await page.locator('.kb-wire-candidate').count();
	expect(candidates).toBeGreaterThan(2);

	// Tab visits the candidate inputs only.
	const seen = new Set();
	for (let i = 0; i < candidates; i++) {
		await page.keyboard.press('Tab');
		const f = await focused(page);
		expect(f, 'Tab while wiring lands on an input port').toMatch(/:in$/);
		expect(
			await page.evaluate(() => document.activeElement.classList.contains('kb-wire-candidate'))
		).toBe(true);
		seen.add(f);
	}
	expect(seen.size).toBe(candidates);

	// On to the values Table's `series` input, and connect.
	await pressUntil(page, 'Tab', /^plot_\d+:series:in$/, candidates + 1);
	await page.keyboard.press('Enter');
	await expect(status(page)).toHaveText(/Connected Cosinor: Amplitude to .+: series\./);
	await expect(page.locator('.workflow-editor.kb-wiring')).toHaveCount(0);
	await expect(wires(page)).toHaveCount(before + 1);

	// One undo step takes it away; redo brings it back.
	await page.keyboard.press('ControlOrMeta+z');
	await expect(wires(page)).toHaveCount(before);
	await page.keyboard.press('ControlOrMeta+Shift+z');
	await expect(wires(page)).toHaveCount(before + 1);
});

test('Escape cancels a keyboard wire only; Delete on an input removes its wires', async ({
	page
}) => {
	await page.setViewportSize({ width: 1500, height: 1100 });
	await loadDemo(page);
	const before = await wires(page).count();

	// A selected node stays selected through the first Escape.
	await page.locator('.workflow-node-wrapper .node-header', { hasText: 'Cosinor: values' }).click();
	const selected = page.locator('.workflow-node.selected');
	await expect(selected).toHaveCount(1);

	await pressUntil(page, 'Tab', /^tableprocess_\d+:col_\d+:out$/);
	const source = await focused(page);
	await page.keyboard.press('Enter');
	await page.keyboard.press('Tab');
	await page.keyboard.press('Escape');
	await expect(status(page)).toHaveText('Connection cancelled.');
	await expect(page.locator('.workflow-editor.kb-wiring')).toHaveCount(0);
	expect(await focused(page), 'focus back on the wire’s source').toBe(source);
	await expect(selected).toHaveCount(1);
	await expect(wires(page)).toHaveCount(before);
	// The next Escape is the canvas's again: it deselects.
	await page.keyboard.press('Escape');
	await expect(selected).toHaveCount(0);

	// Delete on a connected input: its wires go (one undo step), the node stays.
	const nodes = await page.locator('.workflow-node-wrapper').count();
	await pressUntil(page, 'Shift+Tab', /^plot_\d+:ys1:in$/);
	await page.keyboard.press('Delete');
	await expect(status(page)).toHaveText(/^Removed the wires into .+: y\.$/);
	await expect(wires(page)).toHaveCount(before - 1);
	await expect(page.locator('.workflow-node-wrapper')).toHaveCount(nodes);
	await page.keyboard.press('ControlOrMeta+z');
	await expect(wires(page)).toHaveCount(before);
});

test('Enter on an input port opens its column list with focus in it', async ({ page }) => {
	await page.setViewportSize({ width: 1500, height: 1100 });
	await loadDemo(page);
	await pressUntil(page, 'Tab', /^tableprocess_\d+:yIN:in$/);
	const port = await focused(page);
	await page.keyboard.press('Enter');
	const search = page.locator('.dropdown .search-wrapper input');
	await expect(search).toBeVisible();
	await expect(search).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(search).toHaveCount(0);
	expect(await focused(page), 'focus back on the port').toBe(port);
});

test('a port reached with Tab is panned into view (the canvas never scrolls)', async ({ page }) => {
	await page.setViewportSize({ width: 900, height: 600 });
	await loadDemo(page);
	let ports = 0;
	const hidden = [];
	for (let i = 0; i < 160; i++) {
		await page.keyboard.press('Tab');
		const r = await page.evaluate(() => {
			const a = document.activeElement;
			if (!a?.dataset?.portName) return null;
			const v = document.querySelector('.canvas-viewport');
			const b = a.getBoundingClientRect();
			const c = v.getBoundingClientRect();
			const inside =
				b.left >= c.left && b.right <= c.right && b.top >= c.top && b.bottom <= c.bottom;
			return {
				id: `${a.dataset.nodeId}:${a.dataset.portName}`,
				ok: inside && !v.scrollTop && !v.scrollLeft
			};
		});
		if (!r) continue;
		ports++;
		if (!r.ok) hidden.push(r.id);
	}
	expect(ports).toBeGreaterThan(20);
	expect(hidden, 'focused ports outside the canvas viewport').toEqual([]);
});
