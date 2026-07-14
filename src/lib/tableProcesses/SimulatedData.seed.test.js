import { describe, it, expect } from 'vitest';
import { simulateddata } from './SimulatedData.svelte';

// out.time/values = -1 → preview mode: returns [time, values, valid] without
// touching core.rawData, so we can assert the noise is seed-reproducible.
function run(seed) {
	const args = {
		startTime: 0,
		samplingPeriod_hours: 1,
		seed,
		sections: [
			{
				duration_hours: 48,
				rhythmPeriod_hours: 24,
				rhythmPhase_hours: 0,
				rhythmAmplitude: 100,
				noiseEnabled: true,
				noiseMode: 'add',
				noiseAmplitude: 1
			}
		],
		out: { time: -1, values: -1 }
	};
	return simulateddata(args)[1]; // values
}

describe('SimulatedData seeded noise', () => {
	it('is reproducible for the same seed', () => {
		expect(run(42)).toEqual(run(42));
	});

	it('differs for different seeds', () => {
		expect(run(42)).not.toEqual(run(43));
	});

	it('treats an undefined seed as a fixed fallback (still reproducible)', () => {
		expect(run(undefined)).toEqual(run(undefined));
	});

	it('produces finite noisy values', () => {
		const v = run(7);
		expect(v.length).toBe(48);
		expect(v.every((x) => Number.isFinite(x))).toBe(true);
	});
});
