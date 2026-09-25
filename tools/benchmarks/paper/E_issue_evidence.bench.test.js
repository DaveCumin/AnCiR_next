// E. Minimal, noise-free reproductions of two behaviours found during the accuracy study.
// Gated: RUN_PAPER_BENCH=1. Writes results/accuracy/E_issue_evidence.json.
//
// 1) Chi-squared / Enright reported peak sits at the LOWER EDGE of a plateau.
//    Both statistics depend on the trial period only through round(period / binSize),
//    so with a period step finer than the bin every period in
//    [ (P - 0.5) * binSize, (P + 0.5) * binSize ) gets the identical value. The peak
//    readout (RhythmicityAnalysis: first arg-max, strict `>`) returns the first of the
//    tied periods, i.e. about binSize/2 BELOW the plateau centre P * binSize.
//
// 2) Fixed-period cosinor "acrophase" is reported in two conventions by the same node.
//    fitCosinorFixed returns acrophase_hrs = wrap(-t_peak) (classical phi / omega);
//    the Cosinor node converts it to the peak time for its `acrophase` output port but
//    prints and exports the unconverted value (H1 Acrophase text, H{h}_acrophase_hrs CSV).
import { describe, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { runPeriodogramCalculation } from '$lib/utils/periodogram.js';
import { fitCosinorFixed } from '$lib/utils/cosinor.js';

const RUN = process.env.RUN_PAPER_BENCH === '1';
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), 'results', 'accuracy');

function plateau(res) {
	let best = -Infinity;
	for (const v of res.y) if (v > best) best = v;
	const tied = res.x.filter((_, i) => Math.abs(res.y[i] - best) <= 1e-12 * Math.abs(best));
	let first = -1;
	for (let i = 0; i < res.y.length; i++)
		if (res.y[i] > (first < 0 ? -Infinity : res.y[first])) first = i;
	return {
		reported_peak: res.x[first],
		tied_min: Math.min(...tied),
		tied_max: Math.max(...tied),
		n_tied: tied.length
	};
}

describe.skipIf(!RUN)('E issue evidence', () => {
	it('records minimal reproductions', () => {
		const out = { plateau: [], acrophase: null };
		for (const [dt, binSize, step, tau] of [
			[1, 1, 0.05, 24.0],
			[1, 1, 0.1, 24.0], // RhythmicityAnalysis default step
			[1, 1, 0.25, 24.0], // Periodogram plot default step
			[0.25, 0.25, 0.05, 24.0],
			[0.25, 1, 0.05, 24.0],
			[1, 1, 0.05, 24.3]
		]) {
			const t = [];
			const y = [];
			for (let i = 0; i < Math.round((14 * 24) / dt); i++) {
				t.push(i * dt);
				y.push(10 + Math.cos((2 * Math.PI * i * dt) / tau));
			}
			for (const method of ['Chi-squared', 'Enright']) {
				const res = runPeriodogramCalculation({
					method,
					xData: t,
					yData: y,
					periodMin: 18,
					periodMax: 32,
					periodSteps: step,
					binSize,
					chiSquaredAlpha: 0.05
				});
				out.plateau.push({
					method,
					dt,
					binSize,
					step,
					true_tau: tau,
					days: 14,
					noise: 'none',
					...plateau(res)
				});
			}
		}
		// Acrophase: noiseless 24 h cosine that peaks at t = 6 h.
		const t = Array.from({ length: 7 * 96 }, (_, i) => i * 0.25);
		const y = t.map((ti) => 10 + 2 * Math.cos((2 * Math.PI * (ti - 6)) / 24));
		const r = fitCosinorFixed(t, y, 24, 1, 0.05);
		const acro = r.harmonics[0].acrophase_hrs;
		out.acrophase = {
			true_peak_time_h: 6,
			fitCosinorFixed_acrophase_hrs: acro,
			CI_acrophase: r.harmonics[0].CI_acrophase,
			cosinor_node_port_value_wrap_minus_acrophase_hrs: ((-acro % 24) + 24) % 24,
			note: 'Cosinor.svelte: port `acrophase` = wrap(-acrophase_hrs) (line ~403); panel text "H1 Acrophase" (line ~1161) and CSV column H1_acrophase_hrs (line ~839/864) print acrophase_hrs unconverted.'
		};
		fs.mkdirSync(OUT, { recursive: true });
		fs.writeFileSync(path.join(OUT, 'E_issue_evidence.json'), JSON.stringify(out, null, 1));
		console.log(JSON.stringify(out, null, 1));
	});
});
