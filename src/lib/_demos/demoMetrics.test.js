// Golden values for every demo's scalar metric outputs.
//
// WHY THIS EXISTS
//
// v68.0 changed one default — how the categorical node reads its two inputs —
// and silently changed what two shipped demos COMPUTE. The 120-row chi-squared
// workflow went from p = 0.000117 to p = 0 and the generated node demo went to
// p = 1, because both are genuinely paired data that the new default read as
// independent groups. Nothing failed: the sessions still loaded, the nodes still
// produced numbers, `demos.validate` still passed. It surfaced only because a
// regeneration was inspected by hand.
//
// That is the general shape of the risk. Demos are the app's worked examples and
// its documentation; a change in a default, a formula or a missing-value rule
// can rewrite their conclusions without breaking anything a test looks at. This
// file pins the numbers so any such change has to be looked at and approved.
//
// WHEN THIS FAILS: read the diff. If the new numbers are correct (a fixed bug, a
// deliberate default change), regenerate the snapshot:
//
//     GEN_DEMO_METRICS=1 npx vitest run src/lib/_demos/demoMetrics.test.js
//
// and include the changed golden file in the same commit as the change that
// caused it, so review sees both together. If the numbers are NOT what you
// intended, you have just caught the bug this file exists for.
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import golden from './demoMetrics.golden.json' with { type: 'json' };

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const DEMO_DIR = join(repo, 'static/sessions/demos');

/**
 * Scalar metric outputs of a demo session, keyed `<Node>.<outKey>`.
 *
 * Deliberately limited to SHORT all-numeric columns: those are the metric ports
 * (statistic, pvalue, effect size, period…) — the quantities a reader takes as
 * the demo's finding. Long data columns are the inputs and fitted curves, which
 * are already covered by the parity harness and would make this file enormous.
 */
function metricsOf(session) {
	const rd = session.rawData ?? {};
	const out = {};
	for (const tp of session.tableProcesses ?? []) {
		for (const [key, cid] of Object.entries(tp.args?.out ?? {}).sort()) {
			const vals = rd[String(cid)];
			if (!Array.isArray(vals) || vals.length === 0 || vals.length > 8) continue;
			if (!vals.every((v) => typeof v === 'number')) continue;
			out[`${tp.name}.${key}`] = vals.map((v) => Number(v.toFixed(9)));
		}
	}
	return out;
}

function currentSnapshot() {
	const snap = {};
	for (const f of readdirSync(DEMO_DIR).sort()) {
		if (!f.endsWith('.json') || f === 'index.json') continue;
		let session;
		try {
			session = JSON.parse(readFileSync(join(DEMO_DIR, f), 'utf8'));
		} catch {
			continue;
		}
		const m = metricsOf(session);
		if (Object.keys(m).length) snap[basename(f)] = m;
	}
	return snap;
}

const current = currentSnapshot();

if (process.env.GEN_DEMO_METRICS) {
	writeFileSync(join(here, 'demoMetrics.golden.json'), JSON.stringify(current, null, '\t') + '\n');
}

describe('demo metric outputs match their golden values', () => {
	it('captures a meaningful number of demos (guards against the extractor going blind)', () => {
		// If this collapses, every check below passes vacuously — the classic way a
		// snapshot test stops testing anything.
		expect(Object.keys(current).length).toBeGreaterThan(25);
		const series = Object.values(current).reduce((n, d) => n + Object.keys(d).length, 0);
		expect(series).toBeGreaterThan(120);
	});

	it('has no demo in the golden file that has since disappeared', () => {
		const gone = Object.keys(golden).filter((d) => !current[d]);
		expect(
			gone,
			`these demos are in the golden file but no longer produce metrics: ${JSON.stringify(gone)}. ` +
				`If that is intended, regenerate with GEN_DEMO_METRICS=1.`
		).toEqual([]);
	});

	for (const demo of Object.keys(golden)) {
		it(`${demo}: metrics unchanged`, () => {
			const now = current[demo];
			expect(now, `${demo} produced no metric outputs at all`).toBeTruthy();
			for (const [key, want] of Object.entries(golden[demo])) {
				const got = now[key];
				expect(got, `${demo} no longer emits ${key} — a port was renamed or removed`).toBeDefined();
				expect(
					got,
					`${demo} ${key} changed: ${JSON.stringify(want)} -> ${JSON.stringify(got)}. ` +
						`If the new value is correct, regenerate with GEN_DEMO_METRICS=1 and commit the ` +
						`golden file alongside the change.`
				).toEqual(want);
			}
		});
	}
});
