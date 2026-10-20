/**
 * The figure look in the Python export: the script carries what the runtime needs to draw a
 * plot as the app does (the plot's figure style, the display zone), and it RUNS, writing
 * every figure at the style's export resolution. The sessions are real demos with the saved
 * settings of tools/parity/axis_style_app.json (src/lib/_parity/emitAxisStyle.svelte.test.js);
 * the drawing itself (ticks, labels, gridlines, domains, type sizes) is checked against the
 * app in tools/test_plot_axes_style.py.
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
	readFileSync(join(ROOT, 'tools', 'parity', 'axis_style_app.json'), 'utf8')
);

const demo = (id) =>
	JSON.parse(readFileSync(join(ROOT, 'static', 'sessions', 'demos', `${id}.json`), 'utf8'));

/** The PLOTS the script embeds, parsed back out of its text. */
function embeddedPlots(text) {
	const m = text.match(/^PLOTS = json\.loads\(([\s\S]*?)\)\nSTORED_VALUES/m);
	const parts = [...m[1].matchAll(/"(?:[^"\\]|\\.)*"/g)].map((p) => JSON.parse(p[0]));
	return JSON.parse(parts.join(''));
}

/** A PNG's pixel size, from its IHDR chunk. */
function pngSize(path) {
	const b = readFileSync(path);
	return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

const tempDirs = [];
afterAll(() => {
	for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

describe('the figure style reaches the script', () => {
	it("a plot saved without a style takes the session's template; a saved style is kept", () => {
		const s = demo('demo-scatter-rhythm');
		const saved = s.plots[0].style;
		s.figureStyle = { fontFamily: 'serif', fontSize: 'l' };
		s.plots.push({ ...structuredClone(s.plots[0]), id: 999 });
		delete s.plots[1].style;
		const [file] = sessionToPythonFiles(s, PY_RUNTIME);
		const plots = embeddedPlots(file.text);
		expect(plots[0].style).toEqual(saved);
		expect(plots[1].style).toEqual({ fontFamily: 'serif', fontSize: 'l' });
		// The caller's session is not changed.
		expect('style' in s.plots[1]).toBe(false);
	});

	it('the display zone is set before the plots are drawn', () => {
		const s = demo('demo-tp-joindata');
		s.appState = { ...(s.appState ?? {}), displayTimezone: 'Asia/Kolkata' };
		const [file] = sessionToPythonFiles(s, PY_RUNTIME);
		expect(file.text).toContain('set_display_timezone("Asia/Kolkata")');
	});
});

// One export per demo and zone, carrying every case's edited plot for that demo.
const GROUPS = new Map();
for (const c of FIXTURE.cases) {
	const key = `${c.demo}|${c.zone}`;
	if (!GROUPS.has(key)) GROUPS.set(key, { demo: c.demo, zone: c.zone, plots: [] });
	GROUPS.get(key).plots.push({
		...structuredClone(c.plotJSON),
		id: 1000 + GROUPS.get(key).plots.length
	});
}

describe.runIf(existsSync(PYTHON))('styled exports run (tools/.venv)', () => {
	for (const g of GROUPS.values()) {
		it(`${g.demo} in ${g.zone}: the script runs and writes every plot at the export dpi`, () => {
			const dir = mkdtempSync(join(tmpdir(), 'ancir-figlook-'));
			tempDirs.push(dir);
			const s = demo(g.demo);
			s.plots = g.plots;
			s.appState = { ...(s.appState ?? {}), displayTimezone: g.zone };
			for (const f of sessionToPythonFiles(s, PY_RUNTIME)) writeFileSync(join(dir, f.name), f.text);
			const res = spawnSync(PYTHON, ['session.py'], {
				cwd: dir,
				encoding: 'utf8',
				timeout: 180_000
			});
			expect(res.status, `stderr:\n${res.stderr}`).toBe(0);
			expect(res.stdout).not.toContain('[ancir-plot] error');
			const out = join(dir, 'session_output');
			const pngs = readdirSync(out).filter((f) => f.endsWith('.png'));
			expect(pngs.length).toBe(g.plots.length);
			for (const plot of g.plots) {
				const png = pngs.find((f) => f.startsWith(`plot_${plot.id}_`));
				expect(png, `plot ${plot.id}`).toBeDefined();
				// At 300 dpi a figure is at least its plot's px x 300/96 wide (the titles and
				// axis labels outside the plot area only add to it).
				const { width, height } = pngSize(join(out, png));
				expect(width).toBeGreaterThanOrEqual(Math.floor((plot.width * 300) / 96) - 2);
				expect(height).toBeGreaterThan(((plot.height - 40) * 300) / 96);
			}
		}, 240_000);
	}
});
