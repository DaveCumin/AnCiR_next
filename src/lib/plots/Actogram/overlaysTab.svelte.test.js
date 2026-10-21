// UI-12 (v82.25) put everything drawn over the actogram's rows on ONE tab, "Overlays", as on
// the other plots, including each series' markers and lines. David moved those back (v82.5x):
// a series' markers and lines sit inside its own block on the Data tab, as before v82.25,
// while the plot-wide overlays (light bands, annotations, marker rules) stay on Overlays.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { core, appConsts, appState } from '$lib/core/core.svelte.js';
import { Plot } from '$lib/core/Plot.svelte';
import { Column } from '$lib/core/Column.svelte';
import { history } from '$lib/core/opHistory.svelte.js';
import { loadPlots } from '$test/plotRegistry.js';
import ControlDisplay from '$lib/components/views/ControlDisplay.svelte';

const PLOTS = await loadPlots();

// happy-dom has no Web Animations; the blocks' flip/slide transitions only need a stub.
Element.prototype.animate ??= () => ({ finished: Promise.resolve(), cancel() {}, onfinish: null });
Element.prototype.getAnimations ??= () => [];

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
	history.clear();
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

function actogram(nSeries = 1) {
	const t = mkCol(
		't',
		Array.from({ length: 96 }, (_, i) => i)
	);
	const data = [];
	for (let k = 0; k < nSeries; k++) {
		const v = mkCol(
			k === 0 ? 'activity' : `activity${k + 1}`,
			Array.from({ length: 96 }, (_, i) => (i % 24 < 12 ? 50 + k : 5))
		);
		data.push({ x: { refId: t }, y: { refId: v } });
	}
	const plot = new Plot({
		type: 'actogram',
		name: 'acto',
		width: 500,
		height: 300,
		plot: { data }
	});
	plot.selected = true;
	core.plots.push(plot);
	return core.plots[core.plots.length - 1];
}

/** Click as a user does: the panel recorder (plotEditScope) opens a gesture on pointerdown. */
async function press(btn) {
	await fireEvent.pointerDown(btn);
	await fireEvent.click(btn);
	await fireEvent.pointerUp(btn);
	await settle();
}

const titles = (c) =>
	[...c.querySelectorAll('[role="tabpanel"] .control-component-title > p')].map((p) =>
		p.textContent.trim()
	);

describe('the actogram Overlays tab', () => {
	it('the actogram advertises Properties, Data, Overlays', () => {
		expect(appConsts.plotMap.get('actogram').controlHeaders).toEqual([
			'Properties',
			'Data',
			'Overlays'
		]);
	});

	it('holds light bands, annotations and marker rules, and no per-series markers', async () => {
		const plot = actogram();
		plot.plot.data[0].addMarker();
		appState.currentControlTab = 'overlays';
		const { container } = render(ControlDisplay);
		await settle();
		expect(titles(container)).toEqual(['Light bands', 'Annotations', 'Marker rules']);
		const adds = [...container.querySelectorAll('[role="tabpanel"] button.btn-add')].map((b) =>
			b.textContent.trim()
		);
		expect(adds).toEqual(['+ Add light band', '+ Add annotation', '+ Add rule']);
		const panel = container.querySelector('[role="tabpanel"]');
		expect(panel.textContent).not.toContain('Markers and lines');
		expect(panel.querySelector('.markerBlock')).toBeNull();
	});

	it('every add button adds its block, one undo step each (and nothing on Properties or Data does)', async () => {
		const plot = actogram();
		appState.currentControlTab = 'overlays';
		const { container, getByRole } = render(ControlDisplay);
		await settle();
		for (const name of ['Add a band', 'Add an annotation', 'Add a marker rule']) {
			const steps = history.undoCount;
			await press(getByRole('button', { name }));
			expect(history.undoCount, name).toBe(steps + 1);
		}
		const inner = core.plots.find((p) => p.id === plot.id).plot;
		expect(inner.lightBands.bands.length).toBe(1);
		expect(inner.annotations.length).toBe(1);
		expect(inner.markerRules.length).toBe(1);
		expect(container.querySelector('.block-empty')).toBeNull();

		for (const tab of ['properties', 'data']) {
			cleanup();
			appState.currentControlTab = tab;
			const r = render(ControlDisplay);
			await settle();
			const text = r.container.querySelector('[role="tabpanel"]').textContent;
			for (const gone of ['Light bands', 'Marker rules', 'Annotations', 'Add rule']) {
				expect(text, `${tab} tab`).not.toContain(gone);
			}
		}
	});
});

describe("the actogram Data tab: each series' markers and lines", () => {
	const blocks = (c) => [...c.querySelectorAll('[role="tabpanel"] .dataBlock')];
	// A recorded add rebuilds the plot's inner from its saved form, so the block re-mounts; the
	// old one stays in the DOM, inert, for its outro (which happy-dom's stub never finishes).
	const live = (b) => b.querySelectorAll('.markerBlock:not([inert])');

	it('every series block holds its own Markers and lines, with its own add button', async () => {
		const plot = actogram(2);
		const inner = plot.plot;
		inner.data[1].addMarker();
		appState.currentControlTab = 'data';
		const { container } = render(ControlDisplay);
		await settle();
		const bs = blocks(container);
		expect(bs).toHaveLength(2);
		for (const b of bs) {
			const head = b.querySelector('.markers-section .markers-head');
			expect(head?.textContent.trim()).toBe('Markers and lines');
			const adds = [...b.querySelectorAll('button.btn-add')].map((x) => x.textContent.trim());
			expect(adds).toEqual(['+ Add markers and line']);
		}
		// The marker lives in the second series' block, not the first.
		expect(bs[0].querySelectorAll('.markerBlock')).toHaveLength(0);
		expect(bs[0].querySelector('.block-empty')?.textContent).toBe('No markers on this series yet');
		expect(bs[1].querySelectorAll('.markerBlock')).toHaveLength(1);
		expect(bs[1].querySelector('.block-empty')).toBeNull();
	});

	it("a rule's instance shows under each series, and Edit rule opens Overlays", async () => {
		const plot = actogram(2);
		appState.currentControlTab = 'overlays';
		const { container, getByRole } = render(ControlDisplay);
		await settle();
		await press(getByRole('button', { name: 'Add a marker rule' }));
		const ruleId = plot.plot.markerRules[0].id;

		appState.currentControlTab = 'data';
		await settle();
		const bs = blocks(container);
		for (const b of bs) {
			expect(b.querySelectorAll(`[data-rule-instance="${ruleId}"]`)).toHaveLength(1);
		}
		const steps = history.undoCount;
		const edit = [...bs[1].querySelectorAll('button')].find(
			(x) => x.textContent.trim() === 'Edit rule'
		);
		await fireEvent.click(edit);
		await settle();
		expect(appState.currentControlTab).toBe('overlays');
		expect(container.querySelector('.rule-block')).not.toBeNull();
		// Switching tab is navigation, not an edit.
		expect(history.undoCount).toBe(steps);
	});

	it('adding and removing a marker from the Data tab is one undo step each', async () => {
		const plot = actogram(2);
		appState.currentControlTab = 'data';
		const { container } = render(ControlDisplay);
		await settle();
		const datum = () => core.plots.find((p) => p.id === plot.id).plot.data[1];

		const s0 = history.undoCount;
		await press(blocks(container)[1].querySelector('button[aria-label="Add markers and a line"]'));
		expect(history.undoCount).toBe(s0 + 1);
		expect(datum().phaseMarkers).toHaveLength(1);
		expect(core.plots[0].plot.data[0].phaseMarkers).toHaveLength(0);
		expect(live(blocks(container)[1])).toHaveLength(1);
		expect(live(blocks(container)[0])).toHaveLength(0);

		const [block] = live(blocks(container)[1]);
		await press(block.querySelector('button[aria-label="Remove this phase marker"]'));
		expect(history.undoCount).toBe(s0 + 2);
		expect(datum().phaseMarkers).toHaveLength(0);

		history.undo();
		await settle();
		expect(datum().phaseMarkers).toHaveLength(1);
		history.undo();
		await settle();
		expect(datum().phaseMarkers).toHaveLength(0);
		expect(history.undoCount).toBe(s0);
	});
});
