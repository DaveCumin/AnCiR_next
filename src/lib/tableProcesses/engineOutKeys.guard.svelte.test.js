// @ts-nocheck
// GUI vs headless engine: for EVERY registered table process, the outputs the MCP engine
// produces (run_table_process; its output keys are seeded by synthesizeDynamicOut plus the
// definition's template and paramOutKeys) must be the outputs the app's own node produces for
// the same inputs, once its component has mounted and reconciled its ports
// (syncOutputColumns and friends, which only run in the component).
//
// Generalises 2026-11-09 bug 3: the engine omitted RhythmicityAnalysis's `stat_*` outputs, which
// the node adds in its component. mcp/test/engine.session-integrity.test.js pins that case; this
// compares every node, so a port family the engine forgets fails here whichever node it is.
//
// Same ids on both sides: each side starts a fresh AncirSession (which empties the store and
// restarts the id counters) and imports the same columns, so `<yId>_period` names the same y.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { appConsts, pushObj } from '$lib/core/core.svelte.js';
import { getColumnById } from '$lib/core/Column.svelte';
import { TableProcess } from '$lib/core/TableProcess.svelte';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';
import { buildTableProcessDefaults } from '$lib/core/tpDefaults.js';
import { AncirSession, ensureRegistry, fillOmittedArgs } from '../../../mcp/src/engine/session.js';
import { loadSelectOptions, selectOptionsOf } from '../../../mcp/src/engine/paramOptions.js';
import { specOf, importSpecInputs, engineArgs } from '../../../mcp/test/guardSupport.js';

// The registry, read at collection time so there is one test per registered node.
const REGISTRY = await loadTableProcesses();
const NAMES = [...REGISTRY.keys()].sort();
await loadSelectOptions();

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
	await ensureRegistry();
}, 120000);

afterEach(() => cleanup());

const lengthOf = (id) => {
	try {
		return getColumnById(id)?.getData()?.length ?? 0;
	} catch {
		return -1;
	}
};

/** The node's non-empty output ports, key → length. */
function outputShape(out) {
	const shape = {};
	for (const [k, id] of Object.entries(out ?? {})) {
		if (typeof id !== 'number' || id < 0) continue;
		const n = lengthOf(id);
		if (n !== 0) shape[k] = n;
	}
	return shape;
}

/** Let the component's effects, microtask reconciles and async computes settle. */
async function settle(tp) {
	let last = '';
	let stable = 0;
	for (let i = 0; i < 400 && stable < 3; i++) {
		flushSync();
		await tick();
		await new Promise((r) => setTimeout(r, 1));
		const now = JSON.stringify(outputShape(tp.args.out));
		stable = now === last ? stable + 1 : 0;
		last = now;
	}
}

/** The args both sides run: the catalogue's, with `override` applied. */
function argsFor(name, ids, override) {
	return { ...engineArgs(specOf(name), ids), ...override };
}

async function engineSide(name, override) {
	const s = new AncirSession(`engine-${name}`);
	const ids = importSpecInputs(s, specOf(name), 'in');
	const res = await s.runTableProcess(name, argsFor(name, ids, override));
	return {
		valid: res.valid,
		error: res.error,
		shape: Object.fromEntries(res.outputs.map((o) => [o.key, o.length]))
	};
}

async function guiSide(name, override) {
	const s = new AncirSession(`gui-${name}`);
	const ids = importSpecInputs(s, specOf(name), 'in');
	const entry = appConsts.tableProcessMap.get(name);
	// A node as the app makes one: every param filled as a new node's (the engine fills them the
	// same way), and only the declared output template (the constructor adds the per-y ports;
	// the component reconciles the rest when it mounts).
	const args = fillOmittedArgs(entry, structuredClone(argsFor(name, ids, override)));
	args.out = Object.fromEntries(Object.keys(entry.defaults.get('out') ?? {}).map((k) => [k, -1]));
	const tp = new TableProcess({ name, args }, null);
	pushObj(tp);
	render(entry.component, { props: { p: tp } });
	await settle(tp);
	const finite = Object.values(tp.args.out ?? {}).some((id) => {
		try {
			return (getColumnById(id)?.getData() ?? []).some((v) => Number.isFinite(v));
		} catch {
			return false;
		}
	});
	return { shape: outputShape(tp.args.out), finite };
}

// Variants whose catalogue data makes them slow (a rectangular-wave fit in each of 8 one-week
// windows took ~10 s a side): fewer, shorter windows. Only the ports are compared, which do
// not depend on the window count.
const SLOW_VARIANTS = { MovingAnalysis: { rectfit: { windowSize: 48, stepSize: 144 } } };

/**
 * The catalogue args, then one variant per value of each arg the node declares as changing its
 * ports (`definition.outputShapingArgs`): every option of a select, the other value of a
 * boolean, one more of a count. List- and object-valued shaping args keep the catalogue value.
 */
function variants(name) {
	const entry = REGISTRY.get(name);
	const out = [['catalogue args', {}]];
	const base = buildTableProcessDefaults(entry, {});
	const options = selectOptionsOf('tableProcess', name);
	for (const arg of entry.definition?.outputShapingArgs ?? []) {
		const d = base[arg];
		const opts = options.get(arg);
		if (opts?.length)
			for (const o of opts) out.push([`${arg}: ${o}`, { [arg]: o, ...SLOW_VARIANTS[name]?.[o] }]);
		else if (typeof d === 'boolean') out.push([`${arg}: ${!d}`, { [arg]: !d }]);
		else if (typeof d === 'number') out.push([`${arg}: ${d + 1}`, { [arg]: d + 1 }]);
	}
	return out;
}

describe('the engine produces the outputs the app node produces', () => {
	it('covers the whole registry', () => expect(NAMES.length).toBeGreaterThan(30));
	for (const name of NAMES) {
		describe(name, () => {
			for (const [label, override] of variants(name)) {
				it(
					label,
					async () => {
						const engine = await engineSide(name, override);
						const { shape: gui, finite } = await guiSide(name, override);
						// A variant the engine refuses must be one the node cannot run either (it may
						// blank its ports, as a refused fit does, but show no number), and the refusal
						// must say why when the node does: not only the generic hint.
						if (!engine.valid) {
							expect(finite, `${name} (${label}): engine refused (${engine.error})`).toBe(false);
							expect(engine.error, `${name} (${label}) refusal reason`).not.toMatch(
								/check inputs\/parameters via list_capabilities/
							);
							return;
						}
						const missing = Object.keys(gui).filter((k) => !(k in engine.shape));
						const extra = Object.keys(engine.shape).filter((k) => !(k in gui));
						expect(
							{ missing, extra },
							`${name} (${label}): outputs the engine lacks / adds`
						).toEqual({ missing: [], extra: [] });
						expect(engine.shape, `${name} (${label}) output lengths`).toEqual(gui);
					},
					30000
				);
			}
		});
	}
});
