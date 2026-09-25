// Seeded simulation of rhythmic and null time series for the paper benchmark.
// Pure JS, no dependencies. Time is in hours from 0.

/** mulberry32: the same seeded generator used by the AnCiR parity fixtures. */
export function mulberry32(seed) {
	let s = seed >>> 0;
	return () => {
		s |= 0;
		s = (s + 0x6d2b79f5) | 0;
		let v = Math.imul(s ^ (s >>> 15), 1 | s);
		v = (v + Math.imul(v ^ (v >>> 7), 61 | v)) ^ v;
		return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
	};
}

/** Standard normal via Box-Muller (one draw per call; simple and reproducible). */
export function normal(rng) {
	const u = Math.max(rng(), 1e-300);
	const v = rng();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Deterministic 32-bit seed from a list of integers (FNV-1a over their decimal strings). */
export function seedFrom(...parts) {
	let h = 0x811c9dc5;
	const s = parts.join('|');
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/**
 * Waveform with unit half-range (peak-to-trough = 2), evaluated at phase theta (radians).
 *  - 'cosine': cos(theta)
 *  - 'square': +1 for half the cycle, -1 for the other half (duty 0.5)
 *  - 'pulse' : +1 for 25% of the cycle, -1 otherwise (duty 0.25; activity-bout-like)
 */
export function waveform(kind, theta) {
	if (kind === 'cosine') return Math.cos(theta);
	const c = Math.cos(theta);
	if (kind === 'square') return c >= 0 ? 1 : -1;
	if (kind === 'pulse') return c >= Math.cos(Math.PI * 0.25) ? 1 : -1;
	throw new Error(`unknown waveform ${kind}`);
}

/**
 * Simulate one series.
 * @param {object} o
 * @param {number} o.seed
 * @param {number} o.days       record length (days)
 * @param {number} o.dt         sampling interval (h)
 * @param {number} o.tau        true period (h); ignored when amp = 0
 * @param {number} o.amp        amplitude A (noise SD is 1, so amp = A/sigma = SNR)
 * @param {string} [o.wave='cosine']
 * @param {string} [o.noise='white']  'white' or 'ar1'
 * @param {number} [o.ar1Phi=0.5]     AR(1) coefficient (marginal SD scaled to 1)
 * @param {string} [o.missing='none'] 'none' | 'random20' | 'gap25'
 * @param {number} [o.mesor=10]
 * @returns {{t:number[], y:number[], phi:number}}
 */
export function simulate(o) {
	const {
		seed,
		days,
		dt,
		tau,
		amp,
		wave = 'cosine',
		noise = 'white',
		ar1Phi = 0.5,
		missing = 'none',
		mesor = 10
	} = o;
	const rng = mulberry32(seed);
	const n = Math.round((days * 24) / dt);
	const phi = rng() * 2 * Math.PI;
	const t = new Array(n);
	const y = new Array(n);
	let e = normal(rng); // stationary start for AR(1)
	const innovSd = Math.sqrt(1 - ar1Phi * ar1Phi);
	for (let i = 0; i < n; i++) {
		const ti = i * dt;
		let eps;
		if (noise === 'white') eps = normal(rng);
		else if (noise === 'ar1') {
			if (i > 0) e = ar1Phi * e + innovSd * normal(rng);
			eps = e;
		} else throw new Error(`unknown noise ${noise}`);
		const sig = amp > 0 ? amp * waveform(wave, (2 * Math.PI * ti) / tau + phi) : 0;
		t[i] = ti;
		y[i] = mesor + sig + eps;
	}
	if (missing === 'none') return { t, y, phi };
	const keepT = [];
	const keepY = [];
	if (missing === 'random20') {
		for (let i = 0; i < n; i++) {
			if (rng() >= 0.2) {
				keepT.push(t[i]);
				keepY.push(y[i]);
			}
		}
	} else if (missing === 'gap25') {
		// One contiguous gap of 25% of the record, starting uniformly in [25%, 50%] of it.
		const T = n * dt;
		const g0 = T * (0.25 + 0.25 * rng());
		const g1 = g0 + 0.25 * T;
		for (let i = 0; i < n; i++) {
			if (t[i] < g0 || t[i] >= g1) {
				keepT.push(t[i]);
				keepY.push(y[i]);
			}
		}
	} else throw new Error(`unknown missing ${missing}`);
	return { t: keepT, y: keepY, phi };
}
