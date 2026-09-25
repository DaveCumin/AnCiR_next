// Engine-level scaling benchmark: ONE (method, N) measurement per process.
//
// Bundled by build-engine.mjs (esbuild, resolves $lib -> src/lib) into
// .cache/engine.bundle.mjs and spawned by run-engine.mjs as
//   node --expose-gc .cache/engine.bundle.mjs <method> <N> <reps>
// Prints a single JSON line on stdout.
//
// All computations call the app's own source modules unchanged (src/lib/...).
// Parameters mirror the app defaults (see comments per method, with file refs).

import Papa from 'papaparse';
import { runPeriodogramCalculation } from '$lib/utils/periodogram.js';
import { cosinorFitMany } from '$lib/utils/cosinor.worker-task.js';
import { computeFFT } from '$lib/utils/fft.js';
import { computeNPCRA } from '$lib/utils/npcra.js';
import { cwtFromSeries } from '$lib/utils/cwt.js';
import { smoothingApply } from '$lib/utils/smoothing.worker-task.js';
import { binData } from '$lib/components/plotbits/helpers/wrangleData.js';
import { guessDateofArray, getUNIXDate } from '$lib/utils/time/TimeUtils.js';
import { generateSeries, generateCsv, fmtDateTime, START_MS } from './gen-data.mjs';

const [, , method, nStr, repsStr] = process.argv;
const N = Number(nStr);
const REPS = Number(repsStr ?? 3);
// If a single repetition takes longer than this, stop after it (reported as reps=1).
const SINGLE_REP_CUTOFF_MS = 30_000;

// App's CSV import options (ImportData.svelte parseFile, ~l.1454):
const PAPA_OPTS = { header: true, dynamicTyping: true, skipEmptyLines: 'greedy' };

// Row-objects -> column-object, as ImportData.svelte convertArrayToObject (~l.1793).
function convertArrayToObject(rows, headers) {
	const out = {};
	headers.forEach((k) => (out[k] = []));
	rows.forEach((row) => {
		headers.forEach((h, idx) => {
			const val = Array.isArray(row) ? row[idx] : row[h];
			out[h].push(val ?? null);
		});
	});
	return out;
}

// ---------- per-method setup (untimed) and run (timed) ----------
function setup() {
	if (method === 'csv_parse_1' || method === 'csv_parse_10') {
		const nY = method === 'csv_parse_1' ? 1 : 10;
		const csv = generateCsv(N, { nY });
		return { csv, bytes: Buffer.byteLength(csv) };
	}
	if (method === 'time_guess' || method === 'time_parse' || method === 'bin_import_15min') {
		const { tHours, ys } = generateSeries(N);
		const strings = new Array(N);
		for (let i = 0; i < N; i++) strings[i] = fmtDateTime(START_MS + tHours[i] * 3600000);
		const fmt = guessDateofArray(strings.slice(0, 1000));
		return { strings, fmt, y: Array.from(ys[0]) };
	}
	const { tHours, ys } = generateSeries(N);
	return { t: Array.from(tHours), y: Array.from(ys[0]) };
}

function run(d) {
	switch (method) {
		case 'csv_parse_1':
		case 'csv_parse_10': {
			const res = Papa.parse(d.csv, PAPA_OPTS);
			const cols = convertArrayToObject(res.data, res.meta.fields);
			return { rows: cols[res.meta.fields[0]].length, bytes: d.bytes };
		}
		case 'time_guess': {
			// Column type detection on import: guessDateofArray over the column
			// (ImportData.svelte doBasicFileImport ~l.2150; TimeUtils.js:99).
			const fmt = guessDateofArray(d.strings);
			return { fmt: String(fmt) };
		}
		case 'time_parse': {
			// Column.getData() for a 'time' column: every cell -> epoch ms via
			// getUNIXDate (strict dayjs parse). Column.svelte ~l.544.
			const out = d.strings.map((x) => (x == null || x === '' ? null : Number(getUNIXDate(x, d.fmt))));
			return { first: out[0], last: out[out.length - 1] };
		}
		case 'bin_import_15min': {
			// Import-time binning (ImportData.svelte binParsedData ~l.2308):
			// parse every time string, convert to hours, then binData(mean, 15 min).
			const ms = d.strings.map((x) => Number(getUNIXDate(x, d.fmt)));
			const h = ms.map((v) => (v - ms[0]) / 3600000);
			const b = binData(h, d.y, 0.25, 0, 0.25, 'mean');
			return { bins: b.bins.length };
		}
		case 'bin_numeric_15min': {
			// Binning alone on an already-numeric hour axis (Binned Data table process / periodogram pre-binning).
			const b = binData(d.t, d.y, 0.25, 0, 0.25, 'mean');
			return { bins: b.bins.length };
		}
		case 'lomb_scargle':
		case 'chi_squared':
		case 'enright': {
			// Periodogram plot defaults: periodlimsIN [1,30], periodSteps 0.25, binSize 0.25,
			// chiSquaredAlpha 0.05 (plots/Periodogram/Periodogram.svelte l.80-81, 456-457).
			const m = { lomb_scargle: 'Lomb-Scargle', chi_squared: 'Chi-squared', enright: 'Enright' }[method];
			const r = runPeriodogramCalculation({
				xData: d.t,
				yData: d.y,
				method: m,
				periodMin: 1,
				periodMax: 30,
				periodSteps: 0.25,
				binSize: 0.25,
				chiSquaredAlpha: 0.05
			});
			let best = 0;
			for (let i = 1; i < r.y.length; i++) if (r.y[i] > r.y[best]) best = i;
			return { nPeriods: r.x.length, peak: r.x[best] };
		}
		case 'cosinor_free': {
			// Cosinor table process, free period, 1 component (tableProcesses/Cosinor.svelte l.133-164).
			const { results } = cosinorFitMany({ t: d.t, ys: [d.y], Ncurves: 1, useFixedPeriod: false });
			const c = results[0]?.parameters?.cosines?.[0];
			return { period: c ? (2 * Math.PI) / c.frequency : null };
		}
		case 'cosinor_fixed': {
			const { results } = cosinorFitMany({
				t: d.t,
				ys: [d.y],
				useFixedPeriod: true,
				fixedPeriod: 24,
				nHarmonics: 1
			});
			return { valid: results[0]?.valid ?? null };
		}
		case 'fft': {
			// FFT plot default freqStep 0.0001 cycles/h (plots/FFT/FFT.svelte l.150).
			const r = computeFFT(d.t, d.y, 0.0001);
			return { nFreq: r.frequencies.length };
		}
		case 'fft_auto': {
			// FFT with freqStep = null ("auto": pad to next power of two of N).
			const r = computeFFT(d.t, d.y, null);
			return { nFreq: r.frequencies.length };
		}
		case 'smooth_whittaker': {
			// Smooth Data default: Whittaker, lambda 100, order 2 (tableProcesses/SmoothedData.svelte l.18-20).
			const { results } = smoothingApply({
				xs: [d.t],
				ys: [d.y],
				smootherType: 'whittaker',
				options: { whittakerLambda: 100, whittakerOrder: 2 }
			});
			return { len: results[0].length };
		}
		case 'npcra': {
			// NPCRA defaults: epoch 1 h, period 24, M10/L5 (tableProcesses/NonparametricRA.svelte l.23-26).
			const r = computeNPCRA(d.t, d.y, { epochHours: 1, period: 24, mWindow: 10, lWindow: 5 });
			return { IS: r?.IS ?? null };
		}
		case 'cwt': {
			// CWT plot defaults: morlet, omega0 6, dj 0.125, rectify, periods 1-48 h (plots/CWT/CWT.svelte l.73-79).
			const r = cwtFromSeries(d.t, d.y, {
				wavelet: 'morlet',
				param: 6,
				dj: 0.125,
				rectify: true,
				periodRange: [1, 48]
			});
			return { valid: r.valid, nScales: r.nScales, reason: r.reason || undefined };
		}
		default:
			throw new Error('unknown method ' + method);
	}
}

const mb = (b) => Math.round((b / 1048576) * 10) / 10;

try {
	const data = setup();
	global.gc?.();
	const heapBase = process.memoryUsage().heapUsed;
	const times = [];
	let info = null;
	let heapAfter = 0;
	for (let r = 0; r < REPS; r++) {
		global.gc?.();
		const t0 = performance.now();
		const out = run(data);
		const dt = performance.now() - t0;
		times.push(dt);
		heapAfter = Math.max(heapAfter, process.memoryUsage().heapUsed);
		info = out;
		if (dt > SINGLE_REP_CUTOFF_MS) break;
	}
	const sorted = [...times].sort((a, b) => a - b);
	const median = sorted[Math.floor(sorted.length / 2)];
	const ru = process.resourceUsage();
	console.log(
		JSON.stringify({
			ok: true,
			method,
			N,
			reps: times.length,
			times_ms: times.map((t) => Math.round(t * 10) / 10),
			median_ms: Math.round(median * 10) / 10,
			min_ms: Math.round(sorted[0] * 10) / 10,
			heap_base_mb: mb(heapBase),
			heap_after_max_mb: mb(heapAfter),
			// Peak resident set size of the whole process (includes the input data
			// and the generator). ru.maxRSS is in KiB on macOS/Linux.
			max_rss_mb: Math.round(ru.maxRSS / 1024),
			info
		})
	);
} catch (e) {
	console.log(JSON.stringify({ ok: false, method, N, error: String(e?.stack ?? e).slice(0, 600) }));
	process.exitCode = 0;
}
