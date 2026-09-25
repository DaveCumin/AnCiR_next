// Summarise results/browser-e2e.json into results/browser-e2e.md (median over reps).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const name = process.argv[2] ?? 'browser-e2e';
const file = path.resolve(here, `../../results/${name}.json`);
const { meta, results } = JSON.parse(fs.readFileSync(file, 'utf8'));

const med = (xs) => {
	const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
	return v.length ? v[Math.floor((v.length - 1) / 2)] : null;
};
const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const fmt = (ms) => (ms == null ? '' : ms >= 1000 ? (ms / 1000).toFixed(2) + ' s' : Math.round(ms) + ' ms');
const fmtN = (n) => (n >= 1e6 ? n / 1e6 + 'M' : n / 1e3 + 'k');

const groups = {};
for (const r of results) (groups[`${r.case}|${r.N}`] ??= []).push(r);

const sections = [
	[
		'import-raw',
		'CSV import, binning switched OFF (raw rows kept)',
		[
			['preview_ms', 'file chosen -> preview ready'],
			['confirm_to_settled_ms', 'Confirm -> UI settled'],
			['total_file_to_settled_ms', 'total (file -> settled)'],
			['import_longtasks.max_ms', 'longest main-thread block'],
			['import_longtasks.tbt_ms', 'total blocking time'],
			['heap_settled_mb', 'JS heap after (MB)']
		]
	],
	[
		'import-binned',
		'CSV import, default binning (15 min; offered only above 15,000 rows)',
		[
			['preview_ms', 'file chosen -> preview ready'],
			['confirm_to_settled_ms', 'Confirm -> UI settled'],
			['total_file_to_settled_ms', 'total (file -> settled)'],
			['import_longtasks.max_ms', 'longest main-thread block'],
			['heap_settled_mb', 'JS heap after (MB)']
		]
	],
	[
		'dataonly',
		'Session load, data only (no plot) - baseline',
		[
			['file_to_settled_ms', 'file -> settled'],
			['longtasks.max_ms', 'longest main-thread block'],
			['heap_settled_mb', 'JS heap after (MB)']
		]
	],
	[
		'actogram',
		'Session load with one Actogram (bars, canvas node preview)',
		[
			['file_to_settled_ms', 'file -> actogram drawn & settled'],
			['longtasks.max_ms', 'longest main-thread block'],
			['update_to_settled_ms', 'change Period 24 -> 24.5 -> settled'],
			['update_longtasks.max_ms', 'longest block during update'],
			['heap_settled_mb', 'JS heap after (MB)']
		]
	],
	[
		'periodogram',
		'Session load with one Lomb-Scargle Periodogram (1-30 h, step 0.25 h)',
		[
			['file_to_settled_ms', 'file -> periodogram drawn & settled'],
			['longtasks.max_ms', 'longest main-thread block'],
			['update_to_settled_ms', 'change Period Step 0.25 -> 0.2 -> settled'],
			['update_longtasks.max_ms', 'longest block during update'],
			['heap_settled_mb', 'JS heap after (MB)']
		]
	]
];

let md = `# Browser end-to-end benchmark (median of reps)\n\n`;
md += `Chromium ${meta.chromium} (Playwright ${meta.playwright}, headless), ${meta.cpu}, ${meta.totalmem_gb} GB. Production build via \`vite preview\`. ${meta.date}. "Settled" = last DOM mutation/long task before a ${meta.quiet_ms} ms quiet window.\n\n`;
for (const [c, title, metrics] of sections) {
	const Ns = [...new Set(results.filter((r) => r.case === c).map((r) => r.N))].sort((a, b) => a - b);
	if (!Ns.length) continue;
	md += `## ${title}\n\n| metric | ${Ns.map(fmtN).join(' | ')} |\n|---|${Ns.map(() => '---:').join('|')}|\n`;
	for (const [key, label] of metrics) {
		const cells = Ns.map((N) => {
			const g = groups[`${c}|${N}`] ?? [];
			const ok = g.filter((r) => r.ok);
			if (!ok.length) return g.some((r) => r.crashed) ? 'CRASH' : 'FAIL';
			const v = med(ok.map((r) => get(r, key)));
			return key.endsWith('_mb') ? String(v ?? '') : fmt(v);
		});
		md += `| ${label} | ${cells.join(' | ')} |\n`;
	}
	md += `| reps ok / run | ${Ns.map((N) => {
		const g = groups[`${c}|${N}`] ?? [];
		return `${g.filter((r) => r.ok).length}/${g.length}`;
	}).join(' | ')} |\n\n`;
	const fails = results.filter((r) => r.case === c && !r.ok);
	for (const f of fails) md += `- FAIL N=${f.N} rep ${f.rep}: ${f.error}${f.crashed ? ' (tab crashed)' : ''}\n`;
	if (fails.length) md += '\n';
}
fs.writeFileSync(file.replace(/\.json$/, '.md'), md);
console.log(md);
