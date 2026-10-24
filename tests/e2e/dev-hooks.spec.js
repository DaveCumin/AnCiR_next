import { test, expect } from '@playwright/test';

// The dev-only window hooks (src/routes/+page.svelte's `import.meta.env.DEV` block, and the
// module namespaces in src/lib/core/devModules.js) never ship. Against a BUILT page (the
// default `pnpm test:e2e` run builds .e2e/ and previews it) none of them exists, and the
// single-file bundle does not even contain their names. Against a dev server they all exist.

const HOOKS = [
	'__history',
	'__core',
	'__appConsts',
	'__session',
	'__mutationService',
	'__appState',
	'__modules'
];

test('dev hooks exist on a dev server and are absent from a production build', async ({ page }) => {
	const res = await page.goto('/');
	const html = await res.text();
	const isDevServer = /\/@vite\/client|\/@fs\//.test(html);
	// The app has mounted: the start screen's first card is on screen.
	await expect(page.locator('button.primary-card').first()).toBeVisible({ timeout: 60_000 });
	const present = await page.evaluate(
		(names) => names.filter((n) => window[n] !== undefined),
		HOOKS
	);
	if (isDevServer) {
		expect(present).toEqual(HOOKS);
		expect(await page.evaluate(() => typeof window.__modules.facetPanels.panelsFor)).toBe(
			'function'
		);
	} else {
		expect(present).toEqual([]);
		// The single-file build inlines the whole app: the publishing code was dropped, not hidden.
		for (const name of ['window.__modules', 'window.__core', 'devModules'])
			expect(html.includes(name), name).toBe(false);
	}
});
