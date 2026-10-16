import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

// The import dialog cut two of its own defaults short: the Sort by picker read
// "Time (auto-de..." and a detected time format read "YYYY-MM-DD HH:mm:" once a file had
// a few columns. Each control must show its whole text (scrollWidth within clientWidth for
// the format box; the selected option's text within the select's content box), at the
// dialog's widths, with and without many columns.

function csv(columns) {
	const head = ['DateTime', ...Array.from({ length: columns - 1 }, (_, i) => `Series${i + 1}`)];
	const rows = [head.join(',')];
	const t0 = Date.UTC(2024, 0, 1);
	for (let i = 0; i < 60; i++) {
		const t = new Date(t0 + i * 15 * 60000).toISOString().replace('T', ' ').slice(0, 19);
		rows.push([t, ...head.slice(1).map((_, j) => (i * (j + 1)) % 37)].join(','));
	}
	return Buffer.from(rows.join('\n'));
}

/** Runs in the page: what does not fit. */
function cutShort() {
	const out = [];
	const textWidth = (el, text) => {
		const cs = getComputedStyle(el);
		const ctx = document.createElement('canvas').getContext('2d');
		ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
		return ctx.measureText(text).width;
	};
	const contentWidth = (el) => {
		const cs = getComputedStyle(el);
		return el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
	};
	const sort = [...document.querySelectorAll('dialog select')].find((s) =>
		[...s.options].some((o) => o.value === '__time__')
	);
	for (const value of ['__time__', '__none__']) {
		const text = [...sort.options].find((o) => o.value === value).text;
		if (textWidth(sort, text) > contentWidth(sort)) out.push(`Sort by: "${text}"`);
	}
	for (const sel of document.querySelectorAll('dialog select.type-select')) {
		const text = sel.selectedOptions[0]?.text ?? '';
		if (textWidth(sel, text) > contentWidth(sel))
			out.push(`${sel.getAttribute('aria-label')}: "${text}"`);
	}
	for (const input of document.querySelectorAll('dialog input.type-format')) {
		if (
			input.scrollWidth > input.clientWidth ||
			textWidth(input, input.value) > contentWidth(input)
		)
			out.push(`${input.getAttribute('aria-label')}: "${input.value}"`);
	}
	return out;
}

for (const [w, h] of [
	[1024, 768],
	[1440, 900]
]) {
	for (const columns of [3, 6]) {
		test(`import dialog controls show their whole text at ${w}x${h} with ${columns} columns`, async ({
			page
		}) => {
			await page.setViewportSize({ width: w, height: h });
			await openApp(page);
			await page.locator('button.primary-card', { hasText: 'Import data' }).click();
			const [chooser] = await Promise.all([
				page.waitForEvent('filechooser'),
				page.locator('button.dialog-button', { hasText: /Choose File|Change file/ }).click()
			]);
			await chooser.setFiles({ name: 'iso.csv', mimeType: 'text/csv', buffer: csv(columns) });
			await expect(page.locator('dialog input.type-format').first()).toBeVisible({
				timeout: 30000
			});
			expect(await page.evaluate(cutShort)).toEqual([]);
			// The dialog itself never scrolls sideways (a wide preview table scrolls in its own box).
			const dlg = await page.evaluate(() => {
				const d = document.querySelector('dialog[open]');
				return { scroll: d.scrollWidth, client: d.clientWidth };
			});
			expect(dlg.scroll).toBeLessThanOrEqual(dlg.client);
		});
	}
}
