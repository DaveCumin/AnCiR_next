import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

// Keyboard resizing and reordering (review ROB-29). Every action under test is a key press
// on a focused element, never the mouse:
//   - the data and control panel edges are WAI-ARIA window splitters (arrows, Shift+arrows,
//     Home/End, Enter for the default width), with aria-valuenow tracking the width;
//   - a Table plot's column edge resizes with the arrows, one undo step for a quick run;
//   - groups, columns and plots in the data panel, and a plot's series, move with
//     Alt+ArrowUp/Down: same result as a drag, focus stays on the moved row, the live region
//     says where it went, and one Cmd/Ctrl+Z puts it back.
// Also a group DRAGGED to a new place is one undo step (graphPatch records list order).
// Focused-element screenshots go to E2E_SHOTS (default test-results/keyboard-resize-reorder).
// Runs against a dev server (E2E_BASE_URL): it reads state through `window.__core`.

test.use({ viewport: { width: 1500, height: 1000 } });

const SHOTS = process.env.E2E_SHOTS || 'test-results/keyboard-resize-reorder';
mkdirSync(SHOTS, { recursive: true });

async function load(page, demo) {
	await page.routeWebSocket(/.*/, () => {}); // no live reload mid-test
	await page.goto(`/?loadFromURL=${encodeURIComponent(`/sessions/demos/${demo}.json`)}`);
	await page.waitForFunction(
		() =>
			window.__core &&
			window.__core.data?.length &&
			window.__history &&
			!window.__appState.loadingState.isLoading,
		null,
		{ timeout: 60_000 }
	);
	await page.waitForTimeout(800); // computed outputs settle before anything is recorded
}

async function openDataPanel(page) {
	await page.evaluate(() => {
		window.__appState.currentTab = 'data';
		window.__appState.showDisplayPanel = true;
	});
	await expect(page.locator('#data-panel')).toBeVisible();
	await page.waitForTimeout(700); // the panel's fly-in
}

const announcer = (page) => page.locator('#app-announcer');
const groupIds = (page) => page.evaluate(() => window.__core.groups.map((g) => g.id));
const activeKey = (page) =>
	page.evaluate(() => document.activeElement?.dataset?.reorderKey ?? null);
const undo = (page) => page.keyboard.press('ControlOrMeta+z');
const redo = (page) => page.keyboard.press('ControlOrMeta+Shift+z');

test('the data and control panel edges resize from the keyboard', async ({ page }) => {
	await load(page, 'demo-workflow-join-data');
	await openDataPanel(page);
	const panel = page.locator('#data-panel');
	const split = page.getByRole('separator', { name: 'Resize the data panel' });
	await expect(split).toHaveAttribute('tabindex', '0');
	await expect(split).toHaveAttribute('aria-controls', 'data-panel');
	await expect(split).toHaveAttribute('aria-valuemin', '200');
	await expect(split).toHaveAttribute('aria-valuemax', '500');
	await expect(split).toHaveAttribute('aria-valuenow', '250');

	const width = async () => Math.round((await panel.boundingBox()).width);
	await split.focus();
	await page.keyboard.press('ArrowRight');
	await expect(split).toHaveAttribute('aria-valuenow', '260');
	expect(await width()).toBe(260);
	await page.keyboard.press('Shift+ArrowRight');
	await expect(split).toHaveAttribute('aria-valuenow', '310');
	await page.keyboard.press('ArrowLeft');
	await expect(split).toHaveAttribute('aria-valuenow', '300');
	expect(await width()).toBe(300);
	await page.screenshot({ path: path.join(SHOTS, 'data-splitter-focused.png') });
	await page.keyboard.press('Home');
	await expect(split).toHaveAttribute('aria-valuenow', '200');
	expect(await width()).toBe(200);
	await page.keyboard.press('End');
	await expect(split).toHaveAttribute('aria-valuenow', '500');
	expect(await width()).toBe(500);
	await page.keyboard.press('ArrowRight'); // clamped
	await expect(split).toHaveAttribute('aria-valuenow', '500');
	await page.keyboard.press('Enter'); // the default width
	await expect(split).toHaveAttribute('aria-valuenow', '250');
	expect(await width()).toBe(250);

	// The control panel sits right of its edge, so ArrowLeft widens it.
	await page.evaluate(() => (window.__appState.showControlPanel = true));
	const ctl = page.getByRole('separator', { name: 'Resize the control panel' });
	await expect(ctl).toHaveAttribute('aria-controls', 'control-panel');
	await page.waitForTimeout(700); // fly-in
	const ctlWidth = async () =>
		Math.round((await page.locator('#control-panel').boundingBox()).width);
	await ctl.focus();
	await page.keyboard.press('ArrowLeft');
	await expect(ctl).toHaveAttribute('aria-valuenow', '260');
	expect(await ctlWidth()).toBe(260);
	await page.keyboard.press('Shift+ArrowRight');
	await expect(ctl).toHaveAttribute('aria-valuenow', '210');
	await page.screenshot({ path: path.join(SHOTS, 'control-splitter-focused.png') });
	await page.keyboard.press('Home');
	await expect(ctl).toHaveAttribute('aria-valuenow', '200');
	await page.keyboard.press('End');
	await expect(ctl).toHaveAttribute('aria-valuenow', '500');
	expect(await ctlWidth()).toBe(500);
	await page.keyboard.press('Enter');
	await expect(ctl).toHaveAttribute('aria-valuenow', '250');
});

test('a Table plot column resizes from the keyboard, one undo step per run', async ({ page }) => {
	await load(page, 'demo-workflow-join-data');
	const plotId = await page.evaluate(
		() => window.__core.plots.find((p) => p.type === 'tableplot' && p.plot.longestCol > 0)?.id
	);
	expect(plotId).toBeTruthy();
	const handle = page.locator(`#plot${plotId} .tp-resize, [data-plot-id="${plotId}"] .tp-resize`);
	const resizer = (await handle.count())
		? handle.first()
		: page.getByRole('separator', { name: /^Resize column / }).first();
	await resizer.scrollIntoViewIfNeeded();
	await expect(resizer).toHaveAttribute('aria-valuemin', '56');
	const label = await resizer.getAttribute('aria-label');
	expect(label).toMatch(/^Resize column \S/);
	const start = Number(await resizer.getAttribute('aria-valuenow'));
	expect(start).toBeGreaterThan(56);
	const undosBefore = await page.evaluate(() => window.__history.undoCount);

	await resizer.focus();
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('Shift+ArrowRight');
	await expect(resizer).toHaveAttribute('aria-valuenow', String(start + 70));
	const header = resizer.locator('xpath=..');
	expect(Math.round((await header.boundingBox()).width)).toBe(start + 70);
	await page.screenshot({ path: path.join(SHOTS, 'table-resizer-focused.png') });
	// A quick run of presses on one column is one step.
	expect(await page.evaluate(() => window.__history.undoCount)).toBe(undosBefore + 1);

	await page.keyboard.press('Home');
	await expect(resizer).toHaveAttribute('aria-valuenow', '56');
	await page.waitForTimeout(700); // past the coalesce window
	await page.keyboard.press('ArrowRight');
	await expect(resizer).toHaveAttribute('aria-valuenow', '66');
	await page.waitForTimeout(700);
	await undo(page);
	await expect(resizer).toHaveAttribute('aria-valuenow', '56');
});

test('groups, columns and plots reorder with Alt+Arrow in the data panel', async ({ page }) => {
	await load(page, 'demo-workflow-join-data');
	await openDataPanel(page);
	const original = await groupIds(page);
	expect(original.slice(0, 2)).toEqual(['group_1', 'group_2']);

	// A group: down one place.
	const group = page.locator('[data-reorder-key="group-group_1"]');
	await expect(group).toHaveAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown');
	await group.focus();
	await page.keyboard.press('Alt+ArrowDown');
	await expect.poll(() => groupIds(page)).toEqual(['group_2', 'group_1', ...original.slice(2)]);
	await expect.poll(() => activeKey(page)).toBe('group-group_1');
	await expect(announcer(page)).toHaveText('Moved weather station to position 2 of 5.');
	await page.screenshot({ path: path.join(SHOTS, 'group-row-focused.png') });
	await undo(page);
	await expect.poll(() => groupIds(page)).toEqual(original);
	await redo(page);
	await expect.poll(() => groupIds(page)).toEqual(['group_2', 'group_1', ...original.slice(2)]);
	await undo(page);
	await expect.poll(() => groupIds(page)).toEqual(original);
	// At the top already: nothing moves, and it is said.
	await group.focus();
	await page.keyboard.press('Alt+ArrowUp');
	await expect(announcer(page)).toHaveText('weather station is already first.');
	expect(await groupIds(page)).toEqual(original);

	// A column: open the group with its caret (Enter), then move its first column down.
	await page.getByRole('button', { name: 'Show weather station' }).focus();
	await page.keyboard.press('Enter');
	const cols = () =>
		page.evaluate(() => window.__core.groups.find((g) => g.id === 'group_1').sourceColumnIds);
	const startCols = await cols();
	const [first, second, third] = startCols;
	const name = await page.evaluate((id) => window.__core.data.find((c) => c.id === id).name, first);
	const row = page.locator(`[data-reorder-key="col-${first}"]`);
	await expect(row).toBeVisible();
	await row.focus();
	await page.keyboard.press('Alt+ArrowDown');
	await expect.poll(cols).toEqual([second, first, third]);
	await expect.poll(() => activeKey(page)).toBe(`col-${first}`);
	await expect(announcer(page)).toHaveText(`Moved ${name} to position 2 of 3 in weather station.`);
	await page.screenshot({ path: path.join(SHOTS, 'column-row-focused.png') });
	await undo(page);
	await expect.poll(cols).toEqual(startCols);

	// Past the end of its group it moves into the next one, as a drop there would.
	const last = page.locator(`[data-reorder-key="col-${third}"]`);
	await last.focus();
	await page.keyboard.press('Alt+ArrowDown');
	await expect.poll(cols).toEqual([first, second]);
	const next = await page.evaluate(
		() => window.__core.groups.find((g) => g.id === 'group_2').sourceColumnIds
	);
	expect(next[0]).toBe(third);
	await expect.poll(() => activeKey(page)).toBe(`col-${third}`);
	await expect(announcer(page)).toHaveText(/ to position 1 of 4 in field logger\.$/);
	await undo(page);
	await expect.poll(cols).toEqual(startCols);

	// A plot row (listed topmost first): up one place.
	const plotIds = () => page.evaluate(() => window.__core.plots.map((p) => p.id));
	const plots = await plotIds();
	const bottom = plots[0]; // drawn first, listed last
	const plotRow = page.locator(`[data-reorder-key="plot-${bottom}"]`);
	await plotRow.focus();
	await page.keyboard.press('Alt+ArrowUp');
	await expect.poll(plotIds).toEqual([plots[1], plots[0], ...plots.slice(2)]);
	await expect.poll(() => activeKey(page)).toBe(`plot-${bottom}`);
	await expect(announcer(page)).toHaveText(
		new RegExp(`to position ${plots.length - 1} of ${plots.length}\\.$`)
	);
	await undo(page);
	await expect.poll(plotIds).toEqual(plots);
});

test('a dragged group is one undo step, and redo puts it back', async ({ page }) => {
	await load(page, 'demo-workflow-join-data');
	await openDataPanel(page);
	const original = await groupIds(page);
	const undosBefore = await page.evaluate(() => window.__history.undoCount);
	await page
		.locator('[data-reorder-key="group-group_3"]')
		.dragTo(page.locator('[data-reorder-key="group-group_1"]'));
	const moved = ['group_3', 'group_1', 'group_2', ...original.slice(3)];
	await expect.poll(() => groupIds(page)).toEqual(moved);
	expect(await page.evaluate(() => window.__history.undoCount)).toBe(undosBefore + 1);
	await page.locator('#data-panel .search-input').focus(); // Cmd+Z needs focus off a text field
	await page.locator('#data-panel .search-input').blur();
	await undo(page);
	await expect.poll(() => groupIds(page)).toEqual(original);
	await redo(page);
	await expect.poll(() => groupIds(page)).toEqual(moved);
});

test("a plot's series reorders with Alt+Arrow on its grip", async ({ page }) => {
	await load(page, 'demo-circular-phase-two-groups');
	const plotIndex = await page.evaluate(() =>
		window.__core.plots.findIndex((p) => (p.plot?.data?.length ?? 0) >= 3)
	);
	expect(plotIndex).toBeGreaterThanOrEqual(0);
	await page.evaluate((i) => {
		window.__core.plots[i].selected = true;
		window.__appState.showControlPanel = true;
	}, plotIndex);
	await page.waitForTimeout(700);
	await page.locator('.control-display .control-tab button', { hasText: 'Data' }).first().click();
	const order = () =>
		page.evaluate(
			(i) => window.__core.plots[i].plot.data.map((d) => JSON.stringify(d.toJSON?.() ?? d)),
			plotIndex
		);
	const before = await order();
	const grips = page.locator('.control-display .series-drag-handle');
	await expect(grips).toHaveCount(before.length);
	await expect(grips.first()).toHaveAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown');
	// Reach the grip from the keyboard (the Data tab was clicked, so a scripted focus alone
	// would not count as keyboard focus and the ring would not show in the screenshot).
	await grips.first().focus();
	await page.keyboard.press('Shift+Tab');
	await page.keyboard.press('Tab');
	await expect(grips.first()).toBeFocused();
	await page.keyboard.press('Alt+ArrowDown');
	await expect.poll(order).toEqual([before[1], before[0], ...before.slice(2)]);
	// Focus stays on the moved block's grip (now the second one).
	await expect
		.poll(() =>
			page.evaluate(() => {
				const all = [...document.querySelectorAll('.control-display .series-drag-handle')];
				return all.indexOf(document.activeElement);
			})
		)
		.toBe(1);
	await expect(announcer(page)).toHaveText(new RegExp(`to position 2 of ${before.length}\\.$`));
	await page.waitForTimeout(1000); // the blocks' move animation
	await page.screenshot({ path: path.join(SHOTS, 'series-grip-focused.png') });
	await undo(page);
	await expect.poll(order).toEqual(before);
});

// The data panel's lists are each ONE Tab stop (a roving tabindex over a treegrid,
// utils/rovingRows.js): Tab lands on one row per list and then that row's own buttons, never
// on the other rows or their buttons; Up/Down/Home/End move between rows, Right/Left open,
// enter, leave and close a group, and Alt+Arrow still moves the focused row (one undo step).
test('each data-panel list is one Tab stop, walked with the arrows', async ({ page }) => {
	await load(page, 'demo-workflow-join-data');
	await openDataPanel(page);
	const search = page.locator('#data-panel .search-input');
	await search.focus();

	// Tab through the whole panel, noting where focus lands.
	const stops = [];
	for (let i = 0; i < 400; i++) {
		await page.keyboard.press('Tab');
		const at = await page.evaluate(() => {
			const el = document.activeElement;
			if (!el?.closest('#data-panel')) return null;
			const row = el.closest('[data-roving-row]');
			return {
				grid: el.closest('[role="treegrid"]')?.getAttribute('aria-label') ?? null,
				row: row?.dataset.reorderKey ?? null,
				isRow: el === row
			};
		});
		if (!at) break;
		stops.push(at);
	}
	const inGrid = (name) => stops.filter((s) => s.grid === name);
	for (const name of ['Data columns', 'Plots']) {
		const rowStops = inGrid(name).filter((s) => s.isRow);
		expect(rowStops, `${name}: rows reached by Tab`).toHaveLength(1);
		// Everything else Tab reached in this list belongs to that one row.
		expect(new Set(inGrid(name).map((s) => s.row))).toEqual(new Set([rowStops[0].row]));
	}
	expect(inGrid('Data columns')[0]).toEqual({
		grid: 'Data columns',
		row: 'group-group_1',
		isRow: true
	});

	// Arrows within the Data list. The groups start closed: Down goes group to group.
	const group1 = page.locator('[data-reorder-key="group-group_1"]');
	const dataCaret = page.getByRole('button', { name: 'Show data' });
	await dataCaret.focus(); // the last stop before the list
	await page.keyboard.press('Tab');
	await expect(group1).toBeFocused();
	await expect(group1).toHaveAttribute('aria-expanded', 'false');
	await page.keyboard.press('ArrowDown');
	await expect.poll(() => activeKey(page)).toBe('group-group_2');
	await page.keyboard.press('ArrowUp');
	await expect.poll(() => activeKey(page)).toBe('group-group_1');
	// Right opens, Right again enters, Down walks the columns, Left leaves, Left closes.
	await page.keyboard.press('ArrowRight');
	await expect(group1).toHaveAttribute('aria-expanded', 'true');
	await expect(group1).toBeFocused();
	const cols = await page.evaluate(
		() => window.__core.groups.find((g) => g.id === 'group_1').sourceColumnIds
	);
	await page.keyboard.press('ArrowRight');
	await expect.poll(() => activeKey(page)).toBe(`col-${cols[0]}`);
	await page.keyboard.press('ArrowDown');
	await expect.poll(() => activeKey(page)).toBe(`col-${cols[1]}`);
	await page.screenshot({ path: path.join(SHOTS, 'roving-column-row-focused.png') });
	await page.keyboard.press('ArrowLeft');
	await expect.poll(() => activeKey(page)).toBe('group-group_1');
	await page.keyboard.press('ArrowLeft');
	await expect(group1).toHaveAttribute('aria-expanded', 'false');
	await page.keyboard.press('End');
	const lastKey = await activeKey(page);
	expect(lastKey).not.toBe('group-group_1');
	await page.keyboard.press('Home');
	await expect.poll(() => activeKey(page)).toBe('group-group_1');

	// Shift+Tab out and Tab back in returns to the row last used, not the first.
	await page.keyboard.press('ArrowDown');
	await expect.poll(() => activeKey(page)).toBe('group-group_2');
	await page.keyboard.press('Shift+Tab');
	await expect(dataCaret).toBeFocused();
	await page.keyboard.press('Tab');
	await expect.poll(() => activeKey(page)).toBe('group-group_2');
	await page.screenshot({ path: path.join(SHOTS, 'roving-group-row-focused.png') });

	// Alt+Arrow on a row reached by the arrows still moves it: one undo step, announced.
	const original = await groupIds(page);
	const undosBefore = await page.evaluate(() => window.__history.undoCount);
	await page.keyboard.press('Alt+ArrowUp');
	await expect.poll(() => groupIds(page)).toEqual(['group_2', 'group_1', ...original.slice(2)]);
	await expect.poll(() => activeKey(page)).toBe('group-group_2');
	expect(await page.evaluate(() => window.__history.undoCount)).toBe(undosBefore + 1);
	await expect(announcer(page)).toHaveText(/ to position 1 of 5\.$/);
	await undo(page);
	await expect.poll(() => groupIds(page)).toEqual(original);

	// The Plots list: Down to the next plot, Enter selects it, Alt+Arrow moves it.
	const plots = await page.evaluate(() => window.__core.plots.map((p) => p.id));
	const listed = plots.slice().reverse(); // topmost first
	await page.locator(`[data-reorder-key="plot-${listed[0]}"]`).focus();
	await page.keyboard.press('ArrowDown');
	await expect.poll(() => activeKey(page)).toBe(`plot-${listed[1]}`);
	await page.keyboard.press('Enter');
	await expect
		.poll(() => page.evaluate(() => window.__core.plots.filter((p) => p.selected).map((p) => p.id)))
		.toEqual([listed[1]]);
	await page.screenshot({ path: path.join(SHOTS, 'roving-plot-row-focused.png') });
	await page.keyboard.press('Alt+ArrowUp');
	await expect
		.poll(() => page.evaluate(() => window.__core.plots.map((p) => p.id)))
		.toEqual([...plots.slice(0, plots.length - 2), listed[0], listed[1]]);
	await expect.poll(() => activeKey(page)).toBe(`plot-${listed[1]}`);
	await undo(page);
	await expect.poll(() => page.evaluate(() => window.__core.plots.map((p) => p.id))).toEqual(plots);
});

test("a plot's series grips are one Tab stop, walked with Up/Down", async ({ page }) => {
	await load(page, 'demo-circular-phase-two-groups');
	const plotIndex = await page.evaluate(() =>
		window.__core.plots.findIndex((p) => (p.plot?.data?.length ?? 0) >= 3)
	);
	await page.evaluate((i) => {
		window.__core.plots[i].selected = true;
		window.__appState.showControlPanel = true;
	}, plotIndex);
	await page.waitForTimeout(700);
	await page.locator('.control-display .control-tab button', { hasText: 'Data' }).first().click();
	const grips = page.locator('.control-display .series-drag-handle');
	const n = await grips.count();
	expect(n).toBeGreaterThanOrEqual(3);
	const tabbable = () =>
		page.evaluate(() =>
			[...document.querySelectorAll('.control-display .series-drag-handle')].map((g) =>
				g.getAttribute('tabindex')
			)
		);
	expect(await tabbable()).toEqual(['0', ...Array(n - 1).fill('-1')]);
	const focusedIndex = () =>
		page.evaluate(() =>
			[...document.querySelectorAll('.control-display .series-drag-handle')].indexOf(
				document.activeElement
			)
		);
	await grips.first().focus();
	await page.keyboard.press('ArrowDown');
	await expect.poll(focusedIndex).toBe(1);
	await expect.poll(tabbable).toEqual(['-1', '0', ...Array(n - 2).fill('-1')]);
	await page.keyboard.press('End');
	await expect.poll(focusedIndex).toBe(n - 1);
	await page.keyboard.press('Home');
	await expect.poll(focusedIndex).toBe(0);
	await page.keyboard.press('ArrowDown');
	await expect.poll(focusedIndex).toBe(1);

	// Alt+Arrow on the grip reached by the arrow moves that series, one undo step.
	const order = () =>
		page.evaluate(
			(i) => window.__core.plots[i].plot.data.map((d) => JSON.stringify(d.toJSON?.() ?? d)),
			plotIndex
		);
	const before = await order();
	await page.keyboard.press('Alt+ArrowUp');
	await expect.poll(order).toEqual([before[1], before[0], ...before.slice(2)]);
	await expect.poll(focusedIndex).toBe(0);
	await expect.poll(tabbable).toEqual(['0', ...Array(n - 1).fill('-1')]);
	await undo(page);
	await expect.poll(order).toEqual(before);
});
