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

// Terse by design: every double-quoted value is an ENUM the coverage guard checks, so those are
// kept verbatim; the prose is pared to values + units (HOURS) + gating. Rationale, worked numeric
// examples and caveats were moved out to keep the system prompt under the model's token budget.
export const PARAM_NOTES = {
	Threshold:
		'`threshold` is the cutoff; `comparison` is which side counts as 1: ">" (v>t), ">=" (v≥t), "<" (v<t) or "<=" (v≤t). Missing/non-numeric values stay missing.',
	LogisticRegression:
		'`yIN` is the BINARY outcome — one 0/1 (or two-level) column, NOT continuous (gaussian/uniform values fail with a "not binary" warning). Make one via Random distribution:"bernoulli" or a Threshold node. `xIN` is one or more continuous predictors (several → multivariable, one coefficient/odds-ratio each).',
	FDRCorrection:
		'Corrects a COLUMN OF P-VALUES (`xIN`, e.g. a `pvalue` metric output) for multiple comparisons. `method`: "benjamini-hochberg" (FDR; independence/positive dependence; usual screening choice), "benjamini-yekutieli" (FDR under arbitrary dependence; conservative), "holm" (family-wise error), "bonferroni" (FWER, strictest) or "none" (raw p-values). `alpha` is the reject threshold (0.05). Outputs `padj` and `reject`; missing p-values stay missing. Combine families into one column (CollectColumns) to correct them together.',
	SurrogateTest:
		'`xIN` is time, `yIN` the values (single columns). `method` picks the null (a scientific choice): "block" (moving-block bootstrap; default for rhythmicity), "ar1" (red noise; classic "is this peak real"), "phase" and "aaft" (preserve the amplitude spectrum EXACTLY, so they CANNOT test rhythmicity — the node warns; use for association/coupling/nonlinearity), "shuffle" (plain permutation; anti-conservative on time series). `blockLengthHours` (HOURS) is read only for "block". `periodMin`/`periodMax` (HOURS) bound the test band. `nSurrogates` sets resolution (min p = 1/(n+1)). `seed` for reproducibility. Outputs `pvalue`, `observed`.',
	ChiSquared:
		'`dataFormat`: "groups" (default — two INDEPENDENT samples, one column per group, usually different lengths) or "paired" (one row per subject with both variables, same length, paired by index); feeding independent groups to "paired" truncates/mispairs, so the node warns on a length mismatch. Applies to independence/fisher; goodness takes one column. `testType`: "independence" (`xIN`=rows, `yIN`=cols → contingency test of association), "goodness" (one column `xIN` vs a uniform expectation), "fisher" (exact test on a 2×2 from `xIN`×`yIN`). `correction` = Yates, 2×2 independence only. `alternative` ("two-sided"/"less"/"greater") is read only in fisher. Outputs statistic, pvalue, df, effectSize (Cramer\'s V / Cohen\'s w / odds ratio). Expected counts < 5 ⇒ switch to "fisher" (exact at any n; leaves statistic/df NaN).',
	CrossCorrelation:
		'`xIN` is series A, `yIN` series B. `method`: "pearson" (linear) or "spearman" (rank). `maxLag` is in SAMPLES (0 ⇒ auto). Outputs lag/correlation/pvalue; peak lag = the delay (positive ⇒ B leads A).',
	NormalityTest:
		'`method`: "shapiro" (Shapiro-Wilk, default, 3 ≤ n ≤ 5000), "dagostino" (D’Agostino-Pearson, n ≥ 8) or "jarquebera" (n ≥ 3, weaker). `alpha` is the verdict threshold (0.05). One row per column; small p ⇒ non-normal.',
	Correlation:
		'`method`: "pearson" (linear), "spearman" (rank) or "auto" (Spearman if any column fails a normality check, else Pearson). `alpha` (0.05). Reports every column pair (var_i, var_j, r, pvalue, n).',
	Split:
		'`splitTimes` cuts the series (N points ⇒ N+1 segments). On a TIME x-axis each is EITHER a NUMBER of HOURS from the start (336 = 14 days) OR a full ISO DATE STRING ("2024-08-21", include the year) for a calendar cut — the conversion is done for you. On a numeric x-axis, the column’s own units.',
	RhythmicityAnalysis:
		'`analysis`: "periodogram", "fft" or "correlogram". "periodogram" reads `pgMethod` = "Lomb-Scargle" (uneven/gapped; default), "Chi-squared" (needs even sampling) or "Enright", plus `periodMin`/`periodMax`/`periodStep` (HOURS). `corrMinLag`/`corrMaxLag` are for "correlogram"; `fftFreqStep` for "fft" (0 = auto).',
	MovingAnalysis:
		'One analysis in a sliding window. `analysis` (decides which params matter): "periodogram", "cosinor", "npcra", "fft", "correlogram", "rectfit", "doublelogistic" or "trend". "periodogram" reads `pgMethod` ("Lomb-Scargle"/"Chi-squared"/"Enright") + `periodMin`/`periodMax`/`periodStep` (HOURS); "trend" reads `trendModel` ("linear"/"exponential"/"logarithmic"/"polynomial", last uses `trendPolyDegree`); "cosinor" reads `useFixedPeriod`/`fixedPeriod`/`nHarmonics` (also emits `rel_amplitude`); "npcra" reads `npcraEpochHours`/`npcraPeriod`/`npcraMWindow`/`npcraLWindow`. `windowSize`/`stepSize` are in x-axis units. `binLabel` ("start"/"center"/"end") is where the window\'s result is stamped.',
	SmoothedData:
		'`smootherType` is "whittaker" (`whittakerLambda`/`whittakerOrder`), "moving" (`movingAvgWindowSize`, `movingAvgType` = "simple"/"weighted"/"exponential"), "savitzky" (`savitzkyWindowSize`/`savitzkyPolyOrder`) or "loess" (`loessBandwidth`). Only the chosen smoother\'s params are used.',
	TrendFit:
		'`model` is "linear", "exponential", "logarithmic" or "polynomial" (last uses `polyDegree`). `outputX` -1 reuses the input x grid.',
	FitFunction:
		'`model` is "cosinor", "rectangular" or "doublelogistic". For a periodic fit keep `useFixedPeriod:true`, `fixedPeriod` in HOURS. `permuteTest:true` enables the permutation test (then `nPermutations`/`permutationSeed`/`permutationStatistic` = "rSquared" or "rmse" apply). `fix*`/`fixed*` pairs pin a parameter (e.g. `fixKappa:true` → `fixedKappa`).',
	Cosinor:
		'For a daily rhythm keep `useFixedPeriod:true`, `fixedPeriod` in HOURS (e.g. 24). `nHarmonics` (fixed-period) adds harmonics; `Ncurves` (free-period) is the number of components. `referenceHrs` (HOURS) is the phase-angle reference. `alpha` (0.05). `permuteTest:true` enables the permutation test (`nPermutations`/`permutationSeed`/`permutationStatistic`).',
	DoubleLogistic:
		'`fixPeriod:true` pins the period to `fixedPeriod` (HOURS); `fixK1`/`fixK2` pin the slopes to `fixedK1`/`fixedK2`. `permuteTest:true` enables the permutation test (`nPermutations`/`permutationSeed`/`permutationStatistic`).',
	RectangularWave:
		'`fixOmega:true` pins the period to `fixedPeriod` (HOURS); `fixKappa`/`fixDutyCycle` pin the shape to `fixedKappa`/`fixedDutyCycle`. `permuteTest:true` enables the permutation test.',
	NonparametricRA:
		'IS/IV/RA/M10/L5 metrics. `epochHours` is the resampling bin width (HOURS). `period` is the expected period (HOURS; 24 for daily). `mWindow`/`lWindow` are the M10/L5 window lengths (HOURS; default 10 and 5).',
	CircadianFunctionIndex:
		'`period` (HOURS) is the expected period. `epochHours` (HOURS) is the resampling bin width. `mWindow`/`lWindow` (HOURS) are the most-/least-active window lengths.',
	AverageProfile:
		'Folds the data onto one cycle. `period` is the folding period (HOURS; 24 for daily); `nBins` is the number of bins.',
	RayleighTest:
		'`period` (HOURS) is the period the phases are computed against. `unit` is the unit the input times are already in.'
};
