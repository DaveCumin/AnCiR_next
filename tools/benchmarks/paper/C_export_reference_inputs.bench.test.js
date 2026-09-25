// Study C, step 1: generate seeded inputs, run AnCiR's engine on them, and export
// BOTH the inputs and AnCiR's outputs to JSON, so the Python (astropy / scipy /
// statsmodels / own Sokolove-Bushell) and R (nparACT) references read byte-identical
// inputs. Gated: RUN_PAPER_BENCH=1.
//
// Output: results/accuracy/C_inputs_and_ancir.json
import { describe, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { simulate, seedFrom, mulberry32 } from './lib/sim.js';
import { runPeriodogramCalculation } from '$lib/utils/periodogram.js';
import { fitCosinorFixed } from '$lib/utils/cosinor.js';
import { computeNPCRA } from '$lib/utils/npcra.js';

const RUN = process.env.RUN_PAPER_BENCH === '1';
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), 'results', 'accuracy');

// Series used for the LS / chi-squared / cosinor comparisons.
const SERIES = [
	{ name: 'cos_15min_7d_snr1', days: 7, dt: 0.25, tau: 24.4, amp: 1 },
	{ name: 'cos_15min_14d_snr0.5', days: 14, dt: 0.25, tau: 23.3, amp: 0.5 },
	{ name: 'cos_60min_7d_snr1', days: 7, dt: 1, tau: 25.1, amp: 1 },
	{ name: 'cos_60min_3d_snr2', days: 3, dt: 1, tau: 22.0, amp: 2 },
	{ name: 'cos_15min_3d_snr0.25', days: 3, dt: 0.25, tau: 26.7, amp: 0.25 },
	{ name: 'square_15min_7d_snr1', days: 7, dt: 0.25, tau: 24.0, amp: 1, wave: 'square' },
	{ name: 'pulse_15min_7d_snr1', days: 7, dt: 0.25, tau: 23.6, amp: 1, wave: 'pulse' },
	{ name: 'noise_15min_7d', days: 7, dt: 0.25, tau: 24, amp: 0 },
	{ name: 'ar1_60min_14d', days: 14, dt: 1, tau: 24, amp: 0, noise: 'ar1' },
	{
		name: 'uneven_random20_15min_7d_snr1',
		days: 7,
		dt: 0.25,
		tau: 24.8,
		amp: 1,
		missing: 'random20'
	},
	{ name: 'uneven_gap25_15min_7d_snr1', days: 7, dt: 0.25, tau: 24.2, amp: 1, missing: 'gap25' },
	{ name: 'tidal_15min_7d_snr1', days: 7, dt: 0.25, tau: 12.42, amp: 1, pmin: 10, pmax: 16 }
];

// Minute-resolution synthetic actigraphy for NPCRA vs nparACT: Poisson counts with a
// 16 h active / 8 h rest pattern, day-to-day onset jitter (SD jitterH), and an
// optional fragmentation probability (random 1-min rest bouts during activity).
const NPCRA_SUBJECTS = [
	{ name: 'robust', days: 7, lamActive: 40, lamRest: 2, jitterH: 0.25, frag: 0.0 },
	{ name: 'jittery', days: 7, lamActive: 40, lamRest: 2, jitterH: 1.5, frag: 0.05 },
	{ name: 'fragmented', days: 7, lamActive: 25, lamRest: 5, jitterH: 0.5, frag: 0.3 },
	{ name: 'weak', days: 7, lamActive: 12, lamRest: 8, jitterH: 1.0, frag: 0.1 },
	{ name: 'long14', days: 14, lamActive: 30, lamRest: 3, jitterH: 0.75, frag: 0.1 },
	{ name: 'lowcount', days: 10, lamActive: 5, lamRest: 1, jitterH: 0.5, frag: 0.1 },
	{ name: 'shifted', days: 7, lamActive: 35, lamRest: 2, jitterH: 0.5, frag: 0.05, onsetH: 20 },
	{ name: 'arrhythmic', days: 7, lamActive: 10, lamRest: 10, jitterH: 0, frag: 0 }
];

function poisson(rng, lam) {
	// Knuth for small lambda; normal approximation (rounded, floored at 0) above 30.
	if (lam > 30) return Math.max(0, Math.round(lam + Math.sqrt(lam) * gauss(rng)));
	const L = Math.exp(-lam);
	let k = 0;
	let p = 1;
	do {
		k++;
		p *= rng();
	} while (p > L);
	return k - 1;
}
function gauss(rng) {
	const u = Math.max(rng(), 1e-300);
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

function simActigraphy(s, seed) {
	const rng = mulberry32(seed);
	const onsetBase = s.onsetH ?? 7; // activity onset (h after midnight); rest 8 h before it
	const n = s.days * 1440;
	const tMin = new Array(n);
	const counts = new Array(n);
	for (let d = 0; d < s.days; d++) {
		const onset = onsetBase + s.jitterH * gauss(rng);
		for (let m = 0; m < 1440; m++) {
			const i = d * 1440 + m;
			const h = m / 60;
			// active if within 16 h after onset (circular within the day)
			const since = (((h - onset) % 24) + 24) % 24;
			let active = since < 16;
			if (active && s.frag > 0 && rng() < s.frag) active = false;
			tMin[i] = i;
			counts[i] = poisson(rng, active ? s.lamActive : s.lamRest);
		}
	}
	return { tMin, counts };
}

describe.skipIf(!RUN)('C export identical inputs + AnCiR outputs', () => {
	it('exports', () => {
		const out = {
			generated_by: 'tools/benchmarks/paper/C_export_reference_inputs.bench.test.js',
			periodogram: [],
			cosinor: [],
			npcra: []
		};
		for (const s of SERIES) {
			const { t, y } = simulate({
				seed: seedFrom('C', s.name),
				days: s.days,
				dt: s.dt,
				tau: s.tau,
				amp: s.amp,
				wave: s.wave ?? 'cosine',
				noise: s.noise ?? 'white',
				missing: s.missing ?? 'none'
			});
			const grid = { periodMin: s.pmin ?? 18, periodMax: s.pmax ?? 32, periodSteps: 0.05 };
			const ls = runPeriodogramCalculation({
				method: 'Lomb-Scargle',
				xData: t,
				yData: y,
				binSize: s.dt,
				chiSquaredAlpha: 0.05,
				...grid
			});
			const chiSame = runPeriodogramCalculation({
				method: 'Chi-squared',
				xData: t,
				yData: y,
				binSize: s.dt,
				chiSquaredAlpha: 0.05,
				...grid
			});
			// Coarser bin than the sampling interval (15-min data binned to 1 h) exercises the binning path.
			const chiCoarse =
				s.dt === 0.25
					? runPeriodogramCalculation({
							method: 'Chi-squared',
							xData: t,
							yData: y,
							binSize: 1,
							chiSquaredAlpha: 0.05,
							...grid
						})
					: null;
			out.periodogram.push({
				name: s.name,
				dt: s.dt,
				t,
				y,
				grid,
				ls: { periods: ls.x, power: ls.y },
				chi: [
					{
						binSize: s.dt,
						periods: chiSame.x,
						power: chiSame.y,
						df: chiSame.df,
						threshold: chiSame.threshold,
						pvalue: chiSame.pvalue
					},
					...(chiCoarse
						? [
								{
									binSize: 1,
									periods: chiCoarse.x,
									power: chiCoarse.y,
									df: chiCoarse.df,
									threshold: chiCoarse.threshold,
									pvalue: chiCoarse.pvalue
								}
							]
						: [])
				]
			});
			for (const [period, nh] of [
				[24, 1],
				[s.tau > 0 ? s.tau : 24, 1],
				[24, 2]
			]) {
				const r = fitCosinorFixed(t, y, period, nh, 0.05);
				out.cosinor.push({
					name: s.name,
					period,
					nHarmonics: nh,
					t,
					y,
					ancir: {
						M: r.M,
						SE_M: r.SE_M,
						R2: r.R2,
						F_stat: r.F_stat,
						pF: r.pF,
						df: r.df,
						harmonics: r.harmonics.map((h) => ({
							beta: h.beta,
							gamma: h.gamma,
							amplitude: h.amplitude,
							acrophase_hrs: h.acrophase_hrs,
							SE_A: h.SE_A,
							SE_acrophase_hrs: h.SE_acrophase_hrs,
							CI_A: h.CI_A
						}))
					}
				});
			}
		}
		for (const s of NPCRA_SUBJECTS) {
			const { tMin, counts } = simActigraphy(s, seedFrom('C-npcra', s.name));
			const tH = tMin.map((m) => m / 60);
			const hourly = computeNPCRA(tH, counts, { epochHours: 1 });
			const minute = computeNPCRA(tH, counts, { epochHours: 1 / 60 });
			const pick = (r) => ({
				IS: r.IS,
				IV: r.IV,
				RA: r.RA,
				M10: r.M10,
				L5: r.L5,
				M10onset: r.M10onset,
				L5onset: r.L5onset
			});
			out.npcra.push({
				name: s.name,
				days: s.days,
				minutes: tMin,
				counts,
				ancir_epoch1h: pick(hourly),
				ancir_epoch1min: pick(minute)
			});
		}
		fs.mkdirSync(OUT, { recursive: true });
		fs.writeFileSync(path.join(OUT, 'C_inputs_and_ancir.json'), JSON.stringify(out));
		// NPCRA inputs also as CSV for R (minute index, counts), one file per subject.
		const dir = path.join(OUT, 'C_npcra_inputs');
		fs.mkdirSync(dir, { recursive: true });
		for (const s of out.npcra) {
			fs.writeFileSync(
				path.join(dir, `${s.name}.csv`),
				'minute,count\n' + s.minutes.map((m, i) => `${m},${s.counts[i]}`).join('\n') + '\n'
			);
		}
	});
});
