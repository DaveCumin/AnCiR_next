// Parity: the normalizer's pure generator ports vs AnCiR's REAL generator functions.
//
// The normalizer must bake generator outputs (see ADR 2026-07-15-static-session-emission),
// but it has to stay pure/portable, so it can't import the real generators (they live in
// .svelte modules and write into `core`). It ports them instead — and this test is the
// contract that keeps the port honest: it runs BOTH implementations over the same args and
// demands identical output. If AnCiR's algorithm changes, this fails and src/emit/generators.js
// must be updated to follow it. Never "fix" the port to make maths nicer; only to match.
//
// Both real functions take an `out` map; passing -1 selects their preview path, which skips
// the core writes and just returns the computed arrays — so we can call them purely here.
import { describe, expect, it } from 'vitest';
import { simulateddata } from '$lib/tableProcesses/SimulatedData.svelte';
import { sequencecolumn } from '$lib/tableProcesses/SequenceColumn.svelte';
import { random } from '$lib/tableProcesses/Random.svelte';
import { simulatedData, sequenceColumn, randomColumn } from '../src/emit/generators.js';

const PREVIEW_SIM = { out: { time: -1, values: -1 } };
const PREVIEW_SEQ = { out: { result: -1 } };
const PREVIEW_RND = { out: { result: -1 } };

describe('SimulatedData port is identical to the real generator', () => {
	const cases = {
		'default-ish multiply noise': {
			startTime: '2024-01-01T00:00:00.000Z',
			seed: 42,
			samplingPeriod_hours: 0.25,
			sections: [
				{
					duration_hours: 48,
					rhythmPeriod_hours: 24,
					rhythmPhase_hours: 0,
					rhythmAmplitude: 100,
					noiseEnabled: true,
					noiseMode: 'multiply',
					noiseAmplitude: 1
				}
			]
		},
		'additive noise + phase shift': {
			startTime: '2024-03-10T06:30:00.000Z',
			seed: 7,
			samplingPeriod_hours: 0.5,
			sections: [
				{
					duration_hours: 72,
					rhythmPeriod_hours: 23.5,
					rhythmPhase_hours: 6,
					rhythmAmplitude: 250,
					noiseEnabled: true,
					noiseMode: 'add',
					noiseAmplitude: 20
				}
			]
		},
		'noise disabled': {
			startTime: '2024-01-01T00:00:00.000Z',
			seed: 1,
			samplingPeriod_hours: 1,
			sections: [
				{
					duration_hours: 24,
					rhythmPeriod_hours: 24,
					rhythmPhase_hours: 0,
					rhythmAmplitude: 10,
					noiseEnabled: false,
					noiseMode: 'multiply',
					noiseAmplitude: 1
				}
			]
		},
		'multiple sections share one seeded stream': {
			startTime: '2024-01-01T00:00:00.000Z',
			seed: 99,
			samplingPeriod_hours: 0.25,
			sections: [
				{
					duration_hours: 24,
					rhythmPeriod_hours: 24,
					rhythmPhase_hours: 0,
					rhythmAmplitude: 100,
					noiseEnabled: true,
					noiseMode: 'multiply',
					noiseAmplitude: 1
				},
				{
					duration_hours: 24,
					rhythmPeriod_hours: 12,
					rhythmPhase_hours: 3,
					rhythmAmplitude: 50,
					noiseEnabled: true,
					noiseMode: 'add',
					noiseAmplitude: 5
				}
			]
		},
		'seed 0 normalises to the fixed fallback': {
			startTime: '2024-01-01T00:00:00.000Z',
			seed: 0,
			samplingPeriod_hours: 1,
			sections: [
				{
					duration_hours: 12,
					rhythmPeriod_hours: 24,
					rhythmPhase_hours: 0,
					rhythmAmplitude: 100,
					noiseEnabled: true,
					noiseMode: 'multiply',
					noiseAmplitude: 1
				}
			]
		}
	};

	for (const [name, args] of Object.entries(cases)) {
		it(name, () => {
			const [realTime, realValues, realValid] = simulateddata({ ...args, ...PREVIEW_SIM });
			const port = simulatedData(args);
			expect(realValid).toBe(true); // the case itself must be meaningful
			expect(port.time).toEqual(realTime);
			expect(port.values).toEqual(realValues);
		});
	}

	it('same seed reproduces, different seed diverges', () => {
		const base = cases['default-ish multiply noise'];
		expect(simulatedData(base).values).toEqual(simulatedData({ ...base }).values);
		expect(simulatedData({ ...base, seed: 43 }).values).not.toEqual(simulatedData(base).values);
	});
});

describe('SequenceColumn port is identical to the real generator', () => {
	const cases = {
		'integer sequence': { seqType: 'number', start: 0, step: 1, count: 50 },
		'fractional step (10dp rounding)': { seqType: 'number', start: 0.1, step: 0.2, count: 20 },
		'negative step': { seqType: 'number', start: 10, step: -0.5, count: 15 },
		'count below 1 clamps to 1': { seqType: 'number', start: 5, step: 1, count: 0 },
		'time sequence': {
			seqType: 'time',
			startTime: Date.parse('2024-01-01T00:00:00.000Z'),
			stepHours: 0.5,
			count: 10
		}
	};

	for (const [name, args] of Object.entries(cases)) {
		it(name, () => {
			const [realResult] = sequencecolumn({ ...args, ...PREVIEW_SEQ });
			expect(sequenceColumn(args).result).toEqual(realResult);
		});
	}

	it('zero step yields an empty (invalid) result in both', () => {
		const args = { seqType: 'number', start: 0, step: 0, count: 10 };
		const [realResult, realValid] = sequencecolumn({ ...args, ...PREVIEW_SEQ });
		expect(realValid).toBe(false);
		expect(sequenceColumn(args).result).toEqual(realResult);
	});
});

describe('Random port is identical to the real generator', () => {
	const cases = {
		uniform: { distribution: 'uniform', N: 40, offset: 0, multiply: 10, seed: 42 },
		'uniform with offset + negative scale': {
			distribution: 'uniform', N: 25, offset: -5, multiply: -3.5, seed: 7
		},
		gaussian: { distribution: 'gaussian', N: 40, offset: 100, multiply: 15, seed: 99 },
		exponential: { distribution: 'exponential', N: 40, offset: 2, multiply: 5, seed: 3 },
		bernoulli: { distribution: 'bernoulli', N: 40, probability: 0.5, seed: 11 },
		'bernoulli skewed': { distribution: 'bernoulli', N: 40, probability: 0.2, seed: 12 },
		// p out of range clamps identically on both sides; default p when absent.
		'bernoulli p clamped + default': { distribution: 'bernoulli', N: 20, probability: 5, seed: 13 },
		// degenerate scale collapses to a constant upstream — mirror it exactly
		'gaussian with zero sigma': { distribution: 'gaussian', N: 5, offset: 42, multiply: 0, seed: 1 },
		'exponential with zero mean': { distribution: 'exponential', N: 5, offset: 7, multiply: 0, seed: 1 },
		'N = 0': { distribution: 'uniform', N: 0, offset: 0, multiply: 1, seed: 1 },
		// Random's normalizeSeed differs from SimulatedData's: NaN → 1, and 0 is NOT
		// special-cased. These two cases fail if the helpers are ever "unified".
		'seed 0 (not special-cased, unlike SimulatedData)': {
			distribution: 'uniform', N: 10, offset: 0, multiply: 10, seed: 0
		},
		'non-numeric seed falls back to 1': {
			distribution: 'uniform', N: 10, offset: 0, multiply: 10, seed: 'nonsense'
		},
		'negative seed wraps into range': {
			distribution: 'uniform', N: 10, offset: 0, multiply: 10, seed: -12345
		}
	};

	for (const [name, args] of Object.entries(cases)) {
		it(name, () => {
			const [realResult] = random({ ...args, ...PREVIEW_RND });
			expect(randomColumn(args).result).toEqual(realResult);
		});
	}

	it('same seed reproduces, different seed diverges', () => {
		const base = cases.uniform;
		expect(randomColumn(base).result).toEqual(randomColumn({ ...base }).result);
		expect(randomColumn({ ...base, seed: 43 }).result).not.toEqual(randomColumn(base).result);
	});
});
