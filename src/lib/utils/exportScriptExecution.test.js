/**
 * Executes the exported scripts for real — Python via tools/.venv and R via
 * Rscript — in every export shape (single self-contained file, helper+analysis
 * split, and split with the CSV data sidecar), and asserts they all run to
 * completion AND produce byte-identical result CSVs. The fixture is a real
 * demo session (SequenceColumn + Cosinor) plus an injected category column so
 * the CSV sidecar's string path is exercised end-to-end.
 *
 * Skipped, loudly, only where an interpreter is missing; on the development
 * machine both exist and these tests RUN.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sessionToPythonFiles } from './pythonExport.js';
import { sessionToRFiles } from './rExport.js';

const ROOT = process.cwd();
const PYTHON = join(ROOT, 'tools', '.venv', 'bin', 'python');
const HAVE_PYTHON = existsSync(PYTHON);
const HAVE_R = spawnSync('Rscript', ['--version'], { encoding: 'utf8' }).status === 0;

const PY_RUNTIME = readFileSync(join(ROOT, 'tools', 'ancir_runtime.py'), 'utf8');
const R_RUNTIME = readFileSync(join(ROOT, 'tools', 'ancir_runtime.R'), 'utf8');

/** demo-tp-cosinor + a category column, so the CSV 'str' kind is exercised. */
function fixtureSession() {
	const session = JSON.parse(
		readFileSync(join(ROOT, 'static', 'sessions', 'demos', 'demo-tp-cosinor.json'), 'utf8')
	);
	session.rawData['900'] = ['setA', 'setB', 'setC', 'setA'];
	session.data.push({ id: 900, name: 'label', type: 'category', data: 900, processes: [] });
	return session;
}

const tempDirs = [];
afterAll(() => {
	for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

/** Write the export files to a fresh temp dir and run the entry script. */
function runExport(files, cmd, entry) {
	const dir = mkdtempSync(join(tmpdir(), 'ancir-export-exec-'));
	tempDirs.push(dir);
	for (const f of files) writeFileSync(join(dir, f.name), f.text);
	const res = spawnSync(cmd, [entry], { cwd: dir, encoding: 'utf8', timeout: 180_000 });
	return { dir, res };
}

/** Pull one scalar out of a result CSV by header name (first data row). */
function scalarFromCsv(csvText, header) {
	const [head, first] = csvText.split('\n');
	const clean = (s) => s.replaceAll('"', '');
	const idx = head.split(',').map(clean).indexOf(header);
	expect(idx).toBeGreaterThanOrEqual(0);
	return Number(clean(first.split(',')[idx]));
}

// The amplitude the app computed and stored in the session (JS engine).
const SESSION_AMPLITUDE = 41.73678030222172;
const SESSION_MESOR = 50.06903731465636;

describe.runIf(HAVE_PYTHON)('exported Python scripts execute (tools/.venv)', () => {
	const session = fixtureSession();
	const modes = [
		['single inline', {}, 'session.py', 'session_output'],
		['split inline', { split: true, version: '72.22-test' }, 'analysis.py', 'analysis_output'],
		[
			'split + CSV data',
			{ split: true, dataAsCsv: true, version: '72.22-test' },
			'analysis.py',
			'analysis_output'
		]
	];
	const results = {};

	for (const [label, opts, entry, outDir] of modes) {
		it(`${label} runs to completion and reproduces the session's cosinor fit`, () => {
			const files = sessionToPythonFiles(session, PY_RUNTIME, opts);
			if (opts.dataAsCsv) {
				expect(files.map((f) => f.name)).toContain('session_data.csv');
			}
			const { dir, res } = runExport(files, PYTHON, entry);
			expect(res.error).toBeUndefined();
			expect(res.status, `stderr:\n${res.stderr}`).toBe(0);
			const out = readFileSync(join(dir, outDir, 'columns_after_tables.csv'), 'utf8');
			results[label] = out;
			// Key numbers match what the app computed (stored in the session).
			expect(scalarFromCsv(out, 'amplitude_56')).toBeCloseTo(SESSION_AMPLITUDE, 9);
			expect(scalarFromCsv(out, 'mesor_56')).toBeCloseTo(SESSION_MESOR, 9);
			// The injected category column round-tripped (via CSV where enabled).
			expect(out.split('\n')[0]).toContain('label');
			expect(out).toContain('setB');
		}, 240_000);
	}

	it('all three shapes produce byte-identical results', () => {
		expect(results['split inline']).toBe(results['single inline']);
		expect(results['split + CSV data']).toBe(results['single inline']);
	});

	it('a version-skewed helper file warns on stderr but still runs', () => {
		const files = sessionToPythonFiles(session, PY_RUNTIME, {
			split: true,
			version: '72.22-test'
		});
		const helpers = files.find((f) => f.name === 'ancir_helpers.py');
		helpers.text = helpers.text.replace(
			'ANCIR_HELPERS_VERSION = "72.22-test"',
			'ANCIR_HELPERS_VERSION = "0.0-other"'
		);
		const { res } = runExport(files, PYTHON, 'analysis.py');
		expect(res.status).toBe(0);
		expect(res.stderr).toContain('WARNING');
		expect(res.stderr).toContain('0.0-other');
	}, 240_000);
});

describe.runIf(HAVE_R)('exported R scripts execute (Rscript)', () => {
	const session = fixtureSession();
	const modes = [
		['single inline', {}, 'session.R', 'session_output'],
		['split inline', { split: true, version: '72.22-test' }, 'analysis.R', 'analysis_output'],
		[
			'split + CSV data',
			{ split: true, dataAsCsv: true, version: '72.22-test' },
			'analysis.R',
			'analysis_output'
		]
	];
	const results = {};

	for (const [label, opts, entry, outDir] of modes) {
		it(`${label} runs to completion and reproduces the session's cosinor fit`, () => {
			const files = sessionToRFiles(session, R_RUNTIME, opts);
			if (opts.dataAsCsv) {
				expect(files.map((f) => f.name)).toContain('session_data.csv');
			}
			const { dir, res } = runExport(files, 'Rscript', entry);
			expect(res.error).toBeUndefined();
			expect(res.status, `stderr:\n${res.stderr}`).toBe(0);
			const out = readFileSync(join(dir, outDir, 'columns_after_analyses.csv'), 'utf8');
			results[label] = out;
			// The R port matches the JS fit to well past 1e-6 on this fixture.
			expect(scalarFromCsv(out, 'amplitude_56')).toBeCloseTo(SESSION_AMPLITUDE, 6);
			expect(scalarFromCsv(out, 'mesor_56')).toBeCloseTo(SESSION_MESOR, 6);
			expect(out.split('\n')[0]).toContain('label');
			expect(out).toContain('setB');
		}, 240_000);
	}

	it('all three shapes produce byte-identical results', () => {
		expect(results['split inline']).toBe(results['single inline']);
		expect(results['split + CSV data']).toBe(results['single inline']);
	});
});

// Never silently green: when an interpreter is missing, say so once.
describe.runIf(!HAVE_PYTHON || !HAVE_R)('export execution prerequisites', () => {
	it('reports which interpreter is unavailable', () => {
		if (!HAVE_PYTHON) {
			console.warn(`[exportScriptExecution] SKIPPED Python runs: ${PYTHON} not found`);
		}
		if (!HAVE_R) {
			console.warn('[exportScriptExecution] SKIPPED R runs: Rscript not on PATH');
		}
		expect(true).toBe(true);
	});
});
