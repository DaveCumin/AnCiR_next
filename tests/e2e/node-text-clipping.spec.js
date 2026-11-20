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
						// A clamped metric name (two lines, TableProcessNode) titles itself on hover,
						// like an ellipsized one: hover it and check the title below.
						if ((cutX || cutY) && acs.webkitLineClamp !== 'none' && !clamped) {
							el.dispatchEvent(new PointerEvent('pointerenter'));
							pending.push({ el, txt, label });
							break;
						}
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

// A node's hover/focus action cluster (NodeActions: quick plot, collapse, delete) overlays
// the right end of its header. A long title used to run under it ("Logistic regression"
// touched the quick-plot icon). While the cluster shows, the title must end a fixed gap
// before the first icon, ellipsized, with the full name kept for hover and screen readers.
const TITLE_ICON_GAP = 4; // px; the header reserves 6, less the span's 1 px border and rounding

/** The node's visible title text box, its icons, and how its full name is exposed. */
function titleAndIcons(page, id) {
	return page.evaluate((id) => {
		const w = document.querySelector(`.workflow-node-wrapper[data-node-id="${id}"]`);
		const el = w.querySelector(
			'.tp-header .editable-span, .node-header .editable-span, .node-header .node-label'
		);
		el.dispatchEvent(new PointerEvent('pointerenter')); // Editable titles itself on hover
		const cs = getComputedStyle(el);
		const box = el.getBoundingClientRect();
		const range = document.createRange();
		range.selectNodeContents(el);
		const text = range.getBoundingClientRect();
		const contentRight = box.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
		const host = w.querySelector('.node-actions-host');
		const icons = [...(host?.querySelectorAll('.na-btn') ?? [])]
			.filter((b) => getComputedStyle(host).opacity === '1' && b.getClientRects().length)
			.map((b) => {
				const r = b.getBoundingClientRect();
				return { name: b.getAttribute('aria-label'), left: r.left, top: r.top, bottom: r.bottom };
			});
		return {
			name: el.textContent.trim(),
			textRight: Math.min(text.right, contentRight),
			textTop: text.top,
			textBottom: text.bottom,
			ellipsized: text.width > contentRight - box.left + 0.05,
			title: el.getAttribute('title') ?? '',
			ariaLabel: el.getAttribute('aria-label') ?? el.textContent.trim(),
			icons
		};
	}, id);
}

function expectTitleClear(m, what) {
	expect(m.icons.length, `${what}: action icons shown`).toBeGreaterThan(0);
	for (const icon of m.icons) {
		const sameRow = icon.top < m.textBottom && icon.bottom > m.textTop;
		if (!sameRow) continue;
		expect(
			icon.left - m.textRight,
			`${what}: "${m.name}" ends ${(icon.left - m.textRight).toFixed(1)} px before ${icon.name}`
		).toBeGreaterThanOrEqual(TITLE_ICON_GAP);
	}
	if (m.ellipsized) expect(m.title, `${what}: full name on hover`).toContain(m.name);
	expect(m.ariaLabel, `${what}: full name for screen readers`).toContain(m.name);
}

test('a node title never runs under its hover or focus action icons', async ({ page }) => {
	const errors = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await page.setViewportSize({ width: 1600, height: 1000 });
	await openApp(page);
	await page.locator('button.primary-card', { hasText: 'Start with a blank canvas' }).click();
	const ids = () =>
		page.evaluate(() =>
			[...document.querySelectorAll('.workflow-node-wrapper')].map((e) => e.dataset.nodeId)
		);
	const wrapper = (id) => page.locator(`.workflow-node-wrapper[data-node-id="${id}"]`);
	const LONG = 'A renamed transform with a really very long descriptive name';
	const made = [];
	// Analyses (quick plot + collapse + delete), a transform, a plot (delete only).
	for (const type of [
		'LogisticRegression',
		'CircadianFunctionIndex',
		'RhythmicityAnalysis',
		'Add',
		'scatterplot'
	]) {
		const before = await ids();
		await page.getByTestId('palette-trigger').click();
		await page.getByTestId(`palette-item-${type}`).click();
		await expect(page.locator('.workflow-node-wrapper')).toHaveCount(before.length + 1);
		await page.waitForTimeout(300); // second placement pass
		const id = (await ids()).find((i) => !before.includes(i));
		made.push({ type, id });
		// Spread them out so each can be hovered on its own.
		const b = await wrapper(id).boundingBox();
		const i = made.length - 1;
		await page.mouse.move(b.x + 30, b.y + 8);
		await page.mouse.down();
		await page.mouse.move(80 + (i % 3) * 460, 160 + Math.floor(i / 3) * 400, { steps: 8 });
		await page.mouse.up();
	}
	// A renamed node with a very long name.
	const add = made.find((m) => m.type === 'Add').id;
	await wrapper(add).locator('.editable-span').first().dblclick();
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.type(LONG);
	await page.keyboard.press('Enter');
	await expect(wrapper(add).locator('.editable-span').first()).toHaveText(LONG);

	const canvas = await page.locator('.workflow-editor.inline').boundingBox();
	const away = async () => {
		await page.evaluate(() => document.activeElement?.blur());
		// Empty canvas (the corners hold the zoom buttons).
		await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height - 30);
		await page.waitForTimeout(600); // the cluster's hide grace period
	};
	await away();
	for (const { type, id } of made) {
		// Hover.
		const b = await wrapper(id).boundingBox();
		await page.mouse.move(b.x + b.width / 2, b.y + 40);
		await expect.poll(async () => (await titleAndIcons(page, id)).icons.length).toBeGreaterThan(0);
		expectTitleClear(await titleAndIcons(page, id), `${type} hover`);
		await away();
		// Keyboard focus inside the card reveals the cluster as well.
		await expect.poll(async () => (await titleAndIcons(page, id)).icons.length).toBe(0);
		// A key press first, so the browser treats the focus as keyboard focus (:focus-visible).
		await page.keyboard.press('Shift');
		await wrapper(id).locator('[aria-roledescription="node"]').first().focus();
		await expect.poll(async () => (await titleAndIcons(page, id)).icons.length).toBeGreaterThan(0);
		expectTitleClear(await titleAndIcons(page, id), `${type} focus`);
		await away();
	}
	// The long names really were cut, so the checks above covered the ellipsis case.
	const lr = made.find((m) => m.type === 'LogisticRegression').id;
	await wrapper(lr).hover();
	expect((await titleAndIcons(page, lr)).ellipsized).toBe(true);
	await wrapper(add).hover();
	expect((await titleAndIcons(page, add)).ellipsized).toBe(true);
	expect(errors).toEqual([]);
});
