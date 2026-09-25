// Seeded synthetic chronobiology data for the scaling benchmarks.
//
// Signal: 1-min sampling (default), activity = 50 + 40*cos(2*pi*(t - 14)/24) + N(0, 10).
// Deterministic for a given (n, seed). Used by both the Node engine benchmark and
// the browser end-to-end benchmark so they see the same data.

export const START_MS = Date.UTC(2024, 0, 1, 0, 0, 0);

/** mulberry32 PRNG. */
export function mulberry32(seed) {
	let a = seed >>> 0;
	return function () {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Box-Muller normal generator on top of a uniform PRNG. */
export function normalGen(rand) {
	let spare = null;
	return function () {
		if (spare !== null) {
			const s = spare;
			spare = null;
			return s;
		}
		let u = 0;
		while (u === 0) u = rand();
		const v = rand();
		const r = Math.sqrt(-2 * Math.log(u));
		spare = r * Math.sin(2 * Math.PI * v);
		return r * Math.cos(2 * Math.PI * v);
	};
}

/**
 * Generate n samples. Returns { tHours: Float64Array, ys: Float64Array[] }.
 * nY series share the same time base; each series has its own noise and a
 * slightly different phase so they are not identical.
 */
export function generateSeries(n, { nY = 1, stepMin = 1, period = 24, seed = 12345 } = {}) {
	const rand = mulberry32(seed);
	const norm = normalGen(rand);
	const tHours = new Float64Array(n);
	const stepH = stepMin / 60;
	for (let i = 0; i < n; i++) tHours[i] = i * stepH;
	const ys = [];
	for (let k = 0; k < nY; k++) {
		const y = new Float64Array(n);
		const phase = 14 + k * 0.5;
		for (let i = 0; i < n; i++) {
			y[i] = 50 + 40 * Math.cos((2 * Math.PI * (tHours[i] - phase)) / period) + 10 * norm();
		}
		ys.push(y);
	}
	return { tHours, ys };
}

const pad = (v) => (v < 10 ? '0' + v : '' + v);
/** "YYYY-MM-DD HH:mm:ss" in UTC. */
export function fmtDateTime(ms) {
	const d = new Date(ms);
	return (
		d.getUTCFullYear() +
		'-' +
		pad(d.getUTCMonth() + 1) +
		'-' +
		pad(d.getUTCDate()) +
		' ' +
		pad(d.getUTCHours()) +
		':' +
		pad(d.getUTCMinutes()) +
		':' +
		pad(d.getUTCSeconds())
	);
}

/**
 * Build a CSV string: header "DateTime,activity[,activity2...]" then n rows.
 * Values written with 3 decimals (typical logger precision).
 */
export function generateCsv(n, { nY = 1, stepMin = 1, seed = 12345 } = {}) {
	const { tHours, ys } = generateSeries(n, { nY, stepMin, seed });
	const header = ['DateTime', ...ys.map((_, k) => (k === 0 ? 'activity' : `activity${k + 1}`))];
	const parts = new Array(n + 1);
	parts[0] = header.join(',');
	for (let i = 0; i < n; i++) {
		let row = fmtDateTime(START_MS + tHours[i] * 3600000);
		for (let k = 0; k < nY; k++) row += ',' + ys[k][i].toFixed(3);
		parts[i + 1] = row;
	}
	return parts.join('\n') + '\n';
}
