// The period range (h) a NEW free-period fit (Cosinor, Rectangular wave, Double logistic, Fit
// waveform model) starts from on a TIME x: 1 to 30 h since v82.30 (1 to 48 h before).
//
// Its own dependency-free module so the MCP draft normalizer (mcp/src/emit/normalizer.js, also
// bundled into the Worker and run by plain `node --test`) can give a new node in a draft the
// same range as the palette does, without pulling in the fitting code: the time-x range, and for
// a number x the Nyquist period to the record span (`autoPeriodRange`, `resolvePeriodRange`).
// The app reads them through utils/periodUnits.js and utils/cosinor.js, which re-export them.
//
// Not cosinor.js FREE_PERIOD_DEFAULTS (1 to 48 h): that is the fallback for a node with no
// stored range at all, which saved sessions were computed with.
export const NEW_NODE_TIME_PERIOD_RANGE = Object.freeze({ minPeriod: 1, maxPeriod: 30 });

/**
 * Resolve the period range the free fit may use.
 *
 * `minPeriod` / `maxPeriod` are in the units of `t` (hours for time columns).
 * A missing value falls back to what the sampling supports: the Nyquist period
 * (2 × median spacing) at the short end, the record span at the long end. The
 * short end is never allowed below the Nyquist period, where a cosine aliases.
 *
 * @returns {{minPeriod:number, maxPeriod:number, nyquist:number, span:number} | null}
 *   null when the resolved range is empty (min ≥ max) or `t` has < 2 distinct values.
 */
export function resolvePeriodRange(t, minPeriod, maxPeriod) {
	const ts = [];
	for (const v of t ?? []) if (Number.isFinite(v)) ts.push(v);
	if (ts.length < 2) return null;
	ts.sort((a, b) => a - b);
	const span = ts[ts.length - 1] - ts[0];
	const diffs = [];
	for (let i = 1; i < ts.length; i++) {
		const d = ts[i] - ts[i - 1];
		if (d > 0) diffs.push(d);
	}
	if (!(span > 0) || diffs.length === 0) return null;
	diffs.sort((a, b) => a - b);
	const mid = diffs.length >> 1;
	const medianDt = diffs.length % 2 ? diffs[mid] : (diffs[mid - 1] + diffs[mid]) / 2;
	const nyquist = 2 * medianDt;
	const userMin = Number(minPeriod);
	const userMax = Number(maxPeriod);
	const lo = Number.isFinite(userMin) && userMin > 0 ? Math.max(userMin, nyquist) : nyquist;
	const hi = Number.isFinite(userMax) && userMax > 0 ? userMax : span;
	if (!(hi > lo)) return null;
	return { minPeriod: lo, maxPeriod: hi, nyquist, span };
}

/** `v` rounded UP to 3 significant figures, so a rounded bound never cuts into the range. */
function ceil3(v) {
	if (!(v > 0) || !Number.isFinite(v)) return v;
	const step = 10 ** (Math.floor(Math.log10(v)) - 2);
	return Number((Math.ceil(v / step - 1e-9) * step).toPrecision(3));
}

/**
 * The period range a node that follows its x starts from, or null when x cannot give one.
 * Time x: NEW_NODE_TIME_PERIOD_RANGE (1 to 30 h). Number x: the Nyquist period to the record span,
 * each rounded up to 3 significant figures.
 * @param {{type?: string, getData?: () => any[]} | null} col
 * @returns {{minPeriod: number, maxPeriod: number} | null}
 */
export function autoPeriodRange(col) {
	if (!col) return null;
	if (col.type === 'time') return { ...NEW_NODE_TIME_PERIOD_RANGE };
	const data = col.getData?.() ?? [];
	const nums = [];
	for (const v of data) {
		if (v == null || v === '') continue;
		const n = Number(v);
		if (Number.isFinite(n)) nums.push(n);
	}
	const r = resolvePeriodRange(nums, null, null);
	if (!r) return null;
	const minPeriod = ceil3(r.nyquist);
	const maxPeriod = ceil3(r.span);
	return maxPeriod > minPeriod ? { minPeriod, maxPeriod } : null;
}
