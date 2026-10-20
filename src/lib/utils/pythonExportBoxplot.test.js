/**
 * The Boxplot in the Python export: the exported scripts RUN and draw every box plot. The
 * sessions are the demos of tools/parity/boxplot_app.json (src/lib/_parity/emitBoxplot
 * .svelte.test.js) with each case's edited plot, and the colours the app resolved travel the
 * way the app's export sends them (`session.seriesColours`, keyed by plot id). What each
 * figure draws (boxes, points, violins, brackets, legend) is checked against the app in
 * tools/test_plot_boxplot.py.
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
const FIXTURE = JSON.parse(readFileSync(join(ROOT, 'tools', 'parity', 'boxplot_app.json'), 'utf8'));

const demo = (id) =>
	JSON.parse(readFileSync(join(ROOT, 'static', 'sessions', 'demos', `${id}.json`), 'utf8'));

/** The PLOTS the script embeds, parsed back out of its text. */
function embeddedPlots(text) {
	const m = text.match(/^PLOTS = json\.loads\(([\s\S]*?)\)\nSTORED_VALUES/m);
	const parts = [...m[1].matchAll(/"(?:[^"\\]|\\.)*"/g)].map((p) => JSON.parse(p[0]));
	return JSON.parse(parts.join(''));
}

// One session per demo, carrying every case's plot for that demo under a fresh id.
const GROUPS = new Map();
for (const c of FIXTURE.cases) {
	if (!GROUPS.has(c.demo)) GROUPS.set(c.demo, { demo: c.demo, plots: [], seriesColours: {} });
	const g = GROUPS.get(c.demo);
	const { seriesColours, ...plot } = structuredClone(c.plotJSON);
	plot.id = 2000 + g.plots.length;
	plot.name = `Boxplot ${c.name}`;
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

describe('the Python export carries what the Boxplot draws with', () => {
	it("each box plot with the app's box and category colours", () => {
		const g = GROUPS.get('demo-workflow-stats-two-group');
		const [file] = sessionToPythonFiles(sessionFor(g), PY_RUNTIME);
		const plots = embeddedPlots(file.text);
		expect(plots.map((p) => p.id)).toEqual(g.plots.map((p) => p.id));
		for (const p of plots) expect(p.seriesColours).toEqual(g.seriesColours[p.id]);
		// The user's category colour (the pinned case) reaches the script.
		expect(JSON.stringify(plots)).toContain('#ff8800');
	});
});

describe.runIf(existsSync(PYTHON))('exported box plots render (tools/.venv)', () => {
	for (const g of GROUPS.values()) {
		it(`${g.demo}: the script runs and writes every box plot`, () => {
			const dir = mkdtempSync(join(tmpdir(), 'ancir-boxplot-'));
			tempDirs.push(dir);
			for (const f of sessionToPythonFiles(sessionFor(g), PY_RUNTIME)) {
				writeFileSync(join(dir, f.name), f.text);
			}
			const res = spawnSync(PYTHON, ['session.py'], {
				cwd: dir,
				encoding: 'utf8',
				timeout: 180_000,
				env: { ...process.env, MPLBACKEND: 'Agg' }
			});
			expect(res.status, `stderr:\n${res.stderr}`).toBe(0);
			expect(res.stdout).not.toContain('[ancir-plot] error');
			const pngs = readdirSync(join(dir, 'session_output')).filter((f) => f.endsWith('.png'));
			for (const plot of g.plots) {
				expect(
					pngs.some((f) => f.startsWith(`plot_${plot.id}_`)),
					`plot ${plot.id}`
				).toBe(true);
			}
		}, 240_000);
	}
});
