/**
 * Which parameter VALUES the parity fixtures actually exercise.
 *
 * A parity fixture proves an analysis agrees across languages **on the inputs that
 * fixture happens to use**, which is not the same as the analysis being right.
 *
 * That distinction cost real correctness. Cosinor had two fixtures and BOTH pinned
 * `useFixedPeriod: true` — the linear least-squares path, which cannot really go
 * wrong. The FREE-period path, the only analysis in the engine that needs a
 * nonlinear optimiser, had never been checked in any language. When a fixture was
 * finally written for it the Python port turned out to be badly broken: amplitude
 * 3.3 against a true 38, R² 0.09, on a clean 23.7 h rhythm JS recovered correctly.
 *
 * Nothing pointed at that hole beforehand. This module is the thing that would
 * have: for every analysis, which values of its enumerable parameters appear in
 * ANY fixture, and which never do.
 *
 * Scope is deliberately the ENUMERABLE parameters — booleans and select options.
 * Those are branches: each value is a different code path. Continuous parameters
 * (alpha, nPermutations, a period in hours) are not branches and listing them
 * would bury the signal.
 *
 * A parameter ABSENT from a fixture's args still exercises that parameter's
 * DEFAULT, because the runtime falls back to it. Counting absence as "nothing
 * covered" would report every default as a gap and make the report useless.
 */

/**
 * Enum options for a select, keyed by the arg it binds.
 *
 * `options` may be an inline literal (`options={['a','b']}`) or an imported
 * constant (`options={PADJUST_METHODS}`); the constant form must be FOLLOWED, not
 * skipped. That exact hole is why FDRCorrection and SurrogateTest shipped with no
 * MCP param notes — a guard that ignores what it cannot read reports good coverage
 * precisely where it has none.
 *
 * @param resolveIdent (name) => string[]|null, to look up an imported constant
 */
export function selectOptions(source, resolveIdent) {
	const out = {};
	for (const el of source.matchAll(/<AttributeSelect\b[\s\S]*?\/>/g)) {
		const block = el[0];
		const bind = /bind:value=\{([^}]*)\}/.exec(block);
		const param = bind && /\bargs\.([A-Za-z0-9_]+)/.exec(bind[1])?.[1];
		if (!param) continue;
		const literal = /options=\{?\[([^\]]*)\]/.exec(block);
		if (literal) {
			out[param] = [...literal[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
			continue;
		}
		const ident = /options=\{([A-Za-z0-9_$]+)\}/.exec(block);
		if (!ident) continue;
		const resolved = resolveIdent?.(ident[1], source) ?? null;
		out[param] = resolved?.length ? resolved : { unresolved: ident[1] };
	}
	return out;
}

/** Resolve `export const NAME = ['a','b']` from a $lib module imported by `source`. */
export function makeIdentResolver(readLibFile) {
	return (ident, source) => {
		const im = new RegExp(
			`import\\s*\\{[^}]*\\b${ident}\\b[^}]*\\}\\s*from\\s*['"]([^'"]+)['"]`
		).exec(source);
		if (!im || !im[1].startsWith('$lib/')) return null;
		const mod = readLibFile(im[1].slice('$lib/'.length));
		if (!mod) return null;
		const cm = new RegExp(`export\\s+const\\s+${ident}\\s*=\\s*\\[([^\\]]*)\\]`).exec(mod);
		return cm ? [...cm[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]) : null;
	};
}

/**
 * Values each analysis's fixtures actually pass.
 * @returns {Map<string, Map<string, Set<any>>>} jsName -> param -> values seen
 */
export function valuesUsedByFixtures(fixtures) {
	const used = new Map();
	for (const fx of fixtures) {
		const name = fx.jsName;
		if (!name) continue;
		if (!used.has(name)) used.set(name, new Map());
		const perParam = used.get(name);
		for (const [k, v] of Object.entries(fx.args ?? {})) {
			if (v === null || typeof v === 'object') continue;
			if (!perParam.has(k)) perParam.set(k, new Set());
			perParam.get(k).add(v);
		}
	}
	return used;
}

/**
 * Enumerable values of `node` that no fixture reaches.
 *
 * @param node    manifest entry (static/nodes.json), for the declared params + defaults
 * @param options selectOptions() for that node's component
 * @param used    param -> Set of values this node's fixtures pass
 */
export function uncoveredValues(node, options, used) {
	const gaps = [];
	for (const p of node.params ?? []) {
		const seen = new Set(used?.get(p.name) ?? []);
		// Omitting a param runs it at its default, so the default counts as covered.
		const everSetExplicitly = seen.size > 0;
		if (!everSetExplicitly && p.default !== undefined) seen.add(p.default);

		const opt = options[p.name];
		let domain = null;
		if (typeof p.default === 'boolean') domain = [true, false];
		else if (Array.isArray(opt)) domain = opt;
		else if (opt && opt.unresolved) {
			gaps.push({ param: p.name, unresolvedOptions: opt.unresolved });
			continue;
		}
		if (!domain) continue; // continuous parameter — not a branch

		const missing = domain.filter((v) => !seen.has(v));
		if (missing.length) gaps.push({ param: p.name, missing });
	}
	return gaps;
}

/**
 * Enumerable parameter values no fixture reaches, as at 2026-07-28.
 *
 * A ratchet, in the same spirit as PYTHON_GAPS in runtimeCoverage.js: this list may
 * SHRINK but never GROW. Adding a parameter or an option without a fixture that
 * reaches it is then a deliberate, visible decision rather than a silent hole.
 *
 * The entries are not equally serious. `FitFunction.model` never reaching
 * `doublelogistic` or `rectangular`, and `RhythmicityAnalysis` never reaching the
 * `fft` or `correlogram` analyses or the Chi-squared and Enright periodograms, are
 * whole analyses that three languages claim to agree on and nothing has ever
 * compared. The optimiser-based ones (FitFunction, DoubleLogistic, RectangularWave)
 * are the same failure class as the cosinor bug above and should go first.
 */
export const PARAM_COVERAGE_GAPS = {
	BinnedData: { diffStep: [true] },
	Correlation: { method: ['auto', 'spearman'] },
	Cosinor: { permuteTest: [true] },
	CrossCorrelation: { method: ['spearman'] },
	DoubleLogistic: { fixK1: [true], fixK2: [true], fixPeriod: [false], permuteTest: [true] },
	FDRCorrection: { method: ['none', 'bonferroni'] },
	FitFunction: {
		model: ['rectangular', 'doublelogistic'],
		useFixedPeriod: [false],
		fixKappa: [true],
		fixOmega: [true],
		fixDutyCycle: [true],
		periodic: [false],
		fixK1: [true],
		fixK2: [true],
		permuteTest: [true],
		autoPermutations: [true],
		permutationStatistic: ['rmse']
	},
	GroupComparison: { postHocEnabled: [false] },
	NormalityTest: { method: ['dagostino', 'jarquebera'] },
	RayleighTest: { showWatsonWilliams: [false] },
	RectangularWave: {
		fixKappa: [true],
		fixOmega: [true],
		fixDutyCycle: [true],
		permuteTest: [true]
	},
	RhythmicityAnalysis: { analysis: ['fft', 'correlogram'], pgMethod: ['Chi-squared', 'Enright'] },
	SurrogateTest: { method: ['phase', 'aaft', 'ar1', 'shuffle'] }
};
