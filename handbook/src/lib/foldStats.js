// Small, dependency-free versions of the three periodogram statistics, written
// for the handbook's FoldedPeriodogramAnim. They follow AnCiR's own definitions
// (src/lib/utils/periodogram.js) so the animation shows the numbers the app
// reports:
//
//   Lomb-Scargle  the least-squares fit of ONE sinusoid, a cos(wt) + b sin(wt),
//                 to the mean-subtracted values. AnCiR reports
//                 power = SS_fit / (2 s^2) with s^2 = SS_tot / (N - 1), which is
//                 (N - 1) / 2 x R^2, R^2 = SS_fit / SS_tot. The tau offset in the
//                 classical formula only makes the cosine and sine bases
//                 orthogonal; it spans the same pair of functions, so the fit
//                 (and R^2) is the same regression solved here directly.
//   Chi-squared   Sokolove-Bushell Qp in AnCiR's occupancy-weighted form:
//                 Qp = N x sum_h K_h (M_h - Ybar)^2 / sum_i (y_i - Ybar)^2 over
//                 occupied bins, df = occupied bins - 1. Qp / N is the share of
//                 the variance the bin means explain.
//   Enright       A_p = sqrt( sum_h (M_h - Mbar)^2 / P' ), the RMS spread of the
//                 P' occupied column means about their own mean (Legendre and
//                 Legendre, Numerical Ecology 2nd ed., section 12.4.1, eq. 12.12).
//
// The binned statistics fold exactly as AnCiR does: the series is cut into
// bins of binSize from an origin on the bin grid (floor(min t / binSize) x
// binSize, as binOrigin), and folded into nBins = round(T / binSize) columns,
// column = bin index mod nBins. The animation only asks for trial periods that
// are whole multiples of the sampling interval, with one sample per bin, so
// each bin mean here is the binned value AnCiR folds and the statistics equal
// the app's at every plotted period.

/** Positive remainder of t / T. */
export function phaseOf(t, T) {
	const r = t % T;
	return r < 0 ? r + T : r;
}

/**
 * Least-squares fit of y - mean(y) = a cos(2 pi t / T) + b sin(2 pi t / T).
 * @param {number[]} t
 * @param {number[]} y
 * @param {number} T trial period
 */
export function cosineFit(t, y, T) {
	const n = t.length;
	let mean = 0;
	for (let i = 0; i < n; i++) mean += y[i];
	mean /= n || 1;
	const w = (2 * Math.PI) / T;
	let scc = 0,
		sss = 0,
		scs = 0,
		syc = 0,
		sys = 0,
		ssTot = 0;
	for (let i = 0; i < n; i++) {
		const c = Math.cos(w * t[i]);
		const s = Math.sin(w * t[i]);
		const d = y[i] - mean;
		scc += c * c;
		sss += s * s;
		scs += c * s;
		syc += d * c;
		sys += d * s;
		ssTot += d * d;
	}
	const det = scc * sss - scs * scs;
	if (n < 3 || !(det > 1e-12) || !(ssTot > 0)) return { mean, a: 0, b: 0, r2: 0, power: 0 };
	const a = (syc * sss - sys * scs) / det;
	const b = (sys * scc - syc * scs) / det;
	const r2 = (a * syc + b * sys) / ssTot;
	return { mean, a, b, r2, power: ((n - 1) / 2) * r2 };
}

/**
 * The median of the positive gaps between consecutive sorted times: the
 * sampling interval (as AnCiR's medianSamplingInterval). NaN with fewer than two
 * distinct times.
 * @param {number[]} t
 */
export function medianSpacing(t) {
	const xs = [...t].sort((a, b) => a - b);
	const gaps = [];
	for (let i = 1; i < xs.length; i++) if (xs[i] > xs[i - 1]) gaps.push(xs[i] - xs[i - 1]);
	if (!gaps.length) return NaN;
	gaps.sort((a, b) => a - b);
	const mid = Math.floor(gaps.length / 2);
	return gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
}

/**
 * Trial periods from pMin to pMax in steps of dt, each a whole multiple of dt
 * (n x dt for every integer n with pMin <= n dt <= pMax), so every period is a
 * whole number of bins of width dt: the folds AnCiR's binned methods test.
 * @param {number} pMin
 * @param {number} pMax
 * @param {number} dt
 */
export function periodGrid(pMin, pMax, dt) {
	const eps = 1e-9;
	const out = [];
	for (let k = Math.ceil(pMin / dt - eps); k * dt <= pMax + eps; k++) {
		out.push(Math.round(k * dt * 1e9) / 1e9);
	}
	return out;
}

/**
 * Fold at trial period T into nBins = round(T / binSize) columns of binSize
 * (AnCiR's fold: column = bin index mod nBins) and summarise the column means
 * two ways (chi-squared Qp and Enright A_p). With the bin origin at 0, column h
 * holds phases [h binSize, (h + 1) binSize) of the trial cycle.
 * @param {number[]} t
 * @param {number[]} y
 * @param {number} T
 * @param {number} binSize
 */
export function binFold(t, y, T, binSize) {
	const n = t.length;
	const nBins = Math.max(1, Math.round(T / binSize));
	let tMin = Infinity;
	for (let i = 0; i < n; i++) if (t[i] < tMin) tMin = t[i];
	const origin = Math.floor(tMin / binSize) * binSize;
	const sums = new Array(nBins).fill(0);
	const counts = new Array(nBins).fill(0);
	let grand = 0;
	for (let i = 0; i < n; i++) grand += y[i];
	grand /= n || 1;
	let ssTot = 0;
	for (let i = 0; i < n; i++) {
		const bin = Math.floor((t[i] - origin) / binSize + 1e-9);
		const h = bin % nBins;
		sums[h] += y[i];
		counts[h]++;
		ssTot += (y[i] - grand) ** 2;
	}
	const means = sums.map((s, h) => (counts[h] ? s / counts[h] : NaN));
	const occupied = means.filter((m) => Number.isFinite(m));
	let between = 0;
	for (let h = 0; h < nBins; h++) if (counts[h]) between += counts[h] * (means[h] - grand) ** 2;
	const mBar = occupied.reduce((a, m) => a + m, 0) / (occupied.length || 1);
	const ap = Math.sqrt(occupied.reduce((a, m) => a + (m - mBar) ** 2, 0) / (occupied.length || 1));
	const ok = occupied.length >= 2 && ssTot > 0;
	return {
		nBins,
		width: binSize,
		means,
		counts,
		grand,
		df: occupied.length - 1,
		// Share of the variance the bin means explain (the correlation ratio).
		eta2: ok ? between / ssTot : NaN,
		qp: ok ? (n * between) / ssTot : NaN,
		ap: ok ? ap : NaN,
		// A_p squared over the variance of the data (divisor N): the same share of
		// variance as eta2 when every bin holds the same number of points.
		apShare: ok ? (ap * ap) / (ssTot / n) : NaN
	};
}

/**
 * The animation's synthetic record: hourly samples over `days` days of an
 * activity-like rhythm with period `period`, seeded so every reader sees the
 * same data. `shape` 'sine' is a smooth daily wave; 'bout' is a narrow burst of
 * activity (a few hours wide) on a low baseline, a strongly non-sinusoidal
 * shape. The same noise draws are used for both, and values are clipped at 0
 * like counts.
 * @param {() => number} rng uniform [0, 1) generator
 */
export function makeRecord(rng, { days = 8, period = 24, dt = 1 } = {}) {
	const n = Math.round((days * 24) / dt);
	const t = Array.from({ length: n }, (_, i) => i * dt);
	const noise = t.map(() => {
		let u = 0;
		while (!u) u = rng();
		const v = rng();
		return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
	});
	const w = (2 * Math.PI) / period;
	const peak = 15; // hours into each cycle
	const sine = t.map((x, i) => Math.max(0, 40 + 22 * Math.cos(w * (x - peak)) + 10 * noise[i]));
	// von Mises bump, about 4 h wide at half height
	const bout = t.map((x, i) =>
		Math.max(0, 14 + 72 * Math.exp(9 * (Math.cos(w * (x - peak)) - 1)) + 9 * noise[i])
	);
	return { t, sine, bout };
}
