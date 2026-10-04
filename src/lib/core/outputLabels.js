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
// Pure data and pure functions whose only import is the (equally import-free) plot metric defs,
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

// ---------------------------------------------------------------------------------------------
// Shared vocabulary. One string per quantity, so the same quantity reads the same everywhere.
// ---------------------------------------------------------------------------------------------

/** Statistic labels shared by every node that emits the quantity. */
export const STAT_LABELS = Object.freeze({
	pvalue: 'p-value',
	perm_pvalue: 'Permutation p-value',
	r2: 'R²',
	rsquared: 'R²',
	rmse: 'RMSE',
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
	peak_pvalue: 'Peak p-value',
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

/** Label for a statistic name, also covering the numbered families (H1_…, C2_…, c0). */
export function statLabel(stat, args = {}) {
	if (typeof stat !== 'string') return null;
	if (stat === 'percentile') {
		const pct = Number(args?.summaryPercentile ?? 50);
		return `Percentile (P${Number.isFinite(pct) ? pct : 50})`;
	}
	// The keys stay M10 / L5 whatever the windows are; the labels follow the configured hours.
	const npcra = /^(M10|L5)(onset)?$/.exec(stat);
	if (npcra) {
		const isM = npcra[1] === 'M10';
		const raw = Number(isM ? args?.mWindow : args?.lWindow);
		const h = Number.isFinite(raw) && raw > 0 ? raw : isM ? 10 : 5;
		const name = `${isM ? 'M' : 'L'}${h}`;
		if (npcra[2]) return `${name} onset (h)`;
		return `${name} (${isM ? 'most' : 'least'} active ${h} h mean)`;
	}
	if (Object.hasOwn(STAT_LABELS, stat)) return STAT_LABELS[stat];
	let m = /^H(\d+)_(amplitude|acrophase)$/.exec(stat);
	if (m) return `H${m[1]} ${m[2] === 'amplitude' ? 'amplitude' : 'acrophase (h)'}`;
	m = /^C(\d+)_(period|amplitude|phase)$/.exec(stat);
	if (m) {
		const what = { period: 'period (h)', amplitude: 'amplitude', phase: 'acrophase (h)' }[m[2]];
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
// ctx: { args, ownerId, colName(id) } where colName resolves an input column id to the name a
// person reads (itself display-resolved), or null.
// ---------------------------------------------------------------------------------------------

const fit = (family) => () => `${family}: x`;

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
		keys: { avgprofx: 'Profile time (h)' },
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
			n: 'n',
			ciLow: 'CI low',
			ciHigh: 'CI high',
			significant: 'Significant (1 = yes)'
		}
	},
	Cosinor: {
		keys: {
			cosinorx: fit('Cosinor fit'),
			amplitude_ciLow: 'Amplitude CI low',
			amplitude_ciHigh: 'Amplitude CI high',
			acrophase_ciLow: 'Acrophase CI low (h)',
			acrophase_ciHigh: 'Acrophase CI high (h)'
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
		keys: { fitx: fit('Fit') },
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
		keys: { npcrax: 'Average day: time (h)' },
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
 * @param {{args?:object, ownerId?:number|string, colName?:(id:number)=>string|null}} [ctx]
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
		}
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
