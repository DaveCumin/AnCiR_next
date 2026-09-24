/**
 * Automatic onset/offset detection for the actogram phase markers, and the
 * phase unwrapping that turns the per-row detections into a tau estimate.
 *
 * Why unwrapping is needed. Each actogram row spans `periodHrs` (the row
 * length, usually 24 h). A marker used to be reported only as its hour within
 * the row, in [0, periodHrs), and tau was the least-squares slope of
 * (hour + row * periodHrs) on the row number. When the rhythm is not locked to
 * the row length the onsets drift across the row, and as soon as they cross the
 * row boundary (midnight, or the end of the plotted period) the hour jumps by a
 * whole row. The regression then sees a saw-tooth instead of a line and returns
 * roughly the row length whatever the rhythm is (24.02 h for a 22.25 h rhythm in
 * the manuscript's simulated example, 23.90 h and 12.00 h for circatidal data on
 * 24 h and 12 h rows). The high R squared hid the error because it was computed
 * on absolute time.
 *
 * What this module does instead:
 *  1. `matchTemplateMarkers` runs the same template match as before (N hours
 *     below / M hours above the percentile threshold, over this row and the
 *     next) but also keeps the ABSOLUTE time of every detection, so we know
 *     which day an onset really fell on.
 *  2. `unwrapOnsets` sorts the detections in time, merges the same onset found
 *     from two neighbouring rows, seeds tau from the median row-to-row change
 *     (each change wrapped into half a row either side, so a boundary crossing
 *     reads as a small step, not a whole row), and numbers the cycles by
 *     rounding each gap to a whole number of seed periods (so missing days and
 *     days with two onsets are handled). It re-seeds from the fitted slope until
 *     the numbering is stable.
 *  3. The fit points are returned in the same frame the regression always used
 *     (x = 1-indexed row, y = absolute time + periodHrs), with x being the
 *     UNWRAPPED row, so the slope is tau and every existing consumer of the
 *     regression still works.
 *  4. `lineCopyOffsets`, `wrapPhaseToRow` and `markerDisplayPosition` place the
 *     line, the reported phase and the markers on the double-plotted actogram,
 *     and `assessOnsetFit` flags estimates that should not be trusted.
 *
 * Everything here is pure (no Svelte state), so it is unit tested directly.
 */

import { linearRegression } from '$lib/components/plotbits/helpers/wrangleData';
import { runPeriodogramCalculation } from '$lib/utils/periodogram.js';

// ---------------------------------------------------------------------------
// Template matching
// ---------------------------------------------------------------------------

export function findCentileValue(data, centile) {
	// isNaN-ok: callers pass yByPeriod slices, which Actogram builds with an explicit
	// `tempy[i] != null` guard, so nulls never reach here.
	const filteredData = data.filter((value) => !isNaN(value) && value !== 0);
	// Sort the filtered data in ascending order
	const sortedData = filteredData.slice().sort((a, b) => a - b);
	// Calculate the index for the percentile
	const indexPercentile = Math.ceil((centile / 100) * sortedData.length) - 1;
	// Retrieve the value at the calculated index
	return sortedData[indexPercentile];
}

//Find the start index of the test data that best matches the template
export function findBestMatchIndex(test, template) {
	let bestMatchIndex = -1;
	let bestCorrelation = -Infinity;
	//cycle over the test data
	for (let i = 0; i <= test.length - template.length; i++) {
		let correlation = 0;
		// Calculate the cross-correlation at the current index
		for (let j = 0; j < template.length; j++) {
			correlation += test[i + j] * template[j];
		}
		// Update best match if the correlation is higher
		if (correlation > bestCorrelation) {
			bestCorrelation = correlation;
			bestMatchIndex = i;
		}
	}
	return bestMatchIndex;
}

/**
 * One detection per actogram row, by template matching.
 *
 * @param {Record<number, number[]>} xByPeriod Row index -> x values (hours, row r spans [r*P, (r+1)*P)).
 * @param {Record<number, number[]>} yByPeriod Row index -> y values, same shape.
 * @param {object} opts
 * @param {number} opts.periodHrs Row length P.
 * @param {number} opts.binSize Sampling interval of the series (hours).
 * @param {number} opts.hrsBefore Template hours before the transition (N).
 * @param {number} opts.hrsAfter Template hours after the transition (M).
 * @param {number} opts.centile Percentile threshold (0-100).
 * @param {'onset'|'offset'} opts.type
 * @returns {{hours: number[], times: number[]}} Per row: the detection's hour within
 *   the row, wrapped into [0, P) (what the marker list shows), and its absolute time
 *   (which may fall in the NEXT row, since the search spans two rows). NaN = none.
 */
export function matchTemplateMarkers(
	xByPeriod,
	yByPeriod,
	{ periodHrs, binSize, hrsBefore, hrsAfter, centile, type }
) {
	//Calculate the number of before and after bins that are needed
	const N = Math.round(hrsBefore / binSize);
	const M = Math.round(hrsAfter / binSize);

	//Fill the N and M with 1s and -1s (if onset; or -1s and 1s if offset)
	const template = [];
	for (let i = 0; i < N; i++) template.push(type === 'onset' ? -1 : 1);
	for (let i = 0; i < M; i++) template.push(type === 'onset' ? 1 : -1);

	const hours = [];
	const times = [];
	const periodKeys = Object.keys(xByPeriod).map(Number);
	if (periodKeys.length === 0) return { hours, times };
	const maxPeriod = Math.max(...periodKeys);

	for (let i = 0; i <= maxPeriod; i++) {
		// Skip periods without data
		if (!yByPeriod[i] || yByPeriod[i].length === 0) {
			hours.push(NaN);
			times.push(NaN);
			continue;
		}

		let periodsData, xData;
		// Use double-period matching if next period has data
		if (yByPeriod[i + 1] && yByPeriod[i + 1].length > 0) {
			periodsData = [...yByPeriod[i], ...yByPeriod[i + 1]];
			xData = [...xByPeriod[i], ...xByPeriod[i + 1]];
		} else {
			periodsData = [...yByPeriod[i]];
			xData = [...xByPeriod[i]];
		}

		const centileValue = findCentileValue(periodsData, centile);
		const aboveBelow = periodsData.map((value) => (value <= centileValue || isNaN(value) ? -1 : 1));

		const bestMatchIndex = findBestMatchIndex(aboveBelow, template) + Math.round((N + M) / 2);

		if (bestMatchIndex >= 0 && bestMatchIndex < xData.length) {
			const t = xData[bestMatchIndex];
			let rawHour = t - i * periodHrs;
			rawHour = ((rawHour % periodHrs) + periodHrs) % periodHrs;
			hours.push(rawHour);
			times.push(t);
		} else {
			hours.push(NaN);
			times.push(NaN);
		}
	}
	return { hours, times };
}

/**
 * Absolute time of each row's marker. Template detections carry their own
 * absolute time (`times`); a manual or edited marker only has its hour in row i,
 * so its time is i * P + hour.
 * @param {number[]} markers Per-row hour within the row (NaN = none).
 * @param {number} periodHrs
 * @param {number[]|null} [times] Per-row absolute times from `matchTemplateMarkers`.
 */
export function markerAbsoluteTimes(markers, periodHrs, times = null) {
	return markers.map((h, i) => {
		const t = times?.[i];
		if (Number.isFinite(t)) return t;
		return Number.isFinite(h) ? i * periodHrs + h : NaN;
	});
}

// ---------------------------------------------------------------------------
// Unwrapping
// ---------------------------------------------------------------------------

/** Wrap v into [-P/2, P/2). */
function wrapHalf(v, P) {
	return v - P * Math.floor(v / P + 0.5);
}

function median(arr) {
	if (arr.length === 0) return NaN;
	const s = arr.slice().sort((a, b) => a - b);
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Seed tau from the median row-to-row change of the onset's position in its row.
 * Each change is wrapped into [-P/2, P/2) so crossing the row boundary reads as a
 * small step. Only neighbouring rows are used when there are enough of them,
 * because a change over g rows can exceed half a row even for a modest drift.
 */
function seedTau(pts, P) {
	const byRow = pts.slice().sort((a, b) => a.row - b.row);
	const adjacent = [];
	const spaced = [];
	for (let j = 1; j < byRow.length; j++) {
		const g = byRow[j].row - byRow[j - 1].row;
		if (g < 1) continue;
		const change = wrapHalf(byRow[j].t - byRow[j - 1].t - g * P, P);
		(g === 1 ? adjacent : spaced).push(change / g);
	}
	const changes = adjacent.length >= 2 ? adjacent : adjacent.concat(spaced);
	const drift = median(changes);
	const tau = P + (Number.isFinite(drift) ? drift : 0);
	return tau > 0 ? tau : P;
}

/** Number the cycles of time-sorted onsets given a period estimate. */
function numberCycles(sorted, tau) {
	// Groups of detections of the same onset, each with its cycle number.
	const groups = [{ k: 0, ts: [sorted[0].t], rows: [sorted[0].row] }];
	let ambiguous = 0;
	for (let j = 1; j < sorted.length; j++) {
		const last = groups[groups.length - 1];
		const prevT = last.ts.reduce((a, b) => a + b, 0) / last.ts.length;
		const ratio = (sorted[j].t - prevT) / tau;
		const n = Math.round(ratio);
		if (Math.abs(ratio - n) > 0.25) ambiguous++;
		if (n <= 0) {
			// The same onset seen from two neighbouring rows (each row's search spans
			// that row and the next), or a spurious second detection within half a
			// cycle: merge it rather than count a cycle that did not happen.
			last.ts.push(sorted[j].t);
			last.rows.push(sorted[j].row);
		} else {
			groups.push({ k: last.k + n, ts: [sorted[j].t], rows: [sorted[j].row] });
		}
	}
	return { groups, ambiguous };
}

/**
 * Unwrap the selected per-row marker times into fit points whose slope is tau.
 *
 * @param {number[]} times Per-row absolute marker times (NaN = none), see `markerAbsoluteTimes`.
 * @param {object} opts
 * @param {number} opts.periodHrs Row length P.
 * @param {boolean[]} [opts.selected] Per-row selection (missing entries count as selected).
 * @returns {{xs: number[], ys: number[], n: number, nDetections: number,
 *   nMerged: number, nAmbiguous: number, seedTau: number}}
 *   xs = 1-indexed UNWRAPPED row of each distinct onset, ys = its absolute time + P.
 *   This is the frame the actogram regression has always used (y - x*P is the hour
 *   within row x), so the least-squares slope is tau.
 */
export function unwrapOnsets(times, { periodHrs, selected = [] }) {
	const P = periodHrs;
	const pts = [];
	for (let i = 0; i < times.length; i++) {
		if (!(selected[i] ?? true)) continue;
		if (!Number.isFinite(times[i])) continue;
		pts.push({ row: i, t: times[i] });
	}
	const empty = { xs: [], ys: [], n: 0, nDetections: pts.length, nMerged: 0, nAmbiguous: 0 };
	if (pts.length === 0 || !(P > 0)) return { ...empty, seedTau: NaN };

	const sorted = pts.slice().sort((a, b) => a.t - b.t);
	let tau = seedTau(pts, P);
	let result = null;
	let prevKey = '';
	// Re-number with the fitted slope until the numbering stops changing. Two or
	// three passes are enough in practice; the cap only guards against cycling.
	for (let pass = 0; pass < 5; pass++) {
		const { groups, ambiguous } = numberCycles(sorted, tau);
		// Anchor the unwrapped rows so the first onset sits in the row it fell in.
		const firstT = groups[0].ts.reduce((a, b) => a + b, 0) / groups[0].ts.length;
		const x0 = Math.floor(firstT / P) + 1;
		const xs = groups.map((g) => x0 + g.k);
		const ys = groups.map((g) => g.ts.reduce((a, b) => a + b, 0) / g.ts.length + P);
		result = {
			xs,
			ys,
			n: groups.length,
			nDetections: pts.length,
			nMerged: pts.length - groups.length,
			nAmbiguous: ambiguous,
			seedTau: tau
		};
		const key = groups.map((g) => g.k).join(',');
		if (key === prevKey || xs.length < 2) break;
		prevKey = key;
		const fitted = linearRegression(xs, ys).slope;
		if (!Number.isFinite(fitted) || fitted <= 0) break;
		tau = fitted;
	}
	return result;
}

// ---------------------------------------------------------------------------
// Placing things on the double-plotted actogram
// ---------------------------------------------------------------------------

/**
 * Where to draw a marker: the row its onset actually fell in, and its hour there.
 * (A row's search spans two rows, so its detection can belong to the next row.)
 */
export function markerDisplayPosition(time, periodHrs) {
	const row = Math.floor(time / periodHrs);
	return { row, hour: time - row * periodHrs };
}

/**
 * Horizontal offsets (hours) at which to draw copies of the fitted line.
 *
 * In row coordinates the unwrapped line is x(d) = intercept + d * (tau - P). A
 * point (x, row d) shows the same moment as (x + P, row d - 1) on a multi-plotted
 * actogram, so the line's copies are x(d) + m * tau for integer m. Returns every
 * m * tau whose copy crosses [0, span] between the top of row lo-1 and the bottom
 * of row hi (1-indexed lo..hi, as the line is drawn). The caller clips to the plot.
 */
export function lineCopyOffsets({ slope, intercept, periodHrs, span, lo, hi }) {
	if (!(slope > 0) || !Number.isFinite(intercept) || !(span > 0)) return [0];
	const dx = slope - periodHrs;
	const xa = intercept + (lo - 1) * dx;
	const xb = intercept + hi * dx;
	const minX = Math.min(xa, xb);
	const maxX = Math.max(xa, xb);
	// Copy m spans [minX + m*tau, maxX + m*tau]; keep it if that meets [0, span].
	const mLo = Math.ceil((0 - maxX) / slope);
	const mHi = Math.floor((span - minX) / slope);
	const out = [];
	for (let m = mLo; m <= mHi && out.length < 1000; m++) out.push(m * slope + 0); // + 0 turns -0 into 0
	return out;
}

/**
 * The time of day, in [0, P), of the line's onset in a row, given the unwrapped
 * position `hour` of the line in that row (which can be negative or beyond P once
 * the onsets have crossed the row boundary). The line's copies sit a whole tau
 * apart, so the position is wrapped by tau; when tau > P a row can hold no onset
 * at all, and the first one after the row's start is then reported on the clock
 * of the next day.
 */
export function wrapPhaseToRow(hour, tau, periodHrs) {
	if (!Number.isFinite(hour)) return NaN;
	const period = tau > 0 && Number.isFinite(tau) ? tau : periodHrs;
	let v = hour - period * Math.floor(hour / period); // [0, tau)
	if (v >= periodHrs) v -= periodHrs;
	return v;
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

export const MIN_ONSETS = 5;

/**
 * Lomb-Scargle peak of the series within [lo, hi] hours (coarse grid), used only to
 * question an onset tau that sits on the row length.
 */
export function periodogramPeak(xData, yData, binSize, lo, hi, step = 0.05) {
	if (!xData?.length || !yData?.length || !(hi > lo)) return NaN;
	const res = runPeriodogramCalculation({
		xData,
		yData,
		binSize,
		method: 'Lomb-Scargle',
		chiSquaredAlpha: 0.05,
		periodMin: lo,
		periodMax: hi,
		periodSteps: step
	});
	let best = -Infinity;
	let bestP = NaN;
	for (let i = 0; i < res.y.length; i++) {
		if (res.y[i] > best) {
			best = res.y[i];
			bestP = res.x[i];
		}
	}
	return bestP;
}

/**
 * Plain-language reasons not to trust an automatic tau (empty = no concerns).
 *
 * @param {object} args
 * @param {{n: number, nAmbiguous: number}} args.unwrap Result of `unwrapOnsets`.
 * @param {{slope: number, rmse: number}|null} args.reg The regression on those points.
 * @param {number} args.periodHrs Row length P.
 * @param {() => number} [args.periodogramPeak] Lazily computes the series' periodogram
 *   peak near P; only called when tau sits on the row length.
 */
export function assessOnsetFit({ unwrap, reg, periodHrs, periodogramPeak: peakFn }) {
	const warnings = [];
	if (!unwrap || !reg || !Number.isFinite(reg.slope)) return warnings;
	const P = periodHrs;
	const tau = reg.slope;
	if (unwrap.n < MIN_ONSETS) {
		warnings.push(
			`Only ${unwrap.n} onset${unwrap.n === 1 ? '' : 's'} in the fit; τ is poorly constrained.`
		);
	}
	// Residual scatter of a twelfth of a row (2 h on 24 h rows) means the markers
	// are not following one steady rhythm.
	if (Number.isFinite(reg.rmse) && reg.rmse > P / 12) {
		warnings.push(
			`Onsets scatter ${reg.rmse.toFixed(2)} h about the line; check the markers before using τ.`
		);
	}
	if (unwrap.n >= 3 && unwrap.nAmbiguous > 0.2 * (unwrap.n - 1)) {
		warnings.push(
			`${unwrap.nAmbiguous} gaps between onsets are not a whole number of cycles; the markers may be tracking more than one bout.`
		);
	}
	// A tau that lands on the row length is what the row boundary produced before
	// unwrapping, and is also what a row-locked detection artefact looks like. Ask
	// the periodogram whether the data agree.
	if (Math.abs(tau - P) < 0.15 && typeof peakFn === 'function') {
		const peak = peakFn();
		if (Number.isFinite(peak) && Math.abs(peak - tau) > 0.5) {
			warnings.push(
				`τ is within 0.15 h of the row length (${P} h) but the periodogram peaks at ${peak.toFixed(2)} h; the estimate may be locked to the rows.`
			);
		}
	}
	return warnings;
}
