// Study B (false-positive rate under no rhythm). One row per replicate.
import fs from 'node:fs';
import path from 'node:path';
import { simulate, seedFrom } from './sim.js';
import { periodogramPeak, cosinorFixedP, surrogateBlockP } from './methods.js';

export const REPS_B = 1000;
export const REPS_B_SURR = 200; // surrogate test (199 surrogates each) on the first 200 reps of 7-day cells

export function cellsB() {
	const cells = [];
	for (const noise of ['white', 'ar1'])
		for (const dt of [0.25, 1]) for (const days of [3, 7, 14]) cells.push({ noise, dt, days });
	return cells.map((c, id) => ({ id, ...c }));
}

const COLS = [
	'cell',
	'noise',
	'dt',
	'days',
	'rep',
	'n',
	'CHI_sigPeak',
	'CHI_sigAny',
	'CHI_pPeak',
	'CHI_peak',
	'COS24_p',
	'SURR_p'
];

export function runShardB(shard, nShards, outDir, reps = REPS_B) {
	const lines = [COLS.join(',')];
	for (const c of cellsB()) {
		if (c.id % nShards !== shard) continue;
		for (let rep = 0; rep < reps; rep++) {
			const { t, y } = simulate({
				seed: seedFrom('B', c.id, rep),
				days: c.days,
				dt: c.dt,
				tau: 24,
				amp: 0,
				noise: c.noise,
				ar1Phi: 0.5
			});
			const chi = periodogramPeak('Chi-squared', t, y, {
				periodMin: 18,
				periodMax: 32,
				step: 0.05,
				binSize: c.dt
			});
			const p24 = cosinorFixedP(t, y, 24);
			const surr =
				c.days === 7 && rep < Math.min(REPS_B_SURR, reps)
					? surrogateBlockP(t, y, { seed: seedFrom('B-surr', c.id, rep) })
					: '';
			lines.push(
				[
					c.id,
					c.noise,
					c.dt,
					c.days,
					rep,
					t.length,
					chi.sigPeak,
					chi.sigAny,
					chi.pPeak,
					chi.period,
					p24,
					surr
				].join(',')
			);
		}
	}
	fs.mkdirSync(outDir, { recursive: true });
	fs.writeFileSync(path.join(outDir, `B_shard${shard}.csv`), lines.join('\n') + '\n');
	return lines.length - 1;
}
