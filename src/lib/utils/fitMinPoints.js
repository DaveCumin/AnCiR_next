// @ts-nocheck
/**
 * The one "too few points to fit" rule for the waveform fits (the Cosinor node and every
 * model of the Fit waveform model node): a model with p free parameters needs at least
 * p + 1 rows where both x and y have a value, so one residual degree of freedom is left.
 * Below that the fit is refused with a warning that says why, rather than putting (say)
 * 4 parameters through 2 points and reporting them as a result.
 *
 * Ported as _fit_min_points / fit_param_count in tools/ancir_runtime.py and .R.
 */

const positiveInt = (v) => Math.max(1, Math.trunc(Number(v)) || 1);

/**
 * The free-parameter count of a waveform model under its options, and a phrase naming it.
 *
 * - cosinor, fixed period: mesor + 2 per harmonic; free period: mesor + 3 per curve
 *   (amplitude, frequency, phase).
 * - rectangular: mesor, amplitude, phase always; steepness (kappa), period and duty cycle
 *   unless fixed (rectwave.js freeIndices).
 * - doublelogistic: mesor, amplitude, onset, offset always; k1 and k2 unless fixed; the
 *   period when periodic and not fixed (doublelogistic.js freeIndices).
 *
 * @param {string} model  'cosinor' | 'rectangular' | 'doublelogistic'
 * @param {object} o  the model options (the node's args carry the same names)
 * @returns {{nParams: number, fitName: string, modelPhrase: string}|null}
 */
export function fitModelParameters(model, o = {}) {
	if (model === 'cosinor') {
		const fixed = !!o.useFixedPeriod;
		const terms = positiveInt(fixed ? o.nHarmonics : o.Ncurves);
		return {
			nParams: fixed ? 1 + 2 * terms : 1 + 3 * terms,
			fitName: 'cosinor',
			modelPhrase: fixed
				? `A fixed-period cosinor with ${terms} harmonic${terms > 1 ? 's' : ''}`
				: `A free-period cosinor with ${terms} curve${terms > 1 ? 's' : ''}`
		};
	}
	if (model === 'rectangular') {
		return {
			nParams: 3 + (o.fixKappa ? 0 : 1) + (o.fixOmega ? 0 : 1) + (o.fixDutyCycle ? 0 : 1),
			fitName: 'rectangular-wave',
			modelPhrase: o.fixOmega ? 'A fixed-period rectangular wave' : 'A free-period rectangular wave'
		};
	}
	if (model === 'doublelogistic') {
		const periodic = o.periodic ?? true;
		const freePeriod = periodic && !o.fixPeriod;
		return {
			nParams: 4 + (o.fixK1 ? 0 : 1) + (o.fixK2 ? 0 : 1) + (freePeriod ? 1 : 0),
			fitName: 'double-logistic',
			modelPhrase: !periodic
				? 'A non-periodic double logistic'
				: freePeriod
					? 'A free-period double logistic'
					: 'A fixed-period double logistic'
		};
	}
	return null;
}

/** The fewest valid rows `model` can be fitted to: its parameter count + 1. */
export function fitMinPoints(model, o = {}) {
	const m = fitModelParameters(model, o);
	return m ? m.nParams + 1 : 0;
}

/**
 * The warning for a series with too few rows where both x and y have a value to fit
 * `model` at all, or null when there are enough.
 *
 * @param {number} n  rows where both x and y are valid
 * @param {string} model
 * @param {object} o  the model options
 * @param {string} label  the series, already quoted (e.g. `"y"`)
 * @returns {string|null}
 */
export function fitTooFewPointsWarning(n, model, o, label) {
	const m = fitModelParameters(model, o);
	if (!m) return null;
	const needed = m.nParams + 1;
	if (n >= needed) return null;
	const have = n === 0 ? 'no rows' : `only ${n} row${n === 1 ? '' : 's'}`;
	return (
		`No ${m.fitName} fit for ${label}: it has ${have} where both x and y have a value. ` +
		`${m.modelPhrase} estimates ${m.nParams} parameters, so it needs at least ${needed}. ` +
		'Check that x and y are the intended columns, and how many of their cells are blank.'
	);
}
