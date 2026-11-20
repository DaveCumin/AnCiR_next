import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { failingTargets } from './helpers.js';

// ROB-29: the main screens have no serious or critical accessibility violations, keyboard
// focus is always visible, dialogs keep and return focus, and toasts are read aloud.
//
// 1. axe-core (WCAG 2.0/2.1/2.2 A and AA, plus axe's best practices) over the start screen, the
//    canvas with an example loaded, the side panel for several node types, the data panel, the
//    workspace with a table plot, and the settings, load session, save plot and confirm dialogs.
//    Every serious or critical violation fails the test. Each scan's full result is written to
//    E2E_SHOTS (default test-results/a11y) for review.
//
//    One rule is off, deliberately: axe's target-size measures each element's own box, while the
//    app's pointer targets are an invisible 24 x 24 ::after box (app.css .hit-target and
//    button.icon), which axe cannot see. The same criterion (WCAG 2.5.8) is measured instead by
//    hit-testing (helpers.js failingTargets): hit-targets.spec.js for every icon button, and here
//    for the screens' other buttons.
//
// 2. Focus: every Tab stop on the start screen and the canvas looks different when focused
//    (outline, shadow, border or background); a dialog opened from the keyboard takes focus,
//    keeps it on Tab, closes on Escape and gives focus back to the button that opened it.
//
// 3. Toasts reach the app's live regions (utils/announce.js): polite for info, assertive for
//    errors.
//
// Runs against a dev server (E2E_BASE_URL): it reads load state through `window.__core`.

test.use({ viewport: { width: 1500, height: 1000 } });

const OUT = process.env.E2E_SHOTS || 'test-results/a11y';
mkdirSync(OUT, { recursive: true });

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/** Scan the page (or `include`), save the result, and fail on serious or critical findings. */
async function expectAccessible(page, name, include) {
	let builder = new AxeBuilder({ page }).withTags(TAGS).disableRules(['target-size']);
	if (include) builder = builder.include(include);
	const result = await builder.analyze();
	writeFileSync(
		path.join(OUT, `axe-${name}.json`),
		JSON.stringify(
			result.violations.map((v) => ({
				id: v.id,
				impact: v.impact,
				help: v.help,
				nodes: v.nodes.map((n) => ({ target: n.target, html: n.html, summary: n.failureSummary }))
			})),
			null,
			1
		)
	);
	const blocking = result.violations
		.filter((v) => v.impact === 'serious' || v.impact === 'critical')
		.map(
			(v) =>
				`${v.impact} ${v.id} (${v.nodes.length}): ${v.help}\n` +
				v.nodes
					.slice(0, 5)
					.map((n) => `    ${n.target.join(' ')}  ${n.html.slice(0, 120)}`)
					.join('\n')
		);
	expect(blocking, `${name}: serious or critical axe violations`).toEqual([]);
	return result;
}

/** Buttons on screen whose pointer target is under 24 x 24 (none of them icon buttons). */
async function expectPointerTargets(page, name, scope = 'body') {
	const small = await failingTargets(page, `${scope} button:not(.icon)`, 1);
	expect(small, `${name}: buttons with a pointer target under 24 x 24 px`).toEqual([]);
}

async function openStart(page) {
	await page.routeWebSocket(/.*/, () => {}); // no live reload mid-test
	await page.goto('/');
	await expect(page.locator('button.primary-card').first()).toBeVisible({ timeout: 30_000 });
	await page.waitForTimeout(500);
}

async function loadDemo(page, demo) {
	await page.routeWebSocket(/.*/, () => {});
	await page.goto(`/?loadFromURL=${encodeURIComponent(`/sessions/demos/${demo}`)}`);
	await page.waitForFunction(
		() =>
			window.__core &&
			(window.__core.tableProcesses?.length || window.__core.plots?.length) &&
			!window.__appState.loadingState.isLoading,
		null,
		{ timeout: 60_000 }
	);
	await page.waitForTimeout(1200);
}

/** Select a canvas node by its id (a click on its title row) and show the control panel. */
async function openPanel(page, nodeId) {
	const wrapper = page.locator(`.workflow-node-wrapper[data-node-id="${nodeId}"]`);
	await wrapper.locator('.tp-title, .node-label, .node-header').first().click();
	const open = page.getByRole('button', { name: 'Open control panel', exact: true });
	if (await open.count()) await open.click();
	const panel = page.locator('.control-display');
	await expect(panel).toBeVisible();
	await page.waitForTimeout(600);
	return panel;
}

const nodeIdOf = (page, fn) => page.evaluate(fn);

test.describe('axe: no serious or critical violations', () => {
	test('start screen and blank canvas', async ({ page }) => {
		await openStart(page);
		await expectAccessible(page, 'start-screen');
		await expectPointerTargets(page, 'start-screen', '.start');
		await page.locator('button.primary-card', { hasText: 'Start with a blank canvas' }).click();
		await expect(page.locator('[aria-labelledby="start-heading"]')).toHaveCount(0);
		await expectAccessible(page, 'blank-canvas');
	});

	test('settings, load session and confirm dialogs', async ({ page }) => {
		await openStart(page);
		await page.locator('button.primary-card', { hasText: 'Start with a blank canvas' }).click();

		await page.getByTestId('nav-settings').click();
		const settings = page.getByRole('dialog', { name: 'Settings' });
		await expect(settings).toBeVisible();
		await expectAccessible(page, 'settings-dialog');
		await page.keyboard.press('Escape');
		await expect(settings).toHaveCount(0);

		await page.getByTestId('nav-load-session').click();
		const load = page.getByRole('dialog', { name: 'Load session' });
		await expect(load).toBeVisible();
		await expectAccessible(page, 'load-session-dialog');
		await page.keyboard.press('Escape');
		await expect(load).toHaveCount(0);
	});

	test('canvas, side panels and data panel with an example loaded', async ({ page }) => {
		await loadDemo(page, 'demo-tp-cosinor.json');
		await expectAccessible(page, 'canvas-cosinor');

		const cosinor = await nodeIdOf(
			page,
			() => `tableprocess_${window.__core.tableProcesses.find((t) => t.name === 'Cosinor').id}`
		);
		const panel = await openPanel(page, cosinor);
		await expectAccessible(page, 'panel-cosinor');
		await expectPointerTargets(page, 'panel-cosinor', '.control-display');

		const scatter = await nodeIdOf(
			page,
			() => `plot_${window.__core.plots.find((p) => p.type === 'scatterplot').id}`
		);
		await page
			.locator(`.workflow-node-wrapper[data-node-id="${scatter}"] .node-header`)
			.first()
			.click();
		await expect(panel).toBeVisible();
		await page.waitForTimeout(600);
		await expectAccessible(page, 'panel-scatterplot');

		const column = await nodeIdOf(
			page,
			() => document.querySelector('.workflow-node-wrapper[data-node-id^="data_"]').dataset.nodeId
		);
		await page.locator(`.workflow-node-wrapper[data-node-id="${column}"] .node-header`).click();
		await page.waitForTimeout(600);
		await expectAccessible(page, 'panel-and-data-panel-column');

		if (!(await page.locator('#data-panel').count()))
			await page.getByTestId('nav-data-panel').click();
		await expect(page.locator('#data-panel')).toBeVisible();
		await expectAccessible(page, 'data-panel');
	});

	test('a column operation node and its panel', async ({ page }) => {
		await loadDemo(page, 'demo-process-normalize.json');
		const process = await page.evaluate(() => {
			const el = document.querySelector('.workflow-node-wrapper[data-node-id^="process_"]');
			return el?.dataset.nodeId;
		});
		expect(process, 'a column operation node on the canvas').toBeTruthy();
		await openPanel(page, process);
		await expectAccessible(page, 'panel-operation');
	});

	test('workspace with a table plot, its panel and the save plot dialog', async ({ page }) => {
		await loadDemo(page, 'demo-table-columns.json');
		await page.getByTestId('nav-workspace-view').click();
		await page.waitForTimeout(1500);
		const card = page.locator('section.draggable').first();
		await card.locator('.plot-header').click({ position: { x: 120, y: 10 } });
		await page.waitForTimeout(600);
		await expectAccessible(page, 'workspace-table');

		const save = page
			.getByRole('toolbar', { name: 'Plot actions' })
			.getByRole('button', { name: 'Save plot' });
		await save.click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();
		// The dialog fades in: scanned mid-fade, its text measures at 1:1 (a false contrast
		// failure that made this test flaky).
		await page.waitForTimeout(600);
		await expectAccessible(page, 'save-plot-dialog');
		await page.keyboard.press('Escape');
		await expect(dialog).toHaveCount(0);
	});

	test('the confirm dialog (new session over unsaved work)', async ({ page }) => {
		await loadDemo(page, 'demo-tp-cosinor.json');
		await page.getByTestId('nav-new-session').click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();
		await expectAccessible(page, 'confirm-dialog');
		await page.keyboard.press('Escape');
		await expect(dialog).toHaveCount(0);
	});
});

/** In the page: the focused element's look, to compare focused with unfocused. */
function lookOf() {
	const el = document.activeElement;
	if (!el || el === document.body) return null;
	const look = (s) =>
		[s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderColor, s.backgroundColor]
			.map(String)
			.join('|');
	// The element and two ancestors: a field inside a styled box shows focus on the box
	// (:focus-within), as the start screen's search box does.
	const chain = [el, el.parentElement, el.parentElement?.parentElement].filter(Boolean);
	const looks = () => chain.map((e) => look(getComputedStyle(e))).join(' / ');
	const focused = looks();
	el.blur();
	const blurred = looks();
	// Back to the same element, as the keyboard left it (the last input was a key press, so the
	// browser treats programmatic focus as keyboard focus and :focus-visible applies again).
	el.focus();
	const r = el.getBoundingClientRect();
	const name =
		el.getAttribute('aria-label') ||
		el.getAttribute('data-testid') ||
		el.textContent.trim().slice(0, 30) ||
		`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`;
	return { name, visible: focused !== blurred, onScreen: r.width > 0 && r.height > 0 };
}

async function tabStops(page, max) {
	const stops = [];
	for (let i = 0; i < max; i++) {
		await page.keyboard.press('Tab');
		const s = await page.evaluate(lookOf);
		if (!s) continue;
		if (stops.length && stops[0].name === s.name && i > 3) break; // wrapped round
		stops.push(s);
	}
	return stops;
}

test.describe('focus', () => {
	test('every Tab stop on the start screen shows a focus indicator', async ({ page }) => {
		await openStart(page);
		const stops = await tabStops(page, 40);
		expect(stops.length).toBeGreaterThan(5);
		expect(stops.filter((s) => s.onScreen && !s.visible).map((s) => s.name)).toEqual([]);
	});

	test('every Tab stop on the canvas and its panels shows a focus indicator', async ({ page }) => {
		await loadDemo(page, 'demo-tp-cosinor.json');
		await page.getByTestId('nav-data-panel').click();
		const cosinor = await nodeIdOf(
			page,
			() => `tableprocess_${window.__core.tableProcesses.find((t) => t.name === 'Cosinor').id}`
		);
		await openPanel(page, cosinor);
		await page.getByTestId('nav-data-panel').focus();
		const stops = await tabStops(page, 150);
		expect(stops.length).toBeGreaterThan(40);
		expect(stops.filter((s) => s.onScreen && !s.visible).map((s) => s.name)).toEqual([]);
	});

	for (const [opener, dialogName] of [
		['nav-settings', 'Settings'],
		['nav-load-session', 'Load session']
	]) {
		test(`the ${dialogName} dialog keeps focus, closes on Escape and returns focus`, async ({
			page
		}) => {
			await openStart(page);
			await page.locator('button.primary-card', { hasText: 'Start with a blank canvas' }).click();
			const button = page.getByTestId(opener);
			await button.focus();
			await page.keyboard.press('Enter');
			const dialog = page.getByRole('dialog', { name: dialogName });
			await expect(dialog).toBeVisible();
			// Where focus is: in the dialog, on the page underneath (a failure), or nowhere in the page
			// (the browser's own controls: past a native modal dialog's last control the browser
			// moves focus to its toolbar, then back into the dialog; the page underneath is inert).
			const where = () =>
				page.evaluate(() => {
					const a = document.activeElement;
					if (a?.closest('dialog[open]')) return 'dialog';
					return !a || a === document.body || a === document.documentElement ? 'browser' : 'page';
				});
			await expect.poll(where).toBe('dialog');
			let visits = 0;
			for (let i = 0; i < 30; i++) {
				await page.keyboard.press('Tab');
				const at = await where();
				expect(at, `Tab ${i + 1} never reaches the page under the dialog`).not.toBe('page');
				if (at === 'dialog') visits++;
			}
			expect(visits, 'Tab keeps coming back into the dialog').toBeGreaterThan(20);
			for (let i = 0; i < 5; i++) {
				await page.keyboard.press('Shift+Tab');
				expect(await where()).not.toBe('page');
			}
			// End inside it, so Escape goes to the dialog.
			await expect
				.poll(async () => {
					if ((await where()) !== 'dialog') await page.keyboard.press('Tab');
					return where();
				})
				.toBe('dialog');
			await page.keyboard.press('Escape');
			await expect(dialog).toHaveCount(0);
			await expect(button).toBeFocused();
		});
	}

	test('the help menu works from the keyboard and Escape gives focus back to Help', async ({
		page
	}) => {
		await openStart(page);
		await page.locator('button.primary-card', { hasText: 'Start with a blank canvas' }).click();
		const help = page.getByTestId('nav-help');
		await help.focus();
		await page.keyboard.press('Enter');
		await expect(page.getByRole('menu', { name: 'Help' })).toBeVisible();
		// Focus is on the first item; the arrows move through the items and wrap.
		const items = page.getByRole('menuitem');
		await expect(items.first()).toBeFocused();
		await page.keyboard.press('ArrowDown');
		await expect(items.nth(1)).toBeFocused();
		await page.keyboard.press('ArrowUp');
		await page.keyboard.press('ArrowUp');
		await expect(items.last()).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(page.getByRole('menu')).toHaveCount(0);
		await expect(help).toBeFocused();
	});
});

test.describe('live regions', () => {
	test('a toast is read politely, an error toast assertively', async ({ page }) => {
		await openStart(page);
		// The app's own notifications module (window.__modules, devModules.js), not a second copy.
		await page.waitForFunction(() => window.__modules?.notifications);
		await page.evaluate(() => {
			const { addNotification } = window.__modules.notifications;
			addNotification('Session saved', 'info', 0);
			addNotification('That file could not be read', 'error', 0, {
				label: 'Try again',
				run: () => {}
			});
		});
		await expect(page.locator('.toast')).toHaveCount(2);
		await expect(page.getByTestId('app-announcer')).toHaveText('Session saved');
		const key = (await page.evaluate(() => /MAC/i.test(navigator.platform || navigator.userAgent)))
			? 'Option+T'
			: 'Alt+T';
		await expect(page.getByTestId('app-alerts')).toHaveText(
			`That file could not be read Try again is in the notification; press ${key} to reach it.`
		);
		await expect(page.getByRole('region', { name: 'Notifications' })).toBeVisible();
	});
});

test.describe('keyboard: canvas nodes', () => {
	test('Enter on a node card selects it, and again opens its settings', async ({ page }) => {
		await loadDemo(page, 'demo-tp-cosinor.json');
		await page.evaluate(() => (window.__appState.showControlPanel = false));
		const cosinor = await nodeIdOf(
			page,
			() => `tableprocess_${window.__core.tableProcesses.find((t) => t.name === 'Cosinor').id}`
		);
		const card = page.locator(`.workflow-node-wrapper[data-node-id="${cosinor}"] > .tp-card`);
		// A focusable group named after the node, whose description says what the keys do.
		await expect(card).toHaveAttribute('role', 'group');
		await expect(card).toHaveAttribute('aria-roledescription', 'node');
		await expect(card).toHaveAccessibleName('Cosinor');
		await expect(card).toHaveAccessibleDescription(/Enter or Space selects this node/);

		await page.getByTestId('nav-help').focus();
		for (let i = 0; i < 80 && !(await card.evaluate((el) => el === document.activeElement)); i++) {
			await page.keyboard.press('Tab');
		}
		await expect(card).toBeFocused();
		await page.keyboard.press('Enter');
		await expect
			.poll(() => page.evaluate(() => window.__appState.canvasSelectedNodeId))
			.toBe(cosinor);
		await expect(card).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(page.locator('.control-display')).toBeVisible();
		await expect(page.locator('.control-display')).toContainText('Cosinor');

		// A key on a port inside the card is the port's, not the card's.
		await page.keyboard.press('Tab');
		await expect
			.poll(() => page.evaluate(() => document.activeElement?.closest('.tp-card') != null))
			.toBe(true);
	});
});
