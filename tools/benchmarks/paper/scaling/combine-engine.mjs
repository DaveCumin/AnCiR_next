// Combine two (or more) engine runs into one table showing the per-run medians as a
// range, so run-to-run variance is visible.
//   node tools/benchmarks/paper/scaling/combine-engine.mjs engine-scaling engine-scaling-run2
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const resultsDir = path.resolve(here, '../results');
const names = process.argv.slice(2);
const runs = names.map((n) => JSON.parse(fs.readFileSync(path.join(resultsDir, n + '.json'), 'utf8')));

const fmt = (ms) => (ms >= 1000 ? (ms / 1000).toFixed(2) + ' s' : ms >= 10 ? ms.toFixed(0) : ms.toFixed(1));
const fmtN = (n) => (n >= 1e6 ? n / 1e6 + 'M' : n >= 1e3 ? n / 1e3 + 'k' : String(n));
const methods = [...new Set(runs.flatMap((r) => r.results.map((x) => x.method)))];
const sizes = [...new Set(runs.flatMap((r) => r.results.map((x) => x.N)))].sort((a, b) => a - b);

let md = `# Engine scaling, ${runs.length} independent runs (cell = range of per-run medians, ms unless marked s)\n\n`;
for (const [i, r] of runs.entries()) md += `- run ${i + 1} (${names[i]}): ${r.meta.date}, Node ${r.meta.node}, V8 ${r.meta.v8}, ${r.meta.cpu}\n`;
md += `\n| method | ${sizes.map(fmtN).join(' | ')} |\n|---|${sizes.map(() => '---:').join('|')}|\n`;
for (const m of methods) {
	const cells = sizes.map((N) => {
		const recs = runs.map((r) => r.results.find((x) => x.method === m && x.N === N)).filter(Boolean);
		if (!recs.length) return '';
		if (recs.some((x) => !x.ok)) return 'FAIL';
		const v = recs.map((x) => x.median_ms).sort((a, b) => a - b);
		const lo = v[0];
		const hi = v[v.length - 1];
		return hi / lo < 1.15 ? fmt((lo + hi) / 2) : `${fmt(lo)}–${fmt(hi)}`;
	});
	md += `| ${m} | ${cells.join(' | ')} |\n`;
}
md += `\nPeak RSS (MB, max over runs):\n\n| method | ${sizes.map(fmtN).join(' | ')} |\n|---|${sizes.map(() => '---:').join('|')}|\n`;
for (const m of methods) {
	const cells = sizes.map((N) => {
		const recs = runs.map((r) => r.results.find((x) => x.method === m && x.N === N)).filter((x) => x?.ok);
		return recs.length ? String(Math.max(...recs.map((x) => x.max_rss_mb))) : '';
	});
	md += `| ${m} | ${cells.join(' | ')} |\n`;
}
const out = path.join(resultsDir, 'engine-scaling-combined.md');
fs.writeFileSync(out, md);
console.log(md);
