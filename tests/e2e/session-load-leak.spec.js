import { test, expect } from '@playwright/test';
import { startBlankCanvas } from './helpers.js';

// ROB-20: every session load used to keep the previous session's whole node graph alive
// (about 10,000 DOM nodes and 330 listeners per load of the rest-activity example). The
// retainer was inside Svelte, not the app: before svelte 5.57.2 a derived read through an
// untracked derived while an effect was updating marked itself "connected" without anything
// reading it (sveltejs/svelte#18829). It then stayed subscribed to `core.data` for good, and
// through its closures held the old WorkflowEditor's each-block, and so every old node.
//
// The listener ratchet (listenerHygiene.guard.test.js) only sees window/document listeners,
// so this measures the real thing: load two examples back and forth, force a GC, and check
// that DOM nodes and listeners stay flat and that no `.workflow-node` from an earlier
// session is still alive. Chromium only (it needs the DevTools protocol for the GC and the
// counters). Runs against E2E_BASE_URL, ideally a production build:
//   E2E_BASE_URL=http://localhost:4173 pnpm test:e2e tests/e2e/session-load-leak.spec.js

// The rest-activity example is the one that leaked (NPCRA results table, auto legends).
const EXAMPLE_A = 'rest-activity profile';
const EXAMPLE_B = 'compare several groups';
const CYCLES = 3;

async function loadExample(page, name) {
	await page.getByTestId('nav-load-session').click();
	await page.getByRole('tab', { name: /example/i }).click();
	await page.locator('button.example-item', { hasText: name }).first().click();
	const replace = page.getByRole('button', { name: 'Replace session' });
	// Only asked when something is open; the first load into a blank canvas is not.
	await replace
		.waitFor({ state: 'visible', timeout: 3000 })
		.then(() => replace.click())
		.catch(() => {});
	await expect(page.locator('button.example-item')).toHaveCount(0, { timeout: 60000 });
	await expect(page.locator('.workflow-node').first()).toBeVisible({ timeout: 60000 });
	// Let deferred work (computes, legend layout, queued microtasks) settle before measuring.
	await page.waitForTimeout(1500);
	// Remember every node element mounted so far, without retaining it.
	await page.evaluate(() => {
		for (const el of document.querySelectorAll('.workflow-node')) {
			if (el.__leakTracked) continue;
			el.__leakTracked = true;
			window.__leakRefs.push(new WeakRef(el));
		}
	});
}

async function measure(page, cdp) {
	for (let i = 0; i < 3; i++) {
		await cdp.send('HeapProfiler.collectGarbage');
		await page.waitForTimeout(100);
	}
	const { metrics } = await cdp.send('Performance.getMetrics');
	const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
	const staleNodes = await page.evaluate(
		() => window.__leakRefs.filter((r) => r.deref() && !r.deref().isConnected).length
	);
	return { nodes: m.Nodes, listeners: m.JSEventListeners, staleNodes };
}

test('repeated session loads do not keep earlier sessions alive', async ({ page, browserName }) => {
	test.skip(!process.env.E2E_BASE_URL, 'needs E2E_BASE_URL (ideally a production build)');
	test.skip(browserName !== 'chromium', 'needs the Chromium DevTools protocol');
	test.setTimeout(300_000);
	await page.setViewportSize({ width: 1400, height: 900 });

	await startBlankCanvas(page);
	await page.evaluate(() => (window.__leakRefs = []));
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Performance.enable');
	await cdp.send('HeapProfiler.enable');

	// One warm-up cycle: first-use caches and lazily loaded modules are not leaks.
	await loadExample(page, EXAMPLE_A);
	await loadExample(page, EXAMPLE_B);
	const before = await measure(page, cdp);

	for (let i = 0; i < CYCLES; i++) {
		await loadExample(page, EXAMPLE_A);
		await loadExample(page, EXAMPLE_B);
	}
	const after = await measure(page, cdp);

	const report = JSON.stringify({ before, after });
	// Every node element from an earlier session must be collectable. Before the fix each
	// cycle left the 16 rest-activity nodes behind.
	expect(after.staleNodes, report).toBe(0);
	// Same session open both times, so the counts should match. Before the fix they grew by
	// ~10,000 nodes and ~330 listeners per cycle; the bounds leave room for small noise only.
	expect(after.nodes - before.nodes, report).toBeLessThan(300);
	expect(after.listeners - before.listeners, report).toBeLessThan(30);
});
