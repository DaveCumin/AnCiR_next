// @ts-nocheck
// The hint line under the clock ("value 0–70 · period 24 h") is drawn whole, in a workflow
// node as in the workspace.
//
// THE BUG: PolarGrid draws the hint 34 px under the ring (lower edge 38 px), at a fixed type
// size, so it hangs below the clock's square by 38 - 0.09 x size px. The figure's bottom padding
// (30 px) took that overhang in the workspace, but in a node the padding is scaled down with
// the type (about 16 px in the default 237 x 238 node) while the overhang grows as the square
// shrinks: the hint's descenders were cut off at the node's bottom edge.
//
// Same geometry as the plot draws with (CircularPhase.svelte's plot snippet and PolarGrid).
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { loadPlots } from '$lib/plots/plotMap.js';
import { loadProcesses } from '$lib/processes/processMap.js';
import { loadTableProcesses } from '$lib/tableProcesses/tableProcessMap.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';

const DEMO = join(process.cwd(), 'static/sessions/demos/demo-circular-phase-two-groups.json');

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

/** Where the clock, its hour labels and the hint are drawn, in the svg's coordinates. */
function drawn(p) {
	const size = p.plotSize;
	const cy = p.padding.top + (p.legendCorner?.offsetY ?? 0) + (p.clockShiftY ?? 0) + size / 2;
	const radius = (size / 2) * 0.82;
	return {
		hintBottom: cy + radius + 38, // PolarGrid: baseline 34 px under the ring, 10.5 px type
		hintTop: cy + radius + 24,
		bottomLabel: cy + radius + 16 + 3.5 + 3, // "12": 11 px type, baseline 3.5 px below 16 px out
		topLabel: cy - radius - 21 // "24 / 0": baseline 12.5 px outside the ring, ~8.5 px cap height
	};
}

const VIEWS = [
	['the default node', { w: 237, h: 238.5 }],
	['a small node', { w: 220, h: 230 }],
	['a wide node', { w: 360, h: 240 }],
	['a tall node', { w: 240, h: 360 }],
	['the workspace (figure size)', null]
];

describe('circular phase hint line', () => {
	for (const [name, box] of VIEWS) {
		for (const position of ['topright', 'auto', 'outsideright', 'bottomleft', 'none']) {
			it(`${name}, legend ${position}: inside the view and clear of the hour labels`, async () => {
				const p = await loadDemo();
				p.renderBox = box;
				if (position === 'none') p.legend.show = false;
				else p.legend.position = position;
				const d = drawn(p);
				expect(d.hintBottom).toBeLessThanOrEqual(p.viewHeight + 1e-6);
				expect(d.hintTop).toBeGreaterThan(d.bottomLabel);
				expect(d.topLabel).toBeGreaterThanOrEqual(-1e-6);
			});
		}
	}
});
