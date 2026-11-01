import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { expectNoOverflow } from './helpers.js';

// The Circadian Function Index node's "Full days only" option (v82.66), checked as a user
// meets it: on the shipped CFI example, on a new node added from the palette and wired on the
// canvas to a 7.5-day record, and on a record shorter than a day. Each panel state is
// screenshotted (E2E_SHOTS, default test-results/cfi-full-days) and checked for overflow.
// The Nonparametric RA, Average Profile and Rayleigh examples share the CFI panel's results
// layout (a wide table above wrapping notes), which used to run past the control panel's
// clip edge; they are checked for the same overflow and the same 8 px gap under the table.
// Runs against a dev server (E2E_BASE_URL): it reads the session through `window.__core`.

test.use({ viewport: { width: 1500, height: 1000 } });

const SHOTS = process.env.E2E_SHOTS || 'test-results/cfi-full-days';
mkdirSync(SHOTS, { recursive: true });
const shot = (locator, name) => locator.screenshot({ path: path.join(SHOTS, `${name}.png`) });

const TIME_ID = 938;
const ACT_ID = 939;
const TOOLTIP = 'Cut the record to whole days from the first sample, as nparACT does';

/**
 * The CFI example with its analysis, plot and note removed: an hourly record of `hours`
 * samples (x in hours since start) with a 12:12 activity pattern, for a node the test adds.
 */
function fixture(hours) {
	const s = JSON.parse(
		readFileSync('static/sessions/demos/demo-tp-circadianfunctionindex.json', 'utf8')
	);
	const t = Array.from({ length: hours }, (_, i) => i);
	// The half day after the last whole one is disrupted (flat), so leaving it out shows.
	const y = t.map((h) =>
		h >= 168 ? 40 : h % 24 >= 8 && h % 24 < 20 ? 80 + ((h * 7) % 13) : 5 + ((h * 3) % 4)
	);
	s.rawData = { [TIME_ID]: t, [ACT_ID]: y };
	s.data = s.data.filter((c) => c.id === TIME_ID || c.id === ACT_ID);
	s.data.find((c) => c.id === TIME_ID).name = 'time (h)';
	s.data.find((c) => c.id === ACT_ID).name = 'activity';
	Object.assign(s, { tableProcesses: [], plots: [], notes: [], nodeNotes: {}, storedValues: [] });
	s.nodeLayout = { [`data_${TIME_ID}`]: { x: 60, y: 60 }, [`data_${ACT_ID}`]: { x: 60, y: 420 } };
	return JSON.stringify(s);
}

async function loadSession(page, url, body) {
	await page.routeWebSocket(/.*/, () => {}); // no live reload mid-test
	if (body)
		await page.route(`**${url}`, (route) =>
			route.fulfill({ contentType: 'application/json', body })
		);
	await page.goto(`/?loadFromURL=${encodeURIComponent(url)}`);
	await page.waitForFunction(
		() =>
			window.__core && window.__core.data.length >= 2 && !window.__appState.loadingState.isLoading,
		null,
		{ timeout: 60_000 }
	);
	await page.waitForTimeout(1000);
}

/** Drag a wire from one port dot to another, as a user does (pointer down, move, up). */
async function dragWire(page, from, to) {
	const a = await from.boundingBox();
	const b = await to.boundingBox();
	await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
	await page.mouse.down();
	for (let k = 1; k <= 12; k++) {
		await page.mouse.move(
			a.x + a.width / 2 + ((b.x - a.x) * k) / 12,
			a.y + a.height / 2 + ((b.y - a.y) * k) / 12
		);
	}
	await page.mouse.up();
	await page.waitForTimeout(500);
}

const port = (page, nodeId, dir, name) =>
	page.locator(
		`.port-dot[data-node-id="${nodeId}"][data-port-dir="${dir}"]${name ? `[data-port-name="${name}"]` : ''}`
	);

/** Add a CFI node from the palette and wire the record's time and activity to it. */
async function addWiredCFI(page) {
	await page.locator('.np-trigger').click();
	await page.getByPlaceholder('Search nodes').fill('Circadian Function');
	await page.locator('.np-item', { hasText: 'Circadian Function Index' }).first().click();
	const node = page.locator('.workflow-node-wrapper[data-node-id^="tableprocess_"]');
	await expect(node).toHaveCount(1);
	const nodeId = await node.getAttribute('data-node-id');
	await dragWire(page, port(page, `data_${TIME_ID}`, 'out'), port(page, nodeId, 'in', 'xIN'));
	await dragWire(page, port(page, `data_${ACT_ID}`, 'out'), port(page, nodeId, 'in', 'yIN'));
	await expect
		.poll(() => page.evaluate(() => JSON.stringify(window.__core.tableProcesses[0].args.yIN)))
		.toBe(`[${ACT_ID}]`);
	expect(await page.evaluate(() => window.__core.tableProcesses[0].args.xIN)).toBe(TIME_ID);
	return nodeId;
}

/** Select a node by its title and open the control panel on it. */
async function openPanel(page, nodeId, ready = fullDays) {
	await page.locator(`.workflow-node-wrapper[data-node-id="${nodeId}"] .tp-title`).first().click();
	await page.locator('button[aria-label="Open control panel"]').click();
	const panel = page.locator('.control-display');
	await expect(ready(panel)).toBeVisible();
	return panel;
}

const fullDays = (panel) => panel.getByRole('checkbox', { name: 'Full days only' });
const cfiCell = (panel) => panel.locator('.cfi-results tbody tr').first().locator('td').nth(1);
const cfiText = async (panel) => (await cfiCell(panel).innerText()).trim();
const NOTE = /Full days only: \d+ whole cycles? used/;

/** The first note or warning sits 8 px below the results table, whichever it is. */
async function expectGapBelowTable(panel, results, first) {
	const gap = await panel.locator(results).evaluate((el, first) => {
		const table = el.querySelector(':scope > .scroll-fade-x');
		const p = el.querySelector(`:scope > ${first}`);
		return p.getBoundingClientRect().top - table.getBoundingClientRect().bottom;
	}, first);
	expect(Math.abs(gap - 8)).toBeLessThan(1);
}

test('the CFI example: Full days only is shown with its tooltip, off as loaded', async ({
	page
}) => {
	await loadSession(page, '/sessions/demos/demo-tp-circadianfunctionindex.json');
	const panel = await openPanel(page, 'tableprocess_99');
	const box = fullDays(panel);
	await expect(box).toBeVisible();
	await expect(box.locator('xpath=ancestor::label[1]')).toHaveAttribute('title', TOOLTIP);
	// The example was saved before the option existed, so it keeps its partial-day behaviour.
	await expect(box).not.toBeChecked();
	expect(await page.evaluate(() => window.__core.tableProcesses[0].args.fullDays)).toBe(false);
	await expect(cfiCell(panel)).toHaveText(/^\s*0\.943/);
	await expect(panel.locator('.cfi-results')).not.toContainText(NOTE);
	await expectNoOverflow(panel);
	await shot(panel, '1-demo-panel');
	await shot(page.locator('.workflow-node-wrapper[data-node-id="tableprocess_99"]'), '1-demo-node');
});

test('a new CFI node on a 7.5-day record: on by default, note, off changes CFI, undo', async ({
	page
}) => {
	await loadSession(page, '/e2e-cfi-7.5d.json', fixture(180));
	const nodeId = await addWiredCFI(page);
	const panel = await openPanel(page, nodeId);
	const box = fullDays(panel);
	await expect(box).toBeChecked();
	await expect(panel.locator('.cfi-results')).toContainText(
		'Full days only: 7 whole cycles used; the last 12 h are left out.'
	);
	await expect(cfiCell(panel)).toHaveText(/^\s*\d\.\d{3}/);
	const cfiOn = await cfiText(panel);
	await expectNoOverflow(panel);
	await expectGapBelowTable(panel, '.cfi-results', 'p.cfi-hint');
	await shot(panel, '2a-new-node-on-panel');
	await shot(
		page.locator(`.workflow-node-wrapper[data-node-id="${nodeId}"]`),
		'2a-new-node-on-node'
	);

	await box.click();
	await expect(box).not.toBeChecked();
	await expect.poll(() => cfiText(panel)).not.toBe(cfiOn);
	await expect(panel.locator('.cfi-results')).not.toContainText(NOTE);
	const cfiOff = await cfiText(panel);
	expect(cfiOff).toMatch(/^\d\.\d{3}/);
	await expectNoOverflow(panel);
	await shot(panel, '2b-new-node-off-panel');

	await page.locator('button[aria-label="Undo"]').click();
	await expect(box).toBeChecked();
	await expect(panel.locator('.cfi-results')).toContainText('the last 12 h are left out.');
	await expect.poll(() => cfiText(panel)).toBe(cfiOn);
	await shot(panel, '2c-new-node-undo-panel');
});

test('a record shorter than a day warns that there is no whole day to keep', async ({ page }) => {
	await loadSession(page, '/e2e-cfi-18h.json', fixture(18));
	const nodeId = await addWiredCFI(page);
	const panel = await openPanel(page, nodeId);
	await expect(fullDays(panel)).toBeChecked();
	await expect(panel.locator('.cfi-results .warn')).toHaveText(
		'Full days only: the recording is shorter than one 24 h cycle, so there is no whole day to keep and every epoch is used.'
	);
	await expect(panel.locator('.cfi-results')).not.toContainText(NOTE);
	await expectNoOverflow(panel);
	await expectGapBelowTable(panel, '.cfi-results', 'p.warn');
	await shot(panel, '3-short-record-panel');
	await shot(
		page.locator(`.workflow-node-wrapper[data-node-id="${nodeId}"]`),
		'3-short-record-node'
	);
});

test('Nonparametric RA: notes, warnings and the explanation stay inside the panel', async ({
	page
}) => {
	await loadSession(page, '/sessions/demos/demo-tp-nonparametricra.json');
	const panel = await openPanel(page, 'tableprocess_85');
	const results = panel.locator('.npcra-results');
	await expect(results.locator('tbody tr')).toHaveCount(1);
	await expectNoOverflow(panel);
	await shot(panel, '4a-npcra-demo-panel');

	// Full days only on the 14-day example: a note under the table.
	await fullDays(panel).click();
	await expect(results).toContainText('Full days only: 14 whole cycles used, nothing left out.');
	await expectNoOverflow(panel);
	await expectGapBelowTable(panel, '.npcra-results', 'p.npcra-hint');
	await shot(panel, '4b-npcra-full-days-panel');

	// A period longer than the record: the short-record warning under the table instead.
	const period = panel.locator('.control-input', { hasText: 'Period (h)' }).locator('input');
	await period.fill('400');
	await period.press('Tab');
	await expect(results.locator('.warn', { hasText: 'shorter than one 400 h cycle' })).toBeVisible();
	await expectNoOverflow(panel);
	await expectGapBelowTable(panel, '.npcra-results', 'p.warn');
	await shot(panel, '4c-npcra-short-record-panel');
});

for (const [name, demo, nodeId, results] of [
	['Average Profile', 'averageprofile', 'tableprocess_97', '.avgprof-results'],
	['Rayleigh test', 'rayleightest', 'tableprocess_98', '.rayleigh-results']
]) {
	test(`${name}: the results stay inside the panel`, async ({ page }) => {
		await loadSession(page, `/sessions/demos/demo-tp-${demo}.json`);
		const panel = await openPanel(page, nodeId, (p) => p.locator(`${results} table`));
		await expectNoOverflow(panel);
		await shot(panel, `5-${demo}-panel`);
	});
}
