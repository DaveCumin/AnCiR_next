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
			nodeIcon: 'simulated-data',
			description: 'Generate a synthetic time-series table from a cosine + noise model.'
		}
	],
	[
		'SequenceColumn',
		{
			family: 'Sources',
			nodeIcon: 'sequence-col',
			description: 'Create a numeric or time sequence column.'
		}
	],
	[
		'BlankColumn',
		{
			family: 'Sources',
			nodeIcon: 'blank-column',
			description: 'Enter data by hand, or paste CSV/JSON.'
		}
	],
	[
		'Random',
		{
			family: 'Sources',
			nodeIcon: 'random',
			description: 'Generate a column of random values.'
		}
	],

	// ---- Arithmetic ------------------------------------------------------
	[
		'Add',
		{
			family: 'Arithmetic',
			nodeIcon: 'node-add',
			description: 'Add a constant or column to the input column.'
		}
	],
	[
		'Sub',
		{
			family: 'Arithmetic',
			nodeIcon: 'node-substitute',
			description:
				'Find a specific value in the column and replace it with another (e.g. swap a missing-data code like −999 for a different value).'
		}
	],
	[
		'Multiply',
		{
			family: 'Arithmetic',
			nodeIcon: 'node-multiply',
			description: 'Multiply the input column by a constant or another column.'
		}
	],
	[
		'normalize',
		{
			family: 'Arithmetic',
			nodeIcon: 'node-normalize',
			description: 'Normalize the column to a chosen range or by a reference value.'
		}
	],
	[
		'FormulaColumn',
		{
			family: 'Arithmetic',
			nodeIcon: 'node-formula-column',
			description: 'Compute a new column from a user-supplied formula referencing other columns.'
		}
	],
	[
		'ColumnFunctions',
		{
			family: 'Arithmetic',
			nodeIcon: 'column-avg', // no dedicated column-functions icon; column-avg is the closest of the column-* family
			description: 'Apply a per-column aggregate function (mean, sum, etc.) across rows or groups.'
		}
	],

	// ---- Filtering -------------------------------------------------------
	[
		'FilterByOtherCol',
		{
			family: 'Filtering',
			nodeIcon: 'node-filter',
			description: 'Filter rows based on the values of another column.'
		}
	],
	[
		'OutlierRemoval',
		{
			family: 'Filtering',
			nodeIcon: 'node-remove-outliers',
			description: 'Detect and remove outliers from the column.'
		}
	],
	[
		'RemoveTrend',
		{
			family: 'Filtering',
			nodeIcon: 'node-remove-trend',
			description: 'Remove a fitted trend (linear, polynomial, etc.) from the column.'
		}
	],
	[
		'Sort',
		{
			family: 'Filtering',
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
			nodeIcon: 'node-bin-data',
			description: 'Bin time-series values into regular intervals and aggregate per bin.'
		}
	],
	[
		'Interpolate',
		{
			family: 'Binning',
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
			nodeIcon: 'node-cosinor',
			description: 'Fit a cosinor model (period, amplitude, acrophase) to the column.'
		}
	],
	[
		'FitFunction',
		{
			family: 'Fitting',
			nodeIcon: 'fit-function',
			description: 'Fit an arbitrary user-supplied function to the column.'
		}
	],
	[
		'DoubleLogistic',
		{
			family: 'Fitting',
			nodeIcon: 'node-double-logistic',
			description:
				'Fit a double-logistic curve to the column (useful for phenology / on-off transitions).'
		}
	],
	[
		'TrendFit',
		{
			family: 'Fitting',
			nodeIcon: 'linear-fit',
			description:
				'Fit and store a trend (linear, polynomial, exponential, logarithmic) over the column.'
		}
	],
	[
		'RectangularWave',
		{
			family: 'Fitting',
			nodeIcon: 'node-rectangular-wave',
			description: 'Fit a rectangular (square) wave model with adjustable duty cycle.'
		}
	],

	// ---- Analysis --------------------------------------------------------
	[
		'RhythmicityAnalysis',
		{
			family: 'Analysis',
			nodeIcon: 'node-periodogram',
			description: 'Run rhythmicity statistics over the column.'
		}
	],
	[
		'MovingAnalysis',
		{
			family: 'Analysis',
			nodeIcon: 'moving-analysis',
			description: 'Compute a rolling-window analysis across the column.'
		}
	],
	[
		'GroupComparison',
		{
			family: 'Analysis',
			nodeIcon: 'group-comp',
			description: 'Compare statistics between groups defined by another column.'
		}
	],
	[
		'NonparametricRA',
		{
			family: 'Analysis',
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
			nodeIcon: 'node-long-to-wide',
			description: 'Pivot a long-format table into wide format.'
		}
	],
	[
		'WideToLong',
		{
			family: 'Transform',
			nodeIcon: 'wide-to-long',
			description: 'Pivot a wide-format table into long format.'
		}
	],
	[
		'CollectColumns',
		{
			family: 'Transform',
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
			nodeIcon: 'column-set',
			description: 'Curate a live subset of columns by name/label and reuse it as one wire.'
		}
	],
	[
		'EditValue',
		{
			family: 'Transform',
			nodeIcon: 'edit-value',
			description: 'Edit or substitute individual values in a column.'
		}
	],
	[
		'Split',
		{
			family: 'Transform',
			nodeIcon: 'split',
			description: 'Split a column or table on a delimiter or group key.'
		}
	],
	[
		'StoredValueGroup',
		{
			family: 'Transform',
			nodeIcon: 'collect-columns', // no dedicated stored-value-group icon
			description: 'Group derived stored values together for reuse.'
		}
	],

	// ---- Plots (registry key is folderName.toLowerCase()) ----------------
	[
		'scatterplot',
		{
			family: 'Plots',
			nodeIcon: 'scatterplot',
			description: 'Scatterplot of one column versus another.'
		}
	],
	[
		'actogram',
		{
			family: 'Plots',
			nodeIcon: 'actogram',
			description: 'Actogram (double-plotted activity over days).'
		}
	],
	[
		'periodogram',
		{
			family: 'Plots',
			nodeIcon: 'node-periodogram',
			description: 'Periodogram (Lomb-Scargle / chi-squared) of a time-series.'
		}
	],
	[
		'fft',
		{
			family: 'Plots',
			nodeIcon: 'fft',
			description: 'Fourier analysis (FFT) spectrum of a time-series.'
		}
	],
	[
		'correlogram',
		{
			family: 'Plots',
			nodeIcon: 'correlogram',
			description: 'Autocorrelation / cross-correlation plot.'
		}
	],
	[
		'boxplot',
		{
			family: 'Plots',
			nodeIcon: 'boxplot',
			description: 'Boxplot summarising the distribution of a column by group.'
		}
	],
	[
		'histogram',
		{
			family: 'Plots',
			nodeIcon: 'histogram',
			description: 'Histogram of a column.'
		}
	],
	[
		'dataview',
		{
			family: 'Plots',
			nodeIcon: 'dataview',
			// Spawned only from a plot's "View data" action (it mirrors that plot's
			// computed download data); it has no meaning added blank from the palette,
			// so keep it out of the palette. The Table node covers manual tables.
			hideFromPalette: true,
			description: "Inspector for a plot's computed data (bins, spectra, fitted values); opened from a plot's View data action."
		}
	],
	[
		'tableplot',
		{
			family: 'Plots',
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
			nodeIcon: 'average-profile',
			description:
				'Average daily profile — fold a series onto one period and show the per-bin mean (± SEM).'
		}
	],
	[
		'RayleighTest',
		{
			family: 'Analysis',
			nodeIcon: 'circular-stats',
			description:
				'Circular statistics on phase/angle columns: the Rayleigh uniformity test (R, z, p) per column, with an optional Watson-Williams equal-mean-direction test (F, p) across columns.'
		}
	],
	[
		'CircadianFunctionIndex',
		{
			family: 'Analysis',
			nodeIcon: 'cfi',
			description:
				'Circadian Function Index (0–1) summarising rest-activity rhythm robustness from nonparametric IS, IV and RA (Ortiz-Tudela et al. 2010).'
		}
	],
	[
		'FrequencyFilter',
		{
			family: 'Filtering',
			nodeIcon: 'node-frequency-filter',
			description: 'FFT-based low-, high-, or band-pass filter over an evenly sampled series.'
		}
	],
	[
		'meansem',
		{
			family: 'Plots',
			nodeIcon: 'mean-sem',
			description: 'Mean ± SEM overlay: per-group mean marker with standard-error whiskers.'
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
		hideFromPalette: entry?.hideFromPalette ?? false
	};
}

export default meta;
