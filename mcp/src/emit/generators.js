// Pure ports of AnCiR's data GENERATORS, for the normalizer to bake outputs at emit time.
//
// Why bake at all: an analysis only recomputes on load when its INPUTS already hold data.
// A generator→analysis chain where the generator's output is left empty leaves the analysis
// stale (the GUI regenerates the generator, but the downstream analysis has already run
// against empty inputs and doesn't re-fire). See ADR 2026-07-15-static-session-emission.
//
// Why a port and not an import: the real generator lives inside a .svelte module and writes
// straight into `core`, so it can't be imported by a pure/portable normalizer. The pure part
// is small, so we port it EXACTLY — same PRNG, same loop, same rounding — and guard against
// drift with a parity test (generators.parity.test.js) that runs BOTH this port and AnCiR's
// real `simulateddata()` and asserts identical output. Do not "improve" the maths here; if
// the upstream algorithm changes, the parity test fails and this file must follow it.

import minstd from '@stdlib/random-base-minstd-shuffle';
import uniform from '@stdlib/random-base-uniform';
import normal from '@stdlib/random-base-normal';
import exponential from '@stdlib/random-base-exponential';

const MINSTD_MAX = 2147483646;

// NB SimulatedData and Random normalise their seed DIFFERENTLY, so they get one helper each.
// Do not "unify" them — the parity tests will fail, and the numbers would silently change.

/** SimulatedData.svelte's normalizeSeed: 0/NaN → 12345. */
export function normalizeSeed(seed) {
	const n = Math.trunc(Number(seed));
	if (!Number.isFinite(n) || n === 0) return 12345;
	return ((((n - 1) % MINSTD_MAX) + MINSTD_MAX) % MINSTD_MAX) + 1;
}

/** Random.svelte's normalizeSeed: NaN → 1, and 0 is NOT special-cased (0 → MINSTD_MAX). */
function normalizeSeedRandom(seed) {
	const n = Math.trunc(Number(seed));
	if (!Number.isFinite(n)) return 1;
	return ((((n - 1) % MINSTD_MAX) + MINSTD_MAX) % MINSTD_MAX) + 1;
}

/**
 * Port of SimulatedData's `simulateddata(args)` (the pure part, minus the core writes).
 * NB the rhythm is a SQUARE wave — high for the first half of each period, 1 for the rest —
 * not a cosine. Noise is drawn from one seeded stream in section → sample order.
 *
 * @param {{startTime:*, seed:*, samplingPeriod_hours:*, sections:Array}} args
 * @returns {{time:string[], values:number[]}}
 */
export function simulatedData(args) {
	// A missing/invalid startTime would throw "Invalid time value"; a non-positive sampling
	// period would loop forever. Mirror the upstream guards exactly.
	const startMs = (() => {
		const t = new Date(args.startTime ?? NaN).getTime();
		return Number.isFinite(t) ? t : Date.now(); // upstream uses dayjs.utc().valueOf()
	})();
	const step = Number(args.samplingPeriod_hours) > 0 ? Number(args.samplingPeriod_hours) : null;

	const prng = minstd.factory({ seed: normalizeSeed(args.seed) });
	const nextNoise = () => prng.normalized(); // uniform in [0, 1)

	const time = [];
	const values = [];
	let currentTime = 0;

	for (const section of step && Array.isArray(args.sections) ? args.sections : []) {
		const duration = section.duration_hours;
		const period = section.rhythmPeriod_hours;
		const phase = section.rhythmPhase_hours || 0;
		const amplitude = section.rhythmAmplitude;
		const noiseEnabled = section.noiseEnabled ?? true;
		const noiseMode = section.noiseMode ?? 'multiply';
		const noiseAmplitude = section.noiseAmplitude ?? 1;

		for (let i = 0; i < duration; i += step) {
			time.push(new Date(startMs + (currentTime + i) * 3600000).toISOString());

			const phaseShiftedTime = i + phase;
			const currentAmplitude = Math.floor(phaseShiftedTime % period) < period / 2 ? amplitude : 1;

			let value;
			if (noiseEnabled) {
				const noise = nextNoise() * noiseAmplitude;
				value = noiseMode === 'multiply' ? noise * currentAmplitude : currentAmplitude + noise;
			} else {
				value = currentAmplitude;
			}
			values.push(value);
		}
		currentTime += duration;
	}

	return { time, values };
}

/**
 * Port of Random's `makeDistributionGenerator(args)`. One minstd stream feeds whichever
 * distribution is selected; a zero/non-finite scale collapses to a constant (upstream guards
 * against a degenerate sigma/mean). Keep the branch order and the guards exactly as upstream.
 */
function randomGenerator(args) {
	const prng = minstd.factory({ seed: normalizeSeedRandom(args.seed) });
	const distribution = args.distribution ?? 'uniform';

	if (distribution === 'gaussian') {
		const sigma = Math.abs(Number(args.multiply));
		if (!Number.isFinite(sigma) || sigma === 0) {
			const fixed = Number(args.offset);
			return () => fixed;
		}
		return normal.factory(Number(args.offset), sigma, { prng: prng.normalized });
	}

	if (distribution === 'exponential') {
		const mean = Math.abs(Number(args.multiply));
		if (!Number.isFinite(mean) || mean === 0) {
			const fixed = Number(args.offset);
			return () => fixed;
		}
		const randExp = exponential.factory(1 / mean, { prng: prng.normalized });
		const base = Number(args.offset);
		return () => base + randExp();
	}

	const randUnit = uniform.factory(0, 1, { prng: prng.normalized });
	const base = Number(args.offset);
	const scale = Number(args.multiply);
	return () => base + randUnit() * scale;
}

/**
 * Port of Random's `random(args)` — N draws from uniform/gaussian/exponential, each rounded
 * to 2 dp exactly as upstream does (`Number(x.toFixed(2))`).
 * @returns {{result: number[]}}
 */
export function randomColumn(args) {
	const n = Math.max(0, Math.trunc(Number(args.N) || 0));
	const gen = randomGenerator(args);
	const result = [];
	for (let i = 0; i < n; i++) result.push(Number(gen().toFixed(2)));
	return { result };
}

/**
 * Port of SequenceColumn's `sequencecolumn(args)`. Two branches: `seqType === 'number'`
 * yields an arithmetic sequence (rounded to 10 dp — matching upstream exactly, so floats
 * like 0.1+0.2 agree), anything else yields an ISO time sequence from startTime/stepHours.
 * A zero step yields an empty (invalid) result upstream; mirror that.
 *
 * @returns {{result: Array<number|string>}}
 */
export function sequenceColumn(args) {
	let result = [];
	if (args.seqType === 'number') {
		const start = Number(args.start);
		const step = Number(args.step);
		if (step === 0) return { result: [] };
		const count = Math.max(1, Math.floor(Number(args.count)));
		for (let i = 0; i < count; i++) result.push(Number((start + i * step).toFixed(10)));
		if (result.length > 100000) result = result.slice(0, 100000);
	} else {
		const startMs = Number(args.startTime);
		const stepMs = Number(args.stepHours) * 3600000;
		if (stepMs === 0) return { result: [] };
		const count = Math.max(1, Math.floor(Number(args.count)));
		for (let i = 0; i < count; i++) result.push(new Date(startMs + i * stepMs).toISOString());
		if (result.length > 100000) result = result.slice(0, 100000);
	}
	return { result };
}
