import { test, expect } from '@playwright/test';

// Every control label in a plot's side panel must fit its text: no word broken across
// lines, and no label taller than two lines.
//
// The Boxplot panel used to render "Stro / ke" and "Me / dian" (and, squeezed further,
// "Median width" one letter per line). A colour control sat in a `.control-input` with an
// inline `max-width: 1.5rem`, which clamps its LABEL to 24px as well as the swatch, and the
// panel's `overflow-wrap: anywhere` then broke the word instead of letting it overflow. A
// colour column is now `.control-input-swatch` (sized to its label) or a full column.
//
// Runs against a dev server (E2E_BASE_URL): it selects plots through the dev-only
// `window.__core` and sets the panel width through `window.__appState`.

test.use({ viewport: { width: 1500, height: 950 } });

// The control panel's own limits (ControlPanel.svelte: 200 to 500, default 250).
const PANEL_WIDTHS = [200, 250, 340];

async function load(page, demo) {
	await page.routeWebSocket(/.*/, () => {}); // no live reload mid-test
	await page.goto(`/?loadFromURL=${encodeURIComponent(`/sessions/demos/${demo}.json`)}`);
	await page.waitForFunction(
		() =>
			window.__core && window.__core.plots.length > 0 && !window.__appState.loadingState.isLoading,
		null,
		{ timeout: 60_000 }
	);
	await page.waitForTimeout(800);
}

/** Select the first plot of `type` in the workspace view and show its panel. */
async function openPanel(page, type) {
	const id = await page.evaluate((t) => window.__core.plots.find((q) => q.type === t)?.id, type);
	expect(id, `a ${type} in the demo`).not.toBeUndefined();
	await page.click('[data-testid=nav-workspace-view]');
	await page.waitForTimeout(1200);
	await page.locator(`svg[id="plot${id}"]`).click({ position: { x: 5, y: 5 } });
	await page.waitForTimeout(400);
	if (!(await page.getByRole('tab', { name: 'Data' }).isVisible())) {
		await page.mouse.click(1483, 443); // the panel's open tab on the right edge
	}
	await expect(page.getByRole('tab', { name: 'Data' })).toBeVisible();
}

/** Panel labels that break a word or run past two lines, at the current panel width. */
function badLabels(page) {
	return page.evaluate(() => {
		const out = [];
		const sel = ['.control-input', '.control-input-checkbox']
			.flatMap((c) => [`${c} > p`, `${c} > .ci-label`])
			.map((s) => `.view-container ${s}`)
			.join(', ');
		for (const el of document.querySelectorAll(sel)) {
			const txt = el.textContent.trim();
			const r = el.getBoundingClientRect();
			if (!txt || !r.width) continue;
			const saved = el.getAttribute('style');
			// One line's height: the same label forced onto one line.
			el.style.whiteSpace = 'nowrap';
			const oneLine = el.getBoundingClientRect().height;
			// A word wider than the label: with breaking inside words switched off it overflows.
			el.style.whiteSpace = 'normal';
			el.style.overflowWrap = 'normal';
			el.style.wordBreak = 'normal';
			const brokenWord = el.scrollWidth > el.clientWidth + 1;
			if (saved == null) el.removeAttribute('style');
			else el.setAttribute('style', saved);
			const lines = Math.round(r.height / oneLine);
			if (brokenWord || lines > 2) {
				out.push(`"${txt}" ${Math.round(r.width)}px wide, ${lines} lines`);
			}
		}
		return out;
	});
}

async function expectLabelsFit(page, what, tabs = ['Properties', 'Data']) {
	for (const tab of tabs) {
		await page.getByRole('tab', { name: tab }).click();
		await page.waitForTimeout(400);
		// Open every "Advanced" disclosure: a closed one's content still has boxes, at
		// meaningless sizes, and it is laid out like the rest once someone opens it.
		await page.evaluate(() =>
			document.querySelectorAll('.view-container details').forEach((d) => (d.open = true))
		);
		await page.waitForTimeout(300);
		for (const w of PANEL_WIDTHS) {
			await page.evaluate((v) => (window.__appState.widthControlPanel = v), w);
			await page.waitForTimeout(300);
			expect(await badLabels(page), `${what}, ${tab} tab, panel ${w}px`).toEqual([]);
		}
	}
	await page.evaluate(() => (window.__appState.widthControlPanel = 250));
}

test('Boxplot panel labels fit (category colours)', async ({ page }) => {
	await load(page, 'demo-workflow-stats-anova');
	await openPanel(page, 'boxplot');
	await expectLabelsFit(page, 'Boxplot');
});

test('Boxplot panel labels fit (two series: Stroke and Fill pickers shown)', async ({ page }) => {
	await load(page, 'demo-workflow-join-data');
	await openPanel(page, 'boxplot');
	await page.getByRole('tab', { name: 'Data' }).click();
	await page.getByText('+ Add series').first().click();
	await page.waitForTimeout(800);
	await expect(page.locator('.view-container').getByText('Stroke', { exact: true })).toHaveCount(2);
	await expectLabelsFit(page, 'Boxplot, two series');
});

test('Scatterplot panel labels fit', async ({ page }) => {
	await load(page, 'demo-process-add');
	await openPanel(page, 'scatterplot');
	await expectLabelsFit(page, 'Scatterplot');
});

test('Scatterplot overlay panel labels fit', async ({ page }) => {
	// Two reference-line overlays: the Line style row (colour, width, stroke) on the Overlays tab.
	await load(page, 'demo-tp-crossing');
	await openPanel(page, 'scatterplot');
	await expectLabelsFit(page, 'Scatterplot overlays', ['Overlays']);
});

test('Actogram panel labels fit', async ({ page }) => {
	await load(page, 'demo-actogram-rhythm');
	await openPanel(page, 'actogram');
	await expectLabelsFit(page, 'Actogram');
});
