// @ts-nocheck
// What every node PORT expects (inputs) or produces (outputs), in one or two plain sentences.
//
// The display LABEL of an output ("Acrophase (h)", "Cosinor fit: A1") lives in outputLabels.js;
// this module adds the sentence that follows it: what the value means, its units and frame
// (hours vs the x column's units, clock time vs hours after the first sample, family-wise vs
// per-test p), its shape (one value per wired series, one row per pair, a full-length column),
// and when it is blank. Inputs say which kind of column fits (time, numbers, categories), one or
// many, and what happens when the port is left empty.
//
// ONE place for the prose, shared by:
//   - the canvas port tooltips and their screen-reader descriptions (every node card, through
//     describeNodePort; components/workflow/portLabels.js puts it after the port's name);
//   - the Data panel's node rows (views/NodeSourceItem.svelte);
//   - the node manifest (static/nodes.json, each port's `description`) and through it the
//     handbook's Node Reference;
//   - the MCP catalogue's detail views (list_capabilities name:/detail:"full", `ports`).
//
// Style: sentence case, short, plain words, units explicit, no em-dashes. A description never
// repeats the port's label (the tooltip already shows it) and never names a wired column (the
// label does that: "Residuals: A1").
//
// Pure: data, plus duck-typed reads of a node object, with NO imports, so tests, the manifest
// builder, the MCP engine and every node card can use it without an import cycle.
//
// Adding a node: give it an entry in NODE_PORT_DESCRIPTIONS (table-processes),
// PROCESS_PORT_DESCRIPTIONS (column transforms) or PLOT_PORT_DESCRIPTIONS (plots). The guard
// (portDescriptions.test.js) fails for any manifest port, any dynamic stat key and any out key
// in the shipped demos without a description.

// ---------------------------------------------------------------------------------------------
// Context helpers. ctx: { args, colType(id) } (the same shape outputLabels uses).
// ---------------------------------------------------------------------------------------------

/** 'time' | 'number' | null: the type of the column wired to `field` (default xIN). */
function xType(ctx, field = 'xIN') {
	const id = Number(ctx?.args?.[field]);
	if (!(id >= 0) || typeof ctx?.colType !== 'function') return null;
	const t = ctx.colType(id);
	return t ? (t === 'time' ? 'time' : 'number') : null;
}

/** "hours", "x units", or both when the x column is not known (manifest, MCP). */
function xUnit(ctx, field) {
	const t = xType(ctx, field);
	if (t === 'time') return 'hours';
	if (t === 'number') return 'x units';
	return 'hours (x units for a number x)';
}

/** "per hour" / "per x unit" / both. */
function perXUnit(ctx, field) {
	const t = xType(ctx, field);
	if (t === 'time') return 'per hour';
	if (t === 'number') return 'per x unit';
	return 'per hour (per x unit for a number x)';
}

const isClock = (ctx) => ctx?.args?.phaseReference === 'clock';

/** The frame a phase output is read in (utils/phaseReference.js). */
function phaseFrame(ctx, field) {
	if (isClock(ctx)) return 'as clock time of day, in hours';
	const t = xType(ctx, field);
	if (t === 'time') return 'in hours after the first sample';
	if (t === 'number') return 'in x units from x = 0';
	return 'in hours after the first sample (x units from 0 for a number x)';
}

/** The NPCRA frame: a number x is read as hours, so it never reads in x units. */
const hoursFrame = (ctx) =>
	isClock(ctx) ? 'as clock time of day, in hours' : 'in hours after the first sample';

/** Window lengths of the NPCRA metrics (M10 / L5 keep their keys whatever the hours). */
function npcraWindow(ctx, which) {
	const a = ctx?.args ?? {};
	const raw = Number(which === 'M' ? (a.mWindow ?? a.npcraMWindow) : (a.lWindow ?? a.npcraLWindow));
	return Number.isFinite(raw) && raw > 0 ? raw : which === 'M' ? 10 : 5;
}

const call = (v, ctx) => (typeof v === 'function' ? v(ctx) : v);

// ---------------------------------------------------------------------------------------------
// Shared sentences. One string per idea, so the same port reads the same on every node.
// ---------------------------------------------------------------------------------------------

const PER_SERIES = 'One value per wired y column.';
const X_TIME_OR_NUMBERS = 'One time column (as hours from the first sample) or number column.';
const NEED_X = 'Required; nothing runs until it is wired.';
const Y_NUMBERS_MANY = 'Number columns, one or more; each is analysed on its own.';
const RESIDUALS =
	'Observed y minus the fitted value at every input row, in y units. Same length as the input; blank where x or y is blank.';
const PERM_P =
	'Permutation-test p: the share of fits to shuffled data as good as the real one. Blank unless the test is on.';
const PERM_STATS =
	'The statistic (R² or RMSE) of every permuted fit, one row per permutation. Empty unless the permutation test is on.';
const R2 = 'R²: the share of the variance in y that the fit explains, 0 to 1.';
const RMSE_N = 'Root mean square error, sqrt(SS / n), in y units.';
const RESIDUAL_SE_TEXT = 'Residual standard error, sqrt(SS / (n - p)), in y units.';
const CURVE_X =
	'x of the fitted curves: the input rows with both x and y, or the output x set in the panel. Time for a time x, else numbers.';
/** "<what>, at the fit x rows, in y units. Shorter than the input when y has blanks." */
const curveY = (what) =>
	`${what}, at the fit x rows, in y units. Shorter than the input when y has blanks.`;
const CI_LOW_HIGH = (end) => `${end} end of the CI (the level set in the panel, 95% by default).`;

// ---------------------------------------------------------------------------------------------
// Statistic sentences, keyed like outputLabels' STAT_LABELS. Used by the per-stat families
// (Rhythmicity's stat_<stat>, Moving window's <colId>_<stat>) and as the fallback for a shared
// key on any node.
// ---------------------------------------------------------------------------------------------

const PEAK_POWER = (ctx) => {
	const m = ctx?.args?.pgMethod;
	if (m === 'Chi-squared') return 'Qp (chi-squared periodogram power) at the peak.';
	if (m === 'Enright')
		return 'Enright Ap at the peak: the SD of the period-folded means, in y units.';
	if (m === 'Lomb-Scargle') return 'Normalised Lomb-Scargle power at the peak (no units).';
	return 'Power at the peak: unitless for Lomb-Scargle, Qp for Chi-squared, y units for Enright.';
};

export const STAT_DESCRIPTIONS = {
	pvalue: 'p-value of the test; not corrected for multiple tests.',
	perm_pvalue: PERM_P,
	r2: R2,
	rsquared: R2,
	rmse: (ctx) =>
		ctx?.args?.analysis === 'cosinor' && ctx?.args?.useFixedPeriod ? RESIDUAL_SE_TEXT : RMSE_N,
	rmse_n: RMSE_N,
	n: 'Number of values used.',
	period: (ctx) => `Fitted period, in ${xUnit(ctx)}.`,
	mesor: (ctx) => {
		const a = ctx?.args?.analysis;
		if (a === 'rectfit')
			return 'Midline of the rectangular wave, halfway between its high and low levels, in y units.';
		if (a === 'doublelogistic')
			return 'Baseline (rest level) the activity bout rises from, in y units.';
		return 'MESOR: the rhythm-adjusted mean of the fit, in y units.';
	},
	amplitude: 'Amplitude of the fit (half the peak-to-trough range for a cosine), in y units.',
	rel_amplitude:
		'Harmonic 1 amplitude divided by the MESOR, no units. Blank when the MESOR is near 0.',
	acrophase: (ctx) => `Time of the fitted peak, ${phaseFrame(ctx)}.`,
	bathyphase: (ctx) => `Time of the fitted trough, ${phaseFrame(ctx)}.`,
	duty_cycle: 'Fraction of each cycle spent at the high (active) level, 0 to 1.',
	kappa: 'Edge sharpness of the rectangular wave; larger is more square.',
	onset: (ctx) => `Time the activity bout starts (the rise), ${phaseFrame(ctx)}.`,
	offset: (ctx) => `Time the activity bout ends (the fall), ${phaseFrame(ctx)}.`,
	k1: (ctx) => `Steepness of the rise, ${perXUnit(ctx)}.`,
	k2: (ctx) => `Steepness of the fall, ${perXUnit(ctx)}.`,
	slope: (ctx) => `Slope of the linear trend, in y units ${perXUnit(ctx)}.`,
	intercept: 'Value of the linear trend at x = 0 (the first sample for a time x), in y units.',
	a: 'Coefficient a: the scale of y = a·e^(b·x) (exponential) or the offset of y = a + b·ln(x) (logarithmic).',
	b: 'Coefficient b: the growth rate of y = a·e^(b·x) (exponential) or the slope on ln(x) of y = a + b·ln(x) (logarithmic).',
	IS: 'Interdaily stability, 0 to 1: how alike the days are. Higher is more stable.',
	IV: 'Intradaily variability, about 0 to 2: how fragmented the rhythm is within a day. Higher is more fragmented.',
	RA: 'Relative amplitude, (M10 - L5) / (M10 + L5): 0 to 1 for non-negative data.',
	M10: (ctx) =>
		`Mean of the most active ${npcraWindow(ctx, 'M')} h of the average day, in y units.`,
	L5: (ctx) =>
		`Mean of the least active ${npcraWindow(ctx, 'L')} h of the average day, in y units.`,
	M10onset: (ctx) =>
		`Start of the most active ${npcraWindow(ctx, 'M')} h window, ${hoursFrame(ctx)}, folded onto the period.`,
	L5onset: (ctx) =>
		`Start of the least active ${npcraWindow(ctx, 'L')} h window, ${hoursFrame(ctx)}, folded onto the period.`,
	CFI: 'Mean of IS, (2 - IV) / 2 and RA, each clamped to 0 to 1. Higher is a stronger rhythm; blank if a part is missing.',
	peak_period: (ctx) =>
		`Period of the highest peak, in ${xUnit(ctx)}. Blank when there is no peak.`,
	peak_power: PEAK_POWER,
	peak_pvalue:
		'Family-wise p of the Chi-squared peak, corrected for every period tested. At or above alpha the peak is not significant.',
	peak_frequency: (ctx) => `Frequency of the highest FFT peak, in cycles ${perXUnit(ctx)}.`,
	peak_magnitude: 'Amplitude of the highest FFT peak, in y units.',
	peak_lag: (ctx) =>
		`Lag of the first clear autocorrelation peak after the first dip below 0, in ${xUnit(ctx)}.`,
	peak_correlation: 'Autocorrelation r at that peak, -1 to 1.',
	mean: 'Mean, in y units.',
	sd: 'Sample standard deviation (n - 1), in y units.',
	percentile: (ctx) => {
		const p = Number(ctx?.args?.summaryPercentile ?? 50);
		return `The ${Number.isFinite(p) ? p : 50}th percentile (linear interpolation; 50 is the median), in y units.`;
	}
};

/** Sentence for a statistic key, covering the numbered families (H1_…, C2_…, c0). */
export function statDescription(stat, ctx = {}) {
	if (typeof stat !== 'string') return null;
	if (Object.hasOwn(STAT_DESCRIPTIONS, stat)) return call(STAT_DESCRIPTIONS[stat], ctx);
	let m = /^H(\d+)_(amplitude|acrophase)$/.exec(stat);
	if (m) {
		return m[2] === 'amplitude'
			? `Amplitude of harmonic ${m[1]} (period / ${m[1]}), in y units.`
			: `Peak time of harmonic ${m[1]}, ${phaseFrame(ctx)}, folded onto period / ${m[1]}.`;
	}
	m = /^C(\d+)_(period|amplitude|phase|acrophase)$/.exec(stat);
	if (m) {
		const c = m[1];
		return {
			period: `Fitted period of cosine component ${c}, in ${xUnit(ctx)}.`,
			amplitude: `Amplitude of cosine component ${c}, in y units.`,
			phase: `Phase angle φ of component ${c} in A·cos(ωt + φ), in radians at t = 0. Its peak time is the matching acrophase.`,
			acrophase: `Peak time of cosine component ${c} nearest the window centre, ${phaseFrame(ctx)}, folded onto 24 h.`
		}[m[2]];
	}
	m = /^c(\d+)$/.exec(stat);
	if (m) return `Polynomial coefficient c${m[1]}: multiplies x^${m[1]}.`;
	return null;
}

// ---------------------------------------------------------------------------------------------
// Table-process nodes.
//
//   inputs   { <nodeSpec input name>: text | (ctx) => text }
//   outputs  { <out key>: text | (ctx) => text }. A key ending in `*` is a per-input family:
//            `cosinory_*` covers every `cosinory_<colId>` (the manifest's dynamicPrefix).
//   special  [{ name, re, text(m, ctx) }] key shapes with no prefix of their own; `name` is
//            the manifest output it stands for (MovingAnalysis `stats_*`, Split `segments`).
// ---------------------------------------------------------------------------------------------

/** A metric output that holds one value per wired y: "<what>. One value per wired y column." */
const perY = (text) => (ctx) => `${call(text, ctx)} ${PER_SERIES}`;

// The fixed-period cosinor (Cosinor's default is free; Fit waveform model's is fixed).
const cosinorFixed = (ctx, dflt) => ctx?.args?.useFixedPeriod ?? dflt;
const multiH = (ctx, dflt) => cosinorFixed(ctx, dflt) && Number(ctx?.args?.nHarmonics ?? 1) > 1;

const cosinorPorts = (dflt) => ({
	period: perY((ctx) =>
		cosinorFixed(ctx, dflt)
			? `The fixed period the cosine was fitted at, in ${xUnit(ctx)}.`
			: `Fitted period of the first cosine, in ${xUnit(ctx)}.`
	),
	mesor: perY('MESOR: the rhythm-adjusted mean of the fit, in y units.'),
	amplitude: perY((ctx) =>
		multiH(ctx, dflt)
			? 'Half the peak-to-trough range of the whole fitted waveform (all harmonics), in y units.'
			: 'Half the peak-to-trough range of the fitted cosine, in y units.'
	),
	acrophase: perY((ctx) =>
		multiH(ctx, dflt)
			? `Time of the whole waveform's peak (orthophase), ${phaseFrame(ctx)}.`
			: `Time of the fitted peak, ${phaseFrame(ctx)}.`
	),
	amplitude_h1: perY(
		'Amplitude of harmonic 1 alone, in y units. Same as the amplitude unless there are more harmonics.'
	),
	acrophase_h1: perY((ctx) => `Peak time of harmonic 1 alone, ${phaseFrame(ctx)}.`),
	rmse: perY((ctx) =>
		cosinorFixed(ctx, dflt) && (ctx?.args?.model ?? 'cosinor') === 'cosinor'
			? RESIDUAL_SE_TEXT
			: RMSE_N
	)
});

const COSINOR = cosinorPorts(false);
const FIT_COSINOR = cosinorPorts(true);
const fitModel = (ctx) => ctx?.args?.model ?? 'cosinor';

export const NODE_PORT_DESCRIPTIONS = {
	// ---- Fitting ---------------------------------------------------------------------------
	Cosinor: {
		inputs: {
			xIN: `${X_TIME_OR_NUMBERS} Periods and phases come out in its units. ${NEED_X}`,
			yIN: `${Y_NUMBERS_MANY} A column with too few rows for the model is skipped with a warning.`
		},
		outputs: {
			cosinorx: CURVE_X,
			'cosinory_*': curveY('The fitted cosinor (all harmonics, or all cosines for a free period)'),
			'resid_*': RESIDUALS,
			period: COSINOR.period,
			mesor: COSINOR.mesor,
			amplitude: COSINOR.amplitude,
			acrophase: COSINOR.acrophase,
			bathyphase: perY((ctx) =>
				multiH(ctx, false)
					? `Time of the whole waveform's trough, ${phaseFrame(ctx)}.`
					: `Time of the fitted trough (half a period after the peak), ${phaseFrame(ctx)}.`
			),
			amplitude_h1: COSINOR.amplitude_h1,
			acrophase_h1: COSINOR.acrophase_h1,
			bathyphase_h1: perY((ctx) => `Trough time of harmonic 1 alone, ${phaseFrame(ctx)}.`),
			amplitude_ciLow: perY(`${CI_LOW_HIGH('Lower')} Harmonic 1 amplitude; fixed period only.`),
			amplitude_ciHigh: perY(`${CI_LOW_HIGH('Upper')} Harmonic 1 amplitude; fixed period only.`),
			acrophase_ciLow: perY(
				`${CI_LOW_HIGH('Lower')} Harmonic 1 peak time; blank for a free period or no clear rhythm.`
			),
			acrophase_ciHigh: perY(
				`${CI_LOW_HIGH('Upper')} Harmonic 1 peak time; blank for a free period or no clear rhythm.`
			),
			rsquared: perY(R2),
			pvalue: perY(
				'p of the zero-amplitude F-test (is there a rhythm). Fixed period only. Not corrected across series.'
			),
			perm_pvalue: perY(PERM_P),
			phase_angle: perY(
				(ctx) =>
					`Peak time minus the reference time set in the panel, in ${xUnit(ctx)}, within half a period. Positive: the peak is later.`
			),
			// Curves 2..Ncurves of a free-period fit (curve 1 is on the ports above).
			'period_c*': perY((ctx) => `Fitted period of a further cosine curve, in ${xUnit(ctx)}.`),
			'amplitude_c*': perY('Amplitude of a further cosine curve, in y units.'),
			'acrophase_c*': perY((ctx) => `Peak time of a further cosine curve, ${phaseFrame(ctx)}.`),
			'bathyphase_c*': perY((ctx) => `Trough time of a further cosine curve, ${phaseFrame(ctx)}.`)
		},
		special: [
			{
				name: 'period_c*',
				re: /^(period|amplitude|acrophase|bathyphase)_c(\d+)$/,
				text: (m, ctx) =>
					perY(
						{
							period: `Fitted period of cosine curve ${m[2]}, in ${xUnit(ctx)}.`,
							amplitude: `Amplitude of cosine curve ${m[2]}, in y units.`,
							acrophase: `Peak time of cosine curve ${m[2]}, ${phaseFrame(ctx)}.`,
							bathyphase: `Trough time of cosine curve ${m[2]} (half its period after the peak), ${phaseFrame(ctx)}.`
						}[m[1]]
					)(ctx)
			}
		]
	},
	FitFunction: {
		inputs: {
			xIN: `${X_TIME_OR_NUMBERS} Periods, phases and rates come out in its units. ${NEED_X}`,
			yIN: `${Y_NUMBERS_MANY} A column with too few rows for the model is skipped with a warning.`
		},
		outputs: {
			fitx: CURVE_X,
			'fity_*': curveY('The fitted model (cosinor, rectangular wave or double logistic)'),
			'resid_*': RESIDUALS,
			'permstats_*': PERM_STATS,
			r2: perY(R2),
			rmse: FIT_COSINOR.rmse,
			rmse_n: perY(`${RMSE_N} Fixed-period cosinor only, beside its residual SE.`),
			perm_pvalue: perY(PERM_P),
			period: perY((ctx) => {
				const m = fitModel(ctx);
				if (m === 'doublelogistic')
					return `Period of the double logistic, in ${xUnit(ctx)}. Blank when it is not periodic.`;
				if (m === 'rectangular')
					return `Period of the rectangular wave, fitted or fixed, in ${xUnit(ctx)}.`;
				return call(FIT_COSINOR.period, ctx).replace(` ${PER_SERIES}`, '');
			}),
			mesor: perY((ctx) => {
				const m = fitModel(ctx);
				if (m === 'rectangular')
					return 'Midline of the rectangular wave, halfway between its high and low levels, in y units.';
				if (m === 'doublelogistic')
					return 'Baseline (rest level) the activity bout rises from, in y units.';
				return 'MESOR: the rhythm-adjusted mean of the fit, in y units.';
			}),
			amplitude: perY((ctx) => {
				const m = fitModel(ctx);
				if (m === 'rectangular')
					return 'Half the distance between the high and low levels, in y units.';
				if (m === 'doublelogistic')
					return 'Height of the activity bout above the baseline, in y units.';
				return call(FIT_COSINOR.amplitude, ctx).replace(` ${PER_SERIES}`, '');
			}),
			acrophase: perY((ctx) =>
				fitModel(ctx) === 'rectangular'
					? `Time of the wave's maximum, ${phaseFrame(ctx)}.`
					: call(FIT_COSINOR.acrophase, ctx).replace(` ${PER_SERIES}`, '')
			),
			amplitude_h1: perY('Amplitude of harmonic 1 alone, in y units (cosinor model).'),
			acrophase_h1: perY(
				(ctx) => `Peak time of harmonic 1 alone, ${phaseFrame(ctx)} (cosinor model).`
			),
			duty_cycle: perY(
				'Fraction of each cycle at the high (active) level, 0 to 1. Rectangular wave, or a periodic double logistic.'
			),
			kappa: perY('Edge sharpness of the rectangular wave; larger is more square.'),
			onset: perY((ctx) => `Time the activity bout rises (double logistic), ${phaseFrame(ctx)}.`),
			offset: perY((ctx) => `Time the activity bout falls (double logistic), ${phaseFrame(ctx)}.`),
			k1: perY((ctx) => `Steepness of the rise (double logistic), ${perXUnit(ctx)}.`),
			k2: perY((ctx) => `Steepness of the fall (double logistic), ${perXUnit(ctx)}.`)
		}
	},
	DoubleLogistic: {
		inputs: {
			xIN: `${X_TIME_OR_NUMBERS} ${NEED_X}`,
			yIN: `${Y_NUMBERS_MANY} A column with fewer than 4 usable rows is skipped.`
		},
		outputs: {
			dlogx: CURVE_X,
			'dlogy_*': curveY(
				'The fitted double logistic (a rise to a bout and a fall back, each cycle)'
			),
			'resid_*': RESIDUALS,
			perm_pvalue: perY(PERM_P),
			r2: perY(R2),
			rmse: perY(RMSE_N)
		}
	},
	RectangularWave: {
		inputs: {
			xIN: `${X_TIME_OR_NUMBERS} ${NEED_X}`,
			yIN: `${Y_NUMBERS_MANY} A column with fewer than 4 usable rows is skipped.`
		},
		outputs: {
			rectwavex: CURVE_X,
			'rectwavey_*': curveY('The fitted rectangular wave (a smoothed square wave)'),
			'resid_*': RESIDUALS,
			perm_pvalue: perY(PERM_P),
			r2: perY(R2),
			rmse: perY(RMSE_N)
		}
	},
	TrendFit: {
		inputs: {
			xIN: `${X_TIME_OR_NUMBERS} A time x starts at 0, so rates are per hour. ${NEED_X}`,
			yIN: `${Y_NUMBERS_MANY} The exponential model needs y above 0; the logarithmic model needs x above 0.`
		},
		outputs: {
			trendx: CURVE_X,
			'trendy_*': curveY('The fitted trend'),
			'resid_*': RESIDUALS,
			'permstats_*': PERM_STATS,
			r2: perY('R² on the original y scale, 0 to 1.'),
			rmse: perY(RMSE_N),
			'coef_*':
				'A trend coefficient, one value per wired y column: slope and intercept, a and b, or c0 to cN, by model.'
		},
		special: [
			{
				name: 'coef_*',
				re: /^coef_(.+)$/,
				text: (m, ctx) => {
					const s = statDescription(m[1], ctx);
					return s ? `${s} ${PER_SERIES}` : null;
				}
			}
		]
	},
	SmoothedData: {
		inputs: {
			xIN: `${X_TIME_OR_NUMBERS} ${NEED_X}`,
			yIN: `${Y_NUMBERS_MANY} A column with fewer than 3 usable rows is skipped.`
		},
		outputs: {
			smoothedx:
				'x of the smoothed points: the rows with both x and y, sorted by x. A time column for a time x.',
			'smoothedy_*':
				'Smoothed y at the smoothed x rows (Whittaker, moving average, Savitzky-Golay or LOESS), in y units. Not aligned with the input rows.',
			'resid_*':
				'Observed minus smoothed y at the smoothed x rows, in y units. Lines up with the smoothed x output, not with the input.'
		}
	},
	Interpolate: {
		inputs: {
			xIN: `${X_TIME_OR_NUMBERS} ${NEED_X}`,
			yIN: 'Number columns, one or more, to fill in or resample. Each needs at least one row with both x and y.'
		},
		outputs: {
			interpx:
				'Fill mode: a copy of the input x. Resample mode: an even grid, one row per step across the data. Time for a time x.',
			'interpy_*':
				'y at each output x, filled by linear, nearest or cubic spline interpolation. Blank outside the range of known x (no extrapolation).'
		}
	},
	BinnedData: {
		inputs: {
			xIN: `${X_TIME_OR_NUMBERS} Bins are in its units; custom edges need numbers. ${NEED_X}`,
			yIN: 'Columns to bin, one or more. Rows with a blank x or y are dropped.'
		},
		outputs: {
			binnedx:
				'Start (left edge) of each bin. A time column for a time x, else numbers. Points before the first bin are dropped.',
			'binnedy_*':
				'y summarised per bin by the function in the panel (mean by default; median, min, max, SD or count). Blank for an empty bin, except count, which is 0.'
		}
	},
	AverageProfile: {
		inputs: {
			xIN: `${X_TIME_OR_NUMBERS} The period is in its units. ${NEED_X}`,
			yIN: 'Number columns, one or more. Each is folded onto the period and averaged into one profile.'
		},
		outputs: {
			avgprofx: (ctx) =>
				`Centre of each profile bin, ${isClock(ctx) ? 'as clock time of day, in hours' : 'in hours after that series’ first sample'}, across one period.`,
			'avgprof_*':
				'Mean profile over one period: each day is averaged within the bin first, then the day means are averaged. In y units; blank for an empty bin.',
			'avgprofsem_*':
				'Standard error of the profile mean: the SD of the day means over the square root of the number of days. Blank with fewer than 2 days in the bin.'
		}
	},

	// ---- Rhythms ---------------------------------------------------------------------------
	RhythmicityAnalysis: {
		inputs: {
			xIN: `${X_TIME_OR_NUMBERS} Periods and lags come out in its units. ${NEED_X}`,
			yIN: `${Y_NUMBERS_MANY} A column with fewer than 3 usable rows gives blank results.`
		},
		outputs: {
			rhythmicityx: (ctx) =>
				ctx?.args?.analysis === 'correlogram'
					? `Lag of each correlogram point, in ${xUnit(ctx)}.`
					: `Trial period of each point of the spectrum, in ${xUnit(ctx)}.`,
			'rhythmicityy_*': (ctx) =>
				({
					periodogram: 'Periodogram power at each trial period.',
					fft: 'FFT magnitude (an amplitude, in y units) at each period.',
					correlogram: 'Autocorrelation r at each lag, -1 to 1.'
				})[ctx?.args?.analysis] ?? 'The spectrum or correlogram values for this y column.',
			'stat_*':
				'A peak statistic, one value per wired y column: period, power or p; frequency or magnitude; or lag and r, by analysis.'
		},
		special: [
			{
				name: 'stat_*',
				re: /^stat_(.+)$/,
				text: (m, ctx) => {
					const s = statDescription(m[1], ctx);
					return s ? `${s} ${PER_SERIES}` : null;
				}
			},
			// A standalone node writes one array per y and quantity: `<yId>_<key>`.
			{
				name: '<colId>_<key>',
				re: /^(\d+)_(period|power|threshold|frequency|magnitude|phase|lag|correlation)$/,
				text: (m, ctx) =>
					({
						period: `Trial periods of the spectrum, in ${xUnit(ctx)}.`,
						power:
							'Periodogram power at each trial period: unitless for Lomb-Scargle, Qp for Chi-squared, y units for Enright.',
						threshold:
							'Chi-squared significance threshold at each trial period; a peak above it is significant.',
						frequency: `Frequency of each FFT point, in cycles ${perXUnit(ctx)}.`,
						magnitude: 'FFT magnitude (an amplitude, in y units) at each frequency.',
						phase: 'FFT phase at each frequency, in radians.',
						lag: `Lag of each correlogram point, in ${xUnit(ctx)}.`,
						correlation: 'Autocorrelation r at each lag, -1 to 1.'
					})[m[2]]
			}
		]
	},
	MovingAnalysis: {
		inputs: {
			xIN: `${X_TIME_OR_NUMBERS} Window size and step are in its units. ${NEED_X}`,
			yIN: `${Y_NUMBERS_MANY} A window with fewer than 3 usable rows gives a blank cell.`
		},
		outputs: {
			movex:
				'Where each window sits: its start, centre (default) or end, as chosen in the panel. A time column for a time x.',
			'stats_*':
				'One column per wired y column and statistic of the chosen analysis, one row per window. Blank for a window without enough data.'
		},
		special: [
			{
				name: 'stats_*',
				re: /^(\d+)_(.+)$/,
				text: (m, ctx) => {
					const s = statDescription(m[2], ctx);
					return s ? `${s} One row per window.` : null;
				}
			}
		]
	},
	NonparametricRA: {
		inputs: {
			xIN: `Time column, or numbers read as hours. ${NEED_X}`,
			yIN: 'Number columns (usually activity), one or more. Each is binned into epochs and folded onto the period.'
		},
		outputs: {
			npcrax: (ctx) =>
				`Centre of each epoch of the average day, ${isClock(ctx) ? 'as clock time of day, in hours' : 'in hours after the first sample'}. Taken from the first y column.`,
			'npcray_*':
				'The average day: the mean of each epoch across days, in y units. Blank for an empty epoch.',
			IS: perY(STAT_DESCRIPTIONS.IS),
			IV: perY(STAT_DESCRIPTIONS.IV),
			RA: perY(STAT_DESCRIPTIONS.RA),
			M10: perY(STAT_DESCRIPTIONS.M10),
			L5: perY(STAT_DESCRIPTIONS.L5),
			M10onset: perY(STAT_DESCRIPTIONS.M10onset),
			L5onset: perY(STAT_DESCRIPTIONS.L5onset)
		}
	},
	CircadianFunctionIndex: {
		inputs: {
			xIN: `Time column, or numbers read as hours. ${NEED_X}`,
			yIN: 'Number columns (usually activity), one or more.'
		},
		outputs: {
			CFI: perY(STAT_DESCRIPTIONS.CFI),
			IS: perY(`${STAT_DESCRIPTIONS.IS} Not clamped.`),
			IV: perY(`${STAT_DESCRIPTIONS.IV} Not clamped.`),
			RA: perY(`${STAT_DESCRIPTIONS.RA} Not clamped.`)
		}
	},
	RayleighTest: {
		inputs: {
			timeIN:
				'Optional time column (or hours as numbers). Wired: each y value becomes a weight at its time folded onto the period. Empty: the y columns hold the angles.',
			yIN: 'Number columns, one or more, each a group: angles in the unit set in the panel, or weights when a time column is wired.'
		},
		outputs: {
			R: perY(
				'Mean vector length, 0 to 1: 0 is spread evenly round the cycle, 1 is all at one phase.'
			),
			z: perY('Rayleigh z = n·R². Blank when a time column is wired (weighted mode).'),
			pvalue: perY(
				'Rayleigh test p (are the phases clustered); not corrected across columns. Blank when a time column is wired.'
			),
			acrophase: perY(
				'Mean direction, as hours of a cycle of the period set in the panel (24 by default), 0 up to the period.'
			),
			F: 'Watson-Williams F comparing the mean directions of the y columns: one value for the node. Blank when the test is off, weighted, or with fewer than 2 groups.',
			ww_pvalue:
				'Watson-Williams p (do the groups share a mean direction): one value for the node. Blank when the test is off, weighted, or with fewer than 2 groups.'
		}
	},
	SurrogateTest: {
		inputs: {
			xIN: `${X_TIME_OR_NUMBERS} ${NEED_X}`,
			yIN: 'One number column to test for a rhythm. Needs at least 8 rows; gaps longer than 3 samples are refused.'
		},
		outputs: {
			pvalue:
				'Share of surrogate series whose statistic reaches the observed one, one value for the node. The smallest possible p is 1 / (surrogates + 1).',
			observed:
				'The test statistic on the real data: the largest FFT amplitude in the period band, in y units. One value for the node.'
		}
	},
	CrossCorrelation: {
		inputs: {
			xIN: 'Series A: one number column. Rows pair with series B by position, so both should be evenly sampled. Required.',
			yIN: 'Series B: one number column, paired with A row by row. Required.'
		},
		outputs: {
			lag: 'Lag in samples (rows), from -max to +max lag, one row per lag. Positive means A leads B.',
			correlation: 'Correlation r of A with B shifted by that lag, -1 to 1, one row per lag.',
			pvalue:
				'p of the prewhitened correlation at that lag, one row per lag. Per-lag: not corrected for testing many lags.'
		}
	},

	// ---- Statistics ------------------------------------------------------------------------
	ChiSquared: {
		inputs: {
			xIN: 'One column of categories (or counts for goodness of fit). The first group, the row variable, or the only column tested. Required.',
			yIN: 'One column of categories: the second group or the column variable. Needed for independence and Fisher; ignored for goodness of fit.'
		},
		outputs: {
			statistic:
				'Chi-square (χ²), one value for the node. Blank for Fisher, which has no test statistic.',
			pvalue:
				'p of the test, one value for the node (Fisher: exact, with the alternative set in the panel).',
			df: 'Degrees of freedom, one value for the node. Blank for Fisher.',
			effectSize:
				"Effect size, one value for the node: Cramér's V (independence), Cohen's w (goodness of fit) or the conditional odds ratio (Fisher).",
			ciLow:
				'Lower end of the exact 95% interval of the Fisher odds ratio, one value for the node. Blank for chi-square.',
			ciHigh:
				'Upper end of the exact 95% interval of the Fisher odds ratio, one value for the node. Blank for chi-square.'
		}
	},
	Correlation: {
		inputs: {
			yIN: 'Number columns, two or more. Every pair is correlated, using rows where both have a value.'
		},
		outputs: {
			var_i: 'Name of the first column of each pair, one row per pair.',
			var_j: 'Name of the second column of each pair, one row per pair.',
			r: 'Correlation r of the pair (Pearson or Spearman), -1 to 1. Blank with fewer than 2 rows or no variance.',
			pvalue: 'Per-test p of each pair, not corrected for the number of pairs.',
			padj: 'Holm-adjusted p across all the pairs (family-wise).',
			n: 'Number of rows where both columns have a value, per pair.',
			ciLow: 'Lower end of the 95% interval of r, per pair. Blank with fewer than 4 rows.',
			ciHigh: 'Upper end of the 95% interval of r, per pair. Blank with fewer than 4 rows.',
			significant: '1 when the Holm-adjusted p is below alpha, else 0, per pair.'
		}
	},
	DescribeData: {
		inputs: {
			yIN: 'Number columns, one or more. One row of statistics per column; blanks are ignored.'
		},
		outputs: {
			variable: 'Name of each input column, one row per column.',
			n: 'Number of values (blanks left out), one row per column.',
			mean: 'Mean, in the column’s units, one row per column.',
			median: 'Median, in the column’s units, one row per column.',
			sd: 'Sample standard deviation (n - 1), in the column’s units.',
			min: 'Smallest value, one row per column.',
			max: 'Largest value, one row per column.',
			range: 'Largest minus smallest value, one row per column.',
			q1: '25th percentile (linear interpolation), one row per column.',
			q3: '75th percentile (linear interpolation), one row per column.',
			iqr: 'Interquartile range, Q3 minus Q1, one row per column.',
			skewness: 'Skewness (bias-corrected), no units. Blank with fewer than 3 values.',
			kurtosis:
				'Excess kurtosis (0 for a normal distribution), no units. Blank with fewer than 4 values.'
		}
	},
	FDRCorrection: {
		inputs: {
			xIN: 'One column of raw p-values (for example a pvalue output). Values outside 0 to 1, blanks and text are left out. Required.'
		},
		outputs: {
			padj: 'Adjusted p for each input row (false discovery rate or family-wise, by method). Blank where the input p is unusable.',
			reject: '1 when the adjusted p is below alpha, else 0, for each input row.'
		}
	},
	GroupComparison: {
		inputs: {
			xIN: 'One column of group labels (text or numbers, read as categories). Empty: each y column is its own group, compared with the others.',
			yIN: 'Number columns, one or more: the values compared across the groups. Each is tested separately.'
		},
		outputs: {
			statistic: (ctx) =>
				`The test statistic (t, F, U or H, by method), ${ctx?.args?.xIN != null && Number(ctx.args.xIN) >= 0 ? 'one value per wired y column' : 'one value per wired y column, or one when the y columns are the groups'}.`,
			pvalue:
				'Omnibus p of the test, one value per wired y column; not corrected across y columns.',
			effectSize:
				"Effect size, one value per wired y column: Cohen's d (t-test), η² (ANOVA), r (Mann-Whitney) or ε² (Kruskal-Wallis)."
		}
	},
	LogisticRegression: {
		inputs: {
			yIN: 'The outcome: one column of 0 and 1 (or two text levels). Any other column gives a "not binary" warning.',
			xIN: 'Predictors: number columns, one or more. Rows missing the outcome or any predictor are dropped.'
		},
		outputs: {
			term: 'Name of each model term, one row per term; the first is the intercept.',
			coef: 'Coefficient of each term, on the log-odds scale.',
			se: 'Standard error of each coefficient.',
			z: 'Wald z of each coefficient (coefficient / standard error).',
			pvalue: 'Wald p of each term; not corrected across terms.',
			oddsRatio: 'Odds ratio of each term, e to the coefficient.',
			ciLow: 'Lower end of the 95% interval of the odds ratio, per term.',
			ciHigh: 'Upper end of the 95% interval of the odds ratio, per term.',
			outcome: 'The 0/1 outcome actually used, one row per input row (blank for dropped rows).',
			eta: 'Linear predictor (log-odds) for each input row.',
			fitted: 'Fitted probability that the outcome is 1, for each input row.'
		}
	},
	NormalityTest: {
		inputs: {
			yIN: 'Number columns, one or more. One row of results per column.'
		},
		outputs: {
			variable: 'Name of each input column, one row per column.',
			statistic: 'Test statistic: Shapiro-Wilk W, D’Agostino K² or Jarque-Bera JB, by method.',
			pvalue:
				'p of the normality test, per column. Blank if n is too small (or above 5000 for Shapiro-Wilk).',
			n: 'Number of values tested, per column.',
			normal: '1 when p is at least alpha (normality not rejected), 0 when rejected.'
		}
	},
	Threshold: {
		inputs: {
			xIN: 'One number column to compare with the threshold. Required.'
		},
		outputs: {
			binary:
				'1 where the value meets the comparison (for example at or above the threshold), else 0. Same length as the input; blank where the input is blank.'
		}
	},
	Crossing: {
		inputs: {
			xIN: 'Optional time or number column. Wired: persistence is in its units (hours for time). Empty: persistence counts samples.',
			yIN: 'Number columns, one or more, that the rule tests. All must be the same length.',
			thresholdIN:
				'Optional columns whose first value is a cutoff a rule can use instead of a typed number.'
		},
		outputs: {
			breach:
				'1 where the rule holds, else 0, one row per input row. Blank where a tested series is blank.',
			crossing:
				'Where each crossing fired (the rule held for the persistence time): the x value, a time when x is time, or the row number (from 0) without x.',
			count: 'Number of crossings, one value for the node.'
		}
	},

	// ---- Sources ---------------------------------------------------------------------------
	BlankColumn: {
		inputs: {},
		outputs: {
			result:
				'The values typed or pasted in. Numbers when every filled cell is a number, else categories; empty cells stay blank.',
			'col_*': 'Another column of the pasted data, typed the same way.'
		}
	},
	Random: {
		inputs: {},
		outputs: {
			result:
				'Random numbers (uniform, gaussian, exponential or 0/1 bernoulli), rounded to 2 decimals. The seed makes them repeatable.'
		}
	},
	SequenceColumn: {
		inputs: {},
		outputs: {
			result:
				'An evenly spaced sequence: numbers from the start in equal steps, or times from the start time, one step (in hours) apart.'
		}
	},
	SimulatedData: {
		inputs: {},
		outputs: {
			time: 'Time of each simulated sample, every sampling interval from the start time.',
			values:
				'The simulated signal: a square wave (the amplitude while active, 1 at rest) with optional noise, one value per time.'
		}
	},
	StoredValueGroup: {
		inputs: {},
		outputs: {
			'group_*':
				'The stored values listed in this group, one row each, in key order. Feed it to a plot or test to compare groups.',
			category: 'Group name of each stored value (older sessions only).',
			value: 'The stored values of every group (older sessions only).'
		}
	},

	// ---- Data shaping ----------------------------------------------------------------------
	CollectColumns: {
		inputs: {
			colIds: 'Columns of any type, one or more, to gather into this node. Required.'
		},
		outputs: {
			outCols: 'A copy of each wired column, after any steps set in the panel, keeping its type.',
			'col_*': 'A copy of the wired column, after any steps set in the panel, keeping its type.'
		}
	},
	ColumnFunctions: {
		inputs: {
			xsIN: 'Columns, one or more, combined row by row. Required.'
		},
		outputs: {
			result:
				'One value per row from the chosen function across the columns (add, average, min, max, SD or percentile). As long as the first column.'
		}
	},
	ColumnSet: {
		inputs: {
			colsIN:
				'Candidate columns of any type, one or more. The set keeps those whose name or group label contains the match text.'
		},
		outputs: {
			set: 'A live set of the matching columns down one wire. Connects only to an input that takes one or more columns (marked *).'
		}
	},
	FormulaColumn: {
		inputs: {
			tokens: 'The columns the formula uses. The first one sets the number of rows. Required.'
		},
		outputs: {
			result:
				'The formula worked out row by row, as numbers. Blank where any input is blank or the result is not finite.'
		}
	},
	JoinData: {
		inputs: {
			aTimeIN:
				'Time of dataset A: a time column, or numbers. Wire a time for both A and B (rows interleave in time order) or for neither (B is stacked under A).',
			aValuesIN:
				'Columns of dataset A, one or more. Each pairs with the B column of the same name.',
			bTimeIN:
				'Time of dataset B, the same kind as time A (both time, or both numbers). Leave both times empty to stack B under A.',
			bValuesIN:
				'Columns of dataset B, one or more. A B column with no A partner of the same name gets its own output.'
		},
		outputs: {
			jointime:
				'Every A and B time in order (A first on ties). Only when both times are wired; no rows are merged.',
			'joined_*':
				'A joined column: A values on A rows and B values on B rows for a pair, blank on the other dataset’s rows when unpaired.',
			source: 'Which dataset each row came from (the group names, or A and B).'
		}
	},
	LongToWide: {
		inputs: {
			categoryIN:
				'One column of labels: each distinct label becomes its own value column. Required.',
			timeIN: 'One time (or number) column; rows with a blank time are dropped. Required.',
			valueIN: 'One column of the values to spread out. Required.'
		},
		outputs: {
			time: 'The distinct times, sorted, one row each.',
			'value_*':
				'The values of one label at each time. Blank where that label has no row; a repeated label and time keeps the last value.'
		}
	},
	WideToLong: {
		inputs: {
			timeIN: 'One time (or number) column shared by the value columns. Required.',
			valueColIds: 'Value columns, one or more, to stack into one. Required.'
		},
		outputs: {
			time: 'The time of each stacked row (the input times repeated for every value column).',
			category: 'Name of the column each stacked value came from, as the app shows it.',
			value: 'The stacked values. Rows with a blank time or value are left out.'
		}
	},
	Sort: {
		inputs: {
			yIN: 'Columns, one or more, kept row-aligned. The one chosen in the panel (the first by default) is the sort key.'
		},
		outputs: {
			'sortedy_*':
				'The column reordered by the sort key, so rows stay together. Blank keys go last; a column of a different length is passed through unsorted.'
		}
	},
	Split: {
		inputs: {
			xIN: 'One time or number column the split points are read on (dates for time, numbers otherwise). Required.',
			yIN: 'Columns, one or more, to cut into segments.'
		},
		outputs: {
			segments:
				'One column per wired y column and segment: full length, with values only between that segment’s split points.'
		},
		special: [
			{
				re: /^(\d+)_(\d+)$/,
				text: () =>
					'This segment of the column: full length, with values only between its split points and blank elsewhere.'
			}
		]
	}
};

// ---------------------------------------------------------------------------------------------
// Column transforms (column processes). One input, `input`; one output per wired column
// (`output`, or `out_<inputColId>` on a free node), the same length as its input.
// ---------------------------------------------------------------------------------------------

export const PROCESS_PORT_DESCRIPTIONS = {
	Add: {
		inputs: { input: 'A number column, or a time column (the value added is then a duration).' },
		outputs: {
			output: 'The input plus the value, row by row. Same length and type; blanks stay blank.'
		}
	},
	Multiply: {
		inputs: { input: 'A number column.' },
		outputs: { output: 'The input times the value, row by row. Same length; blanks stay blank.' }
	},
	Sub: {
		inputs: { input: 'A column of any type except time.' },
		outputs: {
			output: 'The input with every cell equal to the find value replaced. Same length and type.'
		}
	},
	EditValue: {
		inputs: { input: 'A column of any type.' },
		outputs: { output: 'A copy of the input with the cells you typed changed, by row number.' }
	},
	FilterByOtherCol: {
		inputs: { input: 'A column of any type.' },
		outputs: {
			output:
				'The input with the rows that fail the conditions (tested on other columns) blanked. Same length.'
		}
	},
	FrequencyFilter: {
		inputs: { input: 'An evenly sampled number column.' },
		outputs: {
			output:
				'The input after the low-, high- or band-pass FFT filter (cutoffs as fractions of the Nyquist frequency), in its own units. Blanks stay blank.'
		}
	},
	normalize: {
		inputs: { input: 'A number column.' },
		outputs: {
			output:
				'The input rescaled (z-score, min-max, robust median and MAD, or unit vector), with no units. Blanks stay blank.'
		}
	},
	OutlierRemoval: {
		inputs: { input: 'A number column.' },
		outputs: {
			output:
				'The input with outliers (by z-score or IQR fences) blanked. Same length; with fewer than 4 values it passes through.'
		}
	},
	RemoveTrend: {
		inputs: {
			input:
				'A number column. The trend runs along the x column chosen in the panel, else the row number.'
		},
		outputs: {
			output:
				'The input minus its fitted trend, in its own units (or a sliding z-score). Unchanged where the fit is refused.'
		}
	}
};

// ---------------------------------------------------------------------------------------------
// Plots. `inputs` are keyed by the plot's data fields (its defaultInputs, in order): on the
// canvas the first is each series' x port (x<n>), the second its y port (ys<n>); a one-field
// plot has a single `data` port. `outputs` are its metric keys; an actogram's per-rule keys are
// `r*_<stat>`.
// ---------------------------------------------------------------------------------------------

const TIME_HOURS =
	'Time column, or numbers read as hours, for this series. Required for the series to draw.';
const PLOT_VALUES =
	'Number columns, one or more, each analysed and drawn against this series’ time.';
const VISIBLE_PEAK = 'the highest peak inside the axis limits (else the highest overall)';

export const PLOT_PORT_DESCRIPTIONS = {
	actogram: {
		inputs: {
			time: TIME_HOURS,
			values: 'Number columns (usually activity), one or more, drawn day by day.'
		},
		outputs: {
			'r*_tau':
				'Period of this marker rule’s line, from its harmonic check, in hours. One value per series.',
			'r*_phi':
				'Phase of the rule’s line, in hours after the row start on the reference day. One value per series.',
			'r*_r2': 'R² of the rule’s line against its fitted markers. One value per series.',
			'r*_rmse': 'RMSE of the rule’s line against its markers, in hours. One value per series.',
			'r*_n': 'Number of markers in the rule’s fit (0 when none). One value per series.'
		}
	},
	boxplot: {
		inputs: {
			x: 'Optional column of group labels (categories): one box per group. Empty: the whole y column is one box.',
			y: 'Number columns, one or more: the values summarised. Blanks are skipped.'
		},
		outputs: {}
	},
	circularphase: {
		inputs: {
			time: 'Optional time column (or hours as numbers), folded onto the period. Wired: the values are measurements at their time of day. Empty: the values are phases.',
			values:
				'Number columns, one or more, each a group: phases (hours, degrees or radians, as set) or, with a time column, measurements.'
		},
		outputs: {}
	},
	correlationheatmap: {
		inputs: {
			column:
				'Number columns, one per variable, two or more. Each pair is correlated on the rows where both have a value.'
		},
		outputs: {}
	},
	correlogram: {
		inputs: {
			time: `${TIME_HOURS} Lags are in hours.`,
			values: PLOT_VALUES
		},
		outputs: {
			peak_lag: `Lag of the first clear peak after lag 0, in hours. One value per series.`,
			peak_correlation: 'Autocorrelation r at that peak, -1 to 1. One value per series.'
		}
	},
	cwt: {
		inputs: {
			x: 'Time column, or numbers read as hours.',
			y: 'One number column to transform. The plot shows one series; a new wire replaces it.'
		},
		outputs: {}
	},
	fft: {
		inputs: { time: TIME_HOURS, values: PLOT_VALUES },
		outputs: {
			peak_period: `Period of ${VISIBLE_PEAK}, in hours. One value per series.`,
			peak_frequency: 'Frequency of that peak, in cycles per hour. One value per series.',
			peak_magnitude: 'Amplitude of that peak, in y units. One value per series.'
		}
	},
	histogram: {
		inputs: {
			column: 'Number columns, one or more; each is its own histogram. Time columns are refused.'
		},
		outputs: {}
	},
	meansem: {
		inputs: {
			x: 'Optional column of group labels: one mean and SEM per group. Empty: the whole y column is one group.',
			y: 'Number columns, one or more: the values averaged.'
		},
		outputs: {}
	},
	pairsplot: {
		inputs: {
			column: 'Number columns, one per variable; every pair gets a scatter panel.'
		},
		outputs: {}
	},
	periodogram: {
		inputs: { time: TIME_HOURS, values: PLOT_VALUES },
		outputs: {
			peak_period: `Period of ${VISIBLE_PEAK}, in hours. One value per series.`,
			peak_power: `${PEAK_POWER({})} One value per series.`,
			peak_pvalue:
				'Family-wise p of the Chi-squared peak, corrected for every period tested. Blank for the other methods. One value per series.'
		}
	},
	qqplot: {
		inputs: {
			column:
				'Number columns, one or more, each compared with a normal distribution. Needs at least 3 values.'
		},
		outputs: {
			qq_r: 'Correlation of the Q-Q points with the normal line, up to 1 (1 is perfectly normal), one value per series. Blank for constant data or n under 3.',
			qq_n: 'Number of values used. One value per series.'
		}
	},
	scatterplot: {
		inputs: {
			x: 'Time, number or category column for this series’ x axis.',
			y: 'Number columns, one or more, plotted against this series’ x.'
		},
		outputs: {}
	},
	tableplot: {
		inputs: {
			series: 'Columns of any type, one or more, shown side by side in the table.'
		},
		outputs: {
			'*': 'A column of the node results this table shows (the whole column).'
		}
	}
};

// Overlay channels: `<kind>.<form>.<key>` (components/plotbits/overlaySpec.js CHANNEL_TABLE).
export const OVERLAY_CHANNEL_DESCRIPTIONS = {
	'line.vertical.at': 'Column of x positions: a vertical line at each distinct value (up to 50).',
	'line.horizontal.at':
		'Column of y positions: a horizontal line at each distinct value (up to 50).',
	'band.ribbon.x': 'x positions of the ribbon, paired row by row with its lower and upper edges.',
	'band.ribbon.lower': 'Lower edge of the ribbon at each x, in y units.',
	'band.ribbon.upper': 'Upper edge of the ribbon at each x, in y units.',
	'band.horizontal.lower': 'Bottom of each horizontal band (y), paired row by row with the tops.',
	'band.horizontal.upper': 'Top of each horizontal band (y), paired row by row with the bottoms.',
	'band.vertical.start': 'Start of each vertical band (x), paired row by row with the ends.',
	'band.vertical.end': 'End of each vertical band (x), paired row by row with the starts.'
};
// A series' colour-by port, `enc<id>_colour` (components/plotbits/encodingHost.js).
export const COLOUR_BY_DESCRIPTION =
	'Column that colours this series’ points: a number by its value, a time by its hour of day, text by category as box plots do (set in the panel). Rows with no value keep the series colour.';
// A series' size-by port, `enc<id>_size`.
export const SIZE_BY_DESCRIPTION =
	'Column that sizes this series’ points, the area growing with the value between the smallest and largest point size: a number by its value, a time by days since start (or day of year; set in the panel). Rows with no value keep the series’ point size.';
const NEW_LINE_DESCRIPTION =
	'Each drop adds a reference line at the column’s values; set vertical or horizontal in the panel.';

const PASSTHROUGH =
	'The column wired into this plot, passed on so it can be wired onward from here.';
const COMPOSITE_IN = 'Input of a node inside this composite; it takes what that node’s port takes.';
const COMPOSITE_OUT = 'Output of a node inside this composite, passed out unchanged.';

const COLUMN_KIND = {
	time: 'time',
	number: 'number',
	category: 'category (text)',
	bin: 'bin position'
};
/** "Carries this time column ..." for a data or group column. */
function columnCarries(col) {
	const kind = COLUMN_KIND[col?.type] ?? 'data';
	return `This ${kind} column, to any input that takes it.`;
}

// ---------------------------------------------------------------------------------------------
// Resolution.
// ---------------------------------------------------------------------------------------------

function familyEntries(spec) {
	return Object.keys(spec?.outputs ?? {})
		.filter((k) => k.endsWith('*'))
		.map((k) => ({ name: k, prefix: k.slice(0, -1) }))
		.sort((a, b) => b.prefix.length - a.prefix.length);
}

/**
 * Description of input `portName` of a table-process or column transform of type `nodeType`.
 * @param {string} nodeType
 * @param {string} portName  the nodeSpec input name (xIN, yIN, input, ...)
 * @param {{args?: object, colType?: (id:number)=>string|null}} [ctx]
 */
export function inputDescription(nodeType, portName, ctx = {}) {
	const spec = NODE_PORT_DESCRIPTIONS[nodeType] ?? PROCESS_PORT_DESCRIPTIONS[nodeType];
	const v = spec?.inputs?.[portName];
	return v == null ? null : call(v, ctx);
}

/**
 * Description of output `key` (an `args.out` key, e.g. 'cosinory_66', 'stat_peak_period') of a
 * table-process of type `nodeType`, or null when not covered.
 */
export function outputDescription(nodeType, key, ctx = {}) {
	const spec = NODE_PORT_DESCRIPTIONS[nodeType];
	if (!spec || typeof key !== 'string') return null;
	if (spec.outputs && Object.hasOwn(spec.outputs, key) && !key.endsWith('*')) {
		return call(spec.outputs[key], ctx);
	}
	for (const sp of spec.special ?? []) {
		const m = sp.re.exec(key);
		if (!m) continue;
		const t = sp.text(m, ctx);
		if (t) return t;
	}
	for (const { name, prefix } of familyEntries(spec)) {
		if (key.startsWith(prefix) && key.length > prefix.length) return call(spec.outputs[name], ctx);
	}
	// A shared statistic (r2, pvalue, ...) written without being listed.
	return statDescription(key, ctx);
}

/** Description of a column transform's port (`input`, `output` or a free node's `out_<id>`). */
export function processPortDescription(processName, portName, dir) {
	const spec = PROCESS_PORT_DESCRIPTIONS[processName];
	if (!spec) return null;
	if (dir === 'in') return spec.inputs.input ?? null;
	return spec.outputs.output ?? null;
}

/** Description of a plot input field ('time', 'values', 'x', 'y', 'column', 'series'). */
export function plotInputDescription(plotType, field) {
	return PLOT_PORT_DESCRIPTIONS[plotType]?.inputs?.[field] ?? null;
}

/** Description of a plot metric output key ('peak_period', 'r3_tau', a results column). */
export function plotOutputDescription(plotType, key) {
	const outs = PLOT_PORT_DESCRIPTIONS[plotType]?.outputs;
	if (!outs || typeof key !== 'string') return null;
	if (Object.hasOwn(outs, key)) return outs[key];
	const rule = /^r\d+_(tau|phi|r2|rmse|n)$/.exec(key);
	if (rule && outs[`r*_${rule[1]}`]) return outs[`r*_${rule[1]}`];
	return outs['*'] ?? null;
}

/** Overlay channel description for a (kind, form, key), or null. */
export function overlayChannelDescription(kind, form, key) {
	return OVERLAY_CHANNEL_DESCRIPTIONS[`${kind}.${form}.${key}`] ?? null;
}

/**
 * Description of a manifest port (static/nodes.json) with no session context: a fixed name, a
 * `prefix_*` family or a placeholder (`stats_*`, `segments`, `r*_tau`).
 * @param {'tableProcess' | 'process' | 'plot'} kind
 */
export function manifestPortDescription(kind, nodeId, portName, dir) {
	if (kind === 'plot') {
		return dir === 'in'
			? plotInputDescription(nodeId, portName)
			: (PLOT_PORT_DESCRIPTIONS[nodeId]?.outputs?.[portName] ?? null);
	}
	if (kind === 'process') return processPortDescription(nodeId, portName, dir);
	if (dir === 'in') return inputDescription(nodeId, portName, {});
	const spec = NODE_PORT_DESCRIPTIONS[nodeId];
	const v = spec?.outputs?.[portName];
	return v == null ? null : call(v, {});
}

/**
 * The lookups a node card needs to build ctx from live columns.
 * @param {(id:number)=>any} getColumnById
 */
export function portEnv(getColumnById) {
	return {
		col: (id) => (typeof id === 'number' ? getColumnById(id) : null),
		colType: (id) => getColumnById(id)?.type ?? null
	};
}

const PLOT_X_PORT = /^x\d+$/;
const PLOT_Y_PORT = /^ys\d+$/;
const OVERLAY_PORT = /^ov(\d+)_([A-Za-z]\w*)$/;
const ENCODING_PORT = /^enc\d+_(colour|size)$/;

/**
 * What a port on a canvas node card expects (dir 'in') or produces (dir 'out'), or null.
 * Duck-typed over the ProcessNode shapes (node.type: tableprocess, process, plot, group, data,
 * composite) so every card shares one resolver.
 * @param {any} node   a ProcessNode (or the plain composite node object)
 * @param {{name: string, passthrough?: boolean}} port
 * @param {'in' | 'out'} dir
 * @param {{col?: (id:number)=>any, colType?: (id:number)=>string|null, key?: string}} [env]
 *   key: the output's `args.out` key when the caller already knows it
 */
export function describeNodePort(node, port, dir, env = {}) {
	const name = port?.name;
	if (!node || typeof name !== 'string') return null;
	const type = node.type ?? node.meta?.type ?? node.kind;

	if (type === 'tableprocess') {
		const tp = node.tpObj;
		const ctx = { args: tp?.args ?? {}, ownerId: tp?.id, colType: env.colType };
		const nodeType = node.tpName ?? tp?.name;
		if (dir === 'in') return inputDescription(nodeType, name, ctx);
		const key = env.key ?? (node.outputColumns ?? []).find((o) => o.port === name)?.key ?? name;
		return outputDescription(nodeType, key, ctx);
	}
	if (type === 'process') {
		return processPortDescription(node.processName ?? node.processObj?.name, name, dir);
	}
	if (type === 'plot') {
		const plot = node.plotObj;
		const plotType = plot?.type;
		if (dir === 'in') {
			if (name === 'ovnew_line') return NEW_LINE_DESCRIPTION;
			const enc = ENCODING_PORT.exec(name);
			if (enc) return enc[1] === 'size' ? SIZE_BY_DESCRIPTION : COLOUR_BY_DESCRIPTION;
			const ov = OVERLAY_PORT.exec(name);
			if (ov) {
				const overlay = (plot?.plot?.overlays ?? []).find((o) => String(o?.id) === ov[1]);
				return overlay ? overlayChannelDescription(overlay.kind, overlay.form, ov[2]) : null;
			}
			const fields = Object.keys(PLOT_PORT_DESCRIPTIONS[plotType]?.inputs ?? {});
			if (PLOT_X_PORT.test(name)) return plotInputDescription(plotType, fields[0]);
			if (PLOT_Y_PORT.test(name)) return plotInputDescription(plotType, fields[1]);
			if (name === 'data' || name === 'series') return plotInputDescription(plotType, fields[0]);
			return null;
		}
		if (port.passthrough) return PASSTHROUGH;
		const key = env.key ?? (node.outputColumns ?? []).find((o) => o.port === name)?.key;
		if (key && key.startsWith('col_') && !plotOutputDescription(plotType, key)) return PASSTHROUGH;
		return key ? plotOutputDescription(plotType, key) : null;
	}
	if (type === 'group') {
		const m = /^col_(\d+)$/.exec(name);
		return m ? columnCarries(env.col?.(Number(m[1]))) : null;
	}
	if (type === 'data') {
		return dir === 'out' ? columnCarries(env.col?.(node.refId)) : null;
	}
	if (type === 'composite') return dir === 'in' ? COMPOSITE_IN : COMPOSITE_OUT;
	return null;
}
