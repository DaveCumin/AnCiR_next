import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { openApp } from './helpers.js';

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
// the workspace plot header and its selection
// toolbar, and the control panel's rows (series blocks, banner).

const DEMO = path.resolve('static/sessions/demos/demo-tp-cosinor.json');

/** Runs in the page. One entry per visible target matched by `selector`. */
function measure(selector) {
	const visible = (e) => {
		const r = e.getBoundingClientRect();
		const cs = getComputedStyle(e);
		return (
			r.width > 0 &&
			r.height > 0 &&
			cs.visibility !== 'hidden' &&
			cs.display !== 'none' &&
			Number(cs.opacity) > 0 &&
			r.top >= 0 &&
			r.left >= 0 &&
			r.bottom <= innerHeight &&
			r.right <= innerWidth
		);
	};
	const targets = [...document.querySelectorAll(selector)].filter(visible).map((el) => {
		const r = el.getBoundingClientRect();
		const cx = r.left + r.width / 2;
		const cy = r.top + r.height / 2;
		let full = true;
		for (let dx = -11.5; dx <= 11.5; dx += 2.875) {
			for (let dy = -11.5; dy <= 11.5; dy += 2.875) {
				const hit = document.elementFromPoint(cx + dx, cy + dy);
				if (!hit || !(hit === el || el.contains(hit))) full = false;
			}
		}
		return { el, r, cx, cy, full };
	});
	return targets.map((t) => {
		const spaced =
			!t.full &&
			targets.every((o) => {
				if (o === t) return true;
				const nx = Math.max(o.r.left, Math.min(t.cx, o.r.right));
				const ny = Math.max(o.r.top, Math.min(t.cy, o.r.bottom));
				if (Math.hypot(nx - t.cx, ny - t.cy) < 12) return false;
				return o.full || Math.hypot(o.cx - t.cx, o.cy - t.cy) >= 24;
			});
		const label =
			t.el.getAttribute('aria-label') ||
			t.el.getAttribute('title') ||
			t.el.textContent.trim().slice(0, 24) ||
			t.el.className;
		return {
			label: `${label} (${Math.round(t.r.width)}x${Math.round(t.r.height)})`,
			ok: t.full || spaced
		};
	});
}

async function failing(page, selector, minCount) {
	const all = await page.evaluate(measure, selector);
	expect(all.length, `targets matched by ${selector}`).toBeGreaterThanOrEqual(minCount);
	return all.filter((t) => !t.ok).map((t) => t.label);
}

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

	// Selecting the plot shows its toolbar and opens the control panel on it.
	await plotHeader.click({ position: { x: 250, y: 10 } });
	await expect(page.locator('.selection-toolbar-host button').first()).toBeVisible();
	expect(await failing(page, '.selection-toolbar-host button', 2)).toEqual([]);

	const panel = page.locator('div.control-display');
	if (!(await panel.isVisible()))
		await page.locator('.control-panel-toggle, [aria-label*="control panel" i]').first().click();
	await expect(panel).toBeVisible();
	await panel.locator('button', { hasText: /^Data$/ }).click();
	expect(
		await failing(page, 'div.control-display button.icon, div.control-display .hit-target', 6)
	).toEqual([]);
});
