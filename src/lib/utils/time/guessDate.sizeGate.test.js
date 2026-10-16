// The time-format guess reads every row up to 100,000 and about 5,000 evenly spaced
// rows past that (GUESS_FULL_SCAN_ROWS in TimeUtils.js). The verdict must not change
// when a recording crosses that size: the same clock, a few rows either side of the
// gate and well past it, gives the same format and the same day/month reading. Blank
// cells (in a run and singly) and an hour-long gap are included, as in logger exports.
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/core/core.svelte', () => ({ appState: { displayTimezone: 'utc' } }));

import { guessDateDetails } from './TimeUtils.js';

const p2 = (n) => String(n).padStart(2, '0');

/** n one-minute stamps from 3 Jan 2024 in `order`, with blanks and a gap. */
function stamps(n, order) {
	const out = [];
	let t = Date.UTC(2024, 0, 3);
	for (let i = 0; i < n; i++) {
		const d = new Date(t);
		const dm =
			order === 'day'
				? `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}`
				: `${p2(d.getUTCMonth() + 1)}/${p2(d.getUTCDate())}`;
		const blank = i % 997 === 3 || (i >= 5000 && i < 5060);
		out.push(
			blank ? '' : `${dm}/${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`
		);
		t += 60_000;
		if (i === 20_000) t += 3_600_000;
	}
	return out;
}

describe('time-format guess on both sides of the 100,000-row full scan', () => {
	for (const order of ['day', 'month']) {
		it(`${order}-first dates`, { timeout: 120_000 }, () => {
			const verdicts = [99_990, 100_010, 200_000].map((n) => {
				const { format, dayMonth } = guessDateDetails(stamps(n, order));
				return { format, ambiguous: dayMonth?.ambiguous ?? null };
			});
			expect(verdicts[0].format).toBe(order === 'day' ? 'DD/MM/YYYY HH:mm' : 'MM/DD/YYYY HH:mm');
			expect(verdicts[0].ambiguous).toBe(false);
			for (const v of verdicts) expect(v).toEqual(verdicts[0]);
		});
	}
});
