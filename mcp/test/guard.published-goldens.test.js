// Real-data regression goldens: published datasets whose published results AnCiR reproduces,
// run through the headless engine (run_table_process), with the published numbers pinned at
// the tolerance the reproduction achieved. The data, their licences and where each pinned number
// comes from are in src/test/fixtures/published/ (one README per dataset).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { AncirSession, ensureRegistry } from '../src/engine/session.js';

const DIR = join(import.meta.dirname, '..', '..', 'src', 'test', 'fixtures', 'published');

beforeAll(async () => {
	await ensureRegistry();
}, 120000);

/** A CSV with a header row, as { column: string[] }. No quoting in these files. */
function readCsv(file) {
	const [head, ...rows] = readFileSync(join(DIR, file), 'utf8').trim().split(/\r?\n/);
	const cols = head.split(',');
	const out = Object.fromEntries(cols.map((c) => [c, []]));
	for (const r of rows) r.split(',').forEach((v, i) => out[cols[i]].push(v));
	return out;
}
const num = (a) => a.map((v) => (v === '' || v === 'NA' ? null : Number(v)));
const relDiff = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

describe('Moškon 2020 (CosinorPy): fixed-period cosinor, replicates pooled', () => {
	const data = readCsv('moskon2020-cosinorpy/paper_data_long.csv');
	const table1 = readCsv('moskon2020-cosinorpy/supp_table_1.csv');
	const table2 = readCsv('moskon2020-cosinorpy/supp_table_2.csv');
	const TESTS = ['test1', 'test2', 'test3', 'test4'];

	async function fit(test, nHarmonics) {
		const s = new AncirSession(`cosinorpy-${test}-${nHarmonics}`);
		s.importColumns([
			{ name: 'time_h', values: num(data.time_h) },
			{ name: test, values: num(data[test]) }
		]);
		const r = await s.runTableProcess('Cosinor', {
			xIN: 'time_h',
			yIN: [test],
			useFixedPeriod: true,
			fixedPeriod: 24,
			nHarmonics
		});
		expect(r.valid, r.error).toBe(true);
		const value = (key) => s.getColumnData(r.outputs.find((o) => o.key === key).columnId)[0];
		return { r, value };
	}

	it.each(TESTS)('%s, 1 component: Supplementary Table 2 (p, amplitude, peak time)', async (t) => {
		const row = table2.test.indexOf(t);
		const { value } = await fit(t, 1);
		expect(relDiff(value('pvalue'), Number(table2.p[row]))).toBeLessThan(1e-6);
		expect(relDiff(value('amplitude'), Number(table2.amplitude[row]))).toBeLessThan(1e-9);
		const peak = ((Number(table2['acrophase[h]'][row]) % 24) + 24) % 24;
		expect(Math.abs(value('acrophase') - peak)).toBeLessThan(1e-6);
	});

	for (const H of [1, 2, 3]) {
		it.each(TESTS)(`%s, ${H} component(s): Supplementary Table 1 (R², amplitude)`, async (t) => {
			const row = table1.test.findIndex((x, i) => x === t && Number(table1.n_components[i]) === H);
			expect(row).toBeGreaterThanOrEqual(0);
			const { r, value } = await fit(t, H);
			const r2 = Object.values(r.fit)[0].rSquared;
			expect(Math.abs(r2 - Number(table1.R2[row]))).toBeLessThan(1e-9);
			// CosinorPy finds a multi-component amplitude on a time grid; AnCiR analytically.
			expect(relDiff(value('amplitude'), Number(table1.amplitude[row]))).toBeLessThan(1e-4);
		});
	}
});

describe('Goh et al. 2024: sheep body temperature, Lomb-Scargle periodogram', () => {
	// The AnCiR peak of each animal (4 to 36 h in 0.1 h steps): the published finding is the one
	// sheep at 12 h (Sheep 7) with every other near 24 h; each value is pinned as a golden.
	const PEAKS = {
		Sheep_1: 24.2,
		Sheep_2: 24,
		Sheep_3: 23.2,
		Sheep_4: 25,
		Sheep_5: 23.5,
		Sheep_6: 25.2,
		Sheep_7: 12,
		Sheep_8: 23.6,
		Sheep_9: 24.7,
		Sheep_10: 23.9,
		Sheep_11: 23.5,
		Sheep_12: 24.2
	};

	it('one sheep peaks at 12 h, every other near 24 h (paper p. 5, Figure 2)', async () => {
		const d = readCsv('goh2024-sheep/Tc_Sheep.csv');
		const animals = Object.keys(d).filter((k) => k !== 'time_h');
		const s = new AncirSession('goh-sheep');
		s.importColumns([
			{ name: 'time_h', values: num(d.time_h) },
			...animals.map((a) => ({ name: a, values: num(d[a]) }))
		]);
		const r = await s.runTableProcess('RhythmicityAnalysis', {
			xIN: 'time_h',
			yIN: animals,
			analysis: 'periodogram',
			pgMethod: 'Lomb-Scargle',
			periodMin: 4,
			periodMax: 36,
			periodStep: 0.1
		});
		expect(r.valid, r.error).toBe(true);
		const peaks = s.getColumnData(r.outputs.find((o) => o.key === 'stat_peak_period').columnId);
		const got = Object.fromEntries(animals.map((a, i) => [a, Math.round(peaks[i] * 10) / 10]));
		expect(got).toEqual(PEAKS);
		const twelve = animals.filter((a) => Math.abs(got[a] - 12) <= 0.5);
		expect(twelve).toEqual(['Sheep_7']);
		for (const a of animals.filter((x) => x !== 'Sheep_7')) {
			expect(got[a], a).toBeGreaterThanOrEqual(22.6);
			expect(got[a], a).toBeLessThanOrEqual(25.2);
		}
	}, 60000);
});
