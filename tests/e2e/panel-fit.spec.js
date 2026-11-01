import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expectNoOverflow } from './helpers.js';

// Analysis panels fit the control panel, at its default width (250 px) and its narrowest
// (200 px): nothing runs past the panel's clip edge. The panel's .control-component sizes
// each child to its content, so an Output section holding column rows (a nowrap name and a
// "Label" field) used to run past the edge, cutting the summary's chevron and the Label
// fields (shared fix in routes/+page.svelte). Also the Rayleigh panel's Watson-Williams
// result: each statistic keeps its store button beside it and never breaks inside.
// Panel screenshots go to E2E_SHOTS (default test-results/panel-fit).
// Runs against a dev server (E2E_BASE_URL): it reads load state through `window.__core`.

test.use({ viewport: { width: 1500, height: 1000 } });

const SHOTS = process.env.E2E_SHOTS || 'test-results/panel-fit';
mkdirSync(SHOTS, { recursive: true });

/** Open a shipped example, set the control panel width, and open it on one analysis. */
async function openExamplePanel(page, demo, nodeId, width) {
	await page.routeWebSocket(/.*/, () => {}); // no live reload mid-test
	await page.goto(`/?loadFromURL=${encodeURIComponent(`/sessions/demos/demo-tp-${demo}.json`)}`);
	await page.waitForFunction(
		() =>
			window.__core &&
			window.__core.tableProcesses?.length &&
			!window.__appState.loadingState.isLoading,
		null,
		{ timeout: 60_000 }
	);
	await page.evaluate((w) => (window.__appState.widthControlPanel = w), width);
	await page.locator(`.workflow-node-wrapper[data-node-id="${nodeId}"] .tp-title`).first().click();
	await page.locator('button[aria-label="Open control panel"]').click();
	const panel = page.locator('.control-display');
	await expect(panel).toBeVisible();
	return panel;
}

// The analyses whose Output section overflowed at the default width (2026-11-02 survey).
const OUTPUT_SECTION_PANELS = [
	['Collect Columns', 'collectcolumns', 'tableprocess_56'],
	['Fit waveform model', 'fitfunction', 'tableprocess_68'],
	['Interpolate', 'interpolate', 'tableprocess_53'],
	['Bin Data (Join Data example)', 'joindata', 'tableprocess_95'],
	['Moving analysis', 'movinganalysis', 'tableprocess_79'],
	['Rectangular wave', 'rectangularwave', 'tableprocess_82'],
	['Split', 'split', 'tableprocess_90'],
	['Threshold', 'threshold', 'tableprocess_59'],
	['Trend fit', 'trendfit', 'tableprocess_93']
];

for (const width of [250, 200]) {
	for (const [name, demo, nodeId] of OUTPUT_SECTION_PANELS) {
		test(`${name}: the Output section fits a ${width} px panel`, async ({ page }) => {
			const panel = await openExamplePanel(page, demo, nodeId, width);
			// The Output section with its column rows is shown before measuring.
			await expect(panel.locator('.clps-container').first()).toBeVisible();
			await page.waitForTimeout(500); // computed outputs settle
			await expectNoOverflow(panel);
			await panel.screenshot({ path: path.join(SHOTS, `${demo}-${width}.png`) });
		});
	}
}

test('Rayleigh: Watson-Williams F and p each sit with their store button, unbroken', async ({
	page
}) => {
	const panel = await openExamplePanel(page, 'rayleightest', 'tableprocess_98', 250);
	const stats = panel.locator('.ww-stats .ww-stat');
	await expect(stats).toHaveCount(2);
	await expect(stats.nth(0)).toHaveText(/^F\(\d+, \d+\) = [\d.]+\s*$/);
	await expect(stats.nth(1)).toHaveText(/^p = [\d.e+-]+\s*$/);
	for (const i of [0, 1]) {
		const stat = stats.nth(i);
		await expect(
			stat.locator('button[aria-label^="Rename stored value watson_williams"]')
		).toHaveCount(1);
		// One line each: the number never breaks (e.g. at "e-") and the button stays beside it.
		const layout = await stat.evaluate((e) => {
			const text = [...e.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
			const rects = text.flatMap((n) => {
				const r = document.createRange();
				r.selectNodeContents(n);
				return [...r.getClientRects()];
			});
			const btn = e.querySelector('button').getBoundingClientRect();
			const mid = (btn.top + btn.bottom) / 2;
			return {
				textLines: new Set(rects.map((q) => Math.round(q.top))).size,
				buttonOnLine: mid > rects[0].top && mid < rects[0].bottom,
				buttonAfterText: btn.left >= Math.max(...rects.map((q) => q.right)) - 1
			};
		});
		expect(layout).toEqual({ textLines: 1, buttonOnLine: true, buttonAfterText: true });
	}
	await expectNoOverflow(panel);
	await panel.screenshot({ path: path.join(SHOTS, 'rayleightest-ww-250.png') });
});

/** How many lines a node's text takes (distinct line tops of its text). */
const lineCount = (locator) =>
	locator.evaluate((e) => {
		const r = document.createRange();
		r.selectNodeContents(e);
		return new Set([...r.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top)))
			.size;
	});

test('Fit waveform model at 200 px: labels break between words, fields show their values', async ({
	page
}) => {
	const panel = await openExamplePanel(page, 'fitfunction', 'tableprocess_68', 200);
	const row = panel.locator('.fixed-period-row');
	await expect(row.locator('.ci-label')).toHaveText([/^Fixed period/, 'Harmonics', 'Alpha']);
	// A one-word label stays on one line (it read "Harmoni / cs").
	for (const word of ['Harmonics', 'Alpha'])
		expect(await lineCount(row.locator('.ci-label', { hasText: word }))).toBe(1);
	// Every field is wide enough for its value (Alpha's 0.05 read "0.0").
	const clipped = await row
		.locator('input')
		.evaluateAll((els) => els.filter((i) => i.scrollWidth > i.clientWidth).map((i) => i.value));
	expect(clipped).toEqual([]);
	await expectNoOverflow(panel);
	await panel.screenshot({ path: path.join(SHOTS, 'fitfunction-fixed-period-200.png') });
});

test('Compare groups at 200 px: no number in the result text breaks inside', async ({ page }) => {
	const panel = await openExamplePanel(page, 'groupcomparison', 'tableprocess_70', 200);
	const nums = panel.locator('.num');
	await expect(nums.filter({ hasText: /e-\d/ }).first()).toBeVisible();
	const broken = [];
	for (const num of await nums.all())
		if ((await lineCount(num)) > 1) broken.push(await num.innerText());
	expect(broken).toEqual([]);
	expect(await nums.count()).toBeGreaterThan(20);
	await expectNoOverflow(panel);
	await panel.screenshot({ path: path.join(SHOTS, 'groupcomparison-200.png') });
});

// Result tables: headers on one line, and the first (name) column readable. Correlation's
// table-layout:fixed table gave the pair column one letter ("C...") and broke "Pair" into
// "P / ai / r"; it now scrolls sideways like the other result tables.
for (const width of [250, 200]) {
	for (const [name, demo, nodeId] of [
		['Correlation', 'correlation', 'tableprocess_76'],
		['Normality test', 'normalitytest', 'tableprocess_75'],
		['Cross-correlation', 'crosscorrelation', 'tableprocess_74']
	]) {
		test(`${name} at ${width} px: headers on one line, first column readable`, async ({ page }) => {
			const panel = await openExamplePanel(page, demo, nodeId, width);
			const table = panel.locator('table').first();
			await expect(table.locator('tbody tr').first()).toBeVisible();
			for (const th of await table.locator('thead th').all())
				expect(await lineCount(th), await th.innerText()).toBe(1);
			// The first 8 characters of every first-column cell (or all of a shorter one) are
			// on screen: inside the cell and any box that clips it.
			const hidden = await table.locator('tbody tr td:first-child').evaluateAll((cells) =>
				cells
					.filter((td) => {
						const walker = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
						const t = walker.nextNode();
						if (!t) return false;
						const r = document.createRange();
						r.setStart(t, 0);
						r.setEnd(t, Math.min(8, t.textContent.length));
						const right = r.getBoundingClientRect().right;
						for (let e = t.parentElement; e; e = e.parentElement) {
							if (e === td.closest('.control-display')) break;
							if (getComputedStyle(e).overflowX !== 'visible' || e === td)
								if (right > e.getBoundingClientRect().right + 0.5) return true;
						}
						return false;
					})
					.map((td) => td.innerText)
			);
			expect(hidden).toEqual([]);
			await expectNoOverflow(panel);
			await panel.screenshot({ path: path.join(SHOTS, `${demo}-table-${width}.png`) });
		});
	}
}
