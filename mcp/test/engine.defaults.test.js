// run_table_process fills every omitted param from the node's declared defaults, as a node
// added in the app (palette or in-app AI edit) starts: buildTableProcessDefaults, then the
// x-dependent new-node args the component resolves on mount (periodRangeAuto.svelte.js,
// binSizeAuto.svelte.js). Before, Bin Data with no `binStart` was always refused as invalid.
import { beforeAll, describe, expect, it } from 'vitest';
import { AncirSession, ensureRegistry, fillOmittedArgs } from '../src/engine/session.js';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { buildTableProcessDefaults } from '$lib/core/tpDefaults.js';
import { NEW_NODE_TIME_PERIOD_RANGE } from '$lib/utils/periodRangeDefaults.js';
import { autoPeriodRange } from '$lib/utils/periodUnits.js';
import { normalizeSession } from '../src/emit/normalizer.js';

beforeAll(async () => {
	await ensureRegistry();
}, 60000);

const H = 3600000;
const N = 96;
const hours = Array.from({ length: N }, (_, i) => i);
const wave = hours.map((h) => 10 + 5 * Math.sin((2 * Math.PI * h) / 24) + (h % 7) / 10);

function session(id) {
	const s = new AncirSession(id);
	s.importColumns([
		{ name: 't', type: 'time', values: hours.map((h) => Date.UTC(2024, 3, 1) + h * H) },
		{ name: 'days', values: hours.map((h) => h / 24) },
		{ name: 'v', values: wave }
	]);
	return s;
}
const tpArgs = (r) => core.tableProcesses.find((t) => t.id === r.tableProcessId)?.args;
const outData = (r, key) => r.outputs.find((o) => o.key === key);

describe('Bin Data', () => {
	it('runs with no binStart (or any other param) and gets the defaults', async () => {
		const s = session('defaults-bin');
		const r = await s.runTableProcess('BinnedData', { xIN: 't', yIN: ['v'] });
		expect(r.valid, r.error).toBe(true);
		const args = tpArgs(r);
		const d = buildTableProcessDefaults(appConsts.tableProcessMap.get('BinnedData'));
		for (const k of ['binMode', 'binSize', 'binStart', 'stepSize', 'aggFunction', 'cuts']) {
			expect(args[k], k).toEqual(d[k]);
		}
		expect(args.binStart).toBe(0);
	});

	it('gives exactly what naming every default gives', async () => {
		const d = buildTableProcessDefaults(appConsts.tableProcessMap.get('BinnedData'));
		delete d.out;
		const named = await session('defaults-bin-a').runTableProcess('BinnedData', {
			...d,
			xIN: 't',
			yIN: ['v'],
			binSize: 2
		});
		const strip = (o) => o && { type: o.type, length: o.length, preview: o.preview };
		const named_x = strip(outData(named, 'binnedx'));
		const omitted = await session('defaults-bin-b').runTableProcess('BinnedData', {
			xIN: 't',
			yIN: ['v'],
			binSize: 2
		});
		expect(omitted.valid).toBe(true);
		expect(strip(outData(omitted, 'binnedx'))).toEqual(named_x);
		expect(named_x.length).toBe(N / 2 + 1);
		expect(omitted.outputs.length).toBe(named.outputs.length);
	});

	it('a supplied value wins; an explicit null is filled', async () => {
		const s = session('defaults-bin-c');
		const r = await s.runTableProcess('BinnedData', {
			xIN: 't',
			yIN: ['v'],
			binSize: 3,
			binStart: null
		});
		expect(r.valid).toBe(true);
		expect(tpArgs(r)).toMatchObject({ binSize: 3, binStart: 0 });
	});
});

describe('every node', () => {
	it('fillOmittedArgs gives every declared default (deep copies), keeping what is supplied', () => {
		let n = 0;
		for (const [name, entry] of appConsts.tableProcessMap) {
			const d = buildTableProcessDefaults(entry);
			const args = fillOmittedArgs(entry, {});
			for (const [k, v] of Object.entries(d)) {
				if (k === 'out') continue;
				expect(args[k], `${name}.${k}`).toEqual(v);
				if (v && typeof v === 'object') {
					// Never the registry's own object: a node must not share (and mutate) it.
					const raw = entry.defaults.get(k)?.val;
					expect(args[k] === raw, `${name}.${k} shared`).toBe(false);
				}
			}
			expect(args, name).not.toHaveProperty('out');
			const keep = fillOmittedArgs(entry, {
				__probe: 1,
				...Object.fromEntries([[Object.keys(d)[0], 'mine']])
			});
			expect(keep[Object.keys(d)[0]], name).toBe('mine');
			n++;
		}
		expect(n).toBe(appConsts.tableProcessMap.size);
		expect(n).toBeGreaterThan(30);
	});
});

describe('defaults that depend on the x (as a new node in the app)', () => {
	it('a free-period Cosinor on a time x searches 1 to 30 h', async () => {
		const r = await session('defaults-cos-t').runTableProcess('Cosinor', {
			xIN: 't',
			yIN: ['v']
		});
		// A new Cosinor fits one free cosine curve with no Ncurves given, as in the app.
		expect(r.valid, r.error).toBe(true);
		expect(tpArgs(r)).toMatchObject({
			...NEW_NODE_TIME_PERIOD_RANGE,
			periodRangeAuto: true,
			useFixedPeriod: false,
			Ncurves: 1
		});
	});

	it('on a number x it searches the Nyquist period to the record span', async () => {
		const s = session('defaults-cos-n');
		const r = await s.runTableProcess('RectangularWave', { xIN: 'days', yIN: ['v'] });
		const range = autoPeriodRange(core.data.find((c) => c.name === 'days'));
		expect(range).toBeTruthy();
		expect(tpArgs(r)).toMatchObject({ ...range, periodRangeAuto: true });
	});

	it("the Worker's draft normalizer gives a new fit the same range as the app", () => {
		// The app's function on the app's own Columns (session() above), against the range the
		// normalizer writes into a draft with the same values.
		const appCol = (name) => core.data.find((c) => c.name === name);
		const xs = {
			days: hours.map((h) => h / 24),
			mins: hours.map((h) => h * 60 + (h % 3) * 5),
			t: hours.map((h) => Date.UTC(2024, 3, 1) + h * H)
		};
		const s = new AncirSession('defaults-norm-mins');
		s.importColumns([{ name: 'mins', values: xs.mins }]);
		const minsRange = autoPeriodRange(appCol('mins'));
		session('defaults-norm');
		const want = {
			days: autoPeriodRange(appCol('days')),
			t: autoPeriodRange(appCol('t')),
			mins: minsRange
		};
		const { session: draft, errors } = normalizeSession({
			columns: [
				{ name: 't', type: 'time', values: xs.t },
				{ name: 'days', values: xs.days },
				{ name: 'mins', values: xs.mins },
				{ name: 'v', values: wave }
			],
			analyses: ['days', 'mins', 't'].map((x) => ({
				name: 'Cosinor',
				args: { xIN: x, yIN: ['v'] }
			}))
		});
		expect(errors).toEqual([]);
		const got = draft.tableProcesses.map((tp) => ({
			minPeriod: tp.args.minPeriod,
			maxPeriod: tp.args.maxPeriod
		}));
		expect(got).toEqual([want.days, want.mins, want.t]);
		// Three different ranges, none the 1 to 48 fallback.
		expect(want.days).not.toEqual(want.mins);
		expect(want.t).toEqual(NEW_NODE_TIME_PERIOD_RANGE);
		for (const r of got) expect(r).not.toEqual({ minPeriod: 1, maxPeriod: 48 });
	});

	it('a range the caller names is kept and the node does not follow its x', async () => {
		const r = await session('defaults-cos-r').runTableProcess('FitFunction', {
			xIN: 't',
			yIN: ['v'],
			minPeriod: 20,
			useFixedPeriod: false
		});
		expect(tpArgs(r)).toMatchObject({ minPeriod: 20, maxPeriod: 48, periodRangeAuto: false });
	});

	it("a binned periodogram's bin size is the median sampling interval", async () => {
		const r = await session('defaults-rhy').runTableProcess('RhythmicityAnalysis', {
			xIN: 't',
			yIN: ['v'],
			pgMethod: 'Chi-squared'
		});
		expect(r.valid, r.error).toBe(true);
		expect(tpArgs(r)).toMatchObject({ pgBinSize: 1, pgBinSizeAuto: true });
		const kept = await session('defaults-rhy-k').runTableProcess('MovingAnalysis', {
			xIN: 't',
			yIN: ['v'],
			pgBinSize: 0.5
		});
		expect(tpArgs(kept)).toMatchObject({ pgBinSize: 0.5, pgBinSizeAuto: false });
	});

	it('Smooth and Interpolate run with only their inputs', async () => {
		for (const name of ['SmoothedData', 'Interpolate', 'AverageProfile', 'NonparametricRA']) {
			const r = await session(`defaults-${name}`).runTableProcess(name, { xIN: 't', yIN: ['v'] });
			expect(r.valid, `${name}: ${r.error}`).toBe(true);
		}
	});
});

// A Rayleigh test run with no `unit` used to take the default, radians, whatever the values
// were (clock hours read as radians: R 0.015 for a cluster whose R is 0.89, and no warning).
describe('Rayleigh test unit', () => {
	const CLOCK_HOURS = Array.from({ length: 24 }, (_, i) => 10.87 + (i * (16.98 - 10.87)) / 23);
	const run = async (id, args, extra = []) => {
		const s = new AncirSession(id);
		s.importColumns([{ name: 'phase', values: CLOCK_HOURS }, ...extra]);
		return s.runTableProcess('RayleighTest', { yIN: ['phase'], ...args });
	};
	const R = (r) => outData(r, 'R').preview[0];

	it('no unit: read from the values, as a node added in the app', async () => {
		const r = await run('rayleigh-auto', {});
		expect(r.valid, r.error).toBe(true);
		expect(tpArgs(r)).toMatchObject({ unit: 'hours', unitAuto: true });
		expect(R(r)).toBeGreaterThan(0.85);
		expect(r.warnings).toBeUndefined();
	});

	it('an explicit unit is respected, and the result says when the values contradict it', async () => {
		const r = await run('rayleigh-explicit', { unit: 'radians' });
		expect(r.valid, r.error).toBe(true);
		expect(tpArgs(r)).toMatchObject({ unit: 'radians', unitAuto: false });
		expect(R(r)).toBeLessThan(0.1);
		expect(r.warnings).toHaveLength(1);
		expect(r.warnings[0]).toMatch(/look like clock hours read as radians/);
		const ok = await run('rayleigh-explicit-ok', { unit: 'hours' });
		expect(tpArgs(ok)).toMatchObject({ unit: 'hours', unitAuto: false });
		expect(R(ok)).toBeCloseTo(R(await run('rayleigh-auto-2', {})), 12);
		expect(ok.warnings).toBeUndefined();
	});

	it('with a time wired the values are weights: nothing is inferred', async () => {
		const r = await run('rayleigh-timed', { timeIN: 't' }, [
			{
				name: 't',
				type: 'time',
				values: CLOCK_HOURS.map((_, i) => Date.UTC(2024, 3, 1) + i * 6 * H)
			}
		]);
		expect(r.valid, r.error).toBe(true);
		expect(tpArgs(r).unit).toBe('radians');
	});
});
