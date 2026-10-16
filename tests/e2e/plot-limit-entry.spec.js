import { test, expect } from '@playwright/test';

// Typing into a plot's axis-limit box, and cancelling it, in the workspace view with real keys.
// Runs against a dev server (E2E_BASE_URL): it reads the plot through the dev-only
// `window.__core` and loads the shipped demos.
//
// 1. A cleared limit box takes a negative number. A number input reports a partial entry
//    ("-", "-.") as an empty value; the box used to store `"" * 1 = 0` and write "0" back,
//    so "-1.23" could not be typed into it.
// 2. Cancelling (Escape) or just visiting the box (focus, blur) leaves the plot exactly as it
//    was: same automatic limits, same padding. The automatic Y min of demo-process-add read
//    -0.955752 in the workspace, then -0.964286 once the control panel was open: the padding
//    had been measured at mount from the canvas node's not-yet-redrawn SVG, and the panel's
//    re-measure corrected it (plots/viewBox.js, autoPadWhenDrawn).

test.use({ viewport: { width: 1400, height: 900 } });

async function load(page, demo) {
	await page.routeWebSocket(/.*/, () => {}); // no live reload mid-test
	await page.goto(`/?loadFromURL=${encodeURIComponent(`/sessions/demos/${demo}.json`)}`);
	await page.waitForFunction(
		() =>
			window.__core && window.__core.plots.length > 0 && !window.__appState.loadingState.isLoading,
		null,
		{ timeout: 60_000 }
	);
	await page.waitForTimeout(600);
	await page.click('[data-testid=nav-workspace-view]');
	await page.waitForTimeout(1500);
}

/** The plot's limits and stored padding, as the figure has them. */
const figure = (page, type) =>
	page.evaluate((t) => {
		const p = window.__core.plots.find((q) => q.type === t).plot;
		const pick = (...keys) => keys.map((k) => p[k]).find((v) => Array.isArray(v));
		return JSON.parse(
			JSON.stringify({
				y: pick('ylimsLeft', 'ylims'),
				x: pick('xlims', 'periodlimsIN'),
				padding: p.figurePadding ?? p.toJSON().padding
			})
		);
	}, type);

/** Select the plot and open its control panel. */
async function openControls(page, type) {
	const id = await page.evaluate((t) => window.__core.plots.find((q) => q.type === t).id, type);
	await page.locator(`svg[id="plot${id}"]`).click({ position: { x: 5, y: 5 } });
	await page.waitForTimeout(400);
	if (!(await page.locator('text=Properties').first().isVisible())) {
		await page.mouse.click(1383, 421); // the panel's open tab on the right edge
	}
	await expect(page.locator('text=Properties').first()).toBeVisible();
	await page.waitForTimeout(800);
}

/** The first number box labelled `label` (Min) after the heading `heading` in the panel. */
async function limitBox(page, heading, label = 'Min') {
	const index = await page.evaluate(
		([h, l]) => {
			const head = [...document.querySelectorAll('*')].find((e) => e.textContent.trim() === h);
			const boxes = [...document.querySelectorAll('input[type=number]')];
			return boxes.findIndex(
				(b) =>
					head &&
					head.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING &&
					b.closest('label')?.textContent?.trim() === l
			);
		},
		[heading, label]
	);
	expect(index, `a "${label}" box after "${heading}"`).toBeGreaterThanOrEqual(0);
	return page.locator('input[type=number]').nth(index);
}

test('a negative number can be typed into a cleared Y min box', async ({ page }) => {
	await load(page, 'demo-process-add');
	await openControls(page, 'scatterplot');
	const box = await limitBox(page, 'Left Y-Axis');
	await box.click();
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.press('Backspace');
	await page.keyboard.type('-1.23');
	await expect(box).toHaveValue('-1.23');
	await page.keyboard.press('Enter');
	const lims = await page.evaluate(() => [...window.__core.plots[0].plot.ylimsLeftIN]);
	expect(lims).toEqual([-1.23, null]);
	expect(await page.evaluate(() => window.__history.undoStack.length)).toBe(1);

	// Leaving the box empty puts the limit back to automatic, as one more undo step.
	await page.waitForTimeout(700); // past the spinner-click merge window
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.press('Backspace');
	await page.keyboard.press('Tab');
	await page.waitForTimeout(200);
	expect(await page.evaluate(() => [...window.__core.plots[0].plot.ylimsLeftIN])).toEqual([
		null,
		null
	]);
	expect(await page.evaluate(() => window.__history.undoStack.length)).toBe(2);
	await expect(box).not.toHaveValue('');
});

const CASES = [
	{ demo: 'demo-process-add', type: 'scatterplot', heading: 'Left Y-Axis' },
	{ demo: 'demo-periodogram-rhythm', type: 'periodogram', heading: null },
	{ demo: 'demo-boxplot-by-day', type: 'boxplot', heading: null },
	{ demo: 'demo-meansem-by-day', type: 'meansem', heading: null }
];

for (const { demo, type, heading } of CASES) {
	test(`${type}: opening the panel, Escape and a visit leave the automatic limits alone`, async ({
		page
	}) => {
		await load(page, demo);
		const shown = await figure(page, type);
		await openControls(page, type);
		expect(await figure(page, type), 'opening the control panel').toEqual(shown);

		const box = heading
			? await limitBox(page, heading)
			: page.locator('input[type=number]').filter({ visible: true }).nth(0);
		await box.focus();
		await page.keyboard.press('Escape');
		await page.waitForTimeout(300);
		expect(await figure(page, type), 'focus + Escape').toEqual(shown);

		await box.focus();
		await box.blur();
		await page.waitForTimeout(300);
		expect(await figure(page, type), 'focus + blur').toEqual(shown);
		expect(await page.evaluate(() => window.__history.undoStack.length)).toBe(0);
	});
}
