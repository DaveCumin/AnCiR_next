// @ts-nocheck
// Stored values saved before v82.34 take their plain names on load (David, 2026-10-25).
//
// v82.34 named a new stored value after its column's DISPLAY name, made one word
// (storedValueNames.js: `trend_r2_Activity_counts`). Values saved before kept the old default
// they were saved with (`trend_r2_Activity (counts)`, or an internal name such as
// `groupcmp_ttest_p_joined_483_38`), so formulas carried names no new value would have. Now a
// value still under its old default name takes the plain name when its button first claims it
// (storedValueClaims.js adoptPlainName), every formula follows, and a name the user chose
// stays. The load is not an undo step and leaves the session saved, as the load's own
// migrations do.
//
// Through the real path: importJson on a session as saved then
// (src/test/fixtures/stored-values-pre-v82.34.json), then the Fit trend node mounted, which is
// what renders its store buttons on the canvas or in the hidden compute host.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { readFileSync, writeFileSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sessionToPythonFiles } from '$lib/utils/pythonExport.js';
import { sessionToRFiles } from '$lib/utils/rExport.js';
import { core, appConsts, outputCoreAsJson } from './core.svelte.js';
import { history } from './opHistory.svelte.js';
import { paramDiffWatcher } from './paramDiffWatcher.svelte.js';
import { initUnsavedChanges, hasUnsavedChanges } from './unsavedChanges.svelte.js';
import { resetStoredValueClaimsForTest } from './storedValueClaims.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';

const FIXTURE = join(process.cwd(), 'src', 'test', 'fixtures', 'stored-values-pre-v82.34.json');
const fixture = () => JSON.parse(readFileSync(FIXTURE, 'utf8'));

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
	history.init();
	initUnsavedChanges();
}, 120000);

afterEach(() => {
	cleanup();
	resetStoredValueClaimsForTest();
});

const settle = async () => {
	for (let i = 0; i < 4; i++) {
		flushSync();
		await tick();
		await new Promise((r) => setTimeout(r, 0));
	}
};

/** importJson, then mount the Fit trend node as the canvas does. */
async function loadAndMount() {
	await importJson(fixture());
	const tp = core.tableProcesses.find((t) => t.name === 'TrendFit');
	const TrendFit = appConsts.tableProcessMap.get('TrendFit').component;
	render(TrendFit, { props: { p: tp } });
	await settle();
	return tp;
}

const formula = () => core.tableProcesses.find((t) => t.name === 'FormulaColumn');

describe('stored values saved before v82.34', () => {
	it('take the plain name on load, and the formula follows; a user name stays', async () => {
		await loadAndMount();
		const names = Object.keys(core.storedValues);
		expect(names).toContain('trend_r2_Activity_counts');
		expect(names).not.toContain('trend_r2_Activity (counts)');
		expect(names).toContain('my_rmse');
		expect(core.storedValues.trend_r2_Activity_counts.key).toBe('tp:93|trend_r2_Activity_counts');
		expect(core.storedValues.my_rmse.key).toBe('tp:93|trend_rmse_Activity_counts');
		expect(
			formula()
				.args.tokens.filter((t) => t.type === 'stored')
				.map((t) => t.key)
		).toEqual(['trend_r2_Activity_counts', 'my_rmse']);
		// No new value was made beside them.
		expect(names.filter((n) => n.startsWith('trend_r2'))).toEqual(['trend_r2_Activity_counts']);
	});

	it('is not an undo step, and the next edit of the formula records only itself', async () => {
		await loadAndMount();
		await paramDiffWatcher.flush();
		// Mounting here, after the load, lets the Fit trend node write its own defaults (in the
		// app that happens inside the load, which keeps them off the stack); none of what is
		// recorded is the rename.
		const touchesRename = (e) =>
			JSON.stringify(e).includes('Activity') || e.forward?.tpId === formula().id;
		expect(history.undoStack.filter(touchesRename)).toEqual([]);
		const before = history.undoStack.length;
		formula().args.tokens = [...formula().args.tokens, { type: 'text', value: ' * 2' }];
		await paramDiffWatcher.flush();
		expect(history.undoStack).toHaveLength(before + 1);
		history.undo();
		expect(formula().args.tokens.map((t) => t.key ?? t.value ?? t.id)).toEqual([
			891,
			' * 0 + ',
			'trend_r2_Activity_counts',
			' + ',
			'my_rmse'
		]);
	});

	it('a rename after the load is neither an undo step nor an edit (claim level)', async () => {
		await importJson(fixture());
		await paramDiffWatcher.flush();
		const stack = history.undoStack.length;
		const { claimStoredValue } = await import('./storedValueClaims.js');
		claimStoredValue({
			key: 'tp:93|trend_r2_Activity_counts',
			base: 'trend_r2_Activity_counts',
			legacyBases: ['trend_r2_Activity (counts)'],
			getter: () => 1,
			token: {}
		});
		expect(formula().args.tokens[2].key).toBe('trend_r2_Activity_counts');
		await paramDiffWatcher.flush();
		expect(history.undoStack).toHaveLength(stack);
		expect(hasUnsavedChanges()).toBe(false);
	});

	it('saves under the plain name, and a reload keeps it', async () => {
		await loadAndMount();
		const saved = JSON.parse(outputCoreAsJson());
		const svNames = Object.keys(saved.storedValues).sort();
		expect(svNames).toContain('trend_r2_Activity_counts');
		expect(svNames).not.toContain('trend_r2_Activity (counts)');
		cleanup();
		resetStoredValueClaimsForTest();
		await importJson(saved);
		const tp = core.tableProcesses.find((t) => t.name === 'TrendFit');
		render(appConsts.tableProcessMap.get('TrendFit').component, { props: { p: tp } });
		await settle();
		expect(Object.keys(core.storedValues).sort()).toEqual(svNames);
	});
});

// The exported scripts read stored values by name from the saved session, so the formula must
// still resolve once the names changed: the file the app saves after the load, exported.
describe('exported scripts resolve the renamed values', () => {
	const ROOT = process.cwd();
	const PYTHON = join(ROOT, 'tools', '.venv', 'bin', 'python');
	const HAVE_PYTHON = existsSync(PYTHON);
	const HAVE_R = spawnSync('Rscript', ['--version'], { encoding: 'utf8' }).status === 0;
	const file = fixture();
	const expected =
		file.storedValues['trend_r2_Activity (counts)'].staticValue +
		file.storedValues.my_rmse.staticValue;

	async function savedAfterLoad() {
		await loadAndMount();
		return JSON.parse(outputCoreAsJson());
	}
	function run(files, cmd, entry, csvName) {
		const dir = mkdtempSync(join(tmpdir(), 'ancir-sv-names-'));
		try {
			for (const f of files) writeFileSync(join(dir, f.name), f.text);
			const res = spawnSync(cmd, [entry], { cwd: dir, encoding: 'utf8', timeout: 180_000 });
			expect(res.status, `stderr:\n${res.stderr}`).toBe(0);
			const csv = readFileSync(join(dir, 'session_output', csvName), 'utf8')
				.trim()
				.split('\n');
			const idx = csv[0]
				.split(',')
				.map((h) => h.replaceAll('"', ''))
				.indexOf('result_94');
			expect(idx, csv[0] + res.stderr).toBeGreaterThanOrEqual(0);
			return Number(csv[1].split(',')[idx].replaceAll('"', ''));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}

	it.runIf(HAVE_PYTHON)(
		'Python',
		async () => {
			const session = await savedAfterLoad();
			const py = readFileSync(join(ROOT, 'tools', 'ancir_runtime.py'), 'utf8');
			const v = run(
				sessionToPythonFiles(session, py),
				PYTHON,
				'session.py',
				'columns_after_tables.csv'
			);
			expect(v).toBeCloseTo(expected, 9);
		},
		240_000
	);

	it.runIf(HAVE_R)(
		'R',
		async () => {
			const session = await savedAfterLoad();
			const r = readFileSync(join(ROOT, 'tools', 'ancir_runtime.R'), 'utf8');
			const v = run(
				sessionToRFiles(session, r),
				'Rscript',
				'session.R',
				'columns_after_analyses.csv'
			);
			expect(v).toBeCloseTo(expected, 9);
		},
		240_000
	);
});
