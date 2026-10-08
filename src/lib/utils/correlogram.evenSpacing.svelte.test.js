/**
 * computeAutocorrelation on EVENLY spaced data must not move when its uneven-spacing rules do.
 *
 * On evenly spaced data every pair's separation is an exact multiple of the step, so the lag
 * slot a pair falls in, the half-open slot edges and the treatment of near-zero pairs can
 * never matter: the results must be byte-identical. This test replays, against a golden file,
 * every call the app makes to computeAutocorrelation for:
 *
 *   - every shipped session (static/sessions/{demos,classroom}): each Correlogram plot's
 *     acfData, and each RhythmicityAnalysis and MovingAnalysis node re-run with
 *     `analysis: 'correlogram'` (none ships in that mode, so this is the only way to pin
 *     them on real demo inputs);
 *   - the parity fixtures `util-autocorrelation-peak` and `plot-correlogram-rhythm-noisy`;
 *   - evenly spaced series with MISSING rows (a gap, and scattered nulls). Dropping the missing
 *     rows makes the spacing uneven by whole steps, so these take the time-pair path, the one
 *     the new rules change. Their lags >= 1 must be unchanged; their lag 0 was 0 (no
 *     non-self pair lies within half a step of 0) and is now exactly 1, by definition.
 *
 * Lag 0 on the index-shift path was sum / (n * var), which is 1 up to rounding; two of the
 * shipped MovingAnalysis windows gave 0.9999999999999998. It is now exactly 1 too. That is
 * the only permitted difference outside the gapped series, and the peak (which ignores lag 0)
 * cannot move.
 *
 * Since v81.11 the default lag window is half the recording span in hours, not n / 2 steps.
 * The two agree on complete, evenly spaced data (span = (n - 1) steps), so the shipped
 * sessions are untouched; a gapped series has fewer rows than its span implies and its window
 * may now be longer, with the lags it shared unchanged.
 *
 * The golden file stores each call's exact inputs and the outputs the code gave BEFORE the
 * change (v78.0 plus the items-1/2 fixes). Regenerate it only on purpose:
 *   GEN_ACF_GOLDEN=1 npx vitest run src/lib/utils/correlogram.evenSpacing.svelte.test.js
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('$lib/utils/correlogram.js', async (importOriginal) => {
	const mod = await importOriginal();
	return {
		...mod,
		computeAutocorrelation: (...args) => {
			const r = mod.computeAutocorrelation(...args);
			if (globalThis.__acfRecorder) globalThis.__acfRecorder(args, r);
			return r;
		}
	};
});

import { computeAutocorrelation } from '$lib/utils/correlogram.js';

const ROOT = process.cwd();
const GOLDEN = join(ROOT, 'src', 'test', 'fixtures', 'autocorrelation-even-golden.json');
const SESSION_DIRS = [
	join(ROOT, 'static', 'sessions', 'demos'),
	join(ROOT, 'static', 'sessions', 'classroom')
];

/** Exact serialisation of a result: JSON round-trips a double exactly (NaN reads as null). */
const serial = (r) =>
	JSON.stringify({
		lags: r.lags,
		correlations: r.correlations,
		dt: r.dt,
		peakLag: r.peakLag,
		peakCorrelation: r.peakCorrelation
	});

/** Evenly spaced series with missing rows: the time-pair path on even data. */
function gappedCases() {
	const cases = [];
	const rhythm = (n, dt, period, seed) => {
		let s = seed;
		const rnd = () => {
			s = (s * 1103515245 + 12345) % 2147483648;
			return s / 2147483648 - 0.5;
		};
		const t = Array.from({ length: n }, (_, i) => i * dt);
		const y = t.map((h) => 50 + 30 * Math.cos((2 * Math.PI * h) / period) + 8 * rnd());
		return { t, y };
	};
	// Hourly, five days, a 10-hour gap.
	{
		const { t, y } = rhythm(120, 1, 24, 7);
		for (let i = 50; i < 60; i++) y[i] = null;
		cases.push({ label: 'hourly-gap', args: [t, y, null, null, 0] });
	}
	// Quarter-hourly, three days, every 7th value missing (the Split/Filter null padding shape).
	{
		const { t, y } = rhythm(288, 0.25, 24, 11);
		for (let i = 3; i < y.length; i += 7) y[i] = null;
		cases.push({ label: 'quarter-hourly-scattered', args: [t, y, null, 30, 0] });
	}
	// Half-hourly with a gap, the lag step given explicitly (a binned column's binWidth), minLag.
	{
		const { t, y } = rhythm(192, 0.5, 12, 13);
		for (let i = 100; i < 130; i++) y[i] = null;
		cases.push({ label: 'half-hourly-gap-binsize-minlag', args: [t, y, 0.5, 40, 2] });
	}
	return cases;
}

async function sessionCases() {
	const { core, appConsts, pushObj } = await import('$lib/core/core.svelte.js');
	const { Column } = await import('$lib/core/Column.svelte');
	const { TableProcess } = await import('$lib/core/TableProcess.svelte');
	const { Plot } = await import('$lib/core/Plot.svelte');
	const { loadProcesses } = await import('$test/processRegistry.js');
	const { loadPlots } = await import('$test/plotRegistry.js');
	const { loadTableProcesses } = await import('$test/tableProcessRegistry.js');
	const { setWorkerFactory } = await import('$lib/workers/workerPool.js');
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
	setWorkerFactory(
		() =>
			new (class {
				postMessage() {
					throw new Error('force synchronous compute');
				}
				terminate() {}
			})()
	);

	const cases = [];
	let current = '';
	const seen = new Set();
	globalThis.__acfRecorder = (args) => {
		const key = JSON.stringify(args);
		if (seen.has(key)) return;
		seen.add(key);
		cases.push({ label: current, args: JSON.parse(key) });
	};

	for (const dir of SESSION_DIRS) {
		if (!existsSync(dir)) continue;
		for (const file of readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json')) {
			const session = JSON.parse(readFileSync(join(dir, file), 'utf8'));
			const sid = file.replace(/\.json$/, '');
			const tps = session.tableProcesses ?? [];
			const plots = (session.plots ?? []).filter((p) => p.type === 'correlogram');
			const rerun = tps.filter((tp) => ['RhythmicityAnalysis', 'MovingAnalysis'].includes(tp.name));
			if (!plots.length && !rerun.length) continue;

			core.data = [];
			core.plots = [];
			core.tableProcesses = [];
			core.groups = session.groups ?? [];
			core.storedValues = session.storedValues ?? {};
			core.rawData = new Map(Object.entries(session.rawData ?? {}).map(([k, v]) => [+k, v]));
			for (const cd of session.data ?? []) pushObj(Column.fromJSON(cd));
			for (const tpj of tps) core.tableProcesses.push(new TableProcess(tpj, null, tpj.id));
			for (const tp of core.tableProcesses) {
				try {
					await tp.doProcess();
				} catch {
					// a node that cannot run here records nothing
				}
			}
			for (const p of plots) {
				current = `${sid}:plot:${p.id}`;
				const plot = Plot.fromJSON(p);
				core.plots.push(plot);
				for (const s of plot.plot.data ?? []) void s.acfData;
			}
			for (const tpj of rerun) {
				current = `${sid}:${tpj.name}:${tpj.id}->correlogram`;
				const args = { ...structuredClone(tpj.args), analysis: 'correlogram', out: {} };
				try {
					await appConsts.tableProcessMap.get(tpj.name).func(args);
				} catch {
					// ditto
				}
			}
		}
	}
	globalThis.__acfRecorder = null;
	return cases;
}

function fixtureCases() {
	const fx = JSON.parse(readFileSync(join(ROOT, 'tools', 'parity', 'fixtures.json'), 'utf8'));
	const byId = Object.fromEntries(fx.fixtures.map((f) => [f.id, f]));
	const peak = byId['util-autocorrelation-peak'];
	const cases = [{ label: 'util-autocorrelation-peak', args: [peak.input.t, peak.input.y] }];
	// plot-correlogram-rhythm-noisy is a seeded generate spec; its realised arrays are in the
	// emitter's record, when there is one.
	const rec = join(ROOT, 'tools', 'parity', 'js_results.json');
	if (existsSync(rec)) {
		const r = JSON.parse(readFileSync(rec, 'utf8'));
		const res = Array.isArray(r) ? r : (r.results ?? r);
		const noisy = Array.isArray(res)
			? res.find((x) => x.id === 'plot-correlogram-rhythm-noisy')
			: res['plot-correlogram-rhythm-noisy'];
		if (noisy?.inputs?.t)
			cases.push({
				label: 'plot-correlogram-rhythm-noisy',
				args: [noisy.inputs.t.values, noisy.inputs.y.values, null, null, 0]
			});
	}
	return cases;
}

describe.runIf(process.env.GEN_ACF_GOLDEN)('generate the even-spacing golden', () => {
	it('records every call and its current output', async () => {
		const cases = [...(await sessionCases()), ...fixtureCases(), ...gappedCases()];
		for (const c of cases) c.out = JSON.parse(serial(computeAutocorrelation(...c.args)));
		writeFileSync(GOLDEN, JSON.stringify(cases) + '\n', 'utf8');
		console.log(`ACF GOLDEN: ${cases.length} calls -> ${GOLDEN}`);
	}, 600000);
});

describe.skipIf(process.env.GEN_ACF_GOLDEN)('computeAutocorrelation on evenly spaced data', () => {
	const golden = existsSync(GOLDEN) ? JSON.parse(readFileSync(GOLDEN, 'utf8')) : [];

	it('has the golden cases (sessions, fixtures and gapped series)', () => {
		const labels = golden.map((c) => c.label);
		expect(labels.some((l) => l.startsWith('demo-correlogram-rhythm:plot'))).toBe(true);
		expect(labels.some((l) => l.includes('RhythmicityAnalysis'))).toBe(true);
		expect(labels.some((l) => l.includes('MovingAnalysis'))).toBe(true);
		expect(labels).toContain('util-autocorrelation-peak');
		expect(labels).toContain('hourly-gap');
	});

	it('every result is byte-identical, except a time-pair lag 0 that was not 1', () => {
		const changed = [];
		const longer = [];
		const gappedLabels = new Set(gappedCases().map((g) => g.label));
		for (const c of golden) {
			let now = JSON.parse(serial(computeAutocorrelation(...c.args)));
			if (JSON.stringify(now) === JSON.stringify(c.out)) continue;
			// Permitted difference 2 (v81.11): the default lag window is half the recording SPAN,
			// not n / 2 steps. On evenly spaced, complete data the two agree; a series with
			// missing rows has fewer samples than its span implies, so its window may now be
			// LONGER. The lags it shared with the old window must not move.
			if (now.lags.length > c.out.lags.length) {
				expect(gappedLabels.has(c.label), `${c.label}: window grew on complete data`).toBe(true);
				expect(now.lags.slice(0, c.out.lags.length)).toEqual(c.out.lags);
				longer.push({ label: c.label, was: c.out.lags.length, now: now.lags.length });
				now = {
					...now,
					lags: now.lags.slice(0, c.out.lags.length),
					correlations: now.correlations.slice(0, c.out.lags.length)
				};
				if (JSON.stringify(now) === JSON.stringify(c.out)) continue;
			}
			// The other permitted difference: lag 0 is now exactly 1 by definition.
			const was = structuredClone(c.out);
			const i0 = was.lags.indexOf(0);
			expect(i0, `${c.label}: changed but has no lag 0`).toBeGreaterThanOrEqual(0);
			expect(was.correlations[i0], `${c.label}: lag 0 was already 1`).not.toBe(1);
			expect(now.correlations[i0]).toBe(1);
			was.correlations[i0] = 1;
			expect(JSON.stringify({ ...now, peakLag: 0, peakCorrelation: 0 })).toBe(
				JSON.stringify({ ...was, peakLag: 0, peakCorrelation: 0 })
			);
			// The peak ignores lag 0, so it cannot move either (a longer window can only move it
			// if the old window held no lobe; the gapped series' peaks sit well inside it).
			expect([now.peakLag, now.peakCorrelation]).toEqual([was.peakLag, was.peakCorrelation]);
			changed.push({ label: c.label, was: c.out.correlations[i0] });
		}
		// A gapped series (time-pair path) had lag 0 = 0: no non-self pair lies within half a
		// step of 0. Everywhere else (the index-shift path, every shipped session) lag 0 was
		// sum / (n * var), which is 1 up to rounding: at most a few ulp may move.
		for (const { label, was } of changed) {
			if (gappedLabels.has(label)) expect(was).toBe(0);
			else expect(Math.abs(was - 1)).toBeLessThan(1e-15);
		}
		// Recorded for the report: which calls moved at all.
		console.log('ACF even-spacing: lag 0 moved in', JSON.stringify(changed));
		// hourly-gap: 120 hourly rows less 10 missing, span 119 h. Its window was n / 2 = 55
		// steps and is now floor(119 / 2) = 59; the other two gapped cases set a max lag below
		// both caps, and no shipped session has missing rows on this path.
		expect(longer).toEqual([{ label: 'hourly-gap', was: 56, now: 60 }]);
	});
});
