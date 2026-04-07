import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/core/core.svelte', () => ({ core: { rawData: new Map() } }));
vi.mock('$lib/core/Column.svelte', () => ({ getColumnById: vi.fn() }));
vi.mock('luxon', () => ({ DateTime: { fromISO: () => ({ toMillis: () => 0 }) } }));

import { simulateddata } from './SimulatedData.svelte';

// Preview mode: out.time === -1, out.values === -1

const previewArgs = {
	startTime: new Date('2024-01-01T00:00:00Z').toISOString(),
	sections: [{ duration_hours: 48, rhythmPeriod_hours: 24, rhythmPhase_hours: 0, rhythmAmplitude: 100 }],
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
