/**
 * The export's remaining plot features in RUNNING scripts: the FFT's phase, 'auto' and outside
 * legends (with Colour by keys), the actogram's light bar, phase markers, annotations and
 * single-image rows, and the wavelet scalogram. The sessions are the demos of
 * tools/parity/plot_extras_app.json (src/lib/_parity/emitPlotExtras.svelte.test.js) carrying
 * each case's plot as the app saves it, with the colours the app resolved travelling the way
 * the app's export sends them (`session.seriesColours`, keyed by plot id). What each figure
 * draws is checked against the app in tools/test_plot_fft_phase.py, test_plot_legend_auto.py,
 * test_plot_actogram_extras.py and test_plot_cwt.py.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sessionToPythonFiles } from './pythonExport.js';

const ROOT = process.cwd();
const PYTHON = join(ROOT, 'tools', '.venv', 'bin', 'python');
const PY_RUNTIME = readFileSync(join(ROOT, 'tools', 'ancir_runtime.py'), 'utf8');
const FIXTURE = JSON.parse(
	readFileSync(join(ROOT, 'tools', 'parity', 'plot_extras_app.json'), 'utf8')
);

const demo = (id) =>
	JSON.parse(readFileSync(join(ROOT, 'static', 'sessions', 'demos', `${id}.json`), 'utf8'));

// One session per demo, carrying every case's plot for that demo under a fresh id.
const GROUPS = new Map();
for (const c of FIXTURE.cases) {
	if (!GROUPS.has(c.demo)) GROUPS.set(c.demo, { demo: c.demo, plots: [], seriesColours: {} });
	const g = GROUPS.get(c.demo);
	const { seriesColours, ...plot } = structuredClone(c.plotJSON);
	plot.id = 3000 + g.plots.length;
	plot.name = `Extras ${c.name}`;
	g.plots.push(plot);
	if (seriesColours) g.seriesColours[plot.id] = seriesColours;
}

function sessionFor(g) {
	const s = demo(g.demo);
	s.plots = g.plots;
	s.seriesColours = g.seriesColours;
	return s;
}

const tempDirs = [];
afterAll(() => {
	for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

/**
 * The PLOTS the script embeds, decoded. A long embed is split into adjacent string literals
 * (pythonExport.js embed), so a name can straddle two of them: searching the raw text
 * failed as soon as a new fixture case moved a chunk boundary onto a plot name.
 */
function embeddedPlots(text) {
	const m = /\nPLOTS = json\.loads\(([\s\S]*?)\)\n/.exec(text);
	expect(m, 'PLOTS embed').toBeTruthy();
	const literals = m[1].trim().split(/\n\s*/);
	return JSON.parse(literals.map((l) => JSON.parse(l)).join(''));
}

describe('the Python export carries the plots these features live on', () => {
	it('every case plot, with its settings, reaches the script', () => {
		for (const g of GROUPS.values()) {
			const [file] = sessionToPythonFiles(sessionFor(g), PY_RUNTIME);
			const names = embeddedPlots(file.text).map((p) => p.name);
			for (const p of g.plots) expect(names).toContain(p.name);
		}
		const fft = GROUPS.get('demo-fft-rhythm');
		const [file] = sessionToPythonFiles(sessionFor(fft), PY_RUNTIME);
		// The phase axis's saved manual range travels with the plot.
		expect(file.text).toContain('phaseYlimsIN');
	});
});

describe.runIf(existsSync(PYTHON))('exported extras render (tools/.venv)', () => {
	for (const g of GROUPS.values()) {
		it(`${g.demo}: the script runs and writes every plot`, () => {
			const dir = mkdtempSync(join(tmpdir(), 'ancir-extras-'));
			tempDirs.push(dir);
			for (const f of sessionToPythonFiles(sessionFor(g), PY_RUNTIME)) {
				writeFileSync(join(dir, f.name), f.text);
			}
			const res = spawnSync(PYTHON, ['session.py'], {
				cwd: dir,
				encoding: 'utf8',
				timeout: 240_000,
				env: { ...process.env, MPLBACKEND: 'Agg' }
			});
			expect(res.status, `stderr:\n${res.stderr}`).toBe(0);
			expect(res.stdout).not.toContain('[ancir-plot] error');
			expect(res.stdout).not.toContain('[ancir-plotdata] error');
			const pngs = readdirSync(join(dir, 'session_output')).filter((f) => f.endsWith('.png'));
			for (const plot of g.plots) {
				expect(
					pngs.some((f) => f.startsWith(`plot_${plot.id}_`)),
					`plot ${plot.id} (${plot.name})`
				).toBe(true);
			}
		}, 300_000);
	}
});
