import { test, expect } from '@playwright/test';
import path from 'node:path';
import { openApp } from './helpers.js';

// UI-7: every worked example's note card opened on top of the first plot in the Workspace
// view. Notes now get a lane above the plots when a session loads (notePlacement.js); the
// unit test checks every shipped session through the same layout functions, this checks
// the rendered cards for three of the demos named in the report.
const DEMOS = ['demo-tp-cosinor.json', 'demo-fft-rhythm.json', 'demo-periodogram-rhythm.json'];

function noteOverPlot(page) {
	return page.evaluate(() => {
		const boxes = (sel) =>
			[...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect());
		const notes = boxes('.canvas-inner .note-card');
		const plots = boxes('.canvas-inner .draggable');
		const hits = [];
		for (const n of notes)
			for (const p of plots)
				if (n.left < p.right && p.left < n.right && n.top < p.bottom && p.top < n.bottom)
					hits.push([Math.round(n.left), Math.round(n.top), Math.round(p.left), Math.round(p.top)]);
		return { notes: notes.length, plots: plots.length, hits };
	});
}

for (const demo of DEMOS) {
	test(`${demo}: the note card does not cover a plot in the Workspace view`, async ({
		page
	}, info) => {
		await page.setViewportSize({ width: 1400, height: 900 });
		await openApp(page);
		await page.locator('button.primary-card', { hasText: 'Import data' }).click();
		const [chooser] = await Promise.all([
			page.waitForEvent('filechooser'),
			page.locator('button.dialog-button', { hasText: /Choose File|Change file/ }).click()
		]);
		await chooser.setFiles(path.resolve('static/sessions/demos', demo));
		await expect(page.locator('.workflow-node-wrapper').first()).toBeVisible({ timeout: 30000 });
		await page.getByTestId('nav-workspace-view').click();
		await expect(page.locator('.canvas-inner .note-card').first()).toBeVisible();
		await expect(page.locator('.canvas-inner .draggable').first()).toBeVisible();
		const r = await noteOverPlot(page);
		expect(r.notes).toBeGreaterThan(0);
		expect(r.plots).toBeGreaterThan(0);
		expect(r.hits).toEqual([]);
		await page.screenshot({ path: info.outputPath(`${demo.replace('.json', '')}-workspace.png`) });
	});
}
