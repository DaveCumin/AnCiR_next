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
		// t mod 24 < 7.2: hours 0 to 7 are active, 8 to 23 rest (hourly samples, so the 7.2 h
		// boundary falls between 7 and 8).
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

// The active phase ends exactly at alphaFraction * period, not at the next whole hour. Until
// v81.10 the within-cycle time was floored first, so 24 h at 0.3 was active for 8 h (not
// 7.2) and the 25 h default for 13 h (not 12.5).
describe('simulateddata: the active/rest boundary is exact', () => {
	const at = (sec, step = 0.25) => {
		const [, values] = simulateddata({
			...previewArgs,
			samplingPeriod_hours: step,
			sections: [{ rhythmPhase_hours: 0, rhythmAmplitude: 100, noiseEnabled: false, ...sec }]
		});
		// sample time (h) -> value
		return (h) => values[Math.round(h / step)];
	};

	it('24 h at 0.3 is active for 7.2 h: 7.0 h active, 7.25 h rest', () => {
		const v = at({ duration_hours: 72, rhythmPeriod_hours: 24, alphaFraction: 0.3 });
		for (const c of [0, 24, 48]) {
			expect(v(c + 7)).toBe(100);
			expect(v(c + 7.25)).toBe(1);
			expect(v(c + 7.75)).toBe(1);
			expect(v(c + 23.75)).toBe(1);
			expect(v(c)).toBe(100);
		}
	});

	it('the 25 h default is active for 12.5 h and at rest for 12.5 h', () => {
		const v = at({ duration_hours: 75, rhythmPeriod_hours: 25 });
		for (const c of [0, 25, 50]) {
			expect(v(c + 12.25)).toBe(100);
			expect(v(c + 12.5)).toBe(1);
			expect(v(c + 12.75)).toBe(1);
		}
	});

	it('23.5 h at the default splits 11.75 / 11.75', () => {
		const v = at({ duration_hours: 47, rhythmPeriod_hours: 23.5 });
		expect(v(11.5)).toBe(100);
		expect(v(11.75)).toBe(1);
		expect(v(23.5 + 11.5)).toBe(100);
		expect(v(23.5 + 11.75)).toBe(1);
	});

	it('a negative phase shift keeps JS remainder semantics; only the floor is gone', () => {
		// t + phase < 0 for the first 6 h: JS % keeps the dividend's sign, so those samples
		// have a negative within-cycle time and read as active (unchanged since v81.10).
		const v = at({
			duration_hours: 48,
			rhythmPeriod_hours: 24,
			rhythmPhase_hours: -6,
			alphaFraction: 0.3
		});
		for (const h of [0, 3, 5.75]) expect(v(h)).toBe(100);
		expect(v(6)).toBe(100);
		expect(v(13)).toBe(100);
		expect(v(13.25)).toBe(1);
		expect(v(29.75)).toBe(1);
		expect(v(30)).toBe(100);
		expect(v(37)).toBe(100);
		expect(v(37.25)).toBe(1);
	});

	it('every 24 h default-fraction series is bit-identical to v81.10, noise included', () => {
		// At 24 h and 0.5 the boundary is a whole hour (12), so the old floor never changed a
		// sample there. The hashes were recorded from the v81.10 code (FNV-1a over the JSON of
		// the values), across sampling steps, positive, fractional and negative phase shifts
		// and both noise modes.
		const fnv = (str) => {
			let h = 0x811c9dc5;
			for (let k = 0; k < str.length; k++) {
				h ^= str.charCodeAt(k);
				h = Math.imul(h, 0x01000193) >>> 0;
			}
			return h.toString(16);
		};
		const got = {};
		for (const step of [0.1, 0.25, 1 / 6, 0.5, 1, 1.5]) {
			for (const phase of [0, 6, 2.5, 11.9, -6, -3.7, -30.2]) {
				for (const noiseMode of ['multiply', 'add']) {
					const [, values] = simulateddata({
						startTime: '2024-01-01T00:00:00.000Z',
						seed: 42,
						samplingPeriod_hours: step,
						sections: [
							{
								duration_hours: 72,
								rhythmPeriod_hours: 24,
								rhythmPhase_hours: phase,
								rhythmAmplitude: 100,
								noiseEnabled: true,
								noiseMode,
								noiseAmplitude: 3
							}
						],
						out: { time: -1, values: -1 }
					});
					got[`${step}|${phase}|${noiseMode}`] = fnv(JSON.stringify(values));
				}
			}
		}
		expect(got).toEqual(V81_10_HASHES);
	});
});

// FNV-1a hashes of the v81.10 output; see the bit-identity test above.
const V81_10_HASHES = {
	'0.1|0|multiply': 'a6279332',
	'0.1|0|add': '51bf0545',
	'0.1|6|multiply': 'f13ca8b',
	'0.1|6|add': '5d26c84d',
	'0.1|2.5|multiply': '569555d0',
	'0.1|2.5|add': '5b6f0674',
	'0.1|11.9|multiply': '3c47c930',
	'0.1|11.9|add': '58c8bb34',
	'0.1|-6|multiply': 'd40f2fcb',
	'0.1|-6|add': '4317df03',
	'0.1|-3.7|multiply': '47a49259',
	'0.1|-3.7|add': '1c381dca',
	'0.1|-30.2|multiply': 'b4da6795',
	'0.1|-30.2|add': '1d9728af',
	'0.25|0|multiply': '1eda4b11',
	'0.25|0|add': '91590f46',
	'0.25|6|multiply': '11e109f8',
	'0.25|6|add': '7bf52788',
	'0.25|2.5|multiply': '74ddd390',
	'0.25|2.5|add': '1bb31aa9',
	'0.25|11.9|multiply': '1f30a45c',
	'0.25|11.9|add': 'ec74c3e2',
	'0.25|-6|multiply': 'a71ba8f8',
	'0.25|-6|add': '92b3f3b',
	'0.25|-3.7|multiply': 'a1f94b73',
	'0.25|-3.7|add': 'b16e9a70',
	'0.25|-30.2|multiply': '3fb19989',
	'0.25|-30.2|add': '278b3220',
	'0.16666666666666666|0|multiply': '3d469186',
	'0.16666666666666666|0|add': 'bb652401',
	'0.16666666666666666|6|multiply': 'a6753ede',
	'0.16666666666666666|6|add': '78e88cf7',
	'0.16666666666666666|2.5|multiply': '48df1aec',
	'0.16666666666666666|2.5|add': 'd235644d',
	'0.16666666666666666|11.9|multiply': 'f0f6dbb2',
	'0.16666666666666666|11.9|add': 'c0e85b82',
	'0.16666666666666666|-6|multiply': '9da0ee49',
	'0.16666666666666666|-6|add': '17c75de6',
	'0.16666666666666666|-3.7|multiply': '1e42c5f5',
	'0.16666666666666666|-3.7|add': 'fe5911c8',
	'0.16666666666666666|-30.2|multiply': '3bf7033e',
	'0.16666666666666666|-30.2|add': '10dbc273',
	'0.5|0|multiply': '89121cf9',
	'0.5|0|add': '408690c2',
	'0.5|6|multiply': '92e88a50',
	'0.5|6|add': 'e2173bd9',
	'0.5|2.5|multiply': '10766a9d',
	'0.5|2.5|add': '1f32948f',
	'0.5|11.9|multiply': '18263de9',
	'0.5|11.9|add': 'b1ae2663',
	'0.5|-6|multiply': '79c1ed09',
	'0.5|-6|add': 'c3c2a05b',
	'0.5|-3.7|multiply': '5f0ce619',
	'0.5|-3.7|add': '629c1952',
	'0.5|-30.2|multiply': '5353c88a',
	'0.5|-30.2|add': '185e98c3',
	'1|0|multiply': 'b03a89b8',
	'1|0|add': '7237316b',
	'1|6|multiply': '30f383be',
	'1|6|add': '559d38a4',
	'1|2.5|multiply': '691bc5f3',
	'1|2.5|add': 'a0a85baf',
	'1|11.9|multiply': '5903bb7e',
	'1|11.9|add': 'a5ac32d4',
	'1|-6|multiply': '7c234100',
	'1|-6|add': '4a76fa87',
	'1|-3.7|multiply': 'a8137d24',
	'1|-3.7|add': 'd5f68d40',
	'1|-30.2|multiply': '81ddcf37',
	'1|-30.2|add': 'dba6fa7b',
	'1.5|0|multiply': '3910e7c1',
	'1.5|0|add': '3dd11fc',
	'1.5|6|multiply': '2624bbae',
	'1.5|6|add': '50352850',
	'1.5|2.5|multiply': '59c4befc',
	'1.5|2.5|add': 'ebfe51eb',
	'1.5|11.9|multiply': 'e6af8bad',
	'1.5|11.9|add': '41fb8c45',
	'1.5|-6|multiply': '62c1ec25',
	'1.5|-6|add': '9372258b',
	'1.5|-3.7|multiply': 'e3fd4931',
	'1.5|-3.7|add': '7d1d6439',
	'1.5|-30.2|multiply': 'b504b229',
	'1.5|-30.2|add': '6533d6f0'
};
