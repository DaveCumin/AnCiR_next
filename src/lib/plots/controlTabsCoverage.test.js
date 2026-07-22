import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// A plot advertises its control-panel tabs through `<Name>_controlHeaders`. The panel renders a
// tab for every header, but the plot component decides what goes inside by branching on
// `appState.currentControlTab`. Nothing ties those two together, so a plot can advertise a tab
// and render nothing into it — the user clicks "Data" and gets an empty panel.
//
// PairsPlot and CorrelationHeatmap both shipped that way (fixed 2026-07-22). This drives the whole
// registry so a new plot cannot repeat it.
const PLOTS_DIR = path.resolve('src/lib/plots');

function plotSources() {
	return fs
		.readdirSync(PLOTS_DIR, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => path.join(PLOTS_DIR, e.name, `${e.name}.svelte`))
		.filter((f) => fs.existsSync(f))
		.map((f) => ({ name: path.basename(f, '.svelte'), src: fs.readFileSync(f, 'utf8') }));
}

/** The headers a plot advertises, e.g. ['Properties', 'Data']. */
function declaredHeaders(src) {
	const m = src.match(/_controlHeaders\s*=\s*\[([^\]]*)\]/);
	if (!m) return null;
	return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
}

describe('plot control tabs', () => {
	const plots = plotSources();

	it('finds the plot components', () => {
		expect(plots.length).toBeGreaterThan(8);
	});

	it('every declared tab is actually rendered by the component', () => {
		const empty = [];
		for (const { name, src } of plots) {
			const headers = declaredHeaders(src);
			// A single-tab plot (Tableplot, DataView) may render its controls unconditionally:
			// there is no other tab to switch to, so there is nothing to branch on. The bug only
			// exists once a plot offers a CHOICE of tabs.
			if (!headers || headers.length < 2) continue;
			for (const header of headers) {
				const tab = header.toLowerCase();
				// 'properties' is the fallthrough branch every plot opens with; the others must be
				// branched on explicitly or the tab renders blank.
				const rendered = src.includes(`currentControlTab === '${tab}'`);
				if (!rendered) empty.push(`${name}: declares "${header}" but never renders it`);
			}
		}
		expect(empty).toEqual([]);
	});
});
