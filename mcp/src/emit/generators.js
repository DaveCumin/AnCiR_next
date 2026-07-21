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

	if (distribution === 'bernoulli') {
		// A 0/1 outcome — one uniform draw < p is a success. Must match Random.svelte exactly
		// (same draw, same clamp) so generators.parity keeps this port bit-identical to the app.
		const rawP = Number(args.probability);
		const p = Number.isFinite(rawP) ? Math.min(1, Math.max(0, rawP)) : 0.5;
		const draw = uniform.factory(0, 1, { prng: prng.normalized });
		return () => (draw() < p ? 1 : 0);
	}

	const randUnit = uniform.factory(0, 1, { prng: prng.normalized });
	const base = Number(args.offset);
	const scale = Number(args.multiply);
	return () => base + randUnit() * scale;
}

/**
 * How to DRIVE a generator, in the model's own terms — as opposed to OUTPUT_NOTES, which says
 * what a node produces. Baked into the catalogue by gen-schema.js and rendered by draftPrompt.
 *
 * Params alone are not a usable description. The catalogue printed Random as
 * `args={"offset":0,"multiply":10,"N":10,"seed":0,"distribution":"uniform"}` and stopped there,
 * which tells a model nothing: not that "gaussian" is a legal `distribution` (the only value it
 * ever saw was the default, "uniform"), nor that `offset`/`multiply` change MEANING per
 * distribution — mean/SD for gaussian, base/scale for uniform.
 *
 * That gap made a whole class of request unreachable. Asked for "50 phases around 0 h and 50
 * around 5 h on a Rayleigh plot" — which is Random twice, and nothing else — the model had no
 * tool it could see, so it hand-typed 100 values into `columns` and ran them together into one
 * unusable string. It didn't reach for the wrong node; it couldn't see the right one.
 *
 * Kept next to randomGenerator/sequenceColumn because these notes state what THAT code does.
 * A note that drifts from the rule is worse than no note (same reasoning as OUTPUT_NOTES).
 */
export const USAGE_NOTES = {
	Random:
		'N random values. `distribution` is "uniform" (each value = offset + multiply×[0,1)), "gaussian" (offset = the MEAN, multiply = the SD), "exponential" (offset + an exponential with mean=multiply), or "bernoulli" (a 0/1 outcome; `probability` is P(1), default 0.5 — offset/multiply are ignored). Use "bernoulli" for a binary outcome, e.g. the yIN of a LogisticRegression. So 50 values scattered around 5 with a little jitter = {N:50, distribution:"gaussian", offset:5, multiply:0.5}; a coin-flip column = {N:50, distribution:"bernoulli", probability:0.5}. A gaussian with multiply:0 gives a CONSTANT column of `offset` — that is how to make a column of 1s. Values are rounded to 2 dp. Give each Random node a DIFFERENT `seed`, or they return identical columns',
	SequenceColumn:
		'a plain arithmetic sequence: `count` values from `start`, adding `step` each time (seqType:"number"), or a run of timestamps from `startTime` every `stepHours` (seqType:"time"). `step` (or `stepHours`) of 0 yields NOTHING — for a constant column use Random with distribution:"gaussian" and multiply:0',
	SimulatedData:
		'one rhythmic time series, sampled every `samplingPeriod_hours`. `sections` run BACK-TO-BACK IN TIME, each for its own `duration_hours` — so 2 sections give one recording whose period changes part-way through, NOT two separate datasets. For N independent datasets use N SimulatedData nodes, each with its own `seed`'
};

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
