// @ts-nocheck
/**
 * Domain checks for the fit / trend nodes.
 *
 * WHY THIS EXISTS
 *
 * A fit can be perfectly computable in the arithmetic sense and still produce
 * nothing but NaN, because the model transforms its inputs and the data violates
 * the transform's domain. The case that prompted this module: TrendFit's
 * logarithmic model fits y = a + b·ln(x), a Sequence Column starting at 0 makes
 * Math.log(0) = -Infinity, and every reported number — R², RMSE, both
 * coefficients — came out NaN with NOTHING on screen to say why. A single
 * non-positive x is enough. The user could not tell the difference between "your
 * x contains a zero" and "the app is broken", and reasonably assumed the
 * constraint was the exponential model's (which is about y, not x).
 *
 * This is a DIFFERENT class of failure from the small-sample one that
 * `sampleSizePolicy.test.js` governs: not "computable but unreliable" because
 * there is too little data, but "not computable at all" because the data is
 * outside the model's domain.
 *
 * THE TIERS (same three as the small-sample audit)
 *
 *   REFUSE — the fit cannot mean anything. Do not compute it; report the reason.
 *            Log-domain violations and an underdetermined polynomial are here.
 *   WARN   — computable, but the result may be untrustworthy (a fit that came
 *            back non-finite, i.e. the optimiser gave up).
 *   SILENT — fine.
 *
 * WHY REFUSE RATHER THAN DROP-AND-WARN for the log domain: excluding the
 * offending points changes which data the fit describes, and a fit of a
 * different dataset presented under the user's column name is a worse failure
 * than no fit. Dropping is a decision only the user can make (shift the column,
 * filter the rows), so this module names both remedies instead of picking one.
 *
 * EVERY MESSAGE STATES THREE THINGS — the requirement, what the data actually
 * contains, and what to do about it. That is the ChiSquared → Fisher's exact
 * pattern, the only message in the codebase that already named a remedy.
 *
 * Pure functions only: no Svelte, no Column lookups, no imports. Callers pass
 * plain arrays so this is unit-testable and reusable from workers.
 */

export const REFUSE = 'refuse';
export const WARN = 'warn';

/**
 * Values arrive verbatim from columns, so numeric STRINGS are possible and must
 * be coerced. `null`, `undefined` and '' must NOT be: `Number(null)` is 0, which
 * would be counted as a domain violation ("your x contains a zero") when the
 * cell is simply empty. That trap has bitten this codebase before.
 */
function num(v) {
	if (v === null || v === undefined || v === '') return NaN;
	return typeof v === 'number' ? v : Number(v);
}

/**
 * Summarise how many finite entries are <= 0.
 * @returns {{finite:number, bad:number, firstIndex:number, firstValue:number}}
 */
export function nonPositiveSummary(values) {
	let finite = 0;
	let bad = 0;
	let firstIndex = -1;
	let firstValue = NaN;
	const arr = values ?? [];
	for (let i = 0; i < arr.length; i++) {
		const v = num(arr[i]);
		if (!Number.isFinite(v)) continue;
		finite++;
		if (v <= 0) {
			bad++;
			if (firstIndex === -1) {
				firstIndex = i;
				firstValue = v;
			}
		}
	}
	return { finite, bad, firstIndex, firstValue };
}

/**
 * "3 of 50 values ... are" / "1 of 24 values ... is" — kept in one place so every
 * message phrases it identically, and agrees with itself grammatically.
 */
function countPhrase(bad, finite) {
	return `${bad} of ${finite}`;
}

function isAre(bad) {
	return bad === 1 ? 'is' : 'are';
}

function positionPhrase(index, value) {
	return `first at row ${index + 1}, value ${value}`;
}

/**
 * Logarithmic trend: y = a + b·ln(x) log-transforms X, so every x must be > 0.
 * @param {Array} x
 * @param {string} [label] column name, for the message
 * @returns {?{tier:string, code:string, message:string, count:number}}
 */
export function checkLogarithmicDomain(x, label = 'x') {
	const s = nonPositiveSummary(x);
	if (s.bad === 0) return null;
	return {
		tier: REFUSE,
		code: 'log-x-domain',
		count: s.bad,
		message:
			`The logarithmic model fits y = a + b·ln(x), so every x value must be greater than 0. ` +
			`${countPhrase(s.bad, s.finite)} values in ${label} ${isAre(s.bad)} 0 or negative (${positionPhrase(s.firstIndex, s.firstValue)}), ` +
			`and ln of those is undefined, so no fit was computed. ` +
			`Shift ${label} so every value is positive (a Sequence Column starting at 1 rather than 0, or add an offset), ` +
			`filter out the non-positive rows, or choose the linear or polynomial model, which have no such restriction.`
	};
}

/**
 * Exponential trend: y = a·e^(bx) is fitted by log-transforming Y, so y must be > 0.
 */
export function checkExponentialDomain(y, label = 'y') {
	const s = nonPositiveSummary(y);
	if (s.bad === 0) return null;
	return {
		tier: REFUSE,
		code: 'log-y-domain',
		count: s.bad,
		message:
			`The exponential model fits y = a·e^(bx) by log-transforming y, so every y value must be greater than 0. ` +
			`${countPhrase(s.bad, s.finite)} values in ${label} ${isAre(s.bad)} 0 or negative (${positionPhrase(s.firstIndex, s.firstValue)}), ` +
			`and ln of those is undefined, so no fit was computed. ` +
			`Add a constant offset to ${label} so every value is positive (note that this changes the fitted a), ` +
			`filter out the non-positive rows, or choose the linear or polynomial model.`
	};
}

/**
 * A degree-D polynomial has D+1 coefficients. With n <= D usable points the
 * normal equations are RANK-DEFICIENT: infinitely many polynomials pass exactly
 * through the points, and Gaussian elimination returns whichever one the
 * pivoting happens to land on. Measured against the real `fitTrendSync`: this
 * does not produce NaN — it produces R² = 1, RMSE ≈ 0 and arbitrary
 * coefficients, which is worse, because it looks like a perfect fit.
 *
 * n === D+1 is EXACT INTERPOLATION: a unique curve, still meaningless as an
 * estimate. That is left to the existing small-sample warning in the nodes,
 * which already says so; duplicating it here would be a second source of truth
 * for that threshold.
 */
export function checkPolynomialDegree(n, degree) {
	const d = Math.floor(Number(degree));
	const nn = Math.floor(Number(n));
	if (!Number.isFinite(d) || !Number.isFinite(nn)) return null;
	if (nn > d) return null;
	return {
		tier: REFUSE,
		code: 'poly-degree',
		count: nn,
		message:
			`A degree-${d} polynomial has ${d + 1} coefficients and needs more points than that to estimate them. ` +
			`Only ${nn} usable point${nn === 1 ? '' : 's'} ${nn === 1 ? 'was' : 'were'} available, so the fit is underdetermined: ` +
			`infinitely many curves pass exactly through these points, the coefficients shown would be an arbitrary one of them, ` +
			`and R² would be 1 whatever the data says. No fit was computed for that reason. ` +
			`Lower the degree to at most ${Math.max(1, nn - 2)}, choose the linear model, or supply more data.`
	};
}

/**
 * Every model here estimates a slope against x, which is undefined when x has no
 * spread: the regression divides by the variance of x (or of ln x). Reported
 * separately from the small-sample checks because it can happen at ANY n.
 */
export function checkXVariation(x, label = 'x') {
	const arr = (x ?? []).map(num).filter((v) => Number.isFinite(v));
	if (arr.length < 2) return null;
	const first = arr[0];
	if (arr.some((v) => v !== first)) return null;
	return {
		tier: REFUSE,
		code: 'x-constant',
		count: arr.length,
		message:
			`Fitting a trend needs x to vary, because the slope is estimated against the spread of x. ` +
			`All ${arr.length} usable x values in ${label} are the same value (${first}), so the slope is undefined and no fit was computed. ` +
			`Choose a different x column, or check that the intended x column was selected rather than a constant or an index that never changes.`
	};
}

/**
 * All the TrendFit-family domain checks for one x/y pair, in one call.
 *
 * @param {Array} x usable x values (already paired and filtered by the caller)
 * @param {Array} y usable y values
 * @param {string} model 'linear' | 'exponential' | 'logarithmic' | 'polynomial'
 * @param {number} polyDegree
 * @param {{xLabel?:string, yLabel?:string}} [labels]
 * @returns {Array<{tier:string, code:string, message:string, count:number}>}
 */
export function checkTrendFitDomain(x, y, model, polyDegree = 2, labels = {}) {
	const xLabel = labels.xLabel ?? 'x';
	const yLabel = labels.yLabel ?? 'y';
	const issues = [];
	if (model === 'logarithmic') {
		const i = checkLogarithmicDomain(x, xLabel);
		if (i) issues.push(i);
	} else if (model === 'exponential') {
		const i = checkExponentialDomain(y, yLabel);
		if (i) issues.push(i);
	} else if (model === 'polynomial') {
		const n = (x ?? []).map(num).filter((v) => Number.isFinite(v)).length;
		const i = checkPolynomialDegree(n, polyDegree);
		if (i) issues.push(i);
	}
	const v = checkXVariation(x, xLabel);
	if (v) issues.push(v);
	return issues;
}

/** True when at least one issue says the fit must not be computed. */
export function shouldRefuse(issues) {
	return (issues ?? []).some((i) => i?.tier === REFUSE);
}

/** Just the message strings, for pushing onto a node's `warnings` array. */
export function issueMessages(issues) {
	return (issues ?? []).map((i) => i.message);
}

/**
 * Last line of defence: a fit that RAN but came back with non-finite numbers.
 * Iterative fits (cosinor, rectangular wave, double logistic) have no
 * convergence flag to read, so the observable symptom is the check: R² or RMSE
 * that is not a finite number means the user is looking at dashes or NaN, and
 * they deserve a sentence about it rather than nothing.
 *
 * WARN, not REFUSE: by the time this is reachable the fit has already been
 * attempted, and some of its outputs may still be informative.
 *
 * @param {?object} result a fit result, or null when the fit returned nothing
 * @param {string} modelLabel human-readable model name for the message
 */
export function checkFitOutputFinite(result, modelLabel = 'This model') {
	if (result == null) {
		return {
			tier: WARN,
			code: 'fit-failed',
			count: 0,
			message:
				`${modelLabel} returned no fit at all: the optimiser could not produce parameters for this data. ` +
				`Any reported statistics are blank for that reason, not because the values are zero. ` +
				`Try fixing one of the parameters (e.g. the period), giving a longer stretch of data, or a simpler model.`
		};
	}
	const r2 = Number(result.rSquared);
	const rmse = Number(result.rmse);
	if (Number.isFinite(r2) && Number.isFinite(rmse)) return null;
	return {
		tier: WARN,
		code: 'fit-nonfinite',
		count: 0,
		message:
			`${modelLabel} produced no usable numbers: R² and RMSE came back as NaN, which means the fit did not converge ` +
			`(or an input value put the model outside its domain) rather than that the fit is poor. ` +
			`Check the x and y columns for zeros, negatives or extreme values that this model cannot take, ` +
			`fix a parameter to give the optimiser less to search, or choose a different model.`
	};
}

/**
 * The per-y-column form of `checkFitOutputFinite`, for the multi-input fit nodes.
 * Each entry is `{ label, result }` where `result` is whatever object carries
 * `rSquared`/`rmse` for that column (the nodes name it `fitResult` or
 * `fittedData`), or null/undefined when the fit returned nothing.
 *
 * Columns that fitted cleanly contribute nothing, so a node with five y inputs
 * and one bad column shows exactly one line naming that column.
 *
 * @param {Array<{label:string, result:?object}>} entries
 * @param {string} modelLabel e.g. 'The cosinor fit'
 * @returns {string[]} messages, ready to push onto a node's `warnings`
 */
export function checkFitResultsFinite(entries, modelLabel = 'The fit') {
	const out = [];
	for (const entry of entries ?? []) {
		if (!entry) continue;
		const label = entry.label ? `${modelLabel} for ${entry.label}` : modelLabel;
		const issue = checkFitOutputFinite(entry.result, label);
		if (issue) out.push(issue.message);
	}
	return out;
}
