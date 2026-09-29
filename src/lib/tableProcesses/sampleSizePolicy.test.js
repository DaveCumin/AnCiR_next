// Every node that reports a p-value must have a stated position on small samples.
//
// WHY THIS EXISTS
//
// A test can return a confident-looking p-value from a handful of points with
// nothing on screen to say so. Measured when this was audited:
//
//   rayleighTest on 3 angles -> R = 0.999, p = 0.034    no warning
//   correlate    on n = 4    -> r = 0.999, p = 0.0011   no warning
//
// Six nodes were found silent and all six have since been fixed. Nothing stops the
// seventh from shipping the same way, which is how the first six happened: each was
// individually reasonable, and no single place asked the question.
//
// So this is a registry, not a heuristic. A node emitting `pvalue` (or `perm_pvalue`,
// `padj`, `ww_pvalue`) must appear below, either as CHECKED — and then it really must
// push a sample-size warning — or as an exemption with a reason. Adding such a node
// without touching this file fails, which makes the decision deliberate.
// `perm_pvalue` joined the extractor in v72.25, when RectangularWave/DoubleLogistic
// renamed their permutation-p port off the bare `pvalue`: a rename must not silently
// walk a node out of this registry's scope. Plots joined in v77.x, when their metric
// ports reached the manifest: the periodogram's `peak_pvalue` had escaped until then.
//
// This is the paramNotesCoverage pattern, and it follows its central lesson: a
// guard whose failure mode is "skip what I don't recognise" degrades to green
// silently. An unlisted node is a FAILURE here, never a pass.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const manifest = JSON.parse(readFileSync(join(repo, 'static/nodes.json'), 'utf8'));

/**
 * What each p-value-reporting node does about small samples.
 *
 * The three tiers from the audit:
 *
 * 'checked'  — computable but unreliable, so it WARNS. The guard below verifies the
 *              node really contains such a warning, so an entry cannot be an
 *              aspiration.
 * 'refuses'  — declines to compute at all below a threshold (`valid: false` plus a
 *              reason). Stronger than a warning, and deliberately a separate tier:
 *              demanding a warnings.push from these would push them the wrong way.
 * any other  — a deliberate exemption, and the reason, in prose.
 */
const SAMPLE_SIZE_POLICY = {
	ChiSquared: 'checked', // expected counts < 5 (Cochran), names Fisher's exact as the remedy
	Correlation: 'checked', // warns below n = 10
	CrossCorrelation: 'checked', // warns when the most-shifted lags overlap in few points
	Cosinor: 'checked', // too few cycles, and too few points per cycle
	DoubleLogistic: 'checked',
	FDRCorrection: 'checked', // family size, and unusable entries excluded
	FitFunction: 'checked', // usable points vs the chosen model's free-parameter count
	GroupComparison: 'checked', // per-group n < 5 for rank tests; normality screen reports a skip
	LogisticRegression: 'checked', // rows per predictor; separation
	NormalityTest: 'checked', // D'Agostino below n ~ 20; Shapiro-Wilk's n <= 5000 ceiling
	RayleighTest: 'checked', // n < 8 (Zar 1999), and says a null result is uninformative too
	RectangularWave: 'checked',
	SurrogateTest: 'refuses', // returns invalid with 'need at least 8 samples'
	// A PLOT (its metric ports joined the manifest in v77.x): the chi-squared periodogram's
	// peak_pvalue, one per series. Exempt, with the gap stated rather than hidden: the plot
	// warns about missing values, gaps and a bin size below the sampling interval, but NOT
	// about a record too short to hold many cycles. The p-value is the Sokolove-Bushell
	// chi-squared statistic's, whose degrees of freedom follow the fold, not the record
	// length; the handbook's Node Reference tells the reader to weigh it against the number
	// of cycles. A short-record warning would move this to 'checked'.
	periodogram:
		'exempt: warns on missing values, gaps and bin size, not on record length (see the handbook entry)'
};

// Output names that carry a p-value. `peak_pvalue` is the periodogram's (a plot metric port).
const PVALUE_NAMES = new Set(['pvalue', 'perm_pvalue', 'padj', 'ww_pvalue', 'peak_pvalue']);

const outputNames = (n) => (n.outputs ?? []).map((o) => (typeof o === 'string' ? o : o?.name));

/**
 * Nodes whose output includes a p-value the user will read as a result: table processes
 * and, since their metric ports are in the manifest, plots.
 */
const pvalueNodes = manifest.nodes
	.filter((n) => n.kind === 'tableProcess' || n.kind === 'plot')
	.filter((n) => outputNames(n).some((name) => PVALUE_NAMES.has(name)))
	.map((n) => n.id);

function sourceOf(id) {
	const kind = manifest.nodes.find((n) => n.id === id)?.kind;
	const f =
		kind === 'plot'
			? join(
					repo,
					'src/lib/plots',
					`${id[0].toUpperCase()}${id.slice(1)}`,
					`${id[0].toUpperCase()}${id.slice(1)}.svelte`
				)
			: join(repo, 'src/lib/tableProcesses', `${id}.svelte`);
	return existsSync(f) ? readFileSync(f, 'utf8') : '';
}

describe('every p-value node has a stated small-sample policy', () => {
	it('finds the p-value nodes (guards against the extractor going blind)', () => {
		expect(pvalueNodes.length).toBeGreaterThan(8);
	});

	it('scans PLOT outputs too: the periodogram is in scope, the actogram rules are not', () => {
		// Plots published no outputs to the manifest before v77.x, so the periodogram's
		// peak_pvalue escaped this registry. Both halves pin that the scan now sees plots.
		expect(pvalueNodes).toContain('periodogram');
		// The actogram's marker-rule ports are read by the scan and carry no p-value: a fit's
		// tau, phi, R², RMSE and n. n (markers fitted) is what lets a consumer weigh a tau
		// from a handful of onsets, the same role qq_n plays for the Q-Q plot's r.
		const acto = manifest.nodes.find((n) => n.id === 'actogram');
		expect(outputNames(acto)).toEqual(['r*_tau', 'r*_phi', 'r*_r2', 'r*_rmse', 'r*_n']);
		expect(pvalueNodes).not.toContain('actogram');
	});

	it('every p-value node appears in the policy registry', () => {
		const unlisted = pvalueNodes.filter((id) => !SAMPLE_SIZE_POLICY[id]);
		expect(
			unlisted,
			`these nodes report a p-value but say nothing about sample size: ${unlisted.join(', ')}. ` +
				`A confident p-value from a handful of points, presented like one from three hundred, ` +
				`is the failure this registry exists to prevent. Add a small-sample warning and mark ` +
				`the node 'checked', or record an exemption with a reason.`
		).toEqual([]);
	});

	it("a node marked 'refuses' really does decline below a threshold", () => {
		const claimed = pvalueNodes.filter((id) => SAMPLE_SIZE_POLICY[id] === 'refuses');
		const notActually = claimed.filter((id) => {
			const src = sourceOf(id);
			return !/return \[[^\]]*false\]|valid\s*=\s*false/.test(src) || !/least \d+|< \d+/.test(src);
		});
		expect(
			notActually,
			`marked 'refuses' but no threshold refusal found: ${notActually.join(', ')}`
		).toEqual([]);
	});

	it("a node marked 'checked' really does warn about sample size", () => {
		// Otherwise the registry drifts into a list of good intentions.
		const claimed = pvalueNodes.filter((id) => SAMPLE_SIZE_POLICY[id] === 'checked');
		const notActually = claimed.filter((id) => {
			const src = sourceOf(id);
			if (!/warnings\.push|warnings =/.test(src)) return true;
			// Some signal that a warning is about SIZE rather than, say, convergence.
			return !/(small sample|Small sample|MIN_N|MIN_DAYS|n\s*[<≥>]=?\s*\d|per cycle|too few|fewer than|expected count|p-value|family)/i.test(
				src
			);
		});
		expect(
			notActually,
			`marked 'checked' but no sample-size warning found in the source: ${notActually.join(', ')}`
		).toEqual([]);
	});

	it('the registry has no entries for nodes that no longer report a p-value', () => {
		const known = new Set(pvalueNodes);
		const stale = Object.keys(SAMPLE_SIZE_POLICY).filter((id) => !known.has(id));
		expect(stale, `policy entries for nodes with no p-value output: ${stale.join(', ')}`).toEqual(
			[]
		);
	});
});
