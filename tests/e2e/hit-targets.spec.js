import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { openApp, failingTargets as failing } from './helpers.js';

// UI-16: icon buttons have a pointer target of at least 24 x 24 CSS px (WCAG 2.2 SC 2.5.8,
// Target Size (Minimum)), measured on the rendered page: a 24 x 24 square centred on the
// button must hit-test to the button everywhere (elementFromPoint), or the button must meet
// the criterion's spacing exception (a 24 px circle on its centre touches no other target
// and no other undersized target's circle). Measuring hit-testing, not the box, is the point:
// the glyphs stay small and the target is an invisible ::after (app.css, .hit-target and
// button.icon), which a bounding-box check would never see.
//
// Scope: the node header (note, quick plot, maximise, collapse, delete), the node rows (row
// chevrons and wiring port dots of data, group, analysis, metric and plot rows, which are
// NODE_ROW_H = 24 px apart, see nodeRows.js), compact nodes' port dots (COMPACT_PORT_H apart),
// the workspace plot header (with the selected plot's docked actions), and the control
// panel's rows (series blocks, banner).

const DEMO = path.resolve('static/sessions/demos/demo-tp-cosinor.json');

async function loadDemo(page) {
	await openApp(page);
	await page.locator('button.primary-card', { hasText: 'Import data' }).click();
	const [chooser] = await Promise.all([
		page.waitForEvent('filechooser'),
		page.locator('button.dialog-button', { hasText: /Choose File|Change file/ }).click()
	]);
	await chooser.setFiles(DEMO);
	await expect(page.locator('.workflow-node-wrapper').first()).toBeVisible({ timeout: 30000 });
}

test('node header icon buttons have 24 x 24 pointer targets', async ({ page }) => {
	await page.setViewportSize({ width: 1400, height: 1000 });
	await loadDemo(page);
	// The Cosinor node's header, hovered so its action cluster is revealed.
	const header = page
		.locator('.tp-header')
		.filter({ hasText: /^\s*Cosinor\s*$/ })
		.first();
	await header.hover();
	const headers =
		'.workflow-node-wrapper .tp-header button, .workflow-node-wrapper .node-header button, .node-actions button';
	expect(await failing(page, headers, 4)).toEqual([]);
});

/** A session as a file chooser payload, so a test can load a variant of a shipped one. */
async function loadSession(page, name, session) {
	await openApp(page);
	await page.locator('button.primary-card', { hasText: 'Import data' }).click();
	const [chooser] = await Promise.all([
		page.waitForEvent('filechooser'),
		page.locator('button.dialog-button', { hasText: /Choose File|Change file/ }).click()
	]);
	await chooser.setFiles({
		name,
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(session))
	});
	await expect(page.locator('.workflow-node-wrapper').first()).toBeVisible({ timeout: 30000 });
}

test('node rows: row chevrons and port dots have 24 x 24 pointer targets', async ({ page }) => {
	await page.setViewportSize({ width: 1500, height: 1100 });
	// The Rhythmicity demo (data node, analysis with series and metric rows, grouped plots)
	// with its raw column in a Group node, so group rows are measured too.
	const s = JSON.parse(
		fs.readFileSync(path.resolve('static/sessions/demos/demo-tp-rhythmicityanalysis.json'))
	);
	const raw = s.data.find((c) => c.name === 'y');
	s.groups = [
		{
			...{ id: 'group_1', name: 'Recordings', x: 60, y: 420, width: 240, height: 120 },
			...{ sourceColumnIds: [raw.id], allColumnIds: null, collapsed: false, rowState: {} }
		}
	];
	await loadSession(page, 'rows.json', s);
	await expect(page.locator('.port-dot[data-node-id^="plot_"]').first()).toBeVisible();
	await expect(page.locator('.group-card .row-chev')).toBeVisible();
	const metrics = page.locator('button.metrics-header[aria-expanded="false"]');
	if (await metrics.count()) await metrics.first().click();
	// Every node kind on the canvas: the group's, the analysis's and the data node's rows, and
	// the plot nodes' input and output dots (rendered by WorkflowNode).
	expect(await failing(page, '.row-chev, .port-dot', 20)).toEqual([]);
});

test('compact nodes: port dots have 24 x 24 pointer targets', async ({ page }) => {
	await page.setViewportSize({ width: 1500, height: 1100 });
	// The Rhythmicity demo with its data and analysis nodes collapsed: the analysis square
	// has two inputs and four outputs, the busiest stacks on the canvas.
	const s = JSON.parse(
		fs.readFileSync(path.resolve('static/sessions/demos/demo-tp-rhythmicityanalysis.json'))
	);
	for (const [id, v] of Object.entries(s.nodeLayout))
		if (/^(data|tableprocess)_/.test(id)) v.collapsed = true;
	await loadSession(page, 'compact.json', s);
	await expect(page.locator('.compact-node .port-dot').first()).toBeVisible();
	expect(await failing(page, '.compact-node .port-dot', 8)).toEqual([]);
});

test('workspace plot header, its toolbar and the control panel rows have 24 x 24 pointer targets', async ({
	page
}) => {
	await page.setViewportSize({ width: 1400, height: 1000 });
	await loadDemo(page);
	await page.getByTestId('nav-workspace-view').click();
	const plotHeader = page.locator('.canvas-inner .draggable .plot-header').first();
	await expect(plotHeader).toBeVisible();
	await plotHeader.hover();
	expect(await failing(page, '.canvas-inner .draggable .plot-header button', 3)).toEqual([]);

	// Selecting the plot docks its actions (zoom, save) in its header and opens the control
	// panel on it.
	await plotHeader.click({ position: { x: 250, y: 10 } });
	await expect(page.locator('.plot-header .plot-toolbar button').first()).toBeVisible();
	expect(await failing(page, '.plot-header button', 4)).toEqual([]);

	const panel = page.locator('div.control-display');
	if (!(await panel.isVisible()))
		await page.locator('.control-panel-toggle, [aria-label*="control panel" i]').first().click();
	await expect(panel).toBeVisible();
	await panel.locator('button', { hasText: /^Data$/ }).click();
	expect(
		await failing(page, 'div.control-display button.icon, div.control-display .hit-target', 6)
	).toEqual([]);
});
