import { test, expect } from '@playwright/test';

// A node card's metric names ("Peak period (x units)", "Acrophase CI high (x units)") were
// cut after about 110 px of a 230 px card, the full name only on hover. A metric name now
// wraps onto a second line inside its 24 px row (TableProcessNode.svelte), so these fit.
//
// Runs against a dev server (E2E_BASE_URL): it waits on the dev-only `window.__core`.

test.use({ viewport: { width: 1400, height: 900 } });

async function load(page, demo) {
	await page.routeWebSocket(/.*/, () => {}); // no live reload mid-test
	await page.goto(`/?loadFromURL=${encodeURIComponent(`/sessions/demos/${demo}.json`)}`);
	await page.waitForFunction(
		() =>
			window.__core &&
			window.__core.tableProcesses.length > 0 &&
			!window.__appState.loadingState.isLoading,
		null,
		{ timeout: 60_000 }
	);
	await page.waitForTimeout(2000);
}

/** Every metric name on the canvas, with whether it is cut and its row's height. */
const metricNames = (page) =>
	page.evaluate(() =>
		[...document.querySelectorAll('.tp-card .metric-strip .editable-span')].map((el) => ({
			text: el.textContent.trim(),
			cut: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
			rowH: el.closest('.metric-strip').getBoundingClientRect().height
		}))
	);

for (const [demo, expected] of [
	['demo-tp-rhythmicityanalysis', ['Peak period (x units)', 'Peak p (family-wise)']],
	['demo-tp-cosinor', ['Acrophase CI high (x units)', 'H1 bathyphase (x units)']],
	['demo-tp-nonparametricra', ['M10 (most active 10 h mean)', 'Intradaily variability (IV)']]
]) {
	test(`${demo}: metric names fit their rows`, async ({ page }) => {
		await load(page, demo);
		const names = await metricNames(page);
		for (const t of expected) expect(names.map((n) => n.text)).toContain(t);
		expect(names.filter((n) => n.cut).map((n) => n.text)).toEqual([]);
		// The rows keep the 24 px grid the wires are anchored on (nodeRows.js).
		for (const n of names) expect(n.rowH).toBe(24);
	});
}
