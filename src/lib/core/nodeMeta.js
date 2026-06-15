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
			nodeIcon: 'node-rectangular-wave', // no dedicated 'simulate' icon; reuse rectangular-wave as a generic-signal cue
			description: 'Generate a synthetic time-series table from a cosine + noise model.'
		}
	],
	[
		'SequenceColumn',
		{
			family: 'Sources',
			nodeIcon: 'column-add',
			description: 'Create a numeric or time sequence column.'
		}
	],
	[
		'BlankColumn',
		{
			family: 'Sources',
			nodeIcon: 'column-add',
			description: 'Add a blank column to a table for manual entry.'
		}
	],
	[
		'Random',
		{
			family: 'Sources',
			nodeIcon: 'column-add', // no dedicated random icon
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
			nodeIcon: 'node-add', // no dedicated subtract icon; reuse add icon
			description: 'Subtract a constant or column from the input column.'
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
			description: 'Sort the table by the chosen column(s).'
		}
	],

	// ---- Smoothing -------------------------------------------------------
	[
		'SmoothedData',
		{
			family: 'Smoothing',
			nodeIcon: 'node-smooth-data',
			description: 'Smooth a column using LOESS, moving average, Savitzky-Golay, or Whittaker-Eilers.'
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
			nodeIcon: 'node-cosinor', // no generic fit icon; reuse cosinor as a fit cue
			description: 'Fit an arbitrary user-supplied function to the column.'
		}
	],
	[
		'DoubleLogistic',
		{
			family: 'Fitting',
			nodeIcon: 'node-double-logistic',
			description: 'Fit a double-logistic curve to the column (useful for phenology / on-off transitions).'
		}
	],
	[
		'TrendFit',
		{
			family: 'Fitting',
			nodeIcon: 'remove-trend-linear', // no dedicated trend-fit icon; reuse the linear trend glyph
			description: 'Fit and store a trend (linear, polynomial, exponential, logarithmic) over the column.'
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
			nodeIcon: 'node-periodogram', // no dedicated moving-analysis icon
			description: 'Compute a rolling-window analysis across the column.'
		}
	],
	[
		'GroupComparison',
		{
			family: 'Analysis',
			nodeIcon: 'column-avg', // no dedicated group-comparison icon
			description: 'Compare statistics between groups defined by another column.'
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
			nodeIcon: 'node-long-to-wide', // no dedicated wide-to-long icon; reuse the same glyph
			description: 'Pivot a wide-format table into long format.'
		}
	],
	[
		'CollectColumns',
		{
			family: 'Transform',
			nodeIcon: 'collect-columns',
			description: 'Collect (concatenate) several columns into one.'
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
		'Duplicate',
		{
			family: 'Transform',
			nodeIcon: 'column-add', // no dedicated duplicate icon
			description: 'Duplicate a column under a new name.'
		}
	],
	[
		'Split',
		{
			family: 'Transform',
			nodeIcon: 'node-substitute', // no dedicated split icon; substitute is the closest neutral glyph
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
			nodeIcon: 'process', // no plot-specific icon; use generic process glyph
			description: 'Scatterplot of one column versus another.'
		}
	],
	[
		'actogram',
		{
			family: 'Plots',
			nodeIcon: 'process',
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
			nodeIcon: 'node-periodogram', // FFT and periodogram both show a spectrum
			description: 'Fourier analysis (FFT) spectrum of a time-series.'
		}
	],
	[
		'correlogram',
		{
			family: 'Plots',
			nodeIcon: 'process',
			description: 'Autocorrelation / cross-correlation plot.'
		}
	],
	[
		'boxplot',
		{
			family: 'Plots',
			nodeIcon: 'process',
			description: 'Boxplot summarising the distribution of a column by group.'
		}
	],
	[
		'histogram',
		{
			family: 'Plots',
			nodeIcon: 'process',
			description: 'Histogram of a column.'
		}
	],
	[
		'dataview',
		{
			family: 'Plots',
			nodeIcon: 'dataview',
			description: 'Raw data view of selected columns.'
		}
	],
	[
		'tableplot',
		{
			family: 'Plots',
			nodeIcon: 'table',
			description: 'Tabular display of a table or its summary statistics.'
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
		description: entry?.description ?? ''
	};
}

export default meta;
