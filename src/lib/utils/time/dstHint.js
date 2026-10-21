// @ts-nocheck
// Does a zone-less time column look like it follows daylight saving in a zone, or like a
// logger that never changes its clock? (Per-column time zone, phase 3; plan sections 3.3
// point 3 and 3.10 row 3.) A HINT for the import dialog, never applied by itself.
//
// Read from the column's wall clocks (its text parsed as UTC, in file order) and the zone's
// changes inside the record:
//   follows  the sampling is regular and, exactly at a change, the clock skips the change's
//            length (spring: one step of interval + 1 h) or steps back by it into the repeated
//            hour (autumn: one step of interval - 1 h, landing inside it).
//   fixed    the sampling is regular and runs straight through a change: a value inside the
//            skipped hour (which does not exist in the zone), or the repeated hour passed only
//            once with the regular interval on both sides. The logger probably keeps standard
//            time all year: a fixed offset fits it.
// Regular: at least 80% of the steps between consecutive values equal the median step, and
// there are at least 8 values. Anything else: null (no hint).

import { zoneTransitions, normalizeZone, isFixedOffset, UTC_ZONE } from './zones.js';

const DAY_MS = 86400000;
const MIN_VALUES = 8;
const REGULAR_SHARE = 0.8;

function median(sorted) {
	const n = sorted.length;
	return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

/**
 * @param {ArrayLike<number>} walls the column's wall clocks as UTC ms, in file order (NaN or
 *   null for a blank or unreadable cell)
 * @param {string} zone an IANA zone (a fixed offset or 'utc' has no changes: null)
 * @returns {{ kind: 'follows'|'fixed', change: { at: number, before: number, after: number },
 *   intervalMs: number } | null}
 */
export function dstPatternHint(walls, zone) {
	const z = normalizeZone(zone);
	if (!z || z === UTC_ZONE || isFixedOffset(z)) return null;
	const w = [];
	for (let i = 0; i < (walls?.length ?? 0); i++) {
		const v = walls[i];
		if (typeof v === 'number' && Number.isFinite(v)) w.push(v);
	}
	if (w.length < MIN_VALUES) return null;
	const steps = [];
	for (let i = 1; i < w.length; i++) steps.push(w[i] - w[i - 1]);
	const d = median([...steps].sort((a, b) => a - b));
	if (!(d > 0) || d >= DAY_MS) return null;
	const regular = steps.filter((s) => s === d).length;
	if (regular < steps.length * REGULAR_SHARE) return null;

	let lo = Infinity;
	let hi = -Infinity;
	for (const v of w) {
		if (v < lo) lo = v;
		if (v > hi) hi = v;
	}
	// A wall clock is within 14 h of its instant, so a day either side finds every change.
	for (const change of zoneTransitions(z, lo - DAY_MS, hi + DAY_MS)) {
		const gapMs = (change.after - change.before) * 60000; // > 0 spring, < 0 autumn
		// The window of wall clocks the change affects: skipped (spring) or repeated (autumn).
		const from = change.at + Math.min(change.before, change.after) * 60000;
		const to = change.at + Math.max(change.before, change.after) * 60000;
		if (!(lo < from && hi >= to)) continue; // the record must run across it
		const inWindow = (v) => v >= from && v < to;
		if (gapMs > 0) {
			for (let i = 1; i < w.length; i++) {
				if (w[i - 1] < from && w[i] >= from) {
					if (w[i] - w[i - 1] === d + gapMs && !inWindow(w[i])) {
						return { kind: 'follows', change, intervalMs: d };
					}
					break;
				}
			}
			if (w.some(inWindow)) return { kind: 'fixed', change, intervalMs: d };
		} else {
			let backInto = false;
			let passes = 0;
			for (let i = 1; i < w.length; i++) {
				if (w[i] - w[i - 1] === d + gapMs && inWindow(w[i])) backInto = true;
				if (!inWindow(w[i - 1]) && inWindow(w[i])) passes++;
			}
			if (backInto) return { kind: 'follows', change, intervalMs: d };
			if (passes === 1 && w.some(inWindow)) return { kind: 'fixed', change, intervalMs: d };
		}
	}
	return null;
}
