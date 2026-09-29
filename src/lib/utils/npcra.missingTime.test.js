// A missing time must be DROPPED by computeNPCRA, not read as hour 0.
//
// The pairing kept every row whose Number(t) is finite, and Number(null) and Number('') are
// 0, so a missing time became a sample at t = 0: it pulled the epoch grid's origin (t0, the
// first sorted time) back to 0, which on an x that does not start at 0 adds empty epochs and
// shifts the phase of the folded profile, and its y was averaged into the first epoch. The
// Python and R ports already skipped it (float(None) raises; as.numeric(NA) is not finite).
import { describe, it, expect } from 'vitest';
import { computeNPCRA } from './npcra.js';

const OPTS = { epochHours: 1, period: 24, mWindow: 10, lWindow: 5 };
// 7 days hourly from 100 h, active 08:00-18:00 of the series' own clock.
const t = Array.from({ length: 7 * 24 }, (_, i) => 100 + i);
const y = t.map((h, i) => ((h - 100) % 24 >= 8 && (h - 100) % 24 < 18 ? 100 : 5) + (i % 3));

describe('computeNPCRA with a missing time', () => {
	for (const [label, at] of [
		['first', 0],
		['last', t.length - 1],
		['interior', 50]
	]) {
		for (const missing of [null, '']) {
			it(`a missing ${label} time (${JSON.stringify(missing)}) matches the series without that row`, () => {
				const keep = (_, i) => i !== at;
				const ref = computeNPCRA(t.filter(keep), y.filter(keep), OPTS);
				const got = computeNPCRA(
					t.map((v, i) => (i === at ? missing : v)),
					y,
					OPTS
				);
				expect(got.nEpochs).toBe(ref.nEpochs);
				expect(got.IS).toBe(ref.IS);
				expect(got.IV).toBe(ref.IV);
				expect(got.M10onset).toBe(ref.M10onset);
				expect(got.profile).toEqual(ref.profile);
			});
		}
	}
});
