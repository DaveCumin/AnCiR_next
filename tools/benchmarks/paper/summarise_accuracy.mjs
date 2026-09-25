// Summarise the raw per-replicate CSVs of studies A and B into metric tables.
// Plain Node (no AnCiR imports). Run from the repo root:
//   node tools/benchmarks/paper/summarise_accuracy.mjs
// Writes results/accuracy/A_summary.csv, A_detection.csv, B_summary.csv, summary.json
// and prints compact tables to stdout.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const RES = path.join(here, 'results', 'accuracy');
const RAW = path.join(RES, 'raw');

function readShards(prefix) {
	const rows = [];
	for (const f of fs
		.readdirSync(RAW)
		.filter((f) => f.startsWith(prefix))
		.sort()) {
		const [head, ...lines] = fs.readFileSync(path.join(RAW, f), 'utf8').trim().split('\n');
		const cols = head.split(',');
		for (const l of lines) {
			const v = l.split(',');
			const o = {};
			cols.forEach((c, i) => (o[c] = v[i]));
			rows.push(o);
		}
	}
	return rows;
}

const num = (s) => (s === '' || s === undefined || s === 'null' ? NaN : Number(s));
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const median = (a) => {
	const s = [...a].sort((x, y) => x - y);
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/** Wilson 95% interval for a proportion. */
function wilson(k, n) {
	if (n === 0) return [NaN, NaN];
	const z = 1.959963984540054;
	const p = k / n;
	const d = 1 + (z * z) / n;
	const c = (p + (z * z) / (2 * n)) / d;
	const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
	return [c - h, c + h];
}
const r = (x, d = 3) => (Number.isFinite(x) ? Number(x.toFixed(d)) : null);

const METHODS = [
	['LS', 'Lomb-Scargle'],
	['CHI', 'Chi-squared (Sokolove-Bushell)'],
	['CHI_rel', 'Chi-squared, arg-max of Qp/threshold (sensitivity variant)'],
	['ENR', 'Enright'],
	['COS', 'Cosinor (free period)'],
	['FFTauto', 'FFT (auto resolution)'],
	['FFTfine', 'FFT (0.0001 cyc/h)']
];

// ---------- A ----------
const A = readShards('A_shard');
const cellKey = (o) => `${o.cell}`;
const byCell = new Map();
for (const o of A) {
	if (!byCell.has(cellKey(o))) byCell.set(cellKey(o), []);
	byCell.get(cellKey(o)).push(o);
}
const cellIds = [...byCell.keys()].sort((a, b) => Number(a) - Number(b));

const aRows = [];
const dRows = [];
for (const id of cellIds) {
	const rows = byCell.get(id);
	const c = rows[0];
	for (const [m, label] of METHODS) {
		const errs = [];
		let nValid = 0;
		for (const o of rows) {
			const est = num(o[m]);
			if (Number.isFinite(est)) {
				nValid++;
				errs.push(est - num(o.tau));
			}
		}
		const abs = errs.map(Math.abs);
		aRows.push({
			cell: Number(id),
			block: c.block,
			cond: c.cond,
			dt: num(c.dt),
			days: num(c.days),
			snr: num(c.snr),
			method: m,
			method_label: label,
			n: rows.length,
			n_valid: nValid,
			bias_h: r(mean(errs)),
			MAE_h: r(mean(abs)),
			RMSE_h: r(Math.sqrt(mean(errs.map((e) => e * e)))),
			MedAE_h: r(median(abs)),
			pct_within_0_25h: r((100 * abs.filter((e) => e <= 0.25).length) / rows.length, 1),
			pct_within_0_5h: r((100 * abs.filter((e) => e <= 0.5).length) / rows.length, 1)
		});
	}
	const rate = (col) => {
		const v = rows.map((o) => num(o[col])).filter(Number.isFinite);
		return v.length ? { n: v.length, k: v.filter((x) => x === 1).length } : null;
	};
	const rateP = (col) => {
		const v = rows.map((o) => num(o[col])).filter(Number.isFinite);
		return v.length ? { n: v.length, k: v.filter((x) => x < 0.05).length } : null;
	};
	const pct = (x) => (x ? r((100 * x.k) / x.n, 1) : null);
	const chiAny = rate('CHI_sigAny');
	const chiPeak = rate('CHI_sigPeak');
	const cosFix = rateP('COSfixTrue_p');
	const surr = rateP('SURR_p');
	dRows.push({
		cell: Number(id),
		block: c.block,
		cond: c.cond,
		dt: num(c.dt),
		days: num(c.days),
		snr: num(c.snr),
		n: rows.length,
		CHI_any_pct: pct(chiAny),
		CHI_peak_pct: pct(chiPeak),
		COSfixed_trueTau_pct: pct(cosFix),
		SURR_block_pct: pct(surr),
		SURR_n: surr ? surr.n : 0
	});
}

// ---------- B ----------
const B = readShards('B_shard');
const bByCell = new Map();
for (const o of B) {
	if (!bByCell.has(o.cell)) bByCell.set(o.cell, []);
	bByCell.get(o.cell).push(o);
}
const bRows = [];
for (const id of [...bByCell.keys()].sort((a, b) => Number(a) - Number(b))) {
	const rows = bByCell.get(id);
	const c = rows[0];
	const one = (col, isP) => {
		const v = rows.map((o) => num(o[col])).filter(Number.isFinite);
		const k = v.filter((x) => (isP ? x < 0.05 : x === 1)).length;
		const [lo, hi] = wilson(k, v.length);
		return { n: v.length, pct: r((100 * k) / v.length, 1), lo: r(100 * lo, 1), hi: r(100 * hi, 1) };
	};
	const chiAny = one('CHI_sigAny');
	const chiPeak = one('CHI_sigPeak');
	const cos = one('COS24_p', true);
	const surr = one('SURR_p', true);
	bRows.push({
		cell: Number(id),
		noise: c.noise,
		dt: num(c.dt),
		days: num(c.days),
		n: rows.length,
		CHI_any_pct: chiAny.pct,
		CHI_any_CI: `${chiAny.lo}-${chiAny.hi}`,
		CHI_peak_pct: chiPeak.pct,
		CHI_peak_CI: `${chiPeak.lo}-${chiPeak.hi}`,
		COS24_pct: cos.pct,
		COS24_CI: `${cos.lo}-${cos.hi}`,
		SURR_n: surr.n,
		SURR_pct: surr.n ? surr.pct : null,
		SURR_CI: surr.n ? `${surr.lo}-${surr.hi}` : ''
	});
}

function writeCsv(file, rows) {
	const cols = Object.keys(rows[0]);
	const esc = (v) =>
		v === null || v === undefined ? '' : String(v).includes(',') ? `"${v}"` : String(v);
	fs.writeFileSync(
		path.join(RES, file),
		[cols.join(','), ...rows.map((o) => cols.map((c) => esc(o[c])).join(','))].join('\n') + '\n'
	);
}
writeCsv('A_summary.csv', aRows);
writeCsv('A_detection.csv', dRows);
writeCsv('B_summary.csv', bRows);
fs.writeFileSync(
	path.join(RES, 'summary.json'),
	JSON.stringify({ A_accuracy: aRows, A_detection: dRows, B_false_positive: bRows }, null, 1)
);

// ---------- stdout tables ----------
const pad = (s, w) => String(s ?? '').padStart(w);
console.log('\nA: period recovery. Cell | method | bias | MAE | RMSE | MedAE | %<=0.25h | %<=0.5h');
for (const o of aRows)
	console.log(
		[o.block, o.cond, `dt=${o.dt}`, `${o.days}d`, `snr=${o.snr}`].join(' ').padEnd(38),
		o.method.padEnd(8),
		pad(o.bias_h, 8),
		pad(o.MAE_h, 8),
		pad(o.RMSE_h, 8),
		pad(o.MedAE_h, 8),
		pad(o.pct_within_0_25h, 6),
		pad(o.pct_within_0_5h, 6),
		o.n_valid < o.n ? ` (valid ${o.n_valid}/${o.n})` : ''
	);
console.log('\nA: detection (% significant at alpha = 0.05)');
for (const o of dRows)
	console.log(
		[o.block, o.cond, `dt=${o.dt}`, `${o.days}d`, `snr=${o.snr}`].join(' ').padEnd(38),
		'CHIany',
		pad(o.CHI_any_pct, 6),
		'CHIpeak',
		pad(o.CHI_peak_pct, 6),
		'COSfix(tau)',
		pad(o.COSfixed_trueTau_pct, 6),
		'SURR',
		pad(o.SURR_block_pct, 6)
	);
console.log('\nB: false-positive rate (% significant at alpha = 0.05, Wilson 95% CI)');
for (const o of bRows) console.log(JSON.stringify(o));
