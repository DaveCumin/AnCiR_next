import { test, expect } from '@playwright/test';

// A setting that is not set (null: automatic) never reads "0" in its box.
//
// The FFT's "reset the period/frequency axis to auto range" sets both x limits to null; the
// boxes then read "0" and "0" while the plot drew 2.0004 to 10000 h, and the Frequency Step
// box read "0" after its reset to automatic. NumberWithUnits divided null by the unit factor
// (null / 1 = 0). Now the x limit boxes show the limits in use (like every other axis-limit
// box, v82.19) and a box whose value is not set is empty, with an "auto" placeholder.
//
// Runs against a dev server (E2E_BASE_URL): it reads the plot through `window.__core`.

test.use({ viewport: { width: 1400, height: 900 } });

async function openFft(page) {
	await page.routeWebSocket(/.*/, () => {});
	await page.goto(`/?loadFromURL=${encodeURIComponent('/sessions/demos/demo-fft-rhythm.json')}`);
	await page.waitForFunction(
		() =>
			window.__core && window.__core.plots.length > 0 && !window.__appState.loadingState.isLoading,
		null,
		{ timeout: 60_000 }
	);
	await page.waitForTimeout(600);
	await page.click('[data-testid=nav-workspace-view]');
	await page.waitForTimeout(1500);
	const id = await page.evaluate(() => window.__core.plots.find((q) => q.type === 'fft').id);
	await page.locator(`svg[id="plot${id}"]`).click({ position: { x: 5, y: 5 } });
	await page.waitForTimeout(400);
	if (!(await page.locator('text=Properties').first().isVisible())) {
		await page.mouse.click(1383, 421); // the panel's open tab on the right edge
	}
	await expect(page.locator('text=Properties').first()).toBeVisible();
	await page.waitForTimeout(800);
}

test('FFT x limits reset to automatic show the limits in use, not 0', async ({ page }) => {
	await openFft(page);
	await page
		.getByRole('button', { name: 'Reset the period/frequency axis to auto range', exact: true })
		.click();
	await page.waitForTimeout(400);
	const xAxis = page.locator('.control-component', {
		has: page.locator('.control-component-title p', { hasText: /^X-Axis$/ })
	});
	const boxes = xAxis.locator('input[type=number]');
	await expect(boxes).toHaveCount(2);
	const { xlims, xlimsIN } = await page.evaluate(() => {
		const p = window.__core.plots.find((q) => q.type === 'fft').plot;
		return { xlims: [...p.xlims], xlimsIN: [...p.xlimsIN] };
	});
	expect(xlimsIN).toEqual([null, null]);
	for (const i of [0, 1]) {
		const v = await boxes.nth(i).inputValue();
		expect(v).not.toBe('0');
		expect(Number(v)).toBeCloseTo(xlims[i], 3);
	}
});

test('the FFT frequency step set back to automatic is an empty "Auto" box', async ({ page }) => {
	await openFft(page);
	await page.evaluate(() => (window.__appState.currentControlTab = 'data'));
	const label = page.locator('p', { hasText: /^Frequency Step$/ }).first();
	const field = label.locator('xpath=..');
	await field.locator('button.icon').first().click();
	await page.waitForTimeout(300);
	const box = field.locator('input[type=number]');
	await expect(box).toHaveValue('');
	await expect(box).toHaveAttribute('placeholder', 'Auto');
	expect(
		await page.evaluate(
			() => window.__core.plots.find((q) => q.type === 'fft').plot.data[0].freqStep
		)
	).toBeNull();
});
