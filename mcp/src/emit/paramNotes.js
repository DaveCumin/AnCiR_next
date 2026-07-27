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
	Threshold:
		'Turns the input column `xIN` into a 0/1 column at a cutoff. `threshold` is the cutoff value; `comparison` is which side counts as 1: ">" (value > threshold), ">=" (value ≥ threshold), "<" (value < threshold) or "<=" (value ≤ threshold). Missing/non-numeric values stay missing. Use it to make a binary outcome for LogisticRegression from a continuous column.',
	LogisticRegression:
		'`yIN` is the BINARY outcome — a single column of 0/1 (or a two-level category). It is NOT continuous: plain gaussian/uniform random values will not work (the node warns "not binary" and the fit is meaningless). To make a random outcome use Random with distribution:"bernoulli"; to turn a continuous column into 0/1 use a Threshold node. `xIN` is one OR MORE continuous predictor columns (several → multivariable logistic regression, giving a coefficient/odds-ratio per predictor). A demo on random data is therefore: Random gaussian → xIN, Random bernoulli → yIN.',
	FDRCorrection:
		'Corrects a COLUMN OF P-VALUES for multiple comparisons. `xIN` is that column — typically a `pvalue` metric output from another node (a Cosinor wired to 20 y-columns already emits a 20-row pvalue column, which is exactly the right input). `method` is "benjamini-hochberg" (controls the FALSE DISCOVERY RATE, the expected proportion of your declared discoveries that are false — the usual choice when screening many series; valid under independence or positive dependence), "benjamini-yekutieli" (also FDR, but valid under ARBITRARY dependence, so more conservative), "holm" (controls the family-wise error rate: the probability of ANY false claim; stricter, for a small number of confirmatory tests), "bonferroni" (FWER, strictest) or "none" (returns the raw p-values unchanged). `alpha` is the significance level for the reject flag (0.05). Outputs `padj` (adjusted p-values, same length and order as the input) and `reject` (1/0). Missing or non-numeric p-values stay missing and are excluded from n, so a test that failed to run does not tighten the correction on the ones that did. To correct several families together as ONE family, combine them into a single column first (CollectColumns) — running this node separately per column understates the true multiplicity.',
	SurrogateTest:
		'Tests whether a rhythm is stronger than a null that PRESERVES the series\' nuisance structure. `xIN` is time, `yIN` is the values (both single columns). `method` picks the null and this is a SCIENTIFIC choice, not a default to skip: "block" (moving-block bootstrap — resamples contiguous chunks, preserving local structure; the right default for rhythmicity), "ar1" (red noise — fits an AR(1) and simulates from it; the classical null for "is this spectral peak real"), "phase" (phase-randomised) and "aaft" (amplitude-adjusted phase randomisation) — these two preserve the amplitude spectrum EXACTLY and therefore preserve any rhythm, so they CANNOT test for rhythmicity and the node warns when you pick them for that; use them for association between two series, phase coupling or nonlinearity. "shuffle" is plain permutation, kept only for comparison: it destroys autocorrelation and gives anti-conservative (too small) p-values on time series. `blockLengthHours` is read only when method is "block" and is in HOURS (converted to samples internally). `periodMin`/`periodMax` (HOURS) bound the band the test statistic is measured in — band-limited on purpose, because a global spectral maximum loses all power against a red-noise null. `nSurrogates` sets the resolution: the smallest reportable p-value is 1/(nSurrogates+1), so 199 surrogates cannot go below 0.005. `seed` makes a run reproducible. Outputs `pvalue` and `observed`.',
	ChiSquared:
		'`dataFormat` decides HOW the two wired columns are read and it changes the answer completely: "groups" (the DEFAULT) means two INDEPENDENT samples, one column per group holding that group\'s own outcomes, usually of different lengths; "paired" means one row per subject with both variables recorded, so the columns must be the same length and pair BY INDEX; "groups" means two INDEPENDENT samples, one column per group holding that group\'s own outcomes, which are usually different lengths - "7 of 10 responded vs 2 of 25" is a column of 10 and a column of 25. Feeding independent groups to "paired" silently truncates to the shorter column and cross-tabulates unrelated rows (on that example it reports p = 0.86 instead of p = 0.0008), so the node warns when the two columns differ markedly in length. `dataFormat` applies to independence and fisher; goodness-of-fit takes a single column. `testType` is "independence" (two categorical columns: `xIN` = rows, `yIN` = columns → contingency table → test of association), "goodness" (one column `xIN`: a categorical column is tabulated into category counts, a numeric column is read as observed counts, tested against a uniform expectation), or "fisher" (Fisher\'s EXACT test on a 2×2 table from `xIN` × `yIN`). `correction` toggles Yates\' continuity correction, applied only to 2×2 independence tables. `alternative` ("two-sided" / "less" / "greater") is read only in fisher mode. Outputs statistic, pvalue, df and effectSize. `effectSize` is Cramer\'s V for independence (0-1, comparable across table sizes; on a 2x2 it equals |phi|, and the node also shows the SIGNED phi so you can see which diagonal dominates), Cohen\'s w for goodness-of-fit (sqrt(chi2/n), NOT bounded by 1), and the odds ratio in fisher mode. The effect size is computed from the UNCORRECTED chi2 even when Yates is on, because the correction is a p-value device, not a measure of association strength. Expected counts below 5 make the χ² approximation unreliable — that is exactly when to switch `testType` to "fisher", which is exact at any sample size. Fisher mode reports pvalue plus the odds ratio and its exact 95% confidence interval, but leaves statistic and df as NaN because an exact test has neither. Two odds ratios exist and differ on small tables: the node\'s `effectSize` is the CONDITIONAL MLE (what R\'s fisher.test prints, and what the CI belongs to), while the sample ad/bc value is shown alongside - on the table 7/3 vs 2/23 they are 22.93 and 26.83 respectively.',
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
		'Runs one analysis in a sliding window. `analysis` is "periodogram", "cosinor", "npcra", "fft", "correlogram", "rectfit", "doublelogistic" or "trend", and it decides which other params matter: "periodogram" reads `pgMethod` ("Lomb-Scargle"/"Chi-squared"/"Enright") and `periodMin`/`periodMax`/`periodStep` (HOURS); "trend" reads `trendModel` ("linear"/"exponential"/"logarithmic"/"polynomial", the last using `trendPolyDegree`); "cosinor" reads `useFixedPeriod`/`fixedPeriod`/`nHarmonics` and also emits `rel_amplitude` (amplitude/MESOR, NaN when the MESOR is ~0); "npcra" runs the nonparametric metrics per window (interdaily stability IS, intradaily variability IV, relative amplitude RA, plus L5/M10 and M10onset) and reads `npcraEpochHours`/`npcraPeriod`/`npcraMWindow`/`npcraLWindow`. `windowSize`/`stepSize` are in your x-axis units. `binLabel` ("start"/"center"/"end") is which end of the window the result is stamped at — use "end" when a result must reflect only data available at that time.',
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
