// @ts-nocheck
// The DEFINITIONS of the plots' metric output ports (Periodogram, FFT, Correlogram, Q-Q,
// Actogram): which keys a plot carries, what each port is called, what each column is named,
// what the manifest says, and how a series' values are read. Pure data and duck-typed reads,
// with NO imports, so the workflow graph (ProcessNode.svelte.js, which core.svelte.js
// imports), the node manifest and the MCP schema generator can all use it without an import
// cycle. The runtime half (column sync, writes, the component hook) is
// plotMetricOutputs.svelte.js, which re-exports everything here.

// ---------------------------------------------------------------------------
// Actogram marker rules (plan docs/plans/2026-09-30-actogram-marker-rules-and-outputs.md,
// Phase B). Five keys per rule, keyed on the rule's persisted ID, never its name, so a
// rename relabels the ports and renames the columns without re-minting either (a key that
// left `plotMetricKeys` would have its column deleted by syncPlotMetricColumns, and a new
// key gets a fresh column id, which would strand every downstream wire).
// ---------------------------------------------------------------------------

/** The per-rule output suffixes, in port order. */
export const RULE_OUTPUT_SUFFIXES = Object.freeze(['tau', 'phi', 'r2', 'rmse', 'n']);
const RULE_KEY = /^(r\d+)_(tau|phi|r2|rmse|n)$/;

/** `{ ruleId, stat }` for an actogram rule output key ('r3_phi'), or null. */
export function parseRuleOutputKey(key) {
	const m = typeof key === 'string' ? RULE_KEY.exec(key) : null;
	return m ? { ruleId: m[1], stat: m[2] } : null;
}

// What a user reads on the port. Units are hours for tau, phi and RMSE. The rule summary
// table (MarkerRuleBlock.svelte) labels its cells with these same strings.
export const RULE_STAT_LABEL = Object.freeze({
	tau: 'τ (h)',
	phi: 'φ (h)',
	r2: 'R²',
	rmse: 'RMSE (h)',
	n: 'n'
});

/**
 * The five values one block (a rule instance, or the own block a series detached from the
 * rule, which carries `fromRule`) contributes to its rule's columns. Reads what the block
 * already computes to draw its line; the harmonic check is its own cached $derived
 * (Decision 2b), recomputed only when the fitted slope's value or the series data change.
 *
 *   tau   the harmonic-check pick, `harmonicCheck.strongest.peakPeriod`; the UI's "τ (h)" readouts show
 *         this value with the line's slope beside it (tauReadout in markerRules.svelte.js)
 *   phi   `estimatedPhase.phase`: hours after the row start at the reference day
 *   r2    R² of the line as drawn against the fitted markers
 *   rmse  RMSE of the same, in hours
 *   n     markers that entered the fit (`fitPoints.xs.length`)
 *
 * No valid line (no markers and nothing fixed, one marker with both parameters free, no
 * data): tau, phi, r2 and rmse are NaN, the `?? NaN` rule of every other def. r2 and rmse
 * are also NaN when the line has no markers to be compared with (a fixed line on a
 * line-only rule). n is always the count, 0 included, as the Q-Q plot's `qq_n` is reported
 * whether or not its r is defined. A series with no block for the rule: all five NaN.
 */
export function ruleOutputValues(block) {
	if (!block) return { tau: NaN, phi: NaN, r2: NaN, rmse: NaN, n: NaN };
	const reg = block.linearRegression;
	const ok = reg != null && typeof reg === 'object';
	const n = block.fitPoints?.xs?.length;
	return {
		tau: ok ? (block.harmonicCheck?.strongest?.peakPeriod ?? NaN) : NaN,
		phi: ok ? (block.estimatedPhase?.phase ?? NaN) : NaN,
		r2: ok ? (reg.rSquared ?? NaN) : NaN,
		rmse: ok ? (reg.rmse ?? NaN) : NaN,
		n: Number.isFinite(n) ? n : NaN
	};
}

/** The block that fills rule `ruleId`'s cells for one series: its instance, else a detached copy. */
function ruleBlockFor(datum, ruleId) {
	return (
		datum?.ruleInstances?.find((i) => i.ruleId === ruleId) ??
		datum?.phaseMarkers?.find((m) => m.fromRule === ruleId) ??
		null
	);
}

const ruleOf = (inner, ruleId) => (inner?.markerRules ?? []).find((r) => r.id === ruleId) ?? null;

/**
 * Per-plot-type metric definitions. `statsFor(datum)` reads the same deriveds
 * the plot's stats panel shows (visiblePeak preferred, matching the display
 * and the legacy StoreValueButton getters).
 *
 * A def has EITHER static `keys` OR `keysFor(inner)`, for a type whose outputs follow its
 * state (the actogram: five per marker rule). Always read the key list through
 * `plotMetricKeys(plot)`. Optional hooks, each with a default:
 *   labelFor(inner, key)              the port's display text (default: the key)
 *   columnNameFor(inner, key, plotId) the column's name (default: `${key}_${plotId}`)
 *   manifest                          nodes.json / MCP output entries for a dynamic def
 *                                     (default: one entry per static key)
 */
export const PLOT_METRIC_DEFS = {
	periodogram: {
		keys: ['peak_period', 'peak_power', 'peak_pvalue'],
		// The key stays `peak_pvalue` so existing wires and columns survive; the port reads
		// as what it now carries.
		labelFor(_inner, key) {
			return key === 'peak_pvalue' ? 'Peak p (family-wise)' : key;
		},
		statsFor(datum) {
			const p = datum?.visiblePeak ?? datum?.peak;
			// peak_pvalue is the chi-squared significance of the peak, FAMILY-WISE over the
			// folds the threshold line uses (Periodogram.svelte peakFamilywiseP), so it is below
			// alpha exactly when the peak crosses the drawn line. Until SPEC-6 it was the
			// uncorrected per-period p at the maximum. NaN for Lomb-Scargle/Enright (no
			// analytic p). This supersedes the standalone Free-Running Period node, which was
			// a thin chi-squared periodogram wrapper.
			return {
				peak_period: p?.period ?? NaN,
				peak_power: p?.power ?? NaN,
				peak_pvalue: p?.pvalue ?? NaN
			};
		}
	},
	fft: {
		keys: ['peak_period', 'peak_frequency', 'peak_magnitude'],
		statsFor(datum) {
			const p = datum?.visiblePeak ?? datum?.peak;
			return {
				peak_period: p?.period ?? NaN,
				peak_frequency: p?.frequency ?? NaN,
				peak_magnitude: p?.magnitude ?? NaN
			};
		}
	},
	correlogram: {
		keys: ['peak_lag', 'peak_correlation'],
		statsFor(datum) {
			const p = datum?.visiblePeak ?? datum?.peak;
			return { peak_lag: p?.lag ?? NaN, peak_correlation: p?.correlation ?? NaN };
		}
	},
	qqplot: {
		keys: ['qq_r', 'qq_n'],
		statsFor(datum) {
			// datum.qq is the series' full Q-Q computation (utils/qq.js): r is the
			// probability-plot correlation on the plotted Blom-position pairs, n the
			// valid-value count. r is null when undefined (constant data / n < 3) —
			// NaN in the column, like the other defs' missing stats. Deliberately NO
			// p-value output: the Q-Q plot is descriptive, the NormalityTest node
			// owns W/p (and the sample-size policy guard watches pvalue outputs).
			const q = datum?.qq;
			return { qq_r: q?.r ?? NaN, qq_n: q?.n ?? NaN };
		}
	},
	actogram: {
		keysFor(inner) {
			return (inner?.markerRules ?? []).flatMap((r) =>
				RULE_OUTPUT_SUFFIXES.map((s) => `${r.id}_${s}`)
			);
		},
		labelFor(inner, key) {
			const k = parseRuleOutputKey(key);
			const rule = k && ruleOf(inner, k.ruleId);
			return rule ? `${rule.name} ${RULE_STAT_LABEL[k.stat]}` : key;
		},
		columnNameFor(inner, key, plotId) {
			const k = parseRuleOutputKey(key);
			const rule = k && ruleOf(inner, k.ruleId);
			if (!rule) return `${key}_${plotId}`;
			// Spaces become '_', as column names elsewhere ('Onsets_tau_0').
			return `${String(rule.name).trim().replace(/\s+/g, '_')}_${k.stat}_${plotId}`;
		},
		statsFor(datum) {
			const out = {};
			for (const r of datum?.parentPlot?.markerRules ?? []) {
				const v = ruleOutputValues(ruleBlockFor(datum, r.id));
				for (const s of RULE_OUTPUT_SUFFIXES) out[`${r.id}_${s}`] = v[s];
			}
			return out;
		},
		// One entry per suffix, standing for "one column per marker rule".
		manifest: RULE_OUTPUT_SUFFIXES.map((s) => ({
			name: `r*_${s}`,
			kind: 'column',
			cardinality: 'many',
			metric: true,
			dynamicSuffix: `_${s}`,
			per: 'marker rule'
		}))
	}
};

/**
 * The metric output keys a plot carries now: a static def's `keys`, or a dynamic def's
 * `keysFor(plot.plot)`. The ONE place a key list is read (column sync, writes, node ports).
 */
export function plotMetricKeys(plot) {
	const def = PLOT_METRIC_DEFS[plot?.type];
	if (!def) return [];
	return typeof def.keysFor === 'function' ? def.keysFor(plot.plot) : def.keys;
}

/** The node port's display text for one metric key (e.g. 'Onsets τ (h)'). */
export function plotMetricLabel(plot, key) {
	const def = PLOT_METRIC_DEFS[plot?.type];
	return typeof def?.labelFor === 'function' ? def.labelFor(plot.plot, key) : key;
}

/** The output column's name for one metric key. */
export function plotMetricColumnName(plot, key) {
	const def = PLOT_METRIC_DEFS[plot?.type];
	return typeof def?.columnNameFor === 'function'
		? def.columnNameFor(plot.plot, key, plot.id)
		: `${key}_${plot.id}`;
}

/**
 * The outputs a plot type declares, in the nodes.json port shape (shared by the node
 * manifest and the MCP schema so the two cannot disagree). Static keys are one column each;
 * a dynamic def lists its pattern entries.
 */
export function plotMetricManifestOutputs(type) {
	const def = PLOT_METRIC_DEFS[type];
	if (!def) return [];
	if (Array.isArray(def.manifest)) return def.manifest.map((o) => ({ ...o }));
	return (def.keys ?? []).map((name) => ({
		name,
		kind: 'column',
		cardinality: 'one',
		metric: true
	}));
}
