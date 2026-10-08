import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/core/core.svelte', () => ({ core: { rawData: new Map() } }));
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: vi.fn() }));

import { simulateddata } from './SimulatedData.svelte';

// Preview mode: out.time === -1, out.values === -1

const previewArgs = {
	startTime: new Date('2024-01-01T00:00:00Z').toISOString(),
	sections: [
		{ duration_hours: 48, rhythmPeriod_hours: 24, rhythmPhase_hours: 0, rhythmAmplitude: 100 }
	],
	samplingPeriod_hours: 1,
	out: { time: -1, values: -1 }
};

describe('simulateddata', () => {
	it('returns valid status when data is generated', () => {
		const [, , valid] = simulateddata(previewArgs);
		expect(valid).toBe(true);
	});

	it('time and values arrays have the same length', () => {
		const [time, values] = simulateddata(previewArgs);
		expect(time.length).toBe(values.length);
	});

	it('number of samples equals duration / samplingPeriod', () => {
		const [time] = simulateddata(previewArgs);
		// 48 hours / 1 hour per sample = 48 samples
		expect(time).toHaveLength(48);
	});

	it('time values are ISO strings', () => {
		const [time] = simulateddata(previewArgs);
		time.forEach((t) => expect(typeof t).toBe('string'));
	});

	it('simulated values are non-negative', () => {
		const [, values] = simulateddata(previewArgs);
		values.forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
	});

	it('multiple sections concatenate correctly', () => {
		const args = {
			...previewArgs,
			sections: [
				{ duration_hours: 24, rhythmPeriod_hours: 24, rhythmPhase_hours: 0, rhythmAmplitude: 50 },
				{ duration_hours: 24, rhythmPeriod_hours: 24, rhythmPhase_hours: 0, rhythmAmplitude: 100 }
			]
		};
		const [time] = simulateddata(args);
		expect(time).toHaveLength(48);
	});
});

// The active (high) part of each cycle is `alphaFraction` of the period, so a long-day or
// short-day record can be simulated. Default 0.5 keeps every existing session unchanged.
describe('simulateddata: per-section alphaFraction', () => {
	const section = (extra = {}) => ({
		duration_hours: 48,
		rhythmPeriod_hours: 24,
		rhythmPhase_hours: 0,
		rhythmAmplitude: 100,
		noiseEnabled: false,
		...extra
	});
	const run = (extra) =>
		simulateddata({ ...previewArgs, sections: [section(extra)], samplingPeriod_hours: 1 })[1];
	const activeHours = (values) => values.slice(0, 24).filter((v) => v === 100).length;

	it('defaults to half the cycle active (unchanged behaviour)', () => {
		expect(activeHours(run())).toBe(12);
		expect(run({ alphaFraction: 0.5 })).toEqual(run());
	});

	it('0.3 makes the first 30% of each cycle active', () => {
		const v = run({ alphaFraction: 0.3 });
		// floor(t mod 24) < 7.2: hours 0 to 7 are active, 8 to 23 rest.
		expect(activeHours(v)).toBe(8);
		expect(v.slice(0, 8).every((x) => x === 100)).toBe(true);
		expect(v.slice(8, 24).every((x) => x === 1)).toBe(true);
		expect(v.slice(24, 32).every((x) => x === 100)).toBe(true);
	});

	it('0.75 makes a long active phase', () => {
		expect(activeHours(run({ alphaFraction: 0.75 }))).toBe(18);
	});

	it('clamps to [0.01, 0.99]: a cycle is never all rest or all active; junk falls back to 0.5', () => {
		// A 100 h cycle sampled hourly, so the clamp is visible sample by sample.
		const cyc = (alphaFraction) =>
			simulateddata({
				...previewArgs,
				samplingPeriod_hours: 1,
				sections: [section({ duration_hours: 100, rhythmPeriod_hours: 100, alphaFraction })]
			})[1].filter((v) => v === 100).length;
		expect(cyc(0)).toBe(1);
		expect(cyc(-2)).toBe(1);
		expect(cyc(1)).toBe(99);
		expect(cyc(1.5)).toBe(99);
		expect(cyc(0.4)).toBe(40);
		expect(run({ alphaFraction: 'x' })).toEqual(run());
		expect(run({ alphaFraction: null })).toEqual(run());
		expect(run({ alphaFraction: NaN })).toEqual(run());
	});
});
