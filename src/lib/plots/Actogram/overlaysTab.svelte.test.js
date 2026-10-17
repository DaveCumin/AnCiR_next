// UI-12: everything drawn over the actogram's rows lives on ONE tab, named "Overlays" as on
// the other plots. Before, light bands were on Properties, marker rules and each series'
// markers on Data, and annotations on their own Annotations tab.
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

function actogram() {
	const t = mkCol(
		't',
		Array.from({ length: 96 }, (_, i) => i)
	);
	const v = mkCol(
		'activity',
		Array.from({ length: 96 }, (_, i) => (i % 24 < 12 ? 50 : 5))
	);
	const plot = new Plot({
		type: 'actogram',
		name: 'acto',
		width: 500,
		height: 300,
		plot: { data: [{ x: { refId: t }, y: { refId: v } }] }
	});
	plot.selected = true;
	core.plots.push(plot);
	return core.plots[core.plots.length - 1];
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

	it('holds light bands, annotations, marker rules and each series markers', async () => {
		actogram();
		appState.currentControlTab = 'overlays';
		const { container } = render(ControlDisplay);
		await settle();
		expect(titles(container)).toEqual([
			'Light bands',
			'Annotations',
			'Marker rules',
			'Markers and lines on activity'
		]);
		const adds = [...container.querySelectorAll('[role="tabpanel"] button.btn-add')].map((b) =>
			b.textContent.trim()
		);
		expect(adds).toEqual([
			'+ Add light band',
			'+ Add annotation',
			'+ Add rule',
			'+ Add markers and line'
		]);
	});

	it('every add button adds its block (and nothing on Properties or Data does)', async () => {
		const plot = actogram();
		appState.currentControlTab = 'overlays';
		const { container, getByRole } = render(ControlDisplay);
		await settle();
		for (const name of [
			'Add a band',
			'Add an annotation',
			'Add a marker rule',
			'Add markers and a line'
		]) {
			const steps = history.undoCount;
			const btn = getByRole('button', { name });
			await fireEvent.pointerDown(btn);
			await fireEvent.click(btn);
			await fireEvent.pointerUp(btn);
			await settle();
			expect(history.undoCount, name).toBe(steps + 1);
		}
		const inner = core.plots.find((p) => p.id === plot.id).plot;
		expect(inner.lightBands.bands.length).toBe(1);
		expect(inner.annotations.length).toBe(1);
		expect(inner.markerRules.length).toBe(1);
		expect(inner.data[0].phaseMarkers.length).toBe(1);
		expect(container.querySelector('.block-empty')).toBeNull();

		for (const tab of ['properties', 'data']) {
			cleanup();
			appState.currentControlTab = tab;
			const r = render(ControlDisplay);
			await settle();
			const text = r.container.querySelector('[role="tabpanel"]').textContent;
			for (const gone of ['Light bands', 'Marker rules', 'Markers and lines', 'Annotations']) {
				expect(text, `${tab} tab`).not.toContain(gone);
			}
		}
	});
});
