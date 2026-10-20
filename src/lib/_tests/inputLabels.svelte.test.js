// @ts-nocheck
// Node results that hold column names as DATA carry the names a person reads, and bake them for
// the Python and R ports.
//
// Describe data and Normality test (`variable`), Correlation (`var_i`, `var_j`) and Logistic
// regression (`term`) write their input columns' names into an output column. Since v82.33 the
// app writes the DISPLAY name there ("Residuals: y", not the stored `resid_191_15`). The ports
// cannot work a node output's label out, so the node bakes the labels into its args as
// `_inputLabels` ({ id: label }) and the ports read them (tools/ancir_runtime.py `_input_label`,
// tools/ancir_runtime.R `input_label`). Whole-session parity (tools/test_session_parity.py)
// failed on demo-workflow-stats-regression's Normality test until both sides agreed.
//
// The Python export also labels plot legends with the display names (exportColumnLabels).
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts, pushObj } from '$lib/core/core.svelte.js';
import { Column, getColumnById } from '$lib/core/Column.svelte';
import { TableProcess } from '$lib/core/TableProcess.svelte';
import { displayNameById, exportColumnLabels } from '$lib/core/columnLabels.js';
import { normalizeYInputs } from '$lib/tableProcesses/tpArgHelpers.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';
import { setWorkerFactory } from '$lib/workers/workerPool.js';

const DEMOS = join(process.cwd(), 'static', 'sessions', 'demos');

// Node name -> [the arg holding its input ids, the output keys that hold their labels].
const LABEL_NODES = {
	DescribeData: ['yIN', ['variable']],
	NormalityTest: ['yIN', ['variable']],
	Correlation: ['yIN', ['var_i', 'var_j']],
	LogisticRegression: ['xIN', ['term']],
	// Wide To Long's `category` cells name the value column each row came from (v82.38).
	WideToLong: ['valueColIds', ['category']]
};

class ThrowOnPost {
	postMessage() {
		throw new Error('forcing synchronous compute');
	}
	terminate() {}
}

/** Load a saved session into core the way the parity emitter does, and run every node. */
async function loadAndRun(file) {
	const session = JSON.parse(readFileSync(join(DEMOS, file), 'utf8'));
	core.data = [];
	core.plots = [];
	core.tableProcesses = [];
	core.groups = session.groups ?? [];
	core.storedValues = session.storedValues ?? {};
	core.rawData = new Map(Object.entries(session.rawData ?? {}).map(([k, v]) => [+k, v]));
	for (const cd of session.data ?? []) pushObj(Column.fromJSON(cd));
	for (const tpj of session.tableProcesses ?? []) {
		core.tableProcesses.push(new TableProcess(tpj, null, tpj.id));
	}
	for (const tp of core.tableProcesses) await tp.doProcess();
}

const inputIds = (tp) =>
	normalizeYInputs(tp.args[LABEL_NODES[tp.name][0]]).filter(
		(id) => id != null && id !== -1 && getColumnById(id)
	);

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
	setWorkerFactory(() => new ThrowOnPost());
});

describe('node results that hold column names', () => {
	it('Normality test on a fit residual writes and bakes "Residuals: y", not its stored name', async () => {
		await loadAndRun('demo-workflow-stats-regression.json');
		const tp = core.tableProcesses.find((t) => t.name === 'NormalityTest');
		const [id] = inputIds(tp);
		const stored = getColumnById(id).name;
		expect(stored).toMatch(/^resid_/);
		expect(tp.args._inputLabels).toEqual({ [String(id)]: 'Residuals: y' });
		expect(getColumnById(tp.args.out.variable).getData()).toEqual(['Residuals: y']);
		// The Python export's legends get the same name; plain columns are left out.
		const labels = exportColumnLabels();
		expect(labels[id]).toBe('Residuals: y');
		for (const [cid, label] of Object.entries(labels)) {
			expect(label).not.toBe(getColumnById(Number(cid)).name);
		}
	});

	it('Wide To Long on a fit residual writes and bakes "Residuals: y" as the category', async () => {
		await loadAndRun('demo-workflow-stats-regression.json');
		const normality = core.tableProcesses.find((t) => t.name === 'NormalityTest');
		const [residId] = inputIds(normality);
		// The fit that made the residual, for its x.
		const fit = core.tableProcesses.find((t) => Object.values(t.args?.out ?? {}).includes(residId));
		const xId = fit.args.xIN;
		expect(getColumnById(xId)).toBeTruthy();
		expect(getColumnById(residId).name).toMatch(/^resid_/);
		const tp = new TableProcess(
			{
				name: 'WideToLong',
				args: { timeIN: xId, valueColIds: [residId], out: { time: -1, category: -1, value: -1 } }
			},
			null
		);
		core.tableProcesses.push(tp);
		await tp.doProcess();
		expect(tp.args._inputLabels).toEqual({ [String(residId)]: 'Residuals: y' });
		const cats = getColumnById(tp.args.out.category).getData();
		expect(cats.length).toBeGreaterThan(0);
		expect(new Set(cats)).toEqual(new Set(['Residuals: y']));
	});

	it('every such node in every demo bakes its inputs display names and writes them', async () => {
		const files = readdirSync(DEMOS).filter((f) => f.endsWith('.json') && f !== 'index.json');
		let checked = 0;
		for (const file of files) {
			await loadAndRun(file);
			for (const tp of core.tableProcesses) {
				if (!LABEL_NODES[tp.name]) continue;
				const ids = inputIds(tp);
				const expected = Object.fromEntries(
					ids.map((id) => [String(id), displayNameById(id, String(id))])
				);
				expect(tp.args._inputLabels, `${file} ${tp.name}`).toEqual(expected);
				const allowed = new Set([...Object.values(expected), '(intercept)']);
				for (const key of LABEL_NODES[tp.name][1]) {
					const outId = tp.args.out?.[key];
					if (!(outId >= 0)) continue;
					for (const v of getColumnById(outId).getData()) {
						expect(allowed.has(v), `${file} ${tp.name}.${key}: ${v}`).toBe(true);
					}
				}
				checked++;
			}
		}
		// Describe data, Normality test, Correlation, Logistic regression and Wide To Long demos
		// at least.
		expect(checked).toBeGreaterThanOrEqual(5);
	});
});
