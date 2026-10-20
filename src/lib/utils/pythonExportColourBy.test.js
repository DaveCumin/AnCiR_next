/**
 * Colour by, Size by and resolved series colours in the Python export (colour-by plan
 * 2026-10-20, phases 1d and 3): the exported script carries what the runtime needs, and RUNS,
 * drawing the coloured and sized figures without a plot error. The sessions are the app-built ones in
 * tools/parity/colour_by_app.json (src/lib/_parity/emitColourBy.svelte.test.js); the colours
 * themselves are checked per point in tools/test_plot_colour_by.py.
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
	readFileSync(join(ROOT, 'tools', 'parity', 'colour_by_app.json'), 'utf8')
);

/** One app-built case as the export receives it (outputCoreAsJson + the export additions). */
function session(name) {
	const c = FIXTURE.cases.find((k) => k.name === name);
	return { ...structuredClone(c.session), tableProcesses: [], storedValues: {} };
}

/** The PLOTS the script embeds, parsed back out of its text. */
function embeddedPlots(text) {
	const m = text.match(/^PLOTS = json\.loads\(([\s\S]*?)\)\nSTORED_VALUES/m);
	const parts = [...m[1].matchAll(/"(?:[^"\\]|\\.)*"/g)].map((p) => JSON.parse(p[0]));
	return JSON.parse(parts.join(''));
}

const tempDirs = [];
afterAll(() => {
	for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

describe('resolved series colours reach the script', () => {
	it('each plot carries its seriesColours, and a plot without any is untouched', () => {
		const s = session('resolvedColours');
		const ids = s.plots.map((p) => p.id);
		s.seriesColours = { [ids[1]]: s.seriesColours[ids[1]] };
		const [file] = sessionToPythonFiles(s, PY_RUNTIME);
		const plots = embeddedPlots(file.text);
		expect(plots[1].seriesColours).toEqual(s.seriesColours[ids[1]]);
		expect('seriesColours' in plots[0]).toBe(false);
		// The saved plot itself is not changed (the session object is the caller's).
		expect('seriesColours' in s.plots[1]).toBe(false);
	});

	it('a Category series carries its categories and the colours the app draws them in', () => {
		const s = session('categoryPoints');
		const [file] = sessionToPythonFiles(s, PY_RUNTIME);
		const [plot] = embeddedPlots(file.text);
		const want = s.seriesColours[s.plots[0].id][0].colourCategories;
		expect(plot.seriesColours[0].colourCategories).toEqual(want);
		expect(want.labels).toEqual(['het', 'ko', 'wt']);
		expect(want.colours[0]).toBe('#7a1f5c');
		const refused = session('categoryRefused');
		const [rf] = sessionToPythonFiles(refused, PY_RUNTIME);
		expect(embeddedPlots(rf.text)[0].seriesColours[0].colourCategories).toEqual({
			refused: true
		});
	});

	it('a session without seriesColours exports exactly as before', () => {
		const s = session('valueLines');
		delete s.seriesColours;
		const [file] = sessionToPythonFiles(s, PY_RUNTIME);
		expect(embeddedPlots(file.text)).toEqual(s.plots);
	});
});

describe.runIf(existsSync(PYTHON))('a coloured export runs (tools/.venv)', () => {
	for (const name of [
		'valueLines',
		'hourOfDayZone',
		'lineOnly',
		'monochrome',
		'resolvedColours',
		// Size by (phase 3): sized points, the size key beside the plot, in a corner, shared
		// with the colour bar, and faceted.
		'sizeAndColour',
		'sizeManual',
		'sizeTimeCorner',
		'sizeFacets',
		// Category (v1.1): the session's category colours, the key wrapped into columns, the
		// greys of monochrome, and the palette cap's refusal.
		'categoryPoints',
		'categoryNumbers',
		'categoryMonochrome',
		'categoryRefused',
		'categoryWrap'
	]) {
		it(`${name}: the script runs and writes every plot without a plot error`, () => {
			const dir = mkdtempSync(join(tmpdir(), 'ancir-colourby-'));
			tempDirs.push(dir);
			const s = session(name);
			for (const f of sessionToPythonFiles(s, PY_RUNTIME)) writeFileSync(join(dir, f.name), f.text);
			const res = spawnSync(PYTHON, ['session.py'], {
				cwd: dir,
				encoding: 'utf8',
				timeout: 180_000
			});
			expect(res.status, `stderr:\n${res.stderr}`).toBe(0);
			expect(res.stdout).not.toContain('[ancir-plot] error');
			const pngs = readdirSync(join(dir, 'session_output')).filter((f) => f.endsWith('.png'));
			expect(pngs.length).toBe(s.plots.length);
		}, 240_000);
	}
});
