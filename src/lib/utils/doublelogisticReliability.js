// @ts-nocheck
/**
 * When a double-logistic fit cannot pin down its active period (decision 2026-11-01).
 *
 * The 2026-10-28 fit review (utils/fitUnconfirmed.review.test.js, FIT-U3) found the duty cycle
 * poorly determined on weak rhythms: median duty error 0.27 to 0.37 at SNR 1 with a free period,
 * against 0.012 for the rectangular wave. The fits drift to very shallow rise and fall rates,
 * where the error surface is flat along the duty cycle, and with shallow edges one extra period
 * of tiling either side is too few for the A >= 0 canonical rewrite to give exactly the same
 * curve. The fit is NOT changed; this module only says when to distrust it.
 *
 * Two rules, either of which warns:
 *  - SHALLOW (periodic fits only): the rise and fall together take longer than one period. An
 *    edge's time is its 10% to 90% time, 2 ln 9 / k (a logistic 1 / (1 + e^(-k t)) is 0.1 at
 *    t = -ln 9 / k and 0.9 at +ln 9 / k). Past one period the curve never settles at its high
 *    or low level, so where the active phase starts and ends is not identified.
 *  - WEAK: R squared below 0.3, or a permutation p (when the test ran) of 0.05 or more.
 *
 * Thresholds from a seeded sweep (doublelogisticReliability.test.js header): together the rules
 * flag 93% of fits with a duty error over 0.1, 3.6% of fits with a duty error under 0.05 at an
 * SNR of 2 or more, and 10.7% of all fits with a duty error under 0.05.
 */

/** An edge's 10% to 90% time is this divided by its rate k. */
export const DL_EDGE_TIME_PER_RATE = 2 * Math.log(9);
/** Warn when rise time + fall time exceeds this many periods. */
export const DL_MAX_EDGE_FRACTION = 1;
/** Warn when R squared is below this. */
export const DL_MIN_R2 = 0.3;
/** Warn when a permutation p is at or above this. */
export const DL_ALPHA = 0.05;

/**
 * @param {object|null} result  a fitDoubleLogistic (or fitCurveModel 'doublelogistic') result
 * @param {{periodic?: boolean, pValue?: number}} [opts]
 * @returns {{shallow: boolean, weak: boolean, edgeHours: number, period: number,
 *   rSquared: number, pValue: number}|null}  null when there is no result to judge
 */
export function doubleLogisticReliability(result, { periodic = true, pValue = NaN } = {}) {
	const prm = result?.parameters;
	if (!prm) return null;
	const k1 = Number(prm.k1);
	const k2 = Number(prm.k2);
	const T = Number(prm.T);
	const edgeHours =
		k1 > 0 && k2 > 0 ? DL_EDGE_TIME_PER_RATE / k1 + DL_EDGE_TIME_PER_RATE / k2 : NaN;
	const shallow =
		periodic && T > 0 && Number.isFinite(edgeHours) && edgeHours > DL_MAX_EDGE_FRACTION * T;
	const rSquared = Number(result.rSquared);
	const p = Number(pValue);
	const weak =
		(Number.isFinite(rSquared) && rSquared < DL_MIN_R2) || (Number.isFinite(p) && p >= DL_ALPHA);
	return { shallow, weak, edgeHours, period: T, rSquared, pValue: p };
}

const fmt1 = (v) => String(Number(v.toFixed(1)));

/**
 * One plain-language warning per series whose fit cannot pin down the active period.
 * @param {{label: string, result: object|null, pValue?: number}[]} entries
 * @param {{periodic?: boolean, unit?: string}} [opts]  `unit` is the period's unit (x units)
 * @returns {string[]}
 */
export function doubleLogisticReliabilityWarnings(entries, { periodic = true, unit = 'h' } = {}) {
	const out = [];
	for (const e of entries ?? []) {
		const v = doubleLogisticReliability(e?.result, { periodic, pValue: e?.pValue });
		if (!v || (!v.shallow && !v.weak)) continue;
		const why = [];
		if (v.shallow)
			why.push(
				`the rise and fall together take ${fmt1(v.edgeHours)} ${unit}, longer than the ${fmt1(v.period)} ${unit} cycle`
			);
		if (v.weak) {
			const parts = [];
			if (Number.isFinite(v.rSquared))
				parts.push(
					`R² ${v.rSquared.toFixed(2)}${v.rSquared < DL_MIN_R2 ? `, below ${DL_MIN_R2}` : ''}`
				);
			if (Number.isFinite(v.pValue) && v.pValue >= DL_ALPHA)
				parts.push(`permutation p ${v.pValue.toPrecision(2)}, not significant`);
			why.push(parts.join('; '));
		}
		const head =
			v.shallow && v.weak
				? 'The rise and fall are too gradual, and the rhythm too weak, to pin down the active period'
				: v.shallow
					? 'The rise and fall are too gradual to pin down the active period'
					: 'The rhythm is too weak to pin down the active period';
		out.push(
			`${e.label}: ${head} (${why.join('; ')}); treat the duty cycle and the onset and offset as unreliable.`
		);
	}
	return out;
}

/**
 * Moving Analysis: one sentence per series counting the double-logistic windows whose fit
 * cannot pin down the active period, or null when none. `stats` is one series' per-window
 * stat arrays (computeMovingWindows: k1, k2, r2, and period when the fit is periodic).
 * @param {object} stats
 * @param {{periodic?: boolean, fixedPeriod?: number, label?: string}} [opts]
 * @returns {string|null}
 */
export function rollingDoubleLogisticWarning(
	stats,
	{ periodic = true, fixedPeriod = 24, label = '' } = {}
) {
	const r2 = stats?.r2 ?? [];
	let fitted = 0;
	let shallow = 0;
	let weak = 0;
	let either = 0;
	for (let w = 0; w < r2.length; w++) {
		if (!Number.isFinite(r2[w])) continue;
		fitted++;
		const T = periodic ? (stats.period?.[w] ?? fixedPeriod) : NaN;
		const v = doubleLogisticReliability(
			{ parameters: { k1: stats.k1?.[w], k2: stats.k2?.[w], T }, rSquared: r2[w] },
			{ periodic }
		);
		if (!v) continue;
		if (v.shallow) shallow++;
		if (v.weak) weak++;
		if (v.shallow || v.weak) either++;
	}
	if (!either) return null;
	const forSeries = label ? ` for ${label}` : '';
	const why = [];
	if (shallow) why.push(`${shallow} with the rise and fall together longer than the cycle`);
	if (weak) why.push(`${weak} with R² below ${DL_MIN_R2}`);
	const head =
		shallow && weak
			? 'The rise and fall are too gradual, or the rhythm too weak, to pin down the active period'
			: shallow
				? 'The rise and fall are too gradual to pin down the active period'
				: 'The rhythm is too weak to pin down the active period';
	return `${head} in ${either} of ${fitted} fitted window${fitted === 1 ? '' : 's'}${forSeries} (${why.join('; ')}); treat the onset and offset in those windows as unreliable.`;
}
