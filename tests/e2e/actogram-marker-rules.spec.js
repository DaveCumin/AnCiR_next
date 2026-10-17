import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

// Actogram marker rules, Phase A (docs/plans/2026-09-30-actogram-marker-rules-and-outputs.md).
// A user adds a rule on a multi-series actogram and sees it on every series; sets a shared
// day range and sees every series' fit follow; unticks one day on one series and sees only
// that series change; corrects one onset on one series and sees it detach while the other
// still follows the rule; reattaches; promotes a per-series block into a rule; and undoes
// each step. Then the same on a faceted actogram, where the panels project the generator's
// rules and a drag on one panel detaches that panel's series only.
//
// Phase B (the rules' OUTPUT PORTS): a rule's τ port is wired into Describe Data on the
// canvas by dragging the wire, and the downstream mean follows a rule edit; renaming the
// rule keeps the wire and the column id; deleting it drops the wire and undo brings it back
// with the same id; a faceted actogram writes its rule columns once, from the generator.
//
// Dev-server only (fixtures through Vite's /@fs/, state through the dev-only window.__core),
// like facet-migration.spec.js:  E2E_BASE_URL=http://localhost:5173 pnpm test:e2e
// Screenshots go to RULES_SHOTS when it is set.

const ROOT = resolve(import.meta.dirname, '..', '..');
const FIXTURES = resolve(ROOT, 'src/test/fixtures');
const SHOTS = process.env.RULES_SHOTS || '';
const REST = '/sessions/demos/demo-workflow-rest-activity.json';

// The plan's section 8 measurement of a per-series onset block (N 3, M 3, 50 %) on the
// rest-activity demo. A rule with the same settings must reproduce it on both series.
const PINS = [
	{ tau: 24.143, phi: 7.357 },
	{ tau: 24.627, phi: 6.18 }
];

test.use({ viewport: { width: 1500, height: 1000 } });

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
	await page.waitForTimeout(1500);
}

const headerOf = (page, id) =>
	page.locator(`section.draggable:has(svg[id="plot${id}"]) .plot-header`).first();

// Marker rules and each series' markers live on the Overlays tab (UI-12; Data until v82.23).
async function openOverlays(page, plotId) {
	// Click the header's right end: a demo's note card can overlap its left end.
	const header = headerOf(page, plotId);
	const box = await header.boundingBox();
	await header.click({ position: { x: box.width - 70, y: box.height / 2 } });
	await page.evaluate(() => {
		window.__appState.showControlPanel = true;
		window.__appState.currentControlTab = 'overlays';
	});
	await page.waitForTimeout(700);
}

async function shot(page, what, prefix = '33-rules') {
	if (!SHOTS) return;
	await page.waitForTimeout(300);
	await page.screenshot({ path: `${SHOTS}/${prefix}-${what}.png` });
}
const outShot = (page, what) => shot(page, what, '34-outputs');

/** A plot's metric map, its rule-1 columns (id, name, values), and every Describe Data node. */
function outputs(page, plotId) {
	return page.evaluate((id) => {
		const core = window.__core;
		const plot = core.plots.find((p) => p.id === id);
		const cols = {};
		for (const [key, colId] of Object.entries(plot.metricOut ?? {})) {
			const col = core.data.find((c) => c.id === colId);
			cols[key] = col
				? { id: colId, name: col.name, values: [...(core.rawData.get(colId) ?? [])] }
				: { id: colId, gone: true };
		}
		const describe = core.tableProcesses
			.filter((t) => t.name === 'DescribeData')
			.map((t) => ({
				id: t.id,
				yIN: [...(t.args.yIN ?? [])],
				mean: core.rawData.get(t.args.out?.mean)?.[0] ?? null
			}));
		return { metricOut: { ...plot.metricOut }, cols, describe };
	}, plotId);
}

/** Whether the canvas draws a wire from a plot's metric column into a node's yIN. */
function wireExists(page, plotId, colId, tpId) {
	return page.evaluate(
		async ({ plotId, colId, tpId }) => {
			const m = await import('/src/lib/core/ProcessNode.svelte.js');
			m.clearProcessNodeGraphCache();
			// The app's live core and registries (dev-only hooks), not a re-imported copy.
			const g = m.getCachedProcessNodeGraph(window.__core, window.__appConsts);
			return g.connections.some(
				(e) =>
					e.fromId === `plot_${plotId}` &&
					e.fromPort === `col_${colId}` &&
					e.toId === `tableprocess_${tpId}`
			);
		},
		{ plotId, colId, tpId }
	);
}

/** Drag a wire from one port dot to another, as a user does (pointer down, move, up). */
async function dragWire(page, from, to) {
	await from.scrollIntoViewIfNeeded();
	const a = await from.boundingBox();
	const b = await to.boundingBox();
	await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
	await page.mouse.down();
	const steps = 12;
	for (let k = 1; k <= steps; k++) {
		await page.mouse.move(
			a.x + a.width / 2 + ((b.x - a.x) * k) / steps,
			a.y + a.height / 2 + ((b.y - a.y) * k) / steps
		);
	}
	await page.mouse.up();
	await page.waitForTimeout(800);
}

/** Per series: the rule instances' fitted tau, phi, n, and the detachments, read live. */
function state(page, plotId) {
	return page.evaluate(async (id) => {
		const m = await import('/src/lib/plots/Actogram/markerRules.svelte.js');
		const plot = window.__core.plots.find((p) => p.id === id);
		const inner = plot.plot;
		return {
			rules: inner.markerRules.map((r) => ({ id: r.id, name: r.name })),
			series: inner.data.map((d) => ({
				instances: d.ruleInstances.map((i) => ({
					ruleId: i.ruleId,
					N: i.cfg.templateHrsBefore,
					...m.instanceSummary(i)
				})),
				own: d.phaseMarkers.map((b) => ({
					fromRule: b.fromRule,
					N: b.templateHrsBefore,
					...m.instanceSummary(b)
				})),
				detached: [...d.detachedRules],
				refDay: d.ruleInstances[0]?.estimatedPhase?.refDay ?? null
			}))
		};
	}, plotId);
}

// Through the app's own history (window.__history, dev only), never a fresh import of
// opHistory.svelte.js: after a hot reload that import can load a SECOND copy of the module,
// whose empty stacks the app never writes to.
const undoDepth = (page) => page.evaluate(() => window.__history.undoStack.length);
const undo = (page) => page.evaluate(() => window.__history.undo());

/** Commit a number into a rule-block field by its label (change fires on blur). */
async function setRuleField(page, label, value) {
	const input = page.locator(`.rule-block label:has-text("${label}") input`).first();
	await input.fill(String(value));
	await input.press('Tab');
	await page.waitForTimeout(400);
}

test.describe('actogram marker rules', () => {
	test.skip(!process.env.E2E_BASE_URL, 'needs a dev server (set E2E_BASE_URL)');

	test('rest-activity: add, range, one tick, detach by correction, reattach, promote, undo each', async ({
		page
	}) => {
		const errors = [];
		page.on('pageerror', (e) => errors.push(String(e)));
		await load(page, REST);
		await openOverlays(page, 0);
		const depth0 = await undoDepth(page);

		// 1. Add a rule: it appears on BOTH series, with the pinned numbers.
		await page.click('[aria-label="Add a marker rule"]');
		await page.waitForTimeout(600);
		let s = await state(page, 0);
		expect(s.rules).toEqual([{ id: 'r1', name: 'Rule 1' }]);
		s.series.forEach((ser, k) => {
			expect(ser.instances).toHaveLength(1);
			expect(ser.instances[0].tau).toBeCloseTo(PINS[k].tau, 3);
			expect(ser.instances[0].phi).toBeCloseTo(PINS[k].phi, 3);
		});
		await expect(page.locator('svg[id="plot0"] .line-handle')).toHaveCount(2);
		await expect(page.locator('.rule-block .rule-note').first()).toHaveText(
			'Applies to all 2 series'
		);
		await expect(page.locator('[data-rule-instance="r1"]')).toHaveCount(2);
		expect(await undoDepth(page)).toBe(depth0 + 1);
		await shot(page, 'added');
		const added = s;

		// 2. A shared day range: every series' fit follows (fewer markers, phi at day 2).
		await setRuleField(page, 'Min day', 2);
		await setRuleField(page, 'Max day', 5);
		s = await state(page, 0);
		s.series.forEach((ser, k) => {
			expect(ser.instances[0].n).toBeLessThan(added.series[k].instances[0].n);
			expect(ser.instances[0].tau).not.toBeCloseTo(added.series[k].instances[0].tau, 6);
			expect(ser.refDay).toBe(2);
		});
		expect(await undoDepth(page)).toBe(depth0 + 3);
		await shot(page, 'range');
		const ranged = s;

		// 3. Untick one in-range day on series 1 only: only series 1 changes. Like every gesture
		// in the plot panel it is one undo step (plots/plotEditScope.js, since v82.17), and it is
		// series data, not a settings change, so nothing detaches.
		const inst0 = page.locator('[data-rule-instance="r1"]').nth(0);
		// The LAST in-range day: a row's search spans that row and the next, so an earlier
		// row's detection can be the same onset as the next row's (merged, not counted twice).
		const row = inst0.locator('.period-marker-row:not(.outside-range)').last();
		await row.locator('input[type="checkbox"]').uncheck();
		await page.waitForTimeout(400);
		s = await state(page, 0);
		expect(s.series[0].instances[0].n).toBe(ranged.series[0].instances[0].n - 1);
		expect(s.series[1].instances[0]).toEqual(ranged.series[1].instances[0]);
		expect(s.series[0].detached).toEqual([]);
		expect(await undoDepth(page)).toBe(depth0 + 4);
		await shot(page, 'untick');
		const unticked = s;

		// 4. Correct one detected onset on series 2: that series detaches (one step) and keeps
		// its numbers' source as its own block; series 1 still follows a further rule edit.
		const inst1 = page.locator('[data-rule-instance="r1"]').nth(1);
		const hour = inst1
			.locator('.period-marker-row:not(.outside-range) .marker-value-input')
			.first();
		await hour.fill('7.5');
		await hour.press('Tab');
		await page.waitForTimeout(600);
		s = await state(page, 0);
		expect(s.series[1].detached).toEqual(['r1']);
		expect(s.series[1].instances).toHaveLength(0);
		expect(s.series[1].own[0].fromRule).toBe('r1');
		expect(s.series[0].instances).toHaveLength(1);
		expect(await undoDepth(page)).toBe(depth0 + 5);
		await expect(page.locator('.rule-block .rule-note').first()).toHaveText(
			'1 of 2 series; 1 detached'
		);
		const detachedOwn = s.series[1].own[0];
		await page.locator('.rule-block .control-input-horizontal input').nth(0).fill('4');
		await page.locator('.rule-block .control-input-horizontal input').nth(0).press('Tab');
		await page.waitForTimeout(500);
		s = await state(page, 0);
		// Series 1 follows the rule (its instance reads N = 4); series 2's own block keeps N = 3
		// and every number it had.
		expect(s.series[0].instances[0].N).toBe(4);
		expect(unticked.series[0].instances[0].N).toBe(3);
		expect(s.series[1].own[0]).toEqual(detachedOwn);
		expect(await undoDepth(page)).toBe(depth0 + 6);
		await shot(page, 'detached');

		// 5. Reattach: series 2 is back on the rule (one step).
		await page.getByRole('button', { name: 'Reattach to rule' }).click();
		await page.waitForTimeout(600);
		s = await state(page, 0);
		expect(s.series[1].detached).toEqual([]);
		expect(s.series[1].instances).toHaveLength(1);
		expect(s.series[1].own).toHaveLength(0);
		expect(await undoDepth(page)).toBe(depth0 + 7);
		await shot(page, 'reattached');

		// 6. Promote: give series 1 its own offset block, then "Make rule" (one step).
		await page.evaluate(() => {
			const d = window.__core.plots.find((p) => p.id === 0).plot.data[0];
			d.addMarker();
			d.phaseMarkers.at(-1).type = 'offset';
			d.phaseMarkers.at(-1).name = 'Offsets';
		});
		await page.waitForTimeout(600);
		await page.getByRole('button', { name: 'Make rule' }).first().click();
		await page.waitForTimeout(700);
		s = await state(page, 0);
		expect(s.rules.map((r) => r.name)).toEqual(['Rule 1', 'Offsets']);
		s.series.forEach((ser) => expect(ser.instances.map((i) => i.ruleId)).toEqual(['r1', 'r2']));
		expect(s.series[0].own).toHaveLength(0);
		expect(await undoDepth(page)).toBe(depth0 + 8);
		await shot(page, 'promoted');

		// 7. Undo each recorded step, checking each lands where it should.
		await undo(page); // promote
		s = await state(page, 0);
		expect(s.rules.map((r) => r.id)).toEqual(['r1']);
		await undo(page); // reattach
		s = await state(page, 0);
		expect(s.series[1].detached).toEqual(['r1']);
		await undo(page); // N edit
		s = await state(page, 0);
		expect(s.series[1].own[0]).toEqual(detachedOwn);
		await undo(page); // correction + detach
		s = await state(page, 0);
		expect(s.series[1].detached).toEqual([]);
		expect(s.series[1].instances[0]).toEqual(ranged.series[1].instances[0]);
		await undo(page); // untick: the day is back on series 1, series 2 untouched
		s = await state(page, 0);
		expect(s.series[0].instances[0]).toEqual(ranged.series[0].instances[0]);
		expect(s.series[1].instances[0]).toEqual(ranged.series[1].instances[0]);
		await undo(page); // max day
		await undo(page); // min day
		s = await state(page, 0);
		// The range is gone (phi back at day 1) and both series are exactly as added.
		expect(s.series.map((x) => x.refDay)).toEqual([1, 1]);
		s.series.forEach((ser, k) => expect(ser.instances[0]).toEqual(added.series[k].instances[0]));
		await undo(page); // add rule
		s = await state(page, 0);
		expect(s.rules).toEqual([]);
		s.series.forEach((ser) => expect(ser.instances).toEqual([]));
		expect(await undoDepth(page)).toBe(depth0);
		await shot(page, 'undone');
		expect(errors).toEqual([]);
	});

	for (const demo of [
		{ file: 'demo-workflow-arrhythmic.json', id: 39, what: 'arrhythmic' },
		{ file: 'demo-workflow-split-rhythm.json', id: 51, what: 'split' }
	]) {
		test(`${demo.what}: a rule reaches both series; a range edit moves both`, async ({ page }) => {
			const errors = [];
			page.on('pageerror', (e) => errors.push(String(e)));
			await load(page, `/sessions/demos/${demo.file}`);
			await openOverlays(page, demo.id);
			await page.click('[aria-label="Add a marker rule"]');
			await page.waitForTimeout(600);
			let s = await state(page, demo.id);
			expect(s.series).toHaveLength(2);
			s.series.forEach((ser) => expect(ser.instances.map((i) => i.ruleId)).toEqual(['r1']));
			await expect(page.locator('[data-rule-instance="r1"]')).toHaveCount(2);
			const before = s;
			await setRuleField(page, 'Min day', 3);
			s = await state(page, demo.id);
			s.series.forEach((ser, k) => {
				expect(ser.refDay).toBe(3);
				expect(ser.instances[0].n).toBeLessThanOrEqual(before.series[k].instances[0].n);
			});
			await shot(page, demo.what);
			expect(errors).toEqual([]);
		});
	}

	test('faceted actogram: every panel shows the rule; a drag on panel 2 detaches it only; save and reload keep it', async ({
		page
	}) => {
		const errors = [];
		page.on('pageerror', (e) => errors.push(String(e)));
		await load(page, `/@fs/${FIXTURES}/facet-actogram-markers.json`);
		for (const x of await page.locator('.toast-close').all()) await x.click();
		const panelIds = await page.evaluate(async () => {
			const m = await import('/src/lib/core/facetPanels.svelte.js');
			return m.panelsFor(window.__core.plots.find((p) => p.id === 0)).map((p) => p.id);
		});
		expect(panelIds).toHaveLength(2);
		await openOverlays(page, panelIds[0]);
		await page.click('[aria-label="Add a marker rule"]');
		await page.waitForTimeout(1200);
		await expect(page.locator('.rule-block .rule-note').first()).toHaveText(
			'Applies to all 2 panels'
		);
		// Both panels draw the rule's line (panel 1 also draws its legacy own blocks).
		for (const id of panelIds) {
			await expect(page.locator(`svg[id="plot${id}"] .line-handle`).first()).toBeVisible();
		}
		const handles1 = await page.locator(`svg[id="plot${panelIds[1]}"] .line-handle`).count();
		expect(handles1).toBe(1);
		const legacyOwn = (await state(page, 0)).series[0].own.length;
		await shot(page, 'facet-added');

		// Drag the rule's line on panel 2 by its middle: generator series 2 detaches.
		const handle = page.locator(`svg[id="plot${panelIds[1]}"] .line-handle`).first();
		const box = await handle.boundingBox();
		const x = box.x + box.width / 2;
		const y = box.y + box.height / 2;
		await page.mouse.move(x, y);
		await page.mouse.down();
		for (let k = 1; k <= 6; k++) await page.mouse.move(x + 6 * k, y);
		await page.mouse.up();
		await page.waitForTimeout(1200);
		let s = await state(page, 0);
		expect(s.series[1].detached).toEqual(['r1']);
		expect(s.series[1].own[0].fromRule).toBe('r1');
		expect(s.series[0].detached).toEqual([]);
		expect(s.series[0].instances).toHaveLength(1);
		await expect(page.locator('.rule-block .rule-note').first()).toHaveText(
			'1 of 2 panels; 1 detached'
		);
		await shot(page, 'facet-detached');

		// Save and reload through the app's own session writer and loader (the dev-only
		// window.__session; a fresh import of core.svelte.js can be a second copy of the module).
		await page.evaluate(async () => {
			await window.__session.load(JSON.parse(window.__session.save()));
		});
		await page.waitForTimeout(2500);
		s = await state(page, 0);
		expect(s.rules.map((r) => r.id)).toEqual(['r1']);
		expect(s.series[1].detached).toEqual(['r1']);
		expect(s.series[1].own[0].fromRule).toBe('r1');
		expect(s.series[0].instances.map((i) => i.ruleId)).toEqual(['r1']);
		expect(s.series[0].own).toHaveLength(legacyOwn);
		await expect(page.locator(`svg[id="plot${panelIds[0]}"] .line-handle`).first()).toBeVisible();
		await shot(page, 'facet-reloaded');
		expect(errors).toEqual([]);
	});
	test('outputs: τ wired into Describe Data follows the rule; rename keeps the wire; delete and undo bring it back', async ({
		page
	}) => {
		const errors = [];
		page.on('pageerror', (e) => errors.push(String(e)));
		await load(page, REST);
		await openOverlays(page, 0);
		await page.click('[aria-label="Add a marker rule"]');
		await page.waitForTimeout(800);

		// Five columns for the rule, keyed on its id, filled with the pinned numbers.
		let o = await outputs(page, 0);
		expect(Object.keys(o.metricOut)).toEqual(['r1_tau', 'r1_phi', 'r1_r2', 'r1_rmse', 'r1_n']);
		const ids = { ...o.metricOut };
		const tauCol = ids.r1_tau;
		PINS.forEach((pin, k) => {
			expect(o.cols.r1_tau.values[k]).toBeCloseTo(pin.tau, 3);
			expect(o.cols.r1_phi.values[k]).toBeCloseTo(pin.phi, 3);
		});
		expect(o.cols.r1_n.values).toEqual([6, 6]);
		expect(o.cols.r1_tau.name).toBe('Rule_1_tau_0');

		// On the canvas: add Describe Data from the palette and drag the τ port onto its input.
		await page.click('[data-testid=nav-workflow-view]');
		await page.waitForTimeout(1500);
		await page.locator('.np-trigger').click();
		await page.locator('.np-item', { hasText: 'Describe Data' }).first().click();
		await page.waitForTimeout(1200);
		o = await outputs(page, 0);
		expect(o.describe).toHaveLength(1);
		const tpId = o.describe[0].id;
		const tauPort = page.locator(
			`[data-node-id="plot_0"][data-port-name="col_${tauCol}"][data-port-dir="out"]`
		);
		await expect(page.locator('.port-label', { hasText: 'Rule 1 τ (h)' })).toHaveCount(1);
		const yIN = page.locator(`[data-node-id="tableprocess_${tpId}"][data-port-name="yIN"]`);
		await dragWire(page, tauPort, yIN);
		o = await outputs(page, 0);
		expect(o.describe[0].yIN).toEqual([tauCol]);
		expect(await wireExists(page, 0, tauCol, tpId)).toBe(true);
		const meanOf = (vals) => vals.reduce((a, b) => a + b, 0) / vals.length;
		await expect
			.poll(async () => (await outputs(page, 0)).describe[0].mean, { timeout: 10_000 })
			.toBeCloseTo(meanOf(o.cols.r1_tau.values), 9);
		await outShot(page, 'wired');

		// A rule edit moves the downstream mean (the threshold changes both series' onsets).
		await page.click('[data-testid=nav-workspace-view]');
		await page.waitForTimeout(1200);
		await openOverlays(page, 0);
		const pct = page.locator('.rule-block .control-input-horizontal input').nth(2);
		await pct.fill('80');
		await pct.press('Tab');
		await page.waitForTimeout(800);
		o = await outputs(page, 0);
		expect(o.metricOut).toEqual(ids);
		expect(o.cols.r1_tau.values[0]).not.toBeCloseTo(PINS[0].tau, 3);
		await expect
			.poll(async () => (await outputs(page, 0)).describe[0].mean, { timeout: 10_000 })
			.toBeCloseTo(meanOf(o.cols.r1_tau.values), 9);
		const edited = o;

		// Rename: same column ids, new column names, new port labels, the wire holds.
		const depth = await undoDepth(page);
		await page.locator('.rule-block .inline-edit-span').first().dblclick();
		const nameInput = page.locator('.rule-block input.inline-edit-input').first();
		await expect(nameInput).toBeVisible();
		await nameInput.fill('Onsets');
		await nameInput.press('Enter');
		await expect(page.locator('.rule-block .inline-edit-span').first()).toHaveText('Onsets');
		await page.waitForTimeout(800);
		o = await outputs(page, 0);
		expect(o.metricOut).toEqual(ids);
		expect(o.cols.r1_tau.name).toBe('Onsets_tau_0');
		expect(o.cols.r1_rmse.name).toBe('Onsets_rmse_0');
		expect(o.describe[0].yIN).toEqual([tauCol]);
		expect(await wireExists(page, 0, tauCol, tpId)).toBe(true);
		expect(await undoDepth(page)).toBe(depth + 1);
		await page.click('[data-testid=nav-workflow-view]');
		await page.waitForTimeout(1500);
		await expect(page.locator('.port-label', { hasText: 'Onsets τ (h)' })).toHaveCount(1);
		await expect(page.locator('.port-label', { hasText: 'Rule 1 τ (h)' })).toHaveCount(0);
		await outShot(page, 'renamed');

		// Delete the rule: its columns go and the wire with them; undo brings both back, with
		// the SAME column ids.
		await page.click('[data-testid=nav-workspace-view]');
		await page.waitForTimeout(1200);
		await openOverlays(page, 0);
		await page.click('[aria-label="Remove this rule"]');
		await page.waitForTimeout(1000);
		o = await outputs(page, 0);
		expect(o.metricOut).toEqual({});
		expect(await wireExists(page, 0, tauCol, tpId)).toBe(false);
		expect(await undoDepth(page)).toBe(depth + 2);
		await page.click('[data-testid=nav-workflow-view]');
		await page.waitForTimeout(1500);
		await expect(page.locator('.port-label', { hasText: 'Onsets τ (h)' })).toHaveCount(0);
		await outShot(page, 'deleted');

		await undo(page);
		await page.waitForTimeout(1500);
		o = await outputs(page, 0);
		expect(o.metricOut).toEqual(ids);
		expect(o.cols.r1_tau).toEqual({
			id: tauCol,
			name: 'Onsets_tau_0',
			values: edited.cols.r1_tau.values
		});
		expect(o.describe[0].yIN).toEqual([tauCol]);
		expect(await wireExists(page, 0, tauCol, tpId)).toBe(true);
		await expect(page.locator('.port-label', { hasText: 'Onsets τ (h)' })).toHaveCount(1);
		await expect
			.poll(async () => (await outputs(page, 0)).describe[0].mean, { timeout: 10_000 })
			.toBeCloseTo(meanOf(edited.cols.r1_tau.values), 9);
		await outShot(page, 'undone');
		expect(errors).toEqual([]);
	});

	test('outputs (faceted): the generator writes each rule column once per change, panels none', async ({
		page
	}) => {
		const errors = [];
		page.on('pageerror', (e) => errors.push(String(e)));
		await load(page, `/@fs/${FIXTURES}/facet-actogram-markers.json`);
		for (const x of await page.locator('.toast-close').all()) await x.click();
		const panelIds = await page.evaluate(async () => {
			const m = await import('/src/lib/core/facetPanels.svelte.js');
			return m.panelsFor(window.__core.plots.find((p) => p.id === 0)).map((p) => p.id);
		});
		expect(panelIds).toHaveLength(2);
		// The fixture's eight legacy marker stored values were registered by opening the blocks,
		// and nothing uses them: the load dropped them.
		const legacyLeft = await page.evaluate(() =>
			Object.keys(window.__core.storedValues).filter((n) =>
				/^(tau|phi|marker_r_squared|marker_rmse)_marker_/.test(n)
			)
		);
		expect(legacyLeft).toEqual([]);

		await openOverlays(page, panelIds[0]);
		await page.click('[aria-label="Add a marker rule"]');
		await page.waitForTimeout(1500);
		let o = await outputs(page, 0);
		expect(Object.keys(o.metricOut)).toEqual(['r1_tau', 'r1_phi', 'r1_r2', 'r1_rmse', 'r1_n']);
		for (const c of Object.values(o.cols)) expect(c.values).toHaveLength(2);
		// Panels carry no metric columns of their own: the generator's ARE the per-panel values.
		const panelMaps = await page.evaluate(async () => {
			const m = await import('/src/lib/core/facetPanels.svelte.js');
			return m
				.panelsFor(window.__core.plots.find((p) => p.id === 0))
				.map((p) => Object.keys(p.metricOut ?? {}).length);
		});
		expect(panelMaps).toEqual([0, 0]);

		// Count every column write while a rule setting changes.
		await page.evaluate(() => {
			const raw = window.__core.rawData;
			const orig = raw.set.bind(raw);
			window.__ruleWrites = [];
			raw.set = (k, v) => {
				window.__ruleWrites.push(k);
				return orig(k, v);
			};
		});
		const before = o;
		const pct = page.locator('.rule-block .control-input-horizontal input').nth(2);
		await pct.fill('80');
		await pct.press('Tab');
		await page.waitForTimeout(1500);
		o = await outputs(page, 0);
		const writes = await page.evaluate(() => window.__ruleWrites);
		const expected = await page.evaluate(async () => {
			const m = await import('/src/lib/plots/plotMetricOutputs.svelte.js');
			return m.plotMetricStats(window.__core.plots.find((p) => p.id === 0));
		});
		let changed = 0;
		for (const [key, c] of Object.entries(o.cols)) {
			const n = writes.filter((id) => id === c.id).length;
			expect(n, key).toBeLessThanOrEqual(1);
			if (JSON.stringify(c.values) !== JSON.stringify(before.cols[key].values)) {
				changed++;
				expect(n, key).toBe(1);
			}
			expect(c.values, key).toEqual(expected.map((s) => (s[key] == null ? NaN : s[key])));
		}
		expect(changed).toBeGreaterThan(0);
		await outShot(page, 'faceted');
		expect(errors).toEqual([]);
	});
});
