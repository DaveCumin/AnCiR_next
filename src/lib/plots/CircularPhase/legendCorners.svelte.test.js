// @ts-nocheck
// A corner legend on the circular phase plot must not cover the clock ring or its hour labels
// ("24 / 0", "6", "12", "18").
//
// THE BUG: the demo (demo-circular-phase-two-groups) shipped with the default 'topright'
// legend. Corner presets sit in the corners of the plot square, and on a polar plot those
// corners are tiny: a three-line legend reached in over the ring and hid "24 / 0". 'Auto'
// already avoided the ring (legendAutoPlots.svelte.test.js); the corners did not.
//
// Now a corner legend that would cover the ring gets room of its own beside, above or below
// the clock, on its corner's side, and the clock shrinks to make it. Checked here with the
// same geometry the plot draws with: the legend box against the ring, the label band and the
// hint line, for every corner.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { loadPlots } from '$lib/plots/plotMap.js';
import { loadProcesses } from '$lib/processes/processMap.js';
import { loadTableProcesses } from '$lib/tableProcesses/tableProcessMap.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';

const DEMO = join(
	process.cwd(),
	'static',
	'sessions',
	'demos',
	'demo-circular-phase-two-groups.json'
);

async function loadDemo() {
	await importJson(JSON.parse(readFileSync(DEMO, 'utf8')));
	return core.plots.find((p) => p.type === 'circularphase').plot;
}

beforeAll(async () => {
	appConsts.plotMap = await loadPlots();
	appConsts.processMap = await loadProcesses();
	appConsts.tableProcessMap = await loadTableProcesses();
}, 60000);

beforeEach(() => {
	core.data = [];
	core.plots = [];
	core.rawData = new Map();
	core.tableProcesses = [];
});

/**
 * Where the plot draws the clock and where Legend.svelte puts a corner legend, both in the
 * plot area's coordinates (Legend's corner formula, given the size the plot hands it).
 */
function drawn(p) {
	const size = p.plotSize;
	const c = p.legendCorner;
	const legendW = size + (c?.reserveW ?? 0);
	const legendH = size + (c?.reserveH ?? 0);
	const { width, height, margin: M } = p.legendLayout.box;
	const pos = p.legend.position;
	const x = pos.endsWith('right') ? legendW - width - M : M;
	const y = pos.startsWith('bottom') ? legendH - height - M : M;
	return {
		cx: (c?.offsetX ?? 0) + size / 2,
		cy: (c?.offsetY ?? 0) + size / 2,
		radius: (size / 2) * 0.82,
		rect: [x, y, x + width, y + height],
		legendW,
		legendH
	};
}

/** Distance from (cx, cy) to the nearest point of the rect. */
function nearest(rect, cx, cy) {
	const nx = Math.max(rect[0], Math.min(cx, rect[2]));
	const ny = Math.max(rect[1], Math.min(cy, rect[3]));
	return Math.hypot(nx - cx, ny - cy);
}

describe('circular phase corner legends', () => {
	for (const position of ['topright', 'topleft', 'bottomright', 'bottomleft']) {
		it(`${position}: clear of the ring, the hour labels and the hint`, async () => {
			const p = await loadDemo();
			p.legend.position = position;
			const d = drawn(p);
			// The hour labels are drawn 16 px outside the ring, 11 px type: half a label's
			// height (and some) beyond that is the band a legend must stay out of.
			expect(nearest(d.rect, d.cx, d.cy)).toBeGreaterThan(d.radius + 16 + 8);
			// The hint line under the clock (PolarGrid): 220 px wide, centred, 24 to 38 px below.
			const hint = [d.cx - 110, d.cy + d.radius + 24, d.cx + 110, d.cy + d.radius + 38];
			const overlapsHint =
				d.rect[0] < hint[2] && d.rect[2] > hint[0] && d.rect[1] < hint[3] && d.rect[3] > hint[1];
			expect(overlapsHint).toBe(false);
			// Everything stays inside the figure's drawing area.
			expect(d.legendW).toBeLessThanOrEqual(p.availWidth + 0.5);
			expect(d.legendH).toBeLessThanOrEqual(p.availHeight + 0.5);
		});
	}

	// In a workflow node the plot is drawn small and the legend's type and inset shrink with it,
	// but the hour labels keep their size, so they reach further past a smaller ring.
	for (const position of ['topright', 'bottomleft']) {
		it(`${position} in a node-sized view: still clear of the labels`, async () => {
			const p = await loadDemo();
			p.renderBox = { w: 220, h: 230 };
			p.legend.position = position;
			const d = drawn(p);
			expect(nearest(d.rect, d.cx, d.cy)).toBeGreaterThan(d.radius + 16 + 8);
		});
	}

	it('the room goes on the legend corner side: a left corner moves the clock right', async () => {
		const p = await loadDemo();
		p.legend.position = 'topleft';
		const c = p.legendCorner;
		expect(c).not.toBeNull();
		expect(c.offsetX + c.offsetY).toBeGreaterThan(0);
		p.legend.position = 'topright';
		expect(p.legendCorner.offsetX).toBe(0);
	});

	it('auto, outside right and custom are not touched (auto and outside reserve their own room)', async () => {
		const p = await loadDemo();
		for (const position of ['auto', 'outsideright', 'custom']) {
			p.legend.position = position;
			expect(p.legendCorner).toBeNull();
		}
	});

	it('auto, placed below the clock, starts under the hint line', async () => {
		const p = await loadDemo();
		p.legend.position = 'auto';
		expect(p.legendLayout.outsidePlacement.side).toBe('below');
		const size = p.plotSize;
		const hintBottom = size / 2 + (size / 2) * 0.82 + 38;
		expect(p.legendLayout.outsidePosition.y).toBeGreaterThanOrEqual(hintBottom);
		expect(p.legendLayout.outsidePosition.y + p.legendLayout.box.height).toBeLessThanOrEqual(
			p.availHeight + 0.5
		);
	});

	it('a hidden legend takes no room', async () => {
		const p = await loadDemo();
		p.legend.show = false;
		expect(p.legendCorner).toBeNull();
		expect(p.plotSize).toBe(p.basePlotWidth);
	});
});
