import { test, expect, chromium } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openApp } from './helpers.js';

// Save through the browser's save dialog (UI-15) and autosave to IndexedDB
// (core/sessionSave.svelte.js, core/autosave.svelte.js).
//
// The save dialog cannot be driven headless, so showSaveFilePicker is replaced in the page by
// a stand-in that hands back a fake file handle and records every byte written to it.
//
// Playwright's default contexts are private windows (off-the-record profiles, storage in
// memory). Autosave runs there as in any window (David, 2026-11-21: only the app's own
// Ephemeral mode turns it off); the browser discards the storage when the window closes. The
// tests that need storage to survive a reload of a NEW page use a persistent context on a real
// profile directory, which is what a normal window is.
//
// Recent files need real FileSystemFileHandles (IndexedDB stores a handle by structured clone,
// which a stand-in object with methods cannot survive), so those tests answer the save and
// open dialogs with files in the origin private file system (OPFS): real handles, real files,
// and a file can be deleted to play "moved or deleted".
//
// Chromium only (showSaveFilePicker and the persistent profile). Needs the dev hooks
// (window.__modules) to read the session JSON, so run against a dev server:
//   E2E_BASE_URL=http://localhost:5173 pnpm test:e2e tests/e2e/save-autosave.spec.js

const SHOTS = process.env.SAVE_AUTOSAVE_SHOTS ?? '';

test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium: save dialog API');

// Other work on the repo rewrites .svelte-kit, and the dev server's live reload would then
// reload the page mid-test. No HMR socket, no reload.
test.beforeEach(async ({ context }) => {
	await context.routeWebSocket(/.*/, () => {});
});

/** Replace the save dialog with a recorder. Runs before the app's own scripts. */
function stubSaveDialog() {
	window.__picks = [];
	window.__writes = [];
	window.__cancelNext = false;
	const handle = (name) => ({
		kind: 'file',
		name,
		queryPermission: async () => 'granted',
		requestPermission: async () => 'granted',
		createWritable: async () => {
			let text = '';
			return {
				write: async (blob) => {
					text = typeof blob === 'string' ? blob : await blob.text();
				},
				close: async () => {
					window.__writes.push({ name, text });
				},
				abort: async () => {}
			};
		}
	});
	window.showSaveFilePicker = async (opts) => {
		window.__picks.push({
			suggestedName: opts?.suggestedName,
			accept: opts?.types?.[0]?.accept,
			startIn: opts?.startIn?.name ?? null
		});
		if (window.__cancelNext) {
			window.__cancelNext = false;
			throw new DOMException('The user aborted a request.', 'AbortError');
		}
		return handle(opts?.suggestedName ?? 'unnamed.ancir');
	};
}

/** The session JSON the app would save now (dev hook: the app's own module instance). */
async function sessionJson(page) {
	const hooks = await page.evaluate(() => Boolean(window.__modules));
	test.skip(!hooks, 'reads the session through the dev hooks: run against a dev server');
	return page.evaluate(() => window.__modules.core.outputCoreAsJson());
}

/** Open the first worked example from the start screen. */
async function openExample(page) {
	await openApp(page);
	await page.locator('button.example-open').first().click();
	await expect(page.locator('.workflow-node').first()).toBeVisible({ timeout: 60_000 });
	await expect(page.locator('[aria-labelledby="start-heading"]')).toHaveCount(0);
}

/** A real user edit: drag a node by its header label (marks the session edited at drag end). */
async function dragANode(page) {
	// The label, not the header's left end, which holds the note button (not a drag handle).
	const label = page.locator('.workflow-node .node-header .node-label').first();
	const box = await label.boundingBox();
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + 60, y + 40, { steps: 8 });
	await page.mouse.move(x + 120, y + 80, { steps: 8 });
	await page.mouse.up();
	await expect.poll(async () => (await label.boundingBox()).x).not.toBe(box.x);
}

/** Wait until the session stops changing (a load's layout settling), then return its JSON. */
async function settledJson(page) {
	let previous = await sessionJson(page);
	for (let i = 0; i < 20; i++) {
		await page.waitForTimeout(500);
		const now = await sessionJson(page);
		if (now === previous) return now;
		previous = now;
	}
	return previous;
}

/** Every autosaved copy in this profile: [{ slot, name, savedAt, json }]. */
function readCopies(page) {
	return page.evaluate(
		() =>
			new Promise((resolve) => {
				const req = indexedDB.open('ancir-autosave');
				req.onupgradeneeded = () => {
					// It did not exist: do not leave an empty one behind.
					req.transaction.abort();
				};
				req.onerror = () => resolve([]);
				req.onsuccess = () => {
					const db = req.result;
					if (!db.objectStoreNames.contains('meta')) {
						db.close();
						resolve([]);
						return;
					}
					const tx = db.transaction(['meta', 'sessions'], 'readonly');
					const metas = tx.objectStore('meta').getAll();
					const bodies = tx.objectStore('sessions').getAll();
					tx.oncomplete = () => {
						db.close();
						resolve(
							metas.result.map((m) => ({
								...m,
								json: bodies.result.find((b) => b.slot === m.slot)?.json
							}))
						);
					};
				};
			})
	);
}

/**
 * A session JSON without what EVERY load renews, so a restored copy can be compared with what
 * was autosaved: each analysis output column gets a fresh tableProcessGUId on load, and a load
 * bumps the canvas's request counters (viewport adoption, layout settling). Opening a saved
 * file renews exactly the same fields.
 */
function comparable(json) {
	const RENEWED_BY_LOAD = new Set([
		'tableProcessGUId',
		'viewportEpoch',
		'settleLayoutRequest',
		'settleLayoutHandled'
	]);
	return JSON.parse(json, (key, value) => (RENEWED_BY_LOAD.has(key) ? undefined : value));
}

/** A screenshot once loading has finished and transitions (modal fade-ins) have run. */
async function shot(page, name) {
	await expect(page.locator('.loading-container')).toHaveCount(0, { timeout: 60_000 });
	await page.waitForTimeout(800);
	await page.screenshot({ path: path.join(SHOTS, name) });
}

/** Answer the save and open dialogs with real files in the origin private file system. */
function stubPickersWithOpfs() {
	window.__nextSave = [];
	window.__nextOpen = null;
	const root = () => navigator.storage.getDirectory();
	window.showSaveFilePicker = async (opts) => {
		const name = window.__nextSave.shift() ?? opts?.suggestedName ?? 'unnamed.ancir';
		return (await root()).getFileHandle(name, { create: true });
	};
	window.showOpenFilePicker = async () => {
		if (!window.__nextOpen) throw new DOMException('The user aborted a request.', 'AbortError');
		return [await (await root()).getFileHandle(window.__nextOpen)];
	};
}

function newProfile() {
	return mkdtempSync(path.join(tmpdir(), 'ancir-e2e-profile-'));
}

/** A normal (non-private) window: a persistent context on a real profile directory. */
async function normalWindow(baseURL, dir) {
	const context = await chromium.launchPersistentContext(dir, {
		baseURL,
		viewport: { width: 1400, height: 900 }
	});
	await context.routeWebSocket(/.*/, () => {});
	const page = context.pages()[0] ?? (await context.newPage());
	// Reloading with unsaved work asks first (ROB-5); answer like a person leaving anyway.
	page.on('dialog', (d) => d.accept());
	return { context, page };
}

test.describe('Save through the save dialog', () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(stubSaveDialog);
		await page.setViewportSize({ width: 1400, height: 900 });
	});

	test('Save asks once, writes the session, then saves silently; Save as asks again', async ({
		page
	}) => {
		await openExample(page);
		const expected = await settledJson(page);
		await page.getByTestId('nav-save-session').click();

		await expect.poll(() => page.evaluate(() => window.__writes.length)).toBe(1);
		const [pick] = await page.evaluate(() => window.__picks);
		expect(pick.suggestedName).toMatch(/ \d{4}-\d{2}-\d{2}\.ancir$/);
		expect(pick.accept).toEqual({ 'application/json': ['.ancir'] });
		const [write] = await page.evaluate(() => window.__writes);
		expect(write.name).toBe(pick.suggestedName);
		expect(write.text).toBe(expected);
		await expect(page.locator('.toast-message').last()).toContainText(
			`Session saved as "${pick.suggestedName}"`
		);
		await expect(page).toHaveTitle(
			new RegExp(`^${pick.suggestedName.replace(/\./g, '\\.')} - AnCiR`)
		);

		// Cmd/Ctrl+S: same file, no dialog.
		await dragANode(page);
		await page.keyboard.press('ControlOrMeta+s');
		await expect.poll(() => page.evaluate(() => window.__writes.length)).toBe(2);
		expect(await page.evaluate(() => window.__picks.length)).toBe(1);
		expect((await page.evaluate(() => window.__writes))[1].text).toBe(await sessionJson(page));

		// Save as (button, and Cmd/Ctrl+Shift+S): the dialog again, starting at the current file.
		await page.getByTestId('nav-save-session-as').click();
		await expect.poll(() => page.evaluate(() => window.__picks.length)).toBe(2);
		expect((await page.evaluate(() => window.__picks))[1].startIn).toBe(pick.suggestedName);
		await page.keyboard.press('ControlOrMeta+Shift+s');
		await expect.poll(() => page.evaluate(() => window.__picks.length)).toBe(3);
		if (SHOTS) {
			await page.getByTestId('nav-save-session').hover();
			await page.waitForTimeout(600);
			await page.screenshot({ path: path.join(SHOTS, 'save-rail-tooltip.png') });
		}
	});

	test('cancelling the dialog does nothing: no download, no message', async ({ page }) => {
		await openExample(page);
		const toastsBefore = await page.locator('.toast').count();
		await page.evaluate(() => (window.__cancelNext = true));
		const download = page.waitForEvent('download', { timeout: 2500 }).then(
			() => true,
			() => false
		);
		await page.getByTestId('nav-save-session').click();
		expect(await download).toBe(false);
		expect(await page.evaluate(() => window.__picks.length)).toBe(1);
		expect(await page.evaluate(() => window.__writes.length)).toBe(0);
		await expect(page.locator('.toast')).toHaveCount(toastsBefore);
		await expect(page).toHaveTitle(/^AnCiR /);
	});
});

test.describe('Save without a save dialog (Firefox, Safari)', () => {
	test('downloads "<name> <date>.ancir" as before, and offers no Save as', async ({ page }) => {
		await page.addInitScript(() => {
			delete window.showSaveFilePicker;
		});
		await openExample(page);
		expect(await page.evaluate(() => typeof window.showSaveFilePicker)).toBe('undefined');
		await expect(page.getByTestId('nav-save-session-as')).toHaveCount(0);
		const expected = await settledJson(page);
		const [download] = await Promise.all([
			page.waitForEvent('download'),
			page.getByTestId('nav-save-session').click()
		]);
		expect(download.suggestedFilename()).toMatch(/ \d{4}-\d{2}-\d{2}\.ancir$/);
		const file = await download.path();
		const { readFileSync } = await import('node:fs');
		expect(readFileSync(file, 'utf8')).toBe(expected);
	});
});

test.describe('Autosave', () => {
	test('runs in a private window too: no detection, no note', async ({ page }) => {
		await page.setViewportSize({ width: 1400, height: 900 });
		await openExample(page);
		await dragANode(page);
		await expect.poll(async () => (await readCopies(page)).length, { timeout: 15_000 }).toBe(1);
		await page.getByTestId('nav-settings').click();
		await expect(page.getByTestId('settings-autosave-status')).toHaveText(/^On\./);
		await expect(page.getByTestId('settings-autosave')).toContainText(
			'In a private browser window autosave still runs'
		);
	});

	test('Ephemeral mode turns it off, deletes every copy, and says why', async ({ baseURL }) => {
		const dir = newProfile();
		const { context, page } = await normalWindow(baseURL, dir);
		try {
			await openExample(page);
			await dragANode(page);
			await expect.poll(async () => (await readCopies(page)).length, { timeout: 15_000 }).toBe(1);
			await page.getByTestId('nav-settings').click();
			await page.getByTestId('settings-ephemeral-toggle').check();
			await expect(page.getByTestId('settings-autosave-status')).toHaveText(
				'Off because Ephemeral mode is on (see Privacy below).'
			);
			await expect.poll(async () => (await readCopies(page)).length).toBe(0);
			if (SHOTS) {
				await page.waitForTimeout(800);
				await page
					.getByTestId('settings-autosave')
					.screenshot({ path: path.join(SHOTS, 'settings-autosave-ephemeral.png') });
			}
			await page.keyboard.press('Escape');
			// More changes: still nothing kept, and nothing offered after a reload.
			await dragANode(page);
			await page.waitForTimeout(5000);
			expect(await readCopies(page)).toEqual([]);
			await page.reload();
			await expect(page.locator('button.primary-card').first()).toBeVisible({ timeout: 60_000 });
			await page.waitForTimeout(1500);
			await expect(page.getByTestId('start-recover')).toHaveCount(0);
			// Off again: autosave resumes.
			await page.locator('button.primary-card', { hasText: 'Start with a blank canvas' }).click();
			await page.getByTestId('nav-settings').click();
			await page.getByTestId('settings-ephemeral-toggle').uncheck();
			await expect(page.getByTestId('settings-autosave-status')).toHaveText(/^On\./);
		} finally {
			await context.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test('keeps unsaved work, offers it after a reload, and restores the exact session', async ({
		baseURL
	}) => {
		const dir = newProfile();
		const { context, page } = await normalWindow(baseURL, dir);
		try {
			await openExample(page);
			expect(await readCopies(page)).toEqual([]); // a just-opened example is not unsaved
			await dragANode(page);
			await expect.poll(async () => (await readCopies(page)).length, { timeout: 15_000 }).toBe(1);
			// Once the session stops changing, the copy catches up with it exactly.
			const final = await settledJson(page);
			await expect
				.poll(async () => (await readCopies(page))[0]?.json === final, { timeout: 15_000 })
				.toBe(true);
			const [copy] = await readCopies(page);

			await page.reload();
			await expect(page.locator('button.primary-card').first()).toBeVisible({ timeout: 60_000 });
			const recover = page.getByTestId('start-recover');
			await expect(recover).toBeVisible();
			await expect(recover.locator('.recover-name')).toHaveText(copy.name);
			await expect(recover.locator('.recover-sub')).toContainText('Autosaved');
			if (SHOTS) {
				await shot(page, 'start-unsaved-work.png');
				await recover.screenshot({ path: path.join(SHOTS, 'start-unsaved-work-row.png') });
			}
			await recover.getByRole('button', { name: /^Restore/ }).click();
			await expect(page.locator('[aria-labelledby="start-heading"]')).toHaveCount(0);
			await expect(page.locator('.workflow-node').first()).toBeVisible({ timeout: 60_000 });
			// The same session, field for field, but for what every load of a session file renews
			// (see comparable()).
			expect(comparable(await settledJson(page))).toEqual(comparable(copy.json));
			// The restored session keeps ONE copy: this tab adopted the restored slot.
			const after = await readCopies(page);
			expect(after.map((c) => c.slot)).toEqual([copy.slot]);
			if (SHOTS) {
				await page.getByTestId('nav-settings').click();
				const panel = page.getByTestId('settings-autosave');
				await panel.scrollIntoViewIfNeeded();
				await expect(page.getByTestId('settings-autosave-status')).toHaveText(/^On\./);
				await shot(page, 'settings-autosave-on.png');
				await panel.screenshot({ path: path.join(SHOTS, 'settings-autosave-panel.png') });
			}
		} finally {
			await context.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test('a tab that is still open keeps its copy to itself; once closed, it is offered', async ({
		baseURL
	}) => {
		const dir = newProfile();
		const { context, page: tabA } = await normalWindow(baseURL, dir);
		try {
			await openExample(tabA);
			await dragANode(tabA);
			await expect.poll(async () => (await readCopies(tabA)).length, { timeout: 15_000 }).toBe(1);

			// Tab B opens while A is still open: A's copy is A's (Web Locks), so it is not offered.
			const tabB = await context.newPage();
			tabB.on('dialog', (d) => d.accept());
			await openApp(tabB);
			await tabB.waitForTimeout(2000);
			await expect(tabB.getByTestId('start-recover')).toHaveCount(0);

			// B's own work goes to B's own copy: A's is untouched.
			const [aCopy] = await readCopies(tabA);
			await tabB.locator('button.example-open').nth(1).click();
			await expect(tabB.locator('.workflow-node').first()).toBeVisible({ timeout: 60_000 });
			await dragANode(tabB);
			await expect.poll(async () => (await readCopies(tabB)).length, { timeout: 15_000 }).toBe(2);
			const stillA = (await readCopies(tabB)).find((c) => c.slot === aCopy.slot);
			expect(stillA.json).toBe(aCopy.json);

			// A closes (its lock goes with it): B's next start screen offers A's work, not its own.
			await tabA.close({ runBeforeUnload: false });
			await tabB.reload();
			const recover = tabB.getByTestId('start-recover');
			await expect(recover).toBeVisible({ timeout: 60_000 });
			const names = await recover.locator('.recover-name').allTextContents();
			expect(names).toHaveLength(2); // B's previous page is closed too: both are offered
			expect(names).toContain(aCopy.name);
		} finally {
			await context.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test('Discard removes the copy for good', async ({ baseURL }) => {
		const dir = newProfile();
		const { context, page } = await normalWindow(baseURL, dir);
		try {
			await openExample(page);
			await dragANode(page);
			await expect.poll(async () => (await readCopies(page)).length, { timeout: 15_000 }).toBe(1);
			await page.reload();
			const recover = page.getByTestId('start-recover');
			await expect(recover).toBeVisible({ timeout: 60_000 });
			await recover.getByRole('button', { name: /^Discard/ }).click();
			const confirm = page.locator('dialog[open]');
			await expect(confirm).toContainText('cannot be recovered');
			if (SHOTS) await shot(page, 'start-discard-confirm.png');
			await confirm.getByRole('button', { name: 'Discard' }).click();
			await expect(recover).toHaveCount(0);
			expect(await readCopies(page)).toEqual([]);
			await page.reload();
			await expect(page.locator('button.primary-card').first()).toBeVisible({ timeout: 60_000 });
			await page.waitForTimeout(1500);
			await expect(page.getByTestId('start-recover')).toHaveCount(0);
		} finally {
			await context.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test('saving to a file deletes the copy', async ({ baseURL }) => {
		const dir = newProfile();
		const { context, page } = await normalWindow(baseURL, dir);
		try {
			await page.addInitScript(stubSaveDialog);
			await openExample(page);
			await dragANode(page);
			await expect.poll(async () => (await readCopies(page)).length, { timeout: 15_000 }).toBe(1);
			await page.getByTestId('nav-save-session').click();
			await expect.poll(async () => (await readCopies(page)).length).toBe(0);
		} finally {
			await context.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test('turned off in Settings, nothing is stored', async ({ baseURL }) => {
		const dir = newProfile();
		const { context, page } = await normalWindow(baseURL, dir);
		try {
			await openApp(page);
			await page.locator('button.primary-card', { hasText: 'Start with a blank canvas' }).click();
			await page.getByTestId('nav-settings').click();
			const toggle = page.getByTestId('settings-autosave-toggle');
			await expect(toggle).toBeChecked();
			await toggle.uncheck();
			await expect(page.getByTestId('settings-autosave-status')).toHaveText(/^Off\./);
			if (SHOTS) {
				await page.waitForTimeout(800); // the modal's fade-in
				const panel = page.getByTestId('settings-autosave');
				await panel.screenshot({ path: path.join(SHOTS, 'settings-autosave-off.png') });
			}
			await page.keyboard.press('Escape');
			await openExample(page);
			await dragANode(page);
			await page.waitForTimeout(5000);
			expect(await readCopies(page)).toEqual([]);
			// The choice survives a reload, and nothing is offered.
			await page.reload();
			await expect(page.locator('button.primary-card').first()).toBeVisible({ timeout: 60_000 });
			await page.waitForTimeout(1500);
			await expect(page.getByTestId('start-recover')).toHaveCount(0);
			await page.locator('button.primary-card', { hasText: 'Start with a blank canvas' }).click();
			await page.getByTestId('nav-settings').click();
			await expect(page.getByTestId('settings-autosave-toggle')).not.toBeChecked();
		} finally {
			await context.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

test.describe('Recent files on the start screen', () => {
	/**
	 * Wait until the recent-files index lists `fileName` first. Saving and opening update the
	 * title and close the start screen before the (asynchronous) index write lands, so a test
	 * that reloads straight away must wait for it; a person cannot reload that fast.
	 */
	async function recentTop(page, fileName) {
		await expect
			.poll(() =>
				page.evaluate(
					() => JSON.parse(localStorage.getItem('ancir.recents.v1') ?? '[]')[0]?.fileName
				)
			)
			.toBe(fileName);
	}

	/** Back to a fresh start screen (the session is saved, so nothing asks). */
	async function toStart(page) {
		await page.reload();
		await expect(page.locator('button.primary-card').first()).toBeVisible({ timeout: 60_000 });
	}

	test('saved and opened files are listed, reopen in one click, and can be removed or cleared', async ({
		baseURL
	}) => {
		const dir = newProfile();
		const { context, page } = await normalWindow(baseURL, dir);
		try {
			await page.addInitScript(stubPickersWithOpfs);
			await openApp(page);
			// Nothing saved or opened yet: no section at all.
			await page.waitForTimeout(1000);
			await expect(page.getByTestId('start-recent')).toHaveCount(0);
			if (SHOTS) await shot(page, 'recent-empty-desktop.png');

			// Two files saved through the save dialog.
			await page.locator('button.example-open').first().click();
			await expect(page.locator('.workflow-node').first()).toBeVisible({ timeout: 60_000 });
			await page.evaluate(() => window.__nextSave.push('Cohort A.ancir'));
			await page.getByTestId('nav-save-session').click();
			await expect(page).toHaveTitle(/^Cohort A\.ancir - AnCiR/);
			await recentTop(page, 'Cohort A.ancir');
			await toStart(page);
			await page.locator('button.example-open').nth(1).click();
			await expect(page.locator('.workflow-node').first()).toBeVisible({ timeout: 60_000 });
			await page.evaluate(() => window.__nextSave.push('Cohort B.ancir'));
			await page.getByTestId('nav-save-session').click();
			await expect(page).toHaveTitle(/^Cohort B\.ancir - AnCiR/);
			await recentTop(page, 'Cohort B.ancir');
			await toStart(page);

			const section = page.getByTestId('start-recent');
			const rows = section.getByTestId('start-recent-row');
			await expect(rows).toHaveCount(2);
			await expect(rows.locator('.recent-name')).toHaveText(['Cohort B', 'Cohort A']);
			await expect(rows.first().locator('.recent-sub')).toHaveText(
				/^Saved just now · \d+ columns? · \d+ plots?$/
			);
			// Sits between the action cards and the tour.
			const order = await page.evaluate(() => {
				const y = (el) => el.getBoundingClientRect().top;
				return [
					y(document.querySelector('.primary-row')),
					y(document.querySelector('[data-testid="start-recent"]')),
					y(document.querySelector('.tour-band'))
				];
			});
			expect(order[0]).toBeLessThan(order[1]);
			expect(order[1]).toBeLessThan(order[2]);
			if (SHOTS) {
				await shot(page, 'recent-desktop.png');
				await section.screenshot({ path: path.join(SHOTS, 'recent-section-desktop.png') });
			}

			// One click reopens Cohort A, which becomes the save target and moves to the top.
			await rows.filter({ hasText: 'Cohort A' }).locator('.recent-open').click();
			await expect(page.locator('[aria-labelledby="start-heading"]')).toHaveCount(0);
			await expect(page.locator('.workflow-node').first()).toBeVisible({ timeout: 60_000 });
			await expect(page).toHaveTitle(/^Cohort A\.ancir - AnCiR/);
			await recentTop(page, 'Cohort A.ancir');
			await toStart(page);
			await expect(rows.locator('.recent-name')).toHaveText(['Cohort A', 'Cohort B']);
			await expect(rows.first().locator('.recent-sub')).toHaveText(/^Opened just now/);

			// Cohort B is "moved": the file goes, and a copy appears under another name.
			await page.evaluate(async () => {
				const root = await navigator.storage.getDirectory();
				const text = await (await (await root.getFileHandle('Cohort B.ancir')).getFile()).text();
				const moved = await root.getFileHandle('Cohort B moved.ancir', { create: true });
				const w = await moved.createWritable();
				await w.write(text);
				await w.close();
				await root.removeEntry('Cohort B.ancir');
			});
			const rowB = rows.filter({ hasText: 'Cohort B' });
			await rowB.locator('.recent-open').click();
			await expect(rowB.locator('.recent-warn')).toHaveText(
				'Not found: it may have been moved, renamed or deleted.'
			);
			await expect(rowB.getByRole('button', { name: 'Find it…' })).toBeVisible();
			await expect(rowB.getByRole('button', { name: 'Remove' })).toBeVisible();
			if (SHOTS) {
				await page.waitForTimeout(300);
				await section.screenshot({ path: path.join(SHOTS, 'recent-missing-desktop.png') });
			}
			// Find it: pick the file where it is now; it opens and replaces the stale row.
			await page.evaluate(() => (window.__nextOpen = 'Cohort B moved.ancir'));
			await rowB.getByRole('button', { name: 'Find it…' }).click();
			await expect(page.locator('[aria-labelledby="start-heading"]')).toHaveCount(0);
			await expect(page).toHaveTitle(/^Cohort B moved\.ancir - AnCiR/);
			await recentTop(page, 'Cohort B moved.ancir');
			await toStart(page);
			await expect(rows.locator('.recent-name')).toHaveText(['Cohort B moved', 'Cohort A']);

			// A missing file's row can also just be removed.
			await page.evaluate(async () => {
				const root = await navigator.storage.getDirectory();
				await root.removeEntry('Cohort B moved.ancir');
			});
			const rowMoved = rows.filter({ hasText: 'Cohort B moved' });
			await rowMoved.locator('.recent-open').click();
			await rowMoved.getByRole('button', { name: 'Remove' }).click();
			await expect(rows).toHaveCount(1);

			// Narrow screen (375 px): one column, nothing overflows.
			await page.setViewportSize({ width: 375, height: 812 });
			await page.waitForTimeout(300);
			const overflow = await page.evaluate(() => {
				const panel = document.querySelector('.start-inner');
				const r = panel.getBoundingClientRect();
				return [...panel.querySelectorAll('*')]
					.filter((el) => {
						const b = el.getBoundingClientRect();
						return b.width > 0 && (b.right > r.right + 0.5 || b.left < r.left - 0.5);
					})
					.map((el) => el.className);
			});
			expect(overflow).toEqual([]);
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
				375
			);
			if (SHOTS) {
				await section.scrollIntoViewIfNeeded();
				await shot(page, 'recent-375.png');
				await section.screenshot({ path: path.join(SHOTS, 'recent-section-375.png') });
			}
			await page.setViewportSize({ width: 1400, height: 900 });

			// The per-row remove button.
			await rows
				.first()
				.getByRole('button', { name: /^Remove Cohort A\.ancir from recent files$/ })
				.click();
			await expect(section).toHaveCount(0);
			// The files themselves are untouched.
			expect(
				await page.evaluate(async () => {
					const root = await navigator.storage.getDirectory();
					return Boolean(await root.getFileHandle('Cohort A.ancir'));
				})
			).toBe(true);

			// "Clear recent files" asks, then empties the list (and the section goes).
			await page.locator('button.example-open').first().click();
			await expect(page.locator('.workflow-node').first()).toBeVisible({ timeout: 60_000 });
			await page.evaluate(() => window.__nextSave.push('Cohort C.ancir'));
			await page.getByTestId('nav-save-session').click();
			await expect(page).toHaveTitle(/^Cohort C\.ancir - AnCiR/);
			await recentTop(page, 'Cohort C.ancir');
			await toStart(page);
			await expect(rows).toHaveCount(1);
			await page.getByTestId('start-recent-clear').click();
			const confirm = page.locator('dialog[open]');
			await expect(confirm).toContainText('The files themselves are not touched.');
			if (SHOTS) await shot(page, 'recent-clear-confirm.png');
			await confirm.getByRole('button', { name: 'Clear list' }).click();
			await expect(section).toHaveCount(0);
			await toStart(page);
			await page.waitForTimeout(1000);
			await expect(section).toHaveCount(0);
		} finally {
			await context.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test('"Clear data stored in this browser" clears the list too', async ({ baseURL }) => {
		const dir = newProfile();
		const { context, page } = await normalWindow(baseURL, dir);
		try {
			await page.addInitScript(stubPickersWithOpfs);
			await openExample(page);
			await page.evaluate(() => window.__nextSave.push('Cohort D.ancir'));
			await page.getByTestId('nav-save-session').click();
			await expect(page).toHaveTitle(/^Cohort D\.ancir - AnCiR/);
			await expect
				.poll(() => page.evaluate(() => localStorage.getItem('ancir.recents.v1') ?? ''))
				.toContain('Cohort D.ancir');
			await page.reload();
			await expect(page.getByTestId('start-recent-row')).toHaveCount(1, { timeout: 60_000 });
			await page.locator('button.primary-card', { hasText: 'Start with a blank canvas' }).click();
			await page.getByTestId('nav-settings').click();
			await page.getByRole('button', { name: 'Clear data stored in this browser' }).click();
			await expect(page.locator('.toast-message').last()).toContainText('Cleared');
			await page.reload();
			await expect(page.locator('button.primary-card').first()).toBeVisible({ timeout: 60_000 });
			await page.waitForTimeout(1000);
			await expect(page.getByTestId('start-recent')).toHaveCount(0);
		} finally {
			await context.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
