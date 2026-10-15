// @ts-nocheck
// The automatic onset/offset markers are found by template matching (onsetUnwrap.js,
// matchTemplateMarkers). The panels that set N, M and % now say so: the marker-rule block and
// a series' own onset/offset marker. A hand-placed ("manual") marker has no N/M/% and no note.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, cleanup } from '@testing-library/svelte';
import { core, appConsts, appState, pushObj } from '$lib/core/core.svelte.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { Column } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { history } from '$lib/core/opHistory.svelte.js';
import Actogram from './Actogram.svelte';
import { PhaseMarkerClass } from './PhaseMarker.svelte';
import { addRuleRecorded } from './markerRuleActions.js';
import { TEMPLATE_METHOD_NOTE } from './markerMethod.js';

Element.prototype.animate ??= () => ({ finished: Promise.resolve(), cancel() {}, onfinish: null });

const REST = join(process.cwd(), 'static', 'sessions', 'demos', 'demo-workflow-rest-activity.json');

function restActogram() {
	const session = JSON.parse(readFileSync(REST, 'utf8'));
	core.data = [];
	core.plots = [];
	core.tableProcesses = [];
	core.groups = [];
	core.storedValues = {};
	core.rawData = new Map(Object.entries(session.rawData ?? {}).map(([k, v]) => [+k, v]));
	for (const cd of session.data ?? []) pushObj(Column.fromJSON(cd));
	const plot = Plot.fromJSON(session.plots.find((p) => p.type === 'actogram'));
	core.plots.push(plot);
	for (const d of plot.plot.data) d.phaseMarkers = [];
	return plot;
}

const notes = (container) =>
	[...container.querySelectorAll('p')].filter((p) => p.textContent.includes('template matching'));

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
});

beforeEach(() => {
	history.clear();
	appState.currentControlTab = 'data';
});
afterEach(() => cleanup());

describe('template-matching method note', () => {
	it('names the method in plain words', () => {
		expect(TEMPLATE_METHOD_NOTE).toMatch(/template matching/i);
		expect(TEMPLATE_METHOD_NOTE).not.toMatch(/\u2014/); // no em-dash
	});

	it('cites a published use of the method, without claiming to be ClockLab', () => {
		// Fernandez et al. (2017) applied ClockLab's template matching with 5 h windows; AnCiR's
		// windows and scoring are its own, so the note credits the idea, not an equivalence.
		expect(TEMPLATE_METHOD_NOTE).toMatch(/ClockLab \(Actimetrics\)/);
		expect(TEMPLATE_METHOD_NOTE).toMatch(/Fernandez et al\. \(2017/);
		expect(TEMPLATE_METHOD_NOTE).toMatch(/5 h windows/);
	});

	it('shows under a marker rule that detects onsets', () => {
		const plot = restActogram();
		addRuleRecorded(plot.plot, {
			type: 'onset',
			templateHrsBefore: 3,
			templateHrsAfter: 3,
			centileThreshold: 50,
			name: 'Onsets'
		});
		const { container } = render(Actogram, { props: { theData: plot.plot, which: 'controls' } });
		const block = container.querySelector('.rule-block');
		expect(block).not.toBeNull();
		expect(notes(block)).toHaveLength(1);
		expect(notes(block)[0].textContent.trim()).toBe(TEMPLATE_METHOD_NOTE);
	});

	it("shows under a series' own onset marker, and not under a hand-placed one", () => {
		const plot = restActogram();
		const datum = plot.plot.data[0];
		datum.phaseMarkers.push(
			new PhaseMarkerClass(datum, {
				type: 'onset',
				templateHrsBefore: 3,
				templateHrsAfter: 3,
				centileThreshold: 50
			})
		);
		const r = render(Actogram, { props: { theData: plot.plot, which: 'controls' } });
		expect(notes(r.container)).toHaveLength(1);
		cleanup();

		datum.phaseMarkers[0] = new PhaseMarkerClass(datum, { type: 'manual' });
		const r2 = render(Actogram, { props: { theData: plot.plot, which: 'controls' } });
		expect(notes(r2.container)).toHaveLength(0);
	});
});
