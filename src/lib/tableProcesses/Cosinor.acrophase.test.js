// One acrophase convention across the Cosinor node, and a bounded free period.
//
// Acrophase (paper benchmark evidence, E_issue_evidence.json): for a rhythm
// peaking at 06:00 the `acrophase` port said 6.0 h while the panel ("H1
// Acrophase") and the stats CSV (H1_acrophase_hrs) said 18.0 h, because
// fitCosinorFixed returned the classical wrap(−t_peak) and only the port negated
// it. Now fitCosinorFixed reports the time of peak and every surface prints that
// number; this file pins the port and the stats table to each other.
//
// Free period: with no bound the fit followed a trend out to thousands of hours
// on real data, silently. The node now fits inside [minPeriod, maxPeriod]
// (default 1 to 48 h) and says so when the fit ends on a bound.
//
// Real maths throughout (no mock of $lib/utils/cosinor.js), as in
// Cosinor.pvalue.test.js.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockColumns, rawData } = vi.hoisted(() => ({
	mockColumns: {},
	rawData: new Map()
}));
vi.mock('$lib/core/core.svelte', () => ({
	core: { rawData },
	appConsts: { processMap: new Map() }
}));
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: (id) => mockColumns[id] }));
vi.mock('$lib/components/inputs/NumberWithUnits.svelte', () => ({ default: {} }));
vi.mock('$lib/components/inputs/AttributeSelect.svelte', () => ({ default: {} }));

import { cosinor, cosinorStatsTable, definition } from './Cosinor.svelte';

const OUT_IDS = {
	cosinorx: 50,
	cosinory_2: 51,
	period: 60,
	mesor: 61,
	amplitude: 62,
	acrophase: 63,
	amplitude_ciLow: 64,
	amplitude_ciHigh: 65,
	acrophase_ciLow: 66,
	acrophase_ciHigh: 67,
	rsquared: 68,
	pvalue: 69,
	perm_pvalue: 70,
	bathyphase: 71,
	phase_angle: 72
};

const args = (over) => ({
	xIN: 1,
	yIN: [2],
	Ncurves: 1,
	outputX: -1,
	out: { ...OUT_IDS },
	useFixedPeriod: true,
	fixedPeriod: 24,
	nHarmonics: 1,
	alpha: 0.05,
	referenceHrs: 0,
	permuteTest: false,
	preProcesses: [],
	...over
});

function setData(t, y) {
	rawData.clear();
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	mockColumns[1] = { type: 'number', getData: () => t, hoursSinceStart: t };
	mockColumns[2] = { name: 'activity', getData: () => y };
	for (const id of Object.values(OUT_IDS)) {
		mockColumns[id] = { getData: () => rawData.get(id) ?? [] };
	}
}

const col = (table, name) => table.headers.indexOf(name);

// 6 days at 30 min, peak at 06:00, a little deterministic ripple so the CI is not zero.
const t6 = Array.from({ length: 288 }, (_, i) => i * 0.5);
const y6 = t6.map(
	(ti) => 10 + 3 * Math.cos((2 * Math.PI * (ti - 6)) / 24) + 0.4 * Math.sin(ti * 1.7)
);

describe('Cosinor acrophase: one convention (time of peak) everywhere', () => {
	beforeEach(() => setData(t6, y6));

	it('fixed period: port and stats table agree on the 06:00 peak (was 6 vs 18)', async () => {
		const a = args();
		const [data, valid] = await cosinor(a);
		expect(valid).toBe(true);
		const port = rawData.get(OUT_IDS.acrophase)[0];
		expect(port).toBeCloseTo(6, 1);

		const table = cosinorStatsTable(data, a);
		expect(table.headers).toContain('H1_acrophase_peak_h');
		expect(table.headers).not.toContain('H1_acrophase_hrs');
		const row = table.rows[0];
		expect(row[col(table, 'H1_acrophase_peak_h')]).toBeCloseTo(port, 12);
		expect(row[col(table, 'H1_acrophase_ci_lo')]).toBeCloseTo(
			rawData.get(OUT_IDS.acrophase_ciLow)[0],
			12
		);
		expect(row[col(table, 'H1_acrophase_ci_hi')]).toBeCloseTo(
			rawData.get(OUT_IDS.acrophase_ciHigh)[0],
			12
		);
		// The interval brackets the estimate.
		expect(rawData.get(OUT_IDS.acrophase_ciLow)[0]).toBeLessThan(port);
		expect(rawData.get(OUT_IDS.acrophase_ciHigh)[0]).toBeGreaterThan(port);
		// Bathyphase is half a cycle after the peak.
		expect(rawData.get(OUT_IDS.bathyphase)[0]).toBeCloseTo(port + 12, 12);
	});

	it('free period: the stats table acrophase column equals the port', async () => {
		const a = args({ useFixedPeriod: false, minPeriod: 1, maxPeriod: 48 });
		const [data] = await cosinor(a);
		const port = rawData.get(OUT_IDS.acrophase)[0];
		expect(port).toBeCloseTo(6, 1);
		const table = cosinorStatsTable(data, a);
		expect(table.rows[0][col(table, 'curve1_acrophase_peak_h')]).toBeCloseTo(port, 12);
		expect(table.headers).toContain('curve1_phase_rad');
	});
});

describe('Cosinor free period: bounded range and visible warnings', () => {
	it('declares minPeriod / maxPeriod with 1 to 48 h defaults', () => {
		expect(definition.defaults.get('minPeriod').val).toBe(1);
		expect(definition.defaults.get('maxPeriod').val).toBe(48);
	});

	it('a session saved before the range existed fits inside the default range', async () => {
		// 14 days of a bimodal (morning + evening) rhythm on a rising trend, 5-min
		// sampling: the unbounded fit returned a 174.6 h "period" for this series.
		const t = [];
		const y = [];
		for (let x = 0; x < 14 * 24; x += 1 / 12) {
			const ph = x % 24;
			const bump = (c, s) => Math.exp(-((((ph - c + 36) % 24) - 12) ** 2) / (2 * s * s));
			t.push(x);
			y.push(5 * bump(1, 1.2) + 7 * bump(12, 1.5) + 0.03 * x);
		}
		setData(t, y);
		const a = args({ useFixedPeriod: false });
		delete a.minPeriod;
		delete a.maxPeriod;
		const [data, valid] = await cosinor(a);
		expect(valid).toBe(true);
		const period = rawData.get(OUT_IDS.period)[0];
		expect(period).toBeGreaterThanOrEqual(1);
		expect(period).toBeLessThanOrEqual(48);
		expect(data.warnings.filter((w) => /period range/.test(w))).toEqual([]);
	});

	it('warns, on the node, when the fitted period ends on a bound', async () => {
		const t = Array.from({ length: 24 * 14 }, (_, i) => i);
		const y = t.map((ti) => 0.1 * ti + 0.2 * Math.sin(ti * 12.9898));
		setData(t, y);
		const [data] = await cosinor(args({ useFixedPeriod: false, minPeriod: 30, maxPeriod: 48 }));
		expect(rawData.get(OUT_IDS.period)[0]).toBeCloseTo(48, 6);
		expect(data.warnings.join('\n')).toMatch(
			/The free-period cosinor fit for "activity" stopped at the upper limit of the period range/
		);
	});

	it('warns about an empty period range instead of failing silently', async () => {
		setData(t6, y6);
		const [data] = await cosinor(args({ useFixedPeriod: false, minPeriod: 30, maxPeriod: 20 }));
		expect(data.warnings.join('\n')).toMatch(/Period range 30 to 20 h is empty/);
	});

	it('fixed-period mode ignores the range (no range warnings)', async () => {
		setData(t6, y6);
		const [data] = await cosinor(args({ minPeriod: 30, maxPeriod: 20 }));
		expect(data.warnings.join('\n')).not.toMatch(/Period range/);
		expect(rawData.get(OUT_IDS.period)[0]).toBe(24);
	});
});
