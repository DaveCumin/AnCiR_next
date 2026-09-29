// A missing FIRST or LAST x must not shrink the record span the harmonic check filters its
// candidates by.
//
// dataSpan was xData[last] - xData[0], and JS reads null as 0 in arithmetic. An actogram's x
// is hoursSinceStart, which keeps a missing time as null, so a series whose last time is
// missing (a Split segment padded with null after its window, a blank trailing CSV cell) had
// a span of 0 - 0 = 0, every candidate failed `period < span / 2`, and the check returned
// null: no harmonic pick, so the rule's tau readout and `r<id>_tau` output went NaN. The span
// is now last VALID minus first VALID time (validPairs.js validEnds), which is the old value
// whenever both ends are present.
import { describe, it, expect } from 'vitest';
import { harmonicCheck } from './harmonicCheck.js';

const N = 7 * 24 * 4; // 7 days every 15 min
const hours = Array.from({ length: N }, (_, i) => i * 0.25);
const y = hours.map((h) => (h % 24 < 12 ? 40 : 2) + Math.sin(h * 7.3));

describe('harmonicCheck with a missing end on x', () => {
	const full = harmonicCheck({ xData: hours, yData: y, binSize: 0.25, tau: 24 });

	it('a missing LAST x keeps the candidates of the trimmed series', () => {
		const ref = harmonicCheck({
			xData: hours.slice(0, -1),
			yData: y.slice(0, -1),
			binSize: 0.25,
			tau: 24
		});
		expect(ref).not.toBeNull();
		const got = harmonicCheck({
			xData: [...hours.slice(0, -1), null],
			yData: y,
			binSize: 0.25,
			tau: 24
		});
		// Old: span 0, no candidate, null.
		expect(got).not.toBeNull();
		expect(got.candidates.map((c) => c.label)).toEqual(ref.candidates.map((c) => c.label));
		expect(got.strongest.label).toBe(ref.strongest.label);
	});

	it('a missing FIRST x on a series that does not start at 0 keeps its candidates', () => {
		// A number x from 100 h, 7 days: the trimmed span is 167.5 h, so with tau 42 h the
		// 2 tau = 84 h candidate is past half the record and drops out. The old span read the
		// missing first time as 0 (267.75 h) and kept it.
		const x = hours.map((h) => 100 + h);
		const ref = harmonicCheck({ xData: x.slice(1), yData: y.slice(1), binSize: 0.25, tau: 42 });
		const got = harmonicCheck({ xData: [null, ...x.slice(1)], yData: y, binSize: 0.25, tau: 42 });
		expect(ref.candidates.map((c) => c.label)).toEqual(['τ', 'τ/2']);
		expect(got.candidates.map((c) => c.label)).toEqual(['τ', 'τ/2']);
	});

	it('a blank-string end is absence, like null', () => {
		const got = harmonicCheck({
			xData: [...hours.slice(0, -1), ''],
			yData: y,
			binSize: 0.25,
			tau: 24
		});
		expect(got).not.toBeNull();
	});

	it('both ends present: unchanged', () => {
		expect(full.candidates.map((c) => c.label)).toEqual(['τ', 'τ/2', '2τ']);
	});
});
