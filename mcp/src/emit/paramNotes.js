// What a parameter MEANS, what values it accepts, and what it depends on — in the model's own
// vocabulary. The other half of the "a default is not a description" story (see USAGE_NOTES for
// generators; this is the same idea for analysis parameters).
//
// WHY THIS EXISTS
//
// The catalogue and the edit prompt show a param's NAME and its DEFAULT value, and nothing else.
// For a select-type param that is actively misleading: the model sees `pgMethod: "Lomb-Scargle"`
// and has no way to know "Chi-squared" and "Enright" are equally legal — exactly how it never
// learned "gaussian" was a legal Random distribution, and invented data by hand instead. Plots
// already show their options (`[a|b|c]`), because a plot's descriptor carries them; analysis
// params carry nothing, so the asymmetry had to be filled in by hand.
//
// Three things a note supplies that the registry cannot:
//   1. ENUMS   — the legal values of a select param. These live ONLY in the component's <select>
//                markup; there is no machine-readable source (verified: the registry entry has
//                no options/paramMeta). A drift-guard test (paramNotesCoverage.test.js, app-side)
//                scans that markup and FAILS if any enum value is undocumented here, so a value
//                added in the UI can't silently go missing from the model's knowledge.
//   2. UNITS   — which numbers are HOURS. `period`, `fixedPeriod`, `referenceHrs`, the M/L
//                windows: all hours, none of it says so.
//   3. GATING  — which param switches another on. `fixedPeriod` only bites when
//                `useFixedPeriod:true`; the permutation params only when `permuteTest:true`;
//                `analysis` decides which whole family of params is even read.
//
// Editorial by nature (no registry can state "referenceHrs is the acrophase reference"), so it
// is hand-written and held honest by the guard rather than derived. Pure data, no imports — safe
// for the Worker. Keyed by node name; baked into the catalogue by gen-schema (as `paramNote`)
// and rendered by both the draft and edit prompts.
//
// Coverage is deliberate, not exhaustive: document a param when its name, values or dependencies
// would mislead a model. An obvious numeric like `nBins` needs nothing. The guard only enforces
// that ENUM VALUES are covered; prose for units/gating is a judgement call.

export const PARAM_NOTES = {
	ChiSquared:
		'`testType` is "independence" (two categorical columns: `xIN` = rows, `yIN` = columns → contingency table → test of association) or "goodness" (one column `xIN`: a categorical column is tabulated into category counts, a numeric column is read as observed counts, tested against a uniform expectation). `correction` toggles Yates\' continuity correction, applied only to 2×2 independence tables. Outputs statistic, pvalue and df. Expected counts below 5 make the χ² approximation unreliable.',
	CrossCorrelation:
		'Two single-column inputs: `xIN` is series A, `yIN` is series B. `method` is "pearson" (linear) or "spearman" (rank / monotonic). `maxLag` bounds the lag window in SAMPLES (not hours); 0 ⇒ auto (a quarter of the shorter series). Outputs three equal-length columns (lag, correlation, pvalue); the peak lag is the estimated delay — a positive peak means B leads A by that many samples.',
	NormalityTest:
		'`method` is "shapiro" (Shapiro-Wilk, the default — the most powerful test, valid for 3 ≤ n ≤ 5000), "dagostino" (D’Agostino-Pearson omnibus K², skewness + kurtosis, n ≥ 8, better for very large n) or "jarquebera" (Jarque-Bera, valid down to n ≥ 3 but weaker in small samples). `alpha` is the significance level for the yes/no verdict (0.05). Each wired column is tested independently and reported one row per variable (variable, statistic, pvalue, n, normal). A small p-value ⇒ non-normal ⇒ prefer rank / non-parametric methods.',
	Correlation:
		'`method` is "pearson" (linear), "spearman" (rank / monotonic) or "auto" — "auto" uses Spearman if any wired column fails a Jarque-Bera normality check, else Pearson, so the whole matrix stays on one comparable method. `alpha` is the significance level (0.05). Every unique pair of the wired columns is reported (var_i, var_j, r, pvalue, n), using pairwise-complete rows.',
	Split:
		'`splitTimes` is the list of points to cut the series at (N points ⇒ N+1 segments). On a TIME x-axis give each as HOURS FROM THE START of the recording — 336 splits after 14 days, 576 after 24 — NOT an absolute date or an epoch value; the conversion to the actual timestamp is done for you. On a numeric x-axis give it in that column’s own units.',
	RhythmicityAnalysis:
		'`analysis` picks the method: "periodogram", "fft" or "correlogram". For "periodogram", `pgMethod` is "Lomb-Scargle" (handles uneven/gapped sampling — the safe default), "Chi-squared" (Sokolove-Bushell; needs even sampling) or "Enright". `periodMin`/`periodMax`/`periodStep` bound the period SEARCH, in HOURS. `corrMinLag`/`corrMaxLag` apply only to "correlogram" (lag units = your x units); `fftFreqStep` only to "fft" (0 = auto).',
	MovingAnalysis:
		'Runs one analysis in a sliding window. `analysis` is "periodogram", "cosinor", "fft", "correlogram", "rectfit", "doublelogistic" or "trend", and it decides which other params matter: "periodogram" reads `pgMethod` ("Lomb-Scargle"/"Chi-squared"/"Enright") and `periodMin`/`periodMax`/`periodStep` (HOURS); "trend" reads `trendModel` ("linear"/"exponential"/"logarithmic"/"polynomial", the last using `trendPolyDegree`); "cosinor" reads `useFixedPeriod`/`fixedPeriod`/`nHarmonics`. `windowSize`/`stepSize` are in your x-axis units. `binLabel` ("start"/"center"/"end") is which end of the window the result is stamped at.',
	SmoothedData:
		'`smootherType` is "whittaker" (reads `whittakerLambda`/`whittakerOrder`), "moving" (reads `movingAvgWindowSize` and `movingAvgType` = "simple"/"weighted"/"exponential"), "savitzky" (Savitzky-Golay; reads `savitzkyWindowSize`/`savitzkyPolyOrder`) or "loess" (reads `loessBandwidth`). Only the chosen smoother\'s params are used.',
	TrendFit:
		'`model` is "linear", "exponential", "logarithmic" or "polynomial" (the last uses `polyDegree`). `outputX` -1 reuses the input x grid.',
	FitFunction:
		'`model` is "cosinor", "rectangular" or "doublelogistic". For a periodic fit keep `useFixedPeriod:true` and set `fixedPeriod` in HOURS (free-period fitting is unreliable on time-axis data). `permuteTest:true` enables the permutation significance test — only then do `nPermutations`, `permutationSeed` and `permutationStatistic` ("rSquared" or "rmse") matter. The various `fix*`/`fixed*` pairs pin a parameter: e.g. `fixKappa:true` holds it at `fixedKappa`.',
	Cosinor:
		'For a daily rhythm keep `useFixedPeriod:true` and set `fixedPeriod` in HOURS (e.g. 24). `nHarmonics` (used when the period is fixed) adds harmonics for a non-sinusoidal shape; `Ncurves` (used in free-period mode) is the number of rhythmic components. `referenceHrs` is the reference zeitgeber time in HOURS for the phase-angle-of-entrainment metric. `alpha` is the significance level (0.05). `permuteTest:true` turns on the permutation test and only then are `nPermutations`/`permutationSeed`/`permutationStatistic` read.',
	DoubleLogistic:
		'`fixPeriod:true` pins the period to `fixedPeriod` (HOURS); the `fixK1`/`fixK2` flags likewise pin the slope parameters to `fixedK1`/`fixedK2`. `permuteTest:true` enables the permutation test (`nPermutations`/`permutationSeed`/`permutationStatistic`).',
	RectangularWave:
		'`fixOmega:true` pins the period to `fixedPeriod` (HOURS); `fixKappa`/`fixDutyCycle` pin the waveform shape to `fixedKappa`/`fixedDutyCycle`. `permuteTest:true` enables the permutation test.',
	NonparametricRA:
		'Nonparametric circadian rhythm analysis (IS, IV, RA, M10, L5). `epochHours` is the bin width in HOURS the data is resampled to. `period` is the expected period in HOURS (24 for daily). `mWindow`/`lWindow` are the M10/L5 window lengths in HOURS — the most-active and least-active spans (default 10 and 5).',
	CircadianFunctionIndex:
		'`period` is the expected period in HOURS. `epochHours` is the resampling bin width in HOURS. `mWindow`/`lWindow` are the most-active / least-active window lengths in HOURS.',
	AverageProfile:
		'Folds the data onto one cycle. `period` is the folding period in HOURS (24 for a daily profile); `nBins` is how many bins the cycle is divided into.',
	RayleighTest:
		'`period` is the period the phases are computed against, in HOURS. `unit` is the unit the input times are already in.'
};
