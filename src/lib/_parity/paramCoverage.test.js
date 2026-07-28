// The parity fixtures' parameter coverage, as a ratchet.
//
// Fixtures prove agreement on the inputs they happen to use. Cosinor had two and
// both pinned useFixedPeriod:true, so the free-period path — the engine's only
// nonlinear optimiser — went unchecked in every language until a fixture was
// finally written and the Python port turned out to be badly broken (amplitude
// 3.3 against a true 38). Nothing pointed at that hole; this does.
//
// The list in PARAM_COVERAGE_GAPS may SHRINK but never GROW. Close a gap by
// writing a fixture that reaches the value, then delete it from the list.
//
// Runs in the normal vitest suite: no Python or R toolchain, so it cannot be
// skipped by not having an environment set up.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
	selectOptions,
	makeIdentResolver,
	valuesUsedByFixtures,
	uncoveredValues,
	PARAM_COVERAGE_GAPS
} from './paramCoverage.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');

const manifest = JSON.parse(readFileSync(join(repo, 'static/nodes.json'), 'utf8'));
const { fixtures } = JSON.parse(readFileSync(join(repo, 'tools/parity/fixtures.json'), 'utf8'));

const used = valuesUsedByFixtures(fixtures);

/** Analyses that have at least one fixture — the only ones coverage means anything for. */
const covered = manifest.nodes.filter((n) => n.kind === 'tableProcess' && used.has(n.id));

const resolveIdent = makeIdentResolver((rel) => {
	const f = join(repo, 'src/lib', rel);
	return existsSync(f) ? readFileSync(f, 'utf8') : null;
});

function optionsFor(id) {
	const file = join(repo, 'src/lib/tableProcesses', `${id}.svelte`);
	return existsSync(file) ? selectOptions(readFileSync(file, 'utf8'), resolveIdent) : {};
}

/** { [analysis]: { [param]: missingValues[] } } for everything not yet reached. */
function currentGaps() {
	const out = {};
	for (const node of covered) {
		const gaps = uncoveredValues(node, optionsFor(node.id), used.get(node.id));
		if (gaps.length) {
			out[node.id] = Object.fromEntries(
				gaps.map((g) => [g.param, g.missing ?? `UNRESOLVED options={${g.unresolvedOptions}}`])
			);
		}
	}
	return out;
}

describe('parity fixtures reach every enumerable parameter value', () => {
	it('finds analyses and fixtures to check', () => {
		// Guard against the extractor going blind, which would report perfect
		// coverage precisely when it is measuring nothing.
		expect(fixtures.length).toBeGreaterThan(50);
		expect(covered.length).toBeGreaterThan(10);
	});

	it('no analysis has an options list the extractor cannot read', () => {
		// Silently skipping an unreadable options list would understate the gaps.
		const unreadable = [];
		for (const node of covered) {
			for (const [param, opt] of Object.entries(optionsFor(node.id))) {
				if (opt && opt.unresolved) unreadable.push(`${node.id}.${param} (${opt.unresolved})`);
			}
		}
		expect(
			unreadable,
			`these select options could not be resolved to literals, so their coverage is unknown: ` +
				`${unreadable.join(', ')}. Inline the options as a literal array.`
		).toEqual([]);
	});

	it('the uncovered set has not grown', () => {
		const gaps = currentGaps();
		const isNew = [];
		for (const [analysis, params] of Object.entries(gaps)) {
			for (const [param, missing] of Object.entries(params)) {
				const known = PARAM_COVERAGE_GAPS[analysis]?.[param] ?? [];
				const fresh = (Array.isArray(missing) ? missing : [missing]).filter(
					(v) => !known.includes(v)
				);
				if (fresh.length) isNew.push(`${analysis}.${param} = ${JSON.stringify(fresh)}`);
			}
		}
		expect(
			isNew,
			`these parameter values are not reached by any parity fixture, and are not in the ` +
				`recorded baseline: ${isNew.join('; ')}. Each is a branch that three language ` +
				`runtimes claim to agree on and nothing compares. Write a fixture that reaches it, ` +
				`or add it to PARAM_COVERAGE_GAPS with a reason.`
		).toEqual([]);
	});

	it('every recorded gap is still real (the ratchet tightens)', () => {
		// A gap that has been closed must leave the list, or the list stops meaning
		// anything and a future regression could hide behind a stale entry.
		const gaps = currentGaps();
		const stale = [];
		for (const [analysis, params] of Object.entries(PARAM_COVERAGE_GAPS)) {
			for (const [param, missing] of Object.entries(params)) {
				const still = gaps[analysis]?.[param] ?? [];
				const closed = missing.filter((v) => !still.includes(v));
				if (closed.length) stale.push(`${analysis}.${param} = ${JSON.stringify(closed)}`);
			}
		}
		expect(
			stale,
			`these values ARE now covered by a fixture — remove them from PARAM_COVERAGE_GAPS: ` +
				`${stale.join('; ')}`
		).toEqual([]);
	});
});

// The report itself, written to a file rather than logged: vitest swallows console
// output under a non-TTY reporter, and a checked-in artefact is what you actually
// want to read when deciding which fixture to write next.
//
//     PARAM_COVERAGE_REPORT=1 npx vitest run src/lib/_parity/paramCoverage.test.js
describe.runIf(process.env.PARAM_COVERAGE_REPORT)('parameter coverage report', () => {
	it('writes tools/parity/param-coverage.md', () => {
		const gaps = currentGaps();
		const reached = covered.filter((n) => !gaps[n.id]);
		const lines = [
			'# Parity fixture parameter coverage',
			'',
			'Generated by `PARAM_COVERAGE_REPORT=1 npx vitest run src/lib/_parity/paramCoverage.test.js`.',
			'Do not hand-edit.',
			'',
			'Which values of each analysis’s ENUMERABLE parameters (booleans, select options)',
			'appear in any parity fixture. A value listed here is a branch that the JS, Python and R',
			'runtimes all claim to agree on and that nothing has ever compared.',
			'',
			`${covered.length} analyses have at least one fixture; ${reached.length} reach every enumerable value.`,
			'',
			'## Values no fixture reaches',
			''
		];
		for (const node of covered) {
			const g = gaps[node.id];
			if (!g) continue;
			lines.push(`### ${node.id}`, '');
			for (const [p, m] of Object.entries(g)) lines.push(`- \`${p}\`: ${JSON.stringify(m)}`);
			lines.push('');
		}
		lines.push('## Fully covered', '', reached.map((n) => `- ${n.id}`).join('\n') || '- (none)', '');
		const out = join(repo, 'tools/parity/param-coverage.md');
		writeFileSync(out, lines.join('\n'), 'utf8');
		expect(readFileSync(out, 'utf8')).toContain('Parity fixture parameter coverage');
	});
});
