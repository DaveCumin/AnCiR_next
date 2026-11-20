import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

// Toast timing and keyboard reach (WCAG 2.2.1 Timing Adjustable, 2.2.2 Pause, Stop, Hide;
// David's decision 2026-11-21):
//   - a toast with an action (Undo) stays until it is used or closed;
//   - the others time out, but not while the pointer is over a toast or focus is inside one;
//   - a toast never takes focus when it appears (typing carries on); Alt+T (Option+T) or F8
//     reaches the newest actionable one, Escape closes it and focus goes back;
//   - each toast is announced once, through the app's live region (the toast itself is not one);
//   - pressing Save again replaces the "saved" toast rather than stacking another.
// Screenshots go to E2E_SHOTS (default test-results/toasts). Runs against a dev server
// (E2E_BASE_URL): it drives the app's own notifications module through `window.__modules`.

test.use({ viewport: { width: 1500, height: 1000 } });

const SHOTS = process.env.E2E_SHOTS || 'test-results/toasts';
mkdirSync(SHOTS, { recursive: true });

async function load(page, demo = 'demo-workflow-join-data') {
	await page.routeWebSocket(/.*/, () => {}); // no live reload mid-test
	await page.goto(`/?loadFromURL=${encodeURIComponent(`/sessions/demos/${demo}.json`)}`);
	await page.waitForFunction(
		() =>
			window.__core &&
			window.__core.data?.length &&
			window.__modules?.notifications &&
			!window.__appState.loadingState.isLoading,
		null,
		{ timeout: 60_000 }
	);
	await page.waitForTimeout(800);
}

/** Add a toast through the app's own module; resolves its id. */
function toast(page, message, { type = 'info', duration = 5000, action = false } = {}) {
	return page.evaluate(
		([message, type, duration, action]) => {
			const { addNotification } = window.__modules.notifications;
			window.__ran = window.__ran ?? [];
			return addNotification(
				message,
				type,
				duration,
				action ? { label: 'Undo', run: () => window.__ran.push(message) } : null
			);
		},
		[message, type, duration, action]
	);
}

const toastNamed = (page, text) => page.locator('.toast', { hasText: text });
const isMac = (page) => page.evaluate(() => /MAC/i.test(navigator.platform || navigator.userAgent));

test('an action toast stays until used or closed, and is reached by Alt+T without stealing focus', async ({
	page
}) => {
	await load(page);
	// Typing in the data panel's search box when the toast appears.
	await page.evaluate(() => {
		window.__appState.currentTab = 'data';
		window.__appState.showDisplayPanel = true;
	});
	const search = page.locator('#data-panel .search-input');
	await search.click();
	await search.pressSequentially('weat');
	await toast(page, 'Series "activity" removed', { action: true, duration: 1000 });
	const t = toastNamed(page, 'Series "activity" removed');
	await expect(t).toBeVisible();
	await page.keyboard.type('her'); // focus stayed in the field
	await expect(search).toHaveValue('weather');
	await expect(search).toBeFocused();

	// Read once, with the key that reaches it; the toast itself is not a live region.
	const key = (await isMac(page)) ? 'Option+T' : 'Alt+T';
	await expect(page.getByTestId('app-announcer')).toHaveText(
		`Series "activity" removed Undo is in the notification; press ${key} to reach it.`
	);
	await expect(t).not.toHaveAttribute('aria-live', /.*/);
	await expect(t).not.toHaveAttribute('role', /.*/);

	// Long past its 1 s: still there (it has an action).
	await page.waitForTimeout(2500);
	await expect(t).toBeVisible();

	// Alt+T: focus to the Undo button.
	await page.keyboard.press('Alt+KeyT');
	const undo = t.getByRole('button', { name: 'Undo' });
	await expect(undo).toBeFocused();
	await expect(undo).toHaveAttribute('aria-keyshortcuts', 'Alt+T F8');
	await expect(search).toHaveValue('weather'); // no "†" typed into the field
	await page.screenshot({ path: path.join(SHOTS, 'toast-undo-focused.png') });
	await t.screenshot({ path: path.join(SHOTS, 'toast-undo-focused-closeup.png') });

	// Tab to its close button: the ring sits around the glyph's square, inside the toast.
	await page.keyboard.press('Tab');
	const close = t.getByRole('button', { name: 'Close' });
	await expect(close).toBeFocused();
	const [tb, cb] = [await t.boundingBox(), await close.boundingBox()];
	expect(cb.width).toBe(22);
	expect(cb.height).toBe(22);
	expect(cb.x + cb.width).toBeLessThanOrEqual(tb.x + tb.width - 8);
	await t.screenshot({ path: path.join(SHOTS, 'toast-close-focused.png') });

	// Escape closes it, and focus goes back to the field the user was typing in.
	await page.keyboard.press('Escape');
	await expect(t).toHaveCount(0);
	await expect(search).toBeFocused();
	expect(await page.evaluate(() => window.__ran)).toEqual([]);

	// F8 reaches it too, and the button runs the action.
	await toast(page, 'Plot removed', { action: true });
	await page.keyboard.press('F8');
	await expect(
		toastNamed(page, 'Plot removed').getByRole('button', { name: 'Undo' })
	).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(toastNamed(page, 'Plot removed')).toHaveCount(0);
	expect(await page.evaluate(() => window.__ran)).toEqual(['Plot removed']);
	await expect(search).toBeFocused();
});

test('a plain toast pauses while hovered or focused, then times out', async ({ page }) => {
	await load(page);
	await toast(page, 'Hover keeps me', { duration: 1500 });
	const t = toastNamed(page, 'Hover keeps me');
	await t.hover();
	await page.waitForTimeout(3000);
	await expect(t).toBeVisible();
	await t.screenshot({ path: path.join(SHOTS, 'toast-hovered.png') });
	await page.mouse.move(10, 500);
	await expect(t).toHaveCount(0, { timeout: 3000 });

	// Focus (by the toast key: no action, so its close button) holds it the same way.
	await toast(page, 'Focus keeps me', { duration: 1500 });
	const f = toastNamed(page, 'Focus keeps me');
	await page.keyboard.press('Alt+KeyT');
	await expect(f.getByRole('button', { name: 'Close' })).toBeFocused();
	await page.waitForTimeout(3000);
	await expect(f).toBeVisible();
	// Leaving it (focus back to the page) resumes the clock.
	await page.keyboard.press('Tab');
	await expect(f).toHaveCount(0, { timeout: 3000 });

	// An untouched one still goes on time.
	await toast(page, 'Nobody touches me', { duration: 1000 });
	await expect(toastNamed(page, 'Nobody touches me')).toHaveCount(0, { timeout: 2500 });
});

test('a burst of toasts is capped and the actionable one survives it', async ({ page }) => {
	await load(page);
	await toast(page, 'Column removed', { action: true });
	for (let i = 1; i <= 6; i++) await toast(page, `Note ${i}`, { duration: 20_000 });
	await expect(page.locator('.toast')).toHaveCount(4);
	await expect(toastNamed(page, 'Column removed')).toBeVisible();
	await expect(toastNamed(page, 'Note 6')).toBeVisible();
	await expect(toastNamed(page, 'Note 1')).toHaveCount(0);
	await page.waitForTimeout(600); // the fly-in
	await page.screenshot({ path: path.join(SHOTS, 'toast-stack.png') });
});

test('saving twice replaces the "saved" toast rather than stacking it', async ({ page }) => {
	// The download route (no save dialog), so each save completes without a picker.
	await page.addInitScript(() => {
		delete window.showSaveFilePicker;
	});
	await load(page);
	for (let i = 0; i < 3; i++) {
		await Promise.all([
			page.waitForEvent('download'),
			page.getByTestId('nav-save-session').click()
		]);
		await expect(page.locator('.toast', { hasText: 'Session saved as' })).toHaveCount(1);
	}
	await expect(page.locator('.toast', { hasText: 'Session saved as' })).toHaveCount(1);
});
