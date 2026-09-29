// @ts-nocheck
/**
 * PIN for the harmonic check (Decision 2b: a marker rule's tau OUTPUT is the harmonic-check
 * pick, `harmonicCheck.strongest.peakPeriod`). The check was a $derived inside
 * PhaseMarkerClass; Phase B moved it into the pure `harmonicCheck.js` so the Python and R
 * ports can mirror it function by function. These numbers were recorded from the class
 * BEFORE the extraction and must not move: the extraction is behaviour-identical.
 *
 * Cases, over the shipped rest-activity demo (two series, 7 days hourly):
 *  - an onset rule's instance on each series (fitted tau 24.143 h and 24.627 h);
 *  - own blocks with tau FIXED at 12.3 h, 24 h and 47 h on each series, which exercise the
 *    candidate filter (2 tau = 94 h is past half the record, 83 h, so it drops out) and a
 *    case where tau / 2 or 2 tau can win.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts, pushObj } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { PhaseMarkerClass } from './PhaseMarker.svelte';
import { addRule } from './markerRules.svelte.js';
import { harmonicCheck } from './harmonicCheck.js';

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

const FIXED_TAUS = [12.3, 24, 47];

/** Every case's harmonic check, read from the class (instances and own blocks). */
function classChecks(plot) {
	addRule(plot.plot, { type: 'onset', templateHrsBefore: 3, templateHrsAfter: 3 });
	const out = [];
	plot.plot.data.forEach((d, s) => {
		out.push({ case: `rule s${s}`, block: d.ruleInstances[0] });
		for (const tau of FIXED_TAUS) {
			const block = PhaseMarkerClass.fromJSON(
				{
					name: `fixed_${tau}`,
					type: 'manual',
					lockTau: 'fixed',
					lockTheta: 'fixed',
					fitSlope: tau,
					fitIntercept: 6
				},
				d
			);
			out.push({ case: `fixed ${tau} s${s}`, block });
		}
	});
	return out;
}

const round = (v) => (typeof v === 'number' ? Number(v.toPrecision(12)) : v);
const shape = (hc) =>
	hc == null
		? null
		: {
				candidates: hc.candidates.map((c) => ({
					label: c.label,
					period: round(c.period),
					peakPeriod: round(c.peakPeriod),
					power: round(c.power)
				})),
				strongest: hc.strongest.label
			};

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
});

describe('harmonic check: pinned before the extraction', () => {
	it('the class reproduces the numbers recorded before the extraction', () => {
		const plot = restActogram();
		const got = Object.fromEntries(
			classChecks(plot).map(({ case: c, block }) => [c, shape(block.harmonicCheck)])
		);
		expect(got).toMatchInlineSnapshot(`
			{
			  "fixed 12.3 s0": {
			    "candidates": [
			      {
			        "label": "τ",
			        "peakPeriod": 12.3,
			        "period": 12.3,
			        "power": 4.89434729994,
			      },
			      {
			        "label": "τ/2",
			        "peakPeriod": 6.15,
			        "period": 6.15,
			        "power": 0.530222504295,
			      },
			      {
			        "label": "2τ",
			        "peakPeriod": 24.6,
			        "period": 24.6,
			        "power": 57.6652299223,
			      },
			    ],
			    "strongest": "2τ",
			  },
			  "fixed 12.3 s1": {
			    "candidates": [
			      {
			        "label": "τ",
			        "peakPeriod": 12.3,
			        "period": 12.3,
			        "power": 2.56155700996,
			      },
			      {
			        "label": "τ/2",
			        "peakPeriod": 6.15,
			        "period": 6.15,
			        "power": 0.166939467027,
			      },
			      {
			        "label": "2τ",
			        "peakPeriod": 24.6,
			        "period": 24.6,
			        "power": 31.1810615945,
			      },
			    ],
			    "strongest": "2τ",
			  },
			  "fixed 24 s0": {
			    "candidates": [
			      {
			        "label": "τ",
			        "peakPeriod": 24,
			        "period": 24,
			        "power": 64.0464872849,
			      },
			      {
			        "label": "τ/2",
			        "peakPeriod": 12,
			        "period": 12,
			        "power": 4.35393256398,
			      },
			      {
			        "label": "2τ",
			        "peakPeriod": 48,
			        "period": 48,
			        "power": 0.186343346277,
			      },
			    ],
			    "strongest": "τ",
			  },
			  "fixed 24 s1": {
			    "candidates": [
			      {
			        "label": "τ",
			        "peakPeriod": 24,
			        "period": 24,
			        "power": 31.2173707331,
			      },
			      {
			        "label": "τ/2",
			        "peakPeriod": 12,
			        "period": 12,
			        "power": 0.536412641583,
			      },
			      {
			        "label": "2τ",
			        "peakPeriod": 48,
			        "period": 48,
			        "power": 0.23868078512,
			      },
			    ],
			    "strongest": "τ",
			  },
			  "fixed 47 s0": {
			    "candidates": [
			      {
			        "label": "τ",
			        "peakPeriod": 47,
			        "period": 47,
			        "power": 0.2020543689,
			      },
			      {
			        "label": "τ/2",
			        "peakPeriod": 23.5,
			        "period": 23.5,
			        "power": 60.0858838825,
			      },
			    ],
			    "strongest": "τ/2",
			  },
			  "fixed 47 s1": {
			    "candidates": [
			      {
			        "label": "τ",
			        "peakPeriod": 47,
			        "period": 47,
			        "power": 0.279617995511,
			      },
			      {
			        "label": "τ/2",
			        "peakPeriod": 23.5,
			        "period": 23.5,
			        "power": 26.3254615477,
			      },
			    ],
			    "strongest": "τ/2",
			  },
			  "rule s0": {
			    "candidates": [
			      {
			        "label": "τ",
			        "peakPeriod": 24.1428571429,
			        "period": 24.1428571429,
			        "power": 63.5898525558,
			      },
			      {
			        "label": "τ/2",
			        "peakPeriod": 12.0714285714,
			        "period": 12.0714285714,
			        "power": 4.85909687732,
			      },
			      {
			        "label": "2τ",
			        "peakPeriod": 48.2857142857,
			        "period": 48.2857142857,
			        "power": 0.178698335077,
			      },
			    ],
			    "strongest": "τ",
			  },
			  "rule s1": {
			    "candidates": [
			      {
			        "label": "τ",
			        "peakPeriod": 24.6273291925,
			        "period": 24.6273291925,
			        "power": 31.022052393,
			      },
			      {
			        "label": "τ/2",
			        "peakPeriod": 12.3136645963,
			        "period": 12.3136645963,
			        "power": 2.63999735794,
			      },
			      {
			        "label": "2τ",
			        "peakPeriod": 49.2546583851,
			        "period": 49.2546583851,
			        "power": 0.185418771347,
			      },
			    ],
			    "strongest": "τ",
			  },
			}
		`);
	});

	it('the pure function returns exactly what the class does (same object shape, same numbers)', () => {
		const plot = restActogram();
		for (const { case: c, block } of classChecks(plot)) {
			const d = block.parentData;
			const pure = harmonicCheck({
				// Plain arrays in: nothing reactive crosses into the pure function.
				xData: Array.from(d.x?.hoursSinceStart ?? []),
				yData: Array.from(d.y?.getData() ?? []),
				binSize: d.binSize,
				tau: block.fittedSlope
			});
			expect(pure, c).toEqual(block.harmonicCheck);
		}
	});
});
