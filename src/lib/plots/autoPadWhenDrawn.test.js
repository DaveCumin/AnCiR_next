// autoPadWhenDrawn: a plot's automatic padding is measured from its settled draw, not from the
// draw at mount.
//
// THE BUG: each plot measured its padding once, in onMount. After a canvas-to-workspace switch
// the axis's first draw was not its settled one (a Scatterplot's x title one pixel high), so
// the stored padding came out short (bottom 51, not 53) and stayed so until the control panel
// opened and re-measured. Opening the panel then moved the plot area and every automatic
// limit (demo-process-add: auto Y min -0.955752, then -0.964286), which read as "Escape changed
// the plot". The browser check is tests/e2e/plot-limit-entry.spec.js; these pin the helper's
// rules, and the guard below that every measuring plot uses it.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tick } from 'svelte';
import { autoPadWhenDrawn } from './viewBox.js';

/** A plot whose measured bottom padding settles only after `redraws` re-measures. */
function fakePlot(measures) {
	const plot = {
		figurePadding: { top: 15, right: 30, bottom: 30, left: 30 },
		autoScalePadding: vi.fn(() => {
			const next =
				measures[Math.min(plot.autoScalePadding.mock.calls.length - 1, measures.length - 1)];
			plot.figurePadding = { ...plot.figurePadding, bottom: next };
		})
	};
	return plot;
}

async function settle(n = 8) {
	for (let i = 0; i < n; i++) await tick();
}

describe('autoPadWhenDrawn', () => {
	it('does not measure at mount, only after the draw has landed', async () => {
		const plot = fakePlot([53]);
		autoPadWhenDrawn(plot);
		expect(plot.autoScalePadding).not.toHaveBeenCalled();
		await settle();
		expect(plot.autoScalePadding).toHaveBeenCalledWith('all');
	});

	it('measures again after each redraw the new padding causes, until it settles', async () => {
		// 30 -> 51 (the first, unsettled draw) -> 53 (the redraw) -> 53 (stable): three passes.
		const plot = fakePlot([51, 53, 53]);
		autoPadWhenDrawn(plot);
		await settle();
		expect(plot.figurePadding.bottom).toBe(53);
		expect(plot.autoScalePadding).toHaveBeenCalledTimes(3);
	});

	it('stops at maxPasses even if the padding never settles', async () => {
		const plot = fakePlot([40, 41, 42, 43, 44, 45, 46, 47]);
		autoPadWhenDrawn(plot, { maxPasses: 4 });
		await settle(20);
		expect(plot.autoScalePadding).toHaveBeenCalledTimes(4);
	});

	it('measures nothing once unmounted', async () => {
		const plot = fakePlot([51, 53]);
		const cleanup = autoPadWhenDrawn(plot);
		cleanup();
		await settle();
		expect(plot.autoScalePadding).not.toHaveBeenCalled();
	});
});

// Every plot that measures its padding on mount does it through the helper.
describe('plots measure their mount padding through autoPadWhenDrawn', () => {
	const PLOTS_DIR = dirname(fileURLToPath(import.meta.url));
	const components = readdirSync(PLOTS_DIR, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => join(PLOTS_DIR, d.name, `${d.name}.svelte`))
		.filter((p) => existsSync(p));

	it('finds the plots', () => {
		expect(components.length).toBeGreaterThan(8);
	});

	for (const path of components) {
		const src = readFileSync(path, 'utf8');
		it(`${path.split('/').at(-1)} never measures synchronously in onMount`, () => {
			expect(src).not.toMatch(
				/onMount\(\(\) => \{\s*if \(which ===? 'plot'\) \{\s*theData\.plot\.autoScalePadding\('all'\)/
			);
		});
	}
});
