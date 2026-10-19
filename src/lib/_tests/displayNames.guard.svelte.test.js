// @ts-nocheck
// No internal column name reaches a label (v82.34).
//
// A node output column keeps an internal NAME (`joined_483_38`, `binnedy_469_36`, `rsquared_5`):
// the out key plus the node id, load-bearing for wiring and saved sessions. What a person reads
// is the DISPLAY name (core/outputLabels.js via core/columnLabels.js: "amplitude",
// "Binned: temperature", "R²"). Quick plot on a stacked Join Data node showed the boxplot's
// series as "joined_21_3", because the plot label read the raw `.name` of the wired column.
//
// Two guards:
//   1. Every shipped demo, loaded for real: every plot's series labels and legend entries,
//      every wired column's display name, the quick plot every node would spawn (title and
//      series labels) and the default stored-value name for each node input read as words,
//      never as an internal id.
//   2. Source scan: display code reads a column's display name (`displayNameOf` /
//      `col.displayName`), not `getColumnById(id)?.name` or a plot series' `y.name`.
//      A line that WRITES a stored name (`.name = ...`) is storage, not display, and is skipped.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';
import { getColumnById } from '$lib/core/Column.svelte';
import { displayNameOf } from '$lib/core/columnLabels.js';
import { canonicalNodeViz } from '$lib/plots/canonicalNodeViz.js';
import { storedValueNames } from '$lib/core/storedValueNames.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..', '..');
const demoDir = join(repo, 'static/sessions/demos');

/**
 * The internal names in the loaded session: the stored `name` of every node output whose
 * display name differs (`joined_483_38` shows "amplitude"). A person's own column name, even
 * one shaped like `noise_1` or `control_n_25`, is not on the list: it is what they read.
 */
function internalNames() {
	const out = new Set();
	for (const tp of core.tableProcesses)
		for (const id of Object.values(tp.args?.out ?? {})) {
			const col = typeof id === 'number' && id >= 0 ? getColumnById(id) : null;
			if (col?.name && displayNameOf(col) !== col.name) out.add(col.name);
		}
	return out;
}

/** Does `text` show one of `names` as a whole token? */
export function showsInternalName(text, names) {
	for (const n of names) {
		const i = String(text).indexOf(n);
		if (i < 0) continue;
		const before = text[i - 1];
		const after = text[i + n.length];
		if (!/[A-Za-z0-9_]/.test(before ?? '') && !/[A-Za-z0-9_]/.test(after ?? '')) return n;
	}
	return null;
}

describe('showsInternalName', () => {
	it('finds a whole internal name, not a longer word that contains it', () => {
		const names = new Set(['joined_483_38', 'rsquared_5']);
		expect(showsInternalName('joined_483_38', names)).toBe('joined_483_38');
		expect(showsInternalName('Box: joined_483_38 fit', names)).toBe('joined_483_38');
		expect(showsInternalName('rsquared_55', names)).toBeNull();
		expect(showsInternalName('amplitude', names)).toBeNull();
	});
});

describe('guard: no demo shows an internal column name', () => {
	const files = readdirSync(demoDir).filter((f) => f.endsWith('.json') && f !== 'index.json');
	/** Registry keys whose display name differs ("JoinData" vs "Join data"): a title must not show them. */
	let typeKeys = [];

	beforeAll(async () => {
		appConsts.processMap = await loadProcesses();
		appConsts.plotMap = await loadPlots();
		appConsts.tableProcessMap = await loadTableProcesses();
		typeKeys = [...appConsts.tableProcessMap.entries()]
			.filter(([key, entry]) => entry?.displayName && entry.displayName !== key)
			.map(([key]) => key);
	});

	it('finds the demos', () => {
		expect(files.length).toBeGreaterThan(50);
	});

	it.each(files)('%s', async (file) => {
		await importJson(JSON.parse(readFileSync(join(demoDir, file), 'utf8')));
		const bad = [];
		const names = internalNames();
		const check = (where, text) => {
			if (typeof text !== 'string' || text === '') return;
			const hit = showsInternalName(text, names);
			if (hit) bad.push(`${where}: "${text}" shows ${hit}`);
		};
		const checkTitle = (where, text) => {
			check(where, text);
			const head = String(text ?? '').split(':')[0];
			if (typeKeys.includes(head)) bad.push(`${where}: "${text}" (node type key)`);
		};

		for (const plot of core.plots) {
			const tag = `plot ${plot.id} (${plot.type})`;
			checkTitle(`${tag} title`, plot.name);
			for (const [i, d] of (plot.plot?.data ?? []).entries()) {
				check(`${tag} series ${i}`, d.displayLabel);
				const legend = d.getLegendItem?.();
				const items = Array.isArray(legend) ? legend : legend ? [legend] : [];
				for (const it of items) check(`${tag} legend`, it?.label);
				for (const ch of ['x', 'y', 'column'])
					if (d[ch]?.refId != null && d[ch].refId >= 0)
						check(`${tag} series ${i} ${ch}`, displayNameOf(d[ch]));
			}
			for (const id of plot.plot?.columnRefs ?? [])
				check(`${tag} column`, displayNameOf(getColumnById(id)));
		}

		for (const tp of core.tableProcesses) {
			// A stored value of this node names the input it describes (`cosinor_rmse_<input>`).
			const yIns = Array.isArray(tp.args?.yIN) ? tp.args.yIN : [tp.args?.yIN];
			for (const id of yIns.filter((v) => typeof v === 'number' && v >= 0))
				check(
					`stored value of ${tp.name} ${tp.id}`,
					storedValueNames('value', id).defaultName.slice('value_'.length)
				);
			const spec = canonicalNodeViz({ type: 'tableprocess', tpObj: tp });
			if (!spec) continue;
			const tag = `quick plot of ${tp.name} ${tp.id}`;
			checkTitle(`${tag} title`, spec.title);
			for (const s of spec.series ?? []) {
				check(`${tag} label`, s.label);
				check(`${tag} y`, displayNameOf(getColumnById(s.y)));
			}
			if (spec.box) {
				check(`${tag} box x`, displayNameOf(getColumnById(spec.box.x)));
				check(`${tag} box y`, displayNameOf(getColumnById(spec.box.y)));
			}
			for (const id of [...(spec.columns ?? []), ...(spec.columnRefs ?? [])])
				check(`${tag} column`, displayNameOf(getColumnById(id)));
		}
		expect(bad).toEqual([]);
	});
});

describe('guard: display code reads display names, not raw column names', () => {
	const srcRoot = resolve(here, '..', '..');
	function files(dir = srcRoot, out = []) {
		for (const entry of readdirSync(dir)) {
			if (entry === 'node_modules' || entry.startsWith('.') || entry.includes('conflicted'))
				continue;
			const full = join(dir, entry);
			if (statSync(full).isDirectory()) files(full, out);
			else if (/\.(svelte|js)$/.test(entry) && !/\.test\.js$/.test(entry)) out.push(full);
		}
		return out;
	}
	// `getColumnById(id)?.name`, `getColumnById(id).name`, and a plot series' wired column
	// (`datum.y.name`, `d.y?.name`, `d.column?.name`).
	const RAW_READ =
		/getColumnById(?:Local)?\([^()]*(?:\([^()]*\))?[^()]*\)\??\.name\b|\b(?:datum|d)\.(?:x|y|column)\??\.name\b/g;
	/**
	 * Storage, not display: a line that writes a name, a comment, or a read marked
	 * `// stored name, not display` (it seeds an output column's stored name or matches an
	 * old stored-value name).
	 */
	const isStorage = (line) =>
		/\.name\s*=[^=]/.test(line) ||
		/^\s*\/\//.test(line) ||
		line.includes('// stored name, not display');

	it('no display read of a raw column name', () => {
		const bad = [];
		for (const f of files()) {
			const lines = readFileSync(f, 'utf8').split('\n');
			lines.forEach((line, i) => {
				if (isStorage(line)) return;
				for (const m of line.matchAll(RAW_READ))
					bad.push(`${relative(srcRoot, f)}:${i + 1}: ${m[0]}`);
			});
		}
		expect(bad).toEqual([]);
	});
});
