// Study A (period recovery / detection) runner. Each shard processes the cells whose
// index % nShards === shard and writes results/raw/A_shard<k>.csv (one row per replicate).
import fs from 'node:fs';
import path from 'node:path';
import { simulate, seedFrom, mulberry32 } from './sim.js';
import {
	periodogramPeak,
	fftPeak,
	cosinorFree,
	cosinorFixedP,
	surrogateBlockP
} from './methods.js';

export const REPS_A = 200;
export const SNRS = [0.25, 0.5, 1, 2];
export const STEP = 0.05; // trial-period step (h)

/** Full list of study-A cells, in a fixed order (cell id = index). */
export function cellsA() {
	const cells = [];
	// A1: main factorial, cosine waveform, complete even sampling, tau ~ U(20, 28).
	for (const dt of [0.25, 1])
		for (const days of [3, 7, 14])
			for (const snr of SNRS)
				cells.push({
					block: 'main',
					cond: 'cosine',
					wave: 'cosine',
					missing: 'none',
					dt,
					days,
					snr,
					tauLo: 20,
					tauHi: 28,
					pmin: 18,
					pmax: 32
				});
	// A2: robustness conditions at 15-min sampling, 7-day records.
	const extra = [
		{
			cond: 'circatidal',
			wave: 'cosine',
			missing: 'none',
			tauLo: 12.42,
			tauHi: 12.42,
			pmin: 10,
			pmax: 16
		},
		{ cond: 'square', wave: 'square', missing: 'none', tauLo: 20, tauHi: 28, pmin: 18, pmax: 32 },
		{ cond: 'pulse25', wave: 'pulse', missing: 'none', tauLo: 20, tauHi: 28, pmin: 18, pmax: 32 },
		{
			cond: 'random20',
			wave: 'cosine',
			missing: 'random20',
			tauLo: 20,
			tauHi: 28,
			pmin: 18,
			pmax: 32
		},
		{ cond: 'gap25', wave: 'cosine', missing: 'gap25', tauLo: 20, tauHi: 28, pmin: 18, pmax: 32 }
	];
	for (const e of extra)
		for (const snr of SNRS) cells.push({ block: 'robust', dt: 0.25, days: 7, snr, ...e });
	return cells.map((c, id) => ({ id, ...c }));
}

// The Surrogate Test node (block bootstrap, 199 surrogates) is ~200x costlier than the
// other methods, so it is evaluated only on these cells.
function wantsSurrogate(c) {
	return c.block === 'main' && c.days === 7;
}

const COLS = [
	'cell',
	'block',
	'cond',
	'dt',
	'days',
	'snr',
	'rep',
	'n',
	'tau',
	'LS',
	'CHI',
	'CHI_sigPeak',
	'CHI_sigAny',
	'CHI_pPeak',
	'CHI_rel',
	'ENR',
	'COS',
	'FFTauto',
	'FFTfine',
	'COSfixTrue_p',
	'SURR_p'
];

export function runShard(shard, nShards, outDir, reps = REPS_A) {
	const lines = [COLS.join(',')];
	for (const c of cellsA()) {
		if (c.id % nShards !== shard) continue;
		for (let rep = 0; rep < reps; rep++) {
			const trng = mulberry32(seedFrom('A-tau', c.id, rep));
			const tau = c.tauLo + (c.tauHi - c.tauLo) * trng();
			const { t, y } = simulate({
				seed: seedFrom('A', c.id, rep),
				days: c.days,
				dt: c.dt,
				tau,
				amp: c.snr,
				wave: c.wave,
				missing: c.missing
			});
			const grid = { periodMin: c.pmin, periodMax: c.pmax, step: STEP, binSize: c.dt };
			const ls = periodogramPeak('Lomb-Scargle', t, y, grid);
			const chi = periodogramPeak('Chi-squared', t, y, grid);
			const enr = periodogramPeak('Enright', t, y, grid);
			const cos = cosinorFree(t, y, c.pmin, c.pmax);
			const fa = fftPeak(t, y, null);
			const ff = fftPeak(t, y, 0.0001);
			const pFix = cosinorFixedP(t, y, tau);
			const surr = wantsSurrogate(c)
				? surrogateBlockP(t, y, { seed: seedFrom('A-surr', c.id, rep) })
				: '';
			const row = [
				c.id,
				c.block,
				c.cond,
				c.dt,
				c.days,
				c.snr,
				rep,
				t.length,
				tau,
				ls.period,
				chi.period,
				chi.sigPeak,
				chi.sigAny,
				chi.pPeak,
				chi.periodRel,
				enr.period,
				cos.period,
				fa.period,
				ff.period,
				pFix,
				surr
			];
			lines.push(row.join(','));
		}
	}
	fs.mkdirSync(outDir, { recursive: true });
	fs.writeFileSync(path.join(outDir, `A_shard${shard}.csv`), lines.join('\n') + '\n');
	return lines.length - 1;
}
