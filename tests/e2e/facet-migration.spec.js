import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Facets as views (docs/plans/2026-09-26-facets-as-views.md, Phase 1): the shipped EDA demo
// renders its four histogram panels exactly as v76.4 rendered the four child plots (pinned
// SVGs), a v76.4 session WITH children migrates onto the same panels, per-child edits carry
// or warn, and the panel interactions (multi-select, link zoom, reorder) behave as the plan
// says. Runs against a dev server (E2E_BASE_URL); the fixtures load through Vite's /@fs/.
//
// Not the Browser pane: that tab is `document.hidden`, rAF never fires there and a session
// load stalls on "Loading N columns". Headless Chromium is not hidden.

const ROOT = resolve(import.meta.dirname, '..', '..');
const PIN_DIR = resolve(ROOT, 'tests/e2e/snapshots/facet-eda-v76.4');
const FIXTURES = resolve(ROOT, 'src/test/fixtures');
const EDA = '/sessions/demos/demo-workflow-stats-eda.json';

test.use({ viewport: { width: 1600, height: 1300 } });

// The four EDA panels at v76.4 (snapshots/facet-eda-v76.4/README.md): column, viewport rect.
const EDA_PANELS = [
	{ id: '7:c112#0', column: 'height', rect: [125, 473, 525, 300] },
	{ id: '7:c113#0', column: 'weight', rect: [680, 473, 525, 300] },
	{ id: '7:c114#0', column: 'income', rect: [125, 833, 525, 300] },
	{ id: '7:c115#0', column: 'noise', rect: [680, 833, 525, 300] }
];
// Every v76.4 child series drew in the first palette colour (plan 0.4 item 4).
const V764_CHILD_COLOUR = '#234154';

async function load(page, url) {
	await page.goto(`/?loadFromURL=${encodeURIComponent(url)}`);
	await page.waitForFunction(
		() =>
			window.__core && window.__core.plots.length > 0 && !window.__appState.loadingState.isLoading,
		null,
		{ timeout: 60_000 }
	);
	await page.waitForTimeout(600);
	await page.click('[data-testid=nav-workspace-view]');
	// Every panel host projects in a microtask after mount; give the SVGs a moment to settle.
	await page.waitForTimeout(2500);
}

const panelSvg = (page, id) => page.locator(`svg[id="plot${id}"]`);

/** Live panel state through the app's own modules (dev server exposes them under /src). */
const panelInfo = (page) =>
	page.evaluate(async () => {
		const m = await import('/src/lib/core/facetPanels.svelte.js');
		const n = await import('/src/lib/core/notifications.svelte.js');
		return {
			plotIds: window.__core.plots.map((p) => p.id),
			warnings: n.notifications.list.filter((x) => x.type === 'warning').map((x) => x.message),
			generators: window.__core.plots
				.filter((p) => p.facet)
				.map((g) => ({
					id: g.id,
					xlims: g.plot.xlimsIN ?? null,
					overrides: JSON.parse(JSON.stringify(g.facetOverrides ?? {})),
					panels: m.panelsFor(g).map((p) => ({
						id: p.id,
						name: p.name,
						selected: p.selected,
						xlims: p.plot?.xlimsIN ?? null,
						ylimsLeft: p.plot?.ylimsLeftIN ?? null,
						rect: (() => {
							const r = document.getElementById('plot' + p.id)?.getBoundingClientRect();
							return r ? [r.x, r.y, r.width, r.height] : null;
						})()
					}))
				}))
		};
	});

const headerOf = (page, id) =>
	page.locator(`section.draggable:has(svg[id="plot${id}"]) .plot-header`);

test.describe('facets as views', () => {
	test('(a) the shipped EDA demo renders four panels at the pinned ids, positions and SVGs', async ({
		page
	}) => {
		const errors = [];
		page.on('pageerror', (e) => errors.push(String(e)));
		await load(page, EDA);
		const info = await panelInfo(page);
		expect(info.plotIds).toEqual([7, 8, 9, 10, 11]);
		const [gen] = info.generators;
		expect(gen.panels.map((p) => p.id)).toEqual(EDA_PANELS.map((p) => p.id));
		expect(gen.panels.map((p) => p.name)).toEqual(EDA_PANELS.map((p) => p.column));
		expect(gen.panels.map((p) => p.rect)).toEqual(EDA_PANELS.map((p) => p.rect));

		// The generator's per-column colour, which v76.4's children did NOT carry.
		const genColours = await page.evaluate(() =>
			window.__core.plots[0].plot.data.map((d) => d.fillColour)
		);

		for (const [i, spec] of EDA_PANELS.entries()) {
			const live = await panelSvg(page, spec.id).evaluate((el) => el.outerHTML);
			const pin = readFileSync(`${PIN_DIR}/${spec.column}.svg`, 'utf8');
			// The only `id` in a pin is the root's (README); normalise it on both sides.
			const normId = (s) => s.replace(/^(<svg[^>]*?)id="plot[^"]*"/, '$1id="plotX"');
			const a = normId(live);
			const b = normId(pin);
			// Colour: the pinned child drew its series in the first palette colour; the panel draws
			// it in the generator's colour for that column. Normalise ONLY that token, and count it.
			const colour = genColours[i];
			const liveFills = (a.match(/fill="#[0-9A-Fa-f]{6}"/g) ?? []).filter(
				(f) => f === `fill="${colour}"`
			).length;
			const pinFills = (b.match(/fill="#[0-9A-Fa-f]{6}"/g) ?? []).filter(
				(f) => f === `fill="${V764_CHILD_COLOUR}"`
			).length;
			const aNorm = a.split(`fill="${colour}"`).join(`fill="${V764_CHILD_COLOUR}"`);
			// Token-identical after the two normalisations (split on tags so a failure names the tag).
			expect(
				aNorm.split(/(?=<)/),
				`${spec.column}: SVG differs beyond id and series colour`
			).toEqual(b.split(/(?=<)/));
			// And the colour difference is exactly the series fill: the bar polyline and the legend
			// swatch, two tokens, both the generator's colour in the panel.
			expect(pinFills, `${spec.column}: pinned series fills`).toBe(2);
			expect(liveFills, `${spec.column}: live series fills in the generator colour`).toBe(2);
			if (colour === V764_CHILD_COLOUR)
				expect(a).toBe(b); // height: first palette colour, byte-identical
			else expect(a).not.toBe(b);
		}
		expect(errors).toEqual([]);
	});

	test('(b) a v76.4 session with children migrates onto the same four panels, five plots, no warning', async ({
		page
	}) => {
		await load(page, `/@fs/${FIXTURES}/facet-eda-children.json`);
		const info = await panelInfo(page);
		expect(info.plotIds).toEqual([7, 8, 9, 10, 11]);
		expect(info.generators[0].panels.map((p) => p.id)).toEqual(EDA_PANELS.map((p) => p.id));
		for (const spec of EDA_PANELS) await expect(panelSvg(page, spec.id)).toBeVisible();
		expect(info.warnings).toEqual([]);
		await expect(page.locator('.toast, [role=alert]').filter({ hasText: 'Panel' })).toHaveCount(0);
	});

	test('(c) per-child edits: the y-limit carries as an override on its panel, the rest are reported', async ({
		page
	}) => {
		await load(page, `/@fs/${FIXTURES}/facet-scatter-edited-children.json`);
		const info = await panelInfo(page);
		expect(info.plotIds).toEqual([47, 48, 49]);
		const gen = info.generators.find((g) => g.id === 49);
		expect(gen.overrides).toEqual({ 'y375#0': { 'ylimsLeftIN[0]': 10, 'ylimsLeftIN[1]': 40 } });
		expect(gen.panels.map((p) => [p.id, p.ylimsLeft])).toEqual([
			['49:y375#0', [10, 40]],
			['49:y376#0', [null, null]],
			['49:y377#0', [null, null]]
		]);
		const gname = 'Onset vs day — immediate delay versus advance transients';
		expect(info.warnings).toEqual([
			[
				`Panel 'onset_delay' of '${gname}' had its own Padding Top (40); facets now share the plot's value (15)`,
				`Panel 'onset_delay' of '${gname}' had its own Padding Right (50); facets now share the plot's value (30)`,
				`Panel 'onset_advance' of '${gname}' had its own series 3 Points Colour ("#A6ACD5"); facets now share the plot's value ("#BE796B")`,
				`Panel 'onset_advance' of '${gname}' had its own series 3 Points Radius (7); facets now share the plot's value (3)`
			].join('\n')
		]);
		// And it is on screen as one toast, not four.
		const toast = page.getByText('had its own Padding Top (40)');
		await expect(toast).toBeVisible();
		await expect(page.locator('.toast-close')).toHaveCount(1);
	});

	test('(d) alt-click two panels: "2 plots selected"', async ({ page }) => {
		await load(page, EDA);
		await headerOf(page, '7:c112#0').click();
		await headerOf(page, '7:c114#0').click({ modifiers: ['Alt'] });
		await page.evaluate(() => (window.__appState.showControlPanel = true));
		await page.waitForTimeout(700);
		const info = await panelInfo(page);
		expect(info.generators[0].panels.map((p) => p.selected)).toEqual([true, false, true, false]);
		await expect(page.locator('.control-display .control-banner p').first()).toHaveText(
			'2 plots selected'
		);
	});

	test('(e) brush-zoom on one panel: x shared by every panel, y local to the brushed one; reset clears both', async ({
		page
	}) => {
		await load(page, `/@fs/${FIXTURES}/facet-scatter-edited-children.json`);
		await page.locator('.toast-close').first().click();
		await page.waitForTimeout(400);
		const target = '49:y375#0';
		const geom = await page.evaluate(async (id) => {
			const m = await import('/src/lib/core/plotRefs.js');
			const p = m.resolvePlotRef(id);
			const r = document.getElementById('plot' + id).getBoundingClientRect();
			return {
				r: [r.x, r.y],
				pad: JSON.parse(JSON.stringify(p.plot.padding)),
				pw: p.plot.plotwidth,
				ph: p.plot.plotheight
			};
		}, target);
		const x0 = geom.r[0] + geom.pad.left + geom.pw * 0.3;
		const y0 = geom.r[1] + geom.pad.top + geom.ph * 0.3;
		const x1 = geom.r[0] + geom.pad.left + geom.pw * 0.7;
		const y1 = geom.r[1] + geom.pad.top + geom.ph * 0.7;
		await headerOf(page, target).click();
		await page.keyboard.down('Shift');
		await page.mouse.move(x0, y0);
		await page.mouse.down();
		await page.mouse.move(x1, y1, { steps: 8 });
		await page.mouse.up();
		await page.keyboard.up('Shift');
		await page.waitForTimeout(600);

		const z = (await panelInfo(page)).generators.find((g) => g.id === 49);
		expect(z.xlims[0]).not.toBeNull();
		expect(z.xlims[1]).toBeGreaterThan(z.xlims[0]);
		for (const p of z.panels) expect(p.xlims).toEqual(z.xlims);
		const [brushed, ...siblings] = z.panels;
		expect(brushed.id).toBe(target);
		expect(brushed.ylimsLeft[1]).toBeGreaterThan(brushed.ylimsLeft[0]);
		expect(Object.keys(z.overrides)).toEqual(['y375#0']);
		expect(z.overrides['y375#0'].ylimsLeftIN).toEqual(brushed.ylimsLeft);
		for (const s of siblings) expect(s.ylimsLeft).toEqual([null, null]);

		await page.locator('button[aria-label="Reset zoom"]').click();
		await page.waitForTimeout(600);
		const r = (await panelInfo(page)).generators.find((g) => g.id === 49);
		expect(r.xlims).toEqual([null, null]);
		expect(r.overrides).toEqual({});
		for (const p of r.panels) {
			expect(p.xlims).toEqual([null, null]);
			expect(p.ylimsLeft).toEqual([null, null]);
		}
	});

	test("(f) reordering the generator's series keeps every panel's SVG element (no remount)", async ({
		page
	}) => {
		await load(page, EDA);
		await page.evaluate(async () => {
			const m = await import('/src/lib/core/facetPanels.svelte.js');
			const refs = await import('/src/lib/core/plotRefs.js');
			refs.deselectAllRefs();
			const g = window.__core.plots[0];
			window.__els = Object.fromEntries(
				m.panelsFor(g).map((p) => [p.id, document.getElementById('plot' + p.id)])
			);
			g.selected = true;
			window.__appState.showControlPanel = true;
		});
		await page.waitForTimeout(600);
		await page.locator('.control-display .control-tab button', { hasText: 'Data' }).first().click();
		await page.waitForTimeout(500);
		const grips = page.locator(
			'button[aria-label="Drag to reorder this series (Alt+Up/Down moves it)"]'
		);
		await expect(grips).toHaveCount(4);
		const blocks = page.locator('.control-display .dataBlock');
		await grips.last().dragTo(blocks.first());
		await page.waitForTimeout(800);

		const after = await page.evaluate(async () => {
			const m = await import('/src/lib/core/facetPanels.svelte.js');
			const g = window.__core.plots[0];
			return {
				order: g.plot.data.map((d) => d.column.refId),
				panels: m.panelsFor(g).map((p) => ({
					id: p.id,
					sameSvg: window.__els[p.id] === document.getElementById('plot' + p.id)
				})),
				plots: window.__core.plots.length
			};
		});
		expect(after.order).toEqual([115, 112, 113, 114]);
		expect(after.panels.map((p) => p.id)).toEqual(['7:c115#0', '7:c112#0', '7:c113#0', '7:c114#0']);
		expect(after.panels.every((p) => p.sameSvg)).toBe(true);
		expect(after.plots).toBe(5);
		// And the moved panel now sits in the first cell.
		const info = await panelInfo(page);
		expect(info.generators[0].panels.map((p) => p.rect)).toEqual(EDA_PANELS.map((p) => p.rect));
	});
});
