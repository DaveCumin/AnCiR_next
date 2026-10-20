// Colour by: modes, domain, buckets and group summaries (components/plotbits/encodings.js),
// as listed in colour-by plan 2026-10-20 section 6 ("Unit").
import { describe, it, expect } from 'vitest';
import {
	COLOUR_BUCKETS,
	NO_VALUE,
	ENCODING_MODES,
	WRAPPED_HOURS_WARNING,
	NO_DATE_WARNING,
	encodingModesFor,
	encodingValues,
	encodingDomain,
	domainPosition,
	bucketIndex,
	colourBuckets,
	bucketColours,
	circularMean,
	groupEncodingValue,
	dayOfYear,
	isCyclicMode
} from './encodings.js';
import { colormapRGB } from './colormaps.js';
import { clockHourOfDay } from '$lib/utils/phaseReference.js';

const H = 3600000;
const D = 24 * H;
const utc = (s) => Date.parse(s);

describe('hour of day', () => {
	it('reads a time column in UTC and in a zone, with 30-minute offsets and DST', () => {
		const jan = utc('2026-01-15T00:00:00Z'); // southern summer
		const jul = utc('2026-07-15T00:00:00Z'); // southern winter
		const read = (ms, zone) => encodingValues('hourOfDay', [ms], { type: 'time', zone }).values[0];
		expect(read(jan + 90 * 60000, 'utc')).toBe(1.5);
		expect(read(jan, 'Pacific/Auckland')).toBe(13); // NZDT, UTC+13
		expect(read(jul, 'Pacific/Auckland')).toBe(12); // NZST, UTC+12
		expect(read(jan, 'Asia/Kolkata')).toBe(5.5); // UTC+5:30, no DST
		expect(read(jan, 'Australia/Lord_Howe')).toBe(11); // UTC+11 in summer
		expect(read(jul, 'Australia/Lord_Howe')).toBe(10.5); // UTC+10:30: a 30-minute DST shift
	});

	it('is the same function phase outputs use (clockHourOfDay), so a colour bar and an acrophase agree', () => {
		const ms = utc('2026-03-03T17:45:00Z');
		const zone = 'Pacific/Auckland';
		expect(encodingValues('hourOfDay', [ms], { type: 'time', zone }).values[0]).toBe(
			clockHourOfDay(ms, zone)
		);
	});

	it('a number column with a time origin counts hours from that origin', () => {
		const origin = utc('2026-01-01T06:00:00Z');
		const { values, warning } = encodingValues('hourOfDay', [0, 1.5, 20], {
			type: 'number',
			originTime_ms: origin
		});
		expect(values).toEqual([6, 7.5, 2]);
		expect(warning).toBeNull();
	});

	it('a number column without a clock is wrapped at 24 h, with a warning', () => {
		const { values, warning } = encodingValues('hourOfDay', [0, 23.5, 24, 49, -1], {
			type: 'number'
		});
		expect(values).toEqual([0, 23.5, 0, 1, 23]);
		expect(warning).toBe(WRAPPED_HOURS_WARNING);
	});

	it('23:59 and 00:00 land in adjacent buckets of the cyclic scale, in near-identical colours', () => {
		const day = utc('2026-02-01T00:00:00Z');
		const { values } = encodingValues('hourOfDay', [day - 60000, day], { type: 'time' });
		const domain = encodingDomain([values], { mode: 'hourOfDay' });
		const [late, midnight] = colourBuckets(values, domain);
		expect(late).toBe(63);
		expect(midnight).toBe(0);
		// Neighbours across the wrap: the last bucket and the first look alike.
		const [a, b] = [late, midnight].map((k) =>
			colormapRGB('twilight_shifted', (k + 0.5) / 64)
				.match(/\d+/g)
				.map(Number)
		);
		expect(Math.max(...a.map((v, i) => Math.abs(v - b[i])))).toBeLessThanOrEqual(6);
		// 24 h wraps to 0 h.
		expect(domainPosition(24, domain)).toBe(0);
		expect(domainPosition(12, domain)).toBe(0.5);
	});
});

describe('day of year', () => {
	it('crosses 31 December / 1 January and counts 366 in a leap year', () => {
		const read = (s, zone = 'utc') =>
			encodingValues('dayOfYear', [utc(s)], { type: 'time', zone }).values[0];
		expect(read('2025-01-01T00:00:00Z')).toBe(1);
		expect(read('2025-12-31T23:59:00Z')).toBe(365);
		expect(read('2024-12-31T12:00:00Z')).toBe(366);
		expect(read('2024-02-29T12:00:00Z')).toBe(60);
		// In the zone: 31 Dec 12:00 UTC is already 1 Jan in Auckland.
		expect(read('2025-12-31T12:00:00Z', 'Pacific/Auckland')).toBe(1);
		expect(dayOfYear(NaN)).toBeNaN();
	});

	it('needs a clock: a plain number column gives no value, with a warning', () => {
		const { values, warning } = encodingValues('dayOfYear', [1, 2], { type: 'number' });
		expect(values.every(Number.isNaN)).toBe(true);
		expect(warning).toBe(NO_DATE_WARNING);
	});
});

describe('days since start', () => {
	it('counts from the earliest valid time, whatever the row order, with a missing first row', () => {
		const t0 = utc('2026-05-01T00:00:00Z');
		const { values } = encodingValues('daysSinceStart', [null, t0 + 2 * D, t0, t0 + 0.5 * D, ''], {
			type: 'time'
		});
		expect(values[0]).toBeNaN();
		expect(values.slice(1, 4)).toEqual([2, 0, 0.5]);
		expect(values[4]).toBeNaN();
	});

	it('a number column counts hours', () => {
		expect(encodingValues('daysSinceStart', [36, 12, 60], { type: 'number' }).values).toEqual([
			1, 0, 2
		]);
	});
});

describe('value mode and missing cells', () => {
	it('keeps every row: invalid cells (isInvalidValue) and non-finite numbers are no value, not dropped', () => {
		const { values } = encodingValues('value', [1, null, '', '  ', 'abc', NaN, Infinity, '2.5', 0]);
		expect(values).toHaveLength(9);
		expect(values.map((v) => (Number.isNaN(v) ? 'x' : v))).toEqual([
			1,
			'x',
			'x',
			'x',
			'x',
			'x',
			'x',
			2.5,
			0
		]);
		const buckets = colourBuckets(values, encodingDomain([values]));
		expect(Array.from(buckets)).toEqual([25, -1, -1, -1, -1, -1, -1, 63, 0]);
	});
});

describe('modes offered per column', () => {
	it('time columns get the clock modes; plain numbers get value, wrapped hours and days since start', () => {
		const modes = (c) => encodingModesFor(c).map((m) => m.mode);
		expect(modes({ type: 'time' })).toEqual(['hourOfDay', 'dayOfYear', 'daysSinceStart']);
		const clock = ['value', 'hourOfDay', 'dayOfYear', 'daysSinceStart'];
		expect(modes({ type: 'number', originTime_ms: 0 })).toEqual(clock);
		expect(modes({ type: 'bin', originTime_ms: 5 })).toEqual(clock);
		// Category (v1.1) last for a plain number column: numbers as labels.
		expect(encodingModesFor({ type: 'number' })).toEqual([
			{ mode: 'value', warning: null },
			{ mode: 'hourOfDay', warning: WRAPPED_HOURS_WARNING },
			{ mode: 'daysSinceStart', warning: null },
			{ mode: 'category', warning: null }
		]);
		expect(ENCODING_MODES).toEqual([...clock, 'category']);
		expect(isCyclicMode('hourOfDay')).toBe(true);
		expect(isCyclicMode('value')).toBe(false);
	});
});

describe('domain', () => {
	it('auto: the finite range over every array given (all series, or all facet panels)', () => {
		expect(
			encodingDomain([
				[3, NaN, 7],
				[-2, 5]
			])
		).toEqual({ lo: -2, hi: 7, cyclic: false, period: null });
		expect(encodingDomain([[NaN], []])).toEqual({ lo: NaN, hi: NaN, cyclic: false, period: null });
	});

	it('manual: either end overrides, null leaves it automatic; values outside clamp', () => {
		const d = encodingDomain([[0, 10]], { domainIN: [null, 5] });
		expect(d).toMatchObject({ lo: 0, hi: 5 });
		expect(domainPosition(8, d)).toBe(1);
		expect(domainPosition(-3, encodingDomain([[0, 10]], { domainIN: [2, null] }))).toBe(0);
		expect(encodingDomain([[0, 10]], { domainIN: ['4', '6'] })).toMatchObject({ lo: 4, hi: 6 });
		// A manual range given high-to-low reverses the scale.
		expect(domainPosition(2, encodingDomain([[0]], { domainIN: [10, 0] }))).toBe(0.8);
	});

	it('hour of day is fixed at [0, 24) and ignores a manual range', () => {
		expect(encodingDomain([[5, 6]], { mode: 'hourOfDay', domainIN: [5, 6] })).toEqual({
			lo: 0,
			hi: 24,
			cyclic: true,
			period: 24
		});
	});

	it('a degenerate range puts every value at the low end; no value stays no value', () => {
		const d = encodingDomain([[4, 4]]);
		expect(domainPosition(4, d)).toBe(0);
		expect(domainPosition(NaN, d)).toBeNaN();
		expect(domainPosition(1, { lo: NaN, hi: NaN })).toBeNaN();
	});
});

describe('buckets (64), both sides of each gate', () => {
	it('bucket = min(K - 1, floor(t * K)) with t clamped; not a number is NO_VALUE', () => {
		expect(COLOUR_BUCKETS).toBe(64);
		expect(bucketIndex(0)).toBe(0);
		expect(bucketIndex(1 / 64 - 1e-12)).toBe(0);
		expect(bucketIndex(1 / 64)).toBe(1);
		expect(bucketIndex(63 / 64 - 1e-12)).toBe(62);
		expect(bucketIndex(63 / 64)).toBe(63);
		expect(bucketIndex(1)).toBe(63);
		expect(bucketIndex(1.5)).toBe(63);
		expect(bucketIndex(-0.2)).toBe(0);
		expect(bucketIndex(NaN)).toBe(NO_VALUE);
		expect(bucketIndex(0.5, 8)).toBe(4);
	});

	it('63, 64 and 65 evenly spread values fill 63, 64 and 64 buckets', () => {
		const used = (n) => {
			const values = Array.from({ length: n }, (_, i) => i);
			return new Set(colourBuckets(values, encodingDomain([values]))).size;
		};
		expect(used(63)).toBe(63);
		expect(used(64)).toBe(64);
		expect(used(65)).toBe(64);
	});

	it('a large column gets one bucket per row and never more than 64 distinct buckets', () => {
		const n = 200000;
		const values = Array.from({ length: n }, (_, i) => Math.sin(i / 1000) * 100);
		const b = colourBuckets(values, encodingDomain([values]));
		expect(b).toHaveLength(n);
		expect(new Set(b).size).toBe(64);
	});

	it('bucket colours are the colormap at the bucket centres', () => {
		const c = bucketColours('viridis');
		expect(c).toHaveLength(64);
		expect(c[0]).toBe(colormapRGB('viridis', 0.5 / 64));
		expect(c[63]).toBe(colormapRGB('viridis', 63.5 / 64));
		expect(bucketColours('magma', 8)[3]).toBe(colormapRGB('magma', 3.5 / 8));
	});
});

describe('group summaries (one mark per group)', () => {
	it('circular mean of 23:00 and 01:00 is 00:00, not 12:00', () => {
		expect(circularMean([23, 1])).toBeCloseTo(0, 12);
		expect(circularMean([22, 4])).toBeCloseTo(1, 12);
		expect(circularMean([6, 18])).toBeNaN(); // opposite: no mean direction
		expect(circularMean([NaN, null])).toBeNaN();
		expect(groupEncodingValue([23, 1, NaN], 'hourOfDay')).toBeCloseTo(0, 12);
	});

	it('the other modes take the arithmetic mean of the rows with a value', () => {
		expect(groupEncodingValue([1, 2, NaN, 6], 'value')).toBe(3);
		expect(groupEncodingValue([NaN], 'dayOfYear')).toBeNaN();
	});
});
