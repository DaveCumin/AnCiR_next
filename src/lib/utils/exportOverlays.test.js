/**
 * Plot overlays through the exported scripts (overlays plan 2026-10-15, step 5).
 *
 * The Python export embeds each plot's saved JSON whole (`PLOTS`), so overlays reach the
 * runtime's `_draw_overlays` without any generator change; these tests pin that and run the
 * scripts for real on ONE session with overlays on every plot type the Python runtime
 * renders (scatterplot, periodogram, correlogram, FFT in period AND frequency mode,
 * boxplot). What each plot draws is pinned in tools/test_plot_overlays.py; here the
 * script must run, write one PNG per plot and report no rendering error.
 *
 * The R runtime renders no plots: an R export of the same session must still run.
 *
 * Skipped, loudly (exportScriptExecution.test.js reports it), where an interpreter is missing.
 */
import { describe, it, expect, afterAll } from 'vitest';
import {
	readFileSync,
	writeFileSync,
	mkdtempSync,
	existsSync,
	rmSync,
	readdirSync,
	statSync
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sessionToPythonFiles } from './pythonExport.js';
import { sessionToRFiles } from './rExport.js';

const ROOT = process.cwd();
const DEMOS = join(ROOT, 'static', 'sessions', 'demos');
const PYTHON = join(ROOT, 'tools', '.venv', 'bin', 'python');
const HAVE_PYTHON = existsSync(PYTHON);
const HAVE_R = spawnSync('Rscript', ['--version'], { encoding: 'utf8' }).status === 0;

const PY_RUNTIME = readFileSync(join(ROOT, 'tools', 'ancir_runtime.py'), 'utf8');
const R_RUNTIME = readFileSync(join(ROOT, 'tools', 'ancir_runtime.R'), 'utf8');

const demo = (sid) => JSON.parse(readFileSync(join(DEMOS, `${sid}.json`), 'utf8'));

/** An overlay as the app saves it (OverlayClass.toJSON), channels typed. */
function ov(id, kind, form, channels, extra = {}) {
	const ch = {};
	for (const [key, typed] of Object.entries(channels)) ch[key] = { columns: [], typed };
	return {
		id,
		name: `${kind} ${id}`,
		kind,
		form,
		enabled: true,
		label: '',
		colour: '#C0392B',
		strokeWidth: 1.5,
		stroke: '5, 5',
		fill: '#2C2C2C30',
		edge: false,
		edgeColour: '#2C2C2C',
		edgeWidth: 1,
		repeatEveryHours: 24,
		nightDurationHours: 12,
		startTimeHours: 0,
		useDataMin: true,
		channels: ch,
		...extra
	};
}

const ADDED = {
	scatterplot: [
		ov(20, 'band', 'vertical', { start: [5], end: [10] }, { label: 'window', edge: true }),
		ov(21, 'band', 'repeating', {}, { nightDurationHours: 6 })
	],
	periodogram: [
		ov(22, 'line', 'vertical', { at: [24] }, { label: '24 h' }),
		ov(23, 'band', 'vertical', { start: [20], end: [28] })
	],
	correlogram: [
		ov(24, 'line', 'vertical', { at: [24] }),
		ov(25, 'band', 'horizontal', { lower: [-0.2], upper: [0.2] })
	],
	fft: [
		ov(26, 'line', 'vertical', { at: [24] }, { label: '24 h' }),
		ov(27, 'line', 'horizontal', { at: [5] })
	],
	boxplot: [
		ov(28, 'line', 'horizontal', { at: [40] }, { label: 'target' }),
		ov(29, 'band', 'horizontal', { lower: [10], upper: [20] })
	]
};

/**
 * demo-tp-crossing (a scatterplot already carrying two overlays, one wired to the Crossing
 * node's output) merged with the periodogram, correlogram, FFT and boxplot demos (column ids
 * never collide across demos), plus a frequency-mode copy of the FFT; every plot gains
 * overlays. The Python twin is tools/test_plot_overlays.py `overlay_session`.
 */
function overlaySession() {
	const base = demo('demo-tp-crossing');
	base.plots = base.plots.filter((p) => p.type === 'scatterplot');
	for (const sid of [
		'demo-periodogram-rhythm',
		'demo-correlogram-rhythm',
		'demo-fft-rhythm',
		'demo-boxplot-by-day'
	]) {
		const s = demo(sid);
		Object.assign(base.rawData, s.rawData);
		base.data.push(...s.data);
		base.plots.push(...s.plots);
	}
	const fft = base.plots.find((p) => p.type === 'fft');
	const fftFreq = structuredClone(fft);
	fftFreq.name = 'FFT frequency';
	fftFreq.plot.showPeriod = false;
	fftFreq.plot.xlimsIN = [null, null];
	fftFreq.plot.xAxis.label = 'Frequency (cycles/h)';
	base.plots.push(fftFreq);
	base.plots.forEach((p, i) => {
		p.id = 900 + i;
		p.plot.overlays = [...(p.plot.overlays ?? []), ...structuredClone(ADDED[p.type])];
	});
	return base;
}

const tempDirs = [];
afterAll(() => {
	for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

function runExport(files, cmd, entry) {
	const dir = mkdtempSync(join(tmpdir(), 'ancir-export-overlays-'));
	tempDirs.push(dir);
	for (const f of files) writeFileSync(join(dir, f.name), f.text);
	const res = spawnSync(cmd, [entry], { cwd: dir, encoding: 'utf8', timeout: 180_000 });
	return { dir, res };
}

describe('the Python export carries plot overlays', () => {
	it('embeds every plot with its overlays unchanged', () => {
		const session = overlaySession();
		const [file] = sessionToPythonFiles(session, PY_RUNTIME, {});
		// embed() writes `PLOTS = json.loads(<JSON string literal>)`, split into several
		// adjacent literals when long; Python concatenates them.
		const m = file.text.match(/^PLOTS = json\.loads\(((?:\s*"(?:[^"\\\n]|\\.)*")+)\s*\)$/m);
		expect(m).not.toBeNull();
		const literals = m[1].match(/"(?:[^"\\\n]|\\.)*"/g);
		const plots = JSON.parse(literals.map((l) => JSON.parse(l)).join(''));
		expect(plots.map((p) => p.type)).toEqual([
			'scatterplot',
			'periodogram',
			'correlogram',
			'fft',
			'boxplot',
			'fft'
		]);
		plots.forEach((p, i) => expect(p.plot.overlays).toEqual(session.plots[i].plot.overlays));
	});
});

describe.runIf(HAVE_PYTHON)('an exported Python script draws plots with overlays', () => {
	it('runs, writes one PNG per plot and reports no rendering error', () => {
		const session = overlaySession();
		const files = sessionToPythonFiles(session, PY_RUNTIME, {});
		const { dir, res } = runExport(files, PYTHON, 'session.py');
		expect(res.error).toBeUndefined();
		expect(res.status, `stderr:\n${res.stderr}`).toBe(0);
		expect(res.stdout).not.toContain('error rendering');
		const out = join(dir, 'session_output');
		const pngs = readdirSync(out).filter((f) => f.endsWith('.png'));
		expect(pngs.sort()).toEqual(session.plots.map((p) => expect.stringMatching(`^plot_${p.id}_`)));
		for (const f of pngs) expect(statSync(join(out, f)).size).toBeGreaterThan(0);
	}, 240_000);
});

describe.runIf(HAVE_R)('an exported R script of a session with overlays', () => {
	it('still runs (the R runtime renders no plots)', () => {
		// The R runtime has no Crossing analysis; its output column is in the session's saved
		// data, so the scatterplot's wired overlay still resolves.
		const session = overlaySession();
		session.tableProcesses = [];
		const files = sessionToRFiles(session, R_RUNTIME, {});
		const { dir, res } = runExport(files, 'Rscript', 'session.R');
		expect(res.error).toBeUndefined();
		expect(res.status, `stderr:\n${res.stderr}`).toBe(0);
		expect(existsSync(join(dir, 'session_output', 'columns_after_analyses.csv'))).toBe(true);
	}, 240_000);
});
