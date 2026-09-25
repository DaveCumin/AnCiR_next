// Generate the browser-benchmark inputs into ../.data/:
//   csv-<N>.csv                 DateTime (YYYY-MM-DD HH:mm:ss, 1-min) + activity
//   session-actogram-<N>.json   AnCiR session: numeric hour + activity columns, one Actogram
//   session-periodogram-<N>.json  same data, one Lomb-Scargle Periodogram (app defaults)
//   session-dataonly-<N>.json   same data, no plot (baseline for session-load cost)
// Sessions are built from the shipped demo sessions (static/sessions/demos/demo-*-rhythm.json)
// with only the raw data arrays replaced, so the plot configs are the app's own.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCsv, generateSeries } from '../gen-data.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../..');
const out = path.resolve(here, '../.data');
fs.mkdirSync(out, { recursive: true });

const sizes = (process.argv[2] ?? '10000,20000,100000,250000,500000,1000000').split(',').map(Number);

function buildSession(templateFile, n) {
	const s = JSON.parse(fs.readFileSync(path.join(repo, 'static/sessions/demos', templateFile), 'utf8'));
	const [xId, yId] = s.data.map((c) => String(c.data));
	const { tHours, ys } = generateSeries(n);
	// Round to keep the JSON a realistic size (3 dp activity, 6 dp hours).
	s.rawData = {
		[xId]: Array.from(tHours, (v) => Math.round(v * 1e6) / 1e6),
		[yId]: Array.from(ys[0], (v) => Math.round(v * 1e3) / 1e3)
	};
	s.notes = [];
	for (const k of Object.keys(s.nodeLayout)) if (k.startsWith('note_')) delete s.nodeLayout[k];
	return JSON.stringify(s);
}

for (const n of sizes) {
	const csvPath = path.join(out, `csv-${n}.csv`);
	if (!fs.existsSync(csvPath)) fs.writeFileSync(csvPath, generateCsv(n));
	for (const [kind, tpl] of [
		['actogram', 'demo-actogram-rhythm.json'],
		['periodogram', 'demo-periodogram-rhythm.json']
	]) {
		const p = path.join(out, `session-${kind}-${n}.json`);
		if (!fs.existsSync(p)) fs.writeFileSync(p, buildSession(tpl, n));
	}
	// Baseline: same data, no plot (to separate session-load cost from plot cost).
	const pd = path.join(out, `session-dataonly-${n}.json`);
	if (!fs.existsSync(pd)) {
		const s = JSON.parse(buildSession('demo-actogram-rhythm.json', n));
		for (const pl of s.plots) delete s.nodeLayout[`plot_${pl.id}`];
		s.plots = [];
		fs.writeFileSync(pd, JSON.stringify(s));
	}
	const sz = (f) => (fs.statSync(path.join(out, f)).size / 1048576).toFixed(1) + ' MB';
	console.log(n, 'csv', sz(`csv-${n}.csv`), 'actogram', sz(`session-actogram-${n}.json`));
}
