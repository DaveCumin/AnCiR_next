// @ts-nocheck
// Human-readable DISPLAY labels for node output columns (review finding UI-4).
//
// Every analysis names its output columns after an internal key plus the owning node's id
// (`cosinory_66_5`, `rsquared_5`, `R_7`). Those names are load-bearing: the key lives in
// `args.out`, downstream wires hold the column id, and the saved session stores the name. So
// none of that changes here. This module only answers "what should a person READ for output
// `key` of node type `T`", and "is this column still carrying its auto-generated name (so the
// label may replace it), or did someone rename it (so their name wins)".
//
// Pure data and pure functions whose only imports are the (equally import-free) plot metric defs
// and Join Data's pairing rule (utils/joinPairing.js),
// so the workflow graph (ProcessNode.svelte.js, which core.svelte.js imports), the Data panel,
// the column pickers and tests can all use it without an import cycle. Session state comes in
// as a parameter (createColumnNamer(core)); core/columnLabels.js binds it to the live core.
//
// Label style: sentence case; hours as the SI symbol "h"; p-values as "p-value"; R² for the
// coefficient of determination, never a bare "R" (Rayleigh's mean resultant length is
// "Mean vector length (R)"). A per-input output (one column per wired y) appends the input
// column's name after a colon, label first: "Cosinor fit: A1", "Residuals: A1".
//
// Adding a node: give it an entry in NODE_OUTPUT_LABELS. The guard test
// (outputLabels.test.js) fails for any registered output key that falls through to its raw id.

import { plotMetricLabel, plotMetricColumnName } from '$lib/plots/plotMetricDefs.js';
// Import-free too (Join Data's pairing and output names), so no cycle.
import { joinPlan } from '$lib/utils/joinPairing.js';

// ---------------------------------------------------------------------------------------------
// Shared vocabulary. One string per quantity, so the same quantity reads the same everywhere.
// ---------------------------------------------------------------------------------------------

/**
 * The fixed-period (linear least-squares) cosinor reports sqrt(SSres / (n - p)), the residual
 * standard error, under the `rmse` key; every other fit's `rmse` is sqrt(SSres / n). One label
 * per quantity (FIT-15).
 */
export const RESIDUAL_SE = 'Residual SE';
/** The rectangular wave's M: the level halfway between its high and low levels (FIT-16). */
export const MIDLINE = 'Midline';
/**
 * The double logistic's M: the rest level the activity bout rises from (review FIT-2), not a
 * time-averaged MESOR. Its `mesor` key stays, like the rectangular wave's.
 */
export const BASELINE = 'Baseline';

/** Statistic labels shared by every node that emits the quantity. */
export const STAT_LABELS = Object.freeze({
	pvalue: 'p-value',
	perm_pvalue: 'Permutation p-value',
	r2: 'R²',
	rsquared: 'R²',
	rmse: 'RMSE',
	// The fixed-period cosinor's sqrt(SS/n), beside its `rmse` (the residual SE): the RMSE
	// every other fit reports under `rmse`.
	rmse_n: 'RMSE',
	n: 'n',
	ciLow: 'CI low',
	ciHigh: 'CI high',
	// Rhythm parameters (hours unless stated)
	period: 'Period (h)',
	mesor: 'Mesor',
	amplitude: 'Amplitude',
	rel_amplitude: 'Relative amplitude',
	acrophase: 'Acrophase (h)',
	bathyphase: 'Bathyphase (h)',
	phase_angle: 'Phase angle (h)',
	duty_cycle: 'Duty cycle',
	kappa: 'Kappa (κ)',
	onset: 'Onset (h)',
	offset: 'Offset (h)',
	k1: 'Rise rate k1 (1/h)',
	k2: 'Fall rate k2 (1/h)',
	slope: 'Slope',
	intercept: 'Intercept',
	a: 'Coefficient a',
	b: 'Coefficient b',
	// Nonparametric rest-activity
	IS: 'Interdaily stability (IS)',
	IV: 'Intradaily variability (IV)',
	RA: 'Relative amplitude (RA)',
	// M10 / L5 / their onsets are window-dependent: see statLabel.
	CFI: 'Circadian function index (CFI)',
	// Spectral / autocorrelation peaks
	peak_period: 'Peak period (h)',
	peak_power: 'Peak power',
	// The chi-squared peak's FAMILY-WISE p (peakFamilywiseP), on the plot and the nodes alike.
	peak_pvalue: 'Peak p (family-wise)',
	peak_frequency: 'Peak frequency (1/h)',
	peak_magnitude: 'Peak magnitude',
	peak_lag: 'Peak lag (h)',
	peak_correlation: 'Peak correlation (r)',
	// Spectral / autocorrelation curves (one array per input)
	power: 'Power',
	threshold: 'Significance threshold',
	frequency: 'Frequency (1/h)',
	magnitude: 'Magnitude',
	phase: 'Phase (rad)',
	lag: 'Lag (h)',
	correlation: 'Correlation (r)',
	// Windowed summaries
	mean: 'Mean',
	sd: 'SD'
});

// Phase outputs of the nodes with a "Phase reference" option (review FIT-9;
// utils/phaseReference.js). The default (hours after the first sample) keeps the plain
// "(h)"; clock time of day says so, because the same key then means a different hour 0.
const PHASE_STAT =
	/^(acrophase|bathyphase|onset|offset|M10onset|L5onset|H\d+_acrophase|C\d+_acrophase)$/;
const isClockRef = (args) => args?.phaseReference === 'clock';
const clockUnit = (label) => label.replace(/\(h\)$/, '(clock time, h)');

/** Label for a statistic name, also covering the numbered families (H1_…, C2_…, c0). */
export function statLabel(stat, args = {}) {
	const label = baseStatLabel(stat, args);
	return label && isClockRef(args) && PHASE_STAT.test(stat) ? clockUnit(label) : label;
}

function baseStatLabel(stat, args = {}) {
	if (typeof stat !== 'string') return null;
	if (stat === 'percentile') {
		const pct = Number(args?.summaryPercentile ?? 50);
		return `Percentile (P${Number.isFinite(pct) ? pct : 50})`;
	}
	// The keys stay M10 / L5 whatever the windows are; the labels follow the configured hours.
	const npcra = /^(M10|L5)(onset)?$/.exec(stat);
	if (npcra) {
		const isM = npcra[1] === 'M10';
		// NonparametricRA calls them mWindow / lWindow; Moving analysis npcraMWindow / npcraLWindow.
		const raw = Number(
			isM ? (args?.mWindow ?? args?.npcraMWindow) : (args?.lWindow ?? args?.npcraLWindow)
		);
		const h = Number.isFinite(raw) && raw > 0 ? raw : isM ? 10 : 5;
		const name = `${isM ? 'M' : 'L'}${h}`;
		if (npcra[2]) return `${name} onset (h)`;
		return `${name} (${isM ? 'most' : 'least'} active ${h} h mean)`;
	}
	// Moving analysis: the fixed-period cosinor's `rmse` is sqrt(SS/(n - p)), the residual
	// standard error, not the sqrt(SS/n) every other fit calls RMSE (FIT-15); the rectangular
	// wave's `mesor` is the midline halfway between its two levels, not a rhythm-adjusted mean
	// (FIT-16); the double logistic's `mesor` is its baseline (rest) level. The keys stay, so
	// saved wires and columns keep their meaning.
	if (stat === 'rmse' && args?.analysis === 'cosinor' && args?.useFixedPeriod) return RESIDUAL_SE;
	if (stat === 'mesor' && args?.analysis === 'rectfit') return MIDLINE;
	if (stat === 'mesor' && args?.analysis === 'doublelogistic') return BASELINE;
	if (Object.hasOwn(STAT_LABELS, stat)) return STAT_LABELS[stat];
	let m = /^H(\d+)_(amplitude|acrophase)$/.exec(stat);
	if (m) return `H${m[1]} ${m[2] === 'amplitude' ? 'amplitude' : 'acrophase (h)'}`;
	m = /^C(\d+)_(period|amplitude|phase|acrophase)$/.exec(stat);
	if (m) {
		// `C1_phase` is the model's phase angle φ in A·cos(ωt + φ), in radians; the time of
		// the peak is `C1_acrophase`.
		const what = {
			period: 'period (h)',
			amplitude: 'amplitude',
			phase: 'phase φ (rad)',
			acrophase: 'acrophase (h)'
		}[m[2]];
		return `C${m[1]} ${what}`;
	}
	m = /^c(\d+)$/.exec(stat);
	if (m) return `Coefficient c${m[1]}`;
	return null;
}

// ---------------------------------------------------------------------------------------------
// Per-node tables.
//
//   keys      { key: label | (ctx) => label }   exact output keys
//   perInput  [{ prefix, label, autoPrefixes? }] keys `${prefix}${inputColId}`, one column per
//             wired input: "label: <input name>". `autoPrefixes` are the name prefixes the node
//             gives such a column on creation (useMultiYTP's yColNamePrefix), which mark the
//             name as auto-generated.
//   perInputStat true: keys `${inputColId}_${stat}` (Rhythmicity, Moving window), labelled
//             "<stat label>: <input name>".
//   statPrefix  'stat_': keys `stat_<stat>` labelled with statLabel(stat).
//   special   [{ re, label(m, ctx), auto?(name, m, ctx) }] anything else with a key shape.
//
// ctx: { args, ownerId, colName(id), colType(id) } where colName resolves an input column id to
// the name a person reads (itself display-resolved), or null, and colType to the column's type
// ('time', 'number', ...), or null.
// ---------------------------------------------------------------------------------------------

const fit = (family) => () => `${family}: x`;

// Multi-harmonic fixed-period cosinor: amplitude / acrophase / bathyphase describe the
// overall fitted waveform, and the *_h1 ports carry harmonic 1 (review FIT-13).
const multiHarmonic = (ctx) =>
	(ctx?.args?.useFixedPeriod ?? false) && Number(ctx?.args?.nHarmonics ?? 1) > 1;
const fitMultiHarmonic = (ctx) =>
	(ctx?.args?.model ?? 'cosinor') === 'cosinor' &&
	(ctx?.args?.useFixedPeriod ?? true) &&
	Number(ctx?.args?.nHarmonics ?? 1) > 1;
/** "<name> (h)", or "(clock time, h)" when the node reports clock time of day. */
const phaseLabel = (name, ctx) => `${name} (${isClockRef(ctx?.args) ? 'clock time, h' : 'h'})`;

// The free-period fits (Cosinor, Fit waveform model) report periods and phases in the units
// of their x: hours for a time column, the column's own numbers otherwise. A number column
// carries no unit, so it reads "x units" (same rule as utils/periodUnits.js, which this
// import-free module cannot import). Unknown x (no colType in ctx, or nothing wired): hours.
const fitUnit = (ctx) => {
	const id = Number(ctx?.args?.xIN);
	if (!(id >= 0) || typeof ctx?.colType !== 'function') return 'h';
	const type = ctx.colType(id);
	return type && type !== 'time' ? 'x units' : 'h';
};
/** phaseLabel in the fit's x units; clock time (time x only) stays hours. */
const fitPhaseLabel = (name, ctx) =>
	isClockRef(ctx?.args) ? phaseLabel(name, ctx) : `${name} (${fitUnit(ctx)})`;

const RAYLEIGH_UNIT = { radians: 'rad', degrees: '°', hours: 'h' };
function rayleighAcrophase(ctx) {
	const timeIN = ctx?.args?.timeIN;
	// Time-wired (weighted) mode reads the angle off the clock: always hours.
	const timed = timeIN != null && timeIN !== -1 && Number(timeIN) >= 0;
	const unit = timed ? 'h' : (RAYLEIGH_UNIT[ctx?.args?.unit ?? 'radians'] ?? 'rad');
	return `Acrophase (${unit})`;
}

const GROUP_STAT = { ttest: 't', anova: 'F', mannwhitney: 'U', kruskal: 'H' };
const GROUP_EFFECT = {
	ttest: "Effect size (Cohen's d)",
	anova: 'Effect size (η²)',
	mannwhitney: 'Effect size (r)',
	kruskal: 'Effect size (ε²)'
};

const CHI_EFFECT = {
	independence: "Effect size (Cramér's V)",
	goodness: "Effect size (Cohen's w)",
	fisher: 'Odds ratio'
};

export const NODE_OUTPUT_LABELS = {
	AverageProfile: {
		keys: { avgprofx: (ctx) => phaseLabel('Profile time', ctx) },
		perInput: [
			{ prefix: 'avgprof_', label: 'Mean profile' },
			{ prefix: 'avgprofsem_', label: 'Profile SEM' }
		]
	},
	BinnedData: {
		keys: { binnedx: 'Binned: x' },
		perInput: [{ prefix: 'binnedy_', label: 'Binned', autoPrefixes: ['bin_'] }]
	},
	BlankColumn: { keys: { result: 'Values' } },
	ChiSquared: {
		keys: {
			statistic: (ctx) => (ctx?.args?.testType === 'fisher' ? 'Test statistic' : 'Chi-square (χ²)'),
			pvalue: 'p-value',
			df: 'Degrees of freedom (df)',
			effectSize: (ctx) => CHI_EFFECT[ctx?.args?.testType ?? 'independence'] ?? 'Effect size',
			ciLow: 'CI low',
			ciHigh: 'CI high'
		}
	},
	CircadianFunctionIndex: {
		keys: { CFI: STAT_LABELS.CFI, IS: STAT_LABELS.IS, IV: STAT_LABELS.IV, RA: STAT_LABELS.RA }
	},
	CollectColumns: {
		special: [
			{
				re: /^col_(\d+)$/,
				label: (m, ctx) => `Collected: ${ctx.colName(Number(m[1])) ?? m[1]}`,
				// Seeded as "<input name>_<node id>"; the input may have been renamed since.
				auto: (name, m, ctx) => name.endsWith(`_${ctx.ownerId}`)
			}
		]
	},
	ColumnFunctions: { keys: { result: 'Row-wise result' } },
	Correlation: {
		keys: {
			var_i: 'Variable 1',
			var_j: 'Variable 2',
			r: 'Correlation (r)',
			pvalue: 'p-value',
			padj: 'Holm-adjusted p-value',
			n: 'n',
			ciLow: 'CI low',
			ciHigh: 'CI high',
			significant: 'Significant (1 = yes, Holm-adjusted)'
		}
	},
	Cosinor: {
		keys: {
			cosinorx: fit('Cosinor fit'),
			period: (ctx) => `Period (${fitUnit(ctx)})`,
			amplitude: (ctx) => (multiHarmonic(ctx) ? 'Overall amplitude' : 'Amplitude'),
			acrophase: (ctx) =>
				fitPhaseLabel(multiHarmonic(ctx) ? 'Orthophase, overall peak' : 'Acrophase', ctx),
			bathyphase: (ctx) =>
				fitPhaseLabel(multiHarmonic(ctx) ? 'Bathyphase, overall trough' : 'Bathyphase', ctx),
			amplitude_h1: 'H1 amplitude',
			acrophase_h1: (ctx) => fitPhaseLabel('H1 acrophase', ctx),
			bathyphase_h1: (ctx) => fitPhaseLabel('H1 bathyphase', ctx),
			// The confidence intervals are harmonic 1's.
			amplitude_ciLow: (ctx) => `${multiHarmonic(ctx) ? 'H1 amplitude' : 'Amplitude'} CI low`,
			amplitude_ciHigh: (ctx) => `${multiHarmonic(ctx) ? 'H1 amplitude' : 'Amplitude'} CI high`,
			acrophase_ciLow: (ctx) =>
				fitPhaseLabel(`${multiHarmonic(ctx) ? 'H1 acrophase' : 'Acrophase'} CI low`, ctx),
			acrophase_ciHigh: (ctx) =>
				fitPhaseLabel(`${multiHarmonic(ctx) ? 'H1 acrophase' : 'Acrophase'} CI high`, ctx),
			// Acrophase minus the reference time, both in the fit's x units.
			phase_angle: (ctx) => `Phase angle (${fitUnit(ctx)})`,
			// sqrt(SS/(n - p)) in fixed-period mode, sqrt(SS/n) in free mode (FIT-15).
			rmse: (ctx) => (ctx?.args?.useFixedPeriod ? RESIDUAL_SE : STAT_LABELS.rmse)
		},
		perInput: [
			{ prefix: 'cosinory_', label: 'Cosinor fit', autoPrefixes: ['cosinor_'] },
			{ prefix: 'resid_', label: 'Residuals' }
		]
	},
	CrossCorrelation: {
		keys: { lag: 'Lag (samples)', correlation: 'Correlation (r)', pvalue: 'p-value' }
	},
	Crossing: {
		keys: { breach: 'Rule met (1 = yes)', crossing: 'Crossing at', count: 'Crossing count' }
	},
	DescribeData: {
		keys: {
			variable: 'Variable',
			n: 'n',
			mean: 'Mean',
			median: 'Median',
			sd: 'SD',
			min: 'Minimum',
			max: 'Maximum',
			range: 'Range',
			q1: 'Q1 (25th percentile)',
			q3: 'Q3 (75th percentile)',
			iqr: 'IQR',
			skewness: 'Skewness',
			kurtosis: 'Kurtosis'
		}
	},
	DoubleLogistic: {
		keys: { dlogx: fit('Double logistic fit') },
		perInput: [
			{ prefix: 'dlogy_', label: 'Double logistic fit', autoPrefixes: ['dlog_'] },
			{ prefix: 'resid_', label: 'Residuals' }
		]
	},
	FDRCorrection: { keys: { padj: 'Adjusted p-value', reject: 'Rejected (1 = yes)' } },
	FitFunction: {
		keys: {
			fitx: fit('Fit'),
			period: (ctx) => `Period (${fitUnit(ctx)})`,
			amplitude: (ctx) => (fitMultiHarmonic(ctx) ? 'Overall amplitude' : 'Amplitude'),
			acrophase: (ctx) =>
				fitPhaseLabel(fitMultiHarmonic(ctx) ? 'Orthophase, overall peak' : 'Acrophase', ctx),
			amplitude_h1: 'H1 amplitude',
			acrophase_h1: (ctx) => fitPhaseLabel('H1 acrophase', ctx),
			onset: (ctx) => fitPhaseLabel('Onset', ctx),
			offset: (ctx) => fitPhaseLabel('Offset', ctx),
			// Double-logistic rates, per unit of x.
			// The rectangular wave's M is a midline (FIT-16) and the double logistic's a baseline
			// (rest level); the fixed-period cosinor's `rmse` is the residual SE (FIT-15). Fixed
			// period is this node's default.
			mesor: (ctx) =>
				ctx?.args?.model === 'rectangular'
					? MIDLINE
					: ctx?.args?.model === 'doublelogistic'
						? BASELINE
						: STAT_LABELS.mesor,
			rmse: (ctx) =>
				(ctx?.args?.model ?? 'cosinor') === 'cosinor' && (ctx?.args?.useFixedPeriod ?? true)
					? RESIDUAL_SE
					: STAT_LABELS.rmse,
			rmse_n: STAT_LABELS.rmse_n,
			k1: (ctx) => `Rise rate k1 (1/${fitUnit(ctx) === 'h' ? 'h' : 'x unit'})`,
			k2: (ctx) => `Fall rate k2 (1/${fitUnit(ctx) === 'h' ? 'h' : 'x unit'})`
		},
		perInput: [
			{ prefix: 'fity_', label: 'Fit', autoPrefixes: ['fit_'] },
			{ prefix: 'resid_', label: 'Residuals' },
			{ prefix: 'permstats_', label: 'Permutation statistics' }
		]
	},
	FormulaColumn: { keys: { result: 'Formula result' } },
	GroupComparison: {
		keys: {
			statistic: (ctx) => {
				const s = GROUP_STAT[ctx?.args?.method];
				return s ? `Test statistic (${s})` : 'Test statistic';
			},
			pvalue: 'p-value',
			effectSize: (ctx) => GROUP_EFFECT[ctx?.args?.method] ?? 'Effect size'
		}
	},
	Interpolate: {
		keys: { interpx: 'Interpolated: x' },
		perInput: [{ prefix: 'interpy_', label: 'Interpolated', autoPrefixes: ['interp_'] }]
	},
	// Join Data names a value column after its input (the A column's name for a pair), with
	// "(A)" / "(B)" and a number only where two would read the same (utils/joinPairing.js).
	// The pairs are the ones the node baked (`_resolvedPairs`), so the label always describes
	// the data the column holds.
	JoinData: {
		keys: { jointime: 'Time', source: 'Source' },
		special: [
			{
				re: /^joined_(\d+)$/,
				label: (m, ctx) => {
					const nameOf = (id) => ctx?.colName?.(id) ?? String(id);
					const hit = joinPlan(ctx?.args ?? {}, nameOf, { useBaked: true }).outputs.find(
						(o) => o.key === m[0]
					);
					return hit?.label ?? nameOf(Number(m[1]));
				}
			}
		]
	},
	LogisticRegression: {
		keys: {
			term: 'Term',
			coef: 'Coefficient',
			se: 'Standard error',
			z: 'Wald z',
			pvalue: 'p-value',
			oddsRatio: 'Odds ratio',
			ciLow: 'CI low',
			ciHigh: 'CI high',
			outcome: 'Outcome',
			eta: 'Linear predictor (η)',
			fitted: 'Fitted probability'
		}
	},
	LongToWide: {
		keys: { time: 'Time' },
		special: [{ re: /^value_(.*)$/s, label: (m) => `Value: ${m[1] === '' ? '(blank)' : m[1]}` }]
	},
	MovingAnalysis: { keys: { movex: 'Window time' }, perInputStat: true },
	NonparametricRA: {
		keys: { npcrax: (ctx) => phaseLabel('Average day: time', ctx) },
		perInput: [{ prefix: 'npcray_', label: 'Average day', autoPrefixes: ['npcra_'] }]
	},
	NormalityTest: {
		keys: {
			variable: 'Variable',
			statistic: 'Test statistic',
			pvalue: 'p-value',
			n: 'n',
			normal: 'Normal (1 = yes)'
		}
	},
	Random: { keys: { result: 'Random values' } },
	RayleighTest: {
		keys: {
			R: 'Mean vector length (R)',
			z: 'Rayleigh z',
			pvalue: 'Rayleigh p-value',
			F: 'Watson-Williams F',
			ww_pvalue: 'Watson-Williams p-value',
			acrophase: rayleighAcrophase
		}
	},
	RectangularWave: {
		keys: { rectwavex: fit('Rectangular wave fit') },
		perInput: [
			{ prefix: 'rectwavey_', label: 'Rectangular wave fit', autoPrefixes: ['rectwave_'] },
			{ prefix: 'resid_', label: 'Residuals' }
		]
	},
	RhythmicityAnalysis: {
		keys: {
			rhythmicityx: (ctx) => {
				const a = ctx?.args?.analysis;
				return a === 'correlogram' ? 'Lag (h)' : 'Period (h)';
			}
		},
		perInput: [
			{
				prefix: 'rhythmicityy_',
				label: (ctx) =>
					({ periodogram: 'Power', fft: 'Magnitude', correlogram: 'Correlation (r)' })[
						ctx?.args?.analysis
					] ?? 'Result'
			}
		],
		perInputStat: true,
		statPrefix: 'stat_'
	},
	SequenceColumn: { keys: { result: 'Sequence' } },
	SimulatedData: { keys: { time: 'Time', values: 'Values' } },
	SmoothedData: {
		keys: { smoothedx: 'Smoothed: x' },
		perInput: [
			{ prefix: 'smoothedy_', label: 'Smoothed', autoPrefixes: ['smooth_'] },
			{ prefix: 'resid_', label: 'Residuals' }
		]
	},
	// Sort names its column "<input> sorted" (SORT_SUFFIX).
	Sort: { perInput: [{ prefix: 'sortedy_', label: 'Sorted' }] },
	Split: {
		special: [
			{
				re: /^(\d+)_(\d+)$/,
				label: (m, ctx) => `Segment ${m[2]}: ${ctx.colName(Number(m[1])) ?? m[1]}`,
				auto: (name, m) => name.endsWith(`_split${m[2]}`)
			}
		]
	},
	StoredValueGroup: {
		keys: { category: 'Category', value: 'Value' },
		special: [
			{
				re: /^group_(.+)$/,
				label: (m, ctx) => {
					const g = (ctx?.args?.groups ?? []).find((x) => String(x?.id) === m[1]);
					return g?.name ? String(g.name) : 'Group';
				},
				auto: (name, m, ctx) => {
					const g = (ctx?.args?.groups ?? []).find((x) => String(x?.id) === m[1]);
					return name === `${g?.name || 'group'}_${ctx.ownerId}`;
				}
			}
		]
	},
	SurrogateTest: { keys: { pvalue: 'Surrogate p-value', observed: 'Observed statistic' } },
	Threshold: { keys: { binary: 'Above threshold (1 = yes)' } },
	TrendFit: {
		keys: { trendx: 'Trend: x' },
		perInput: [
			{ prefix: 'trendy_', label: 'Trend', autoPrefixes: ['trend_'] },
			{ prefix: 'resid_', label: 'Residuals' },
			{ prefix: 'permstats_', label: 'Permutation statistics' }
		],
		special: [
			{
				re: /^coef_(.+)$/,
				label: (m) => statLabel(m[1]) ?? `Coefficient ${m[1]}`
			}
		]
	},
	WideToLong: { keys: { time: 'Time', category: 'Category', value: 'Value' } }
};

// Sort's auto-name shape for its per-input outputs.
const SORT_SUFFIX = ' sorted';

/**
 * Plot metric output labels (Periodogram / FFT / Correlogram / Q-Q). The actogram's per-rule
 * outputs are labelled by its own def (plotMetricDefs.js `labelFor`), which the runtime
 * resolver prefers whenever it returns something other than the raw key.
 */
export const PLOT_OUTPUT_LABELS = {
	periodogram: {
		peak_period: STAT_LABELS.peak_period,
		peak_power: STAT_LABELS.peak_power,
		peak_pvalue: STAT_LABELS.peak_pvalue
	},
	fft: {
		peak_period: STAT_LABELS.peak_period,
		peak_frequency: STAT_LABELS.peak_frequency,
		peak_magnitude: STAT_LABELS.peak_magnitude
	},
	correlogram: {
		peak_lag: STAT_LABELS.peak_lag,
		peak_correlation: STAT_LABELS.peak_correlation
	},
	qqplot: { qq_r: 'Q-Q correlation (r)', qq_n: 'n' }
};

// ---------------------------------------------------------------------------------------------
// Resolution.
// ---------------------------------------------------------------------------------------------

const call = (v, ctx) => (typeof v === 'function' ? v(ctx) : v);
const inputName = (ctx, id) => ctx?.colName?.(id) ?? String(id);

/**
 * Match `key` against a node's table. Returns { label, auto(name) } or null when the node or
 * key is not covered (callers then keep the column's own name, so nothing regresses).
 */
function matchOutput(nodeType, key, ctx) {
	const spec = NODE_OUTPUT_LABELS[nodeType];
	if (!spec || typeof key !== 'string') return null;
	const ownerId = ctx?.ownerId;
	// The shapes a constructor / sync helper gives an output column on creation.
	const seeded = (name) =>
		name === key ||
		name === `${key}_${ownerId}` ||
		(key.startsWith('stat_') && name === `${key.slice(5)}_${ownerId}`);

	if (spec.keys && Object.hasOwn(spec.keys, key)) {
		return { label: call(spec.keys[key], ctx), auto: seeded };
	}
	for (const pi of spec.perInput ?? []) {
		if (!key.startsWith(pi.prefix)) continue;
		const rest = key.slice(pi.prefix.length);
		if (!/^\d+$/.test(rest)) continue;
		const id = Number(rest);
		const prefixes = [pi.prefix, ...(pi.autoPrefixes ?? [])];
		return {
			label: `${call(pi.label, ctx)}: ${inputName(ctx, id)}`,
			auto: (name) =>
				seeded(name) ||
				prefixes.some((p) => name.startsWith(p)) ||
				(nodeType === 'Sort' && name.endsWith(SORT_SUFFIX))
		};
	}
	if (spec.statPrefix && key.startsWith(spec.statPrefix)) {
		const label = statLabel(key.slice(spec.statPrefix.length), ctx?.args);
		if (label) return { label, auto: seeded };
	}
	if (spec.perInputStat) {
		const m = /^(\d+)_(.+)$/.exec(key);
		if (m) {
			const label = statLabel(m[2], ctx?.args);
			if (label) {
				return {
					label: `${label}: ${inputName(ctx, Number(m[1]))}`,
					auto: (name) => seeded(name) || name.endsWith(`_${m[2]}`)
				};
			}
		}
	}
	for (const sp of spec.special ?? []) {
		const m = sp.re.exec(key);
		if (!m) continue;
		return {
			label: sp.label(m, ctx),
			auto: (name) => seeded(name) || (sp.auto ? !!sp.auto(name, m, ctx) : false)
		};
	}
	// Shared statistics (r2, rmse, pvalue, period, …) on any covered node.
	const common = statLabel(key, ctx?.args);
	if (common) return { label: common, auto: seeded };
	return null;
}

/**
 * The display label for output `key` of a table-process of type `nodeType`, or null when the
 * pair is not covered.
 * @param {string} nodeType  the TableProcess name (registry key), e.g. 'Cosinor'
 * @param {string} key       the `args.out` key, e.g. 'cosinory_66'
 * @param {{args?:object, ownerId?:number|string, colName?:(id:number)=>string|null, colType?:(id:number)=>string|null}} [ctx]
 */
export function outputLabel(nodeType, key, ctx = {}) {
	return matchOutput(nodeType, key, ctx)?.label ?? null;
}

/**
 * True when `name` is still the auto-generated name of output `key`, so the display label may
 * stand in for it. A name a person typed is never auto: the user's rename wins.
 */
export function isAutoOutputName(nodeType, key, name, ctx = {}) {
	if (typeof name !== 'string') return false;
	const m = matchOutput(nodeType, key, ctx);
	return m ? m.auto(name) : false;
}

/** Display label for a plot metric key ('peak_period' on a periodogram), or null. */
export function plotOutputLabel(plotType, key) {
	const t = PLOT_OUTPUT_LABELS[plotType];
	return t && Object.hasOwn(t, key) ? t[key] : null;
}

/**
 * The name a column should SHOW: its own name if a person chose it, else the derived label.
 * @param {string} name          the column's current name
 * @param {string|null} label    the derived label (null = not covered)
 * @param {boolean} isAuto       whether `name` is the auto-generated one
 */
export function preferLabel(name, label, isAuto) {
	if (!label) return name;
	return isAuto ? label : name;
}

// ---------------------------------------------------------------------------------------------
// Column namer: which node output is this column, and what should it show?
//
//   - a name someone chose (renamed on the canvas, in the Data panel, in a table header, or
//     written by a demo generator) always wins, shown exactly as typed;
//   - an auto-generated name (`cosinory_66_5`, `rsquared_5`, `resid_A1`) is replaced by the
//     node's label ("Cosinor fit: A1", "R²", "Residuals: A1");
//   - anything not covered keeps its own name, so an unlabelled node never regresses.
//
// DISPLAY ONLY: Column.name, the out keys, the column ids and the saved session are untouched.
// ---------------------------------------------------------------------------------------------

// Input names are themselves display-resolved ("Residuals: Binned: A1"); cap the chain so a
// malformed (cyclic) graph cannot recurse forever.
const MAX_NAME_DEPTH = 4;

/**
 * Map colId -> { kind: 'tableprocess' | 'plot', owner, key } for every node output column.
 * @param {{tableProcesses?:any[], plots?:any[]}} state  the core (or a core-shaped object)
 */
export function buildColumnOwnerIndex(state) {
	const index = new Map();
	for (const tp of state?.tableProcesses ?? []) {
		for (const [key, colId] of Object.entries(tp?.args?.out ?? {})) {
			if (typeof colId !== 'number' || colId < 0 || index.has(colId)) continue;
			index.set(colId, { kind: 'tableprocess', owner: tp, key });
		}
	}
	for (const plot of state?.plots ?? []) {
		for (const [key, colId] of Object.entries(plot?.metricOut ?? {})) {
			if (typeof colId !== 'number' || colId < 0 || index.has(colId)) continue;
			index.set(colId, { kind: 'plot', owner: plot, key });
		}
	}
	return index;
}

/**
 * Label + auto-name verdict for a plot metric output. The actogram's def labels its rule ports
 * itself (`Onsets τ (h)`), so a def label that differs from the raw key is preferred.
 */
function plotMetricDisplay(plot, key, name) {
	const defLabel = plotMetricLabel(plot, key);
	const label = defLabel && defLabel !== key ? defLabel : plotOutputLabel(plot?.type, key);
	if (!label) return null;
	const auto =
		name === key || name === plotMetricColumnName(plot, key) || name === `${key}_${plot?.id}`;
	return { label, auto };
}

/**
 * A resolver `(col) => displayName` over one snapshot of the session's node outputs. Build one
 * per render of a list (it indexes every output once); reading `state` inside a $derived keeps
 * the result reactive.
 * @param {{data?:any[], tableProcesses?:any[], plots?:any[]}} state
 */
export function createColumnNamer(state) {
	const index = buildColumnOwnerIndex(state);
	const byId = (id) => (state?.data ?? []).find((c) => c.id === id) ?? null;

	const outputCtx = (tp, depth) => ({
		args: tp?.args ?? {},
		ownerId: tp?.id,
		colName: (id) => {
			const c = byId(id);
			return c ? resolve(c, depth + 1) : null;
		},
		colType: (id) => byId(id)?.type ?? null
	});

	function resolve(col, depth = 0) {
		const name = col?.name ?? '';
		if (!col || depth > MAX_NAME_DEPTH) return name;
		const hit = index.get(col.id);
		if (!hit) return name;
		if (hit.kind === 'plot') {
			const r = plotMetricDisplay(hit.owner, hit.key, name);
			return r ? preferLabel(name, r.label, r.auto) : name;
		}
		const ctx = outputCtx(hit.owner, depth);
		const m = matchOutput(hit.owner?.name, hit.key, ctx);
		return m ? preferLabel(name, m.label, m.auto(name)) : name;
	}

	const namer = (col) => resolve(col, 0);
	/** The label for a table-process output key, regardless of any column's current name. */
	namer.outputLabel = (tp, key) => outputLabel(tp?.name, key, outputCtx(tp, 0));
	/**
	 * When `text` is this column's display label (independent of its current name), the seeded
	 * auto name to store instead, else null. Rename handlers use it so that typing the label back
	 * (Escape after an edit, or committing it unchanged) does not freeze the label as a typed
	 * name: the label then keeps following its inputs.
	 */
	namer.autoNameFor = (col, text) => {
		const hit = col ? index.get(col.id) : null;
		if (!hit || typeof text !== 'string') return null;
		const t = text.trim();
		if (hit.kind === 'plot') {
			const r = plotMetricDisplay(hit.owner, hit.key, '');
			return r && r.label === t ? plotMetricColumnName(hit.owner, hit.key) : null;
		}
		const label = outputLabel(hit.owner?.name, hit.key, outputCtx(hit.owner, 0));
		return label && label === t ? `${hit.key}_${hit.owner?.id}` : null;
	};
	namer.byId = (id) => {
		const c = byId(id);
		return c ? resolve(c, 0) : '';
	};
	return namer;
}
