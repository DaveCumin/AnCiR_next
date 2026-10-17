import { test, expect } from '@playwright/test';

// Each stored value is ONE registry entry, however many places render its button.
//
// The canvas node and the control panel each mount the node component, and each copy of a
// StoreValueButton used to register its own entry: opening the rest-activity example's
// Cosinor in the control panel added 120 `<name>_2` copies (158 entries became 278), gone
// again when the panel closed, and saved if it was open at save time. A formula that picked
// a copy lost it with the panel. Identity is now `<owner>|<default name>`
// (core/storedValueClaims.js).
//
// (The rest-activity example's own names DO end in `_2`, e.g. `cosinor_rmse_cosinory_1_2`:
// that suffix is the Cosinor's node id in its output column names, not a copy.)
//
// Runs against a dev server (E2E_BASE_URL): it reads the registry through the dev-only
// `window.__core` and selects nodes through `window.__appState`.

test.use({ viewport: { width: 1400, height: 900 } });

async function load(page, demo) {
	await page.routeWebSocket(/.*/, () => {}); // no live reload mid-test
	await page.goto(`/?loadFromURL=${encodeURIComponent(`/sessions/demos/${demo}.json`)}`);
	await page.waitForFunction(
		() =>
			window.__core &&
			(window.__core.plots.length > 0 || window.__core.tableProcesses.length > 0) &&
			!window.__appState.loadingState.isLoading,
		null,
		{ timeout: 60_000 }
	);
	await page.waitForTimeout(2500);
}

const registry = (page) =>
	page.evaluate(() => {
		const keys = Object.keys(window.__core.storedValues).sort();
		const shown = [
			...new Set(
				[...document.querySelectorAll('button[aria-label^="Rename stored value "]')].map((b) =>
					b.getAttribute('aria-label').slice('Rename stored value '.length)
				)
			)
		].sort();
		return { keys, shown };
	});

/** Canvas ids of the analysis nodes (their results render on the canvas AND in the panel). */
const ownerNodes = (page) =>
	page.evaluate(() => window.__core.tableProcesses.map((t) => `tableprocess_${t.id}`));

const DEMOS = [
	// [demo, entries after load]. Rest-activity: 12 subjects x (10 Cosinor + 3 NPCRA) + 2
	// Compare-groups values. The Cosinor's free-fit Amplitude and its fixed-period H1
	// Amplitude are one value (same default name, same number), so 10 Cosinor values, not 11.
	['demo-workflow-rest-activity', 146],
	['demo-tp-cosinor', 9],
	['demo-tp-rayleightest', 6],
	['demo-tp-nonparametricra', 3],
	['demo-tp-trendfit', 4],
	['demo-tp-fitfunction', 4]
];

for (const [demo, expected] of DEMOS) {
	test(`${demo}: one entry per value, with the control panel open or closed`, async ({ page }) => {
		await load(page, demo);
		const loaded = await registry(page);
		expect(loaded.keys.length).toBe(expected);
		// Every button on the canvas shows a registered name, and no value is registered
		// that nothing shows (each value once).
		expect(loaded.shown).toEqual(loaded.keys);

		for (const id of await ownerNodes(page)) {
			await page.evaluate((nodeId) => {
				window.__appState.canvasSelectedNodeId = nodeId;
				window.__appState.showControlPanel = true;
			}, id);
			await page.waitForTimeout(1200);
			const open = await registry(page);
			expect(open.keys, `registry with ${id} open in the control panel`).toEqual(loaded.keys);
			// The panel's buttons show the same names as the canvas node's.
			for (const name of open.shown) expect(loaded.keys).toContain(name);
		}

		await page.evaluate(() => {
			window.__appState.canvasSelectedNodeId = null;
			window.__appState.showControlPanel = false;
		});
		await page.waitForTimeout(800);
		expect((await registry(page)).keys).toEqual(loaded.keys);
	});
}
