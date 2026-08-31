// The handbook's PROSE must describe the outputs a node actually produces.
//
// WHY THIS EXISTS
//
// The Node Reference has two halves that update by different mechanisms. The
// structural half — inputs, params, output ports — is generated from
// static/nodes.json and is therefore always current. The curated half — the
// written description, the maths, the references — is hand-authored, and nothing
// made it follow.
//
// So they drift silently, and did: v68.0 and v68.1 added confidence intervals to
// Correlation and Cosinor, an effect-size port to GroupComparison, R2/RMSE to
// RectangularWave and DoubleLogistic, and a significance flag to Correlation.
// Every one appeared in the generated tables. NONE was mentioned in the prose.
// `handbook:check` stayed green throughout, because it only asserts that each
// node HAS an entry — never that the entry describes what the node now does.
// (GroupComparison's effect sizes had in fact never been documented at all.)
//
// HOW IT CHECKS
//
// Demanding that prose contain the literal port name would be both brittle and
// unreadable — nobody should have to write "ciLow" in a sentence. Instead each
// interpretive port maps to the CONCEPT its description must mention, and the
// prose satisfies it by discussing that concept in any reasonable wording.
//
// An interpretive port with no concept mapping is a FAILURE, not a pass. That is
// the same principle as the other guards here: a check whose failure mode is
// "skip what I don't recognise" degrades to green silently, which is exactly how
// the paramNotes hole survived. A new metric port therefore forces a deliberate
// choice — describe it, or exempt it with a reason.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');

const manifest = JSON.parse(readFileSync(join(repo, 'static/nodes.json'), 'utf8'));
const nodeRef = JSON.parse(readFileSync(join(repo, 'handbook/src/lib/nodeReference.json'), 'utf8'));

/**
 * Ports that carry no interpretation of their own: the x grid a fit is drawn on,
 * the per-Y series (`cosinory_*`), passthrough values, and label columns. Their
 * meaning is the node's meaning, which the prose already covers.
 */
function isStructural(name) {
	if (name.endsWith('_*')) return true;
	if (/^.*x$/.test(name) && name !== 'max') return true;
	return [
		'output',
		'result',
		'value',
		'values',
		'set',
		'outCols',
		'segments',
		'time',
		'category',
		'binary',
		'variable',
		'term',
		'n',
		'outcome',
		'fitted',
		'eta',
		'var_i',
		'var_j',
		'lag'
	].includes(name);
}

/**
 * What the prose must talk about for a given port. Matched case-insensitively
 * against the node's whole curated entry (description + maths + references).
 */
const CONCEPT = {
	pvalue: /p-?value|significan/,
	// The optional permutation test's empirical p. On Cosinor it split off
	// `pvalue` in v72.x so the plainly-named port could carry the analytic
	// F-test p; RectangularWave/DoubleLogistic then renamed their only p onto
	// this key too (no analytic test exists for those nonlinear fits).
	perm_pvalue: /permutation/,
	ww_pvalue: /Watson-?Williams/,
	statistic: /statistic|χ²|chi-?squared|\bF\b|\bU\b|\bH\b/,
	df: /degrees of freedom|\bdf\b/,
	effectSize: /effect size|Cram|Cohen|eta-?squared|epsilon-?squared|odds ratio/,
	ciLow: /confidence interval|95%/,
	ciHigh: /confidence interval|95%/,
	amplitude_ciLow: /confidence interval|95%/,
	amplitude_ciHigh: /confidence interval|95%/,
	acrophase_ciLow: /confidence interval|95%/,
	acrophase_ciHigh: /confidence interval|95%/,
	r2: /R²|R\^2|r-?squared|variance/,
	rsquared: /R²|R\^2|r-?squared|variance/,
	rmse: /RMSE|root.mean|residual/,
	r: /correlat/,
	correlation: /correlat/,
	significant: /significan|alpha/,
	padj: /adjust|correct/,
	reject: /reject|significan/,
	oddsRatio: /odds ratio/,
	coef: /coefficient/,
	se: /standard error/,
	z: /\bz\b|z-?score|Rayleigh/,
	observed: /observed|statistic/,
	normal: /normal/,
	mesor: /MESOR/,
	amplitude: /amplitude/,
	acrophase: /acrophase/,
	bathyphase: /bathyphase|trough/,
	phase_angle: /phase angle|entrain/,
	period: /period/,
	R: /mean resultant|\bR\b/,
	F: /Watson-?Williams|\bF\b/,
	IS: /interdaily|\bIS\b/,
	IV: /intradaily|\bIV\b/,
	RA: /relative amplitude|\bRA\b/,
	CFI: /circadian function index|\bCFI\b/,
	L5: /\bL5\b|least active/,
	M10: /\bM10\b|most active/,
	L5onset: /\bL5\b|onset/,
	M10onset: /\bM10\b|onset/,
	mean: /mean/,
	median: /median/,
	sd: /standard deviation|\bSD\b/,
	min: /minimum|\bmin\b/,
	max: /maximum|\bmax\b/,
	range: /range/,
	q1: /quartile|\bQ1\b/,
	q3: /quartile|\bQ3\b/,
	iqr: /interquartile|\bIQR\b/,
	skewness: /skew/,
	kurtosis: /kurtosis/
};

/** Ports deliberately left undescribed, each with its reason. */
const UNDOCUMENTED_BY_DESIGN = {};

const entries = manifest.nodes
	.map((n) => ({
		id: n.id,
		ports: (n.outputs ?? [])
			.map((o) => (typeof o === 'string' ? o : o?.name))
			.filter((p) => p && !isStructural(p))
	}))
	.filter((e) => e.ports.length && nodeRef[e.id]);

describe('handbook prose covers the outputs each node produces', () => {
	it('finds nodes and ports to check (guards against the extractor going blind)', () => {
		expect(entries.length).toBeGreaterThan(10);
		expect(entries.reduce((n, e) => n + e.ports.length, 0)).toBeGreaterThan(40);
	});

	it('every interpretive port has a concept mapping or a stated exemption', () => {
		// A new metric port must be a deliberate decision, not a silent pass.
		const unmapped = new Set();
		for (const { id, ports } of entries) {
			for (const p of ports) {
				if (!CONCEPT[p] && !UNDOCUMENTED_BY_DESIGN[`${id}.${p}`]) unmapped.add(`${id}.${p}`);
			}
		}
		expect(
			[...unmapped],
			`these output ports have no entry in CONCEPT and no exemption: ${[...unmapped].join(', ')}. ` +
				`Add the concept its handbook description must mention, or exempt it with a reason.`
		).toEqual([]);
	});

	for (const { id, ports } of entries) {
		it(`${id}: prose describes what it outputs`, () => {
			const prose = JSON.stringify(nodeRef[id]);
			const undescribed = ports.filter((p) => {
				if (UNDOCUMENTED_BY_DESIGN[`${id}.${p}`]) return false;
				const re = CONCEPT[p];
				return re ? !re.test(prose) : false; // unmapped ports are reported above
			});
			expect(
				undescribed,
				`${id} outputs ${JSON.stringify(undescribed)}, but its handbook entry never discusses ` +
					`them. The generated tables will list the ports while the description stays silent — ` +
					`update handbook/src/lib/nodeReference.json.`
			).toEqual([]);
		});
	}
});
