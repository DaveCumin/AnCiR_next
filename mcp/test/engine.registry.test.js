// Generic registry-driven analysis path: prove that table processes other than
// the hand-wired Cosinor run through the real `definition` registry, write their
// output columns into the session, and survive a round-trip through export.
import { beforeAll, describe, expect, it } from 'vitest';
import {
	AncirSession,
	ensureRegistry,
	describeCapabilities,
	filterCapabilities
} from '../src/engine/session.js';

const N = 96;
const seq = (n, f) => Array.from({ length: n }, (_, i) => f(i));

beforeAll(async () => {
	await ensureRegistry();
});

describe('capability catalogue (derived from the registry)', () => {
	it('surfaces every registered table process as an available analysis', () => {
		const caps = describeCapabilities();
		const ids = caps.analyses.map((a) => a.id);
		// A representative spread across families.
		for (const expected of ['Cosinor', 'TrendFit', 'RhythmicityAnalysis', 'SmoothedData']) {
			expect(ids, `${expected} present`).toContain(expected);
		}
		// Cosinor's params should be discoverable with defaults, inputs separated out.
		const cosinor = caps.analyses.find((a) => a.id === 'Cosinor');
		expect(cosinor.inputs.scalar).toContain('xIN');
		expect(cosinor.inputs.array).toContain('yIN');
		expect(cosinor.params).toHaveProperty('fixedPeriod');
		expect(cosinor.params).not.toHaveProperty('out');
	});
});

describe('filterCapabilities — the discovery projection that keeps list_capabilities small', () => {
	const full = () => describeCapabilities();

	it('defaults to a compact summary: names + one-liner + param NAMES, no defaults', () => {
		const out = filterCapabilities(full()); // detail defaults to "summary"
		const cos = out.analyses.find((a) => a.id === 'Cosinor');
		expect(cos.summary, 'keeps the one-line summary').toBeTruthy();
		expect(cos.inputs.scalar, 'keeps input field names').toContain('xIN');
		// params are NAMES only — the defaults (the bulky part) are dropped
		expect(Array.isArray(cos.params)).toBe(true);
		expect(cos.params).toContain('fixedPeriod');
		// and the summary is genuinely smaller than the full dump
		expect(JSON.stringify(out).length).toBeLessThan(JSON.stringify(full()).length);
	});

	it('"names" is ids + families only', () => {
		const out = filterCapabilities(full(), { detail: 'names' });
		const cos = out.analyses.find((a) => a.id === 'Cosinor');
		expect(Object.keys(cos).sort()).toEqual(['family', 'id']);
	});

	it('"full" is byte-identical to the unprojected catalogue', () => {
		const out = filterCapabilities(full(), { detail: 'full' });
		expect(out.analyses).toEqual(full().analyses);
	});

	it('name: returns the ONE capability at full detail, with defaults', () => {
		const out = filterCapabilities(full(), { name: 'Cosinor' });
		expect(out.kind).toBe('analysis');
		expect(out.capability.id).toBe('Cosinor');
		expect(out.capability.params).toHaveProperty('fixedPeriod'); // full detail = defaults present
	});

	it('name: an unknown capability reports it rather than dumping everything', () => {
		const out = filterCapabilities(full(), { name: 'NoSuchThing' });
		expect(out.capability).toBeNull();
		expect(out.error).toMatch(/No capability named/);
	});

	it('family: narrows to one family and drops the family-less plots', () => {
		const out = filterCapabilities(full(), { family: 'Fitting' });
		expect(out.analyses.length).toBeGreaterThan(0);
		expect(out.analyses.every((a) => a.family === 'Fitting')).toBe(true);
		expect(out.plots).toEqual([]);
	});
});

describe('run_table_process (generic path)', () => {
	it('runs Cosinor and writes output columns into the session', async () => {
		const s = new AncirSession('reg-cosinor');
		const [, yId] = s
			.importColumns([
				{ name: 't', values: seq(N, (i) => i) },
				{ name: 'y', values: seq(N, (i) => 10 + 5 * Math.cos((2 * Math.PI * i) / 24)) }
			])
			.map((c) => c.id);

		const res = await s.runTableProcess('Cosinor', {
			xIN: 0,
			yIN: [yId],
			useFixedPeriod: true,
			fixedPeriod: 24,
			nHarmonics: 1
		});

		expect(res.valid).toBe(true);
		// cosinorx (shared x) + the per-Y fitted curve.
		expect(res.outputs.length).toBeGreaterThanOrEqual(2);
		const fitted = res.outputs.find((o) => o.length === N);
		expect(fitted, 'a fitted-curve output of full length').toBeTruthy();

		// The analysis node + its outputs must be present in the exported session.
		const exported = s.exportSessionObject();
		expect(exported.tableProcesses?.length).toBe(1);
		const outIds = res.outputs.map((o) => o.columnId);
		const colIds = (exported.data ?? []).map((c) => c.id);
		for (const id of outIds) expect(colIds, `output col ${id} exported`).toContain(id);
	});

	it('runs TrendFit (fixed output, auto-seeded out)', async () => {
		const s = new AncirSession('reg-trend');
		s.importColumns([
			{ name: 'x', values: seq(N, (i) => i) },
			{ name: 'y', values: seq(N, (i) => 2 * i + 1) }
		]);
		const res = await s.runTableProcess('TrendFit', {
			xIN: 0,
			yIN: [1],
			model: 'linear'
		});
		expect(res.valid).toBe(true);
		expect(res.outputs.length).toBeGreaterThanOrEqual(1);
	});

	it('runs RhythmicityAnalysis with an explicit dynamic `out` seed (periodogram)', async () => {
		const s = new AncirSession('reg-rhythm');
		s.importColumns([
			{ name: 'x', values: seq(N, (i) => i) },
			{ name: 'y', values: seq(N, (i) => Math.cos((2 * Math.PI * i) / 24)) }
		]);
		const res = await s.runTableProcess('RhythmicityAnalysis', {
			xIN: 0,
			yIN: [1],
			analysis: 'periodogram',
			pgMethod: 'Lomb-Scargle',
			periodMin: 20,
			periodMax: 28,
			periodStep: 0.5,
			pgBinSize: 0.25,
			pgAlpha: 0.05,
			out: { '1_period': -1, '1_power': -1 }
		});
		expect(res.valid).toBe(true);
	});

	it('rejects an unknown process name with a helpful message', async () => {
		const s = new AncirSession('reg-bad');
		await expect(s.runTableProcess('NotAProcess', {})).rejects.toThrow(/Unknown table process/);
	});
});
