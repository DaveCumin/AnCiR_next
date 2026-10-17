import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { openApp } from './helpers.js';
import {
	NODE_ROW_H,
	COMPACT_PORT_H,
	compactPortAnchorY
} from '../../src/lib/components/workflow/nodeRows.js';

// Node rows and wiring share one geometry (nodeRows.js: NODE_ROW_H, nodeRowCentreY).
// Measured on the rendered canvas, for every node kind that draws port rows (data, group,
// analysis with series and metric rows, column process, grouped and plain plot nodes):
//   1. every port row is NODE_ROW_H tall, so the 24 x 24 targets on it (row chevron, port
//      dot) never reach into the next row (WCAG 2.2 SC 2.5.8, see hit-targets.spec.js);
//   2. every port dot sits on its row's vertical centre;
//   3. every wire ends exactly on the centre of the dot it is attached to, both ends.
// Compact nodes (CompactNode, the collapsed squares) have no rows: their dots stack one
// COMPACT_PORT_H apart (compactPortAnchorY), centred on the square's left or right edge.

const ROOT = path.resolve('.');
const demo = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'static/sessions/demos', name)));

/** The Rhythmicity demo with its raw column absorbed into a Group node (no shipped session has one). */
function rhythmicityWithGroup() {
	const s = demo('demo-tp-rhythmicityanalysis.json');
	const raw = s.data.find((c) => c.name === 'y');
	s.groups = [
		{
			id: 'group_1',
			name: 'Recordings',
			x: 60,
			y: 420,
			width: 240,
			// Shorter than its rows need: a saved height is a minimum, the card must grow.
			height: 30,
			sourceColumnIds: [raw.id],
			allColumnIds: null,
			collapsed: false,
			rowState: {}
		}
	];
	delete s.nodeLayout[`data_${raw.id}`];
	return s;
}

/** The Rhythmicity demo with its data and analysis nodes collapsed to compact squares. */
function rhythmicityCompact() {
	const s = demo('demo-tp-rhythmicityanalysis.json');
	for (const [id, v] of Object.entries(s.nodeLayout))
		if (/^(data|tableprocess)_/.test(id)) v.collapsed = true;
	return s;
}

async function loadSession(page, name, session) {
	await openApp(page);
	await page.locator('button.primary-card', { hasText: 'Import data' }).click();
	const [chooser] = await Promise.all([
		page.waitForEvent('filechooser'),
		page.locator('button.dialog-button', { hasText: /Choose File|Change file/ }).click()
	]);
	await chooser.setFiles({
		name,
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(session))
	});
	await expect(page.locator('.workflow-node-wrapper').first()).toBeVisible({ timeout: 30000 });
	await expect(page.locator('.port-dot[data-node-id^="plot_"]').first()).toBeVisible();
}

/** Runs in the page: row heights, dot-to-row offsets and wire-end-to-dot offsets, in CSS px. */
function measure() {
	const card = document.querySelector('.workflow-node, .tp-card, .group-card');
	const scale = card.getBoundingClientRect().height / card.offsetHeight;
	const centre = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
	const dots = [...document.querySelectorAll('.port-dot')]
		.filter((d) => d.getBoundingClientRect().width > 0)
		.map((d) => {
			const c = centre(d.getBoundingClientRect());
			const square = d.closest('.compact-node');
			if (square) {
				const r = square.getBoundingClientRect();
				const side = [
					...square.querySelectorAll(`.port-dot[data-port-dir="${d.dataset.portDir}"]`)
				];
				return {
					id: `${d.dataset.nodeId}:${d.dataset.portName}:${d.dataset.portDir}`,
					dir: d.dataset.portDir,
					kind: 'compact',
					...c,
					slot: side.indexOf(d),
					count: side.length,
					cardH: r.height / scale,
					offTop: (c.y - r.top) / scale,
					offEdge: (c.x - (d.dataset.portDir === 'in' ? r.left : r.right)) / scale
				};
			}
			const row = d.closest('.row-strip, .in-row, .port-row').getBoundingClientRect();
			return {
				id: `${d.dataset.nodeId}:${d.dataset.portName}:${d.dataset.portDir}`,
				dir: d.dataset.portDir,
				kind: d.closest('.group-card')
					? 'group'
					: d.closest('.tp-card')
						? 'analysis/process'
						: 'data/plot',
				...c,
				rowH: row.height / scale,
				offRow: (c.y - (row.top + row.height / 2)) / scale
			};
		});
	const wireEnds = [];
	for (const p of document.querySelectorAll('path.edge-line:not(.reference)')) {
		const m = p.getScreenCTM();
		const L = p.getTotalLength();
		for (const [t, dir] of [
			[0, 'out'],
			[L, 'in']
		]) {
			const pt = p.getPointAtLength(t);
			const s = new DOMPoint(pt.x, pt.y).matrixTransform(m);
			let best = null;
			for (const d of dots) {
				if (d.dir !== dir) continue;
				const dist = Math.hypot(d.x - s.x, d.y - s.y);
				if (!best || dist < best.dist) best = { d, dist };
			}
			wireEnds.push({
				port: best?.d.id,
				dx: best ? (s.x - best.d.x) / scale : NaN,
				dy: best ? (s.y - best.d.y) / scale : NaN
			});
		}
	}
	return { dots, wireEnds };
}

async function expectGeometry(page, minKinds) {
	await page.waitForTimeout(500); // ports publish their measured y after a tick
	const { dots, wireEnds } = await page.evaluate(measure);
	expect(new Set(dots.map((d) => d.kind))).toEqual(new Set(minKinds));
	const rowDots = dots.filter((d) => d.kind !== 'compact');
	const badRows = rowDots.filter((d) => Math.abs(d.rowH - NODE_ROW_H) > 0.5).map((d) => d.id);
	expect(badRows, 'port rows that are not NODE_ROW_H tall').toEqual([]);
	const offCentre = rowDots
		.filter((d) => Math.abs(d.offRow) > 0.5)
		.map((d) => `${d.id} ${d.offRow.toFixed(2)}`);
	expect(offCentre, 'port dots off their row centre').toEqual([]);
	const offStack = dots
		.filter((d) => d.kind === 'compact')
		.filter(
			(d) =>
				Math.abs(d.offTop - compactPortAnchorY(d.slot, d.count, d.cardH)) > 0.5 ||
				Math.abs(d.offEdge) > 0.5
		)
		.map((d) => `${d.id} top=${d.offTop.toFixed(2)} edge=${d.offEdge.toFixed(2)}`);
	expect(offStack, 'compact port dots off their stack slot or the square edge').toEqual([]);
	expect(wireEnds.length).toBeGreaterThan(4);
	const missed = wireEnds
		.filter((w) => !(Math.abs(w.dx) <= 0.5 && Math.abs(w.dy) <= 0.5))
		.map((w) => `${w.port} dx=${w.dx.toFixed(2)} dy=${w.dy.toFixed(2)}`);
	expect(missed, 'wire ends off their dot centre').toEqual([]);
}

test('data, group, analysis and grouped plot nodes: rows, dots and wires share one geometry', async ({
	page
}) => {
	await page.setViewportSize({ width: 1500, height: 1100 });
	await loadSession(page, 'rows.json', demo('demo-tp-rhythmicityanalysis.json'));
	await expectGeometry(page, ['data/plot', 'analysis/process']);

	await loadSession(page, 'rows-group.json', rhythmicityWithGroup());
	// Open the metric rows and one row preview: rows below it move, the wires must follow.
	const metrics = page.locator('button.metrics-header[aria-expanded="false"]');
	if (await metrics.count()) await metrics.first().click();
	await page.locator('.tp-card .row-chev').first().click();
	await expectGeometry(page, ['data/plot', 'analysis/process', 'group']);
});

test('column process and plain plot nodes: rows, dots and wires share one geometry', async ({
	page
}) => {
	await page.setViewportSize({ width: 1500, height: 1100 });
	await loadSession(page, 'rows-process.json', demo('demo-process-add.json'));
	await expectGeometry(page, ['data/plot', 'analysis/process']);
});

test('compact nodes: ports one row apart on the square edges, wires end on the dots', async ({
	page
}) => {
	await page.setViewportSize({ width: 1500, height: 1100 });
	await loadSession(page, 'rows-compact.json', rhythmicityCompact());
	await expect(page.locator('.compact-node .port-dot').first()).toBeVisible();
	await expectGeometry(page, ['data/plot', 'compact']);
	// Neighbouring ports on one side: exactly one COMPACT_PORT_H apart.
	const steps = await page.evaluate(() => {
		const out = [];
		for (const sq of document.querySelectorAll('.compact-node')) {
			const scale = sq.getBoundingClientRect().height / sq.offsetHeight;
			for (const dir of ['in', 'out']) {
				const ys = [...sq.querySelectorAll(`.port-dot[data-port-dir="${dir}"]`)].map((d) => {
					const r = d.getBoundingClientRect();
					return (r.top + r.height / 2) / scale;
				});
				for (let i = 1; i < ys.length; i++) out.push(ys[i] - ys[i - 1]);
			}
		}
		return out;
	});
	expect(steps.length).toBeGreaterThan(2);
	for (const st of steps) expect(Math.abs(st - COMPACT_PORT_H)).toBeLessThanOrEqual(0.5);
});
