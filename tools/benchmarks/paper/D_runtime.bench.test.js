// D. Runtime of each AnCiR method on one series (Node, single thread), per record length.
// Gated: RUN_PAPER_BENCH=1. Writes results/D_runtime.json.
import { describe, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { simulate, seedFrom } from './lib/sim.js';
import { periodogramPeak, fftPeak, cosinorFree, cosinorFixedP } from './lib/methods.js';
import { computeNPCRA } from '$lib/utils/npcra.js';

const RUN = process.env.RUN_PAPER_BENCH === '1';
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), 'results', 'accuracy');

function timeIt(fn, reps) {
	fn(); // warm-up (JIT)
	const t0 = performance.now();
	for (let i = 0; i < reps; i++) fn();
	return (performance.now() - t0) / reps;
}

describe.skipIf(!RUN)('D runtime', () => {
	it('times each method', () => {
		const rows = [];
		for (const dt of [0.25, 1]) {
			for (const days of [3, 7, 14]) {
				const { t, y } = simulate({ seed: seedFrom('D', dt, days), days, dt, tau: 24.3, amp: 1 });
				const grid = { periodMin: 18, periodMax: 32, step: 0.05, binSize: dt };
				const reps = 5;
				const r = {
					dt,
					days,
					n: t.length,
					LombScargle_ms: timeIt(() => periodogramPeak('Lomb-Scargle', t, y, grid), reps),
					ChiSquared_ms: timeIt(() => periodogramPeak('Chi-squared', t, y, grid), reps),
					Enright_ms: timeIt(() => periodogramPeak('Enright', t, y, grid), reps),
					CosinorFree_ms: timeIt(() => cosinorFree(t, y), reps),
					CosinorFixed_ms: timeIt(() => cosinorFixedP(t, y, 24), reps),
					FFTauto_ms: timeIt(() => fftPeak(t, y, null), reps),
					FFTfine_ms: timeIt(() => fftPeak(t, y, 0.0001), reps),
					NPCRA_ms: timeIt(() => computeNPCRA(t, y, { epochHours: 1 }), reps)
				};
				rows.push(r);
				console.log(JSON.stringify(r));
			}
		}
		fs.mkdirSync(OUT, { recursive: true });
		fs.writeFileSync(path.join(OUT, 'D_runtime.json'), JSON.stringify(rows, null, 1));
	});
});
