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

// Coerce any user seed into minstd's valid range [1, 2147483646] so the noise is
// reproducible. Mirrors SimulatedData.svelte / Random.svelte normalizeSeed. 0/NaN → 12345.
const MINSTD_MAX = 2147483646;
export function normalizeSeed(seed) {
	const n = Math.trunc(Number(seed));
	if (!Number.isFinite(n) || n === 0) return 12345;
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
