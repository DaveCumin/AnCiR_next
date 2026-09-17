// @ts-nocheck

/**
 * Central node-meta registry.
 *
 * Keys are the file-name (sans `.svelte`) used as the key in
 * `appConsts.processMap`, `appConsts.tableProcessMap`, and (for plots) the
 * folder name in lowercase used as the key in `appConsts.plotMap`.
 *
 * Each entry is { family, nodeIcon, description }.
 *
 * Approach chosen: this map is consumed by the three loaders (processMap,
 * tableProcessMap, plotMap) so the metadata lives on every registry entry.
 * That way any consumer (palette, node renderer, tooltips) can read it
 * directly without re-doing a lookup. Entries without a node-* SVG fall back
 * to a generic existing icon (noted inline below).
 *
 * Icon naming convention: prefer the flowtest-style `node-*.svg` files when
 * one exists in `src/lib/icons/`. Where no node-* match exists, fall back to
 * an existing AnCiR icon ('gear', 'process', 'plus', 'edit', 'table',
 * 'column-add', etc.). Those fallbacks are commented inline.
 */

const meta = new Map([
	// ---- Sources ---------------------------------------------------------
	[
		'SimulatedData',
		{
			family: 'Sources',
			keywords: ['synthetic', 'fake', 'cosine', 'noise', 'demo', 'generate'], // search-only synonyms; never rendered
			nodeIcon: 'simulated-data',
			description: 'Generate a synthetic time-series table from a cosine + noise model.'
		}
	],
	[
		'SequenceColumn',
		{
			family: 'Sources',
			keywords: ['range', 'ramp', 'index', 'timestamps', 'counter', 'time axis'], // search-only synonyms; never rendered
			nodeIcon: 'sequence-col',
			description: 'Create a numeric or time sequence column.'
		}
	],
	[
		'BlankColumn',
		{
			family: 'Sources',
			keywords: ['manual', 'paste', 'empty', 'enter', 'new', 'type in'], // search-only synonyms; never rendered
			nodeIcon: 'blank-column',
			description: 'Enter data by hand, or paste CSV/JSON.'
		}
	],
	[
		'Random',
		{
			family: 'Sources',
			keywords: ['noise', 'uniform', 'gaussian', 'normal', 'rng', 'seed'], // search-only synonyms; never rendered
			nodeIcon: 'random',
			description: 'Generate a column of random values.'
		}
	],

	// ---- Arithmetic ------------------------------------------------------
	[
		'Add',
		{
			family: 'Arithmetic',
			keywords: ['plus', 'sum', 'offset', 'shift', 'subtract', 'constant'], // search-only synonyms; never rendered
			nodeIcon: 'node-add',
			description: 'Add a constant or column to the input column.'
		}
	],
	[
		'Sub',
		{
			family: 'Arithmetic',
			keywords: ['substitute', 'replace', 'recode', 'swap', 'missing code', 'find'], // search-only synonyms; never rendered
			nodeIcon: 'node-substitute',
			description:
				'Find a specific value in the column and replace it with another (e.g. swap a missing-data code like −999 for a different value).'
		}
	],
	[
		'Multiply',
		{
			family: 'Arithmetic',
			keywords: ['times', 'scale', 'product', 'divide', 'factor'], // search-only synonyms; never rendered
			nodeIcon: 'node-multiply',
			description: 'Multiply the input column by a constant or another column.'
		}
	],
	[
		'normalize',
		{
			family: 'Arithmetic',
			keywords: ['rescale', 'standardize', 'z-score', 'zscore', 'unit range', 'percent'], // search-only synonyms; never rendered
			nodeIcon: 'node-normalize',
			description: 'Normalize the column to a chosen range or by a reference value.'
		}
	],
	[
		'FormulaColumn',
		{
			family: 'Arithmetic',
			keywords: ['expression', 'equation', 'calculate', 'compute', 'math', 'custom'], // search-only synonyms; never rendered
			nodeIcon: 'node-formula-column',
			description: 'Compute a new column from a user-supplied formula referencing other columns.'
		}
	],
	[
		'ColumnFunctions',
		{
			family: 'Arithmetic',
			keywords: ['stats', 'mean', 'sd', 'average', 'aggregate', 'summary', 'sum', 'median'], // search-only synonyms; never rendered
			nodeIcon: 'column-avg', // no dedicated column-functions icon; column-avg is the closest of the column-* family
			description: 'Apply a per-column aggregate function (mean, sum, etc.) across rows or groups.'
		}
	],
	[
		'FDRCorrection',
		{
			family: 'Analysis',
			keywords: [
				'multiple comparisons',
				'benjamini',
				'hochberg',
				'bonferroni',
				'holm',
				'p-value',
				'adjust'
			], // search-only synonyms; never rendered
			nodeIcon: 'node-fdr',
			description:
				'Adjust a column of p-values for multiple comparisons and flag which survive. Benjamini-Hochberg (FDR under independence or positive dependence), Benjamini-Yekutieli (FDR under arbitrary dependence), Holm and Bonferroni (family-wise error). Missing p-values stay missing and are excluded from the count, so a test that failed to run never tightens the correction on the ones that did.'
		}
	],
	[
		'SurrogateTest',
		{
			family: 'Analysis',
			keywords: ['permutation', 'bootstrap', 'null', 'shuffle', 'significance', 'red noise'], // search-only synonyms; never rendered
			nodeIcon: 'node-surrogate',
			description:
				"Test rhythm strength against a surrogate null that PRESERVES the series' nuisance structure. Plain shuffling destroys autocorrelation, which makes the null far too easy to beat; block bootstrap and AR(1) red noise keep it. Phase-randomised and AAFT surrogates are also offered for association questions — the node warns when the chosen null cannot answer the question being asked."
		}
	],
	[
		'Threshold',
		{
			family: 'Arithmetic',
			keywords: ['binarize', 'cutoff', 'binary', 'dichotomize', '0/1'], // search-only synonyms; never rendered
			nodeIcon: 'node-threshold',
			description:
				'Turn a column into a 0/1 (binary) column at a user-set cutoff — e.g. to make a binary outcome for logistic regression.'
		}
	],
	[
		'Crossing',
		{
			family: 'Analysis',
			keywords: [
				'detection',
				'alert',
				'alarm',
				'set-point',
				'spc',
				'control limits',
				'persistence',
				'event'
			], // search-only synonyms; never rendered
			nodeIcon: 'node-threshold',
			description:
				'Find when a rule over one or more series becomes sustainedly true: conditions against typed values or wired scalar thresholds, combined as OR of AND-groups, with a persistence requirement. Outputs every crossing time, their count, and a 0/1 breach series.'
		}
	],

	// ---- Filtering -------------------------------------------------------
	[
		'FilterByOtherCol',
		{
			family: 'Filtering',
			keywords: ['subset', 'select', 'where', 'condition', 'exclude', 'mask'], // search-only synonyms; never rendered
			nodeIcon: 'node-filter',
			description: 'Filter rows based on the values of another column.'
		}
	],
	[
		'OutlierRemoval',
		{
			family: 'Filtering',
			keywords: ['clean', 'spike', 'artifact', 'despike', 'iqr', 'extreme values'], // search-only synonyms; never rendered
			nodeIcon: 'node-remove-outliers',
			description: 'Detect and remove outliers from the column.'
		}
	],
	[
		'RemoveTrend',
		{
			family: 'Filtering',
			keywords: ['detrend', 'drift', 'baseline', 'flatten'], // search-only synonyms; never rendered
			nodeIcon: 'node-remove-trend',
			description: 'Remove a fitted trend (linear, polynomial, etc.) from the column.'
		}
	],
	[
		'Sort',
		{
			family: 'Filtering',
			keywords: ['order', 'ascending', 'descending', 'rank', 'arrange'], // search-only synonyms; never rendered
			nodeIcon: 'node-filter', // no dedicated sort icon; reuse filter glyph
			description:
				'Sort rows by a chosen column, keeping the selected columns aligned (ascending or descending).'
		}
	],

	// ---- Smoothing -------------------------------------------------------
	[
		'SmoothedData',
		{
			family: 'Smoothing',
			keywords: [
				'loess',
				'lowess',
				'moving average',
				'savitzky-golay',
				'denoise',
				'rolling',
				'filter'
			], // search-only synonyms; never rendered
			nodeIcon: 'node-smooth-data',
			description:
				'Smooth a column using LOESS, moving average, Savitzky-Golay, or Whittaker-Eilers.'
		}
	],

	// ---- Binning ---------------------------------------------------------
	[
		'BinnedData',
		{
			family: 'Binning',
			keywords: ['downsample', 'resample', 'aggregate', 'bucket', 'epoch', 'interval'], // search-only synonyms; never rendered
			nodeIcon: 'node-bin-data',
			description: 'Bin time-series values into regular intervals and aggregate per bin.'
		}
	],
	[
		'Interpolate',
		{
			family: 'Binning',
			keywords: ['resample', 'fill gaps', 'missing', 'spline', 'regular grid', 'upsample'], // search-only synonyms; never rendered
			nodeIcon: 'node-interpolate',
			description:
				'Fill missing values or resample a series onto a regular grid by interpolation (linear, nearest, or cubic spline).'
		}
	],

	// ---- Fitting ---------------------------------------------------------
	[
		'Cosinor',
		{
			family: 'Fitting',
			keywords: ['rhythm', 'fit', 'acrophase', 'amplitude', 'mesor', 'sine', 'cosine'], // search-only synonyms; never rendered
			nodeIcon: 'node-cosinor',
			description: 'Fit a cosinor model (period, amplitude, acrophase) to the column.'
		}
	],
	[
		'FitFunction',
		{
			family: 'Fitting',
			keywords: ['model', 'waveform', 'curve', 'regression', 'compare shapes'], // search-only synonyms; never rendered
			nodeIcon: 'fit-function',
			description:
				'Fit a named waveform model to the column: cosinor, rectangular wave, or double logistic. Use it to compare different waveform shapes on the same series without rewiring; the fit quality (R2, RMSE, permutation p) and the chosen model’s parameters are wireable metric output ports, like the dedicated Cosinor, Rectangular Wave and Double Logistic nodes.'
		}
	],
	[
		'DoubleLogistic',
		{
			family: 'Fitting',
			keywords: ['sigmoid', 'phenology', 'transition', 'onset', 'offset', 'curve'], // search-only synonyms; never rendered
			nodeIcon: 'node-double-logistic',
			description:
				'Fit a double-logistic curve to the column (useful for phenology / on-off transitions).'
		}
	],
	[
		'TrendFit',
		{
			family: 'Fitting',
			keywords: ['regression', 'slope', 'linear', 'polynomial', 'drift', 'baseline'], // search-only synonyms; never rendered
			nodeIcon: 'linear-fit',
			description:
				'Fit a slow, non-oscillatory trend by least squares (linear, polynomial, exponential or logarithmic) and store the fitted curve with its R2, RMSE and coefficients. Use it to describe or remove baseline drift, growth or decay before rhythm analysis.'
		}
	],
	[
		'RectangularWave',
		{
			family: 'Fitting',
			keywords: ['square', 'duty cycle', 'on-off', 'step', 'pulse'], // search-only synonyms; never rendered
			nodeIcon: 'node-rectangular-wave',
			description: 'Fit a rectangular (square) wave model with adjustable duty cycle.'
		}
	],

	// ---- Analysis --------------------------------------------------------
	[
		'RhythmicityAnalysis',
		{
			family: 'Analysis',
			keywords: ['period', 'periodogram', 'lomb-scargle', 'chi-squared', 'circadian', 'tau'], // search-only synonyms; never rendered
			nodeIcon: 'node-periodogram',
			description: 'Run rhythmicity statistics over the column.'
		}
	],
	[
		'MovingAnalysis',
		{
			family: 'Analysis',
			keywords: ['rolling', 'sliding', 'window'], // search-only synonyms; never rendered
			nodeIcon: 'moving-analysis',
			description: 'Compute a rolling-window analysis across the column.'
		}
	],
	[
		'GroupComparison',
		{
			family: 'Analysis',
			keywords: ['t-test', 'ttest', 'anova', 'mann-whitney', 'wilcoxon', 'significance'], // search-only synonyms; never rendered
			nodeIcon: 'group-comp',
			description: 'Compare statistics between groups defined by another column.'
		}
	],
	[
		'DescribeData',
		{
			family: 'Analysis',
			keywords: ['summary', 'stats', 'mean', 'median', 'quartiles', 'descriptive'], // search-only synonyms; never rendered
			nodeIcon: 'table',
			description:
				'Per-column summary statistics (mean, median, sd, min/max, quartiles, skewness, kurtosis).'
		}
	],
	[
		'LogisticRegression',
		{
			family: 'Analysis',
			keywords: ['binary outcome', 'odds ratio', 'classification', 'glm', 'predictor'], // search-only synonyms; never rendered
			nodeIcon: 'scatterplot',
			description:
				'Model a binary outcome from one or more predictors: coefficients, odds ratios with 95% CIs, Wald p-values, and model fit (pseudo-R², LR test).'
		}
	],
	[
		'ChiSquared',
		{
			family: 'Analysis',
			keywords: ['contingency', 'fisher', 'categorical', 'independence', 'counts'], // search-only synonyms; never rendered
			nodeIcon: 'group-comp',
			description:
				"Tests for categorical data: chi-squared independence of two variables (contingency table), chi-squared goodness-of-fit against a uniform expectation, or Fisher's exact test for small 2x2 tables. Reports an effect size (Cramer's V, Cohen's w, or the odds ratio with a confidence interval) alongside the p-value."
		}
	],
	[
		'CrossCorrelation',
		{
			family: 'Analysis',
			keywords: ['lag', 'delay', 'xcorr', 'coupling', 'lead'], // search-only synonyms; never rendered
			nodeIcon: 'correlogram',
			description:
				'Cross-correlogram of two series: the correlation at each lag, with the peak lag revealing the delay between them.'
		}
	],
	[
		'NormalityTest',
		{
			family: 'Analysis',
			keywords: ['shapiro-wilk', 'gaussian', 'distribution', 'jarque-bera', 'dagostino'], // search-only synonyms; never rendered
			nodeIcon: 'histogram',
			description:
				'Test each wired column for normality (Shapiro-Wilk by default, or D’Agostino-Pearson / Jarque-Bera), reporting the statistic, p-value and a verdict.'
		}
	],
	[
		'Correlation',
		{
			family: 'Analysis',
			keywords: ['pearson', 'spearman', 'association', 'matrix', 'relationship', 'r'], // search-only synonyms; never rendered
			nodeIcon: 'scatterplot',
			description:
				'Pairwise correlation matrix (Pearson or Spearman) across the wired columns, with normality-based auto method choice.'
		}
	],
	[
		'NonparametricRA',
		{
			family: 'Analysis',
			keywords: ['IS', 'IV', 'actigraphy', 'stability', 'fragmentation', 'M10', 'L5'], // search-only synonyms; never rendered
			nodeIcon: 'actogram',
			description:
				'Nonparametric rest-activity variables (IS, IV, RA, M10/L5) — robust to non-sinusoidal rhythms.'
		}
	],

	// ---- Transform -------------------------------------------------------
	[
		'LongToWide',
		{
			family: 'Transform',
			keywords: ['pivot', 'reshape', 'spread', 'unstack'], // search-only synonyms; never rendered
			nodeIcon: 'node-long-to-wide',
			description: 'Pivot a long-format table into wide format.'
		}
	],
	[
		'WideToLong',
		{
			family: 'Transform',
			keywords: ['pivot', 'reshape', 'melt', 'stack', 'gather', 'tidy'], // search-only synonyms; never rendered
			nodeIcon: 'wide-to-long',
			description: 'Pivot a wide-format table into long format.'
		}
	],
	[
		'CollectColumns',
		{
			family: 'Transform',
			keywords: ['concatenate', 'combine', 'merge', 'gather'], // search-only synonyms; never rendered
			nodeIcon: 'collect-columns',
			description: 'Collect (concatenate) several columns into one.',
			// Hidden from the + palette (use a Group instead). Still registered so the
			// "collected mode" container other analyses rely on keeps working.
			hideFromPalette: true
		}
	],
	[
		'ColumnSet',
		{
			family: 'Transform',
			keywords: ['subset', 'selection', 'bundle', 'wildcard', 'reuse'], // search-only synonyms; never rendered
			nodeIcon: 'column-set',
			description: 'Curate a live subset of columns by name/label and reuse it as one wire.'
		}
	],
	[
		'EditValue',
		{
			family: 'Transform',
			keywords: ['cell', 'fix', 'correct', 'replace', 'manual'], // search-only synonyms; never rendered
			nodeIcon: 'edit-value',
			description: 'Edit or substitute individual values in a column.'
		}
	],
	[
		'Split',
		{
			family: 'Transform',
			keywords: ['segment', 'separate', 'partition', 'chunk', 'by group'], // search-only synonyms; never rendered
			nodeIcon: 'split',
			description: 'Split a column or table on a delimiter or group key.'
		}
	],
	[
		'StoredValueGroup',
		{
			family: 'Transform',
			keywords: ['metrics', 'scalar', 'collect', 'bundle', 'results'], // search-only synonyms; never rendered
			nodeIcon: 'collect-columns', // no dedicated stored-value-group icon
			description: 'Group derived stored values together for reuse.'
		}
	],

	// ---- Plots (registry key is folderName.toLowerCase()) ----------------
	[
		'scatterplot',
		{
			family: 'Plots',
			keywords: ['xy', 'points', 'dots', 'correlation', 'relationship'], // search-only synonyms; never rendered
			nodeIcon: 'scatterplot',
			description:
				'Scatterplot of one column versus another, with reference lines and shaded bands (wired or typed) from its Overlays tab.'
		}
	],
	[
		'actogram',
		{
			family: 'Plots',
			keywords: ['double plot', 'raster', 'activity', 'days', 'circadian'], // search-only synonyms; never rendered
			nodeIcon: 'actogram',
			description: 'Actogram (double-plotted activity over days).'
		}
	],
	[
		'periodogram',
		{
			family: 'Plots',
			keywords: ['spectrum', 'period', 'lomb-scargle', 'power', 'rhythm'], // search-only synonyms; never rendered
			nodeIcon: 'node-periodogram',
			description: 'Periodogram (Lomb-Scargle / chi-squared) of a time-series.'
		}
	],
	[
		'fft',
		{
			family: 'Plots',
			keywords: ['fourier', 'spectrum', 'frequency', 'power', 'harmonics'], // search-only synonyms; never rendered
			nodeIcon: 'fft',
			description: 'Fourier analysis (FFT) spectrum of a time-series.'
		}
	],
	[
		'cwt',
		{
			family: 'Plots',
			keywords: ['wavelet', 'scalogram', 'time-frequency', 'morlet', 'spectrogram'], // search-only synonyms; never rendered
			nodeIcon: 'node-wavelet',
			description:
				'Continuous wavelet transform (scalogram): power as a function of BOTH time and period, so a rhythm that changes period or strength over the record is visible where a periodogram would only show a time-average. Morlet/Paul/DOG wavelets, Torrence & Compo (1998) normalisation, with the cone of influence drawn (values outside it are edge artefacts) and an optional ridge showing the dominant period at each moment. Requires uniformly sampled data.'
		}
	],
	[
		'correlogram',
		{
			family: 'Plots',
			keywords: ['autocorrelation', 'acf', 'lag', 'cross-correlation'], // search-only synonyms; never rendered
			nodeIcon: 'correlogram',
			description: 'Autocorrelation / cross-correlation plot.'
		}
	],
	[
		'boxplot',
		{
			family: 'Plots',
			keywords: ['violin', 'distribution', 'quartiles', 'whiskers', 'groups'], // search-only synonyms; never rendered
			nodeIcon: 'boxplot',
			description:
				'Boxplot summarising the distribution of a column by group, with optional violin (kernel density) overlay and jittered data points; the box can be hidden for a pure violin plot.'
		}
	],
	[
		'histogram',
		{
			family: 'Plots',
			keywords: ['distribution', 'frequency', 'bins', 'density', 'counts'], // search-only synonyms; never rendered
			nodeIcon: 'histogram',
			description: 'Histogram of a column.'
		}
	],
	[
		'correlationheatmap',
		{
			family: 'Plots',
			keywords: ['matrix', 'pearson', 'spearman', 'colormap', 'pairwise'], // search-only synonyms; never rendered
			nodeIcon: 'heatmap',
			description: 'Coloured correlation matrix computed from the wired columns.'
		}
	],
	[
		'pairsplot',
		{
			family: 'Plots',
			keywords: ['matrix', 'splom', 'panels', 'scatter', 'pairwise'], // search-only synonyms; never rendered
			nodeIcon: 'heatmap',
			description:
				'Scatterplot matrix (pairs.panels): histograms on the diagonal, scatter + fit above, correlation below.'
		}
	],
	[
		'qqplot',
		{
			family: 'Plots',
			keywords: ['quantile', 'normality', 'gaussian', 'distribution', 'residuals'], // search-only synonyms; never rendered
			nodeIcon: 'scatterplot',
			description:
				'Normal Q-Q plot: sample vs theoretical quantiles, with a quartile reference line and confidence envelope.'
		}
	],
	[
		'dataview',
		{
			family: 'Plots',
			keywords: ['table', 'inspect', 'values'], // search-only synonyms; never rendered
			nodeIcon: 'dataview',
			// Spawned only from a plot's "View data" action (it mirrors that plot's
			// computed download data); it has no meaning added blank from the palette,
			// so keep it out of the palette. The Table node covers manual tables.
			hideFromPalette: true,
			description:
				"Inspector for a plot's computed data (bins, spectra, fitted values); opened from a plot's View data action."
		}
	],
	[
		'tableplot',
		{
			family: 'Plots',
			keywords: ['grid', 'spreadsheet', 'values', 'summary', 'display'], // search-only synonyms; never rendered
			// Uses the (nicer) Data View glyph; the Table node supersedes the old
			// Data View plot as the single tabular-display node.
			nodeIcon: 'dataview',
			description: 'Tabular display of a table or its summary statistics.'
		}
	],
	[
		'AverageProfile',
		{
			family: 'Analysis',
			keywords: ['fold', 'waveform', 'mean', '24h', 'diurnal', 'educed'], // search-only synonyms; never rendered
			nodeIcon: 'average-profile',
			description:
				'Average daily profile — fold a series onto one period and show the per-bin mean (± SEM).'
		}
	],
	[
		'RayleighTest',
		{
			family: 'Analysis',
			keywords: ['circular', 'uniformity', 'phase', 'angle', 'acrophase', 'watson-williams'], // search-only synonyms; never rendered
			nodeIcon: 'circular-stats',
			description:
				'Circular statistics on phase/angle columns: the Rayleigh uniformity test (R, z, p, acrophase) per column, with an optional Watson-Williams equal-mean-direction test (F, p) across columns. Wiring an optional time column (hours or timestamp, folded by period) switches to an amplitude-weighted mean vector/acrophase; without it, values are treated as raw angles.'
		}
	],
	[
		'CircadianFunctionIndex',
		{
			family: 'Analysis',
			keywords: ['CFI', 'robustness', 'rest-activity', 'rhythm quality'], // search-only synonyms; never rendered
			nodeIcon: 'cfi',
			description:
				'Circadian Function Index (0–1) summarising rest-activity rhythm robustness from nonparametric IS, IV and RA (Ortiz-Tudela et al. 2010).'
		}
	],
	[
		'FrequencyFilter',
		{
			family: 'Filtering',
			keywords: ['bandpass', 'lowpass', 'highpass', 'fft', 'cutoff'], // search-only synonyms; never rendered
			nodeIcon: 'node-frequency-filter',
			description: 'FFT-based low-, high-, or band-pass filter over an evenly sampled series.'
		}
	],
	[
		'meansem',
		{
			family: 'Plots',
			keywords: ['error bars', 'standard error', 'average', 'whiskers'], // search-only synonyms; never rendered
			nodeIcon: 'mean-sem',
			description: 'Mean ± SEM overlay: per-group mean marker with standard-error whiskers.'
		}
	],
	[
		'circularphase',
		{
			family: 'Plots',
			keywords: ['clock', 'polar', 'rose', 'acrophase', 'rayleigh', 'angle'], // search-only synonyms; never rendered
			nodeIcon: 'circular-stats',
			description:
				'Circular phase plot: one or more phase columns on an adjustable-period clock, each a coloured group with its Rayleigh mean-resultant vector; optional rose wedges and a Watson-Williams equal-mean-direction test. Wiring an optional time column (hours or timestamp, folded by period) to a series plots it at its measurement time with radius = value instead, and the vector becomes an amplitude-weighted acrophase.'
		}
	]
]);

/**
 * Look up node meta. Returns sane defaults when the key is unknown so callers
 * can always render a tile.
 * @param {string} key
 */
export function getNodeMeta(key) {
	const entry = meta.get(key);
	return {
		family: entry?.family ?? 'Other',
		nodeIcon: entry?.nodeIcon ?? 'gear',
		description: entry?.description ?? '',
		// Search-only synonyms for the palette/manifest search; never rendered.
		keywords: entry?.keywords ?? [],
		hideFromPalette: entry?.hideFromPalette ?? false
	};
}

export default meta;
