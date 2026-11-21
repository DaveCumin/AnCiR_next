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
import { readFileSync, writeFileSync, mkdtempSync, existsSync, rmSync, readdirSync } from 'node:fs';
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

/**
 * The CSV header of a Cosinor output, read off the session. Output column names carry a column id
 * (`amplitude_57`) and a demo regeneration renumbers ids, so a hard-coded header goes stale.
 */
function cosinorOutHeader(key) {
	const session = fixtureSession();
	const tp = session.tableProcesses.find((t) => t.name === 'Cosinor');
	const name = session.data.find((c) => c.id === tp.args.out[key])?.name;
	if (!name) throw new Error(`demo-tp-cosinor.json has no Cosinor "${key}" output column`);
	return name;
}
const AMPLITUDE_HEADER = cosinorOutHeader('amplitude');
const MESOR_HEADER = cosinorOutHeader('mesor');

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
			expect(res.status, `${res.error?.message ?? ''}\nstderr:\n${res.stderr}`).toBe(0);
			const out = readFileSync(join(dir, outDir, 'columns_after_tables.csv'), 'utf8');
			results[label] = out;
			// Key numbers match what the app computed (stored in the session).
			expect(scalarFromCsv(out, AMPLITUDE_HEADER)).toBeCloseTo(SESSION_AMPLITUDE, 9);
			expect(scalarFromCsv(out, MESOR_HEADER)).toBeCloseTo(SESSION_MESOR, 9);
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

// REPORTED (v82.53 export work): the in-app export never called export_plot_data, so it
// wrote no plot-data CSVs (the numbers a periodogram, FFT, correlogram, actogram or
// scalogram derives) while the CLI exporter, which it is meant to mirror, did. The same
// session through the CLI and through every in-app shape must write the same files, byte
// for byte, in the session's display zone (the actogram folds its rows in it).
describe.runIf(HAVE_PYTHON)('exported Python scripts write the plot-data CSVs (as the CLI)', () => {
	const ZONE = 'Pacific/Auckland';
	function plotSession() {
		const s = JSON.parse(
			readFileSync(
				join(ROOT, 'static', 'sessions', 'demos', 'demo-workflow-free-running.json'),
				'utf8'
			)
		);
		s.appState = { ...(s.appState ?? {}), displayTimezone: ZONE };
		return s;
	}
	/** { name: text } of every plot-data CSV in `dir`. */
	function plotCsvs(dir) {
		return Object.fromEntries(
			readdirSync(dir)
				.filter((f) => /^plot_.*_data\.csv$/.test(f))
				.sort()
				.map((f) => [f, readFileSync(join(dir, f), 'utf8')])
		);
	}

	let cli = null;
	it('the CLI writes one per calculating plot (the reference)', () => {
		const dir = mkdtempSync(join(tmpdir(), 'ancir-export-exec-'));
		tempDirs.push(dir);
		writeFileSync(join(dir, 'in.json'), JSON.stringify(plotSession()));
		const emit = spawnSync(
			PYTHON,
			[join(ROOT, 'tools', 'ancir_to_python.py'), join(dir, 'in.json'), '-o', 'session.py'],
			{ cwd: dir, encoding: 'utf8', timeout: 180_000 }
		);
		expect(emit.status, emit.stderr).toBe(0);
		const run = spawnSync(PYTHON, ['session.py'], { cwd: dir, encoding: 'utf8', timeout: 180_000 });
		expect(run.status, run.stderr).toBe(0);
		cli = plotCsvs(join(dir, 'session_output'));
		// The actogram and the periodogram; the table plot computes nothing.
		expect(Object.keys(cli)).toHaveLength(2);
		expect(Object.keys(cli).join()).toMatch(/Actogram/i);
		for (const text of Object.values(cli)) expect(text.split('\n').length).toBeGreaterThan(3);
	}, 240_000);

	for (const [label, opts, entry, outDir] of [
		['single inline', {}, 'session.py', 'session_output'],
		['split + CSV data', { split: true, dataAsCsv: true }, 'analysis.py', 'analysis_output']
	]) {
		it(`${label}: the same files, byte for byte`, () => {
			const files = sessionToPythonFiles(plotSession(), PY_RUNTIME, opts);
			// The zone the pipeline hands export_plot_data, as the script sees it. In split mode
			// the helpers' DISPLAY_TIMEZONE is another module's global, so the script binds its own.
			const main = files.find((f) => f.name === entry);
			main.text += '\nprint("[zone]", DISPLAY_TIMEZONE)\n';
			const { dir, res } = runExport(files, PYTHON, entry);
			expect(res.status, `${res.error?.message ?? ''}\nstderr:\n${res.stderr}`).toBe(0);
			expect(res.stdout).toContain(`[zone] ${ZONE}`);
			expect(res.stdout).toContain('[ancir-plotdata] wrote');
			expect(cli).not.toBeNull();
			expect(plotCsvs(join(dir, outDir))).toEqual(cli);
		}, 240_000);
	}
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
			expect(res.status, `${res.error?.message ?? ''}\nstderr:\n${res.stderr}`).toBe(0);
			const out = readFileSync(join(dir, outDir, 'columns_after_analyses.csv'), 'utf8');
			results[label] = out;
			// The R port matches the JS fit to well past 1e-6 on this fixture.
			expect(scalarFromCsv(out, AMPLITUDE_HEADER)).toBeCloseTo(SESSION_AMPLITUDE, 6);
			expect(scalarFromCsv(out, MESOR_HEADER)).toBeCloseTo(SESSION_MESOR, 6);
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

// ----------------------------------------------------------------------
// v72.23 field bugs (David, RStudio): script_path() resolved ONLY via
// commandArgs()/--file=, so source()-ing or pasting interactively broke; and
// CSV_COLUMNS was one 9k-char line, past R's 4094-char console input limit.
// These tests run the SAME split+CSV export through the invocation modes an
// interactive R user actually uses, asserting the same key numbers.
// ----------------------------------------------------------------------

/** Write the split+CSV R export into a fresh temp dir; returns the dir. */
function writeRSplitCsv(session) {
	const dir = mkdtempSync(join(tmpdir(), 'ancir-export-exec-'));
	tempDirs.push(dir);
	const files = sessionToRFiles(session, R_RUNTIME, {
		split: true,
		dataAsCsv: true,
		version: '72.23-test'
	});
	for (const f of files) writeFileSync(join(dir, f.name), f.text);
	return dir;
}

function freshDir() {
	const d = mkdtempSync(join(tmpdir(), 'ancir-export-cwd-'));
	tempDirs.push(d);
	return d;
}

function assertKeyNumbers(csvPath) {
	const out = readFileSync(csvPath, 'utf8');
	expect(scalarFromCsv(out, AMPLITUDE_HEADER)).toBeCloseTo(SESSION_AMPLITUDE, 6);
	expect(scalarFromCsv(out, MESOR_HEADER)).toBeCloseTo(SESSION_MESOR, 6);
	expect(out.split('\n')[0]).toContain('label');
	expect(out).toContain('setB');
}

describe.runIf(HAVE_R)('R split+CSV export under interactive invocation modes', () => {
	it('source("<abs>/analysis.R") from a DIFFERENT working directory (sys.frames/ofile path)', () => {
		const dir = writeRSplitCsv(fixtureSession());
		const elsewhere = freshDir();
		const res = spawnSync('Rscript', ['-e', `source(${JSON.stringify(join(dir, 'analysis.R'))})`], {
			cwd: elsewhere,
			encoding: 'utf8',
			timeout: 180_000
		});
		expect(res.status, `${res.error?.message ?? ''}\nstderr:\n${res.stderr}`).toBe(0);
		// Output lands NEXT TO the script, not in the unrelated working directory.
		expect(existsSync(join(elsewhere, 'analysis_output'))).toBe(false);
		assertKeyNumbers(join(dir, 'analysis_output', 'columns_after_analyses.csv'));
	}, 240_000);

	it('ANCIR_DIR override: script copied AWAY from its companions still finds them', () => {
		const dir = writeRSplitCsv(fixtureSession());
		const scriptDir = freshDir(); // analysis.R alone, no helpers/CSV beside it
		const analysis = readFileSync(join(dir, 'analysis.R'), 'utf8');
		expect(analysis).toContain('ANCIR_DIR <- NULL');
		writeFileSync(
			join(scriptDir, 'analysis.R'),
			analysis.replace('ANCIR_DIR <- NULL', `ANCIR_DIR <- ${JSON.stringify(dir)}`)
		);
		const res = spawnSync('Rscript', [join(scriptDir, 'analysis.R')], {
			cwd: freshDir(), // and getwd() points somewhere unrelated too
			encoding: 'utf8',
			timeout: 180_000
		});
		expect(res.status, `${res.error?.message ?? ''}\nstderr:\n${res.stderr}`).toBe(0);
		// ANCIR_DIR wins for companions AND output.
		assertKeyNumbers(join(dir, 'analysis_output', 'columns_after_analyses.csv'));
	}, 240_000);

	it('piped line-by-line into the R console (the 4094-char input limit) still works', () => {
		// `R --no-echo` fed on stdin uses the console reader — the same path that
		// truncated David's 9163-char CSV_COLUMNS line at 4094 chars in v72.23.
		// No --file=, no source() frame: exercises the loud getwd() fallback.
		const haveR = spawnSync('R', ['--version'], { encoding: 'utf8' }).status === 0;
		if (!haveR) {
			console.warn('[exportScriptExecution] SKIPPED console-pipe run: R not on PATH');
			return;
		}
		const dir = writeRSplitCsv(fixtureSession());
		const res = spawnSync('R', ['--vanilla', '--no-echo'], {
			cwd: dir,
			input: readFileSync(join(dir, 'analysis.R'), 'utf8'),
			encoding: 'utf8',
			timeout: 180_000
		});
		expect(res.stderr).not.toContain('Truncating console input');
		expect(res.status, `${res.error?.message ?? ''}\nstderr:\n${res.stderr}`).toBe(0);
		expect(res.stderr).toContain("[ancir] Could not determine this script's location");
		// With no detectable script name the output falls back to session_output/.
		assertKeyNumbers(join(dir, 'session_output', 'columns_after_analyses.csv'));
	}, 240_000);
});

describe.runIf(HAVE_PYTHON)('Python split+CSV export from a different working directory', () => {
	it('python <abs>/analysis.py writes output next to the script, same numbers', () => {
		const dir = mkdtempSync(join(tmpdir(), 'ancir-export-exec-'));
		tempDirs.push(dir);
		const files = sessionToPythonFiles(fixtureSession(), PY_RUNTIME, {
			split: true,
			dataAsCsv: true,
			version: '72.23-test'
		});
		for (const f of files) writeFileSync(join(dir, f.name), f.text);
		const res = spawnSync(PYTHON, [join(dir, 'analysis.py')], {
			cwd: freshDir(),
			encoding: 'utf8',
			timeout: 180_000
		});
		expect(res.status, `${res.error?.message ?? ''}\nstderr:\n${res.stderr}`).toBe(0);
		const out = readFileSync(join(dir, 'analysis_output', 'columns_after_tables.csv'), 'utf8');
		expect(scalarFromCsv(out, AMPLITUDE_HEADER)).toBeCloseTo(SESSION_AMPLITUDE, 9);
		expect(scalarFromCsv(out, MESOR_HEADER)).toBeCloseTo(SESSION_MESOR, 9);
	}, 240_000);
});

// ----------------------------------------------------------------------
// Node results that hold column NAMES as data (Normality test `variable`, ...) carry the names
// the app shows, baked into the node's args as `_inputLabels` (core/columnLabels.js
// bakeInputLabels). demo-workflow-stats-regression tests a fit residual, stored as
// `resid_<id>` but shown as "Residuals: y"; both exported scripts must write the shown name.
// The label is injected here as a re-saved session carries it, so the test does not wait on a
// demo regeneration.
// ----------------------------------------------------------------------

/** demo-workflow-stats-regression with its Normality test's labels baked, and that output's header. */
function labelledSession() {
	const session = JSON.parse(
		readFileSync(
			join(ROOT, 'static', 'sessions', 'demos', 'demo-workflow-stats-regression.json'),
			'utf8'
		)
	);
	const tp = session.tableProcesses.find((t) => t.name === 'NormalityTest');
	const [inputId] = tp.args.yIN;
	const stored = session.data.find((c) => c.id === inputId)?.name;
	expect(stored).toMatch(/^resid_/);
	tp.args._inputLabels = { [String(inputId)]: 'Residuals: y' };
	const header = session.data.find((c) => c.id === tp.args.out.variable)?.name;
	return { session, header, stored };
}

/** One text cell out of a result CSV by header name (first data row). */
function cellFromCsv(csvText, header) {
	const [head, first] = csvText.split('\n');
	const clean = (s) => s.replaceAll('"', '');
	const idx = head.split(',').map(clean).indexOf(header);
	expect(idx).toBeGreaterThanOrEqual(0);
	return clean(first.split(',')[idx]);
}

describe('exported scripts write the names the app shows into node results', () => {
	it.runIf(HAVE_PYTHON)(
		'Python: Normality test variable reads "Residuals: y"',
		() => {
			const { session, header } = labelledSession();
			const { dir, res } = runExport(
				sessionToPythonFiles(session, PY_RUNTIME),
				PYTHON,
				'session.py'
			);
			expect(res.status, `${res.error?.message ?? ''}\nstderr:\n${res.stderr}`).toBe(0);
			const out = readFileSync(join(dir, 'session_output', 'columns_after_tables.csv'), 'utf8');
			expect(cellFromCsv(out, header)).toBe('Residuals: y');
		},
		240_000
	);

	it.runIf(HAVE_R)(
		'R: Normality test variable reads "Residuals: y"',
		() => {
			const { session, header } = labelledSession();
			const { dir, res } = runExport(sessionToRFiles(session, R_RUNTIME), 'Rscript', 'session.R');
			expect(res.status, `${res.error?.message ?? ''}\nstderr:\n${res.stderr}`).toBe(0);
			const out = readFileSync(join(dir, 'session_output', 'columns_after_analyses.csv'), 'utf8');
			expect(cellFromCsv(out, header)).toBe('Residuals: y');
		},
		240_000
	);
});

// Wide To Long's `category` cells name each row's value column the way the app shows it, baked
// as `_inputLabels` (v82.38). The label is injected as a re-saved session carries it; the demo's
// value columns are plain columns, so a distinct label proves the ports read the baked one.
function wideToLongSession() {
	const session = JSON.parse(
		readFileSync(join(ROOT, 'static', 'sessions', 'demos', 'demo-tp-widetolong.json'), 'utf8')
	);
	const tp = session.tableProcesses.find((t) => t.name === 'WideToLong');
	const [first] = tp.args.valueColIds;
	tp.args._inputLabels = { [String(first)]: 'Shown name' };
	const header = session.data.find((c) => c.id === tp.args.out.category)?.name;
	return { session, header };
}

describe('exported scripts write Wide To Long categories as the app shows them', () => {
	it.runIf(HAVE_PYTHON)(
		'Python: the first category reads the baked label',
		() => {
			const { session, header } = wideToLongSession();
			const { dir, res } = runExport(
				sessionToPythonFiles(session, PY_RUNTIME),
				PYTHON,
				'session.py'
			);
			expect(res.status, `${res.error?.message ?? ''}\nstderr:\n${res.stderr}`).toBe(0);
			const out = readFileSync(join(dir, 'session_output', 'columns_after_tables.csv'), 'utf8');
			expect(cellFromCsv(out, header)).toBe('Shown name');
		},
		240_000
	);

	it.runIf(HAVE_R)(
		'R: the first category reads the baked label',
		() => {
			const { session, header } = wideToLongSession();
			const { dir, res } = runExport(sessionToRFiles(session, R_RUNTIME), 'Rscript', 'session.R');
			expect(res.status, `${res.error?.message ?? ''}\nstderr:\n${res.stderr}`).toBe(0);
			const out = readFileSync(join(dir, 'session_output', 'columns_after_analyses.csv'), 'utf8');
			expect(cellFromCsv(out, header)).toBe('Shown name');
		},
		240_000
	);
});

// Per-column time zones (plan ClaudeNotes/AnCiR/2026-10-20-per-column-timezone-plan.md, 5d):
// the exported scripts must carry each column's `timeZone` into the runtime, which resolves a
// zone-less column's wall clock there and reads every clock phase in it. The session is the
// parity-only tools/parity/sessions/parity-zoned-time.json (Auckland text across the end of
// NZDT, an AWD column in London across the start of BST); the expected numbers are what the
// app computes for it (GEN_SESSION_PARITY=1 ... emitSessionParity, session_js_results.json).
describe('exported scripts resolve per-column time zones (parity-zoned-time)', () => {
	const session = JSON.parse(
		readFileSync(join(ROOT, 'tools', 'parity', 'sessions', 'parity-zoned-time.json'), 'utf8')
	);
	// 1 Apr 2024 00:00 NZDT, not 00:00 UTC: the zone moved the instant.
	const HIVE_FIRST_MS = 1711882800000;
	// The clock acrophase with the first sample's offset (+13:00) for the whole record.
	const COSINOR_ACROPHASE = 14.569584467842688;
	// MovingAnalysis: each window's own offset, so every window reads about 14.0 h.
	const MOVING_FIRST_ACROPHASE = 14.000800441248145;
	// AWD in Europe/London: peak written at 13:00 local.
	const AWD_ACROPHASE = 12.999999999999986;

	const check = (out) => {
		expect(scalarFromCsv(out, 'hive time')).toBe(HIVE_FIRST_MS);
		expect(scalarFromCsv(out, 'acrophase_1')).toBeCloseTo(COSINOR_ACROPHASE, 6);
		expect(scalarFromCsv(out, '2_H1_acrophase_3')).toBeCloseTo(MOVING_FIRST_ACROPHASE, 6);
		expect(scalarFromCsv(out, 'acrophase_5')).toBeCloseTo(AWD_ACROPHASE, 6);
	};
	// What the app shows on these nodes, printed by the scripts as console warnings (plan 5f),
	// word for word (the texts of dstNotes.js and zoneNotes.js for this session).
	const NODE_MESSAGES = [
		"Cosinor: Clock time uses the first sample's offset (UTC+13:00, Pacific/Auckland) for the whole record. Daylight saving ended on 7 Apr 2024, so phases after it read 1 h later than the local clock.",
		"Moving Analysis: Daylight saving ended on 7 Apr 2024 in Pacific/Auckland; each window's clock time uses the offset in force at its centre.",
		"Join Data: Joined times are in A's zone (Pacific/Auckland).",
		"Join Data: B's times have no zone, so they are read as UTC. If they were recorded in Pacific/Auckland time, set B's zone (in its column's Properties) and the two line up.",
		"Cosinor: Clock time uses the first sample's offset (UTC, Europe/London) for the whole record. Daylight saving began on 31 Mar 2024, so phases after it read 1 h earlier than the local clock."
	];
	const printsNodeMessages = (stderr) => {
		const flat = stderr.replace(/\s+/g, ' ');
		for (const m of NODE_MESSAGES) expect(flat, `stderr:\n${stderr}`).toContain(m);
	};

	it.runIf(HAVE_PYTHON)(
		'Python, single file and split + CSV',
		() => {
			for (const [opts, entry, outDir] of [
				[{}, 'session.py', 'session_output'],
				[{ split: true, dataAsCsv: true, version: '72.22-test' }, 'analysis.py', 'analysis_output']
			]) {
				const { dir, res } = runExport(
					sessionToPythonFiles(session, PY_RUNTIME, opts),
					PYTHON,
					entry
				);
				expect(res.status, `${res.error?.message ?? ''}\nstderr:\n${res.stderr}`).toBe(0);
				check(readFileSync(join(dir, outDir, 'columns_after_tables.csv'), 'utf8'));
				printsNodeMessages(res.stderr);
			}
		},
		240_000
	);

	it.runIf(HAVE_R)(
		'R, single file and split + CSV',
		() => {
			for (const [opts, entry, outDir] of [
				[{}, 'session.R', 'session_output'],
				[{ split: true, dataAsCsv: true, version: '72.22-test' }, 'analysis.R', 'analysis_output']
			]) {
				const { dir, res } = runExport(sessionToRFiles(session, R_RUNTIME, opts), 'Rscript', entry);
				expect(res.status, `${res.error?.message ?? ''}\nstderr:\n${res.stderr}`).toBe(0);
				check(readFileSync(join(dir, outDir, 'columns_after_analyses.csv'), 'utf8'));
				printsNodeMessages(res.stderr);
			}
		},
		240_000
	);
});

// The Actogram's chosen start (`startTimeIN`, Properties > Time, saved since v82.23) must reach
// the exported figure and its plot-data CSV: the rows fold at that instant, not at midnight
// before the first sample. The session is parity-zoned-time (the hive's Auckland text, every
// 15 min from 1 Apr 2024, across the end of NZDT on 7 Apr) with an actogram of it whose chosen
// start is 7 Apr 00:00 NZDT, the DST day itself. The expected rows are the hive's own instants
// as the script resolved them (columns.csv): every sample from the start on, a left-edge bar
// 0.25 h wide at its elapsed hours from the start, in row floor(h / 24) + 1. The app's side of
// the same fold is pinned by the `tz-*-start-time-in-*` clockZone parity fixtures.
describe.runIf(HAVE_PYTHON)('exported Python scripts fold the actogram at its chosen start', () => {
	// 7 Apr 2024 00:00 NZDT (+13:00).
	const START = Date.parse('2024-04-06T11:00:00Z');
	function actogramSession(withStart) {
		const s = JSON.parse(
			readFileSync(join(ROOT, 'tools', 'parity', 'sessions', 'parity-zoned-time.json'), 'utf8')
		);
		s.plots = [
			{
				id: 70,
				name: 'Hive actogram',
				type: 'actogram',
				x: 0,
				y: 0,
				width: 600,
				height: 400,
				plot: {
					periodHrs: 24,
					doublePlot: 2,
					data: [{ x: { refId: 1 }, y: { refId: 2 }, colour: '#000000' }],
					...(withStart ? { startTimeIN: START } : {})
				}
			}
		];
		return s;
	}
	const rowsOf = (text) =>
		text
			.trim()
			.split('\n')
			.slice(1)
			.map((l) => l.split(',').map(Number));
	/** Header index by name in a CSV header line (quotes stripped). */
	const col = (head, name) =>
		head
			.split(',')
			.map((h) => h.replaceAll('"', ''))
			.indexOf(name);

	for (const [label, opts, entry, outDir] of [
		['single inline', {}, 'session.py', 'session_output'],
		['split + CSV data', { split: true, dataAsCsv: true }, 'analysis.py', 'analysis_output']
	]) {
		it(`${label}: rows start at startTimeIN, in the column's zone, across the DST day`, () => {
			const { dir, res } = runExport(
				sessionToPythonFiles(actogramSession(true), PY_RUNTIME, opts),
				PYTHON,
				entry
			);
			expect(res.status, `${res.error?.message ?? ''}\nstderr:\n${res.stderr}`).toBe(0);
			const out = join(dir, outDir);
			const csv = readdirSync(out).find((f) => /^plot_70_.*_data\.csv$/.test(f));
			expect(csv, readdirSync(out).join()).toBeTruthy();
			const got = rowsOf(readFileSync(join(out, csv), 'utf8'));

			const [head, ...lines] = readFileSync(join(out, 'columns.csv'), 'utf8').trim().split('\n');
			const ti = col(head, 'hive time');
			const yi = col(head, 'activity');
			expect(ti).toBeGreaterThanOrEqual(0);
			const want = [];
			for (const l of lines) {
				const cells = l.split(',');
				const t = Number(cells[ti]);
				const h = (t - START) / 3600000;
				if (!(h >= 0)) continue;
				want.push([0, Math.floor(h / 24) + 1, h, h + 0.25, Number(cells[yi])]);
			}
			// A 15 min logger for 14 days from 1 Apr: the 7 Apr 00:00 start keeps 8 days of it.
			expect(want.length).toBeGreaterThan(700);
			expect(got).toHaveLength(want.length);
			for (let i = 0; i < want.length; i++) {
				for (let k = 0; k < 5; k++) expect(got[i][k]).toBeCloseTo(want[i][k], 9);
			}
			// The export's DST note counts rows from the chosen start.
			expect(res.stderr.replace(/\s+/g, ' ')).toContain(
				'Daylight saving ended on 7 Apr 2024 in Pacific/Auckland. Rows are 24 h of elapsed time, so rows after it start at 23:00 local time.'
			);
		}, 240_000);
	}

	it('without a chosen start the rows begin at midnight before the first sample', () => {
		const { dir, res } = runExport(
			sessionToPythonFiles(actogramSession(false), PY_RUNTIME, {}),
			PYTHON,
			'session.py'
		);
		expect(res.status, `${res.error?.message ?? ''}\nstderr:\n${res.stderr}`).toBe(0);
		const out = join(dir, 'session_output');
		const csv = readdirSync(out).find((f) => /^plot_70_.*_data\.csv$/.test(f));
		const got = rowsOf(readFileSync(join(out, csv), 'utf8'));
		// 1 Apr 00:00 NZDT is the first sample: every one of the 1344 samples is drawn.
		expect(got).toHaveLength(1344);
		expect(got[0].slice(1, 4)).toEqual([1, 0, 0.25]);
	}, 240_000);
});

// Numbers saved as TEXT in a number column (David, 2026-10-25): the app reads them as numbers
// when the session loads (core/numericTextMigration.js), and the ports read the SAME saved file
// the same way (Column.get_data / col_data). The session is the parity-only
// tools/parity/sessions/parity-numeric-text.json, exported as saved (text and all), so this is
// the ports' own reading, not the app's. Expected numbers: what the app computes for it
// (session_js_results.json). Exported with the CSV sidecar too, where an all-text column
// travels as a 'str' column.
describe('exported scripts read numbers saved as text (parity-numeric-text)', () => {
	const session = JSON.parse(
		readFileSync(join(ROOT, 'tools', 'parity', 'sessions', 'parity-numeric-text.json'), 'utf8')
	);
	/** Every cell of one CSV column, by header. */
	const columnFromCsv = (csv, header) => {
		const rows = csv.trim().split('\n');
		const clean = (s) => s.replaceAll('"', '');
		const idx = rows[0].split(',').map(clean).indexOf(header);
		expect(idx).toBeGreaterThanOrEqual(0);
		return rows.slice(1).map((r) => clean(r.split(',')[idx]));
	};
	const check = (out, stderr) => {
		const sum = columnFromCsv(out, 'result_72')
			.filter((v) => v !== '')
			.map(Number);
		// R writes 15 significant digits.
		[10, 11.862966948437268, 16.358980000000003].forEach((v, i) =>
			expect(sum[i]).toBeCloseTo(v, 9)
		);
		expect(sum).toHaveLength(50);
		expect(columnFromCsv(out, 'n_71').slice(0, 2).map(Number)).toEqual([50, 45]);
		const mean = columnFromCsv(out, 'mean_71').slice(0, 2).map(Number);
		expect(mean[0]).toBeCloseTo(48.42725933896875, 9);
		expect(mean[1]).toBeCloseTo(53, 9);
		expect(stderr).toContain('1 value is not a number (e.g. "abc")');
	};
	/** The saved columns as the port read them: text as numbers, blank text as missing. */
	const checkRead = (csv) => {
		const a = columnFromCsv(csv, 'Describe Data input 1');
		expect(Number(a[1])).toBeCloseTo(11.362966948437268, 9);
		expect(a[1]).not.toMatch(/\s/);
		const b = columnFromCsv(csv, 'Describe Data input 2');
		expect(['', 'NA']).toContain(b[7]); // whitespace only: missing (R writes NA)
		expect(b[11]).toBe('abc');
	};

	for (const [label, opts, entry, outDir] of [
		['single inline', {}, 'session.py', 'session_output'],
		[
			'split + CSV data',
			{ split: true, dataAsCsv: true, version: 't' },
			'analysis.py',
			'analysis_output'
		]
	]) {
		it.runIf(HAVE_PYTHON)(
			`Python (${label}): sums, counts and the warning match the app`,
			() => {
				const { dir, res } = runExport(
					sessionToPythonFiles(session, PY_RUNTIME, opts),
					PYTHON,
					entry
				);
				expect(res.status, `${res.error?.message ?? ''}\nstderr:\n${res.stderr}`).toBe(0);
				check(
					readFileSync(join(dir, outDir, 'columns_after_tables.csv'), 'utf8'),
					res.stderr + res.stdout
				);
				checkRead(readFileSync(join(dir, outDir, 'columns.csv'), 'utf8'));
			},
			240_000
		);
	}

	for (const [label, opts, entry, outDir] of [
		['single inline', {}, 'session.R', 'session_output'],
		[
			'split + CSV data',
			{ split: true, dataAsCsv: true, version: 't' },
			'analysis.R',
			'analysis_output'
		]
	]) {
		it.runIf(HAVE_R)(
			`R (${label}): sums, counts and the warning match the app`,
			() => {
				const { dir, res } = runExport(sessionToRFiles(session, R_RUNTIME, opts), 'Rscript', entry);
				expect(res.status, `${res.error?.message ?? ''}\nstderr:\n${res.stderr}`).toBe(0);
				check(
					readFileSync(join(dir, outDir, 'columns_after_analyses.csv'), 'utf8'),
					res.stderr + res.stdout
				);
				checkRead(readFileSync(join(dir, outDir, 'columns.csv'), 'utf8'));
			},
			240_000
		);
	}
});
