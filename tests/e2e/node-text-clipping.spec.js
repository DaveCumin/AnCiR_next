import { test, expect } from '@playwright/test';
import path from 'node:path';
import { openApp } from './helpers.js';

// Text inside canvas nodes used to be cut mid-glyph: a long node title or output name
// ran into an overflow:hidden parent whose text-overflow could not reach it (the name
// sits in an inline-block), a tableplot header ellipsized the only label its column
// has, and a node's editor panel cut a wrapped label in half at its max-height.
//
// Every text run inside a node must now be one of:
//   - fully visible;
//   - ellipsized (or line-clamped), with the full text in a title (or, for a port
//     label, in its port dot's tooltip) once hovered; or
//   - past the edge of a scroll box that fades that edge out (scrollFade.js).
// One demo per shape that went wrong: Figure 1 of the paper (free-running), a node with
// long metric names (cosinor), a wide result table (describe data) and a crowded
// editor row (group comparison).
const DEMOS = [
	'demo-workflow-free-running.json',
	'demo-tp-cosinor.json',
	'demo-tp-describedata.json',
	'demo-workflow-stats-two-group.json'
];

/** Text runs inside nodes that are cut with nothing to say so. */
function cutText(page) {
	return page.evaluate(async () => {
		const out = [];
		const pending = [];
		const titled = (el, txt) =>
			(el.closest('[title]')?.getAttribute('title') ?? '').includes(txt.slice(0, 20)) ||
			el.classList.contains('port-label');
		for (const node of document.querySelectorAll('.workflow-node-wrapper')) {
			const label = node.getAttribute('aria-label');
			const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
			let t;
			while ((t = walker.nextNode())) {
				const txt = t.textContent.trim();
				const el = t.parentElement;
				if (!txt || el.closest('svg, textarea, select')) continue;
				const cs = getComputedStyle(el);
				if (cs.display === 'none' || cs.visibility === 'hidden') continue;
				const range = document.createRange();
				range.selectNodeContents(t);
				const rects = [...range.getClientRects()].filter((r) => r.width && r.height);
				if (!rects.length) continue;
				// Ellipsized in place: the text is wider than the box that ellipsizes it.
				const box =
					el.getBoundingClientRect().width -
					parseFloat(cs.paddingLeft) -
					parseFloat(cs.paddingRight) -
					parseFloat(cs.borderLeftWidth) -
					parseFloat(cs.borderRightWidth);
				if (
					cs.textOverflow === 'ellipsis' &&
					cs.overflowX !== 'visible' &&
					range.getBoundingClientRect().width > box + 0.05
				) {
					el.dispatchEvent(new PointerEvent('pointerenter'));
					pending.push({ el, txt, label });
					continue;
				}
				// Cut by the nearest clipping ancestor, unless that edge fades out.
				for (let a = el; a && a !== node.parentElement; a = a.parentElement) {
					const acs = getComputedStyle(a);
					if (acs.overflowX === 'visible' && acs.overflowY === 'visible') continue;
					const ar = a.getBoundingClientRect();
					const l = ar.left + parseFloat(acs.borderLeftWidth);
					const top = ar.top + parseFloat(acs.borderTopWidth);
					const r = l + a.clientWidth;
					const b = top + a.clientHeight;
					const faded = (side) => a.hasAttribute(`data-more-${side}`);
					for (const q of rects) {
						const inside =
							q.right > l + 0.5 && q.left < r - 0.5 && q.bottom > top + 0.5 && q.top < b - 0.5;
						if (!inside) continue; // scrolled fully out of view
						const cutX = (q.right > r + 1 && !faded('right')) || (q.left < l - 1 && !faded('left'));
						const cutY =
							(q.bottom > b + 1.5 && !faded('below')) || (q.top < top - 1.5 && !faded('above'));
						// A line-clamped header (Tableplot) ends in an ellipsis; fine if titled.
						const clamped = acs.webkitLineClamp !== 'none' && titled(el, txt);
						if ((cutX || cutY) && !clamped) {
							out.push(
								`${label}: "${txt.slice(0, 40)}" cut by .${String(a.className).split(' ')[0]}`
							);
							break;
						}
					}
					break;
				}
			}
		}
		await new Promise((r) => setTimeout(r, 50)); // let the hover titles render
		for (const { el, txt, label } of pending) {
			if (!titled(el, txt)) out.push(`${label}: "${txt.slice(0, 40)}" ellipsized with no title`);
		}
		return out;
	});
}

for (const demo of DEMOS) {
	test(`${demo}: no text in a node is cut without an ellipsis, title or fade`, async ({ page }) => {
		await page.setViewportSize({ width: 1400, height: 1950 });
		await openApp(page);
		await page.locator('button.primary-card', { hasText: 'Import data' }).click();
		const [chooser] = await Promise.all([
			page.waitForEvent('filechooser'),
			page.locator('button.dialog-button', { hasText: /Choose File|Change file/ }).click()
		]);
		await chooser.setFiles(path.resolve('static/sessions/demos', demo));
		await expect(page.locator('.workflow-node-wrapper').first()).toBeVisible({ timeout: 30000 });
		await expect.poll(() => cutText(page), { timeout: 15000 }).toEqual([]);
	});
}
