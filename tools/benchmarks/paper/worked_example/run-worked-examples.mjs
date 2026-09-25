// Re-run the manuscript's worked example + validations with the CURRENT AnCiR engine.
//
// How it works (no repo source is modified):
//   1. The ORIGINAL session JSON is served to the running `vite dev` app (default
//      http://localhost:5173/) via Playwright request interception and loaded with the app's
//      own `?loadFromURL=` path, so the old-session back-compat loaders run exactly as for a user.
//   2. After the session settles we read what the app itself reports (plot peaks, actogram
//      phase-marker regressions, cosinor output ports) from the dev-only `window.__core`.
//   3. On the SAME column arrays the plots consume (`hoursSinceStart` / `getData()`), we call
//      the engine functions the nodes use (runPeriodogramCalculation, computeFFT,
//      cosinorFitMany / fitCosinorFixed), imported from the dev server so they are the
//      repo's current source, and add an automatic onset phase marker to the actogram.
//
// Usage:  node tools/benchmarks/paper/worked_example/run-worked-examples.mjs [baseURL]
// Output: tools/benchmarks/paper/results/worked_example/<name>.json
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIGS } from './configs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../results/worked_example');
fs.mkdirSync(outDir, { recursive: true });
const base = process.argv[2] ?? 'http://localhost:5173/';
const only = process.env.ONLY;

const browser = await chromium.launch();
for (const cfg of CONFIGS) {
	if (only && cfg.name !== only) continue;
	console.log('==', cfg.name);
	const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
	await page.route('http://session.local/**', (r) =>
		r.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: fs.readFileSync(cfg.session)
		})
	);
	await page.goto(base + '?loadFromURL=' + encodeURIComponent('http://session.local/s.json'));
	await page.waitForFunction(() => window.__core && window.__core.plots.length > 0, null, {
		timeout: 120000
	});
	// Let debounced plot calculations / workers finish.
	await page.waitForFunction(
		() =>
			window.__core.plots
				.filter((p) => p.type === 'periodogram' || p.type === 'fft')
				.every((p) => p.plot.data.every((d) => d.peak)),
		null,
		{ timeout: 180000 }
	);
	await page.waitForTimeout(3000);
	const res = await page.evaluate(analyse, cfg);
	res.config = cfg;
	res.appVersion = await page.evaluate(() => document.title);
	fs.writeFileSync(path.join(outDir, cfg.name + '.json'), JSON.stringify(res, null, 1));
	console.log(JSON.stringify(res.summary, null, 1));
	await page.close();
}
await browser.close();

// --------------------------------------------------------------------------------------
// Runs inside the page.
async function analyse(cfg) {
	const core = window.__core;
	const pg = await import('/src/lib/utils/periodogram.js');
	const fftm = await import('/src/lib/utils/fft.js');
	const cos = await import('/src/lib/utils/cosinor.js');
	const cosTask = await import('/src/lib/utils/cosinor.worker-task.js');
	const clone = (o) => JSON.parse(JSON.stringify(o ?? null));
	const col = (id) => core.data.find((d) => d.id === id);
	const argMaxIn = (x, y, lo, hi) => {
		let bi = -1;
		for (let i = 0; i < x.length; i++)
			if (x[i] >= lo && x[i] <= hi && Number.isFinite(y[i]) && (bi < 0 || y[i] > y[bi])) bi = i;
		return bi;
	};

	// ---- 1. What the loaded session reports, as-is -------------------------------------
	// Plots may recalculate after load (debounced); wait until every spectrum has a peak.
	for (let k = 0; k < 240; k++) {
		const ready = core.plots
			.filter((p) => p.type === 'periodogram' || p.type === 'fft')
			.every((p) => p.plot.data.every((d) => d.peak && d.visiblePeak));
		if (ready) break;
		await new Promise((r) => setTimeout(r, 500));
	}
	const app = { plots: [], tableProcesses: [] };
	for (const p of core.plots) {
		const e = { name: p.name, type: p.type, series: [] };
		if (p.type === 'periodogram')
			Object.assign(e, { periodlimsIN: clone(p.plot.periodlimsIN), periodSteps: p.plot.periodSteps });
		if (p.type === 'fft') e.xlimsIN = clone(p.plot.xlimsIN ?? p.plot.freqlimsIN);
		if (p.type === 'actogram') Object.assign(e, { periodHrs: p.plot.periodHrs });
		for (const d of p.plot.data ?? []) {
			const s = { x: d.x?.refId, y: d.y?.refId, yName: col(d.y?.refId)?.name };
			if (p.type === 'periodogram')
				Object.assign(s, {
					method: d.method,
					binSize: d.binSize,
					alpha: d.chiSquaredAlpha,
					peak: clone(d.peak),
					visiblePeak: clone(d.visiblePeak)
				});
			if (p.type === 'fft')
				Object.assign(s, { freqStep: d.freqStep, peak: clone(d.peak), visiblePeak: clone(d.visiblePeak) });
			if (p.type === 'actogram') {
				s.binSize = d.binSize;
				s.markers = (d.phaseMarkers ?? []).map((m) => ({
					type: m.type,
					selectedDays: (m.selectedPeriods ?? [])
						.map((v, i) => (v ? i + 1 : null))
						.filter((v) => v != null && Number.isFinite(m.markers?.[v - 1])),
					markers: clone(m.markers),
					regression: clone(m.linearRegression)
				}));
			}
			e.series.push(s);
		}
		app.plots.push(e);
	}
	for (const tp of core.tableProcesses ?? []) {
		const e = { id: tp.id, name: tp.name, args: clone(tp.args) };
		if (tp.name === 'Cosinor') {
			e.outputs = {};
			for (const [k, id] of Object.entries(tp.args.out ?? {})) {
				const c = col(id);
				if (c && c.getData()?.length === 1) e.outputs[k] = c.getData()[0];
			}
		}
		app.tableProcesses.push(e);
	}

	// ---- 2. Every method on the same arrays ----------------------------------------------
	const series = [];
	for (const s of cfg.series) {
		const xc = col(s.x), yc = col(s.y);
		const tAll = xc.hoursSinceStart ?? xc.getData();
		const yAll = yc.getData();
		const ok = [];
		for (let i = 0; i < tAll.length; i++)
			if (tAll[i] != null && yAll[i] != null && Number.isFinite(tAll[i]) && Number.isFinite(yAll[i])) ok.push(i);
		const t = ok.map((i) => tAll[i]), y = ok.map((i) => yAll[i]);
		const dts = t.slice(1).map((v, i) => v - t[i]).sort((a, b) => a - b);
		const out = {
			label: s.label,
			x: s.x,
			y: s.y,
			xName: xc.name,
			yName: yc.name,
			n: t.length,
			tStart_h: t[0],
			tEnd_h: t[t.length - 1],
			span_h: t[t.length - 1] - t[0],
			medianDt_h: dts[Math.floor(dts.length / 2)],
			firstTimeISO: xc.type === 'time' ? new Date(xc.getData()[ok[0]]).toISOString() : null,
			lastTimeISO: xc.type === 'time' ? new Date(xc.getData()[ok[ok.length - 1]]).toISOString() : null,
			periodograms: [],
			fft: null,
			cosinor: null
		};
		const [lo, hi] = s.range;
		for (const grid of s.grids) {
			for (const method of ['Lomb-Scargle', 'Chi-squared', 'Enright']) {
				// grid.appCalcRange reproduces the Periodogram plot's buffered calc range
				// (calcMin = max(0.01, min - 0.25*span)), so the trial-period lattice is the
				// one the plot actually evaluates at this step.
				const span = hi - lo;
				const pMin = grid.appCalcRange ? Math.max(0.01, lo - 0.25 * span) : lo;
				const pMax = grid.appCalcRange ? hi + 0.25 * span : hi;
				const r = pg.runPeriodogramCalculation({
					xData: tAll,
					yData: yAll,
					binSize: grid.binSize,
					method,
					chiSquaredAlpha: 0.05,
					periodMin: pMin,
					periodMax: pMax,
					periodSteps: grid.step
				});
				const i = argMaxIn(r.x, r.y, lo, hi);
				// Chi-squared / Enright fold the data into round(P/binSize) columns, so trial
				// periods that round to the same column count share one power: report the tie.
				const tied = r.x.filter((v, k) => v >= lo && v <= hi && Math.abs(r.y[k] - r.y[i]) <= 1e-9 * Math.abs(r.y[i]));
				out.periodograms.push({
					tiedPeakRange: [Math.min(...tied), Math.max(...tied)],
					foldColumns: method === 'Lomb-Scargle' ? null : Math.round(r.x[i] / grid.binSize),
					foldPeriod: method === 'Lomb-Scargle' ? null : Math.round(r.x[i] / grid.binSize) * grid.binSize,
					method,
					grid: `${lo}-${hi} h, step ${grid.step} h${grid.appCalcRange ? ' (plot lattice from ' + pMin.toFixed(2) + ')' : ''}`,
					binSize: method === 'Lomb-Scargle' ? null : grid.binSize,
					peakPeriod: r.x[i],
					peakPower: r.y[i],
					threshold: Number.isFinite(r.threshold[i]) ? r.threshold[i] : null,
					pvalue: Number.isFinite(r.pvalue[i]) ? r.pvalue[i] : null,
					df: Number.isFinite(r.df?.[i]) ? r.df[i] : null,
					aboveThreshold: Number.isFinite(r.threshold[i]) ? r.y[i] > r.threshold[i] : null
				});
			}
		}
		// FFT (as the FFT plot: computeFFT with freqStep, peak = max magnitude in range).
		const f = fftm.computeFFT(tAll, yAll, s.fftFreqStep ?? 0.0001);
		const per = f.frequencies.map((v) => 1 / v);
		const fi = argMaxIn(per, f.magnitudes, lo, hi);
		const fiAll = argMaxIn(per, f.magnitudes, 0, Infinity);
		out.fft = {
			freqStep: s.fftFreqStep ?? 0.0001,
			nFreq: f.frequencies.length,
			freqResolution: f.frequencies[1] - f.frequencies[0],
			peakPeriodInRange: per[fi],
			peakFrequency: f.frequencies[fi],
			peakMagnitude: f.magnitudes[fi],
			neighbourPeriods: [per[fi - 1], per[fi + 1]],
			overallPeakPeriod: per[fiAll]
		};
		// Cosinor, free period (the Cosinor node with useFixedPeriod=false, Ncurves=1).
		const free = cosTask.cosinorFitMany({ t, ys: [y], Ncurves: 1, useFixedPeriod: false }).results[0];
		const c0 = free?.parameters?.cosines?.[0];
		const freePeriod = c0 ? (2 * Math.PI) / Math.abs(c0.frequency) : null;
		// Zero-amplitude F-test at the fitted period (fitCosinorFixed = the node's fixed-period fit).
		const fx = freePeriod ? cos.fitCosinorFixed(t, y, freePeriod, 1, 0.05) : null;
		out.cosinor = {
			freePeriod,
			amplitude: c0 ? Math.abs(c0.amplitude) : null,
			mesor: free?.parameters?.O ?? null,
			rSquared: free?.rSquared ?? null,
			rmse: free?.rmse ?? null,
			fixedAtFreePeriod: fx
				? { R2: fx.R2, F: fx.F ?? fx.F_stat, pF: fx.pF, amplitude: fx.harmonics?.[0]?.amplitude, keys: Object.keys(fx) }
				: null
		};
		series.push(out);
	}

	// ---- 3. Actogram automatic onset (template) phase marker -----------------------------
	const acto = [];
	for (const a of cfg.actogram ?? []) {
		const p = core.plots.find((pp) => pp.type === 'actogram' && pp.name === a.plot);
		const d = p.plot.data[a.series];
		const Cls = (d.phaseMarkers[0] ?? core.plots.flatMap((pp) => pp.plot.data ?? []).flatMap((dd) => dd.phaseMarkers ?? [])[0])?.constructor
			?? (await import('/src/lib/plots/Actogram/PhaseMarker.svelte')).PhaseMarkerClass;
		const origPeriod = p.plot.periodHrs;
		if (a.periodHrs) p.plot.periodHrs = a.periodHrs;
		const m = new Cls(d, { type: a.type ?? 'onset' }); // app defaults: centile 50, 3 h before/after
		d.phaseMarkers.push(m);
		await new Promise((r) => setTimeout(r, 500));
		const markers = clone(m.markers);
		const result = {
			label: a.label,
			plot: a.plot,
			series: a.series,
			yName: col(d.y.refId)?.name,
			periodHrs: p.plot.periodHrs,
			binSize: d.binSize,
			centileThreshold: m.centileThreshold,
			templateHrsBefore: m.templateHrsBefore,
			templateHrsAfter: m.templateHrsAfter,
			markers,
			fits: []
		};
		for (const sel of a.daySets) {
			const days = markers.map((v, i) => i + 1).filter((dd) => Number.isFinite(markers[dd - 1]) && (!sel.days || (dd >= sel.days[0] && dd <= sel.days[1])));
			m.selectedPeriods = markers.map((v, i) => days.includes(i + 1));
			await new Promise((r) => setTimeout(r, 50));
			result.fits.push({ label: sel.label, daysUsed: days, regression: clone(m.linearRegression) });
		}
		d.phaseMarkers.splice(d.phaseMarkers.indexOf(m), 1);
		p.plot.periodHrs = origPeriod;
		acto.push(result);
	}

	// ---- summary --------------------------------------------------------------------------
	const summary = {};
	for (const s of series) {
		summary[s.label] = {
			n: s.n,
			span_h: +s.span_h.toFixed(3),
			cosinorFree: s.cosinor.freePeriod,
			cosinorP: s.cosinor.fixedAtFreePeriod?.pF,
			fft: s.fft.peakPeriodInRange,
			pgrams: s.periodograms.map((q) => `${q.method} [${q.grid}${q.binSize ? ', bin ' + q.binSize : ''}] ${q.peakPeriod?.toFixed(3)} tie[${q.tiedPeakRange.map((v) => v.toFixed(2))}]${q.foldPeriod ? ' fold=' + q.foldPeriod.toFixed(3) : ''} p=${q.pvalue} thr=${q.threshold?.toFixed(1)} pow=${q.peakPower?.toFixed(1)}`)
		};
	}
	for (const a of acto) summary['onset:' + a.label] = a.fits.map((f) => `${f.label}: slope ${f.regression?.slope} R2 ${f.regression?.rSquared} n ${f.daysUsed.length}`).concat([JSON.stringify(a.markers.map((v) => (v == null ? null : +v.toFixed(2))))]);
	summary.app = app.plots.map((p) => `${p.name}: ` + p.series.map((s) => JSON.stringify(s.visiblePeak ?? s.markers?.map((m) => m.regression?.slope) ?? '')).join(' | '));
	return { app, series, actogramOnset: acto, summary };
}
