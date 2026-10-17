// UI-22: one section per axis. The periodogram, correlogram and FFT panels had two per axis:
// "Y-Axis" (limits, log scale) and then "Y-Axis Controls" (label, ticks, grid), and the
// scatterplot family had the Axis section followed by an untitled block of limits. The
// plot's own controls now render inside the Axis component's section.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { core, appConsts, appState } from '$lib/core/core.svelte.js';
import { Plot } from '$lib/core/Plot.svelte';
import { Column } from '$lib/core/Column.svelte';
import { history } from '$lib/core/opHistory.svelte.js';
import { loadPlots } from '$test/plotRegistry.js';
import ControlDisplay from '$lib/components/views/ControlDisplay.svelte';

const PLOTS = await loadPlots();

beforeAll(() => {
	appConsts.plotMap = PLOTS;
	history.init();
});
beforeEach(() => {
	core.data = [];
	core.plots = [];
	core.rawData = new Map();
	core.tableProcesses = [];
	appState.view = 'plots';
	appState.currentControlTab = 'properties';
});
afterEach(() => cleanup());

async function settle() {
	await Promise.resolve();
	await new Promise((r) => setTimeout(r, 0));
	flushSync();
	await tick();
}

function mkCol(name, values) {
	const c = new Column({ type: 'number', data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

async function panel(type) {
	const t = mkCol(
		't',
		Array.from({ length: 96 }, (_, i) => i)
	);
	const v = mkCol(
		'v',
		Array.from({ length: 96 }, (_, i) => 50 + 30 * Math.cos((2 * Math.PI * i) / 24))
	);
	const entry = appConsts.plotMap.get(type);
	const inputs = entry.defaultInputs ?? [];
	const inner =
		inputs.length === 1 && inputs[0] === 'column'
			? { data: [{ column: { refId: v } }] }
			: { data: [{ x: { refId: t }, y: { refId: v } }] };
	const plot = new Plot({ type, name: type, width: 500, height: 300, plot: inner });
	plot.selected = true;
	core.plots.push(plot);
	const { container } = render(ControlDisplay);
	await settle();
	return container;
}

/** Section titles of the panel, each with the number of inputs inside its section. */
function sections(container) {
	return [...container.querySelectorAll('[role="tabpanel"] .control-component')]
		.map((c) => ({
			title: c.querySelector(':scope > .control-component-title > p')?.textContent.trim(),
			inputs: c.querySelectorAll('input, select').length
		}))
		.filter((s) => s.title);
}

const AXIS_TITLES = {
	periodogram: ['Y-axis', 'X-axis'],
	correlogram: ['Y-axis (correlation)', 'X-axis (lag)'],
	fft: ['Y-axis (magnitude)', 'X-axis'],
	scatterplot: ['Left Y-axis', 'X-axis'],
	histogram: ['Y-axis', 'X-axis'],
	qqplot: ['Y-axis', 'X-axis'],
	boxplot: ['Y-axis'],
	meansem: ['Y-axis']
};

describe('one section per axis', () => {
	it.each(Object.keys(AXIS_TITLES))('%s', async (type) => {
		const container = await panel(type);
		const found = sections(container);
		const axisLike = found.map((s) => s.title).filter((t) => /axis/i.test(t));
		for (const title of AXIS_TITLES[type]) {
			expect(
				axisLike.filter((t) => t === title),
				`${type}: ${title}`
			).toHaveLength(1);
		}
		expect(axisLike.filter((t) => /controls$/i.test(t))).toEqual([]);
		// The axis section holds the label box AND the limits: Label, Ticks, N ticks, Grid,
		// then at least a min and a max.
		const y = found.find((s) => s.title === AXIS_TITLES[type][0]);
		expect(y.inputs, `${type}: inputs in ${y.title}`).toBeGreaterThanOrEqual(6);
		// No untitled block of limits right after an axis section.
		const blocks = [...container.querySelectorAll('[role="tabpanel"] .control-component')];
		const strays = blocks.filter(
			(c, i) =>
				!c.querySelector(':scope > .control-component-title') &&
				/axis/i.test(
					blocks[i - 1]?.querySelector('.control-component-title p')?.textContent ?? ''
				) &&
				c.querySelector('input[type=number]')
		);
		expect(strays).toEqual([]);
	});
});
