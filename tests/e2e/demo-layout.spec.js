import { test, expect } from '@playwright/test';
import path from 'node:path';
import { openApp } from './helpers.js';

// Shipped demos used to load with nodes on top of each other: a baked layout (or the
// automatic one) cannot know how tall an expanded node draws. WorkflowEditor now pushes
// overlapping nodes apart after an import (settleOverlaps.js). One demo per way it went
// wrong: auto-layout data nodes with value previews (CWT, pairs plot) and a baked
// 500 px row grid under very tall table-process nodes (phase groups, rest-activity).
const DEMOS = [
	'demo-cwt-period-change.json',
	'demo-pairsplot-matrix.json',
	'demo-workflow-phase-groups.json',
	'demo-workflow-rest-activity.json'
];

/** Pairs of top-level canvas nodes (not groups) whose boxes intersect. */
function overlappingNodes(page) {
	return page.evaluate(() => {
		const boxes = [...document.querySelectorAll('.workflow-node-wrapper:not(.group-wrapper)')].map(
			(e) => ({ label: e.getAttribute('aria-label'), r: e.getBoundingClientRect() })
		);
		const out = [];
		for (let i = 0; i < boxes.length; i++) {
			for (let j = i + 1; j < boxes.length; j++) {
				const a = boxes[i].r;
				const b = boxes[j].r;
				const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
				const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
				if (w > 1 && h > 1) out.push(`${boxes[i].label} / ${boxes[j].label}`);
			}
		}
		return out;
	});
}

for (const demo of DEMOS) {
	test(`${demo} loads with no overlapping nodes`, async ({ page }) => {
		await openApp(page);
		await page.locator('button.primary-card', { hasText: 'Import data' }).click();
		const [chooser] = await Promise.all([
			page.waitForEvent('filechooser'),
			page.locator('button.dialog-button', { hasText: /Choose File|Change file/ }).click()
		]);
		await chooser.setFiles(path.resolve('static/sessions/demos', demo));
		await expect(page.locator('.workflow-node-wrapper').first()).toBeVisible({ timeout: 30000 });
		await expect.poll(() => overlappingNodes(page), { timeout: 10000 }).toEqual([]);
	});
}
