// Orchestrates the engine-level scaling benchmark.
//   node tools/benchmarks/paper/scaling/run-engine.mjs [--methods a,b] [--sizes 1000,10000]
// Each (method, N) runs in a fresh `node --expose-gc` child process so memory
// and JIT state do not leak between measurements. Methods are stopped once a
// single repetition exceeds STOP_MS (~120 s) or the child fails/times out.
// Writes results/engine-scaling.json and results/engine-scaling.md.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../..');
const resultsDir = path.resolve(here, '../results');
const bundle = path.join(here, '.cache/engine.bundle.mjs');

const ALL_METHODS = [
	'csv_parse_1',
	'csv_parse_10',
	'time_guess',
	'time_parse',
	'bin_import_15min',
	'bin_numeric_15min',
	'lomb_scargle',
	'chi_squared',
	'enright',
	'cosinor_free',
	'cosinor_fixed',
	'fft',
	'fft_auto',
	'smooth_whittaker',
	'npcra',
	'cwt'
];
const ALL_SIZES = [1e3, 1e4, 2e4, 5e4, 1e5, 2.5e5, 5e5, 1e6];
const STOP_MS = 120_000;
const CHILD_TIMEOUT_MS = 400_000;

const arg = (name) => {
	const i = process.argv.indexOf(name);
	return i > 0 ? process.argv[i + 1] : null;
};
const methods = arg('--methods') ? arg('--methods').split(',') : ALL_METHODS;
const sizes = arg('--sizes') ? arg('--sizes').split(',').map(Number) : ALL_SIZES;
const outName = arg('--out') ?? 'engine-scaling';

spawnSync(process.execPath, [path.join(here, 'build-engine.mjs')], { stdio: 'inherit', cwd: repo });

const results = [];
for (const m of methods) {
	for (const N of sizes) {
		const t0 = Date.now();
		const r = spawnSync(process.execPath, ['--expose-gc', bundle, m, String(N), '3'], {
			cwd: repo,
			encoding: 'utf8',
			timeout: CHILD_TIMEOUT_MS,
			maxBuffer: 64 * 1024 * 1024
		});
		let rec;
		const line = (r.stdout || '').trim().split('\n').filter((l) => l.startsWith('{')).pop();
		if (line) rec = JSON.parse(line);
		else
			rec = {
				ok: false,
				method: m,
				N,
				error:
					(r.error ? String(r.error) : '') +
					` exit=${r.status} signal=${r.signal} ` +
					(r.stderr || '').split('\n').filter(Boolean).slice(-4).join(' | ')
			};
		rec.wall_s = Math.round((Date.now() - t0) / 100) / 10;
		results.push(rec);
		console.log(
			rec.ok
				? `${m.padEnd(18)} N=${String(N).padStart(8)}  median ${rec.median_ms} ms (reps ${rec.reps})  maxRSS ${rec.max_rss_mb} MB`
				: `${m.padEnd(18)} N=${String(N).padStart(8)}  FAILED: ${rec.error?.slice(0, 200)}`
		);
		if (!rec.ok || Math.max(...(rec.times_ms ?? [0])) > STOP_MS) {
			console.log(`  -> stopping ${m} after N=${N}`);
			break;
		}
	}
}

const meta = {
	date: new Date().toISOString(),
	node: process.version,
	v8: process.versions.v8,
	cpu: os.cpus()[0]?.model,
	cores: os.cpus().length,
	totalmem_gb: Math.round(os.totalmem() / 2 ** 30),
	platform: `${os.platform()} ${os.release()}`,
	appVersion: JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version
};
fs.mkdirSync(resultsDir, { recursive: true });
fs.writeFileSync(path.join(resultsDir, `${outName}.json`), JSON.stringify({ meta, results }, null, 2));

// Markdown table: rows = method, cols = N, cell = median ms
const fmtN = (n) => (n >= 1e6 ? n / 1e6 + 'M' : n >= 1e3 ? n / 1e3 + 'k' : String(n));
const usedSizes = [...new Set(results.map((r) => r.N))].sort((a, b) => a - b);
let md = `# Engine scaling (median ms of up to 3 reps; one process per cell)\n\n`;
md += `Node ${meta.node} (V8 ${meta.v8}), ${meta.cpu}, ${meta.cores} cores, ${meta.totalmem_gb} GB, ${meta.platform}, AnCiR v${meta.appVersion}, ${meta.date}\n\n`;
md += `| method | ${usedSizes.map(fmtN).join(' | ')} |\n|---|${usedSizes.map(() => '---:').join('|')}|\n`;
for (const m of methods) {
	const cells = usedSizes.map((N) => {
		const r = results.find((x) => x.method === m && x.N === N);
		if (!r) return '';
		if (!r.ok) return 'FAIL';
		const v = r.median_ms >= 1000 ? (r.median_ms / 1000).toFixed(2) + ' s' : r.median_ms.toFixed(1);
		return r.reps < 3 ? v + '†' : v;
	});
	md += `| ${m} | ${cells.join(' | ')} |\n`;
}
md += `\n† fewer than 3 repetitions (a single rep exceeded 30 s).\n\n## Peak RSS (MB, whole process incl. input data)\n\n`;
md += `| method | ${usedSizes.map(fmtN).join(' | ')} |\n|---|${usedSizes.map(() => '---:').join('|')}|\n`;
for (const m of methods) {
	const cells = usedSizes.map((N) => {
		const r = results.find((x) => x.method === m && x.N === N);
		return !r ? '' : r.ok ? String(r.max_rss_mb) : 'FAIL';
	});
	md += `| ${m} | ${cells.join(' | ')} |\n`;
}
const fails = results.filter((r) => !r.ok);
if (fails.length) {
	md += `\n## Failures\n\n`;
	for (const f of fails) md += `- ${f.method} N=${f.N}: ${String(f.error).replace(/\n/g, ' ').slice(0, 400)}\n`;
}
fs.writeFileSync(path.join(resultsDir, `${outName}.md`), md);
console.log('wrote', path.join(resultsDir, `${outName}.{json,md}`));
