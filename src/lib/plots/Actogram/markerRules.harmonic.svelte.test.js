// @ts-nocheck
/**
 * The harmonic check is computed once per instance and cached, never on an unrelated edit
 * (Decision 2b; plan section 8). It depends on the fitted slope's VALUE and the series data
 * only: an edit that recomputes the regression without moving the slope (a phi reference
 * day, a style field) must not re-run its periodogram evaluations, and `instanceSummary`
 * (the line's own numbers) must never run it at all. The summary TABLE's τ column reads the
 * same cached check the port reads (MarkerRuleBlock.tau.svelte.test.js).
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const calls = vi.hoisted(() => ({ n: 0 }));
vi.mock('$lib/utils/periodogram.js', async (importOriginal) => {
	const real = await importOriginal();
	return {
		...real,
		runPeriodogramCalculation: (...args) => {
			calls.n++;
			return real.runPeriodogramCalculation(...args);
		}
	};
});

import { core, appConsts, pushObj } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { instanceSummary } from './markerRules.svelte.js';
import { addRuleRecorded, setRuleSettings } from './markerRuleActions.js';

const REST = join(process.cwd(), 'static', 'sessions', 'demos', 'demo-workflow-rest-activity.json');

function restActogram() {
	const session = JSON.parse(readFileSync(REST, 'utf8'));
	core.data = [];
	core.plots = [];
	core.storedValues = {};
	core.rawData = new Map(Object.entries(session.rawData ?? {}).map(([k, v]) => [+k, v]));
	for (const cd of session.data ?? []) pushObj(Column.fromJSON(cd));
	const plot = Plot.fromJSON(session.plots.find((p) => p.type === 'actogram'));
	core.plots.push(plot);
	return plot;
}

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
});

describe('harmonic check caching', () => {
	it('runs once per instance, survives slope-neutral edits, re-runs when the slope moves', () => {
		const plot = restActogram();
		addRuleRecorded(plot.plot, { type: 'onset' });
		const rule = plot.plot.markerRules[0];
		const inst = plot.plot.data[0].ruleInstances[0];

		// instanceSummary's read (regression, phase, n) runs no periodogram at all.
		calls.n = 0;
		for (const d of plot.plot.data) instanceSummary(d.ruleInstances[0]);
		expect(calls.n).toBe(0);

		const first = inst.harmonicCheck;
		const perCheck = calls.n;
		expect(perCheck).toBeGreaterThan(0);
		expect(perCheck).toBeLessThanOrEqual(3);
		void inst.harmonicCheck;
		expect(calls.n).toBe(perCheck);

		// Slope-neutral: style, and the phi reference day (a new regression OBJECT, same slope).
		setRuleSettings(plot.plot, rule, { lineWidth: 3, markerSize: 7 });
		setRuleSettings(plot.plot, rule, { phaseRefDay: 3 });
		expect(inst.harmonicCheck).toBe(first);
		expect(calls.n).toBe(perCheck);

		// The slope moves: it re-runs, once.
		setRuleSettings(plot.plot, rule, { templateHrsBefore: 5 });
		void inst.harmonicCheck;
		void inst.harmonicCheck;
		expect(calls.n).toBe(2 * perCheck);
	});
});
